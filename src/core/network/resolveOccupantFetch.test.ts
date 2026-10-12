import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveOccupantFetch,
  type ResolveOccupantFetchDeps,
} from './resolveOccupantFetch.js';
import type { HttpFetchOccupant } from './resolveHttpFetch.js';
import { md5 } from '../generation/md5.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { lanAddressFor, type LanLeaseRow } from './lanAddress.js';
import { LOOPBACK_IPV4 } from './interfaces.js';
import type { OwnerPatchRow } from './materializeWorkstationFs.js';
import { defaultFilePermissions } from '../filesystem/defaultPermissions.js';
import {
  formatPidfileContent,
  formatProgramPidfileContent,
  programPidfilePath,
} from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { HTTP_DEFAULT_PORT } from './http.js';
import { ACCESS_LOG_PATH } from '../logging/accessLog.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import { logRead } from '../../test/factories/logRows.js';

/**
 * `handleResolveOccupantFetch` serves a page off a FELLOW OCCUPANT's box to a caller on
 * the same WiFi — the fetch behind `curl http://<a player's LAN address>`.
 *
 * Every other host on a LAN is the client's to read: a generated box is a function of
 * the network. A player's workstation is built from their identity and their journal,
 * so only the server can say what it publishes. The web is the door with no credential,
 * so standing on the network is the whole gate: what a scan of the box shows open, a
 * fetch is served.
 *
 * The box that answered records the visit, in its OWNER's log, from the address the
 * server places the caller at.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

// ALICE publishes the page; BOB is on the same WiFi and fetches it.
const ALICE = generateIdentity();
const BOB = generateIdentity();

const ALICE_WS = 'workstation-a1b2c3d4';
const BOB_WS = 'workstation-b5c6d7e8';

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

/** The owner started `apache2` instead: the same web service, its own pidfile. */
const apacheUp = journalRow({
  path: programPidfilePath('apache2'),
  content: formatProgramPidfileContent('apache2', HTTP_DEFAULT_PORT),
});

const sshdUp = journalRow({
  path: `/var/run/${SERVICE_CATALOG.ssh.pidfile}`,
  content: formatPidfileContent(SERVICE_CATALOG.ssh, SERVICE_CATALOG.ssh.defaultPort),
});

/** A page the owner published as root: root-readable and nothing else, so a server that
 *  read it as its caller would 404 the owner's own page. */
