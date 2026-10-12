import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveOccupantSweep,
  type ResolveOccupantSweepDeps,
} from './resolveOccupantSweep.js';
import type { HttpFetchOccupant } from './resolveHttpFetch.js';
import { md5 } from '../generation/md5.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { lanAddressFor, type LanLeaseRow } from './lanAddress.js';
import { LOOPBACK_IPV4 } from './interfaces.js';
import type { OwnerPatchRow } from './materializeWorkstationFs.js';
import { defaultFilePermissions } from '../filesystem/defaultPermissions.js';
import { formatPidfileContent } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { HTTP_DEFAULT_PORT } from './http.js';
import { DIRLIST_PATH } from './defaultDirlist.js';
import { ACCESS_LOG_PATH, formatAccessLogLine } from '../logging/accessLog.js';
import { asGameTime } from '../types.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog.js';
import type { ListPathPatchesResult, PatchRow } from '../patches/upsertPatch.js';
import { logRead } from '../../test/factories/logRows.js';

/**
 * `handleResolveOccupantSweep` is the path sweep pointed at a FELLOW OCCUPANT's box, at
 * the address it holds on the WiFi the caller stands on — the run behind
 * `gobuster http://<a player's LAN address>`.
 *
 * It enters through the door a fetch of that box enters, so what a scan shows open a
 * sweep can walk and what it shows shut refuses. The list never crosses the wire: the
 * server reads it off the box the caller stands on. The box that was swept hears every
 * request as one append, in its OWNER's log, from the address the server places the
 * caller at.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

// ALICE publishes; BOB is on the same WiFi and sweeps her box.
const ALICE = generateIdentity();
const BOB = generateIdentity();

const ALICE_WS = 'workstation-a1b2c3d4';
/** Bob's own box: derived from his key, so the server recognises it without a session. */
const BOB_WS = computeWorkstationId('skylab', BOB.publicKeyHex);

/** Octets no generated host occupies, as a lease is only ever issued on one. */
const [ALICE_OCTET, BOB_OCTET, VACANT_OCTET] = ((): readonly number[] => {
  const taken = new Set(generateHomeLan(ESSID).hosts.map((host) => Number(host.ip.split('.')[3])));
  return Array.from({ length: 253 }, (_unused, index) => index + 2)
    .filter((octet) => !taken.has(octet))
    .slice(0, 3);
})() as readonly [number, number, number];
const ALICE_LAN_IP = lanAddressFor(ESSID, ALICE_OCTET);
const BOB_LAN_IP = lanAddressFor(ESSID, BOB_OCTET);

const aliceOccupant: HttpFetchOccupant = {
  owner_key: ALICE.publicKeyHex,
  workstation_machine_id: ALICE_WS,
  workstation_username: 'neo',
  workstation_root_hash: md5('toor'),
};
const bobOccupant: HttpFetchOccupant = {
  owner_key: BOB.publicKeyHex,
  workstation_machine_id: BOB_WS,
  workstation_username: 'trinity',
  workstation_root_hash: md5('root2'),
};
const BOTH_OCCUPANTS: readonly HttpFetchOccupant[] = [aliceOccupant, bobOccupant];
const BOTH_LEASES: readonly LanLeaseRow[] = [
  { owner_key: ALICE.publicKeyHex, octet: ALICE_OCTET },
  { owner_key: BOB.publicKeyHex, octet: BOB_OCTET },
];

const journalRow = (fields: {
  readonly path: string;
  readonly content: string | null;
  readonly permissions?: OwnerPatchRow['permissions'];
  readonly nodeType?: OwnerPatchRow['node_type'];
}): OwnerPatchRow => ({
  path: fields.path,
  content: fields.content,
  owner: 'root',
  permissions: fields.permissions ?? null,
  node_type: fields.nodeType ?? 'file',
  updated_at: '2026-07-30T00:00:00.000Z',
  writer_key: ALICE.publicKeyHex,
});

/** The owner started `nginx`: the pidfile is what makes the port live. */
const webServerUp = (port = HTTP_DEFAULT_PORT): OwnerPatchRow =>
  journalRow({
    path: `/var/run/${SERVICE_CATALOG.http.pidfile}`,
    content: formatPidfileContent(SERVICE_CATALOG.http, port),
  });

