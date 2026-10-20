/**
 * handleResolveHttpFetch — the server-side gate for a CROSS-PLAYER web fetch.
 * `curl http://<public IP>[:port][/path]` resolves the public IP to the ACCESS POINT
 * that bears it, materializes the ESSID's shared GATEWAY, and decides which machine the
 * requested port reaches — the same `machineServing` routing the cross-player ssh gate
 * uses, so a scan, a login and a fetch can never disagree about what sits behind a
 * forward.
 *
 * This is the one door that opens with NO session and NO credential: a web server
 * publishes its document root to anybody who can reach the port. So reachability is the
 * whole gate, and it is deliberately narrow — the destination port must be serving the
 * WEB. A forward onto an `sshd` reaches a listening daemon that is not a web server, and
 * refuses exactly like a closed port.
 *
 * Two failure shapes, and the split is the security boundary:
 *
 *   - `host_unreachable` — a connect-level refusal. Every cause collapses into it (no
 *     such public IP, bricked gateway, bricked occupant, a forward to an address nobody
 *     leases, an occupant who left the WiFi, no forward, nothing serving the web there)
 *     so a prober cannot tell which gate stopped it.
 *   - `not_found` — the HTTP 404 a reachable server returns for a path it does not
 *     publish. It admits a web server is there, which is what answering the port admits
 *     anyway.
 *
 * The request path arrives RAW and is resolved HERE, through the same `resolveWebPath`
 * the own-LAN client uses. That placement is the confinement: a hostile client is
 * assumed, so it must never be able to name a file on the target directly — it names a
 * URL path, and the server decides what file (if any) that is.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { materializeApGatewayFs } from './materializeRouterFs.js';
import type { OwnerPatchRow } from './materializeWorkstationFs.js';
import { machineServing, type ServedMachine } from './machineServing.js';
import { bootableOccupantFs } from './natHosts.js';
import { lanAddressesByOwner, type LanLeaseRow } from './lanAddress.js';
import { webProgramOn } from './webServing.js';
import { canBoot } from '../boot/bootFiles.js';
import { createFsView } from '../filesystem/fsView.js';
import { HTTP_DEFAULT_PORT, METHOD_NOT_ALLOWED_PAGE, resolveWebPath } from './http.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import { generatedLanBox } from './generatedLanBox.js';
import {
  CHAINIT_NETWORK,
  EMAILIT_NETWORK,
  FINDIT_NETWORK,
  HIREME_NETWORK,
  TALKIT_NETWORK,
} from '../generation/fixedSites.js';
import { answerSignup, type SignUp } from '../emailit/signup.js';
import { answerApply, type Apply } from '../hireme/apply.js';
import { answerPost, type PostThread } from '../talkit/answerPost.js';
import { answerComment, type PostComment } from '../talkit/answerComment.js';
import { indexedWeb, siteOn, type MachinePatchRow } from '../findit/webIndex.js';
import { rankPages } from '../findit/search.js';
import { searchResultsPage } from '../findit/page.js';
import { answerAddress, type LedgerReads } from '../chainit/answerAddress.js';
import { answerRecent, answerRich, type ChainReads } from '../chainit/chainViews.js';
import {
  answerThread,
  answerThreads,
  type ForumReads,
  type ViewAnswer,
} from '../talkit/answerViews.js';
import {
  ACCESS_LOG_OWNER,
  ACCESS_LOG_PATH,
  ACCESS_LOG_PERMISSIONS,
  formatAccessLogLine,
  type HttpMethod,
} from '../logging/accessLog.js';
import {
  resolveVantageSourceIp,
  type FindHomeNetworkByOwnerKey,
  type FindPublicIpByEssid,
} from '../logging/crossPlayerSourceIp.js';
import { standingVantage, type FindActiveSession } from '../patches/authorizeMachineAccess.js';
import {
  TALKIT_LOG_OWNER,
  TALKIT_LOG_PATH,
  TALKIT_LOG_PERMISSIONS,
  formatTalkitCommentLine,
  formatTalkitPostLine,
} from '../logging/talkitLog.js';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog.js';
import { asGameTime } from '../types.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { OccupantWorkstation } from '../patches/remoteWritePermission.js';
import type { Directory } from '../filesystem/types.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

/** One occupant a NAT forward can land a fetch on: the identity fields that rebuild its
 *  tree, plus the machine id its journal is scoped to. Composed from the shared
 *  `OccupantWorkstation` rather than restated, so the tree this handler serves from is
 *  built by the same generator the write and read paths check against. */
