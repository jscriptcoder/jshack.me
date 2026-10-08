import { describe, expect, it } from 'vitest';
import {
  FIRST_BOOT_MARKER,
  runFirstBoot,
  startingServices,
  type FirstBootBox,
} from './firstBoot.js';
import { applyPatches, type Patch } from '../filesystem/applyPatches.js';
import { createFsView } from '../filesystem/fsView.js';
import {
  defaultDirectoryPermissions,
  defaultFilePermissions,
} from '../filesystem/defaultPermissions.js';
import type { Directory } from '../filesystem/types.js';
import { buildWorkstationBaseFs } from '../generation/workstationFs.js';
import { SYSTEM_LIBRARIES } from '../generation/libraries.js';
import { md5 } from '../generation/md5.js';
import { newestReleaseOn } from '../cve/packageTimeline.js';
import { gameDayAt, WORLD_EPOCH } from '../cve/worldClock.js';
import { parseDpkgVersions, readDpkgStatus } from '../packages/dpkgStatus.js';
import {
  formatProgramPidfileContent,
  programPidfilePath,
  readOpenPorts,
  readRunningProcesses,
} from '../services/pidfile.js';
import { credentialIn, DATADIR_PATH as MYSQL_DATADIR_PATH } from '../mysql/datadir.js';
import { DATADIR_FILE } from '../generation/baseFs.js';
import { storeIn } from '../redis/datadir.js';
import { asAbsPath, asEpochMs, asPlayerKeyHex, type AbsPath } from '../types.js';
import type { PatchApi, PatchResult } from '../commands/types.js';
import { mockIdentity, mockPatchApi } from '../../test/factories/commandEnv.js';

const POOL = ['sshd', 'vsftpd', 'nginx', 'apache2', 'mysqld', 'redis-server'];

/** The two programs that can fill a box's one web server. */
const WEB_SERVERS = ['nginx', 'apache2'];

/** What a box can be born running, one entry per thing it serves: the web server is
 *  one service whichever program runs it. */
const SLOTS = [['sshd'], ['vsftpd'], WEB_SERVERS, ['mysqld'], ['redis-server']];

/** Enough distinct owners that every count and every pool member shows up, and few
 *  enough that the suite stays instant. */
const ownerKeys = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) => index.toString(16).padStart(64, 'a'));

const drawnNames = (ownerKeyHex: string): readonly string[] =>
  startingServices(ownerKeyHex).map((service) => service.daemon.name);

