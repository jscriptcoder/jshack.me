import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveHttpFetch,
  type ApNetworkLookup,
  type HttpFetchOccupant,
  type ResolveHttpFetchDeps,
} from './resolveHttpFetch';
import { md5 } from '../generation/md5';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeApGatewayId } from '../identity/router';
import { lanAddressFor, type LanLeaseRow } from './lanAddress';
import { materializeWorkstationFs, type OwnerPatchRow } from './materializeWorkstationFs';
import { createFsView } from '../filesystem/fsView';
import { defaultFilePermissions } from '../filesystem/defaultPermissions';
import { formatPidfileContent } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { HTTP_DEFAULT_PORT } from './http';
import { ACCESS_LOG_PATH } from '../logging/accessLog';
import { asAbsPath } from '../types';
import type { NonceStore } from '../signedRequest/nonceStore';
import type {
  MachineLogReadQuery,
  MachineLogReadResult,
} from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';

/**
 * `handleResolveHttpFetch` is the credential-free cross-player door: a fetch carries no
 * session and no password, so reachability IS the whole gate. It resolves a public IP to
 * the AP's gateway, routes the destination port through the same `machineServing` the ssh
 * gate uses, and returns ONE file from the reached box's document root.
 *
 * Two failure shapes, and the difference matters: `host_unreachable` is a connect-level
 * refusal that collapses every cause (unknown IP, bricked gateway, bricked occupant, no
 * forward, nothing listening) so a prober learns nothing from which one it hit;
 * `not_found` is the HTTP-level 404 a reachable web server returns for a path it does not
 * publish.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const TARGET = '203.0.113.7';
const ESSID = 'BEAN-THERE-WIFI';

// Two identities: ALICE publishes the page, BOB fetches it. Bob holds no session on
// Alice's box and never supplies a credential — that is the point of this door.
const ALICE = generateIdentity();
const BOB = generateIdentity();

const AP_GATEWAY_ID = computeApGatewayId(ESSID);
const ALICE_WS = 'workstation-a1b2c3d4';
const BOB_WS = 'workstation-b5c6d7e8';
const ALICE_OCTET = 84;
const BOB_OCTET = 112;
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

const REGISTERED: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: ESSID };

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

/** A root `nano /etc/iptables/rules.v4` edit on the GATEWAY's journal — the opt-in that
 *  exposes a box behind the NAT. */
const forwards = (...lines: readonly string[]): OwnerPatchRow =>
  journalRow({ path: '/etc/iptables/rules.v4', content: lines.join('\n') });
const forwardTo = (publicPort: number, internalIp: string, internalPort: number): string =>
  `forward ${publicPort} to ${internalIp}:${internalPort}`;

/** The occupant started `nginx` — the pidfile is what makes the port live, so a fresh
 *  box (empty `/var/run`) is dark behind its forward until its owner starts the daemon. */
const webServerUp = (port = HTTP_DEFAULT_PORT): OwnerPatchRow =>
  journalRow({
    path: `/var/run/${SERVICE_CATALOG.http.pidfile}`,
    content: formatPidfileContent(SERVICE_CATALOG.http, port),
  });

const sshdUp = journalRow({
  path: `/var/run/${SERVICE_CATALOG.ssh.pidfile}`,
  content: formatPidfileContent(SERVICE_CATALOG.ssh, 22),
});

/**
 * A page the owner published with `nano` as root.
 *
 * The permissions are the load-bearing detail: nothing but root may write under the
 * document root, so a real published page is stamped `defaultFilePermissions('root')` —
 * root-readable and NOTHING else. A server that read the file as its caller would 404
 * the owner's own page.
 */
const publishedPage = (content: string, path = 'index.html'): OwnerPatchRow =>
  journalRow({
    path: `/var/www/html/${path}`,
    content,
    permissions: defaultFilePermissions('root'),
  });

/** A root `rm /boot/vmlinuz` tombstone — replayed, the kernel is gone and `canBoot`
 *  reports that box bricked. */
const bootTombstone = journalRow({ path: '/boot/vmlinuz', content: null, nodeType: null });

