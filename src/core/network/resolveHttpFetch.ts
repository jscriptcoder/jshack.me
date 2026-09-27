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
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { materializeApGatewayFs } from './materializeRouterFs';
import type { OwnerPatchRow } from './materializeWorkstationFs';
import { machineServing, type ServedMachine } from './machineServing';
import { bootableOccupantFs } from './natHosts';
import { lanAddressesByOwner, type LanLeaseRow } from './lanAddress';
import { servesWebOn } from './webServing';
import { canBoot } from '../boot/bootFiles';
import { createFsView } from '../filesystem/fsView';
import { HTTP_DEFAULT_PORT, resolveWebPath } from './http';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter';
import { generatedLanBox } from './generatedLanBox';
import { FINDIT_NETWORK } from '../generation/findit';
import {
  indexedWeb,
  siteOn,
  type MachinePatchRow,
  type WebIndexDeps,
} from '../findit/webIndex';
import { rankPages } from '../findit/search';
import { searchResultsPage } from '../findit/page';
import {
  ACCESS_LOG_OWNER,
  ACCESS_LOG_PATH,
  ACCESS_LOG_PERMISSIONS,
  formatAccessLogLine,
} from '../logging/accessLog';
import {
  resolveCrossPlayerSourceIp,
  type FindHomeNetworkByOwnerKey,
} from '../logging/crossPlayerSourceIp';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog';
import { asGameTime } from '../types';
import type { PatchRow } from '../patches/upsertPatch';
import type { OccupantWorkstation } from '../patches/remoteWritePermission';
import type { Directory } from '../filesystem/types';
import type { NonceStore } from '../signedRequest/nonceStore';

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
  /** The requester's own home network — the source IP the line records, derived from
   *  their VERIFIED key rather than anything they sent. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
  /** Every publisher's journal in ONE read, for findit's index. Only a search reaches
   *  it, so an ordinary fetch pays nothing for it. */
  readonly findPatchesForMachines: (
    machineIds: readonly string[],
  ) => Promise<{ readonly data: readonly MachinePatchRow[] | null; readonly error: unknown }>;
  /** Every network anybody has joined, for findit to look for the pages they serve.
   *  Only a search reaches it. */
  readonly listPublicAddresses: WebIndexDeps['listPublicAddresses'];
};

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
  hit: { readonly path: string; readonly status: number; readonly size: number },
): Promise<void> => {
  const line = formatAccessLogLine({
    time: asGameTime(deps.now()),
    sourceIp: await resolveCrossPlayerSourceIp(deps.findHomeNetworkByOwnerKey, actorKey),
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
): Promise<FetchTarget | HandlerResponse> => {
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
  // `:22`, refuses exactly like a closed port.
  return servesWebOn(target.fs, target.servicePort) ? target : UNREACHABLE;
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

/**
 * findit's answer to a search — the one address in this world that replies from a
 * FUNCTION rather than from a file.
 *
 * The index is built here, at the moment of the search, out of what every publisher is
 * serving right now; see `indexedWeb`. It is never a file on findit, which is why
 * rooting findit defaces its front door without poisoning anybody's results.
 */
const answerSearch = async (
  deps: ResolveHttpFetchDeps,
  query: string,
): Promise<string> => {
  const web = await indexedWeb({
    findPatchesForMachines: deps.findPatchesForMachines,
    listPublicAddresses: deps.listPublicAddresses,
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

  const target = await resolveWebTarget(deps, {
    target: payload.target,
    port: payload.port ?? HTTP_DEFAULT_PORT,
  });
  if ('status' in target) {
    return target;
  }

  // findit answers a search from a function; every other address, and every other path
  // on findit itself, answers from a file. Reached only AFTER the target resolved, so a
  // findit that is bricked or whose web server was stopped takes search down with it —
  // exactly as it would take its front page down.
  const query = target.essid === FINDIT_NETWORK ? searchedFor(payload.path) : null;
  if (query !== null) {
    const results = await answerSearch(deps, query);
    await logFetch(deps, target, publicKey, {
      path: payload.path,
      status: 200,
      size: results.length,
    });
    return { status: 200, body: { ok: true, content: results } };
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
  await logFetch(deps, target, publicKey, {
    path: payload.path,
    status: content === null ? 404 : 200,
    size: content === null ? 0 : content.length,
  });

  return content === null ? NOT_FOUND : { status: 200, body: { ok: true, content } };
};