describe('the services a workstation is born running', () => {
  it('are one to three distinct daemons from the desktop pool', () => {
    for (const key of ownerKeys(300)) {
      const names = drawnNames(key);
      expect(names.length).toBeGreaterThanOrEqual(1);
      expect(names.length).toBeLessThanOrEqual(3);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) expect(POOL).toContain(name);
    }
  });

  it('draws one, two and three services about equally often', () => {
    const keys = ownerKeys(600);
    const share = (count: number): number =>
      keys.filter((key) => drawnNames(key).length === count).length / keys.length;
    expect(share(1)).toBeGreaterThan(0.25);
    expect(share(2)).toBeGreaterThan(0.25);
    expect(share(3)).toBeGreaterThan(0.25);
  });

  it('reaches every daemon in the pool', () => {
    const seen = new Set(ownerKeys(300).flatMap(drawnNames));
    expect([...seen].sort()).toEqual([...POOL].sort());
  });

  it('never holds both web servers, since the two cannot share the one port', () => {
    for (const key of ownerKeys(600)) {
      expect(drawnNames(key).filter((name) => WEB_SERVERS.includes(name)).length).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it('runs the web server as nginx or apache2 about equally often', () => {
    const webServers = ownerKeys(600).flatMap((key) =>
      drawnNames(key).filter((name) => WEB_SERVERS.includes(name)),
    );
    const apacheShare = webServers.filter((name) => name === 'apache2').length / webServers.length;
    expect(apacheShare).toBeGreaterThan(0.35);
    expect(apacheShare).toBeLessThan(0.65);
  });

  it('serves the web about as often as it serves anything else', () => {
    // Two programs for one service must not double the web's odds: a box is born
    // serving the web exactly as often as it is born serving files or a database.
    const keys = ownerKeys(600);
    for (const slot of SLOTS) {
      const share =
        keys.filter((key) => drawnNames(key).some((name) => slot.includes(name))).length /
        keys.length;
      expect(share).toBeGreaterThan(0.3);
      expect(share).toBeLessThan(0.5);
    }
  });

  it('is the same set every time for the same owner', () => {
    for (const key of ownerKeys(50)) {
      expect(drawnNames(key)).toEqual(drawnNames(key));
    }
  });

  it('installs each daemon from the package that ships it', () => {
    const packageOf = new Map(
      ownerKeys(300)
        .flatMap((key) => startingServices(key))
        .map((service) => [service.daemon.name, service.packageName]),
    );
    expect(Object.fromEntries(packageOf)).toEqual({
      sshd: 'openssh-server',
      vsftpd: 'vsftpd',
      nginx: 'nginx',
      apache2: 'apache2',
      mysqld: 'mysql',
      'redis-server': 'redis',
    });
  });
});

const ROOT_PASSWORD = 'hunter2';

/** A day on which no pool package sits inside a patch window, so "born at the newest
 *  release" and "born with no live hole" are the same claim and both can be checked. */
const CLEAN_DAY = 100;
const BIRTH = asEpochMs(WORLD_EPOCH + CLEAN_DAY * 86_400_000);

/** The first owner whose draw satisfies `wanted`, so a test can ask for a box born
 *  running a particular service rather than hoping a fixed key happens to draw it. */
const ownerWhose = (wanted: (names: readonly string[]) => boolean): string => {
  const key = ownerKeys(500).find((candidate) => wanted(drawnNames(candidate)));
  if (key === undefined) throw new Error('no owner in range draws that');
  return key;
};

/** Owners whose draws between them cover the whole pool. */
const ownersCoveringPool = (): readonly string[] => {
  const covered = new Set<string>();
  return ownerKeys(500).filter((key) => {
    const fresh = drawnNames(key).some((name) => !covered.has(name));
    for (const name of drawnNames(key)) covered.add(name);
    return fresh;
  });
};

const anyOwner = (): string => ownerWhose(() => true);

type JournalOptions = {
  readonly ownerKeyHex: string;
  /** Rows already on the journal before this boot: an existing box's history. */
  readonly history?: readonly Patch[];
  /** A write to this path is refused, as a server that went away mid-boot refuses it. */
  readonly refusing?: AbsPath;
  /** The journal cannot be read at all. */
  readonly unreadable?: boolean;
  /** The journal answers this many reads, then stops answering: a server that goes
   *  away part way through the boot. */
  readonly readsAnswered?: number;
};

/** A player's workstation whose journal is held in memory: the real generated base
 *  tree with every accepted write replayed over it, read back the way the boot reads
 *  the server's copy. */
const journalBox = (options: JournalOptions) => {
  const base = buildWorkstationBaseFs(options.ownerKeyHex, {
    machineName: 'workstation',
    username: 'alice',
    rootPassword: ROOT_PASSWORD,
  });
  const journal: Patch[] = [...(options.history ?? [])];
  const accept = (patch: Patch): PatchResult => {
    if (patch.path === options.refusing) return { ok: false, error: 'network_error' };
    journal.push(patch);
    return { ok: true };
  };
  const patches: PatchApi = mockPatchApi({
    write: async (path, content, writeOptions) =>
      accept({
        path,
        content,
        owner: writeOptions?.owner ?? 'root',
        permissions: writeOptions?.permissions ?? defaultFilePermissions('root'),
      }),
    mkdir: async (path) =>
      accept({
        path,
        content: null,
        owner: 'root',
        permissions: defaultDirectoryPermissions('root'),
        nodeType: 'directory',
      }),
  });
  const tree = (): Directory => applyPatches(base, journal);
  let reads = 0;
  const answers = (): boolean => {
    reads += 1;
    return options.unreadable !== true && reads <= (options.readsAnswered ?? Infinity);
  };
  const box: FirstBootBox = {
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(options.ownerKeyHex) }),
    hostname: 'workstation',
    now: () => BIRTH,
    patches,
    readTree: async () => (answers() ? tree() : null),
  };
  return { box, base, tree, journal };
};

const fileAt = (tree: Directory, path: string) =>
  createFsView(tree, { userType: 'root' }).stat(asAbsPath(path));

const runningNames = (tree: Directory): readonly string[] =>
  readRunningProcesses(tree).flatMap((running) =>
    running.kind === 'service' ? [running.program] : [],
  );