const ALICE_PAGE = '<h1>alice was here</h1>';

type LookupResult = { data: ApNetworkLookup | null; error: unknown };
type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };
type OccupantsResult = { data: readonly HttpFetchOccupant[] | null; error: unknown };
type LeasesResult = { data: readonly LanLeaseRow[] | null; error: unknown };

/** Route the per-machine journal read by `machine_id`: the gateway's forward table and
 *  each occupant's running services and pages live on different machines. */
const patchesByMachine =
  (byId: Readonly<Record<string, readonly OwnerPatchRow[]>>) =>
  async ({ machine_id }: { machine_id: string }): Promise<PatchesResult> => ({
    data: byId[machine_id] ?? [],
    error: null,
  });

/** The universe clock at the moment the server records a hit — fixed so the rendered
 *  timestamp is asserted literally rather than recomputed by the test. */
const FETCH_TIME = Date.UTC(2026, 6, 30, 13, 55, 36);
/** Bob's OWN home public IP: what the server derives for him from his verified key,
 *  and the only address the line may carry. */
const BOB_PUBLIC_IP = '198.51.100.22';

type HomeNetworkResult = { data: { readonly public_ip: string } | null; error: unknown };

type FetchOverrides = {
  lookup?: (publicIp: string) => Promise<LookupResult>;
  patches?: (query: { machine_id: string }) => Promise<PatchesResult>;
  listOccupantsByEssid?: (essid: string) => Promise<OccupantsResult>;
  listLeasesByEssid?: (essid: string) => Promise<LeasesResult>;
  readLog?: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  upsertPatch?: (row: PatchRow) => Promise<{ error: unknown }>;
  findHomeNetworkByOwnerKey?: (ownerKey: string) => Promise<HomeNetworkResult>;
};

const makeDeps = (over: FetchOverrides = {}) => {
  const findNetworkByPublicIp = vi.fn<(publicIp: string) => Promise<LookupResult>>(
    over.lookup ?? (async () => ({ data: REGISTERED, error: null })),
  );
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(
    over.patches ?? (async () => ({ data: [], error: null })),
  );
  const listOccupantsByEssid = vi.fn<(essid: string) => Promise<OccupantsResult>>(
    over.listOccupantsByEssid ?? (async () => ({ data: BOTH_OCCUPANTS, error: null })),
  );
  const listLeasesByEssid = vi.fn<(essid: string) => Promise<LeasesResult>>(
    over.listLeasesByEssid ?? (async () => ({ data: BOTH_LEASES, error: null })),
  );
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    over.readLog ?? (async () => ({ data: null, error: null })),
  );
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(
    over.upsertPatch ?? (async () => ({ error: null })),
  );
  const findHomeNetworkByOwnerKey = vi.fn<(ownerKey: string) => Promise<HomeNetworkResult>>(
    over.findHomeNetworkByOwnerKey ?? (async () => ({ data: { public_ip: BOB_PUBLIC_IP }, error: null })),
  );
  const deps: ResolveHttpFetchDeps = {
    nonceStore: freshStore,
    findNetworkByPublicIp,
    findPatches,
    listOccupantsByEssid,
    listLeasesByEssid,
    now: () => FETCH_TIME,
    readLog,
    upsertPatch,
    findHomeNetworkByOwnerKey,
  };
  return {
    deps,
    findNetworkByPublicIp,
    findPatches,
    listOccupantsByEssid,
    listLeasesByEssid,
    readLog,
    upsertPatch,
    findHomeNetworkByOwnerKey,
  };
};

const envelope = (fields: Record<string, unknown> = {}) =>
  signRequest(BOB, 'resolveHttpFetch', { target: TARGET, port: HTTP_DEFAULT_PORT, path: '/', ...fields });

/** Alice forwards :80 to her own box and is serving a page there — the reachable
 *  baseline every failure case below breaks in exactly one way. */
const aliceServing = (...extraRows: readonly OwnerPatchRow[]) =>
  patchesByMachine({
    [AP_GATEWAY_ID]: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT))],
    [ALICE_WS]: [webServerUp(), publishedPage(ALICE_PAGE), ...extraRows],
  });