const sshdUp = journalRow({
  path: `/var/run/${SERVICE_CATALOG.ssh.pidfile}`,
  content: formatPidfileContent(SERVICE_CATALOG.ssh, SERVICE_CATALOG.ssh.defaultPort),
});

/** A page the owner published as root: root-readable and nothing else, so a server that
 *  read it as its caller would miss the owner's own page. */
const publishedPage = (path: string, content: string): OwnerPatchRow =>
  journalRow({
    path: `/var/www/html${path}`,
    content,
    permissions: defaultFilePermissions('root'),
  });

const publishedDir = (path: string): OwnerPatchRow =>
  journalRow({
    path: `/var/www/html${path}`,
    content: null,
    nodeType: 'directory',
    permissions: defaultFilePermissions('root'),
  });

/** The owner's own filter, closing ports to the network while the daemons keep running. */
const filtering = (...ports: readonly number[]): OwnerPatchRow =>
  journalRow({
    path: '/etc/iptables/rules.v4',
    content: ports.map((port) => `deny ${port}`).join('\n'),
  });

/** A root `rm /boot/vmlinuz` tombstone: replayed, the box cannot come up. */
const bootTombstone = journalRow({ path: '/boot/vmlinuz', content: null, nodeType: null });

/** Alice's journal: a web server up, plus whatever she published. */
const aliceServing = (...extra: readonly OwnerPatchRow[]): readonly OwnerPatchRow[] => [
  webServerUp(),
  ...extra,
];

/** The path list `apt install gobuster` left on the box the caller is standing on. */
const dirlistRow = (words: readonly string[]): OwnerPatchRow =>
  journalRow({ path: DIRLIST_PATH, content: words.join('\n') });

const listing = (...words: readonly string[]) => async (): Promise<ListPathPatchesResult> => ({
  data: [dirlistRow(words)],
  error: null,
});

// 2026-07-30 13:55:36 UTC, fixed so the rendered lines are asserted literally.
const SWEEP_TIME = Date.UTC(2026, 6, 30, 13, 55, 36);

const logLine = (path: string, status: number, size: number, sourceIp = BOB_LAN_IP): string =>
  formatAccessLogLine({ time: asGameTime(SWEEP_TIME), sourceIp, path, status, size });

type Overrides = Partial<ResolveOccupantSweepDeps> & {
  /** Alice's journal. Any other machine's is empty. */
  readonly aliceJournal?: readonly OwnerPatchRow[];
};

/** Bob at home on the WiFi at his own lease, with a one-word list; Alice on it too,
 *  serving one page that word names. */
const makeDeps = ({
  aliceJournal = aliceServing(publishedPage('/index.html', 'hello')),
  ...over
}: Overrides = {}) => {
  const findPatches = vi.fn<ResolveOccupantSweepDeps['findPatches']>(
    over.findPatches ??
      (async ({ machine_id }) => ({
        data: machine_id === ALICE_WS ? aliceJournal : [],
        error: null,
      })),
  );
  const listOccupantsByEssid = vi.fn<ResolveOccupantSweepDeps['listOccupantsByEssid']>(
    over.listOccupantsByEssid ?? (async () => ({ data: BOTH_OCCUPANTS, error: null })),
  );
  const listPathPatches = vi.fn<ResolveOccupantSweepDeps['listPathPatches']>(
    over.listPathPatches ?? listing('index.html'),
  );
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    over.readLog ?? (async () => ({ data: null, error: null })),
  );
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(
    over.upsertPatch ?? (async () => ({ error: null })),
  );
  const deps: ResolveOccupantSweepDeps = {
    nonceStore: freshStore,
    now: () => SWEEP_TIME,
    findActiveSession: async () => ({ data: null, error: null }),
    findHomeVantage: async (ownerKey) => ({
      data: ownerKey === BOB.publicKeyHex ? { essid: ESSID, octet: BOB_OCTET } : null,
      error: null,
    }),
    findWorkstationLease: async () => ({ data: null, error: null }),
    listLeasesByEssid: async () => ({ data: BOTH_LEASES, error: null }),
    ...over,
    findPatches,
    listOccupantsByEssid,
    listPathPatches,
    readLog,
    upsertPatch,
  };
  return { deps, findPatches, listOccupantsByEssid, listPathPatches, readLog, upsertPatch };
};