export type HttpFetchOccupant = OccupantWorkstation & {
  readonly workstation_machine_id: string;
};

/** What a public IP resolves to: the AP that bears it. The gateway always exists — it is
 *  the access point's own infrastructure rather than a machine that joins — so both its
 *  journal scope and the ESSID that seeds it are always present. */
export type ApNetworkLookup = {
  readonly router_machine_id: string;
  readonly essid: string;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

/** What it takes to find the box behind a public address and a port. Named apart from
 *  the fetch's own dependencies because reaching a box and asking it for something are
 *  different jobs: a single page read and a whole path sweep enter through the same
 *  door, and neither may reach a box the other could not. */
export type WebTargetDeps = {
  readonly findNetworkByPublicIp: (
    publicIp: string,
  ) => Promise<{ readonly data: ApNetworkLookup | null; readonly error: unknown }>;
  /** A machine's FULL patch journal (scoped to `machine_id`, server order) — the gateway's,
   *  for the boot gate and the live forward table, then the reached box's, for its running
   *  services and the page itself. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  /** Who is currently ON the ESSID. Occupancy is half the reachability test, so a forward
   *  naming the address of somebody who has left the WiFi reaches nothing. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly HttpFetchOccupant[] | null; readonly error: unknown }>;
  /** Every lease held on this ESSID, in ONE read — the addresses of record, the same read
   *  the ssh gate resolves a forward through. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
};

export type ResolveHttpFetchDeps = WebTargetDeps & {
  readonly nonceStore: NonceStore;
  /** The universe clock (UTC epoch-ms) at the moment the hit is recorded. Server-side, so
   *  a requester cannot date their own visit. */
  readonly now: () => number;
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** The requester's own home network — the source IP the line records when they fetch
   *  from home, derived from their VERIFIED key rather than anything they sent. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
  /** One network's public IP from its ESSID — the origin of a fetch launched from a box
   *  the caller is standing on but does not own. */
  readonly findPublicIpByEssid: FindPublicIpByEssid;
  /** Whether the caller really holds the box they name as the one they fetched from. */
  readonly findActiveSession: FindActiveSession;
  /** Every publisher's journal in ONE read, for findit's index. Only a search reaches
   *  it, so an ordinary fetch pays nothing for it. */
  readonly findPatchesForMachines: (
    machineIds: readonly string[],
  ) => Promise<{ readonly data: readonly MachinePatchRow[] | null; readonly error: unknown }>;
  /** Open an emailit.io account. Only a form POSTed to emailit's `/signup` reaches it. */
  readonly signUp: SignUp;
  /** Apply for contract work at hireme.io. Only a form POSTed to hireme's `/apply`
   *  reaches it. */
  readonly apply: Apply;
  /** A fresh address in the boards' block, offered to `apply` for a handle that has no
   *  board yet. */
  readonly drawBoardAddress: () => string;
  /** Start a thread at talkit.io. Only a form POSTed to talkit's `/post` reaches it. */
  readonly postThread: PostThread;
  /** Comment on a thread at talkit.io. Only a form POSTed to talkit's `/comment` reaches
   *  it. */
  readonly postComment: PostComment;
} & LedgerReads &
  ChainReads &
  ForumReads;

const UNREACHABLE: HandlerResponse = { status: 404, body: { error: 'host_unreachable' } };
const NOT_FOUND: HandlerResponse = { status: 404, body: { error: 'not_found' } };

// Loose so the envelope fields pass through; the refine keeps the codebase-wide posture
// that a client never claims identity (the caller is the verified pubkey).
const resolveHttpFetchSchema = z
  .looseObject({
    action: z.literal('resolveHttpFetch'),
    target: z.string().min(1),
    port: z.number().int().positive().optional(),
    /** The URL path as written by the client, NOT a filesystem path. Resolved
     *  server-side — see the module doc. */
    path: z.string().min(1),
    /** A form, which makes the request a POST. Never logged: a form can hold a password.
     *  Long enough for a post to talkit.io: 4,000 characters, each up to 4 UTF-8 bytes
     *  and each byte sent as `%XX`, with the title and the field names. */
    body: z.string().max(49_152).optional(),
    /** The emailit.io login a form posted to talkit.io carries, as `mail` sends one. Read
     *  by talkit's `/post` alone; never logged. */
    login: z.object({ handle: z.string().min(1), password: z.string() }).optional(),
    /** The box the caller fetched FROM, when they stand on a hop. Absent at home. The
     *  server reads the network off its session row to trace the hit to where it came
     *  from, and refuses a box the caller does not hold. */
    caller_machine_id: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** The box a destination port reaches, and the port that box must be serving the web on
 *  for the connection to succeed: a forward's INTERNAL port, or the destination port
 *  itself when the gateway serves it directly. Carries its own log identity so the arms
 *  differ in one place: which machine the hit lands on, and whose row it accretes under. */
type FetchTarget = {
  readonly fs: Directory;
  readonly servicePort: number;
  readonly machineId: string;
  readonly logWriterKey: string;
  /** The network the reached box belongs to. A box that answers for a SERVICE rather
   *  than from a disk — findit — is known by this, so nothing has to guess from an
   *  address the client supplied. */
  readonly essid: string;
};

/** A target that answered: something serves the web on its port, and this names the
 *  program (`nginx`, `apache2`) for the caller's `Server` header. */
type WebTarget = FetchTarget & { readonly server: string };

/**
 * Resolve a NAT-forwarded port to the box behind it: the occupant leasing the address the
 * forward names. Both halves of that lookup matter — the lease says which address a box
 * answers to, occupancy says the box is still on the WiFi — so a forward to an unleased
 * address, or to a lease whose holder has disconnected, reaches nothing.
 */
const resolveForwardTarget = async (
  deps: WebTargetDeps,
  network: ApNetworkLookup,
  forwarded: { readonly internalIp: string; readonly internalPort: number },
): Promise<FetchTarget | HandlerResponse> => {
  const occupants = await deps.listOccupantsByEssid(network.essid);
  if (occupants.error) {
    return { status: 500, body: { error: 'occupants_lookup_failed' } };
  }
  const leases = await deps.listLeasesByEssid(network.essid);
  if (leases.error) {
    return { status: 500, body: { error: 'leases_lookup_failed' } };
  }
  const addresses = lanAddressesByOwner(network.essid, leases.data ?? []);
  const occupant = (occupants.data ?? []).find(
    (row) => addresses.get(row.owner_key) === forwarded.internalIp,
  );
  if (occupant === undefined) {
    return generatedForwardTarget(deps, network, forwarded);
  }

  const patches = await deps.findPatches({ machine_id: occupant.workstation_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const occupantFs = bootableOccupantFs(occupant, patches.data);
  // A bricked box behind the NAT cannot come up, so the forward reaches a dead host —
  // whatever its document root still holds.
  if (occupantFs === null) {
    return UNREACHABLE;
  }
  return {
    fs: occupantFs,
    servicePort: forwarded.internalPort,
    machineId: occupant.workstation_machine_id,
    essid: network.essid,
    // The keystone: the log is the OWNER's, never the requester's. A stranger who could
    // write their own row would fork the file per visitor — and could then rewrite the
    // record of their own visit, since a journal row belongs to whoever wrote it.
    logWriterKey: occupant.owner_key,
  };
};

/** The machine the ESSID itself generated at the forwarded address, when no occupant
 *  holds it — the box an institution serves its website from, which nobody owns and
 *  which exists whether or not anybody has joined. Nobody owns it, so its log accretes
 *  under the network's own key. */
const generatedForwardTarget = async (
  deps: WebTargetDeps,
  network: ApNetworkLookup,
  forwarded: { readonly internalIp: string; readonly internalPort: number },
): Promise<FetchTarget | HandlerResponse> => {
  const box = await generatedLanBox(deps.findPatches, network.essid, forwarded.internalIp);
  if (box.kind === 'error') {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  if (box.kind === 'absent') {
    return UNREACHABLE;
  }
  return {
    fs: box.fs,
    servicePort: forwarded.internalPort,
    machineId: box.machineId,
    essid: network.essid,
    logWriterKey: apGatewayLogWriterKey(network.essid),
  };
};

/** The AP gateway as a fetch target — the box the public IP itself belongs to, serving a
 *  page a root session published on it. It has no owner, so its log accretes under the
 *  network's own stable log-writer key, the same one the ssh gate uses so both logs land
 *  in one row. */
const gatewayTarget = (
  network: ApNetworkLookup,
  gatewayFs: Directory,
  port: number,
): FetchTarget => ({
  fs: gatewayFs,
  servicePort: port,
  machineId: network.router_machine_id,
  essid: network.essid,
  logWriterKey: apGatewayLogWriterKey(network.essid),
});

/**
 * Record the hit on the machine that served it — the defender's half of a door that
 * opens for anyone. Written for a 404 exactly as for a 200: one miss is a typo, a
 * hundred is somebody walking the document root, and only the written-down misses tell
 * them apart.
 *
 * Best-effort throughout: the page is the product and the line is the record of it, so a
 * logging failure must never become an error the requester can see. It would otherwise
 * leak the defender's storage state to an anonymous stranger.
 */
const logFetch = async (
  deps: ResolveHttpFetchDeps,
  target: FetchTarget,
  actorKey: string,
  standingEssid: string | null,
  hit: {
    readonly method?: HttpMethod;
    readonly path: string;
    readonly status: number;
    readonly size: number;
  },
): Promise<string> => {
  // The box the caller fetched from decides the origin: a hop traces to that network's
  // public IP, home to the caller's own — derived server-side either way.
  const sourceIp = await resolveVantageSourceIp(deps, { actorKey, standingEssid });
  const line = formatAccessLogLine({
    time: asGameTime(deps.now()),
    ...(hit.method === undefined ? {} : { method: hit.method }),
    sourceIp,
    path: hit.path,
    status: hit.status,
    size: hit.size,
  });
  try {
    await appendMachineLog(
      { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: target.logWriterKey,
        machineId: target.machineId,
        path: ACCESS_LOG_PATH,
        owner: ACCESS_LOG_OWNER,
        permissions: ACCESS_LOG_PERMISSIONS,
      },
      line,
    );
  } catch {
    // best-effort: the served page stands regardless of a logging failure.
  }
  return sourceIp;
};

/**
 * The box a public address and port reach, or the refusal that stopped us — the whole
 * reachability chain in one place, so a page read and a path sweep can never disagree
 * about which box answered or whether it answered at all.
 *
 * Every failure collapses into one shape on purpose (see the module doc): a prober
 * learns nothing from which gate refused them.
 */
export const resolveWebTarget = async (
  deps: WebTargetDeps,
  request: { readonly target: string; readonly port: number },
): Promise<WebTarget | HandlerResponse> => {
  const { data, error } = await deps.findNetworkByPublicIp(request.target);
  if (error) {
    return { status: 500, body: { error: 'network_lookup_failed' } };
  }
  if (data === null) {
    return UNREACHABLE;
  }

  // Materialize the GATEWAY once: it drives the boot gate and the port routing, off one
  // consistent tree.
  const patches = await deps.findPatches({ machine_id: data.router_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const gatewayFs = materializeApGatewayFs(data, patches.data);

  // A bricked gateway takes the whole public IP dark — nothing behind it is reachable
  // even if the box itself is up and serving.
  if (!canBoot(gatewayFs).ok) {
    return UNREACHABLE;
  }

  const served: ServedMachine = machineServing({ routerFs: gatewayFs, port: request.port });
  if (served.kind === 'none') {
    return UNREACHABLE;
  }
  const target =
    served.kind === 'router'
      ? gatewayTarget(data, gatewayFs, request.port)
      : await resolveForwardTarget(deps, data, served);
  if ('status' in target) {
    return target;
  }

  // ONE liveness check for both arms, and it is service-specific: reaching a listening
  // daemon is not reaching a web server. A forward onto `sshd`, or the gateway's own
  // `:22`, refuses exactly like a closed port. The same read names the program that
  // answers, for the caller's `Server` header.
  const server = webProgramOn(target.fs, target.servicePort);
  return server === undefined ? UNREACHABLE : { ...target, server };
};

/**
 * What a request ASKED for, when it is a search: the `q` a reader typed, or null when
 * the request is for a file like any other.
 *
 * Only the root answers a search. Every other path on findit is a file on findit's own
 * disk, so a rooted findit can be given pages of its own without any of them being
 * swallowed by the handler.
 */
const searchedFor = (requestPath: string): string | null => {
  const queryAt = requestPath.indexOf('?');
  if (queryAt === -1 || requestPath.slice(0, queryAt) !== '/') return null;
  const asked = new URLSearchParams(requestPath.slice(queryAt + 1)).get('q')?.trim() ?? '';
  return asked === '' ? null : asked;
};

/** Where emailit.io takes a sign-up. */
const SIGNUP_PATH = '/signup';

/** Where hireme.io takes an application. */
const APPLY_PATH = '/apply';

/** Where talkit.io takes a new thread. */
const POST_PATH = '/post';

/** Where talkit.io takes a comment on a thread. */
const COMMENT_PATH = '/comment';

/** The paths chainit.io answers from the ledger, and how each is answered: a lookup of
 *  one address, the latest transfers on the chain, the richest addresses. A view is never
 *  a file, whatever a root writes at its path. */
const CHAINIT_VIEWS = new Map<
  string,
  (requestPath: string, ledger: LedgerReads & ChainReads) => Promise<string | null>
>([
  ['/address', answerAddress],
  ['/recent', (_requestPath, ledger) => answerRecent(ledger)],
  ['/rich', (_requestPath, ledger) => answerRich(ledger)],
]);

/** The paths talkit.io answers from the forum's table: the thread list, and one thread.
 *  Like chainit's views, never a file, whatever a root writes at their paths. */
const TALKIT_VIEWS = new Map<
  string,
  (requestPath: string, forum: ForumReads) => Promise<ViewAnswer>
>([
  ['/threads', answerThreads],
  ['/thread', answerThread],
]);

/** A request path without its query string. */
const pathOf = (requestPath: string): string => requestPath.split('?')[0] ?? requestPath;

/** One line in talkit.io's own log, for a thread or a comment that went up. Best-effort,
 *  as `logFetch` is: what a player wrote stands regardless of a logging failure. */
const appendTalkitLine = async (
  deps: ResolveHttpFetchDeps,
  target: FetchTarget,
  line: string,
): Promise<void> => {
  try {
    await appendMachineLog(
      { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: target.logWriterKey,
        machineId: target.machineId,
        path: TALKIT_LOG_PATH,
        owner: TALKIT_LOG_OWNER,
        permissions: TALKIT_LOG_PERMISSIONS,
      },
      line,
    );
  } catch {
    // best-effort, as above.
  }
};

/**
 * findit's answer to a search — the one address in this world that replies from a
 * FUNCTION rather than from a file.
 *
 * The index is read here, at the moment of the search, out of what every publisher is
 * serving right now; see `indexedWeb`. It is never a file on findit, which is why
 * rooting findit defaces its front door without poisoning anybody's results.
 */
const answerSearch = async (
  deps: ResolveHttpFetchDeps,
  query: string,
): Promise<string> => {
  const web = await indexedWeb({
    findPatchesForMachines: deps.findPatchesForMachines,
    // Every site this index cannot rebuild from the generated world — a player's page,
    // or a gateway somebody repointed — is fetched exactly as a reader would fetch it,
    // so what is listed is what a visitor would be served. Only READ: the crawl leaves
    // no line in anybody's log, or every search would tell every listed site it ran.
    siteAt: async (publicIp: string) => {
      const target = await resolveWebTarget(deps, { target: publicIp, port: HTTP_DEFAULT_PORT });
      return 'status' in target ? null : siteOn(target.fs);
    },
  });
  return searchResultsPage(query, rankPages(web, query));
};

export const handleResolveHttpFetch = async (
  body: unknown,
  deps: ResolveHttpFetchDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveHttpFetchSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // Where the caller fetched FROM: a box they hold a session on traces the hit to that
  // network, home to their own. A box they name but do not hold is refused, so a trace
  // can never be addressed from a network the caller merely claims. No box named means
  // home — the credential-free door still opens there with no session (decision 6).
  const standing = await standingVantage(
    publicKey,
    payload.caller_machine_id,
    deps.findActiveSession,
  );
  if (!standing.ok) {
    return { status: standing.status, body: { error: standing.error } };
  }

  const target = await resolveWebTarget(deps, {
    target: payload.target,
    port: payload.port ?? HTTP_DEFAULT_PORT,
  });
  if ('status' in target) {
    return target;
  }

  // emailit.io's `/signup` is the one place in the world that takes a form, and like
  // findit's search it answers from a function, not a file: a rooted emailit.io can deface
  // its front page without breaking sign-up, and a dark one has already refused above.
  if (
    payload.body !== undefined &&
    target.essid === EMAILIT_NETWORK &&
    pathOf(payload.path) === SIGNUP_PATH
  ) {
    const page = await answerSignup({
      form: payload.body,
      playerKey: publicKey,
      signUp: deps.signUp,
    });
    if (page === null) return { status: 500, body: { error: 'signup_failed' } };
    await logFetch(deps, target, publicKey, standing.standingEssid, {
      method: 'POST',
      path: payload.path,
      status: 200,
      size: page.length,
    });
    return { status: 200, body: { ok: true, content: page, server: target.server } };
  }

  // hireme.io's `/apply` takes an application the same way, answered from a function: a
  // root on hireme can deface the front page, but never stop it taking applications.
  if (
    payload.body !== undefined &&
    target.essid === HIREME_NETWORK &&
    pathOf(payload.path) === APPLY_PATH
  ) {
    const page = await answerApply({
      form: payload.body,
      apply: deps.apply,
      drawBoardAddress: deps.drawBoardAddress,
    });
    if (page === null) return { status: 500, body: { error: 'apply_failed' } };
    await logFetch(deps, target, publicKey, standing.standingEssid, {
      method: 'POST',
      path: payload.path,
      status: 200,
      size: page.length,
    });
    return { status: 200, body: { ok: true, content: page, server: target.server } };
  }

  // talkit.io's `/post` takes a new thread, signed with the login that came beside the
  // form, and like `/signup` answers from a function: a root on talkit can deface the
  // front page's form, but never post as anybody or stop the forum taking posts.
  if (
    payload.body !== undefined &&
    target.essid === TALKIT_NETWORK &&
    pathOf(payload.path) === POST_PATH
  ) {
    const answer = await answerPost({
      form: payload.body,
      login: payload.login ?? null,
      playerKey: publicKey,
      postThread: deps.postThread,
    });
    if (answer === null) return { status: 500, body: { error: 'post_failed' } };
    const sourceIp = await logFetch(deps, target, publicKey, standing.standingEssid, {
      method: 'POST',
      path: payload.path,
      status: 200,
      size: answer.page.length,
    });
    if (answer.posted !== null) {
      await appendTalkitLine(
        deps,
        target,
        formatTalkitPostLine({ time: asGameTime(deps.now()), sourceIp, ...answer.posted }),
      );
    }
    return { status: 200, body: { ok: true, content: answer.page, server: target.server } };
  }

  // talkit.io's `/comment` takes a comment on a thread the same way, signed with the login
  // beside the form and answered from a function.
  if (
    payload.body !== undefined &&
    target.essid === TALKIT_NETWORK &&
    pathOf(payload.path) === COMMENT_PATH
  ) {
    const answer = await answerComment({
      form: payload.body,
      login: payload.login ?? null,
      playerKey: publicKey,
      postComment: deps.postComment,
    });
    if (answer === null) return { status: 500, body: { error: 'comment_failed' } };
    const sourceIp = await logFetch(deps, target, publicKey, standing.standingEssid, {
      method: 'POST',
      path: payload.path,
      status: 200,
      size: answer.page.length,
    });
    if (answer.commented !== null) {
      await appendTalkitLine(
        deps,
        target,
        formatTalkitCommentLine({ time: asGameTime(deps.now()), sourceIp, ...answer.commented }),
      );
    }
    return { status: 200, body: { ok: true, content: answer.page, server: target.server } };
  }

  // No other server takes a form. It still answered, with its 405 page, so the refusal is
  // recorded like any served response — as the POST it was, never with the form.
  if (payload.body !== undefined) {
    await logFetch(deps, target, publicKey, standing.standingEssid, {
      method: 'POST',
      path: payload.path,
      status: 405,
      size: METHOD_NOT_ALLOWED_PAGE.length,
    });
    return { status: 405, body: { error: 'method_not_allowed', server: target.server } };
  }

  // chainit answers its views from the ledger, like findit's search, never from a file:
  // a root on chainit can deface its front page or plant a file at a view's path, but
  // cannot make the explorer say the ledger holds what it does not. Reached only after the
  // target resolved, so a dark chainit answers no view at all.
  const view =
    target.essid === CHAINIT_NETWORK ? CHAINIT_VIEWS.get(pathOf(payload.path)) : undefined;
  if (view !== undefined) {
    const page = await view(payload.path, deps);
    // No page was served, so nothing is recorded — as for a sign-up that failed.
    if (page === null) return { status: 500, body: { error: 'ledger_lookup_failed' } };
    await logFetch(deps, target, publicKey, standing.standingEssid, {
      path: payload.path,
      status: 200,
      size: page.length,
    });
    return { status: 200, body: { ok: true, content: page, server: target.server } };
  }

  // talkit answers its views from the forum's table: a root on talkit can deface its
  // front page or plant a file at a view's path, but cannot change what a player wrote.
  // Reached only after the target resolved, so a dark talkit answers no view at all.
  const forumView =
    target.essid === TALKIT_NETWORK ? TALKIT_VIEWS.get(pathOf(payload.path)) : undefined;
  if (forumView !== undefined) {
    const answer = await forumView(payload.path, deps);
    // No page was served, so nothing is recorded — as for chainit's failed read.
    if (answer === null) return { status: 500, body: { error: 'forum_lookup_failed' } };
    const content = answer.status === 200 ? answer.page : '';
    await logFetch(deps, target, publicKey, standing.standingEssid, {
      path: payload.path,
      status: answer.status,
      size: content.length,
    });
    return answer.status === 200
      ? { status: 200, body: { ok: true, content, server: target.server } }
      : NOT_FOUND;
  }

  // findit answers a search from a function; every other address, and every other path
  // on findit itself, answers from a file. Reached only AFTER the target resolved, so a
  // findit that is bricked or whose web server was stopped takes search down with it —
  // exactly as it would take its front page down.
  const query = target.essid === FINDIT_NETWORK ? searchedFor(payload.path) : null;
  if (query !== null) {
    const results = await answerSearch(deps, query);
    await logFetch(deps, target, publicKey, standing.standingEssid, {
      path: payload.path,
      status: 200,
      size: results.length,
    });
    return { status: 200, body: { ok: true, content: results, server: target.server } };
  }

  // The document-root confinement, applied to the RAW client path. A path that climbs out
  // names nothing, and says so the same way a missing file does — telling a caller their
  // traversal was spotted is itself a hint worth withholding.
  //
  // Read as the SERVER, not as the caller: the requester has no account on this box at
  // all, and a page published under the document root is written by root and so readable
  // by root alone. The confinement is the document root, not the file permissions.
  const filePath = resolveWebPath(payload.path);
  const page = filePath === null ? null : createFsView(target.fs, { userType: 'root' }).read(filePath);
  const content = page === null || !page.ok ? null : page.content;

  // The machine answered, so the machine records it — a 404 is a served response, and the
  // one a defender most needs to see. Only the unreachable cases above leave no trace,
  // where there was no machine to do the recording.
  await logFetch(deps, target, publicKey, standing.standingEssid, {
    path: payload.path,
    status: content === null ? 404 : 200,
    size: content === null ? 0 : content.length,
  });

  return content === null
    ? NOT_FOUND
    : { status: 200, body: { ok: true, content, server: target.server } };
};