describe('a stranger fetches a page behind a NAT forward', () => {
  it('returns the page, with no session and no credential — read as the server, not the caller', async () => {
    const { deps } = makeDeps({ patches: aliceServing() });

    // The premise this test would otherwise pass for the wrong reason: Alice's page is
    // root-only, so a fetch that read it as its (accountless) caller would 404 it.
    const aliceFs = materializeWorkstationFs(aliceOccupant, [publishedPage(ALICE_PAGE)]);
    expect(createFsView(aliceFs, {}).read(asAbsPath('/var/www/html/index.html'))).toEqual({
      ok: false,
      error: 'permission_denied',
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, content: ALICE_PAGE },
    });
  });

  it('serves a named path under the document root', async () => {
    const { deps } = makeDeps({
      patches: aliceServing(publishedPage('<h1>status: green</h1>', 'status.html')),
    });

    expect(await handleResolveHttpFetch(envelope({ path: '/status.html' }), deps)).toEqual({
      status: 200,
      body: { ok: true, content: '<h1>status: green</h1>' },
    });
  });

  it('reaches the occupant who LEASES the forwarded address, not merely any occupant', async () => {
    const { deps } = makeDeps({
      patches: patchesByMachine({
        [AP_GATEWAY_ID]: [
          forwards(
            forwardTo(8080, ALICE_LAN_IP, HTTP_DEFAULT_PORT),
            forwardTo(9090, BOB_LAN_IP, HTTP_DEFAULT_PORT),
          ),
        ],
        [ALICE_WS]: [webServerUp(), publishedPage('<h1>alice</h1>')],
        [BOB_WS]: [webServerUp(), publishedPage('<h1>bob</h1>')],
      }),
    });

    expect(await handleResolveHttpFetch(envelope({ port: 8080 }), deps)).toEqual({
      status: 200,
      body: { ok: true, content: '<h1>alice</h1>' },
    });
    expect(await handleResolveHttpFetch(envelope({ port: 9090 }), deps)).toEqual({
      status: 200,
      body: { ok: true, content: '<h1>bob</h1>' },
    });
  });

  it('serves a forward whose internal web server listens on a non-default port', async () => {
    const { deps } = makeDeps({
      patches: patchesByMachine({
        [AP_GATEWAY_ID]: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, 8000))],
        [ALICE_WS]: [webServerUp(8000), publishedPage(ALICE_PAGE)],
      }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, content: ALICE_PAGE },
    });
  });

  it('defaults to port 80 when the envelope carries no port', async () => {
    const { deps } = makeDeps({ patches: aliceServing() });
    const noPort = signRequest(BOB, 'resolveHttpFetch', { target: TARGET, path: '/' });

    expect(await handleResolveHttpFetch(noPort, deps)).toEqual({
      status: 200,
      body: { ok: true, content: ALICE_PAGE },
    });
  });
});