describe("a workstation's first boot", () => {
  it('leaves each drawn service running on its default port, and nothing else', async () => {
    for (const key of ownersCoveringPool()) {
      const { box, tree } = journalBox({ ownerKeyHex: key });
      await runFirstBoot(box);
      const drawn = startingServices(key);
      expect([...runningNames(tree())].sort()).toEqual(
        drawn.map((service) => service.daemon.name).sort(),
      );
      for (const { daemon } of drawn) {
        expect(fileAt(tree(), programPidfilePath(daemon.name))).toMatchObject({
          content: formatProgramPidfileContent(daemon.name, daemon.spec.defaultPort),
        });
      }
    }
  });

  it('installs each drawn service at the newest release of its birth day', async () => {
    for (const key of ownersCoveringPool()) {
      const { box, tree } = journalBox({ ownerKeyHex: key });
      await runFirstBoot(box);
      const installed = parseDpkgVersions(readDpkgStatus(tree()));
      for (const { daemon, packageName } of startingServices(key)) {
        expect(installed.get(packageName)).toBe(newestReleaseOn(packageName, CLEAN_DAY));
        const binary =
          fileAt(tree(), `/usr/sbin/${daemon.name}`) ?? fileAt(tree(), `/sbin/${daemon.name}`);
        expect(binary?.kind).toBe('file');
      }
    }
  });

  it('is born clean: a scan that day finds every service versioned and with no live hole', async () => {
    for (const key of ownersCoveringPool()) {
      const { box, tree } = journalBox({ ownerKeyHex: key });
      await runFirstBoot(box);
      const ports = readOpenPorts(tree(), { gameDay: gameDayAt(BIRTH) });
      expect(ports).toHaveLength(startingServices(key).length);
      for (const port of ports) {
        expect(port.version).toBeDefined();
        expect(port.cve).toBeUndefined();
      }
    }
  });

  it('serves the web as apache2 alone when the box draws it, and scans as Apache', async () => {
    const key = ownerWhose((names) => names.includes('apache2'));
    const { box, tree } = journalBox({ ownerKeyHex: key });
    await runFirstBoot(box);
    const installed = parseDpkgVersions(readDpkgStatus(tree()));
    expect(installed.get('apache2')).toBe(newestReleaseOn('apache2', CLEAN_DAY));
    expect(installed.has('nginx')).toBe(false);
    expect(fileAt(tree(), '/usr/sbin/nginx')).toBeNull();
    expect(fileAt(tree(), programPidfilePath('nginx'))).toBeNull();
    const web = readOpenPorts(tree(), { gameDay: gameDayAt(BIRTH) }).find(
      (open) => open.port === 80,
    );
    expect(web).toMatchObject({ service: 'http', version: expect.stringMatching(/^Apache\//) });
    expect(web?.cve).toBeUndefined();
  });

  it('locks a born database and store with the root password the player chose', async () => {
    const key = ownerWhose((names) => names.includes('mysqld') && names.includes('redis-server'));
    const { box, tree } = journalBox({ ownerKeyHex: key });
    await runFirstBoot(box);
    expect(credentialIn(tree(), 'root')?.passwordHash).toBe(md5(ROOT_PASSWORD));
    expect(storeIn(tree())?.requirepassHash).toBe(md5(ROOT_PASSWORD));
  });

  it('leaves the base system libraries at the release the box shipped with', async () => {
    for (const key of ownersCoveringPool()) {
      const { box, base, tree } = journalBox({ ownerKeyHex: key });
      await runFirstBoot(box);
      const shipped = parseDpkgVersions(readDpkgStatus(base));
      const after = parseDpkgVersions(readDpkgStatus(tree()));
      for (const library of SYSTEM_LIBRARIES) {
        expect(after.get(library)).toBe(shipped.get(library));
      }
    }
  });

  it('marks the box born last of all, in a file root owns', async () => {
    const { box, journal } = journalBox({ ownerKeyHex: anyOwner() });
    await runFirstBoot(box);
    expect(journal.at(-1)).toMatchObject({ path: FIRST_BOOT_MARKER, owner: 'root' });
  });

  it('dates the marker with the moment the box was born', async () => {
    const { box, tree } = journalBox({ ownerKeyHex: anyOwner() });
    await runFirstBoot(box);
    const marker = fileAt(tree(), FIRST_BOOT_MARKER);
    expect(marker?.kind === 'file' ? marker.content : '').toContain(new Date(BIRTH).toUTCString());
  });

  it('leaves the box unborn when an install is refused', async () => {
    const key = ownerWhose((names) => names.includes('nginx'));
    const { box, tree } = journalBox({
      ownerKeyHex: key,
      refusing: asAbsPath('/var/lib/dpkg/status'),
    });
    await runFirstBoot(box);
    expect(fileAt(tree(), FIRST_BOOT_MARKER)).toBeNull();
  });

  it('leaves the box unborn when the journal stops answering part way through', async () => {
    const key = ownerWhose((names) => names.length >= 2);
    const { box, tree } = journalBox({ ownerKeyHex: key, readsAnswered: 1 });
    await expect(runFirstBoot(box)).resolves.toBeUndefined();
    expect(fileAt(tree(), FIRST_BOOT_MARKER)).toBeNull();
  });

  it('keeps the database an older box already holds', async () => {
    const key = ownerWhose((names) => names.includes('mysqld'));
    const theirs: Patch = {
      path: MYSQL_DATADIR_PATH,
      content: '{"theirs":true}',
      owner: 'root',
      permissions: DATADIR_FILE,
    };
    const { box, tree } = journalBox({ ownerKeyHex: key, history: [theirs] });
    await runFirstBoot(box);
    expect(fileAt(tree(), MYSQL_DATADIR_PATH)).toMatchObject({ content: '{"theirs":true}' });
  });

  it('leaves the box unborn when a write is refused, and the next boot finishes it', async () => {
    const key = ownerWhose((names) => names.length === 3);
    const lastService = startingServices(key).at(-1);
    if (lastService === undefined) throw new Error('drew nothing');
    const failed = journalBox({ ownerKeyHex: key, refusing: programPidfilePath(lastService.daemon.name) });
    await runFirstBoot(failed.box);
    expect(fileAt(failed.tree(), FIRST_BOOT_MARKER)).toBeNull();
    expect(runningNames(failed.tree())).toHaveLength(2);

    const retried = journalBox({ ownerKeyHex: key, history: failed.journal });
    await runFirstBoot(retried.box);
    expect(fileAt(retried.tree(), FIRST_BOOT_MARKER)).not.toBeNull();
    expect(runningNames(retried.tree())).toHaveLength(3);
  });

  it('writes nothing on a box that was already born', async () => {
    const key = anyOwner();
    const first = journalBox({ ownerKeyHex: key });
    await runFirstBoot(first.box);
    const again = journalBox({ ownerKeyHex: key, history: first.journal });
    await runFirstBoot(again.box);
    expect(again.journal).toHaveLength(first.journal.length);
  });

  it('keeps a service the owner stopped stopped', async () => {
    const key = ownerWhose((names) => names.includes('sshd'));
    const first = journalBox({ ownerKeyHex: key });
    await runFirstBoot(first.box);
    const stopped: Patch = { path: '/var/run/sshd.pid', content: null, owner: 'root' };
    const again = journalBox({ ownerKeyHex: key, history: [...first.journal, stopped] });
    await runFirstBoot(again.box);
    expect(runningNames(again.tree())).not.toContain('sshd');
  });

  it.each([
    ['sshd', 2222],
    ['apache2', 8080],
  ])('keeps the port of a %s an older box was already running', async (program, port) => {
    const key = ownerWhose((names) => names.includes(program));
    const running: Patch = {
      path: programPidfilePath(program),
      content: formatProgramPidfileContent(program, port),
      owner: 'root',
    };
    const { box, tree } = journalBox({ ownerKeyHex: key, history: [running] });
    await runFirstBoot(box);
    expect(fileAt(tree(), programPidfilePath(program))).toMatchObject({
      content: formatProgramPidfileContent(program, port),
    });
    expect(fileAt(tree(), FIRST_BOOT_MARKER)).not.toBeNull();
  });

  it.each([
    ['apache2', 'nginx'],
    ['nginx', 'apache2'],
  ])(
    'starts no %s beside the %s an older box already serves the web with',
    async (drawn, alreadyUp) => {
      // The web is one service on one port: whichever program the owner already runs
      // is the box's web server, and starting the drawn one too would put two on it.
      const key = ownerWhose((names) => names.includes(drawn));
      const running: Patch = {
        path: programPidfilePath(alreadyUp),
        content: formatProgramPidfileContent(alreadyUp, 8080),
        owner: 'root',
      };
      const { box, tree } = journalBox({ ownerKeyHex: key, history: [running] });
      await runFirstBoot(box);
      expect(fileAt(tree(), programPidfilePath(drawn))).toBeNull();
      expect(fileAt(tree(), programPidfilePath(alreadyUp))).toMatchObject({
        content: formatProgramPidfileContent(alreadyUp, 8080),
      });
      expect(fileAt(tree(), FIRST_BOOT_MARKER)).not.toBeNull();
    },
  );

  it('writes nothing when the journal cannot be read, so a born box is never taken for a new one', async () => {
    const { box, journal } = journalBox({ ownerKeyHex: anyOwner(), unreadable: true });
    await runFirstBoot(box);
    expect(journal).toHaveLength(0);
  });

  it('writes nothing on a box that cannot boot', async () => {
    const bricked: Patch = { path: '/boot/vmlinuz', content: null, owner: 'root' };
    const { box, journal } = journalBox({ ownerKeyHex: anyOwner(), history: [bricked] });
    await runFirstBoot(box);
    expect(journal).toEqual([bricked]);
  });
});
