import { describe, expect, it, vi } from 'vitest';
import { msfconsole } from './msfconsole';
import {
  mockCommandEnv,
  mockExploitApi,
  mockFsViewFromTree,
  mockNetworkViewFromConnectivity,
  mockScanApi,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { buildColdStartConnectivity } from '../network/interfaces';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { buildCommandContext } from '../scripting/commandContext';
import {
  asAbsPath,
  asEpochMs,
  asMachineId,
  asNetworkAddress,
  asPlayerKeyHex,
  type UserType,
} from '../types';
import { computeWorkstationId } from '../identity/workstation';
import { WORLD_EPOCH } from '../cve/worldClock';
import { localExploitOutcome } from '../cve/localExploit';
import { packageTimeline } from '../cve/packageTimeline';
import type { ExploitEffectKind } from '../cve/exploitEffect';
import { buildEntry, formatDpkgStatus } from '../packages/dpkgStatus';
import type { SystemLibrary } from '../generation/libraries';
import type { OccupantProjection } from '../network/resolveOccupants';
import type {
  CommandResult,
  ExploitRunParams,
  ExploitRunResult,
  FsView,
  ScanApi,
  Session,
  SessionKind,
} from './types';
import type { MachineId } from '../types';
import type { ConnectivityState, NetworkInterface } from '../network/interfaces';

/**
 * `msfconsole` decides NOTHING about what a fired CVE opens — the server does, from
 * its own clock and the target's own manifest. So these tests are about what the
 * player is TOLD and where they are LEFT standing.
 *
 * The load-bearing one is the pair of refusals: a service with no live CVE and a
 * port with nothing behind it must read identically, because a bounce that told an
 * attacker WHICH of those it was would turn a failed exploit into a free scan.
 */

const OWNER_KEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const PORT = 22;
const NO_FLAGS = new Map<string, string | true>();

const LAN = generateHomeLan(ESSID);

/** A host off the LAN this ESSID generates — read out of the world rather than
 *  guessed, so the address the command resolves is one the server would resolve too. */
const hostWhere = (predicate: (host: LanHost) => boolean): LanHost => {
  const host = LAN.hosts.find(predicate);
  if (host === undefined) throw new Error('no matching host on the generated LAN');
  return host;
};

const TARGET = hostWhere((host) => host.kind === 'machine');
const TARGET_MACHINE_ID = resolveLanHostIdentity(TARGET, ESSID).machineId;

/** An address on the RIGHT network that no host answers to — a plausible typo rather
 *  than an invalid string, and derived from the generated population so no reseeding
 *  can quietly turn it into a real box. */
const vacantAddress = (): string => {
  const taken = new Set(LAN.hosts.map((host) => host.ip));
  for (let octet = 254; octet >= 2; octet -= 1) {
    const candidate = `${LAN.subnet}.${octet}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('the generated LAN has no vacant address');
};

const VACANT_IP = vacantAddress();

/** A SECOND address nobody answers to. Needed because a fixture that stands an occupant
 *  at the very address it fires at cannot tell "somebody is at THIS address" from
 *  "somebody is on this WiFi at all" — the two answer identically until the occupant and
 *  the target are different places. */
const otherVacantAddress = (): string => {
  const taken = new Set([...LAN.hosts.map((host) => host.ip), VACANT_IP]);
  for (let octet = 254; octet >= 2; octet -= 1) {
    const candidate = `${LAN.subnet}.${octet}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('the generated LAN has no second vacant address');
};

const OTHER_VACANT_IP = otherVacantAddress();

const SOURCE_IP = `${LAN.subnet}.50`;

/** Somebody else's access point, reached across the internet. TEST-NET-3, so the address
 *  is unmistakably off this LAN — and unmistakably not something the client can generate
 *  a host list for. */
const PUBLIC_IP = '203.0.113.9';

/** A fellow occupant's own machine, which only the registry knows about: a player's box
 *  is on nobody's generated LAN, so its id cannot be derived from the address the way a
 *  seeded sibling's can. */
const OCCUPANT_MACHINE_ID = 'ws-occupant-cafef00d';

/** The box behind somebody's forward. Deliberately unlike anything this side could
 *  compute from a TEST-NET-3 address, so a session landing on it proves the id came back
 *  from the server rather than out of a local derivation. */
const FORWARDED_MACHINE_ID = 'ws-behind-the-forward-d00dfeed';

/** A fellow occupant of this ESSID, as the signed occupant read hands them back. */
const occupantAt = (localIp: string): OccupantProjection => ({
  workstation_machine_id: OCCUPANT_MACHINE_ID,
  localIp: asNetworkAddress(localIp),
  machineName: 'alice-rig',
});

/** A workstation associated with an AP and holding a lease — there is no target to
 *  name until the box the tool runs from is on a network. */
const connectedState = (): ConnectivityState => {
  const cold = buildColdStartConnectivity(OWNER_KEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
  const connected: NetworkInterface = {
    ...wlan0,
    association: { essid: ESSID, bssid: 'AA:BB:CC:DD:EE:FF' },
    ipv4: SOURCE_IP,
  };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

const GRANTED_FULL: ExploitRunResult = {
  ok: true,
  cve: 'CVE-2026-0184',
  severity: 'critical',
  username: 'root',
  userType: 'root',
  kind: 'exploit',
  machineId: TARGET_MACHINE_ID,
};

/** The weaker of the two grants — a room to search rather than a door to pivot onward
 *  from. Its tier follows the severity the way the server's own table does, so the
 *  fixture cannot drift into a pairing the world would never actually produce. */
const GRANTED_LIMITED: ExploitRunResult = {
  ok: true,
  cve: 'CVE-2026-0185',
  severity: 'medium',
  username: 'guest',
  userType: 'guest',
  kind: 'exploit_limited',
  machineId: TARGET_MACHINE_ID,
};

/** What the attacker's own box holds for a write's local half to name. */
const LOCAL_LOOT = 'the combination is 12-24-36\n';

/** The box the tool is RUN FROM, holding one readable file. A write reads its local half
 *  here before firing, so a test that left this empty would be refused pre-flight and
 *  never reach the server at all. */
/** A script on the attacker's own box, for the hole that runs one. Its third token is a
 *  BARE path like a read's, but it names a file on THIS machine rather than on the
 *  target — which is the whole reason the tool reads it blind before firing. */
const LOCAL_SCRIPT = "await fs.writeFile('/tmp/dropped.txt', 'planted')\n";

/** A script that does something and THEN fails. The half before the throw really happened
 *  on the target, so what it wrote has to travel even though the run did not finish —
 *  there is no unwinding a side effect that already landed. */
const BROKEN_SCRIPT = "await fs.writeFile('/tmp/first.txt', 'one')\nthrow new Error('boom')\n";

/** A script that reaches for a COMMAND. Nothing puts one in scope here, so this is what
 *  the refusal looks like from the inside: an ordinary reference error, because the name
 *  was never injected rather than because something intercepted it. */
const REACHING_SCRIPT = "await nmap('10.0.0.1')\n";

/** A script that READS the target before deciding what to leave on it. The read comes off
 *  the box's own regenerated tree, not off the attacker's — which is the whole point of
 *  running against a target-scoped filesystem rather than this machine's. */
const READING_SCRIPT =
  "const passwd = await fs.readFile('/etc/passwd')\n" +
  "await fs.writeFile('/tmp/stolen.txt', passwd)\n";

/** A script that APPENDS twice, the second time onto its own first line. An append reads
 *  what is there before adding to it, and what is 'there' has to include the script's own
 *  earlier work — otherwise the second append would reach past it to the generated file. */
const APPENDING_SCRIPT =
  "await fs.appendFile('/tmp/notes.txt', 'one\\n')\n" +
  "await fs.appendFile('/tmp/notes.txt', 'two\\n')\n";

/** A script that reads a path the target does not have. The throw is the box's answer, so
 *  it is worded without this tool's name in front of it. */
const MISSING_READ_SCRIPT = "await fs.readFile('/nowhere/at/all')\n";

/** A script naming a RELATIVE path. The target filesystem it is handed stands at the root,
 *  so this lands at `/notes.txt` — the only thing that makes the view's own cwd observable
 *  at all, every other fixture here naming absolute paths. */
const RELATIVE_SCRIPT = "await fs.writeFile('notes.txt', 'relative\\n')\n";

/** A write and then TWO appends to the same path. The second append has two earlier
 *  versions of that file to choose between, and only the LATEST is the one the script
 *  actually made — picking the earlier would silently drop the middle line. One append
 *  cannot show this, because then there is only ever one to find. */
const REAPPENDING_SCRIPT =
  "await fs.writeFile('/tmp/log.txt', 'first\\n')\n" +
  "await fs.appendFile('/tmp/log.txt', 'second\\n')\n" +
  "await fs.appendFile('/tmp/log.txt', 'third\\n')\n";

const attackerBox = (): FsView =>
  mockFsViewFromTree(
    buildDirectory({
      home: buildDirectory({
        attacker: buildDirectory(
          {
            'loot.txt': buildFile(LOCAL_LOOT, { owner: 'attacker' }),
            'drop.js': buildFile(LOCAL_SCRIPT, { owner: 'attacker' }),
            'broken.js': buildFile(BROKEN_SCRIPT, { owner: 'attacker' }),
            'reach.js': buildFile(REACHING_SCRIPT, { owner: 'attacker' }),
            'read.js': buildFile(READING_SCRIPT, { owner: 'attacker' }),
            'append.js': buildFile(APPENDING_SCRIPT, { owner: 'attacker' }),
            // NOT `missing.js`: a sibling test needs `/home/attacker/missing.js` to be a
            // path this box genuinely does not have, and a fixture answering to that name
            // would quietly turn its local miss into a successful read.
            'readmiss.js': buildFile(MISSING_READ_SCRIPT, { owner: 'attacker' }),
            'relative.js': buildFile(RELATIVE_SCRIPT, { owner: 'attacker' }),
            'reappend.js': buildFile(REAPPENDING_SCRIPT, { owner: 'attacker' }),
          },
          { owner: 'attacker' },
        ),
      }),
    }),
    { userType: 'user' },
  );

const WRITE_PAIR = '/home/attacker/loot.txt:/tmp/loot.txt';
const SCRIPT_PATH = '/home/attacker/drop.js';
const BROKEN_SCRIPT_PATH = '/home/attacker/broken.js';
const REACHING_SCRIPT_PATH = '/home/attacker/reach.js';

type EnvOpts = {
  readonly result?: ExploitRunResult;
  readonly connectivity?: ConnectivityState;
  /** The box the tool is RUN FROM. Only a write effect reads it — its `local:remote`
   *  names a file here, and the server has no way to see it. */
  readonly fs?: FsView;
  /** The scan seam, for the two vantages that are NOT on the generated LAN: a public
   *  address belonging to somebody else's access point, and a fellow occupant standing
   *  at an octet the generator never filled. Defaults leave the own-LAN tests alone —
   *  no occupants, so every existing target still resolves exactly as it did. */
  readonly scan?: Partial<ScanApi>;
};

const exploitEnv = (opts: EnvOpts = {}) => {
  const run = vi.fn<(params: ExploitRunParams) => Promise<ExploitRunResult>>(
    async () => opts.result ?? GRANTED_FULL,
  );
  const pushed: Session[] = [];
  const cwds: string[] = [];
  const prompt = vi.fn(async () => '');
  const env = mockCommandEnv({
    identity: { publicKeyHex: asPlayerKeyHex(OWNER_KEY), privateKeyHex: 'b'.repeat(64) },
    session: mockSession(),
    network: mockNetworkViewFromConnectivity(opts.connectivity ?? connectedState()),
    exploit: mockExploitApi({ run }),
    scan: mockScanApi(opts.scan ?? {}),
    ...(opts.fs === undefined ? {} : { fs: opts.fs }),
    pushSession: (session) => void pushed.push(session),
    setCwd: (path) => void cwds.push(path),
    prompt,
  });
  return { env, run, pushed, cwds, prompt };
};

const drain = async (
  result: CommandResult,
): Promise<{ readonly text: string; readonly exitCode: number }> => {
  if (result.kind !== 'async') throw new Error('async expected');
  const lines: string[] = [];
  for await (const line of result.lines) lines.push(line.content);
  return { text: lines.join('\n'), exitCode: await result.exitCode() };
};

const syncText = (result: CommandResult): string => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return result.lines.map((line) => line.content).join('\n');
};

const syncExit = (result: CommandResult): number => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return result.exitCode;
};

/** `msfconsole` reached the way a SCRIPT reaches it, through the adapter rather than
 *  through `execute` directly. The adapter is what marks the run as scripted, so a test
 *  that called `execute` itself would prove nothing about scripted behaviour.
 *
 *  `emitted` collects what a call does NOT hand back — stderr and the dim asides. A
 *  script's stdout is the return value alone, and keeping the two apart here is what lets
 *  a test say which side of that line a sentence landed on. */
const scriptedRun = (opts: EnvOpts = {}) => {
  const { env, run, pushed, cwds } = exploitEnv(opts);
  const emitted: string[] = [];
  const context = buildCommandContext(env, new Map([[msfconsole.name, msfconsole]]), (line) =>
    emitted.push(line.content),
  );
  return { fire: context.msfconsole, run, pushed, cwds, emitted };
};

describe('msfconsole', () => {
  it('names the CVE it fired and hands over a full shell as the account the server chose', async () => {
    const { env, pushed, cwds } = exploitEnv();

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain(`[*] Targeting ${TARGET.ip}:${PORT}`);
    expect(text).toContain('[*] Sending exploit payload...');
    // The line that stands while the round trip is in flight — the only thing on screen
    // during the wait, so its absence reads as a tool that hung.
    expect(text).toContain('[*] Payload delivered, waiting for callback...');
    expect(text).toContain('[*] Vulnerability: CVE-2026-0184 (critical)');
    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain(`[+] Full shell as root@${TARGET.ip}`);
    expect(exitCode).toBe(0);
    expect(pushed).toEqual([
      expect.objectContaining({
        machineId: TARGET_MACHINE_ID,
        username: 'root',
        userType: 'root',
        kind: 'exploit',
      }),
    ]);
    expect(cwds).toEqual(['/root']);
  });

  it('hands over the weaker shell when that is all the effect granted', async () => {
    const { env, pushed, cwds } = exploitEnv({
      result: {
        ok: true,
        cve: 'CVE-2026-0912',
        severity: 'medium',
        username: 'guest',
        userType: 'guest',
        kind: 'exploit_limited',
        machineId: TARGET_MACHINE_ID,
      },
    });

    const { text } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    // A different sentence for a different door: "Got shell" is what `nc` earns, and
    // a player who reads "Full shell" and then cannot `ssh` onward has been lied to.
    expect(text).toContain(`[+] Got shell as guest@${TARGET.ip}`);
    expect(text).not.toContain('Full shell');
    expect(pushed).toEqual([expect.objectContaining({ kind: 'exploit_limited' })]);
    expect(cwds).toEqual(['/home/guest']);
  });

  it('reads the file it is pointed at and prints its contents, standing the player nowhere', async () => {
    // A read effect is not a foothold: it hands back the bytes and leaves the player
    // where they were, so nothing is pushed and the cwd never moves.
    const { env, pushed, cwds } = exploitEnv({
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        read: { ok: true, content: 'root:x:0:0:root:/root:/bin/bash\nsvc:x:1000:1000::/home/svc:/bin/sh' },
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), '/etc/passwd'], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0184 (high)');
    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain('[+] Reading /etc/passwd (as user):');
    expect(text).toContain('root:x:0:0:root:/root:/bin/bash');
    expect(text).toContain('svc:x:1000:1000::/home/svc:/bin/sh');
    expect(exitCode).toBe(0);
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  it('reports permission denied for a path the granted tier cannot read, opening nothing', async () => {
    const { env, pushed } = exploitEnv({
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'medium',
        tier: 'guest',
        read: { ok: false, error: 'permission_denied' },
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), '/etc/shadow'], NO_FLAGS),
    );

    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain('[-] Permission denied (as guest): /etc/shadow');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('asks for a path when a read exploit is fired without one, and reads nothing', async () => {
    // The scan never says a CVE reads rather than lands a shell, so firing bare is how
    // the player learns it. It names the hole and asks for a target — but claims no
    // success, because nothing was read.
    const { env, pushed } = exploitEnv({
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        needsArg: true,
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0184 (high)');
    // Named after the kind of hole it is, not a generic "needs an argument": a read hole
    // and a list hole ask for the same third token but are different doors.
    expect(text).toContain('reads a file');
    expect(text).toContain('msfconsole <host> <port> <path>');
    expect(text).not.toContain('[+] Exploit successful!');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('names the file failure in the tool\'s own words, not the filesystem\'s code', async () => {
    // The deny map earns its keep only if each failure reads as its own sentence — a
    // missing file and a directory-where-a-file-was-asked-for are different mistakes.
    const notFound = exploitEnv({
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        read: { ok: false, error: 'not_found' },
      },
    });
    const isDir = exploitEnv({
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        read: { ok: false, error: 'is_directory' },
      },
    });

    const missing = await drain(
      await msfconsole.execute(notFound.env, [TARGET.ip, String(PORT), '/nope'], NO_FLAGS),
    );
    const dir = await drain(
      await msfconsole.execute(isDir.env, [TARGET.ip, String(PORT), '/etc'], NO_FLAGS),
    );

    expect(missing.text).toContain('[-] No such file (as user): /nope');
    expect(dir.text).toContain('[-] That is a directory, not a file (as user): /etc');
  });

  it('names the directory failure in the tool\'s own words, distinct from a file\'s', async () => {
    const notFound = exploitEnv({
      result: {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        list: { ok: false, error: 'not_found' },
      },
    });
    const notDir = exploitEnv({
      result: {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        list: { ok: false, error: 'not_a_directory' },
      },
    });

    const missing = await drain(
      await msfconsole.execute(notFound.env, [TARGET.ip, String(PORT), '/nope'], NO_FLAGS),
    );
    const file = await drain(
      await msfconsole.execute(notDir.env, [TARGET.ip, String(PORT), '/etc/passwd'], NO_FLAGS),
    );

    // A missing directory is not "No such file", and a file named where a directory was
    // expected is its own message — the list side keeps its own vocabulary.
    expect(missing.text).toContain('[-] No such directory (as user): /nope');
    expect(file.text).toContain('[-] That is a file, not a directory (as user): /etc/passwd');
  });

  it('reads the local half of the pair off its own box and sends the bytes', async () => {
    // The server holds no client filesystem, so the bytes have to travel. The local half
    // names a file HERE and is read through the same tier-scoped view `cat` reads; only
    // the remote half means anything to the target, and it is forwarded untouched.
    const { env, run } = exploitEnv({ fs: attackerBox() });

    await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT), WRITE_PAIR], NO_FLAGS));

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ arg: WRITE_PAIR, content: LOCAL_LOOT }),
    );
  });

  it('names the bytes it planted and where, standing the player nowhere', async () => {
    // A write is not a foothold: something of the attacker's is on the box, but nobody is
    // — so nothing is pushed and the cwd never moves, exactly as a read leaves them.
    //
    // The PATH is read off the answer rather than split back out of what was typed. The
    // box is the side that resolved it, so it is the only side that knows where the bytes
    // actually landed; echoing the typed half would report a destination the write may
    // have normalized away from.
    const { env, pushed, cwds } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'file_write',
        cve: 'CVE-2026-0712758',
        severity: 'medium',
        tier: 'guest',
        write: { ok: true, bytes: 27, path: '/tmp/loot.txt' },
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), WRITE_PAIR], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0712758 (medium)');
    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain('[+] Wrote 27 bytes to /tmp/loot.txt (as guest)');
    expect(exitCode).toBe(0);
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  it('names a write the granted tier could not land, and opens nothing', async () => {
    // The remote path is read off the ANSWER rather than the typed token — a deny that
    // echoed `local:remote` back would point the player at a file on their own box.
    const { env, pushed } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'file_write',
        cve: 'CVE-2026-0712758',
        severity: 'medium',
        tier: 'guest',
        write: { ok: false, error: 'permission_denied', path: '/etc/passwd' },
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(
        env,
        [TARGET.ip, String(PORT), '/home/attacker/loot.txt:/etc/passwd'],
        NO_FLAGS,
      ),
    );

    // The break-in still succeeded — the hole opened, and only the file refused. Saying
    // otherwise would read as a patched daemon and send the player hunting a version.
    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain('[-] Permission denied (as guest): /etc/passwd');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('asks for a pair when a write exploit is fired without one, planting nothing', async () => {
    // Reveal-by-firing, as the reads do — but a write asks for a PAIR where they ask for
    // a path, so a player who fired blind is told which kind of door they actually hit.
    const { env, pushed } = exploitEnv({
      result: {
        ok: true,
        effect: 'file_write',
        cve: 'CVE-2026-0712758',
        severity: 'medium',
        tier: 'guest',
        needsArg: true,
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0712758 (medium)');
    expect(text).toContain('writes a file');
    expect(text).toContain('msfconsole <host> <port> <local:remote>');
    // Nothing was planted, so it must not claim the success a landed write would.
    expect(text).not.toContain('[+] Exploit successful!');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('reports that a script ran, standing the player nowhere', async () => {
    // Blind by design: the script's own output was never captured anywhere, so the only
    // thing there is to say is that it ran and at what privilege. Nothing is pushed and
    // the cwd holds — the bargain every effect that opens no shell already strikes.
    const { env, pushed, cwds } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'script_exec',
        cve: 'CVE-2026-0269486',
        severity: 'high',
        tier: 'user',
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), SCRIPT_PATH], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0269486 (high)');
    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain(`[+] Script injected on ${TARGET.ip} as user`);
    expect(exitCode).toBe(0);
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  it('runs the named script against the target and sends what it wrote', async () => {
    // The whole of the effect. The script runs HERE, over the target's own regenerated
    // tree, and what travels is the writes it made rather than the source that made them
    // — running it on the far side would mean building a function over player-supplied
    // text inside the server, which is the one shape this effect may never take.
    const { env, run } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'script_exec',
        cve: 'CVE-2026-0269486',
        severity: 'high',
        tier: 'user',
      },
    });

    await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT), SCRIPT_PATH], NO_FLAGS));

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        arg: SCRIPT_PATH,
        writes: [{ path: '/tmp/dropped.txt', content: 'planted' }],
      }),
    );
  });

  it('keeps what a failing script already wrote, and says why it stopped', async () => {
    // A side effect that has already landed cannot be unwound, and the box would not
    // unwind it either: the script really did write that file before it threw. So the
    // write travels, the break-in stands, and the player is told where it stopped rather
    // than being left to believe the whole run took.
    const { env, run } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'script_exec',
        cve: 'CVE-2026-0269486',
        severity: 'high',
        tier: 'user',
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), BROKEN_SCRIPT_PATH], NO_FLAGS),
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ writes: [{ path: '/tmp/first.txt', content: 'one' }] }),
    );
    expect(text).toContain('Script injection failed: Error: boom');
    expect(exitCode).toBe(1);
  });

  it('lets the script read the TARGET rather than the box it was launched from', async () => {
    // The filesystem the script is handed is the target's, regenerated — so a read comes
    // back with that box's file and not with the attacker's own. Proving it needs a path
    // that exists on both: `/etc/passwd` is on every box in the world, and the two differ.
    const { env, run } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'script_exec',
        cve: 'CVE-2026-0269486',
        severity: 'high',
        tier: 'user',
      },
    });
    const targetPasswd = mockFsViewFromTree(resolveLanHostIdentity(TARGET, ESSID).baseFs, {
      userType: 'user',
    }).read(asAbsPath('/etc/passwd'));
    if (!targetPasswd.ok) throw new Error('expected the target to hold a readable passwd');

    await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), '/home/attacker/read.js'], NO_FLAGS),
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        writes: [{ path: '/tmp/stolen.txt', content: targetPasswd.content }],
      }),
    );
  });

  it('appends onto what the script itself already wrote, not past it', async () => {
    // An append is a read-modify-write, and the read has to see the script's own earlier
    // work. Reaching past it to the generated file would silently drop every line but the
    // last, which is exactly the shape a sweep writing one line per host would take.
    const { env, run } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'script_exec',
        cve: 'CVE-2026-0269486',
        severity: 'high',
        tier: 'user',
      },
    });

    await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), '/home/attacker/append.js'], NO_FLAGS),
    );

    const sent = run.mock.calls[0]?.[0].writes;
    // Both appends travel. The server replays them in order, so the LAST one is what the
    // box ends up holding — and it has to carry both lines.
    expect(sent?.at(-1)).toEqual({ path: '/tmp/notes.txt', content: 'one\ntwo\n' });
  });

  it('resolves a relative path against the target’s root, not this box’s cwd', async () => {
    // The filesystem handed to the script stands at the target's root, so a bare name lands
    // beside it. Resolving against the ATTACKER's working directory instead would send the
    // write somewhere on the target that mirrors a directory only this machine has.
    const { env, run } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'script_exec',
        cve: 'CVE-2026-0269486',
        severity: 'high',
        tier: 'user',
      },
    });

    await drain(
      await msfconsole.execute(
        env,
        [TARGET.ip, String(PORT), '/home/attacker/relative.js'],
        NO_FLAGS,
      ),
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ writes: [{ path: '/notes.txt', content: 'relative\n' }] }),
    );
  });

  it('appends onto the script’s latest version of a file, not its first', async () => {
    // Two earlier versions exist by the time the last append runs, and only the newest is
    // what the script actually has on the box. Reaching for the older one would drop the
    // line between them — the failure a sweep adding one line per host would show as
    // silently losing all but the first and last.
    const { env, run } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'script_exec',
        cve: 'CVE-2026-0269486',
        severity: 'high',
        tier: 'user',
      },
    });

    await drain(
      await msfconsole.execute(
        env,
        [TARGET.ip, String(PORT), '/home/attacker/reappend.js'],
        NO_FLAGS,
      ),
    );

    // The server replays in order, so the LAST write is what the box ends up holding.
    expect(run.mock.calls[0]?.[0].writes?.at(-1)).toEqual({
      path: '/tmp/log.txt',
      content: 'first\nsecond\nthird\n',
    });
  });

  it('reports a read the target refused in the box’s own words, not this tool’s', async () => {
    // The script is running over there, so a miss is the target's answer. Wearing
    // `msfconsole:` or `node:` in front of it would name a machine that had nothing to do
    // with the failure.
    const { env } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'script_exec',
        cve: 'CVE-2026-0269486',
        severity: 'high',
        tier: 'user',
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(
        env,
        [TARGET.ip, String(PORT), '/home/attacker/readmiss.js'],
        NO_FLAGS,
      ),
    );

    expect(text).toContain('Script injection failed: Error: /nowhere/at/all: No such file or directory');
    expect(text).not.toContain('msfconsole: /nowhere/at/all');
    expect(text).not.toContain('node:');
    expect(exitCode).toBe(1);
  });

  it('asks for a path in the read hole’s own words even when a local read failed', async () => {
    // The local miss only becomes news once the box says the hole RUNS something. A read
    // hole that asked for a target must still ask for one, or a player who mistyped a
    // remote path would be told about a file on their own disk instead.
    const { env, pushed } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'critical',
        tier: 'root',
        needsArg: true,
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), '/etc/shadow'], NO_FLAGS),
    );

    expect(text).toContain('reads a file');
    expect(text).not.toContain('No such file or directory');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('hands the script a filesystem and nothing else to reach the world with', async () => {
    // The script is running against somebody else's box, so the only thing it may touch is
    // that box's files. No command is in scope: a script that could call `nmap` from inside
    // an exploit would be scanning from a machine the player never stood on, and the
    // target's log would name a source that was never there.
    const { env, run } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'script_exec',
        cve: 'CVE-2026-0269486',
        severity: 'high',
        tier: 'user',
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), REACHING_SCRIPT_PATH], NO_FLAGS),
    );

    expect(text).toContain('Script injection failed: ReferenceError');
    expect(text).toContain('nmap');
    expect(exitCode).toBe(1);
    // It still FIRED, and still wrote nothing: the hole opened, and the script that came
    // through it failed on its own first line.
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ writes: [] }));
  });

  it('asks for a script when the hole was fired with no third token at all', async () => {
    // Reveal-by-firing, as every argument-taking hole answers it: the scan never said this
    // CVE runs something, so the bare fire is how the player finds out and is asked.
    const { env, pushed } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'script_exec',
        cve: 'CVE-2026-0269486',
        severity: 'high',
        tier: 'user',
        needsArg: true,
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain('runs a script');
    expect(text).toContain('msfconsole <host> <port> <path>');
    // Nothing ran, so it must not claim the success a fired script would.
    expect(text).not.toContain('[+] Exploit successful!');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('says why it could not read the script, rather than asking for one already named', async () => {
    // The server knows only that it was handed nothing to run, so it asks for a script.
    // THIS box knows better: a path was named and this shell could not read it. Printing
    // the server's ask here would tell somebody who typed a path that they had typed none
    // — and send them looking at the target for a mistake on their own machine.
    const { env, pushed } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'script_exec',
        cve: 'CVE-2026-0269486',
        severity: 'high',
        tier: 'user',
        needsArg: true,
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(
        env,
        [TARGET.ip, String(PORT), '/home/attacker/missing.js'],
        NO_FLAGS,
      ),
    );

    expect(text).toContain('/home/attacker/missing.js');
    expect(text).toContain('No such file or directory');
    expect(text).not.toContain('name one');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('fires anyway when a bare path is not readable here, since it may name the target', async () => {
    // A bare token is a REMOTE path for the read holes and a LOCAL one for this hole, and
    // the client cannot tell which it is holding until the server answers. So an
    // unreadable local path must not refuse the fire the way a `local:remote` pair does —
    // every blind read aimed at a file this box happens not to have would stop before
    // reaching the network.
    const { env, run } = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'file_read',
        cve: 'CVE-2026-0184',
        severity: 'critical',
        tier: 'root',
        read: { ok: true, content: 'root:x:0:0\n' },
      },
    });

    await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT), '/etc/passwd'], NO_FLAGS));

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ arg: '/etc/passwd' }));
  });

  it('refuses before firing when the local half names a file it cannot read', async () => {
    // The bytes can only come from this box, so a pair whose local half is not here aims
    // at nothing. Refusing BEFORE the round trip is what keeps it off the target's log:
    // nothing reached the daemon, so its owner is owed no line about it — the same rule
    // the server already follows for a read fired with no path.
    const { env, run, pushed } = exploitEnv();

    const result = await msfconsole.execute(
      env,
      [TARGET.ip, String(PORT), '/home/attacker/missing.txt:/tmp/loot.txt'],
      NO_FLAGS,
    );

    // The file it names is the LOCAL one. A player told the remote path was missing would
    // go hunting on the wrong box entirely.
    expect(syncText(result)).toBe(
      'msfconsole: /home/attacker/missing.txt: No such file or directory',
    );
    expect(run).not.toHaveBeenCalled();
    expect(pushed).toEqual([]);
  });

  it('treats a token with only one half as a plain path, reading nothing off this box', async () => {
    // `local:remote` needs BOTH halves. A leading colon names no local file and a trailing
    // one names no destination, so neither is a pair: each is forwarded exactly as typed and
    // nothing here is read. Get either boundary wrong and the tool reads `/` — or the whole
    // token — and refuses a fire that should have gone out.
    for (const token of [':/tmp/loot.txt', '/home/attacker/loot.txt:']) {
      const { env, run } = exploitEnv({ fs: attackerBox() });

      await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT), token], NO_FLAGS));

      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ arg: token, content: undefined }),
      );
    }
  });

  it('names a local half it cannot read in the tool’s own words, and fires nothing', async () => {
    // A failure on the attacker's OWN box, which is a different thing from the target
    // refusing — so it reads as `cat` reads, under this tool's prefix, and never as one of
    // the remote deny lines.
    const secret = exploitEnv({
      fs: mockFsViewFromTree(
        buildDirectory({
          root: buildDirectory({ 'key.txt': buildFile('sekrit\n', { owner: 'root' }) }, {
            owner: 'root',
          }),
        }),
        { userType: 'user' },
      ),
    });
    const directory = exploitEnv({ fs: attackerBox() });

    const denied = await msfconsole.execute(
      secret.env,
      [TARGET.ip, String(PORT), '/root/key.txt:/tmp/loot.txt'],
      NO_FLAGS,
    );
    const isDir = await msfconsole.execute(
      directory.env,
      [TARGET.ip, String(PORT), '/home/attacker:/tmp/loot.txt'],
      NO_FLAGS,
    );

    expect(syncText(denied)).toBe('msfconsole: /root/key.txt: Permission denied');
    expect(syncText(isDir)).toBe('msfconsole: /home/attacker: Is a directory');
    expect(secret.run).not.toHaveBeenCalled();
    expect(directory.run).not.toHaveBeenCalled();
  });

  it('names each way the target refused a write in its own words', async () => {
    // A write's failures are not a read's: `not_found` here is not a missing file but a
    // missing place to put one, and naming it "No such file" would send the player looking
    // for something that was never supposed to exist yet.
    const missing = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'file_write',
        cve: 'CVE-2026-0712758',
        severity: 'medium',
        tier: 'guest',
        write: { ok: false, error: 'not_found', path: '/nowhere/loot.txt' },
      },
    });
    const ontoDir = exploitEnv({
      fs: attackerBox(),
      result: {
        ok: true,
        effect: 'file_write',
        cve: 'CVE-2026-0712758',
        severity: 'medium',
        tier: 'guest',
        write: { ok: false, error: 'is_directory', path: '/tmp' },
      },
    });

    const gone = await drain(
      await msfconsole.execute(missing.env, [TARGET.ip, String(PORT), WRITE_PAIR], NO_FLAGS),
    );
    const dir = await drain(
      await msfconsole.execute(ontoDir.env, [TARGET.ip, String(PORT), WRITE_PAIR], NO_FLAGS),
    );

    expect(gone.text).toContain(
      '[-] No such directory to write into (as guest): /nowhere/loot.txt',
    );
    expect(dir.text).toContain('[-] That is a directory, not a file (as guest): /tmp');
  });

  it('forwards the path the player typed to the server', async () => {
    const { env, run } = exploitEnv();

    await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT), '/etc/passwd'], NO_FLAGS));

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ arg: '/etc/passwd' }));
  });

  it('lists the directory it is pointed at and prints its entries, standing the player nowhere', async () => {
    // The other read effect: it hands back the entries and leaves the player where they
    // were, so nothing is pushed and the cwd never moves.
    const { env, pushed, cwds } = exploitEnv({
      result: {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        list: { ok: true, entries: ['passwd', 'shadow', 'ssh'] },
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), '/etc'], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0184 (high)');
    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain('[+] Listing /etc (as user):');
    expect(text).toContain('passwd');
    expect(text).toContain('shadow');
    expect(text).toContain('ssh');
    expect(exitCode).toBe(0);
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  it('reports permission denied for a directory the granted tier cannot read, opening nothing', async () => {
    const { env, pushed } = exploitEnv({
      result: {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'medium',
        tier: 'guest',
        list: { ok: false, error: 'permission_denied' },
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT), '/root'], NO_FLAGS),
    );

    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain('[-] Permission denied (as guest): /root');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('asks for a path when a dir_list exploit is fired without one, and lists nothing', async () => {
    // Reveal-by-firing again — and the request has to name the directory it wants, so a
    // player firing a read hole blind is not told the same thing as one firing a list hole.
    const { env, pushed } = exploitEnv({
      result: {
        ok: true,
        effect: 'dir_list',
        cve: 'CVE-2026-0184',
        severity: 'high',
        tier: 'user',
        needsArg: true,
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0184 (high)');
    expect(text).toContain('lists a directory');
    expect(text).toContain('msfconsole <host> <port> <path>');
    expect(text).not.toContain('[+] Exploit successful!');
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('names the port it left open, standing the player nowhere', async () => {
    // The port is the whole of what the player earned: a backdoor they cannot name is a
    // door they cannot come back through, and the number is not derivable from anything
    // a scan already told them. Nothing is pushed — the door is open, nobody walked in.
    const { env, pushed, cwds } = exploitEnv({
      result: {
        ok: true,
        effect: 'backdoor_port_open',
        cve: 'CVE-2026-0143486',
        severity: 'medium',
        tier: 'guest',
        port: 1337,
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0143486 (medium)');
    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain('[+] Backdoor planted on port 1337');
    // A backdoor aims at no path, so firing it bare is a complete fire rather than the
    // half-fire a read hole answers with — it must never ask for a third argument.
    expect(text).not.toContain('msfconsole <host> <port> <path>');
    expect(exitCode).toBe(0);
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  it('names the account it reset and the password the box will now take, standing the player nowhere', async () => {
    // The plaintext is the prize, so it has to reach the screen verbatim — a player who
    // cannot read back the exact string has been handed nothing. And a reset is not a
    // foothold: the lock changed, nobody walked in, so nothing is pushed and the cwd holds.
    const { env, pushed, cwds } = exploitEnv({
      result: {
        ok: true,
        effect: 'password_reset',
        cve: 'CVE-2026-0122135',
        severity: 'low',
        tier: 'guest',
        username: 'guest',
        password: 'pwned-2135-guest',
      },
    });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain('[*] Vulnerability: CVE-2026-0122135 (low)');
    expect(text).toContain('[+] Exploit successful!');
    expect(text).toContain("[+] Password reset for 'guest' — new password: pwned-2135-guest");
    // A reset aims at no path, so firing it bare is a complete fire rather than the
    // half-fire a read hole answers with — it must never ask for a third argument.
    expect(text).not.toContain('msfconsole <host> <port> <path>');
    expect(exitCode).toBe(0);
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  it('says exactly the same thing about a service with no live CVE and a port with nothing behind it', async () => {
    // One answer, because the server gives one answer. The difference between a
    // patched daemon and a planted listener lives in the DEFENDER's log.
    const patched = exploitEnv({ result: { ok: false, error: 'not_vulnerable' } });
    const listenerOnly = exploitEnv({ result: { ok: false, error: 'not_vulnerable' } });

    const first = await drain(
      await msfconsole.execute(patched.env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );
    const second = await drain(
      await msfconsole.execute(listenerOnly.env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(first.text).toBe(second.text);
    expect(first.text).toContain(`no known vulnerability on ${TARGET.ip}:${PORT}`);
    expect(first.exitCode).toBe(1);
    expect(patched.pushed).toEqual([]);
  });

  it('answers an address its own network has never heard of the way ssh does, without firing', async () => {
    const { env, run, pushed } = exploitEnv();

    const result = await msfconsole.execute(env, [VACANT_IP, String(PORT)], NO_FLAGS);

    expect(syncText(result)).toBe(
      `msfconsole: connect to host ${VACANT_IP} port ${PORT}: No route to host`,
    );
    // The LAN is deterministic, so an address nothing answers to is answerable here.
    // Firing anyway would spend a round trip to be told what the client already knew.
    expect(run).not.toHaveBeenCalled();
    expect(pushed).toEqual([]);
  });

  it('fires at a box behind somebody’s forward, which no client can generate a host for', async () => {
    const { env, run, pushed } = exploitEnv({
      result: { ...GRANTED_FULL, machineId: FORWARDED_MACHINE_ID },
    });

    const { text } = await drain(
      await msfconsole.execute(env, [PUBLIC_IP, String(PORT)], NO_FLAGS),
    );

    // A public address names somebody else's access point, and whether a forward points
    // anywhere behind it is server-side state this side cannot see. Answering locally
    // would shut the vantage from the inside, however willing the server is to open it —
    // which is a different thing from the deterministic LAN the guard above answers for.
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ targetIp: PUBLIC_IP, port: PORT }));
    expect(text).toContain(`[+] Full shell as root@${PUBLIC_IP}`);
    // The box the SERVER resolved behind the forward. Nothing on this side could have
    // produced this id from the address typed, which is the whole of why it has to travel.
    expect(pushed).toEqual([expect.objectContaining({ machineId: FORWARDED_MACHINE_ID })]);
  });

  it('fires at a fellow occupant standing where the generator put nobody', async () => {
    const { env, run, pushed } = exploitEnv({
      result: { ...GRANTED_FULL, machineId: OCCUPANT_MACHINE_ID },
      scan: { resolveOccupants: async () => [occupantAt(VACANT_IP)] },
    });

    const { text } = await drain(
      await msfconsole.execute(env, [VACANT_IP, String(PORT)], NO_FLAGS),
    );

    // The same address the guard above refuses — and it is right to, with nobody there.
    // A real player leases an octet the generator never filled, so occupancy is the only
    // thing that can tell the two apart, and it decides BEFORE the generated world does.
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ targetIp: VACANT_IP, port: PORT }));
    expect(text).toContain(`[+] Full shell as root@${VACANT_IP}`);
    // Their own machine, from the registry — never a machine id derived from the address,
    // which would name the seeded sibling the generator would have put there instead.
    expect(pushed).toEqual([expect.objectContaining({ machineId: OCCUPANT_MACHINE_ID })]);
  });

  it('reaches a fellow occupant named rather than addressed', async () => {
    const { env, run, pushed } = exploitEnv({
      result: { ...GRANTED_FULL, machineId: OCCUPANT_MACHINE_ID },
      scan: { resolveOccupants: async () => [occupantAt(VACANT_IP)] },
    });

    const { text } = await drain(
      await msfconsole.execute(env, ['alice-rig', String(PORT)], NO_FLAGS),
    );

    // A scan prints a NAME and that is what a player types next. The occupant list is the
    // only thing that turns it into an address, so a fire that never consulted it would
    // answer "No route to host" about a box standing right there.
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ targetIp: VACANT_IP }));
    expect(text).toContain(`[+] Full shell as root@${VACANT_IP}`);
    expect(pushed).toEqual([expect.objectContaining({ machineId: OCCUPANT_MACHINE_ID })]);
  });

  it('does not make an empty address reachable just because somebody else is on the WiFi', async () => {
    const { env, run, pushed } = exploitEnv({
      scan: { resolveOccupants: async () => [occupantAt(VACANT_IP)] },
    });

    const result = await msfconsole.execute(env, [OTHER_VACANT_IP, String(PORT)], NO_FLAGS);

    // An occupant standing at ONE address says nothing about another. Reading occupancy as
    // "a player is on this network" rather than "a player is at this address" would make
    // every octet the generator left empty answer as though somebody were behind it.
    expect(syncText(result)).toBe(
      `msfconsole: connect to host ${OTHER_VACANT_IP} port ${PORT}: No route to host`,
    );
    expect(run).not.toHaveBeenCalled();
    expect(pushed).toEqual([]);
  });

  it('answers a box the server could not reach with the same sentence, and opens nothing', async () => {
    const { env, pushed } = exploitEnv({ result: { ok: false, error: 'host_unreachable' } });

    const { text, exitCode } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain(
      `msfconsole: connect to host ${TARGET.ip} port ${PORT}: No route to host`,
    );
    expect(exitCode).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('reports a broken round trip as a network fault rather than a hardened target', async () => {
    const { env, pushed } = exploitEnv({ result: { ok: false, error: 'network_error' } });

    const { text } = await drain(
      await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS),
    );

    expect(text).toContain(`msfconsole: connect to host ${TARGET.ip} port ${PORT}: Network error`);
    expect(text).not.toContain('no known vulnerability');
    expect(pushed).toEqual([]);
  });

  it('never asks for a password', async () => {
    // The whole point of this door. A prompt here would mean the shell was bought
    // with a credential, and there would be nothing to distinguish it from `ssh`.
    const { env, prompt } = exploitEnv();

    await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS));

    expect(prompt).not.toHaveBeenCalled();
  });

  it('fires at the name a scan printed, resolved to its address', async () => {
    const { env, run } = exploitEnv();

    await drain(await msfconsole.execute(env, [TARGET.hostname, String(PORT)], NO_FLAGS));

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ targetIp: TARGET.ip }));
  });

  it('tells the target which session opened the door', async () => {
    // Which session, and nothing about where it came from: the address the target's log
    // names is the server's to derive from the lease it already holds. A client that
    // offered one would be asking to be written up as somebody else.
    const { env, run } = exploitEnv();

    await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS));

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        essid: ESSID,
        port: PORT,
        parentSessionId: env.session.id,
      }),
    );
  });

  it('refuses without a target, without a port, and on a port that is not one', async () => {
    const usage = 'usage: msfconsole <host> <port>';
    const { env, run } = exploitEnv();

    expect(syncText(await msfconsole.execute(env, [], NO_FLAGS))).toBe(usage);
    expect(syncText(await msfconsole.execute(env, [TARGET.ip], NO_FLAGS))).toBe(usage);
    expect(syncText(await msfconsole.execute(env, [TARGET.ip, 'ssh'], NO_FLAGS))).toBe(usage);
    expect(syncText(await msfconsole.execute(env, [TARGET.ip, '70000'], NO_FLAGS))).toBe(usage);
    expect(run).not.toHaveBeenCalled();
  });

  it('fires at either end of the port range, and at neither address beyond it', async () => {
    // Both ends are real ports somebody can serve on, and both sit one step from a
    // number that is not a port at all — so the bound decides between a door and a
    // usage error, which is exactly where an off-by-one hides.
    const { env, run } = exploitEnv();

    for (const port of ['1', '65535']) {
      const result = await msfconsole.execute(env, [TARGET.ip, port], NO_FLAGS);
      expect(result.kind).toBe('async');
      await drain(result);
    }
    expect(run).toHaveBeenCalledTimes(2);

    for (const port of ['0', '65536']) {
      expect(syncText(await msfconsole.execute(env, [TARGET.ip, port], NO_FLAGS))).toBe(
        'usage: msfconsole <host> <port>',
      );
    }
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('pushes the session the server was asked to mint, under that same id', async () => {
    // The id is the only thing tying the row on the server to the hop on the stack. If
    // they differ, `exit` unwinds something the server never ended and a refresh
    // restores a shell nobody is standing in.
    const { env, run, pushed } = exploitEnv();

    await drain(await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS));

    const asked = run.mock.calls[0]?.[0].sessionId;
    expect(asked).toBeTruthy();
    expect(pushed[0]?.id).toBe(asked);
  });

  it('refuses when the box it is run from is on no network', async () => {
    const { env, run } = exploitEnv({ connectivity: buildColdStartConnectivity(OWNER_KEY) });

    const result = await msfconsole.execute(env, [TARGET.ip, String(PORT)], NO_FLAGS);

    expect(syncText(result)).toBe(
      `msfconsole: connect to host ${TARGET.ip} port ${PORT}: Network is unreachable`,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('reports a full shell to a script instead of pushing one it could never enter', async () => {
    // A script has nobody sitting in front of a terminal, and `env` is a per-line
    // snapshot — so a session pushed from here would leave every later line in the
    // script answering about a box the script itself cannot stand on. The door is
    // still worth knowing about, so it is REPORTED and the player is left where
    // they were, which is the same bargain every other effect already strikes.
    //
    // Driven through the script adapter rather than through a flag on the env,
    // because that adapter is what a real scripted call goes through.
    const { fire, pushed, cwds } = scriptedRun();

    const out = await fire(TARGET.ip, String(PORT));

    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
    expect([...out]).toContain(`[+] Full shell available on ${TARGET.ip} as root`);
    expect(out.exitCode).toBe(0);
  });

  it('tells a script a limited shell apart from a full one', async () => {
    // The distinction the interactive path already draws, kept for the same reason: a
    // caller told "Full" that then cannot pivot onward has been lied to by its own
    // tool. A script is the one reader that cannot notice the difference for itself —
    // there is no prompt in front of it to come back wrong — so the line has to carry
    // the whole of it.
    const { fire, pushed } = scriptedRun({ result: GRANTED_LIMITED });

    const out = await fire(TARGET.ip, String(PORT));

    expect(pushed).toEqual([]);
    expect([...out]).toContain(`[+] Limited shell available on ${TARGET.ip} as guest`);
    expect(out.exitCode).toBe(0);
  });

  it('lets a script fire the effects that ACT, and tells it what each one did', async () => {
    // These return before the shell branch ever comes up, which is the whole reason the
    // scripted check sits where it does. Moved to the top of the fire it would be just as
    // green on the two tests above — and every reset, backdoor, read and write would
    // quietly start reporting a door instead of doing its work.
    const reset = scriptedRun({
      result: {
        ok: true,
        effect: 'password_reset',
        cve: 'CVE-2026-0186',
        severity: 'low',
        tier: 'guest',
        username: 'guest',
        password: 'pwned-0186-guest',
      },
    });
    const backdoor = scriptedRun({
      result: {
        ok: true,
        effect: 'backdoor_port_open',
        cve: 'CVE-2026-0187',
        severity: 'medium',
        tier: 'guest',
        port: 1337,
      },
    });

    const afterReset = await reset.fire(TARGET.ip, String(PORT));
    const afterBackdoor = await backdoor.fire(TARGET.ip, String(PORT));

    expect(reset.run).toHaveBeenCalledTimes(1);
    expect(backdoor.run).toHaveBeenCalledTimes(1);
    expect([...afterReset]).toContain(
      "[+] Password reset for 'guest' — new password: pwned-0186-guest",
    );
    expect([...afterBackdoor]).toContain('[+] Backdoor planted on port 1337');
    expect(afterReset.exitCode).toBe(0);
    expect(afterBackdoor.exitCode).toBe(0);
    expect([...reset.pushed, ...backdoor.pushed]).toEqual([]);
  });

  it('hands a script the refusal as stderr and a nonzero exit, not as output to read', async () => {
    // A script branches on the exit code; the sentence is for whoever is watching it run.
    // If the refusal came back as stdout, a sweep collecting its findings would file "no
    // vulnerability" beside the real ones, and a redirect would write it into the loot.
    const { fire, emitted, pushed } = scriptedRun({
      result: { ok: false, error: 'not_vulnerable' },
    });

    const out = await fire(TARGET.ip, String(PORT));

    const refusal = `[-] Exploit failed — no known vulnerability on ${TARGET.ip}:${PORT}`;
    expect(out.exitCode).toBe(1);
    expect([...out]).not.toContain(refusal);
    expect(emitted).toContain(refusal);
    expect(pushed).toEqual([]);
  });
});

// ── msfconsole --local ──────────────────────────────────────────────────────
//
// The library axis of the exploit layer: with no port to reach, `--local <command>`
// fires the CVE a linked library carries and stands the player at a higher tier on the
// box they already hold. Like the service path, the command decides nothing about the
// tier or the effect — the interpreter reads the box's own manifest and the world clock.

/** One whole game day on the world clock — the unit a library CVE window opens on. */
const DAY_MS = 86_400_000;

/** The wall-clock moment a game day begins, so a box can sit exactly inside a library's
 *  live window (`gameDayAt` of this is that day), or one day before it. */
const atGameDay = (gameDay: number) => asEpochMs(WORLD_EPOCH + gameDay * DAY_MS);

/** The player's OWN workstation id. A bare id like the mock default reads as another
 *  player's box, where `--local` must not run client-side. */
const OWN_MACHINE_ID = asMachineId(computeWorkstationId('rig', OWNER_KEY));

/** A release of `library` on which `command`'s pool rolls a full shell at `tier` —
 *  searched for in the world rather than pinned to a seed, so no reseed can quietly turn
 *  this box's hole into a password reset or a different tier and stop testing the roll. */
const shellReleaseFor = (command: string, library: SystemLibrary, tier: UserType) => {
  const release = packageTimeline(library, 400).find((entry) => {
    const outcome = localExploitOutcome(command, new Map([[library, entry.version]]), entry.publishedAt);
    return outcome?.effect === 'shell_full' && outcome.tier === tier;
  });
  if (release === undefined) throw new Error(`no ${library} release rolls a ${tier} shell for ${command}`);
  return release;
};

const rootShellReleaseFor = (command: string, library: SystemLibrary) =>
  shellReleaseFor(command, library, 'root');

/** A release of `library` on which `command`'s pool rolls exactly `effect` — the way to
 *  reach a specific non-shell hole without pinning a seed's raw output. */
const effectReleaseFor = (command: string, library: SystemLibrary, effect: ExploitEffectKind) => {
  const release = packageTimeline(library, 400).find((entry) => {
    const outcome = localExploitOutcome(command, new Map([[library, entry.version]]), entry.publishedAt);
    return outcome?.effect === effect;
  });
  if (release === undefined) throw new Error(`no ${library} release rolls ${effect} for ${command}`);
  return release;
};

/** A passwd holding both a root and a user account, so a shell roll at either tier has a
 *  row to land as. */
const ROOT_AND_USER_PASSWD =
  'root:x:0:0:root:/root:/bin/bash\nalice:hash:1000:1000::/home/alice:/bin/bash\n';

/** A box the player holds: their own workstation id, a passwd, a manifest carrying just
 *  `library` at `version` (so it is the only library that can be live), and — unless
 *  `soPresent` is false — that library's loadable `.so`. `gameDay` sets the clock. */
const localBoxEnv = (opts: {
  readonly library: SystemLibrary;
  readonly version: string;
  readonly gameDay: number;
  readonly passwd?: string;
  readonly soPresent?: boolean;
  /** The box the tool runs from. A foreign workstation id reads as another player's box,
   *  where `--local` must not run client-side. Defaults to the player's own. */
  readonly machineId?: MachineId;
  /** The kind of shell the player is standing in. A PTY-less one (`nc`, `exploit_limited`)
   *  can only pass its lack of a terminal onward. Defaults to a TTY shell. */
  readonly sessionKind?: SessionKind;
  /** A box with no wireless association. `--local` is local, so it must still fire — the
   *  network only decides whether the box is another player's, which own-box short-circuits. */
  readonly offline?: boolean;
}) => {
  const manifest = formatDpkgStatus([buildEntry(opts.library, opts.version)]);
  const lib = buildDirectory(
    opts.soPresent === false ? {} : { [`${opts.library}.so`]: buildFile('', { owner: 'root' }) },
  );
  const tree = buildDirectory({
    etc: buildDirectory({ passwd: buildFile(opts.passwd ?? ROOT_AND_USER_PASSWD) }),
    lib,
    var: buildDirectory({
      lib: buildDirectory({
        dpkg: buildDirectory({ status: buildFile(manifest, { owner: 'root' }) }),
      }),
    }),
  });
  const pushed: Session[] = [];
  const cwds: string[] = [];
  const env = mockCommandEnv({
    identity: { publicKeyHex: asPlayerKeyHex(OWNER_KEY), privateKeyHex: 'b'.repeat(64) },
    session: mockSession({
      machineId: opts.machineId ?? OWN_MACHINE_ID,
      username: 'alice',
      userType: 'user',
      kind: opts.sessionKind ?? 'su',
    }),
    hostname: 'rig',
    now: () => atGameDay(opts.gameDay),
    fs: mockFsViewFromTree(tree),
    network: mockNetworkViewFromConnectivity(
      opts.offline === true ? buildColdStartConnectivity(OWNER_KEY) : connectedState(),
    ),
    pushSession: (session) => void pushed.push(session),
    setCwd: (path) => void cwds.push(path),
  });
  return { env, pushed, cwds };
};

/** A scripted `--local` reach — through the command context, which is what marks a run
 *  scripted. `emitted` collects what a script does NOT hand back (stderr, dim asides). */
const scriptedLocalRun = (opts: Parameters<typeof localBoxEnv>[0]) => {
  const { env, pushed, cwds } = localBoxEnv(opts);
  const emitted: string[] = [];
  const context = buildCommandContext(env, new Map([[msfconsole.name, msfconsole]]), (line) =>
    emitted.push(line.content),
  );
  return { fire: context.msfconsole, pushed, cwds, emitted };
};

/** How the shell parser hands `msfconsole --local su` to `execute`: the command a
 *  positional, `--local` a bare flag. */
const localFlags = new Map<string, string | true>([['--local', true]]);

describe('msfconsole --local', () => {
  it('escalates to a full shell with no password when a linked library CVE is live', async () => {
    const release = rootShellReleaseFor('su', 'libpam');
    const { env, pushed, cwds } = localBoxEnv({
      library: 'libpam',
      version: release.version,
      gameDay: release.publishedAt,
    });
    const outcome = localExploitOutcome(
      'su',
      new Map([['libpam', release.version]]),
      release.publishedAt,
    )!;

    const { text, exitCode } = await drain(await msfconsole.execute(env, ['su'], localFlags));

    expect(exitCode).toBe(0);
    // The whole ordered transcript (decision 77), so a dropped or reworded phase line is
    // caught, not just the presence of the shell line.
    expect(text.split('\n')).toEqual([
      '[*] Exploiting su locally',
      '[*] Sending exploit payload...',
      '[*] Payload delivered, waiting for callback...',
      `[*] Vulnerability: ${outcome.cve} (${outcome.severity}) in libpam.so`,
      '[+] Exploit successful!',
      '[+] Full shell as root@rig',
      '',
    ]);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({
      machineId: OWN_MACHINE_ID,
      username: 'root',
      userType: 'root',
      kind: 'exploit',
    });
    // A distinct id naming the command, so the pushed hop is a real, addressable session
    // rather than a nameless one that later lookups collide on.
    expect(pushed[0]?.id).toContain('exploit-local-su');
    expect(cwds).toEqual(['/root']);
  });

  it('fires client-side even offline, since --local touches no network', async () => {
    // The network only tells `--local` whether the box is another player's; on the
    // player's own box that is answered without it, so a box with no association still
    // escalates rather than bouncing.
    const release = rootShellReleaseFor('su', 'libpam');
    const { env, pushed } = localBoxEnv({
      library: 'libpam',
      version: release.version,
      gameDay: release.publishedAt,
      offline: true,
    });

    const { text, exitCode } = await drain(await msfconsole.execute(env, ['su'], localFlags));

    expect(exitCode).toBe(0);
    expect(text).toContain('[+] Full shell as root@rig');
    expect(pushed).toHaveLength(1);
  });

  it('misses with the uniform line the day before the library CVE window opens', async () => {
    const release = rootShellReleaseFor('su', 'libpam');
    const missDay = release.publishedAt - 1;
    // Precondition: on the day before its window the installed version carries no live
    // hole, so the command has nothing to fire and must say so.
    expect(
      localExploitOutcome('su', new Map([['libpam', release.version]]), missDay),
    ).toBeUndefined();
    const { env, pushed, cwds } = localBoxEnv({
      library: 'libpam',
      version: release.version,
      gameDay: missDay,
    });

    const result = await msfconsole.execute(env, ['su'], localFlags);

    expect(syncText(result)).toBe('msfconsole: no known vulnerability on su');
    expect(syncExit(result)).toBe(1);
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  // Each non-shell effect names its own kind of hole and refuses to open a shell it never
  // rolled. Until PR4b wires the six effects, this stand-in is what a rolled read, list,
  // write, reset, backdoor or script hands back.
  it.each([
    ['file_read', 'cat', 'libpcre', 'reads a file'],
    ['dir_list', 'ls', 'libpcre', 'lists a directory'],
    ['file_write', 'rm', 'libpcre', 'writes a file'],
    ['password_reset', 'su', 'libpam', 'resets a password'],
    ['backdoor_port_open', 'systemctl', 'libsystemd', 'opens a backdoor port'],
    ['script_exec', 'reboot', 'libsystemd', 'runs a script'],
  ] as const)(
    'names a %s hole, opens no shell, and pushes nothing',
    async (effect, command, library, phrase) => {
      const release = effectReleaseFor(command, library, effect);
      const { env, pushed, cwds } = localBoxEnv({
        library,
        version: release.version,
        gameDay: release.publishedAt,
      });
      const outcome = localExploitOutcome(
        command,
        new Map([[library, release.version]]),
        release.publishedAt,
      )!;

      const { text, exitCode } = await drain(await msfconsole.execute(env, [command], localFlags));

      expect(text).toContain(`[*] Vulnerability: ${outcome.cve} (${outcome.severity}) in ${library}.so`);
      expect(text).not.toContain('[+] Exploit successful!');
      expect(text).toContain(`[-] This hole ${phrase}, which a local exploit cannot use yet`);
      expect(exitCode).toBe(1);
      expect(pushed).toEqual([]);
      expect(cwds).toEqual([]);
    },
  );

  it('misses on a command that links no library', async () => {
    // `mkdir` is not in `libraryDeps`, so it has no library to fall through — the same
    // uniform miss a live-less library gives, so a bare fire is no free scan of the map.
    const release = rootShellReleaseFor('su', 'libpam');
    const { env, pushed } = localBoxEnv({
      library: 'libpam',
      version: release.version,
      gameDay: release.publishedAt,
    });

    const result = await msfconsole.execute(env, ['mkdir'], localFlags);

    expect(syncText(result)).toBe('msfconsole: no known vulnerability on mkdir');
    expect(syncExit(result)).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('misses when the linked library is live but its .so has been deleted', async () => {
    // The manifest still remembers libpam and its CVE is live, but the linker could no
    // longer load a deleted `.so` — so there is nothing to fire through, and it reads as
    // the uniform miss rather than exploiting a library the box can't even load.
    const release = rootShellReleaseFor('su', 'libpam');
    const { env, pushed } = localBoxEnv({
      library: 'libpam',
      version: release.version,
      gameDay: release.publishedAt,
      soPresent: false,
    });

    const result = await msfconsole.execute(env, ['su'], localFlags);

    expect(syncText(result)).toBe('msfconsole: no known vulnerability on su');
    expect(syncExit(result)).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('misses when the box has no account at the granted tier', async () => {
    // A root shell needs a root row to land as. A box with only a user account has none,
    // so the same live CVE that would open a root shell elsewhere reads as the uniform
    // miss here — refused before any phase is streamed, like every other bounce.
    const release = rootShellReleaseFor('su', 'libpam');
    const { env, pushed } = localBoxEnv({
      library: 'libpam',
      version: release.version,
      gameDay: release.publishedAt,
      passwd: 'alice:hash:1000:1000::/home/alice:/bin/bash\n',
    });

    const result = await msfconsole.execute(env, ['su'], localFlags);

    expect(syncText(result)).toBe('msfconsole: no known vulnerability on su');
    expect(syncExit(result)).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('shows its usage when no command is named', async () => {
    const release = rootShellReleaseFor('su', 'libpam');
    const { env } = localBoxEnv({
      library: 'libpam',
      version: release.version,
      gameDay: release.publishedAt,
    });

    const result = await msfconsole.execute(env, [], localFlags);

    expect(syncText(result)).toBe('usage: msfconsole --local <command>');
    expect(syncExit(result)).toBe(1);
  });

  it('lands a lesser CVE at user, as a user account rather than root', async () => {
    // The library floor bottoms at user (decision 9), so a medium/low libpam CVE opens a
    // shell as the box's user account, never root — the same command, one tier down.
    const release = shellReleaseFor('su', 'libpam', 'user');
    const { env, pushed, cwds } = localBoxEnv({
      library: 'libpam',
      version: release.version,
      gameDay: release.publishedAt,
    });

    const { text, exitCode } = await drain(await msfconsole.execute(env, ['su'], localFlags));

    expect(exitCode).toBe(0);
    expect(text).toContain('[+] Full shell as alice@rig');
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ username: 'alice', userType: 'user', kind: 'exploit' });
    expect(cwds).toEqual(['/home/alice']);
  });

  it('passes a PTY-less shell onward: a full roll pushes a limited hop', async () => {
    // Decision 73: an escalated shell inherits the caller's terminal state. Fired from a
    // shell with no TTY (a limited exploit, a backdoor), a `shell_full` roll still can't
    // open a full one — the tier rises to root, but the door stays a limited hop.
    const release = rootShellReleaseFor('su', 'libpam');
    const { env, pushed } = localBoxEnv({
      library: 'libpam',
      version: release.version,
      gameDay: release.publishedAt,
      sessionKind: 'exploit_limited',
    });

    const { text, exitCode } = await drain(await msfconsole.execute(env, ['su'], localFlags));

    expect(exitCode).toBe(0);
    expect(text).toContain('[+] Got shell as root@rig');
    expect(text).not.toContain('[+] Full shell as');
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ userType: 'root', kind: 'exploit_limited' });
  });

  it('does not run client-side on another player’s workstation', async () => {
    const release = rootShellReleaseFor('su', 'libpam');
    const foreign = asMachineId(computeWorkstationId('bob', 'f'.repeat(64)));
    const { env, pushed } = localBoxEnv({
      library: 'libpam',
      version: release.version,
      gameDay: release.publishedAt,
      machineId: foreign,
    });

    const result = await msfconsole.execute(env, ['su'], localFlags);

    expect(syncText(result)).toBe('msfconsole: --local not available on this machine');
    expect(syncExit(result)).toBe(1);
    expect(pushed).toEqual([]);
  });

  it('reports a shell rather than entering it when run from a script', async () => {
    // Decision 70: a script has nowhere to stand a session, so the door is reported and
    // the script is left where it was — never a shell it cannot occupy.
    const release = rootShellReleaseFor('su', 'libpam');
    const { fire, pushed, cwds } = scriptedLocalRun({
      library: 'libpam',
      version: release.version,
      gameDay: release.publishedAt,
    });

    const out = await fire('su', { '--local': true });

    expect([...out]).toContain('[+] Full shell available on rig as root');
    expect([...out]).not.toContain('[+] Full shell as root@rig');
    expect(pushed).toEqual([]);
    expect(cwds).toEqual([]);
  });

  it('reports a limited shell from a script when the caller has no terminal', async () => {
    // A `shell_full` roll from a PTY-less shell is a limited hop (decision 73), and a
    // script reports it rather than entering — so the line is the limited one, not the full.
    const release = rootShellReleaseFor('su', 'libpam');
    const { fire, pushed } = scriptedLocalRun({
      library: 'libpam',
      version: release.version,
      gameDay: release.publishedAt,
      sessionKind: 'exploit_limited',
    });

    const out = await fire('su', { '--local': true });

    expect([...out]).toContain('[+] Limited shell available on rig as root');
    expect([...out]).not.toContain('[+] Full shell available on rig as root');
    expect(pushed).toEqual([]);
  });
});