describe('a target that cannot be reached refuses, and says only that', () => {
  const unreachable = { status: 404, body: { error: 'host_unreachable' } };

  it('refuses a public IP no access point bears', async () => {
    const { deps } = makeDeps({ lookup: async () => ({ data: null, error: null }) });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual(unreachable);
  });

  it('refuses when the gateway is bricked, taking the whole public IP dark', async () => {
    const { deps } = makeDeps({
      patches: patchesByMachine({
        [AP_GATEWAY_ID]: [
          forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT)),
          bootTombstone,
        ],
        [ALICE_WS]: [webServerUp(), publishedPage(ALICE_PAGE)],
      }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual(unreachable);
  });

  it('refuses when the box behind the forward is bricked, page or no page', async () => {
    const { deps } = makeDeps({ patches: aliceServing(bootTombstone) });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual(unreachable);
  });

  it('refuses when the forwarded address belongs to nobody on the WiFi', async () => {
    const { deps } = makeDeps({
      patches: aliceServing(),
      listOccupantsByEssid: async () => ({ data: [bobOccupant], error: null }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual(unreachable);
  });

  it('refuses a port nothing forwards', async () => {
    const { deps } = makeDeps({ patches: aliceServing() });

    expect(await handleResolveHttpFetch(envelope({ port: 8080 }), deps)).toEqual(unreachable);
  });

  it('refuses when the box behind the forward runs no web server', async () => {
    const { deps } = makeDeps({
      patches: patchesByMachine({
        [AP_GATEWAY_ID]: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT))],
        [ALICE_WS]: [publishedPage(ALICE_PAGE)],
      }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual(unreachable);
  });

  it('refuses a forward whose internal port serves something other than the web', async () => {
    const { deps } = makeDeps({
      patches: patchesByMachine({
        [AP_GATEWAY_ID]: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, 22))],
        [ALICE_WS]: [sshdUp, publishedPage(ALICE_PAGE)],
      }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual(unreachable);
  });

  it("refuses the gateway's own ssh port — it listens, but not for the web", async () => {
    const { deps } = makeDeps({ patches: aliceServing() });

    expect(await handleResolveHttpFetch(envelope({ port: 22 }), deps)).toEqual(unreachable);
  });

  it('refuses when the web server listens on a port the forward does not name', async () => {
    // The forward lands on :80 but the daemon came up on :8000. Something IS serving the
    // web on that box — just not where the forward points, so nothing answers.
    const { deps } = makeDeps({
      patches: patchesByMachine({
        [AP_GATEWAY_ID]: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT))],
        [ALICE_WS]: [webServerUp(8000), publishedPage(ALICE_PAGE)],
      }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual(unreachable);
  });

  it('refuses when the occupancy read comes back empty rather than failing', async () => {
    const { deps } = makeDeps({
      patches: aliceServing(),
      listOccupantsByEssid: async () => ({ data: null, error: null }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual(unreachable);
  });

  it('refuses when the lease read comes back empty rather than failing', async () => {
    // No leases means no address of record for anyone, so the forward names nobody. Both
    // halves of the lookup must be present to reach a box; neither is derived when absent.
    const { deps } = makeDeps({
      patches: aliceServing(),
      listLeasesByEssid: async () => ({ data: null, error: null }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual(unreachable);
  });

  it('asks nobody who is on the WiFi when the port is not forwarded at all', async () => {
    // Routing by port comes FIRST: a port nothing serves reaches nothing, and reading the
    // AP's occupancy and leases could not change that. Shedding the work matters because
    // an unforwarded port is what an internet-wide prober mostly hits.
    const { deps, listOccupantsByEssid, listLeasesByEssid } = makeDeps({
      patches: aliceServing(),
    });

    await handleResolveHttpFetch(envelope({ port: 8080 }), deps);

    expect(listOccupantsByEssid).not.toHaveBeenCalled();
    expect(listLeasesByEssid).not.toHaveBeenCalled();
  });
});

describe('a gateway that serves the web itself', () => {
  /** A page published on the ACCESS POINT's own box. Its base FS has no web root at all,
   *  so both the directory and the file arrive on its journal — which is what a root
   *  session on the gateway would actually write. */
  const gatewayServing = () =>
    patchesByMachine({
      [AP_GATEWAY_ID]: [
        forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT)),
        webServerUp(),
        publishedPage('<h1>the router itself</h1>'),
      ],
      [ALICE_WS]: [webServerUp(), publishedPage(ALICE_PAGE)],
    });

  it('answers with its OWN page, not the page of the box it forwards to', async () => {
    // `machineServing` gives a router-own port priority over a forward on the same port —
    // you cannot shadow the gateway's own service from inside its NAT. A fetch has to
    // agree with the scan and the ssh gate about that, or the three describe different
    // machines behind one address.
    const { deps } = makeDeps({ patches: gatewayServing() });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, content: '<h1>the router itself</h1>' },
    });
  });

  it('never reaches into an occupant to answer for the gateway', async () => {
    const { deps, listOccupantsByEssid } = makeDeps({ patches: gatewayServing() });

    await handleResolveHttpFetch(envelope(), deps);

    expect(listOccupantsByEssid).not.toHaveBeenCalled();
  });
});

describe('what a fetch can never reach', () => {
  const notFound = { status: 404, body: { error: 'not_found' } };

  it('returns not found for a path that climbs out of the document root', async () => {
    const { deps } = makeDeps({ patches: aliceServing() });

    const response = await handleResolveHttpFetch(
      envelope({ path: '/../../../etc/passwd' }),
      deps,
    );

    expect(response).toEqual(notFound);
    expect(JSON.stringify(response)).not.toContain('root:');
  });

  it('returns not found for an allowlisted file that sits outside the web root', async () => {
    const { deps } = makeDeps({ patches: aliceServing() });

    expect(
      await handleResolveHttpFetch(envelope({ path: '/../run/nginx.pid' }), deps),
    ).toEqual(notFound);
  });

  it('returns not found for a file the document root does not publish', async () => {
    const { deps } = makeDeps({ patches: aliceServing() });

    expect(await handleResolveHttpFetch(envelope({ path: '/secret.html' }), deps)).toEqual(
      notFound,
    );
  });
});

describe('a lookup that fails is a server error, never a derived answer', () => {
  it('reports a failed public-IP lookup', async () => {
    const { deps } = makeDeps({
      lookup: async () => ({ data: null, error: new Error('down') }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 500,
      body: { error: 'network_lookup_failed' },
    });
  });

  it('reports a failed journal read', async () => {
    const { deps } = makeDeps({
      patches: async () => ({ data: null, error: new Error('down') }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 500,
      body: { error: 'patches_lookup_failed' },
    });
  });

  it("reports a failed read of the REACHED box's journal, not just the gateway's", async () => {
    // Two journal reads happen, on different machines. A gateway that reads fine and an
    // occupant that does not is the case a single always-failing stub cannot reach.
    const { deps } = makeDeps({
      patches: async ({ machine_id }) =>
        machine_id === ALICE_WS
          ? { data: null, error: new Error('down') }
          : {
              data: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT))],
              error: null,
            },
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 500,
      body: { error: 'patches_lookup_failed' },
    });
  });

  it('reports a failed occupancy read', async () => {
    const { deps } = makeDeps({
      patches: aliceServing(),
      listOccupantsByEssid: async () => ({ data: null, error: new Error('down') }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 500,
      body: { error: 'occupants_lookup_failed' },
    });
  });

  it('reports a failed lease read', async () => {
    const { deps } = makeDeps({
      patches: aliceServing(),
      listLeasesByEssid: async () => ({ data: null, error: new Error('down') }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 500,
      body: { error: 'leases_lookup_failed' },
    });
  });
});

describe('the envelope', () => {
  it('refuses a tampered envelope without looking anything up', async () => {
    const { deps, findNetworkByPublicIp } = makeDeps({ patches: aliceServing() });
    const signed = envelope();
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const response = await handleResolveHttpFetch(tampered, deps);

    expect(response).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findNetworkByPublicIp).not.toHaveBeenCalled();
  });

  it('refuses a request that names no path', async () => {
    // A URL always has a path — `curl http://host` asks for `/`. An envelope without one
    // is malformed, and defaulting it here would let a caller omit the single field the
    // document-root confinement is applied to.
    const { deps, findNetworkByPublicIp } = makeDeps({ patches: aliceServing() });
    const pathless = signRequest(BOB, 'resolveHttpFetch', { target: TARGET, port: 80 });

    expect(await handleResolveHttpFetch(pathless, deps)).toEqual({
      status: 400,
      body: { error: 'payload_invalid' },
    });
    expect(findNetworkByPublicIp).not.toHaveBeenCalled();
  });

  it('refuses a request that claims an identity', async () => {
    const { deps } = makeDeps({ patches: aliceServing() });
    const claiming = signRequest(BOB, 'resolveHttpFetch', {
      target: TARGET,
      path: '/',
      player_key: ALICE.publicKeyHex,
    });

    expect((await handleResolveHttpFetch(claiming, deps)).status).toBe(400);
  });
});

/**
 * The defender's half of the credential-free door. A web server that anyone may read
 * without identifying themselves would be silent surveillance-proof cover, so the hit
 * is recorded on the machine that served it — the log belongs to the SERVER, which is
 * why the requester never has to be anyone for a line to appear.
 *
 * Two rules carry the security weight, and both are mutation targets:
 *
 *   - the line is written under the TARGET OWNER's key, never the requester's, so every
 *     stranger's hits accrete into ONE row instead of colliding under the last-write-wins
 *     fold — and so a requester can never wipe the evidence by writing their own row;
 *   - the source IP is derived server-side from the VERIFIED key, so a client cannot
 *     frame another network by asserting one.
 */
describe('the fetched machine records the hit', () => {
  const accessLine = (fields: {
    readonly sourceIp?: string;
    readonly path?: string;
    readonly status?: number;
    readonly size?: number;
  }) =>
    `${fields.sourceIp ?? BOB_PUBLIC_IP} - - [30/Jul/2026:13:55:36 +0000] "GET ${fields.path ?? '/'} HTTP/1.1" ${fields.status ?? 200} ${fields.size ?? 0}`;

  it('appends one line under the OWNER key, with the server-derived source IP and the requested path', async () => {
    const { deps, upsertPatch, findHomeNetworkByOwnerKey } = makeDeps({ patches: aliceServing() });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, content: ALICE_PAGE },
    });

    // The source IP is looked up for BOB — the verified caller — not for the target.
    expect(findHomeNetworkByOwnerKey).toHaveBeenCalledWith(BOB.publicKeyHex);
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

  it('records the path that was asked for, not the file that answered', async () => {
    const { deps, upsertPatch } = makeDeps({
      patches: aliceServing(publishedPage('<h1>status: green</h1>', 'status.html')),
    });

    await handleResolveHttpFetch(envelope({ path: '/status.html' }), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${accessLine({ path: '/status.html', size: '<h1>status: green</h1>'.length })}\n`,
      }),
    );
  });

  it('records a 404 too — a wall of them is what a directory sweep looks like', async () => {
    const { deps, upsertPatch } = makeDeps({ patches: aliceServing() });

    expect(await handleResolveHttpFetch(envelope({ path: '/admin.php' }), deps)).toEqual({
      status: 404,
      body: { error: 'not_found' },
    });

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: ALICE.publicKeyHex,
        machine_id: ALICE_WS,
        content: `${accessLine({ path: '/admin.php', status: 404 })}\n`,
      }),
    );
  });

  it('accretes onto the existing log rather than replacing it', async () => {
    const previous = '203.0.113.9 - - [29/Jul/2026:09:00:00 +0000] "GET / HTTP/1.1" 200 12\n';
    const { deps, upsertPatch } = makeDeps({
      patches: aliceServing(),
      readLog: async () => ({ data: { content: previous }, error: null }),
    });

    await handleResolveHttpFetch(envelope(), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${previous}${accessLine({ size: ALICE_PAGE.length })}\n`,
      }),
    );
  });

  it('reads the existing log under the OWNER key too — or the append would fork the row', async () => {
    const { deps, readLog } = makeDeps({ patches: aliceServing() });

    await handleResolveHttpFetch(envelope(), deps);

    expect(readLog).toHaveBeenCalledWith({
      writer_key: ALICE.publicKeyHex,
      machine_id: ALICE_WS,
      path: ACCESS_LOG_PATH,
    });
  });

  it('ignores a client-supplied source IP — a caller cannot frame another network', async () => {
    const { deps, upsertPatch } = makeDeps({ patches: aliceServing() });

    await handleResolveHttpFetch(envelope({ source_ip: '10.0.0.66' }), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ content: `${accessLine({ size: ALICE_PAGE.length })}\n` }),
    );
  });

  it('records an actor with no home network as `unknown` rather than dropping the line', async () => {
    const { deps, upsertPatch } = makeDeps({
      patches: aliceServing(),
      findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
    });

    await handleResolveHttpFetch(envelope(), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${accessLine({ sourceIp: 'unknown', size: ALICE_PAGE.length })}\n`,
      }),
    );
  });

  it('logs the GATEWAY arm under the AP log-writer key when the gateway serves its own page', async () => {
    // The AP has no owner, so its log accretes under the lowest-octet lease holder —
    // the same stable key the ssh gate uses, so both logs land in one row.
    const { deps, upsertPatch } = makeDeps({
      patches: patchesByMachine({
        [AP_GATEWAY_ID]: [webServerUp(), publishedPage('<h1>router</h1>')],
      }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, content: '<h1>router</h1>' },
    });

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: ALICE.publicKeyHex,
        machine_id: AP_GATEWAY_ID,
        path: ACCESS_LOG_PATH,
        content: `${accessLine({ size: '<h1>router</h1>'.length })}\n`,
      }),
    );
  });

  it('keeps no gateway log on an ESSID nobody has ever leased', async () => {
    const gatewayOnly = patchesByMachine({
      [AP_GATEWAY_ID]: [webServerUp(), publishedPage('<h1>router</h1>')],
    });
    // Both shapes an empty lease table arrives in — no rows, and no result at all.
    const emptyLeases: readonly LeasesResult[] = [
      { data: [], error: null },
      { data: null, error: null },
    ];

    for (const leases of emptyLeases) {
      const { deps, upsertPatch } = makeDeps({
        patches: gatewayOnly,
        listLeasesByEssid: async () => leases,
      });

      expect((await handleResolveHttpFetch(envelope(), deps)).status).toBe(200);
      expect(upsertPatch).not.toHaveBeenCalled();
    }
  });

  it('serves the gateway page even when the lease read fails — the log is not the product', async () => {
    // Leases decide reachability on the FORWARD arm, where a failed read is a 500. Here
    // they only key the log, so the same failure costs the line and nothing else.
    const { deps, upsertPatch } = makeDeps({
      patches: patchesByMachine({
        [AP_GATEWAY_ID]: [webServerUp(), publishedPage('<h1>router</h1>')],
      }),
      listLeasesByEssid: async () => ({ data: null, error: new Error('leases unavailable') }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, content: '<h1>router</h1>' },
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('leaves no trace on a target that was never reached', async () => {
    // Every `host_unreachable` cause must be equally silent: a line on the box would tell
    // a defender they were probed through a door that did not open, and the prober's own
    // reachability answer already collapses them.
    const unreachable: readonly (readonly [string, FetchOverrides])[] = [
      ['no such public IP', { lookup: async () => ({ data: null, error: null }) }],
      [
        'no forward and no gateway service',
        { patches: patchesByMachine({ [AP_GATEWAY_ID]: [] }) },
      ],
      [
        'forwarded to a box that is not serving the web',
        {
          patches: patchesByMachine({
            [AP_GATEWAY_ID]: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT))],
            [ALICE_WS]: [sshdUp, publishedPage(ALICE_PAGE)],
          }),
        },
      ],
      [
        'forwarded to a bricked box',
        {
          patches: patchesByMachine({
            [AP_GATEWAY_ID]: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT))],
            [ALICE_WS]: [webServerUp(), publishedPage(ALICE_PAGE), bootTombstone],
          }),
        },
      ],
    ];

    for (const [cause, overrides] of unreachable) {
      const { deps, upsertPatch } = makeDeps(overrides);

      expect((await handleResolveHttpFetch(envelope(), deps)).body, cause).toEqual({
        error: 'host_unreachable',
      });
      expect(upsertPatch, cause).not.toHaveBeenCalled();
    }
  });

  it('serves the page even when the log cannot be written', async () => {
    // Best-effort: the fetch is the product, the log is the record of it. A logging
    // failure must never turn a served page into an error the requester can detect —
    // that would leak the defender's storage state to an anonymous stranger.
    const { deps } = makeDeps({
      patches: aliceServing(),
      upsertPatch: async () => {
        throw new Error('journal unavailable');
      },
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, content: ALICE_PAGE },
    });
  });

  it('serves the page, and writes nothing, when the existing log cannot be read', async () => {
    // A contentless write over a log that merely failed to read would erase the very
    // evidence this slice exists to keep.
    const { deps, upsertPatch } = makeDeps({
      patches: aliceServing(),
      readLog: async () => ({ data: null, error: new Error('read failed') }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, content: ALICE_PAGE },
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});