const publishedPage = (content: string, path = 'index.html'): OwnerPatchRow =>
  journalRow({
    path: `/var/www/html/${path}`,
    content,
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

const ALICE_PAGE = '<h1>alice was here</h1>';

/** Alice's journal: a web server up and one page published, plus whatever a test adds. */
const aliceServing = (...extra: readonly OwnerPatchRow[]): readonly OwnerPatchRow[] => [
  webServerUp(),
  publishedPage(ALICE_PAGE),
  ...extra,
];

// 2026-07-30 13:55:36 UTC, fixed so the rendered line is asserted literally.
const FETCH_TIME = Date.UTC(2026, 6, 30, 13, 55, 36);

const accessLine = (fields: {
  readonly sourceIp?: string;
  readonly path?: string;
  readonly status?: number;
  readonly size?: number;
}): string =>
  `${fields.sourceIp ?? BOB_LAN_IP} - - [30/Jul/2026:13:55:36 +0000] "GET ${fields.path ?? '/'} HTTP/1.1" ${fields.status ?? 200} ${fields.size ?? 0}`;

type Overrides = Partial<ResolveOccupantFetchDeps> & {
  /** Alice's journal. Any other machine's is empty. */
  readonly aliceJournal?: readonly OwnerPatchRow[];
};

/** Bob at home on the WiFi at his own lease, Alice on it too and serving her page. */
const makeDeps = ({ aliceJournal = aliceServing(), ...over }: Overrides = {}) => {
  const findPatches = vi.fn<ResolveOccupantFetchDeps['findPatches']>(
    over.findPatches ??
      (async ({ machine_id }) => ({
        data: machine_id === ALICE_WS ? aliceJournal : [],
        error: null,
      })),
  );
  const listOccupantsByEssid = vi.fn<ResolveOccupantFetchDeps['listOccupantsByEssid']>(
    over.listOccupantsByEssid ?? (async () => ({ data: BOTH_OCCUPANTS, error: null })),
  );
  const listLeasesByEssid = vi.fn<ResolveOccupantFetchDeps['listLeasesByEssid']>(
    over.listLeasesByEssid ?? (async () => ({ data: BOTH_LEASES, error: null })),
  );
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    over.readLog ?? (async () => ({ data: null, error: null })),
  );
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(
    over.upsertPatch ?? (async () => ({ error: null })),
  );
  const deps: ResolveOccupantFetchDeps = {
    nonceStore: freshStore,
    now: () => FETCH_TIME,
    findActiveSession: async () => ({ data: null, error: null }),
    findHomeVantage: async (ownerKey) => ({
      data: ownerKey === BOB.publicKeyHex ? { essid: ESSID, octet: BOB_OCTET } : null,
      error: null,
    }),
    findWorkstationLease: async () => ({ data: null, error: null }),
    ...over,
    findPatches,
    listOccupantsByEssid,
    listLeasesByEssid,
    readLog,
    upsertPatch,
  };
  return { deps, findPatches, listOccupantsByEssid, listLeasesByEssid, readLog, upsertPatch };
};

type Asked = {
  readonly essid?: string;
  readonly target?: string;
  readonly port?: number;
  readonly path?: string;
  readonly caller_machine_id?: string;
};

/** Bob's signed request for Alice's front page, with whatever a test changes. */
const envelope = (asked: Asked = {}, identity = BOB) =>
  signRequest(identity, 'resolveOccupantFetch', {
    essid: ESSID,
    target: ALICE_LAN_IP,
    port: HTTP_DEFAULT_PORT,
    path: '/',
    ...asked,
  });

const UNREACHABLE = { status: 404, body: { error: 'host_unreachable' } };
const REFUSED = { status: 404, body: { error: 'connection_refused' } };
const NOT_FOUND = { status: 404, body: { error: 'not_found' } };

describe('fetching a page off a fellow occupant’s box', () => {
  it('returns the page the neighbour publishes, naming the program that served it', async () => {
    const { deps } = makeDeps();

    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, content: ALICE_PAGE, server: 'nginx' },
    });
  });

  it('reads the journal of the box the LEASE puts at that address', async () => {
    const { deps, findPatches } = makeDeps();

    await handleResolveOccupantFetch(await envelope(), deps);

    expect(findPatches).toHaveBeenCalledWith({ machine_id: ALICE_WS });
  });

  it('serves the file a path names under the document root', async () => {
    const { deps } = makeDeps({
      aliceJournal: aliceServing(publishedPage('<h1>status: green</h1>', 'status.html')),
    });

    expect(
      await handleResolveOccupantFetch(await envelope({ path: '/status.html' }), deps),
    ).toEqual({
      status: 200,
      body: { ok: true, content: '<h1>status: green</h1>', server: 'nginx' },
    });
  });

  it('names apache2 when that is the web server the neighbour runs', async () => {
    const { deps } = makeDeps({ aliceJournal: [apacheUp, publishedPage(ALICE_PAGE)] });

    expect((await handleResolveOccupantFetch(await envelope(), deps)).body).toMatchObject({
      server: 'apache2',
    });
  });

  it('serves the port the web server opened, and refuses the one it did not', async () => {
    const { deps } = makeDeps({ aliceJournal: [webServerUp(8080), publishedPage(ALICE_PAGE)] });

    expect(await handleResolveOccupantFetch(await envelope({ port: 8080 }), deps)).toEqual({
      status: 200,
      body: { ok: true, content: ALICE_PAGE, server: 'nginx' },
    });
    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual(REFUSED);
  });
});

