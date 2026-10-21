import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveHttpFetch,
  type ApNetworkLookup,
  type HttpFetchOccupant,
  type ResolveHttpFetchDeps,
} from './resolveHttpFetch.js';
import { md5 } from '../generation/md5.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeApGatewayId } from '../identity/router.js';
import { lanAddressFor, type LanLeaseRow } from './lanAddress.js';
import { materializeWorkstationFs, type OwnerPatchRow } from './materializeWorkstationFs.js';
import { createFsView } from '../filesystem/fsView.js';
import { defaultFilePermissions } from '../filesystem/defaultPermissions.js';
import {
  formatPidfileContent,
  formatProgramPidfileContent,
  programPidfilePath,
} from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { HTTP_DEFAULT_PORT, METHOD_NOT_ALLOWED_PAGE } from './http.js';
import { ACCESS_LOG_PATH } from '../logging/accessLog.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import { siteServer } from '../generation/siteServer.js';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity.js';
import { asAbsPath } from '../types.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type {
  MachineLogReadQuery,
  MachineLogReadResult,
} from '../patches/appendMachineLog.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import { siteAddress } from '../generation/publisher.js';
import { publicAddress } from '../generation/world.js';
import {
  BOARD_SERVER_NETWORK,
  CHAINIT_NETWORK,
  EMAILIT_DOMAIN,
  EMAILIT_NETWORK,
  FINDIT_DOMAIN,
  FINDIT_NETWORK,
  HACKADEMY_NETWORK,
  HIREME_DOMAIN,
  HIREME_NETWORK,
  TALKIT_NETWORK,
} from '../generation/fixedSites.js';
import type { SignUp } from '../emailit/signup.js';
import type { Apply } from '../hireme/apply.js';
import type { FindBoardHandle } from '../hireme/boards.js';
import { boardPage, HIREME_FRONT_PAGE } from '../hireme/pages.js';
import type { PostThread } from '../talkit/answerPost.js';
import type { PostComment } from '../talkit/answerComment.js';
import { FINDIT_FRONT_PAGE } from '../findit/page.js';
import { EMAILIT_FRONT_PAGE } from '../emailit/pages.js';
import { CHAINIT_FRONT_PAGE } from '../chainit/pages.js';
import type { ChainReads } from '../chainit/chainViews.js';
import { TALKIT_FRONT_PAGE } from '../talkit/pages.js';
import type { ForumReads } from '../talkit/answerViews.js';
import type { WalletBalanceDeps } from '../wallet/handleWalletBalance.js';
import type { WalletHistoryDeps } from '../wallet/handleWalletHistory.js';
import type { MachinePatchRow } from '../findit/webIndex.js';
import { logRead } from '../../test/factories/logRows.js';
import { derivedPublicIpByEssid, type FindPublicIpByEssid } from '../logging/crossPlayerSourceIp.js';
import type { FindActiveSession } from '../patches/authorizeMachineAccess.js';

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

/** The occupant started `apache2` instead: the same web service, its own pidfile. */
const apacheUp = journalRow({
  path: programPidfilePath('apache2'),
  content: formatProgramPidfileContent('apache2', HTTP_DEFAULT_PORT),
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
type WebPatchesResult = { data: readonly MachinePatchRow[] | null; error: unknown };

type FetchOverrides = {
  lookup?: (publicIp: string) => Promise<LookupResult>;
  patches?: (query: { machine_id: string }) => Promise<PatchesResult>;
  listOccupantsByEssid?: (essid: string) => Promise<OccupantsResult>;
  listLeasesByEssid?: (essid: string) => Promise<LeasesResult>;
  readLog?: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  upsertPatch?: (row: PatchRow) => Promise<{ error: unknown }>;
  findHomeNetworkByOwnerKey?: (ownerKey: string) => Promise<HomeNetworkResult>;
  findPatchesForMachines?: (machineIds: readonly string[]) => Promise<WebPatchesResult>;
  findActiveSession?: FindActiveSession;
  findPublicIpByEssid?: FindPublicIpByEssid;
  signUp?: SignUp;
  apply?: Apply;
  findBoardHandle?: FindBoardHandle;
  findBalance?: WalletBalanceDeps['findBalance'];
  findTransfers?: WalletHistoryDeps['findTransfers'];
  findLatestTransfers?: ChainReads['findLatestTransfers'];
  findLargestBalances?: ChainReads['findLargestBalances'];
  findThreads?: ForumReads['findThreads'];
  findThread?: ForumReads['findThread'];
  findComments?: ForumReads['findComments'];
  postThread?: PostThread;
  postComment?: PostComment;
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
  const findPatchesForMachines = vi.fn<
    (machineIds: readonly string[]) => Promise<WebPatchesResult>
  >(over.findPatchesForMachines ?? (async () => ({ data: [], error: null })));
  // Default: the fetcher stands at home, holding no shell — so the trace falls to their
  // own home public IP. Hop tests override `findActiveSession` to seat them on a box.
  const findActiveSession = vi.fn<FindActiveSession>(
    over.findActiveSession ?? (async () => ({ data: null, error: null })),
  );
  const findPublicIpByEssid = vi.fn<FindPublicIpByEssid>(
    over.findPublicIpByEssid ?? derivedPublicIpByEssid,
  );
  // Default: every sign-up opens its account. Only emailit's `/signup` ever asks.
  const signUp = vi.fn<SignUp>(over.signUp ?? (async () => ({ data: 'created', error: null })));
  // Default: every application is mailed. Only hireme's `/apply` ever asks.
  const apply = vi.fn<Apply>(over.apply ?? (async () => ({ data: 'sent', error: null })));
  // Default: nobody holds a board. Only a fetch of a board's address ever asks.
  const findBoardHandle = vi.fn<FindBoardHandle>(
    over.findBoardHandle ?? (async () => ({ data: null, error: null })),
  );
  // Default: the ledger has never seen the address. Only chainit's `/address` ever asks.
  const findBalance = vi.fn<WalletBalanceDeps['findBalance']>(
    over.findBalance ?? (async () => ({ data: null, error: null })),
  );
  const findTransfers = vi.fn<WalletHistoryDeps['findTransfers']>(
    over.findTransfers ?? (async () => ({ data: [], error: null })),
  );
  // Default: the chain has moved nothing. Only chainit's `/recent` and `/rich` ever ask.
  const findLatestTransfers = vi.fn<ChainReads['findLatestTransfers']>(
    over.findLatestTransfers ?? (async () => ({ data: [], error: null })),
  );
  const findLargestBalances = vi.fn<ChainReads['findLargestBalances']>(
    over.findLargestBalances ?? (async () => ({ data: [], error: null })),
  );
  // Default: nobody has started a thread. Only talkit's `/threads` and `/thread` ever ask.
  const findThreads = vi.fn<ForumReads['findThreads']>(
    over.findThreads ?? (async () => ({ data: [], error: null })),
  );
  const findThread = vi.fn<ForumReads['findThread']>(
    over.findThread ?? (async () => ({ data: null, error: null })),
  );
  const findComments = vi.fn<ForumReads['findComments']>(
    over.findComments ?? (async () => ({ data: [], error: null })),
  );
  // Default: every post goes up as thread 12. Only talkit's `/post` ever asks.
  const postThread = vi.fn<PostThread>(
    over.postThread ?? (async () => ({ data: { outcome: 'posted', id: 12 }, error: null })),
  );
  // Default: every comment goes up as #3 on its thread. Only talkit's `/comment` ever asks.
  const postComment = vi.fn<PostComment>(
    over.postComment ??
      (async () => ({ data: { outcome: 'commented', number: 3 }, error: null })),
  );
  const deps: ResolveHttpFetchDeps = {
    nonceStore: freshStore,
    findPatchesForMachines,
    findNetworkByPublicIp,
    findPatches,
    listOccupantsByEssid,
    listLeasesByEssid,
    now: () => FETCH_TIME,
    readLog,
    upsertPatch,
    findHomeNetworkByOwnerKey,
    findActiveSession,
    findPublicIpByEssid,
    signUp,
    apply,
    drawBoardAddress: () => '194.12.40.7',
    findBoardHandle,
    findBalance,
    findTransfers,
    findLatestTransfers,
    findLargestBalances,
    findThreads,
    findThread,
    findComments,
    postThread,
    postComment,
  };
  return {
    deps,
    postThread,
    postComment,
    signUp,
    apply,
    findBoardHandle,
    findBalance,
    findTransfers,
    findLatestTransfers,
    findLargestBalances,
    findThreads,
    findThread,
    findComments,
    findNetworkByPublicIp,
    findPatches,
    listOccupantsByEssid,
    listLeasesByEssid,
    readLog,
    upsertPatch,
    findHomeNetworkByOwnerKey,
    findPatchesForMachines,
    findActiveSession,
    findPublicIpByEssid,
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
      body: { ok: true, content: ALICE_PAGE, server: 'nginx' },
    });
  });

  it('serves a named path under the document root', async () => {
    const { deps } = makeDeps({
      patches: aliceServing(publishedPage('<h1>status: green</h1>', 'status.html')),
    });

    expect(await handleResolveHttpFetch(envelope({ path: '/status.html' }), deps)).toEqual({
      status: 200,
      body: { ok: true, content: '<h1>status: green</h1>', server: 'nginx' },
    });
  });

  it('names the program that served the page, so the caller can say which server answered', async () => {
    const { deps } = makeDeps({
      patches: patchesByMachine({
        [AP_GATEWAY_ID]: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT))],
        [ALICE_WS]: [apacheUp, publishedPage(ALICE_PAGE)],
      }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, content: ALICE_PAGE, server: 'apache2' },
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
      body: { ok: true, content: '<h1>alice</h1>', server: 'nginx' },
    });
    expect(await handleResolveHttpFetch(envelope({ port: 9090 }), deps)).toEqual({
      status: 200,
      body: { ok: true, content: '<h1>bob</h1>', server: 'nginx' },
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
      body: { ok: true, content: ALICE_PAGE, server: 'nginx' },
    });
  });

  it('defaults to port 80 when the envelope carries no port', async () => {
    const { deps } = makeDeps({ patches: aliceServing() });
    const noPort = signRequest(BOB, 'resolveHttpFetch', { target: TARGET, path: '/' });

    expect(await handleResolveHttpFetch(noPort, deps)).toEqual({
      status: 200,
      body: { ok: true, content: ALICE_PAGE, server: 'nginx' },
    });
  });
});

/**
 * An institution publishes its website from a machine on its own LAN, and its gateway
 * forwards the public web port there. Nobody lives on that machine, so a stranger's
 * fetch reaches a generated box rather than a player's — before anybody has joined.
 */