type Asked = {
  readonly essid?: string;
  readonly target?: string;
  readonly port?: number;
  readonly caller_machine_id?: string;
};

/** Bob's signed request to sweep Alice's box from his own, with whatever a test changes. */
const envelope = (asked: Asked = {}) =>
  signRequest(BOB, 'resolveOccupantSweep', {
    essid: ESSID,
    target: ALICE_LAN_IP,
    port: HTTP_DEFAULT_PORT,
    caller_machine_id: BOB_WS,
    ...asked,
  });

/** What the swept box was told, as the lines of each append. */
const appendedLines = (upsertPatch: { mock: { calls: readonly (readonly PatchRow[])[] } }) =>
  upsertPatch.mock.calls
    .filter(([row]) => row.path === ACCESS_LOG_PATH)
    .map(([row]) => (row.content ?? '').split('\n').filter((line) => line.length > 0));

const UNREACHABLE = { status: 404, body: { error: 'host_unreachable' } };
const REFUSED = { status: 404, body: { error: 'connection_refused' } };

describe('sweeping a fellow occupant’s box for paths nobody linked', () => {
  it('reports what each word found, and the size of what came back', async () => {
    const { deps } = makeDeps({
      aliceJournal: aliceServing(publishedPage('/index.html', 'hello there')),
      listPathPatches: listing('index.html', 'admin'),
    });

    // A word naming nothing is reported as the 404 it is rather than omitted: the
    // caller counts both.
    expect(await handleResolveOccupantSweep(await envelope(), deps)).toEqual({
      status: 200,
      body: {
        ok: true,
        dirlistFound: true,
        results: [
          { path: '/index.html', status: 200, size: 'hello there'.length },
          { path: '/admin', status: 404, size: 0 },
        ],
      },
    });
  });

  it('reports a directory holding an index as the form a server redirects to', async () => {
    const { deps } = makeDeps({
      aliceJournal: aliceServing(
        publishedDir('/hidden'),
        publishedPage('/hidden/index.html', 'notes'),
      ),
      listPathPatches: listing('hidden'),
    });

    expect((await handleResolveOccupantSweep(await envelope(), deps)).body).toEqual({
      ok: true,
      dirlistFound: true,
      results: [{ path: '/hidden/', status: 200, size: 'notes'.length }],
    });
  });

  it('never hands over what it found, only that it is there', async () => {
    const { deps } = makeDeps({
      aliceJournal: aliceServing(publishedPage('/index.html', 'SECRET CONTENT')),
    });

    const { body } = await handleResolveOccupantSweep(await envelope(), deps);

    // Finding a page and reading it are two acts, and the second leaves its own line.
    expect(JSON.stringify(body)).not.toContain('SECRET CONTENT');
  });

  it('sweeps the box the LEASE puts at that address', async () => {
    const { deps, findPatches } = makeDeps();

    await handleResolveOccupantSweep(await envelope(), deps);

    expect(findPatches).toHaveBeenCalledWith({ machine_id: ALICE_WS });
  });

  it('sweeps the port the web server opened, and is refused on the one it did not', async () => {
    const { deps } = makeDeps({
      aliceJournal: [webServerUp(8080), publishedPage('/index.html', 'hello')],
    });

    expect((await handleResolveOccupantSweep(await envelope({ port: 8080 }), deps)).body).toEqual({
      ok: true,
      dirlistFound: true,
      results: [{ path: '/index.html', status: 200, size: 'hello'.length }],
    });
    expect(await handleResolveOccupantSweep(await envelope(), deps)).toEqual(REFUSED);
  });
});