describe('what a fetch of a neighbour can never read', () => {
  it('returns not found for a path that climbs out of the document root', async () => {
    const { deps } = makeDeps();

    const response = await handleResolveOccupantFetch(
      await envelope({ path: '/../../../etc/passwd' }),
      deps,
    );

    expect(response).toEqual(NOT_FOUND);
    expect(JSON.stringify(response)).not.toContain('root:');
  });

  it('returns not found for a file the document root does not publish', async () => {
    const { deps } = makeDeps();

    expect(
      await handleResolveOccupantFetch(await envelope({ path: '/secret.html' }), deps),
    ).toEqual(NOT_FOUND);
  });
});

describe('an address nothing answers at', () => {
  it('is unreachable when nobody holds the address', async () => {
    const { deps, upsertPatch } = makeDeps();

    expect(
      await handleResolveOccupantFetch(
        await envelope({ target: lanAddressFor(ESSID, VACANT_OCTET) }),
        deps,
      ),
    ).toEqual(UNREACHABLE);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it.each([
    ['no leases', { listLeasesByEssid: async () => ({ data: null, error: null }) }],
    ['no occupants', { listOccupantsByEssid: async () => ({ data: null, error: null }) }],
  ] satisfies readonly (readonly [string, Overrides])[])(
    'is unreachable on a network the lookup finds %s on',
    async (_label, over) => {
      const { deps } = makeDeps(over);

      expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual(UNREACHABLE);
    },
  );

  it('is unreachable when the holder of the lease has left the WiFi', async () => {
    // A lease outlives occupancy, so the address is still Alice's. Her box is not here.
    const { deps, findPatches } = makeDeps({
      listOccupantsByEssid: async () => ({ data: [bobOccupant], error: null }),
    });

    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual(UNREACHABLE);
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('is unreachable when the box cannot boot, whatever its document root still holds', async () => {
    const { deps, upsertPatch } = makeDeps({ aliceJournal: aliceServing(bootTombstone) });

    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual(UNREACHABLE);
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

describe('a box that is there and does not serve the web', () => {
  it('refuses the connection when no web server is running', async () => {
    const { deps, upsertPatch } = makeDeps({ aliceJournal: [publishedPage(ALICE_PAGE)] });

    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual(REFUSED);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a port that something other than a web server holds', async () => {
    const { deps } = makeDeps({ aliceJournal: aliceServing(sshdUp) });

    expect(
      await handleResolveOccupantFetch(
        await envelope({ port: SERVICE_CATALOG.ssh.defaultPort }),
        deps,
      ),
    ).toEqual(REFUSED);
  });

  it('refuses a web port the owner closed to the network, as a scan shows it shut', async () => {
    const { deps, upsertPatch } = makeDeps({
      aliceJournal: aliceServing(filtering(HTTP_DEFAULT_PORT)),
    });

    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual(REFUSED);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a web port the owner closed while leaving another open', async () => {
    const { deps } = makeDeps({
      aliceJournal: aliceServing(sshdUp, filtering(HTTP_DEFAULT_PORT)),
    });

    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual(REFUSED);
  });

  it('serves a web port the owner left open while closing another', async () => {
    const { deps } = makeDeps({
      aliceJournal: aliceServing(sshdUp, filtering(SERVICE_CATALOG.ssh.defaultPort)),
    });

    expect((await handleResolveOccupantFetch(await envelope(), deps)).status).toBe(200);
  });
});

describe('the visit is recorded on the box that answered', () => {
  it('appends one line to the OWNER’s log, from the address the caller holds on the LAN', async () => {
    const { deps, upsertPatch } = makeDeps();

    await handleResolveOccupantFetch(await envelope(), deps);

    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: ALICE.publicKeyHex,
        machine_id: ALICE_WS,
        path: ACCESS_LOG_PATH,
        content: `${accessLine({ size: ALICE_PAGE.length })}\n`,
      }),
    );
  });

  it('records the path that was asked for, and a miss as readily as a hit', async () => {
    const { deps, upsertPatch } = makeDeps();

    await handleResolveOccupantFetch(await envelope({ path: '/admin.php' }), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${accessLine({ path: '/admin.php', status: 404 })}\n`,
      }),
    );
  });

  it('records a traversal as it was written, not as it resolved', async () => {
    const { deps, upsertPatch } = makeDeps();

    await handleResolveOccupantFetch(await envelope({ path: '/../../etc/passwd' }), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${accessLine({ path: '/../../etc/passwd', status: 404 })}\n`,
      }),
    );
  });

  it('accretes onto the log the box already holds', async () => {
    const previous = '203.0.113.9 - - [29/Jul/2026:09:00:00 +0000] "GET / HTTP/1.1" 200 12\n';
    const { deps, upsertPatch, readLog } = makeDeps({ readLog: async () => logRead(previous) });

    await handleResolveOccupantFetch(await envelope(), deps);

    expect(readLog).toHaveBeenCalledWith({ machine_id: ALICE_WS, path: ACCESS_LOG_PATH });
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${previous}${accessLine({ size: ALICE_PAGE.length })}\n`,
      }),
    );
  });

  it('records a caller the LAN cannot place as unknown, never as an address they sent', async () => {
    // On the network, holding no lease: there is no address to derive.
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({ data: { essid: ESSID, octet: null }, error: null }),
    });

    await handleResolveOccupantFetch(
      await signRequest(BOB, 'resolveOccupantFetch', {
        essid: ESSID,
        target: ALICE_LAN_IP,
        port: HTTP_DEFAULT_PORT,
        path: '/',
        source_ip: '10.6.6.6',
      }),
      deps,
    );

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${accessLine({ sourceIp: 'unknown', size: ALICE_PAGE.length })}\n`,
      }),
    );
  });

  it('serves the page even when the line cannot be written', async () => {
    const { deps } = makeDeps({
      upsertPatch: async () => {
        throw new Error('storage down');
      },
    });

    expect((await handleResolveOccupantFetch(await envelope(), deps)).body).toMatchObject({
      content: ALICE_PAGE,
    });
  });
});