describe("an institution's website, served from a machine nobody owns", () => {
  const PUBLISHER = 'CAMPUS-GUEST-OPEN';
  const server = siteServer(PUBLISHER);
  if (server === undefined) throw new Error(`${PUBLISHER} publishes no website`);
  const serverIdentity = resolveLanHostIdentity(server, PUBLISHER);
  const homepage = createFsView(serverIdentity.baseFs, { userType: 'root' }).read(
    asAbsPath('/var/www/html/index.html'),
  );
  const unjoined = {
    lookup: async () => ({
      data: { router_machine_id: computeApGatewayId(PUBLISHER), essid: PUBLISHER },
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
  };

  it('returns the homepage with nobody ever having joined the network', async () => {
    const { deps } = makeDeps(unjoined);

    const response = await handleResolveHttpFetch(envelope(), deps);

    expect(homepage.ok).toBe(true);
    expect(response).toEqual({
      status: 200,
      body: { ok: true, content: homepage.ok ? homepage.content : '', server: 'nginx' },
    });
  });

  it("records the hit in that machine's access log, under the network's own key", async () => {
    const { deps, upsertPatch } = makeDeps(unjoined);

    await handleResolveHttpFetch(envelope(), deps);

    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch.mock.calls[0]?.[0]).toMatchObject({
      machine_id: serverIdentity.machineId,
      path: ACCESS_LOG_PATH,
      writer_key: apGatewayLogWriterKey(PUBLISHER),
    });
  });

  it('refuses when that machine has been bricked', async () => {
    const { deps } = makeDeps({
      ...unjoined,
      patches: patchesByMachine({ [serverIdentity.machineId]: [bootTombstone] }),
    });

    const response = await handleResolveHttpFetch(envelope(), deps);

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });

  it("reports a failed read of that machine's journal as a server error", async () => {
    const { deps } = makeDeps({
      ...unjoined,
      patches: async ({ machine_id }) =>
        machine_id === serverIdentity.machineId
          ? { data: null, error: new Error('db down') }
          : { data: [], error: null },
    });

    const response = await handleResolveHttpFetch(envelope(), deps);

    expect(response).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('serves what a player has since written to its homepage', async () => {
    const { deps } = makeDeps({
      ...unjoined,
      patches: patchesByMachine({ [serverIdentity.machineId]: [publishedPage('<h1>defaced</h1>')] }),
    });

    const response = await handleResolveHttpFetch(envelope(), deps);

    expect(response).toEqual({ status: 200, body: { ok: true, content: '<h1>defaced</h1>', server: 'nginx' } });
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
      body: { ok: true, content: '<h1>the router itself</h1>', server: 'nginx' },
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
      body: { ok: true, content: ALICE_PAGE, server: 'nginx' },
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
      readLog: async () => logRead(previous),
    });

    await handleResolveHttpFetch(envelope(), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${previous}${accessLine({ size: ALICE_PAGE.length })}\n`,
      }),
    );
  });

  it('reads the existing access log on the fetched machine before appending to it', async () => {
    const { deps, readLog } = makeDeps({ patches: aliceServing() });

    await handleResolveHttpFetch(envelope(), deps);

    expect(readLog).toHaveBeenCalledWith({ machine_id: ALICE_WS, path: ACCESS_LOG_PATH });
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

  it('traces a fetch run from a hop to the hop network public IP, not the caller home', async () => {
    // Bob fetches Alice's page from a box he holds on another network. The line names
    // THAT network's public IP — the hop the traffic actually came from — read off the
    // session row, never his own home.
    const HOP_PUBLIC_IP = '203.0.113.200';
    const { deps, upsertPatch } = makeDeps({
      patches: aliceServing(),
      findActiveSession: async () => ({
        data: { username: 'root', userType: 'root', essid: 'HOP-NET' },
        error: null,
      }),
      findPublicIpByEssid: async (essid) => ({
        data: essid === 'HOP-NET' ? { public_ip: HOP_PUBLIC_IP } : null,
        error: null,
      }),
    });

    await handleResolveHttpFetch(envelope({ caller_machine_id: 'a-hop-box' }), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${accessLine({ sourceIp: HOP_PUBLIC_IP, size: ALICE_PAGE.length })}\n`,
      }),
    );
  });

  it('refuses a fetch naming a box the caller does not hold, logging nothing', async () => {
    const { deps, upsertPatch } = makeDeps({
      patches: aliceServing(),
      findActiveSession: async () => ({ data: null, error: null }),
    });

    expect(await handleResolveHttpFetch(envelope({ caller_machine_id: 'not-mine' }), deps)).toEqual({
      status: 403,
      body: { error: 'no_session' },
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it("logs the GATEWAY arm under the network's own key when the gateway serves its own page", async () => {
    // The AP has no owner, so its log accretes under the network's own stable key — the
    // same one the ssh gate uses, so both logs land in one row.
    const { deps, upsertPatch } = makeDeps({
      patches: patchesByMachine({
        [AP_GATEWAY_ID]: [webServerUp(), publishedPage('<h1>router</h1>')],
      }),
    });

    expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, content: '<h1>router</h1>', server: 'nginx' },
    });

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: apGatewayLogWriterKey(ESSID),
        machine_id: AP_GATEWAY_ID,
        path: ACCESS_LOG_PATH,
        content: `${accessLine({ size: '<h1>router</h1>'.length })}
`,
      }),
    );
  });

  it('logs the gateway hit whatever the lease table says, even on an ESSID nobody has joined', async () => {
    const gatewayOnly = patchesByMachine({
      [AP_GATEWAY_ID]: [webServerUp(), publishedPage('<h1>router</h1>')],
    });
    // The row belongs to the network, so neither an empty lease table nor an unreadable
    // one stands between the hit and its record.
    const leaseAnswers: readonly LeasesResult[] = [
      { data: [], error: null },
      { data: null, error: null },
      { data: null, error: new Error('leases unavailable') },
    ];

    for (const leases of leaseAnswers) {
      const { deps, upsertPatch } = makeDeps({
        patches: gatewayOnly,
        listLeasesByEssid: async () => leases,
      });

      expect(await handleResolveHttpFetch(envelope(), deps)).toEqual({
        status: 200,
        body: { ok: true, content: '<h1>router</h1>', server: 'nginx' },
      });
      expect(upsertPatch).toHaveBeenCalledWith(
        expect.objectContaining({ writer_key: apGatewayLogWriterKey(ESSID), machine_id: AP_GATEWAY_ID }),
      );
    }
  });

  it('leaves no trace on a target that was never reached', async () => {
    // Every `host_unreachable` cause must be equally silent: a line on the box would tell
    // a defender they were probed through a door that did not open, and the prober's own
    // reachability answer already collapses them.
    const unreachable: readonly (readonly [string, FetchOverrides])[] = [
      ['no such public IP', { lookup: async () => ({ data: null, error: null }) }],
      [
        'no forward and no gateway service',
        { patches: patchesByMachine({ [AP_GATEWAY_ID]: [forwards()] }) },
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
      body: { ok: true, content: ALICE_PAGE, server: 'nginx' },
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
      body: { ok: true, content: ALICE_PAGE, server: 'nginx' },
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

describe('a form POSTed across the network', () => {
  const FORM = 'handle=neo&password=s3cret';

  it("is refused by a player's box with a 405 that names the program that answered", async () => {
    const { deps } = makeDeps({ patches: aliceServing() });

    expect(await handleResolveHttpFetch(envelope({ body: FORM }), deps)).toEqual({
      status: 405,
      body: { error: 'method_not_allowed', server: 'nginx' },
    });
  });

  it('is recorded on that box as the POST it was, never with the form', async () => {
    const { deps, upsertPatch } = makeDeps({ patches: aliceServing() });

    await handleResolveHttpFetch(envelope({ body: FORM, path: '/index.html' }), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: ALICE.publicKeyHex,
        machine_id: ALICE_WS,
        path: ACCESS_LOG_PATH,
        content: `${BOB_PUBLIC_IP} - - [30/Jul/2026:13:55:36 +0000] "POST /index.html HTTP/1.1" 405 ${METHOD_NOT_ALLOWED_PAGE.length}\n`,
      }),
    );
  });

  it('is refused by findit too, which runs no search for it', async () => {
    const { deps, findPatchesForMachines } = makeDeps({
      lookup: async () => ({
        data: { router_machine_id: computeApGatewayId(FINDIT_NETWORK), essid: FINDIT_NETWORK },
        error: null,
      }),
      listOccupantsByEssid: async () => ({ data: [], error: null }),
      listLeasesByEssid: async () => ({ data: [], error: null }),
    });

    const response = await handleResolveHttpFetch(
      envelope({ target: siteAddress(FINDIT_DOMAIN), path: '/?q=university', body: FORM }),
      deps,
    );

    expect(response).toEqual({
      status: 405,
      body: { error: 'method_not_allowed', server: 'nginx' },
    });
    expect(findPatchesForMachines).not.toHaveBeenCalled();
  });

  it('reaches nothing where a GET would reach nothing, and leaves no line', async () => {
    const { deps, upsertPatch } = makeDeps({ lookup: async () => ({ data: null, error: null }) });

    expect(await handleResolveHttpFetch(envelope({ body: FORM }), deps)).toEqual({
      status: 404,
      body: { error: 'host_unreachable' },
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  // A post to talkit.io may hold 4,000 characters, each up to 4 UTF-8 bytes and each byte
  // sent as `%XX`, so a form runs to 48 KiB before anyone can call it too long.
  it('takes a form of up to 49,152 characters and refuses a longer one unread', async () => {
    const { deps, findNetworkByPublicIp } = makeDeps({ patches: aliceServing() });

    const atTheLimit = await handleResolveHttpFetch(envelope({ body: 'a'.repeat(49_152) }), deps);
    expect(atTheLimit.status).toBe(405);
    findNetworkByPublicIp.mockClear();
    expect(await handleResolveHttpFetch(envelope({ body: 'a'.repeat(49_153) }), deps)).toEqual({
      status: 400,
      body: { error: 'payload_invalid' },
    });
    expect(findNetworkByPublicIp).not.toHaveBeenCalled();
  });
});

describe('emailit.io signs a reader up', () => {
  const EMAILIT_IP = siteAddress(EMAILIT_DOMAIN) ?? '';
  const EMAILIT_ID = computeApGatewayId(EMAILIT_NETWORK);
  const FORM = 'handle=neo&password=s3cret';
  const onEmailit = {
    lookup: async () => ({
      data: { router_machine_id: EMAILIT_ID, essid: EMAILIT_NETWORK },
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
  };
  const request = (fields: Record<string, unknown>) =>
    signRequest(BOB, 'resolveHttpFetch', {
      target: EMAILIT_IP,
      port: HTTP_DEFAULT_PORT,
      path: '/signup',
      ...fields,
    });
  const contentOf = (response: { body: Record<string, unknown> }): string =>
    typeof response.body.content === 'string' ? response.body.content : '';

  it('opens the account a form at /signup asks for, and welcomes the reader', async () => {
    const { deps } = makeDeps(onEmailit);

    const response = await handleResolveHttpFetch(request({ body: FORM }), deps);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, server: 'nginx' });
    expect(contentOf(response)).toContain('Welcome, neo@emailit.io');
  });

  it('counts the sign-up against the player who sent it, as the signature proves them', async () => {
    const { deps, signUp } = makeDeps(onEmailit);

    await handleResolveHttpFetch(request({ body: FORM }), deps);

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'neo', playerKey: BOB.publicKeyHex }),
    );
  });

  it('answers a refusal the store gives with the front page and its reason', async () => {
    const { deps } = makeDeps({
      ...onEmailit,
      signUp: async () => ({ data: 'taken', error: null }),
    });

    const response = await handleResolveHttpFetch(request({ body: FORM }), deps);

    expect(response.status).toBe(200);
    expect(contentOf(response)).toContain('That handle is taken');
  });

  it('records the sign-up in its log as a POST, with no trace of the form', async () => {
    const { deps, upsertPatch } = makeDeps(onEmailit);

    const response = await handleResolveHttpFetch(request({ body: FORM }), deps);

    const logged = upsertPatch.mock.calls
      .map(([row]) => row)
      .find((row) => row.path === ACCESS_LOG_PATH);
    expect(logged?.machine_id).toBe(EMAILIT_ID);
    expect(logged?.content).toBe(
      `${BOB_PUBLIC_IP} - - [30/Jul/2026:13:55:36 +0000] "POST /signup HTTP/1.1" 200 ${contentOf(response).length}\n`,
    );
    expect(JSON.stringify(upsertPatch.mock.calls)).not.toContain('s3cret');
  });

  it('takes a form at /signup however its query string reads', async () => {
    const { deps, signUp } = makeDeps(onEmailit);

    await handleResolveHttpFetch(request({ path: '/signup?from=front', body: FORM }), deps);

    expect(signUp).toHaveBeenCalledTimes(1);
  });

  it('refuses a form anywhere else on the box, as every other server does', async () => {
    const { deps, signUp } = makeDeps(onEmailit);

    const response = await handleResolveHttpFetch(request({ path: '/', body: FORM }), deps);

    expect(response).toEqual({
      status: 405,
      body: { error: 'method_not_allowed', server: 'nginx' },
    });
    expect(signUp).not.toHaveBeenCalled();
  });

  it('takes no form at /signup on any other site', async () => {
    const { deps, signUp } = makeDeps({ patches: aliceServing() });

    const response = await handleResolveHttpFetch(envelope({ path: '/signup', body: FORM }), deps);

    expect(response.status).toBe(405);
    expect(signUp).not.toHaveBeenCalled();
  });

  // A browser going back to a page it reached by signing up asks for /signup without
  // the form: that gets the form to fill in afresh, and signs nobody up.
  it('serves the sign-up form to a plain fetch of /signup, signing nobody up', async () => {
    const { deps, signUp } = makeDeps(onEmailit);

    expect(await handleResolveHttpFetch(request({}), deps)).toEqual({
      status: 200,
      body: { ok: true, content: EMAILIT_FRONT_PAGE, server: 'nginx' },
    });
    expect(signUp).not.toHaveBeenCalled();
  });

  it('signs nobody up while the box will not come up', async () => {
    const { deps, signUp } = makeDeps({
      ...onEmailit,
      patches: patchesByMachine({
        [EMAILIT_ID]: [{ ...publishedPage(''), path: '/boot/vmlinuz', content: null }],
      }),
    });

    expect(await handleResolveHttpFetch(request({ body: FORM }), deps)).toEqual({
      status: 404,
      body: { error: 'host_unreachable' },
    });
    expect(signUp).not.toHaveBeenCalled();
  });

  it('reports a store it could not reach as a server error, not as a refusal', async () => {
    const { deps } = makeDeps({
      ...onEmailit,
      signUp: async () => ({ data: null, error: { message: 'connection refused' } }),
    });

    expect(await handleResolveHttpFetch(request({ body: FORM }), deps)).toEqual({
      status: 500,
      body: { error: 'signup_failed' },
    });
  });
});

describe('hireme.io takes an application', () => {
  const HIREME_IP = siteAddress(HIREME_DOMAIN) ?? '';
  const HIREME_ID = computeApGatewayId(HIREME_NETWORK);
  const FORM = 'email=neo%40emailit.io';
  const onHireme = {
    lookup: async () => ({
      data: { router_machine_id: HIREME_ID, essid: HIREME_NETWORK },
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
  };
  const request = (fields: Record<string, unknown>) =>
    signRequest(BOB, 'resolveHttpFetch', {
      target: HIREME_IP,
      port: HTTP_DEFAULT_PORT,
      path: '/apply',
      ...fields,
    });
  const contentOf = (response: { body: Record<string, unknown> }): string =>
    typeof response.body.content === 'string' ? response.body.content : '';
  const accessLogOf = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch']) =>
    upsertPatch.mock.calls.map(([row]) => row).find((row) => row.path === ACCESS_LOG_PATH);

  it('mails the board a form at /apply asks for, and thanks the reader', async () => {
    const { deps, apply } = makeDeps(onHireme);

    const response = await handleResolveHttpFetch(request({ body: FORM }), deps);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, server: 'nginx' });
    expect(contentOf(response)).toContain(
      'Thanks, neo. We have sent your contractor board to neo@emailit.io.',
    );
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'neo', candidateAddress: '194.12.40.7' }),
    );
  });

  it('answers a refusal the store gives with the front page and its reason', async () => {
    const { deps } = makeDeps({
      ...onHireme,
      apply: async () => ({ data: 'recent', error: null }),
    });

    const response = await handleResolveHttpFetch(request({ body: FORM }), deps);

    expect(response.status).toBe(200);
    expect(contentOf(response)).toContain('We already have your application. Check your inbox.');
  });

  it('records the application in its log as a POST, with no trace of the form', async () => {
    const { deps, upsertPatch } = makeDeps(onHireme);

    const response = await handleResolveHttpFetch(request({ body: FORM }), deps);

    expect(accessLogOf(upsertPatch)?.machine_id).toBe(HIREME_ID);
    expect(accessLogOf(upsertPatch)?.content).toBe(
      `${BOB_PUBLIC_IP} - - [30/Jul/2026:13:55:36 +0000] "POST /apply HTTP/1.1" 200 ${contentOf(response).length}\n`,
    );
    expect(JSON.stringify(upsertPatch.mock.calls)).not.toContain('neo');
  });

  it('takes a form at /apply however its query string reads', async () => {
    const { deps, apply } = makeDeps(onHireme);

    await handleResolveHttpFetch(request({ path: '/apply?from=front', body: FORM }), deps);

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('refuses a form anywhere else on the box, as every other server does', async () => {
    const { deps, apply } = makeDeps(onHireme);

    const response = await handleResolveHttpFetch(request({ path: '/', body: FORM }), deps);

    expect(response).toEqual({
      status: 405,
      body: { error: 'method_not_allowed', server: 'nginx' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('takes no form at /apply on any other site', async () => {
    const { deps, apply } = makeDeps({ patches: aliceServing() });

    const response = await handleResolveHttpFetch(envelope({ path: '/apply', body: FORM }), deps);

    expect(response.status).toBe(405);
    expect(apply).not.toHaveBeenCalled();
  });

  it('takes no application at emailit, whose /apply is no form', async () => {
    const { deps, apply } = makeDeps({
      ...onHireme,
      lookup: async () => ({
        data: { router_machine_id: computeApGatewayId(EMAILIT_NETWORK), essid: EMAILIT_NETWORK },
        error: null,
      }),
    });

    const response = await handleResolveHttpFetch(request({ body: FORM }), deps);

    expect(response.status).toBe(405);
    expect(apply).not.toHaveBeenCalled();
  });

  // A browser going back to a page it reached by applying asks for /apply without the
  // form: that gets the form to fill in afresh, and mails nobody.
  it('serves the application form to a plain fetch of /apply, mailing nobody', async () => {
    const { deps, apply } = makeDeps(onHireme);

    expect(await handleResolveHttpFetch(request({}), deps)).toEqual({
      status: 200,
      body: { ok: true, content: HIREME_FRONT_PAGE, server: 'nginx' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('still takes applications on a box whose front page a root defaced', async () => {
    const { deps, apply } = makeDeps({
      ...onHireme,
      patches: patchesByMachine({ [HIREME_ID]: [publishedPage('<h1>OWNED</h1>')] }),
    });

    expect(contentOf(await handleResolveHttpFetch(request({ path: '/' }), deps))).toBe(
      '<h1>OWNED</h1>',
    );
    const response = await handleResolveHttpFetch(request({ body: FORM }), deps);
    expect(contentOf(response)).toContain('Thanks, neo.');
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['bricked', '/boot/vmlinuz'],
    ['whose web server was stopped', `/var/run/${SERVICE_CATALOG.http.pidfile}`],
  ])('takes no application when the box is %s', async (_case, removed) => {
    const { deps, apply } = makeDeps({
      ...onHireme,
      patches: patchesByMachine({
        [HIREME_ID]: [{ ...publishedPage(''), path: removed, content: null, node_type: null }],
      }),
    });

    expect(await handleResolveHttpFetch(request({ body: FORM }), deps)).toEqual({
      status: 404,
      body: { error: 'host_unreachable' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('reports a store it could not reach as a server error, and records nothing', async () => {
    const { deps, upsertPatch } = makeDeps({
      ...onHireme,
      apply: async () => ({ data: null, error: { message: 'connection refused' } }),
    });

    expect(await handleResolveHttpFetch(request({ body: FORM }), deps)).toEqual({
      status: 500,
      body: { error: 'apply_failed' },
    });
    expect(accessLogOf(upsertPatch)).toBeUndefined();
  });
});

describe("a contractor board answers at its address", () => {
  const BOARDS_ID = computeApGatewayId(BOARD_SERVER_NETWORK);
  const NEO_BOARD = '194.12.40.7';
  const TRINITY_BOARD = '194.200.3.254';
  const HOLDERS: Readonly<Record<string, string>> = {
    [NEO_BOARD]: 'neo',
    [TRINITY_BOARD]: 'trinity',
  };
  const onBoards = {
    lookup: async () => ({
      data: { router_machine_id: BOARDS_ID, essid: BOARD_SERVER_NETWORK },
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
    findBoardHandle: async (address: string) => {
      const handle = HOLDERS[address];
      return { data: handle === undefined ? null : { handle }, error: null };
    },
  };
  const request = (fields: Record<string, unknown>) =>
    signRequest(BOB, 'resolveHttpFetch', {
      target: NEO_BOARD,
      port: HTTP_DEFAULT_PORT,
      path: '/',
      ...fields,
    });
  const contentOf = (response: { body: Record<string, unknown> }): string =>
    typeof response.body.content === 'string' ? response.body.content : '';
  const accessLogOf = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch']) =>
    upsertPatch.mock.calls.map(([row]) => row).find((row) => row.path === ACCESS_LOG_PATH);

  it('answers the board of the handle that holds the address asked', async () => {
    const { deps, findBoardHandle } = makeDeps(onBoards);

    expect(await handleResolveHttpFetch(request({}), deps)).toEqual({
      status: 200,
      body: { ok: true, content: boardPage('neo'), server: 'nginx' },
    });
    expect(findBoardHandle).toHaveBeenCalledWith(NEO_BOARD);
  });

  it("answers another handle's address with that handle's board", async () => {
    const { deps } = makeDeps(onBoards);

    const response = await handleResolveHttpFetch(request({ target: TRINITY_BOARD }), deps);

    expect(contentOf(response)).toBe(boardPage('trinity'));
  });

  it('answers the board however its query string reads', async () => {
    const { deps } = makeDeps(onBoards);

    const response = await handleResolveHttpFetch(request({ path: '/?from=mail' }), deps);

    expect(contentOf(response)).toBe(boardPage('neo'));
  });

  // Every board's address lands on the one box and its one log, so the line names the
  // address asked, or a root reading it could not tell whose board was read.
  it('records the read with the address it asked, under the boards server', async () => {
    const { deps, upsertPatch } = makeDeps(onBoards);

    const response = await handleResolveHttpFetch(request({}), deps);

    expect(accessLogOf(upsertPatch)?.machine_id).toBe(BOARDS_ID);
    expect(accessLogOf(upsertPatch)?.content).toBe(
      `${BOB_PUBLIC_IP} - - [30/Jul/2026:13:55:36 +0000] "GET http://${NEO_BOARD}/ HTTP/1.1" 200 ${contentOf(response).length}\n`,
    );
  });

  it('serves any other path from its disk, which publishes nothing, and records the miss', async () => {
    const { deps, upsertPatch, findBoardHandle } = makeDeps(onBoards);

    const response = await handleResolveHttpFetch(request({ path: '/index.html' }), deps);

    expect(response).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(accessLogOf(upsertPatch)?.content).toBe(
      `${BOB_PUBLIC_IP} - - [30/Jul/2026:13:55:36 +0000] "GET http://${NEO_BOARD}/index.html HTTP/1.1" 404 0\n`,
    );
    expect(findBoardHandle).not.toHaveBeenCalled();
  });

  it('refuses a form, as every server but the ones that take one does', async () => {
    const { deps, upsertPatch, findBoardHandle } = makeDeps(onBoards);

    const response = await handleResolveHttpFetch(request({ body: 'contract=1' }), deps);

    expect(response).toEqual({
      status: 405,
      body: { error: 'method_not_allowed', server: 'nginx' },
    });
    expect(accessLogOf(upsertPatch)?.content).toBe(
      `${BOB_PUBLIC_IP} - - [30/Jul/2026:13:55:36 +0000] "POST http://${NEO_BOARD}/ HTTP/1.1" 405 ${METHOD_NOT_ALLOWED_PAGE.length}\n`,
    );
    expect(findBoardHandle).not.toHaveBeenCalled();
  });

  it("never answers a root's front page in place of a board", async () => {
    const { deps } = makeDeps({
      ...onBoards,
      patches: patchesByMachine({ [BOARDS_ID]: [publishedPage('<h1>OWNED</h1>')] }),
    });

    expect(contentOf(await handleResolveHttpFetch(request({}), deps))).toBe(boardPage('neo'));
    expect(contentOf(await handleResolveHttpFetch(request({ path: '/index.html' }), deps))).toBe(
      '<h1>OWNED</h1>',
    );
  });

  it.each([
    ['bricked', '/boot/vmlinuz'],
    ['whose web server was stopped', `/var/run/${SERVICE_CATALOG.http.pidfile}`],
  ])('answers no board when the box is %s', async (_case, removed) => {
    const { deps, findBoardHandle } = makeDeps({
      ...onBoards,
      patches: patchesByMachine({
        [BOARDS_ID]: [{ ...publishedPage(''), path: removed, content: null, node_type: null }],
      }),
    });

    expect(await handleResolveHttpFetch(request({}), deps)).toEqual({
      status: 404,
      body: { error: 'host_unreachable' },
    });
    expect(findBoardHandle).not.toHaveBeenCalled();
  });

  it('answers as nothing when the board is gone by the time it is read, and records nothing', async () => {
    const { deps, upsertPatch } = makeDeps({
      ...onBoards,
      findBoardHandle: async () => ({ data: null, error: null }),
    });

    expect(await handleResolveHttpFetch(request({}), deps)).toEqual({
      status: 404,
      body: { error: 'host_unreachable' },
    });
    expect(accessLogOf(upsertPatch)).toBeUndefined();
  });

  it('reports a board it could not read as a server error, and records nothing', async () => {
    const { deps, upsertPatch } = makeDeps({
      ...onBoards,
      findBoardHandle: async () => ({ data: null, error: { message: 'connection refused' } }),
    });

    expect(await handleResolveHttpFetch(request({}), deps)).toEqual({
      status: 500,
      body: { error: 'board_lookup_failed' },
    });
    expect(accessLogOf(upsertPatch)).toBeUndefined();
  });

  it('reads no board for a fetch of any other site', async () => {
    const { deps, findBoardHandle } = makeDeps({ patches: aliceServing() });

    await handleResolveHttpFetch(envelope({}), deps);

    expect(findBoardHandle).not.toHaveBeenCalled();
  });
});

describe('findit.io answers a search over the public web', () => {
  const FINDIT_IP = siteAddress(FINDIT_DOMAIN) ?? '';
  const onFindit = {
    lookup: async () => ({
      data: { router_machine_id: computeApGatewayId(FINDIT_NETWORK), essid: FINDIT_NETWORK },
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
  };
  const search = (term: string) =>
    signRequest(BOB, 'resolveHttpFetch', {
      target: FINDIT_IP,
      port: HTTP_DEFAULT_PORT,
      path: `/?q=${encodeURIComponent(term)}`,
    });
  const contentOf = (response: { body: Record<string, unknown> }): string =>
    typeof response.body.content === 'string' ? response.body.content : '';

  it('ranks the institution a term names above the ones that merely mention it', async () => {
    const { deps } = makeDeps(onFindit);

    const response = await handleResolveHttpFetch(search('university'), deps);

    expect(response.status).toBe(200);
    const page = contentOf(response);
    expect(page).toContain('<a href="http://ridgemont.edu/">Ridgemont University</a>');
    const first = page.indexOf('ridgemont.edu');
    const others = page.indexOf('acme.com');
    expect(first).toBeGreaterThan(-1);
    if (others > -1) expect(first).toBeLessThan(others);
  });

  it('says plainly when the web holds nothing that was asked for', async () => {
    const { deps } = makeDeps(onFindit);

    const response = await handleResolveHttpFetch(search('xyzzy-nothing-here'), deps);

    expect(response.status).toBe(200);
    expect(contentOf(response)).toContain('No matches for');
    // A search is a page like any other: a client reads it as one, and `curl -i` names
    // the server that answered it.
    expect(response.body).toMatchObject({ ok: true, server: 'nginx' });
  });

  it('serves its own front page, from its own disk, when nothing was asked', async () => {
    const { deps } = makeDeps(onFindit);

    const front = await handleResolveHttpFetch(
      signRequest(BOB, 'resolveHttpFetch', { target: FINDIT_IP, port: HTTP_DEFAULT_PORT, path: '/' }),
      deps,
    );

    expect(front.status).toBe(200);
    expect(contentOf(front)).toBe(FINDIT_FRONT_PAGE);
  });

  it('shows a page defaced on its own disk, because the front page is a file like any other', async () => {
    const { deps } = makeDeps({
      ...onFindit,
      patches: patchesByMachine({
        [computeApGatewayId(FINDIT_NETWORK)]: [publishedPage('<html>OWNED</html>')],
      }),
    });

    const front = await handleResolveHttpFetch(
      signRequest(BOB, 'resolveHttpFetch', { target: FINDIT_IP, port: HTTP_DEFAULT_PORT, path: '/' }),
      deps,
    );

    expect(contentOf(front)).toBe('<html>OWNED</html>');
  });

  it('takes the search down with the box when the box will not come up', async () => {
    const { deps } = makeDeps({
      ...onFindit,
      patches: patchesByMachine({
        [computeApGatewayId(FINDIT_NETWORK)]: [
          { ...publishedPage(''), path: '/boot/vmlinuz', content: null },
        ],
      }),
    });

    const response = await handleResolveHttpFetch(search('university'), deps);

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });

  it('records who searched for what, in its own log, as every fetch is recorded', async () => {
    const { deps, upsertPatch } = makeDeps(onFindit);

    await handleResolveHttpFetch(search('university'), deps);

    const logged = upsertPatch.mock.calls
      .map(([row]) => row)
      .find((row) => row.path === ACCESS_LOG_PATH);
    expect(logged?.machine_id).toBe(computeApGatewayId(FINDIT_NETWORK));
    expect(logged?.content).toContain('/?q=university');
  });

  it('leaves an ordinary site to serve its own files, query and all', async () => {
    const { deps } = makeDeps({ patches: aliceServing() });

    const response = await handleResolveHttpFetch(
      signRequest(BOB, 'resolveHttpFetch', {
        target: TARGET,
        port: HTTP_DEFAULT_PORT,
        path: '/?q=university',
      }),
      deps,
    );

    expect(response).toEqual({ status: 200, body: { ok: true, content: ALICE_PAGE, server: 'nginx' } });
  });
});

describe('chainit.io answers a lookup from the ledger', () => {
  const CHAINIT_IP = siteAddress('chainit.io') ?? '';
  const CHAINIT_ID = computeApGatewayId(CHAINIT_NETWORK);
  const OURS = `jsc${'a'.repeat(40)}`;
  const THEIRS = `jsc${'b'.repeat(40)}`;
  const onChainit = {
    lookup: async () => ({
      data: { router_machine_id: CHAINIT_ID, essid: CHAINIT_NETWORK },
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
  };
  /** Ours was minted 500, then sent 40 on: what the ledger's two reads hand back. */
  const fundedLedger = {
    findBalance: async () => ({ data: { balance: 460, next_sequence: 1 }, error: null }),
    findTransfers: async () => ({
      data: [
        {
          from_address: OURS,
          to_address: THEIRS,
          amount: 40,
          created_at: '2026-10-16T10:01:00+00:00',
        },
        {
          from_address: null,
          to_address: OURS,
          amount: 500,
          created_at: '2026-10-16T09:12:44+00:00',
        },
      ],
      error: null,
    }),
  };
  const fetchPath = (path: string, fields: Record<string, unknown> = {}) =>
    signRequest(BOB, 'resolveHttpFetch', {
      target: CHAINIT_IP,
      port: HTTP_DEFAULT_PORT,
      path,
      ...fields,
    });
  const lookUp = (typed: string) => fetchPath(`/address?a=${encodeURIComponent(typed)}`);
  const contentOf = (response: { body: Record<string, unknown> }): string =>
    typeof response.body.content === 'string' ? response.body.content : '';
  const accessLogOf = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch']) =>
    upsertPatch.mock.calls.map(([row]) => row).find((row) => row.path === ACCESS_LOG_PATH);

  it('shows what an address holds and its latest transfers, as `wallet` prints them', async () => {
    const { deps, findBalance, findTransfers } = makeDeps({ ...onChainit, ...fundedLedger });

    const response = await handleResolveHttpFetch(lookUp(OURS), deps);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, server: 'nginx' });
    const page = contentOf(response);
    expect(page).toContain(`${OURS}  460 JSC`);
    expect(page).toContain(
      `2026-10-16 10:01  -40 JSC  to <a href="/address?a=${THEIRS}">${THEIRS}</a>`,
    );
    expect(page).toContain('2026-10-16 09:12  +500 JSC  from coinbase');
    expect(findBalance).toHaveBeenCalledWith(OURS);
    // The history the wallet command reads, at the length it reads.
    expect(findTransfers).toHaveBeenCalledWith(OURS, 20);
  });

  it('answers an address the ledger has never seen with nothing held and nothing done', async () => {
    const { deps } = makeDeps(onChainit);

    const page = contentOf(await handleResolveHttpFetch(lookUp(THEIRS), deps));

    expect(page).toContain(`${THEIRS}  0 JSC`);
    expect(page).toContain('No transfers.');
  });

  it('looks up an address typed with spaces around it', async () => {
    const { deps, findBalance } = makeDeps({ ...onChainit, ...fundedLedger });

    const page = contentOf(await handleResolveHttpFetch(lookUp(`  ${OURS} `), deps));

    expect(page).toContain(`${OURS}  460 JSC`);
    expect(findBalance).toHaveBeenCalledWith(OURS);
  });

  it.each([
    ['nothing at all', '/address'],
    ['a blank address', '/address?a='],
    ['a word', '/address?a=hello'],
    ['an address one character short', `/address?a=jsc${'a'.repeat(39)}`],
    ['an address in capitals', `/address?a=JSC${'A'.repeat(40)}`],
  ])('says %s is not an address, and never asks the ledger', async (_case, path) => {
    const { deps, findBalance, findTransfers } = makeDeps({ ...onChainit, ...fundedLedger });

    const response = await handleResolveHttpFetch(fetchPath(path), deps);

    expect(response.status).toBe(200);
    expect(contentOf(response)).toContain('Not a JSC address: &quot;');
    expect(findBalance).not.toHaveBeenCalled();
    expect(findTransfers).not.toHaveBeenCalled();
  });

  it('hands back an empty form when nothing was typed at all', async () => {
    const { deps } = makeDeps(onChainit);

    const page = contentOf(await handleResolveHttpFetch(fetchPath('/address'), deps));

    expect(page).toContain('Not a JSC address: &quot;&quot;');
    expect(page).toContain('name="a" value=""');
  });

  it('records every lookup in its own log, address and all, traced to the visitor', async () => {
    const { deps, upsertPatch } = makeDeps({ ...onChainit, ...fundedLedger });

    await handleResolveHttpFetch(lookUp(OURS), deps);

    const logged = accessLogOf(upsertPatch);
    expect(logged?.machine_id).toBe(CHAINIT_ID);
    expect(logged?.content).toContain(`${BOB_PUBLIC_IP} `);
    expect(logged?.content).toContain(`/address?a=${OURS}`);
    expect(logged?.content).toContain(' 200 ');
  });

  it('serves its own front page, from its own disk', async () => {
    const { deps } = makeDeps(onChainit);

    expect(contentOf(await handleResolveHttpFetch(fetchPath('/'), deps))).toBe(CHAINIT_FRONT_PAGE);
  });

  it('answers from the ledger whatever a root has written at /address on its disk', async () => {
    const { deps } = makeDeps({
      ...onChainit,
      ...fundedLedger,
      patches: patchesByMachine({
        [CHAINIT_ID]: [publishedPage('<html>FORGED</html>', 'address')],
      }),
    });

    const page = contentOf(await handleResolveHttpFetch(lookUp(OURS), deps));

    expect(page).toContain(`${OURS}  460 JSC`);
    expect(page).not.toContain('FORGED');
  });

  it('serves any other path from its disk, /address/ included', async () => {
    const { deps, findBalance } = makeDeps({
      ...onChainit,
      patches: patchesByMachine({
        [CHAINIT_ID]: [publishedPage('<html>OWNED</html>', 'address/index.html')],
      }),
    });

    expect(contentOf(await handleResolveHttpFetch(fetchPath('/address/'), deps))).toBe(
      '<html>OWNED</html>',
    );
    expect(findBalance).not.toHaveBeenCalled();
  });

  it.each([
    ['bricked', '/boot/vmlinuz'],
    ['whose web server was stopped', `/var/run/${SERVICE_CATALOG.http.pidfile}`],
  ])('answers no lookup at all when the box is %s', async (_case, removed) => {
    const { deps, findBalance } = makeDeps({
      ...onChainit,
      ...fundedLedger,
      patches: patchesByMachine({
        [CHAINIT_ID]: [{ ...publishedPage(''), path: removed, content: null, node_type: null }],
      }),
    });

    expect(await handleResolveHttpFetch(lookUp(OURS), deps)).toEqual({
      status: 404,
      body: { error: 'host_unreachable' },
    });
    expect(findBalance).not.toHaveBeenCalled();
  });

  it.each([
    ['the balance', { findBalance: async () => ({ data: null, error: new Error('down') }) }],
    ['the history', { findTransfers: async () => ({ data: null, error: new Error('down') }) }],
  ])('fails the lookup, and records nothing, when %s cannot be read', async (_case, broken) => {
    const { deps, upsertPatch } = makeDeps({ ...onChainit, ...fundedLedger, ...broken });

    const response = await handleResolveHttpFetch(lookUp(OURS), deps);

    // Never `0 JSC`: an address the ledger could not read is not an address that holds nothing.
    expect(response).toEqual({ status: 500, body: { error: 'ledger_lookup_failed' } });
    expect(accessLogOf(upsertPatch)).toBeUndefined();
  });

  it('takes no form at /address, as no server but emailit takes one', async () => {
    const { deps, findBalance } = makeDeps({ ...onChainit, ...fundedLedger });

    const response = await handleResolveHttpFetch(
      fetchPath(`/address?a=${OURS}`, { body: `a=${OURS}` }),
      deps,
    );

    expect(response).toEqual({
      status: 405,
      body: { error: 'method_not_allowed', server: 'nginx' },
    });
    expect(findBalance).not.toHaveBeenCalled();
  });

  it('leaves every other site to serve /address from its own disk', async () => {
    const { deps, findBalance } = makeDeps({
      ...fundedLedger,
      lookup: async () => ({
        data: {
          router_machine_id: computeApGatewayId(HACKADEMY_NETWORK),
          essid: HACKADEMY_NETWORK,
        },
        error: null,
      }),
      listOccupantsByEssid: async () => ({ data: [], error: null }),
      listLeasesByEssid: async () => ({ data: [], error: null }),
    });

    const response = await handleResolveHttpFetch(
      signRequest(BOB, 'resolveHttpFetch', {
        target: siteAddress('hackademy.io') ?? '',
        port: HTTP_DEFAULT_PORT,
        path: `/address?a=${OURS}`,
      }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(findBalance).not.toHaveBeenCalled();
  });
});

describe('chainit.io lists the whole chain from the ledger', () => {
  const CHAINIT_IP = siteAddress('chainit.io') ?? '';
  const CHAINIT_ID = computeApGatewayId(CHAINIT_NETWORK);
  const OURS = `jsc${'a'.repeat(40)}`;
  const THEIRS = `jsc${'b'.repeat(40)}`;
  const onChainit = {
    lookup: async () => ({
      data: { router_machine_id: CHAINIT_ID, essid: CHAINIT_NETWORK },
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
  };
  /** Ours was minted 500 and sent 40 to theirs, newest first: what the two chain-wide
   *  reads hand back. */
  const busyLedger = {
    findLatestTransfers: async () => ({
      data: [
        {
          from_address: OURS,
          to_address: THEIRS,
          amount: 40,
          created_at: '2026-10-16T10:01:00+00:00',
        },
        {
          from_address: null,
          to_address: OURS,
          amount: 500,
          created_at: '2026-10-16T09:12:44+00:00',
        },
      ],
      error: null,
    }),
    findLargestBalances: async () => ({
      data: [
        { address: OURS, balance: 460 },
        { address: THEIRS, balance: 40 },
      ],
      error: null,
    }),
  };
  const fetchPath = (path: string, fields: Record<string, unknown> = {}) =>
    signRequest(BOB, 'resolveHttpFetch', {
      target: CHAINIT_IP,
      port: HTTP_DEFAULT_PORT,
      path,
      ...fields,
    });
  const contentOf = (response: { body: Record<string, unknown> }): string =>
    typeof response.body.content === 'string' ? response.body.content : '';
  const accessLogOf = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch']) =>
    upsertPatch.mock.calls.map(([row]) => row).find((row) => row.path === ACCESS_LOG_PATH);
  const linked = (address: string): string => `<a href="/address?a=${address}">${address}</a>`;

  it('shows the latest 20 transfers on the chain, newest first, both ends on each', async () => {
    const { deps, findLatestTransfers } = makeDeps({ ...onChainit, ...busyLedger });

    const response = await handleResolveHttpFetch(fetchPath('/recent'), deps);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, server: 'nginx' });
    expect(contentOf(response)).toContain(
      [
        `2026-10-16 10:01  40 JSC  ${linked(OURS)} -> ${linked(THEIRS)}`,
        `2026-10-16 09:12  500 JSC  coinbase -> ${linked(OURS)}`,
      ].join('\n'),
    );
    expect(findLatestTransfers).toHaveBeenCalledWith(20);
  });

  it('ranks the 20 richest addresses, largest first', async () => {
    const { deps, findLargestBalances } = makeDeps({ ...onChainit, ...busyLedger });

    const response = await handleResolveHttpFetch(fetchPath('/rich'), deps);

    expect(response.status).toBe(200);
    expect(contentOf(response)).toContain(
      [` 1  ${linked(OURS)}  460 JSC`, ` 2  ${linked(THEIRS)}  40 JSC`].join('\n'),
    );
    expect(findLargestBalances).toHaveBeenCalledWith(20);
  });

  it.each([
    ['/recent', 'No transfers.'],
    ['/rich', 'Nobody holds any JSC.'],
  ])('says plainly at %s when the ledger is empty', async (path, said) => {
    const { deps } = makeDeps(onChainit);

    expect(contentOf(await handleResolveHttpFetch(fetchPath(path), deps))).toContain(said);
  });

  it.each(['/recent', '/rich', '/recent?page=2'])(
    'records a look at %s in its own log, as asked, traced to the visitor',
    async (path) => {
      const { deps, upsertPatch } = makeDeps({ ...onChainit, ...busyLedger });

      await handleResolveHttpFetch(fetchPath(path), deps);

      const logged = accessLogOf(upsertPatch);
      expect(logged?.machine_id).toBe(CHAINIT_ID);
      expect(logged?.content).toContain(`${BOB_PUBLIC_IP} `);
      expect(logged?.content).toContain(` ${path} `);
      expect(logged?.content).toContain(' 200 ');
    },
  );

  it.each([
    ['/recent', 'recent', 'No transfers.'],
    ['/rich', 'rich', 'Nobody holds any JSC.'],
  ])(
    'answers %s from the ledger whatever a root has written there on its disk',
    async (path, planted, said) => {
      const { deps } = makeDeps({
        ...onChainit,
        patches: patchesByMachine({
          [CHAINIT_ID]: [publishedPage('<html>FORGED</html>', planted)],
        }),
      });

      const page = contentOf(await handleResolveHttpFetch(fetchPath(path), deps));

      expect(page).toContain(said);
      expect(page).not.toContain('FORGED');
    },
  );

  it.each([
    ['/recent/', 'recent/index.html'],
    ['/rich.html', 'rich.html'],
  ])('serves %s from its disk, like any other path', async (path, planted) => {
    const { deps, findLatestTransfers, findLargestBalances } = makeDeps({
      ...onChainit,
      patches: patchesByMachine({
        [CHAINIT_ID]: [publishedPage('<html>OWNED</html>', planted)],
      }),
    });

    expect(contentOf(await handleResolveHttpFetch(fetchPath(path), deps))).toBe(
      '<html>OWNED</html>',
    );
    expect(findLatestTransfers).not.toHaveBeenCalled();
    expect(findLargestBalances).not.toHaveBeenCalled();
  });

  it.each(['/recent', '/rich'])('answers nothing at %s when the box is bricked', async (path) => {
    const { deps, findLatestTransfers, findLargestBalances } = makeDeps({
      ...onChainit,
      ...busyLedger,
      patches: patchesByMachine({
        [CHAINIT_ID]: [
          { ...publishedPage(''), path: '/boot/vmlinuz', content: null, node_type: null },
        ],
      }),
    });

    expect(await handleResolveHttpFetch(fetchPath(path), deps)).toEqual({
      status: 404,
      body: { error: 'host_unreachable' },
    });
    expect(findLatestTransfers).not.toHaveBeenCalled();
    expect(findLargestBalances).not.toHaveBeenCalled();
  });

  it.each([
    [
      '/recent',
      'cannot be read',
      // Rows that would parse, beside the error: the error alone has to fail the view.
      { findLatestTransfers: async () => ({ data: [], error: new Error('down') }) },
    ],
    [
      '/recent',
      'hands back a row that is not a transfer',
      {
        findLatestTransfers: async () => ({
          data: [{ from_address: null, to_address: OURS, amount: 0, created_at: 'never' }],
          error: null,
        }),
      },
    ],
    [
      '/rich',
      'cannot be read',
      { findLargestBalances: async () => ({ data: [], error: new Error('down') }) },
    ],
    [
      '/rich',
      'hands back a row that is not a balance',
      {
        findLargestBalances: async () => ({
          data: [{ address: OURS, balance: 460 }, { address: 'nobody', balance: 40 }],
          error: null,
        }),
      },
    ],
  ])('fails %s, and records nothing, when the ledger %s', async (path, _case, broken) => {
    const { deps, upsertPatch } = makeDeps({ ...onChainit, ...busyLedger, ...broken });

    const response = await handleResolveHttpFetch(fetchPath(path), deps);

    // Never a short list: a list with a hole in it would read as a chain without the row.
    expect(response).toEqual({ status: 500, body: { error: 'ledger_lookup_failed' } });
    expect(accessLogOf(upsertPatch)).toBeUndefined();
  });

  it.each(['/recent', '/rich'])('takes no form at %s', async (path) => {
    const { deps, findLatestTransfers, findLargestBalances } = makeDeps({
      ...onChainit,
      ...busyLedger,
    });

    const response = await handleResolveHttpFetch(fetchPath(path, { body: 'a=1' }), deps);

    expect(response).toEqual({
      status: 405,
      body: { error: 'method_not_allowed', server: 'nginx' },
    });
    expect(findLatestTransfers).not.toHaveBeenCalled();
    expect(findLargestBalances).not.toHaveBeenCalled();
  });

  it.each(['/recent', '/rich'])(
    'leaves every other site to serve %s from its own disk',
    async (path) => {
      const { deps, findLatestTransfers, findLargestBalances } = makeDeps({
        ...busyLedger,
        lookup: async () => ({
          data: {
            router_machine_id: computeApGatewayId(HACKADEMY_NETWORK),
            essid: HACKADEMY_NETWORK,
          },
          error: null,
        }),
        listOccupantsByEssid: async () => ({ data: [], error: null }),
        listLeasesByEssid: async () => ({ data: [], error: null }),
      });

      const response = await handleResolveHttpFetch(
        signRequest(BOB, 'resolveHttpFetch', {
          target: siteAddress('hackademy.io') ?? '',
          port: HTTP_DEFAULT_PORT,
          path,
        }),
        deps,
      );

      expect(response).toEqual({ status: 404, body: { error: 'not_found' } });
      expect(findLatestTransfers).not.toHaveBeenCalled();
      expect(findLargestBalances).not.toHaveBeenCalled();
    },
  );
});

describe('talkit.io answers the forum from its table', () => {
  const TALKIT_IP = siteAddress('talkit.io') ?? '';
  const TALKIT_ID = computeApGatewayId(TALKIT_NETWORK);
  const onTalkit = {
    lookup: async () => ({
      data: { router_machine_id: TALKIT_ID, essid: TALKIT_NETWORK },
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
  };
  const listRow = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    title: `Thread ${id}`,
    author: 'neo',
    comment_count: 0,
    last_activity_at: '2026-10-19T08:30:12+00:00',
    ...overrides,
  });
  const WELCOME = {
    id: 1,
    title: 'Welcome to talkit.io',
    author: 'talkit',
    body: 'This is the forum for the whole valley.\nPosts are permanent.',
    created_at: '2026-10-19T08:30:12+00:00',
  };
  const commentRow = (number: number, overrides: Record<string, unknown> = {}) => ({
    number,
    author: 'neo',
    body: `Comment ${number}`,
    created_at: '2026-10-19T09:05:41+00:00',
    ...overrides,
  });
  /** A forum of `count` threads, the most recently active first, read the way the
   *  table is: `limit` rows from `offset`. */
  const forumOf = (count: number) => {
    const rows = Array.from({ length: count }, (_unused, index) => listRow(count - index));
    return {
      findThreads: async (offset: number, limit: number) => ({
        data: rows.slice(offset, offset + limit),
        error: null,
      }),
      findThread: async (id: number) => ({ data: id === 1 ? WELCOME : null, error: null }),
    };
  };
  const fetchPath = (path: string, fields: Record<string, unknown> = {}) =>
    signRequest(BOB, 'resolveHttpFetch', {
      target: TALKIT_IP,
      port: HTTP_DEFAULT_PORT,
      path,
      ...fields,
    });
  const contentOf = (response: { body: Record<string, unknown> }): string =>
    typeof response.body.content === 'string' ? response.body.content : '';
  const accessLogOf = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch']) =>
    upsertPatch.mock.calls.map(([row]) => row).find((row) => row.path === ACCESS_LOG_PATH);
  /** talkit's access log, a line at a time: a line's last field is the size served. */
  const loggedLines = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch']) =>
    (accessLogOf(upsertPatch)?.content ?? '').split('\n');
  const threadLinks = (page: string): readonly string[] =>
    [...page.matchAll(/href="\/thread\?id=(\d+)"/g)].map((match) => match[1] ?? '');
  const pagingLinks = (page: string): readonly string[] =>
    [...page.matchAll(/<a href="(\/threads\?page=\d+)">(newer|older)<\/a>/g)].map(
      (match) => `${match[2]} ${match[1]}`,
    );

  it('lists the welcome thread on a fresh forum', async () => {
    const { deps, findThreads } = makeDeps({ ...onTalkit, ...forumOf(1) });

    const response = await handleResolveHttpFetch(fetchPath('/threads'), deps);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, server: 'nginx' });
    expect(contentOf(response)).toContain(
      '<a href="/thread?id=1">Thread 1</a><br>by neo, 0 comments, last 2026-10-19 08:30',
    );
    expect(findThreads).toHaveBeenCalledWith(0, 21);
  });

  it('shows the 20 most recently active threads first, with the way to older ones', async () => {
    const { deps } = makeDeps({ ...onTalkit, ...forumOf(45) });

    const page = contentOf(await handleResolveHttpFetch(fetchPath('/threads'), deps));

    expect(threadLinks(page)).toEqual(
      Array.from({ length: 20 }, (_unused, index) => String(45 - index)),
    );
    expect(pagingLinks(page)).toEqual(['older /threads?page=2']);
  });

  it('shows the next 20 on page 2, both ways linked', async () => {
    const { deps, findThreads } = makeDeps({ ...onTalkit, ...forumOf(45) });

    const page = contentOf(await handleResolveHttpFetch(fetchPath('/threads?page=2'), deps));

    expect(threadLinks(page)).toEqual(
      Array.from({ length: 20 }, (_unused, index) => String(25 - index)),
    );
    expect(pagingLinks(page)).toEqual(['newer /threads?page=1', 'older /threads?page=3']);
    expect(findThreads).toHaveBeenCalledWith(20, 21);
  });

  it('shows the last 5 on page 3, with no way further back', async () => {
    const { deps } = makeDeps({ ...onTalkit, ...forumOf(45) });

    const page = contentOf(await handleResolveHttpFetch(fetchPath('/threads?page=3'), deps));

    expect(threadLinks(page)).toEqual(['5', '4', '3', '2', '1']);
    expect(pagingLinks(page)).toEqual(['newer /threads?page=2']);
  });

  it('shows no way back when a page is exactly full', async () => {
    const { deps } = makeDeps({ ...onTalkit, ...forumOf(40) });

    const page = contentOf(await handleResolveHttpFetch(fetchPath('/threads?page=2'), deps));

    expect(threadLinks(page)).toHaveLength(20);
    expect(pagingLinks(page)).toEqual(['newer /threads?page=1']);
  });

  it('says a page past the end holds no threads', async () => {
    const { deps } = makeDeps({ ...onTalkit, ...forumOf(45) });

    const response = await handleResolveHttpFetch(fetchPath('/threads?page=9'), deps);

    expect(response.status).toBe(200);
    expect(contentOf(response)).toContain('<p>No threads here.</p>');
  });

  it('reads the farthest page a reader can ask for', async () => {
    const { deps, findThreads } = makeDeps({ ...onTalkit, ...forumOf(1) });

    await handleResolveHttpFetch(fetchPath('/threads?page=999999'), deps);

    expect(findThreads).toHaveBeenCalledWith(19_999_960, 21);
  });

  it.each(['0', 'x', '-1', '', '01', '1.5', '1000000'])(
    'answers page "%s" with no such page, and reads nothing',
    async (asked) => {
      const { deps, findThreads, upsertPatch } = makeDeps({ ...onTalkit, ...forumOf(45) });

      const response = await handleResolveHttpFetch(fetchPath(`/threads?page=${asked}`), deps);

      expect(response.status).toBe(200);
      expect(contentOf(response)).toContain('<p>No such page.</p>');
      expect(findThreads).not.toHaveBeenCalled();
      expect(accessLogOf(upsertPatch)?.content).toContain('HTTP/1.1" 200 ');
    },
  );

  it('shows a thread: its title, its author and time, and its body', async () => {
    const { deps, findThread } = makeDeps({ ...onTalkit, ...forumOf(1) });

    const response = await handleResolveHttpFetch(fetchPath('/thread?id=1'), deps);

    expect(response.status).toBe(200);
    expect(contentOf(response)).toContain('<h2>Welcome to talkit.io</h2>');
    expect(contentOf(response)).toContain('<p>by talkit, 2026-10-19 08:30</p>');
    expect(contentOf(response)).toContain(
      '<p>This is the forum for the whole valley.<br>Posts are permanent.</p>',
    );
    expect(findThread).toHaveBeenCalledWith(1);
  });

  it("shows a thread's comments under it, read for that thread, and a form to add one", async () => {
    const { deps, findComments } = makeDeps({
      ...onTalkit,
      ...forumOf(1),
      findComments: async () => ({
        data: [commentRow(1), commentRow(2, { author: 'trinity', body: 'Me\ntoo' })],
        error: null,
      }),
    });

    const page = contentOf(await handleResolveHttpFetch(fetchPath('/thread?id=1'), deps));

    expect(page).toContain(
      '<p>#1 by neo, 2026-10-19 09:05</p>\n<p>Comment 1</p>\n' +
        '<p>#2 by trinity, 2026-10-19 09:05</p>\n<p>Me<br>too</p>\n',
    );
    expect(page).not.toContain('No comments yet.');
    expect(page).toContain('<input type="hidden" name="id" value="1">');
    expect(findComments).toHaveBeenCalledWith(1);
  });

  it('shows a removed comment by its number alone, in its place among the others', async () => {
    const { deps } = makeDeps({
      ...onTalkit,
      ...forumOf(1),
      findComments: async () => ({
        data: [commentRow(1), commentRow(2, { author: null, body: null }), commentRow(3)],
        error: null,
      }),
    });

    const page = contentOf(await handleResolveHttpFetch(fetchPath('/thread?id=1'), deps));

    expect(page).toContain(
      '<p>#1 by neo, 2026-10-19 09:05</p>\n<p>Comment 1</p>\n' +
        '<p>#2 [removed]</p>\n' +
        '<p>#3 by neo, 2026-10-19 09:05</p>\n<p>Comment 3</p>\n',
    );
  });

  it('says a thread has no comments yet when none were read', async () => {
    const { deps } = makeDeps({ ...onTalkit, ...forumOf(1) });

    const page = contentOf(await handleResolveHttpFetch(fetchPath('/thread?id=1'), deps));

    expect(page).toContain('<p>No comments yet.</p>');
  });

  it('answers a thread nobody started as a page that is not there', async () => {
    const { deps, findThread, findComments, upsertPatch } = makeDeps({
      ...onTalkit,
      ...forumOf(1),
    });

    const response = await handleResolveHttpFetch(fetchPath('/thread?id=999999'), deps);

    expect(response).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(findThread).toHaveBeenCalledWith(999999);
    expect(findComments).not.toHaveBeenCalled();
    // A 404 is a served response, and the one a defender most needs to see.
    expect(loggedLines(upsertPatch)).toContainEqual(
      expect.stringMatching(/"GET \/thread\?id=999999 HTTP\/1\.1" 404 0$/),
    );
  });

  it('reads the longest id a thread can have', async () => {
    const { deps, findThread } = makeDeps({ ...onTalkit, ...forumOf(1) });

    await handleResolveHttpFetch(fetchPath('/thread?id=999999999999999'), deps);

    expect(findThread).toHaveBeenCalledWith(999_999_999_999_999);
  });

  it.each([
    '/thread?id=abc',
    '/thread?id=',
    '/thread',
    '/thread?id=0',
    '/thread?id=01',
    '/thread?id=1000000000000000',
  ])('answers %s as a page that is not there, and reads nothing', async (path) => {
    const { deps, findThread, upsertPatch } = makeDeps({ ...onTalkit, ...forumOf(1) });

    const response = await handleResolveHttpFetch(fetchPath(path), deps);

    expect(response).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(findThread).not.toHaveBeenCalled();
    expect(
      loggedLines(upsertPatch).some((line) => line.endsWith(`"GET ${path} HTTP/1.1" 404 0`)),
    ).toBe(true);
  });

  it.each(['/threads', '/threads?page=2', '/thread?id=1'])(
    'records a look at %s in its own log, as asked, traced to the visitor',
    async (path) => {
      const { deps, upsertPatch } = makeDeps({ ...onTalkit, ...forumOf(45) });

      await handleResolveHttpFetch(fetchPath(path), deps);

      const logged = accessLogOf(upsertPatch);
      expect(logged?.machine_id).toBe(TALKIT_ID);
      expect(logged?.content).toContain(`${BOB_PUBLIC_IP} `);
      expect(logged?.content).toContain(`"GET ${path} HTTP/1.1" 200 `);
    },
  );

  it('serves its front page from its disk', async () => {
    const { deps } = makeDeps(onTalkit);

    expect(contentOf(await handleResolveHttpFetch(fetchPath('/'), deps))).toBe(TALKIT_FRONT_PAGE);
  });

  it('serves a front page a root rewrote, as the file it is', async () => {
    const { deps } = makeDeps({
      ...onTalkit,
      patches: patchesByMachine({ [TALKIT_ID]: [publishedPage('<html>DEFACED</html>')] }),
    });

    expect(contentOf(await handleResolveHttpFetch(fetchPath('/'), deps))).toBe(
      '<html>DEFACED</html>',
    );
  });

  it.each([
    ['/threads', 'threads', 'Thread 1'],
    ['/thread?id=1', 'thread', 'Welcome to talkit.io'],
  ])('answers %s from the table whatever a root has written there', async (path, planted, said) => {
    const { deps } = makeDeps({
      ...onTalkit,
      ...forumOf(1),
      patches: patchesByMachine({ [TALKIT_ID]: [publishedPage('<html>FORGED</html>', planted)] }),
    });

    const page = contentOf(await handleResolveHttpFetch(fetchPath(path), deps));

    expect(page).toContain(said);
    expect(page).not.toContain('FORGED');
  });

  it.each([
    ['/threads/', 'threads/index.html'],
    ['/thread.html', 'thread.html'],
  ])('serves %s from its disk, like any other path', async (path, planted) => {
    const { deps, findThreads, findThread } = makeDeps({
      ...onTalkit,
      ...forumOf(1),
      patches: patchesByMachine({ [TALKIT_ID]: [publishedPage('<html>OWNED</html>', planted)] }),
    });

    expect(contentOf(await handleResolveHttpFetch(fetchPath(path), deps))).toBe(
      '<html>OWNED</html>',
    );
    expect(findThreads).not.toHaveBeenCalled();
    expect(findThread).not.toHaveBeenCalled();
  });

  it.each([
    ['/threads', 'bricked', '/boot/vmlinuz'],
    ['/thread?id=1', 'bricked', '/boot/vmlinuz'],
    ['/threads', 'whose web server was stopped', `/var/run/${SERVICE_CATALOG.http.pidfile}`],
    ['/thread?id=1', 'whose web server was stopped', `/var/run/${SERVICE_CATALOG.http.pidfile}`],
  ])('answers nothing at %s when the box is %s', async (path, _case, removed) => {
    const { deps, findThreads, findThread } = makeDeps({
      ...onTalkit,
      ...forumOf(1),
      patches: patchesByMachine({
        [TALKIT_ID]: [{ ...publishedPage(''), path: removed, content: null, node_type: null }],
      }),
    });

    expect(await handleResolveHttpFetch(fetchPath(path), deps)).toEqual({
      status: 404,
      body: { error: 'host_unreachable' },
    });
    expect(findThreads).not.toHaveBeenCalled();
    expect(findThread).not.toHaveBeenCalled();
  });

  it.each([
    [
      '/threads',
      'cannot be read',
      // Rows that would parse, beside the error: the error alone has to fail the view.
      { findThreads: async () => ({ data: [listRow(1)], error: new Error('down') }) },
    ],
    [
      '/threads',
      'hands back a row that is not a thread',
      {
        findThreads: async () => ({
          data: [listRow(2), listRow(1, { last_activity_at: 'never' })],
          error: null,
        }),
      },
    ],
    [
      '/thread?id=1',
      'cannot be read',
      { findThread: async () => ({ data: WELCOME, error: new Error('down') }) },
    ],
    [
      '/thread?id=1',
      'hands back a row that is not a thread',
      { findThread: async () => ({ data: { ...WELCOME, body: 42 }, error: null }) },
    ],
    [
      '/thread?id=1',
      'cannot read its comments',
      // A comment that would parse, beside the error: the error alone has to fail the view.
      { findComments: async () => ({ data: [commentRow(1)], error: new Error('down') }) },
    ],
    [
      '/thread?id=1',
      'hands back a comment that is not one',
      {
        findComments: async () => ({
          data: [commentRow(1), commentRow(2, { number: 0 })],
          error: null,
        }),
      },
    ],
    // A removal takes the author and the body together; a row missing one is not a comment.
    [
      '/thread?id=1',
      'hands back a comment with a body and no author',
      { findComments: async () => ({ data: [commentRow(1, { author: null })], error: null }) },
    ],
    [
      '/thread?id=1',
      'hands back a comment with an author and no body',
      { findComments: async () => ({ data: [commentRow(1, { body: null })], error: null }) },
    ],
  ])('fails %s, and records nothing, when the forum %s', async (path, _case, broken) => {
    const { deps, upsertPatch } = makeDeps({ ...onTalkit, ...forumOf(1), ...broken });

    const response = await handleResolveHttpFetch(fetchPath(path), deps);

    expect(response).toEqual({ status: 500, body: { error: 'forum_lookup_failed' } });
    expect(accessLogOf(upsertPatch)).toBeUndefined();
  });

  it.each(['/threads', '/thread?id=1'])('takes no form at %s yet', async (path) => {
    const { deps, findThreads, findThread } = makeDeps({ ...onTalkit, ...forumOf(1) });

    const response = await handleResolveHttpFetch(fetchPath(path, { body: 'a=1' }), deps);

    expect(response).toEqual({
      status: 405,
      body: { error: 'method_not_allowed', server: 'nginx' },
    });
    expect(findThreads).not.toHaveBeenCalled();
    expect(findThread).not.toHaveBeenCalled();
  });

  it.each([
    [CHAINIT_NETWORK, 'chainit.io'],
    [HACKADEMY_NETWORK, 'hackademy.io'],
  ])('leaves %s to serve the forum paths from its own disk', async (network, domain) => {
    const { deps, findThreads, findThread } = makeDeps({
      ...forumOf(1),
      lookup: async () => ({
        data: { router_machine_id: computeApGatewayId(network), essid: network },
        error: null,
      }),
      listOccupantsByEssid: async () => ({ data: [], error: null }),
      listLeasesByEssid: async () => ({ data: [], error: null }),
    });

    for (const path of ['/threads', '/thread?id=1']) {
      expect(
        await handleResolveHttpFetch(
          signRequest(BOB, 'resolveHttpFetch', {
            target: siteAddress(domain) ?? '',
            port: HTTP_DEFAULT_PORT,
            path,
          }),
          deps,
        ),
      ).toEqual({ status: 404, body: { error: 'not_found' } });
    }
    expect(findThreads).not.toHaveBeenCalled();
    expect(findThread).not.toHaveBeenCalled();
  });
});

describe('talkit.io takes a new thread', () => {
  const TALKIT_IP = siteAddress('talkit.io') ?? '';
  const TALKIT_ID = computeApGatewayId(TALKIT_NETWORK);
  const onTalkit = {
    lookup: async () => ({
      data: { router_machine_id: TALKIT_ID, essid: TALKIT_NETWORK },
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
  };
  const FORM = 'title=My+new+router&body=It+blinks.%0AAll+night.';
  const NEO = { handle: 'neo', password: 's3cret' };
  const postTo = (path: string, fields: Record<string, unknown> = {}) =>
    signRequest(BOB, 'resolveHttpFetch', {
      target: TALKIT_IP,
      port: HTTP_DEFAULT_PORT,
      path,
      body: FORM,
      login: NEO,
      ...fields,
    });
  const contentOf = (response: { body: Record<string, unknown> }): string =>
    typeof response.body.content === 'string' ? response.body.content : '';
  const writtenTo = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch'], path: string) =>
    upsertPatch.mock.calls.map(([row]) => row).filter((row) => row.path === path);

  it('posts the thread as the login the form carries, by the player who sent it', async () => {
    const { deps, postThread } = makeDeps(onTalkit);

    const response = await handleResolveHttpFetch(postTo('/post'), deps);

    expect(postThread).toHaveBeenCalledWith({
      handle: 'neo',
      passwordMd5: md5('s3cret'),
      playerKey: BOB.publicKeyHex,
      title: 'My new router',
      body: 'It blinks.\nAll night.',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, server: 'nginx' });
    expect(contentOf(response)).toContain('Posted as neo.');
  });

  it('records the POST in its access log by its path, with no trace of the form or the login', async () => {
    const { deps, upsertPatch } = makeDeps(onTalkit);

    const response = await handleResolveHttpFetch(postTo('/post'), deps);

    expect(writtenTo(upsertPatch, ACCESS_LOG_PATH).map((row) => row.content)).toEqual([
      `${BOB_PUBLIC_IP} - - [30/Jul/2026:13:55:36 +0000] "POST /post HTTP/1.1" 200 ${contentOf(response).length}\n`,
    ]);
    expect(JSON.stringify(upsertPatch.mock.calls)).not.toContain('s3cret');
    expect(JSON.stringify(upsertPatch.mock.calls)).not.toContain('blinks');
  });

  it('writes who posted the thread, and from where, to talkit.log', async () => {
    const { deps, upsertPatch } = makeDeps(onTalkit);

    await handleResolveHttpFetch(postTo('/post'), deps);

    expect(writtenTo(upsertPatch, '/var/log/talkit.log')).toEqual([
      expect.objectContaining({
        machine_id: TALKIT_ID,
        content: `2026-07-30 13:55:36 post #12 by neo from ${BOB_PUBLIC_IP}\n`,
        owner: 'root',
        permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      }),
    ]);
  });

  it('adds the line under the ones talkit.log already holds', async () => {
    const earlier = `2026-07-30 13:50:00 post #11 by trin from 203.0.113.9\n`;
    const { deps, upsertPatch } = makeDeps({
      ...onTalkit,
      readLog: async ({ path }) => ({
        data:
          path === '/var/log/talkit.log'
            ? [
                {
                  writer_key: 'a'.repeat(64),
                  path,
                  content: earlier,
                  owner: 'root',
                  permissions: { read: ['root'], write: ['root'], execute: [] },
                  node_type: 'file',
                  updated_at: '2026-07-30T13:50:00Z',
                },
              ]
            : null,
        error: null,
      }),
    });

    await handleResolveHttpFetch(postTo('/post'), deps);

    expect(writtenTo(upsertPatch, '/var/log/talkit.log').map((row) => row.content)).toEqual([
      `${earlier}2026-07-30 13:55:36 post #12 by neo from ${BOB_PUBLIC_IP}\n`,
    ]);
  });

  it('spells out anything in the handle that could pass for another column of the line', async () => {
    const { deps, upsertPatch } = makeDeps(onTalkit);

    await handleResolveHttpFetch(
      postTo('/post', { login: { handle: 'neo from 1.2.3.4', password: 'x' } }),
      deps,
    );

    expect(writtenTo(upsertPatch, '/var/log/talkit.log').map((row) => row.content)).toEqual([
      `2026-07-30 13:55:36 post #12 by neo\\x20from\\x201.2.3.4 from ${BOB_PUBLIC_IP}\n`,
    ]);
  });

  it('answers a post with no login plainly, and records only the POST', async () => {
    const { deps, postThread, upsertPatch } = makeDeps(onTalkit);

    const response = await handleResolveHttpFetch(postTo('/post', { login: undefined }), deps);

    expect(response.status).toBe(200);
    expect(contentOf(response)).toContain('Not logged in to emailit.io.');
    expect(postThread).not.toHaveBeenCalled();
    expect(writtenTo(upsertPatch, ACCESS_LOG_PATH)).toHaveLength(1);
    expect(writtenTo(upsertPatch, '/var/log/talkit.log')).toEqual([]);
  });

  it('writes nothing to talkit.log for a post the store refused', async () => {
    const { deps, upsertPatch } = makeDeps({
      ...onTalkit,
      postThread: async () => ({ data: { outcome: 'capped' }, error: null }),
    });

    const response = await handleResolveHttpFetch(postTo('/post'), deps);

    expect(contentOf(response)).toContain('You have posted 20 times in the last hour.');
    expect(writtenTo(upsertPatch, '/var/log/talkit.log')).toEqual([]);
  });

  it('keeps a post that went up, though its line could not be written', async () => {
    const { deps } = makeDeps({
      ...onTalkit,
      upsertPatch: async (row) => {
        if (row.path === '/var/log/talkit.log') throw new Error('journal unavailable');
        return { error: null };
      },
    });

    const response = await handleResolveHttpFetch(postTo('/post'), deps);

    expect(response.status).toBe(200);
    expect(contentOf(response)).toContain('Posted as neo.');
  });

  it('is a server error, and records nothing, when the store cannot be asked', async () => {
    const { deps, upsertPatch } = makeDeps({
      ...onTalkit,
      postThread: async () => ({ data: null, error: { message: 'connection refused' } }),
    });

    expect(await handleResolveHttpFetch(postTo('/post'), deps)).toEqual({
      status: 500,
      body: { error: 'post_failed' },
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('takes a form at /post however its query string reads', async () => {
    const { deps, postThread } = makeDeps(onTalkit);

    await handleResolveHttpFetch(postTo('/post?from=front'), deps);

    expect(postThread).toHaveBeenCalledTimes(1);
  });

  it.each(['/', '/post/', '/threads'])(
    'refuses a form at %s, as every other server does',
    async (path) => {
      const { deps, postThread } = makeDeps(onTalkit);

      const response = await handleResolveHttpFetch(postTo(path), deps);

      expect(response).toEqual({
        status: 405,
        body: { error: 'method_not_allowed', server: 'nginx' },
      });
      expect(postThread).not.toHaveBeenCalled();
    },
  );

  it('takes no form at /post on any other site', async () => {
    const { deps, postThread } = makeDeps({ patches: aliceServing() });

    const response = await handleResolveHttpFetch(
      envelope({ path: '/post', body: FORM, login: NEO }),
      deps,
    );

    expect(response.status).toBe(405);
    expect(postThread).not.toHaveBeenCalled();
  });

  it('serves /post as a file to a plain fetch, posting nothing', async () => {
    const { deps, postThread } = makeDeps(onTalkit);

    const response = await handleResolveHttpFetch(
      postTo('/post', { body: undefined, login: undefined }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(postThread).not.toHaveBeenCalled();
  });

  it.each([
    ['a handle that is not text', { handle: 7, password: 's3cret' }],
    ['an empty handle', { handle: '', password: 's3cret' }],
    ['no password', { handle: 'neo' }],
  ])('refuses a login with %s unread', async (_what, login) => {
    const { deps, postThread } = makeDeps(onTalkit);

    expect(await handleResolveHttpFetch(postTo('/post', { login }), deps)).toEqual({
      status: 400,
      body: { error: 'payload_invalid' },
    });
    expect(postThread).not.toHaveBeenCalled();
  });
});

describe('talkit.io takes a comment', () => {
  const TALKIT_IP = siteAddress('talkit.io') ?? '';
  const TALKIT_ID = computeApGatewayId(TALKIT_NETWORK);
  const onTalkit = {
    lookup: async () => ({
      data: { router_machine_id: TALKIT_ID, essid: TALKIT_NETWORK },
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
  };
  const FORM = 'id=12&body=Mine+blinks.%0AAll+night.';
  const NEO = { handle: 'neo', password: 's3cret' };
  const commentTo = (path: string, fields: Record<string, unknown> = {}) =>
    signRequest(BOB, 'resolveHttpFetch', {
      target: TALKIT_IP,
      port: HTTP_DEFAULT_PORT,
      path,
      body: FORM,
      login: NEO,
      ...fields,
    });
  const contentOf = (response: { body: Record<string, unknown> }): string =>
    typeof response.body.content === 'string' ? response.body.content : '';
  const writtenTo = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch'], path: string) =>
    upsertPatch.mock.calls.map(([row]) => row).filter((row) => row.path === path);

  it('posts the comment on the thread as the login the form carries, by the player who sent it', async () => {
    const { deps, postComment, postThread } = makeDeps(onTalkit);

    const response = await handleResolveHttpFetch(commentTo('/comment'), deps);

    expect(postComment).toHaveBeenCalledWith({
      handle: 'neo',
      passwordMd5: md5('s3cret'),
      playerKey: BOB.publicKeyHex,
      threadId: 12,
      body: 'Mine blinks.\nAll night.',
    });
    expect(postThread).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, server: 'nginx' });
    expect(contentOf(response)).toContain('Commented as neo.');
  });

  it('records the POST in its access log by its path, with no trace of the form or the login', async () => {
    const { deps, upsertPatch } = makeDeps(onTalkit);

    const response = await handleResolveHttpFetch(commentTo('/comment'), deps);

    expect(writtenTo(upsertPatch, ACCESS_LOG_PATH).map((row) => row.content)).toEqual([
      `${BOB_PUBLIC_IP} - - [30/Jul/2026:13:55:36 +0000] "POST /comment HTTP/1.1" 200 ${contentOf(response).length}\n`,
    ]);
    expect(JSON.stringify(upsertPatch.mock.calls)).not.toContain('s3cret');
    expect(JSON.stringify(upsertPatch.mock.calls)).not.toContain('blinks');
  });

  it('writes who commented on which thread, and from where, to talkit.log', async () => {
    const { deps, upsertPatch } = makeDeps(onTalkit);

    await handleResolveHttpFetch(commentTo('/comment'), deps);

    expect(writtenTo(upsertPatch, '/var/log/talkit.log')).toEqual([
      expect.objectContaining({
        machine_id: TALKIT_ID,
        content: `2026-07-30 13:55:36 comment #3 on #12 by neo from ${BOB_PUBLIC_IP}\n`,
        owner: 'root',
        permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      }),
    ]);
  });

  it('spells out anything in the handle that could pass for another column of the line', async () => {
    const { deps, upsertPatch } = makeDeps(onTalkit);

    await handleResolveHttpFetch(
      commentTo('/comment', { login: { handle: 'neo on #1 by x', password: 'x' } }),
      deps,
    );

    expect(writtenTo(upsertPatch, '/var/log/talkit.log').map((row) => row.content)).toEqual([
      `2026-07-30 13:55:36 comment #3 on #12 by neo\\x20on\\x20\\x231\\x20by\\x20x from ${BOB_PUBLIC_IP}\n`,
    ]);
  });

  it('answers a comment with no login plainly, and records only the POST', async () => {
    const { deps, postComment, upsertPatch } = makeDeps(onTalkit);

    const response = await handleResolveHttpFetch(commentTo('/comment', { login: undefined }), deps);

    expect(response.status).toBe(200);
    expect(contentOf(response)).toContain('Not logged in to emailit.io.');
    expect(postComment).not.toHaveBeenCalled();
    expect(writtenTo(upsertPatch, ACCESS_LOG_PATH)).toHaveLength(1);
    expect(writtenTo(upsertPatch, '/var/log/talkit.log')).toEqual([]);
  });

  it('writes nothing to talkit.log for a comment the store refused', async () => {
    const { deps, upsertPatch } = makeDeps({
      ...onTalkit,
      postComment: async () => ({ data: { outcome: 'no_thread' }, error: null }),
    });

    const response = await handleResolveHttpFetch(commentTo('/comment'), deps);

    expect(contentOf(response)).toContain('No such thread.');
    expect(writtenTo(upsertPatch, ACCESS_LOG_PATH)).toHaveLength(1);
    expect(writtenTo(upsertPatch, '/var/log/talkit.log')).toEqual([]);
  });

  it('keeps a comment that went up, though its line could not be written', async () => {
    const { deps } = makeDeps({
      ...onTalkit,
      upsertPatch: async (row) => {
        if (row.path === '/var/log/talkit.log') throw new Error('journal unavailable');
        return { error: null };
      },
    });

    const response = await handleResolveHttpFetch(commentTo('/comment'), deps);

    expect(response.status).toBe(200);
    expect(contentOf(response)).toContain('Commented as neo.');
  });

  it('is a server error, and records nothing, when the store cannot be asked', async () => {
    const { deps, upsertPatch } = makeDeps({
      ...onTalkit,
      postComment: async () => ({ data: null, error: { message: 'connection refused' } }),
    });

    expect(await handleResolveHttpFetch(commentTo('/comment'), deps)).toEqual({
      status: 500,
      body: { error: 'comment_failed' },
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('takes a form at /comment however its query string reads', async () => {
    const { deps, postComment } = makeDeps(onTalkit);

    await handleResolveHttpFetch(commentTo('/comment?id=99'), deps);

    expect(postComment).toHaveBeenCalledWith(expect.objectContaining({ threadId: 12 }));
  });

  it.each(['/comment/', '/comments', '/thread'])(
    'refuses a form at %s, as every other server does',
    async (path) => {
      const { deps, postComment } = makeDeps(onTalkit);

      const response = await handleResolveHttpFetch(commentTo(path), deps);

      expect(response).toEqual({
        status: 405,
        body: { error: 'method_not_allowed', server: 'nginx' },
      });
      expect(postComment).not.toHaveBeenCalled();
    },
  );

  it('takes no form at /comment on any other site', async () => {
    const { deps, postComment } = makeDeps({ patches: aliceServing() });

    const response = await handleResolveHttpFetch(
      envelope({ path: '/comment', body: FORM, login: NEO }),
      deps,
    );

    expect(response.status).toBe(405);
    expect(postComment).not.toHaveBeenCalled();
  });

  it('serves /comment as a file to a plain fetch, posting nothing', async () => {
    const { deps, postComment } = makeDeps(onTalkit);

    const response = await handleResolveHttpFetch(
      commentTo('/comment', { body: undefined, login: undefined }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(postComment).not.toHaveBeenCalled();
  });
});

describe('hackademy.io serves its pages to anybody who asks', () => {
  const HACKADEMY_IP = siteAddress('hackademy.io') ?? '';
  const HACKADEMY_ID = computeApGatewayId(HACKADEMY_NETWORK);
  const onHackademy = {
    lookup: async () => ({
      data: { router_machine_id: HACKADEMY_ID, essid: HACKADEMY_NETWORK },
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
  };
  const fetchPath = (path: string) =>
    signRequest(BOB, 'resolveHttpFetch', { target: HACKADEMY_IP, port: HTTP_DEFAULT_PORT, path });
  const contentOf = (response: { body: Record<string, unknown> }): string =>
    typeof response.body.content === 'string' ? response.body.content : '';

  it('serves its front page, and the first chapter it links to', async () => {
    const { deps } = makeDeps(onHackademy);

    const front = await handleResolveHttpFetch(fetchPath('/'), deps);
    const chapter = await handleResolveHttpFetch(fetchPath('/getting-around.html'), deps);

    expect(front.body).toMatchObject({ ok: true, server: 'nginx' });
    expect(contentOf(front)).toContain('<title>hackademy.io</title>');
    expect(contentOf(front)).toContain('href="/getting-around.html"');
    expect(contentOf(chapter)).toContain('<h1>Getting around</h1>');
  });

  it('answers a query with its page, because only findit searches', async () => {
    const { deps } = makeDeps(onHackademy);

    const front = await handleResolveHttpFetch(fetchPath('/'), deps);
    const queried = await handleResolveHttpFetch(fetchPath('/?q=university'), deps);

    expect(contentOf(queried)).toBe(contentOf(front));
  });

  it('records the visit in its own access log', async () => {
    const { deps, upsertPatch } = makeDeps(onHackademy);

    await handleResolveHttpFetch(fetchPath('/getting-around.html'), deps);

    const logged = upsertPatch.mock.calls
      .map(([row]) => row)
      .find((row) => row.path === ACCESS_LOG_PATH);
    expect(logged?.machine_id).toBe(HACKADEMY_ID);
    expect(logged?.content).toContain('GET /getting-around.html');
  });
});

describe("findit finds a player's page, and leaves no trace doing it", () => {
  const FINDIT_IP = siteAddress(FINDIT_DOMAIN) ?? '';
  const FINDIT_GATEWAY_ID = computeApGatewayId(FINDIT_NETWORK);
  /** A home network nobody publishes a site for: the only way onto the web from it is
   *  a forward its occupant writes. */
  const HOME = 'APT-3B-WIFI';
  const HOME_IP = publicAddress(HOME) ?? '';
  const HOME_GATEWAY_ID = computeApGatewayId(HOME);
  const ADA_WS = 'workstation-ada00001';
  const ADA_OCTET = 250;
  const ADA_LAN_IP = lanAddressFor(HOME, ADA_OCTET);
  const ada: HttpFetchOccupant = {
    owner_key: ALICE.publicKeyHex,
    workstation_machine_id: ADA_WS,
    workstation_username: 'ada',
    workstation_root_hash: md5('toor'),
  };
  const ADA_PAGE =
    '<html><head><title>Ada builds robots</title></head><body><p>Gears and gardening.</p></body></html>';

  const HOME_FORWARD = forwards(forwardTo(HTTP_DEFAULT_PORT, ADA_LAN_IP, HTTP_DEFAULT_PORT));

  /** Ada forwards her home network's public `:80` to her own box, which is serving the
   *  given rows, and findit is being searched. */
  const adaPublishing = (...adaRows: readonly OwnerPatchRow[]): FetchOverrides => ({
    lookup: async (publicIp) => ({
      data:
        publicIp === HOME_IP
          ? { router_machine_id: HOME_GATEWAY_ID, essid: HOME }
          : { router_machine_id: FINDIT_GATEWAY_ID, essid: FINDIT_NETWORK },
      error: null,
    }),
    patches: patchesByMachine({ [HOME_GATEWAY_ID]: [HOME_FORWARD], [ADA_WS]: adaRows }),
    listOccupantsByEssid: async (essid) => ({ data: essid === HOME ? [ada] : [], error: null }),
    listLeasesByEssid: async (essid) => ({
      data: essid === HOME ? [{ owner_key: ALICE.publicKeyHex, octet: ADA_OCTET }] : [],
      error: null,
    }),
    findPatchesForMachines: async (machineIds) => ({
      data: machineIds.includes(HOME_GATEWAY_ID)
        ? [{ ...HOME_FORWARD, machine_id: HOME_GATEWAY_ID }]
        : [],
      error: null,
    }),
  });

  const search = (term: string) =>
    signRequest(BOB, 'resolveHttpFetch', {
      target: FINDIT_IP,
      port: HTTP_DEFAULT_PORT,
      path: `/?q=${encodeURIComponent(term)}`,
    });
  const contentOf = (response: { body: Record<string, unknown> }): string =>
    typeof response.body.content === 'string' ? response.body.content : '';

  it('lists the page by its title and the bare address it answers at', async () => {
    const { deps } = makeDeps(adaPublishing(webServerUp(), publishedPage(ADA_PAGE)));

    const page = contentOf(await handleResolveHttpFetch(search('gardening'), deps));

    expect(page).toContain(`<a href="http://${HOME_IP}/">Ada builds robots</a>`);
    expect(page).toContain(`<p>${HOME_IP}</p>`);
    expect(page).toContain('<p>Gears and gardening.</p>');
  });

  it('lists nothing once the page stops being served', async () => {
    const { deps } = makeDeps(adaPublishing(publishedPage(ADA_PAGE)));

    const page = contentOf(await handleResolveHttpFetch(search('gardening'), deps));

    expect(page).not.toContain(HOME_IP);
    expect(page).toContain('No matches for');
  });

  it('lists nothing for a page whose robots.txt shuts crawlers out', async () => {
    const { deps } = makeDeps(
      adaPublishing(
        webServerUp(),
        publishedPage(ADA_PAGE),
        publishedPage('User-agent: *\nDisallow: /\n', 'robots.txt'),
      ),
    );

    const page = contentOf(await handleResolveHttpFetch(search('gardening'), deps));

    expect(page).not.toContain(HOME_IP);
  });

  it('shows a title somebody wrote as markup as text', async () => {
    const { deps } = makeDeps(
      adaPublishing(
        webServerUp(),
        publishedPage('<html><head><title>&lt;script&gt;alert(1)&lt;/script&gt; gardening</title></head></html>'),
      ),
    );

    const page = contentOf(await handleResolveHttpFetch(search('gardening'), deps));

    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt; gardening');
    expect(page).not.toContain('<script>');
  });

  it('writes nothing on the box it listed, and only the search on its own', async () => {
    const { deps, upsertPatch } = makeDeps(adaPublishing(webServerUp(), publishedPage(ADA_PAGE)));

    await handleResolveHttpFetch(search('gardening'), deps);

    const written = upsertPatch.mock.calls.map(([row]) => row.machine_id);
    expect(written).toEqual([FINDIT_GATEWAY_ID]);
  });
});