describe('the list a sweep asks with', () => {
  it('is read off the box the caller stands on, and never sent', async () => {
    const { deps, listPathPatches } = makeDeps();

    await handleResolveOccupantSweep(await envelope(), deps);

    expect(listPathPatches).toHaveBeenCalledWith({ machine_id: BOB_WS, path: DIRLIST_PATH });
  });

  it('ignores words a request carries, asking only with the ones on the box', async () => {
    const { deps } = makeDeps({
      aliceJournal: aliceServing(
        publishedPage('/index.html', 'hello'),
        publishedPage('/secret.html', 'not on the list'),
      ),
    });

    const { body } = await handleResolveOccupantSweep(
      await signRequest(BOB, 'resolveOccupantSweep', {
        essid: ESSID,
        target: ALICE_LAN_IP,
        port: HTTP_DEFAULT_PORT,
        caller_machine_id: BOB_WS,
        words: ['secret.html'],
      }),
      deps,
    );

    expect(body).toEqual({
      ok: true,
      dirlistFound: true,
      results: [{ path: '/index.html', status: 200, size: 'hello'.length }],
    });
  });

  it('reports a missing list instead of an empty run, and asks the box nothing', async () => {
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: async () => ({ data: [], error: null }),
    });

    // An absent file is a real state. Zero findings would read as a server with
    // nothing on it rather than a tool with nothing to ask.
    expect(await handleResolveOccupantSweep(await envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, dirlistFound: false, results: [] },
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('sweeps nothing and says nothing when the list is present but empty', async () => {
    const { deps, upsertPatch } = makeDeps({ listPathPatches: listing() });

    expect(await handleResolveOccupantSweep(await envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, dirlistFound: true, results: [] },
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('distinguishes a list it could not read from a list that is not there', async () => {
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: async () => ({ data: null, error: new Error('journal offline') }),
    });

    // Telling a player to reinstall the package on the word of a storage failure would
    // send them to overwrite a list they spent the game growing.
    expect(await handleResolveOccupantSweep(await envelope(), deps)).toEqual({
      status: 500,
      body: { error: 'dirlist_lookup_failed' },
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

describe('the swept box records the whole run', () => {
  it('writes every path asked about as ONE append in the OWNER’s log, from the caller’s LAN address', async () => {
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: listing('index.html', 'admin', 'backup'),
    });

    await handleResolveOccupantSweep(await envelope(), deps);

    // The wall of 404s under one stamp is the defender's tell.
    expect(appendedLines(upsertPatch)).toEqual([
      [
        logLine('/index.html', 200, 'hello'.length),
        logLine('/admin', 404, 0),
        logLine('/backup', 404, 0),
      ],
    ]);
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ writer_key: ALICE.publicKeyHex, machine_id: ALICE_WS }),
    );
  });

  it('records both requests a directory word costs, not only the one that answered', async () => {
    const { deps, upsertPatch } = makeDeps({
      aliceJournal: aliceServing(
        publishedDir('/hidden'),
        publishedPage('/hidden/index.html', 'notes'),
      ),
      listPathPatches: listing('hidden'),
    });

    await handleResolveOccupantSweep(await envelope(), deps);

    expect(appendedLines(upsertPatch)).toEqual([
      [logLine('/hidden', 404, 0), logLine('/hidden/', 200, 'notes'.length)],
    ]);
  });

  it('records a path that climbed out of the document root as asked, and reports a miss', async () => {
    const { deps, upsertPatch } = makeDeps({ listPathPatches: listing('../../etc/passwd') });

    const { body } = await handleResolveOccupantSweep(await envelope(), deps);

    expect(body).toEqual({
      ok: true,
      dirlistFound: true,
      results: [{ path: '/../../etc/passwd', status: 404, size: 0 }],
    });
    expect(appendedLines(upsertPatch)).toEqual([[logLine('/../../etc/passwd', 404, 0)]]);
  });

  it('accretes onto the log the box already holds', async () => {
    const previous = '203.0.113.9 - - [29/Jul/2026:09:00:00 +0000] "GET / HTTP/1.1" 200 12\n';
    const { deps, upsertPatch, readLog } = makeDeps({ readLog: async () => logRead(previous) });

    await handleResolveOccupantSweep(await envelope(), deps);

    expect(readLog).toHaveBeenCalledWith({ machine_id: ALICE_WS, path: ACCESS_LOG_PATH });
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${previous}${logLine('/index.html', 200, 'hello'.length)}\n`,
      }),
    );
  });

  it('records a caller the LAN cannot place as unknown', async () => {
    // On the network, holding no lease: there is no address to derive.
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({ data: { essid: ESSID, octet: null }, error: null }),
    });

    await handleResolveOccupantSweep(await envelope(), deps);

    expect(appendedLines(upsertPatch)).toEqual([
      [logLine('/index.html', 200, 'hello'.length, 'unknown')],
    ]);
  });

  it('reports what it found even when the lines cannot be written', async () => {
    const { deps } = makeDeps({
      upsertPatch: async () => {
        throw new Error('storage down');
      },
    });

    expect((await handleResolveOccupantSweep(await envelope(), deps)).body).toMatchObject({
      results: [{ path: '/index.html', status: 200, size: 'hello'.length }],
    });
  });
});

describe('a box that does not answer a sweep', () => {
  it.each([
    [
      'nobody holds the address',
      { target: lanAddressFor(ESSID, VACANT_OCTET) },
      {},
    ],
    [
      'the holder of the lease has left the WiFi',
      {},
      { listOccupantsByEssid: async () => ({ data: [bobOccupant], error: null }) },
    ],
    [
      'the box cannot boot',
      {},
      { aliceJournal: aliceServing(publishedPage('/index.html', 'hello'), bootTombstone) },
    ],
  ] satisfies readonly (readonly [string, Asked, Overrides])[])(
    'is unreachable when %s, and no list is read',
    async (_label, asked, over) => {
      const { deps, listPathPatches, upsertPatch } = makeDeps(over);

      expect(await handleResolveOccupantSweep(await envelope(asked), deps)).toEqual(UNREACHABLE);
      expect(listPathPatches).not.toHaveBeenCalled();
      expect(upsertPatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['no web server is running', {}, [publishedPage('/index.html', 'hello')]],
    [
      'something other than a web server holds the port',
      { port: SERVICE_CATALOG.ssh.defaultPort },
      aliceServing(sshdUp),
    ],
    [
      'the owner closed the web port to the network',
      {},
      aliceServing(publishedPage('/index.html', 'hello'), filtering(HTTP_DEFAULT_PORT)),
    ],
  ] satisfies readonly (readonly [string, Asked, readonly OwnerPatchRow[]])[])(
    'is refused when %s, and the box hears nothing',
    async (_label, asked, aliceJournal) => {
      const { deps, upsertPatch } = makeDeps({ aliceJournal });

      expect(await handleResolveOccupantSweep(await envelope(asked), deps)).toEqual(REFUSED);
      expect(upsertPatch).not.toHaveBeenCalled();
    },
  );
});

describe('a caller in a shell on the box they sweep', () => {
  /** Bob holds a shell on Alice's workstation and names it as where he stands. */
  const shellOnAliceBox = (over: Overrides = {}) =>
    makeDeps({
      findActiveSession: async ({ machine_id }) => ({
        data:
          machine_id === ALICE_WS ? { username: 'guest', userType: 'guest', essid: ESSID } : null,
        error: null,
      }),
      findHomeVantage: async () => ({ data: null, error: null }),
      findWorkstationLease: async (_essid, machineId) => ({
        data: machineId === ALICE_WS ? ALICE_OCTET : null,
        error: null,
      }),
      ...over,
    });

  it('sweeps with the list on THAT box, and is logged from its address', async () => {
    const { deps, listPathPatches, upsertPatch } = shellOnAliceBox();

    await handleResolveOccupantSweep(await envelope({ caller_machine_id: ALICE_WS }), deps);

    // Tools run where you stand, and so does the ammunition.
    expect(listPathPatches).toHaveBeenCalledWith({ machine_id: ALICE_WS, path: DIRLIST_PATH });
    expect(appendedLines(upsertPatch)).toEqual([
      [logLine('/index.html', 200, 'hello'.length, ALICE_LAN_IP)],
    ]);
  });

  it('sweeps a port the owner closed to the network, since nothing stands between a box and itself', async () => {
    const { deps } = shellOnAliceBox({
      aliceJournal: aliceServing(
        publishedPage('/index.html', 'hello'),
        filtering(HTTP_DEFAULT_PORT),
      ),
    });

    expect(
      (await handleResolveOccupantSweep(await envelope({ caller_machine_id: ALICE_WS }), deps))
        .status,
    ).toBe(200);
  });

  it('sweeps the box over loopback, and the whole run is logged as a local visit', async () => {
    const { deps, listPathPatches, upsertPatch } = shellOnAliceBox({
      listPathPatches: listing('index.html', 'admin'),
    });

    const response = await handleResolveOccupantSweep(
      await envelope({ target: LOOPBACK_IPV4, caller_machine_id: ALICE_WS }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(listPathPatches).toHaveBeenCalledWith({ machine_id: ALICE_WS, path: DIRLIST_PATH });
    expect(appendedLines(upsertPatch)).toEqual([
      [
        logLine('/index.html', 200, 'hello'.length, LOOPBACK_IPV4),
        logLine('/admin', 404, 0, LOOPBACK_IPV4),
      ],
    ]);
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ writer_key: ALICE.publicKeyHex, machine_id: ALICE_WS }),
    );
  });
});

describe('the LAN boundary', () => {
  it('refuses a caller standing on another network, before anything is read', async () => {
    const { deps, listOccupantsByEssid, listPathPatches, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({
        data: { essid: 'SOMEWHERE-ELSE', octet: BOB_OCTET },
        error: null,
      }),
    });

    expect(await handleResolveOccupantSweep(await envelope(), deps)).toEqual({
      status: 403,
      body: { error: 'wrong_network' },
    });
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
    expect(listPathPatches).not.toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a caller naming a box they hold no shell on, so nobody sweeps with a list they did not reach', async () => {
    const { deps, listPathPatches } = makeDeps();

    expect(
      await handleResolveOccupantSweep(await envelope({ caller_machine_id: ALICE_WS }), deps),
    ).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(listPathPatches).not.toHaveBeenCalled();
  });
});

describe('a request the server does not trust', () => {
  it('rejects an envelope whose signature does not verify', async () => {
    const { deps, listOccupantsByEssid } = makeDeps();
    const signed = await envelope();

    const response = await handleResolveOccupantSweep(
      { ...signed, signature: signed.signature.replace(/^../, '00') },
      deps,
    );

    expect(response).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
  });

  it('rejects a payload that claims an identity', async () => {
    const { deps } = makeDeps();

    const response = await handleResolveOccupantSweep(
      await signRequest(BOB, 'resolveOccupantSweep', {
        essid: ESSID,
        target: ALICE_LAN_IP,
        port: HTTP_DEFAULT_PORT,
        caller_machine_id: BOB_WS,
        player_key: ALICE.publicKeyHex,
      }),
      deps,
    );

    expect(response).toEqual({ status: 400, body: { error: 'payload_invalid' } });
  });

  it.each([
    ['no network', { essid: '' }],
    ['no target', { target: '' }],
    ['no box to read the list off', { caller_machine_id: '' }],
    ['a port that is not a whole number', { port: 80.5 }],
  ])('rejects a request naming %s', async (_label, asked) => {
    const { deps } = makeDeps();

    expect((await handleResolveOccupantSweep(await envelope(asked), deps)).status).toBe(400);
  });

  it('rejects a request that names no box at all', async () => {
    const { deps } = makeDeps();

    const response = await handleResolveOccupantSweep(
      await signRequest(BOB, 'resolveOccupantSweep', {
        essid: ESSID,
        target: ALICE_LAN_IP,
        port: HTTP_DEFAULT_PORT,
      }),
      deps,
    );

    expect(response.status).toBe(400);
  });
});

describe('a lookup that fails is a server error, never a derived answer', () => {
  it('reports a failed journal read of the swept box', async () => {
    const { deps, listPathPatches } = makeDeps({
      findPatches: async () => ({ data: null, error: new Error('down') }),
    });

    expect(await handleResolveOccupantSweep(await envelope(), deps)).toEqual({
      status: 500,
      body: { error: 'patches_lookup_failed' },
    });
    expect(listPathPatches).not.toHaveBeenCalled();
  });
});