describe('a caller in a shell on the box they fetch', () => {
  /** Bob holds a guest shell on Alice's workstation and names it as where he stands. */
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

  it('is served the box’s own page at the box’s own address, logged from that address', async () => {
    const { deps, upsertPatch } = shellOnAliceBox();

    expect(
      await handleResolveOccupantFetch(await envelope({ caller_machine_id: ALICE_WS }), deps),
    ).toEqual({ status: 200, body: { ok: true, content: ALICE_PAGE, server: 'nginx' } });
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: ALICE.publicKeyHex,
        machine_id: ALICE_WS,
        content: `${accessLine({ sourceIp: ALICE_LAN_IP, size: ALICE_PAGE.length })}\n`,
      }),
    );
  });

  it('is served a port the owner closed to the network, since nothing stands between a box and itself', async () => {
    const { deps } = shellOnAliceBox({
      aliceJournal: aliceServing(filtering(HTTP_DEFAULT_PORT)),
    });

    expect(
      (await handleResolveOccupantFetch(await envelope({ caller_machine_id: ALICE_WS }), deps))
        .status,
    ).toBe(200);
  });

  // `localhost` typed in that shell. The box is the one the shell stands on, found by
  // what it is: a visitor holds no address to name it by.
  it('is served the box’s own page over loopback, logged as a local visit', async () => {
    const { deps, upsertPatch } = shellOnAliceBox();

    expect(
      await handleResolveOccupantFetch(
        await envelope({ target: LOOPBACK_IPV4, caller_machine_id: ALICE_WS }),
        deps,
      ),
    ).toEqual({ status: 200, body: { ok: true, content: ALICE_PAGE, server: 'nginx' } });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: ALICE.publicKeyHex,
        machine_id: ALICE_WS,
        content: `${accessLine({ sourceIp: LOOPBACK_IPV4, size: ALICE_PAGE.length })}\n`,
      }),
    );
  });

  it('is served over loopback a port the owner closed to the network', async () => {
    const { deps } = shellOnAliceBox({
      aliceJournal: aliceServing(filtering(HTTP_DEFAULT_PORT)),
    });

    expect(
      (
        await handleResolveOccupantFetch(
          await envelope({ target: LOOPBACK_IPV4, caller_machine_id: ALICE_WS }),
          deps,
        )
      ).status,
    ).toBe(200);
  });

  it('is refused over loopback when the box runs no web server', async () => {
    const { deps, upsertPatch } = shellOnAliceBox({ aliceJournal: [sshdUp] });

    expect(
      await handleResolveOccupantFetch(
        await envelope({ target: LOOPBACK_IPV4, caller_machine_id: ALICE_WS }),
        deps,
      ),
    ).toEqual(REFUSED);
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

describe('loopback from a caller who stands on no neighbour’s box', () => {
  it('names nobody’s box, so nothing answers and nothing is logged', async () => {
    // Bob at home, where his own client serves `localhost` off his own tree. Loopback
    // must never fall through to whoever else is on the WiFi.
    const { deps, findPatches, upsertPatch } = makeDeps();

    expect(
      await handleResolveOccupantFetch(await envelope({ target: LOOPBACK_IPV4 }), deps),
    ).toEqual(UNREACHABLE);
    expect(findPatches).not.toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

describe('the LAN boundary', () => {
  it('refuses a caller standing on another network, before anything is read', async () => {
    const { deps, listOccupantsByEssid, listLeasesByEssid, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({
        data: { essid: 'SOMEWHERE-ELSE', octet: BOB_OCTET },
        error: null,
      }),
    });

    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual({
      status: 403,
      body: { error: 'wrong_network' },
    });
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
    expect(listLeasesByEssid).not.toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a caller on no network at all', async () => {
    const { deps } = makeDeps({ findHomeVantage: async () => ({ data: null, error: null }) });

    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual({
      status: 403,
      body: { error: 'caller_not_on_network' },
    });
  });

  it('refuses a caller naming a box they hold no shell on', async () => {
    const { deps, listOccupantsByEssid } = makeDeps();

    expect(
      await handleResolveOccupantFetch(await envelope({ caller_machine_id: ALICE_WS }), deps),
    ).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
  });
});

describe('a request the server does not trust', () => {
  it('rejects an envelope whose signature does not verify', async () => {
    const { deps, listOccupantsByEssid } = makeDeps();
    const signed = await envelope();

    const response = await handleResolveOccupantFetch(
      { ...signed, signature: signed.signature.replace(/^../, '00') },
      deps,
    );

    expect(response).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(listOccupantsByEssid).not.toHaveBeenCalled();
  });

  it('rejects a payload that claims an identity', async () => {
    const { deps } = makeDeps();

    const response = await handleResolveOccupantFetch(
      await signRequest(BOB, 'resolveOccupantFetch', {
        essid: ESSID,
        target: ALICE_LAN_IP,
        port: HTTP_DEFAULT_PORT,
        path: '/',
        player_key: ALICE.publicKeyHex,
      }),
      deps,
    );

    expect(response).toEqual({ status: 400, body: { error: 'payload_invalid' } });
  });

  it.each([
    ['no network', { essid: '' }],
    ['no target', { target: '' }],
    ['no path', { path: '' }],
    ['a port that is not a whole number', { port: 80.5 }],
  ])('rejects a request naming %s', async (_label, asked) => {
    const { deps } = makeDeps();

    expect((await handleResolveOccupantFetch(await envelope(asked), deps)).status).toBe(400);
  });
});

describe('a lookup that fails is a server error, never a derived answer', () => {
  it('reports a failed occupant lookup', async () => {
    const { deps } = makeDeps({
      listOccupantsByEssid: async () => ({ data: null, error: new Error('down') }),
    });

    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual({
      status: 500,
      body: { error: 'occupants_lookup_failed' },
    });
  });

  it('reports a failed lease lookup', async () => {
    const { deps } = makeDeps({
      listLeasesByEssid: async () => ({ data: null, error: new Error('down') }),
    });

    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual({
      status: 500,
      body: { error: 'leases_lookup_failed' },
    });
  });

  it('reports a failed journal read', async () => {
    const { deps } = makeDeps({
      findPatches: async () => ({ data: null, error: new Error('down') }),
    });

    expect(await handleResolveOccupantFetch(await envelope(), deps)).toEqual({
      status: 500,
      body: { error: 'patches_lookup_failed' },
    });
  });
});
