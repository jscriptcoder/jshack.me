/**
 * handleRecordLanFetch — the server-side action behind a `curl`/`lynx`/`gobuster` fetch
 * of a host on the network the caller stands on, and the own-LAN twin of
 * `resolveHttpFetch`'s cross-player append.
 *
 * An access log belongs to the SERVER, not to the network path: a web server writes a
 * line for every request it serves, and where the request came from only decides what
 * lands in the source-IP field. A fetch of a host on the caller's own network resolves
 * entirely client-side, so this handler exists to give it the round-trip it needs to
 * leave that line — exactly as `handleNmapScan` does for a scan that also resolved
 * client-side.
 *
 * It takes a RUN of paths rather than one, because a path sweep is a fetch tool that
 * asks forty questions and its whole cost to the attacker is the wall of 404s it
 * leaves behind. `curl` names one path, `gobuster` names every word it tried, and both
 * land as a single append — the alternative is one signed round-trip per word, each
 * re-reading and re-writing the entire log.
 *
 * WHERE THE CALLER STANDS IS DERIVED, NEVER CLAIMED. The client names the box it ran
 * from (`caller_machine_id`); the server places it with `resolveCallerVantage` — at home
 * on its own network, or in a shell on a box it holds a live session on — and refuses a
 * network it is not standing on (`wrong_network`) or a box it does not hold
 * (`no_session`). The source address a line records is the address that box is seen at
 * on the reached network, worked out here, so a crafted request can never author a line
 * from an address the traffic never used. This retires the own-LAN path's old trust in a
 * client `source_ip`.
 *
 * WHICH BOX ANSWERED is resolved among the networks the caller reaches, nearest first:
 *   - a host on a DEEP LAYER the box reaches, swept there through the same
 *     `resolveDeepScanHosts` a scan and an ssh login use (a switch fronting the layer
 *     drops the ports its live ACL denies, read off its journal; a router filters
 *     nothing, so its journal is never read);
 *   - a PLAYER's workstation, when the address is the lease its owner holds and the box
 *     is the caller's own or the one their shell stands on — read from its live journal,
 *     because a fresh box serves nothing and an edited page is what a fetch returns;
 *   - otherwise a generated NPC sibling on the LAN.
 * The loopback address names the box the shell stands ON, and the visit is recorded as
 * local. In a shell on a box the network generates that is the box the caller named and
 * holds a session on, wherever it sits, so nothing is looked up by address and no gateway
 * in front of it is asked: the request never leaves the box. A player's workstation is
 * the one box the network does not generate, and is found by the lease it holds —
 * whoever's it is, so a visitor in a shell on another player's box leaves their line in
 * that player's log.
 *
 * The client names no time, status or size — for any line, however many it asks for.
 * The server reads the resolved tree and works those out itself, so a crafted request
 * can never author a line claiming something was served that never was, and a sweep
 * cannot dress its misses up as hits.
 *
 * The writer key follows the box, not the fetcher. A player's workstation keeps its
 * OWNER's key, whoever fetched it. A generated or deep NPC host has no owner, and every
 * visitor fetches from the identical box, so it takes the network's own key: one log
 * that every visit accretes into, rather than a row per fetcher where the newest erases
 * the rest.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import {
  chainGatewayBaseFs,
  generatedBaseFsForMachineId,
  resolveLanHostIdentity,
} from '../generation/lanHostIdentity.js';
import { segmentsReachedFrom } from '../generation/lanTopology.js';
import { resolveDeepScanHosts } from '../scan/deepScanHosts.js';
import { materializeMachineFs } from './materializeMachineFs.js';
import { lanAddressFor, type LanLeaseRow } from './lanAddress.js';
import { materializeWorkstationFs, type OwnerPatchRow } from './materializeWorkstationFs.js';
import { createFsView } from '../filesystem/fsView.js';
import { resolveWebPath } from './http.js';
import { readOpenPorts, type OpenPort } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { LOOPBACK_IPV4 } from './interfaces.js';
import {
  ACCESS_LOG_OWNER,
  ACCESS_LOG_PATH,
  ACCESS_LOG_PERMISSIONS,
  formatAccessLogLine,
} from '../logging/accessLog.js';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog.js';
import { asGameTime } from '../types.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import { resolveCallerVantageOn, type CallerVantageDeps } from '../sessions/callerVantage.js';
import type { Directory } from '../filesystem/types.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

/** The occupancy fields an own-LAN fetch trace needs: whose row it is and which box (to
 *  spot a fetch of the caller's own workstation, or of the one their shell stands on)
 *  and the identity fields that rebuild that box so the server can read what it
 *  actually served. No machine NAME — unlike a syslog line, an access-log line carries
 *  no hostname. */
export type FetchOccupant = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

export type RecordLanFetchDeps = CallerVantageDeps & {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the access.log line. */
  readonly now: () => number;
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** Every occupant of the ESSID — read to recognise the workstation that answered
   *  and to rebuild it. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly FetchOccupant[] | null; readonly error: unknown }>;
  /** Every lease on the ESSID — a player's LAN address is a lease, not a derivation,
   *  so this is what says whose workstation an address is. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
  /** A box's journal, replayed over its seeded base. Reads a player's workstation
   *  (a fresh box serves nothing, so whether it serves at all lives here), and a switch
   *  fronting a deep layer (its live ACL). */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through; the
// refine rejects a client-supplied player_key (the server stamps it from the verified
// pubkey). `paths` is REQUIRED and NON-EMPTY: defaulting it, or accepting an empty
// list, would let a caller omit the one field the lines are written about. Any other
// field a client sends is simply not read — a `source_ip` included, since the server
// now derives it.
const recordLanFetchSchema = z
  .looseObject({
    action: z.literal('recordLanFetch'),
    essid: z.string().min(1),
    target: z.string().min(1),
    port: z.number().int(),
    paths: z.array(z.string().min(1)).min(1),
    caller_machine_id: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** Which machine answered, the tree it answered from, the ports to judge "serving the
 *  web" against (ACL-applied on a deep layer), the key its log lands under, and the
 *  address the line records it coming from. */
type FetchTarget = {
  readonly machineId: string;
  readonly fs: Directory;
  readonly ports: readonly OpenPort[];
  readonly writerKey: string;
  readonly sourceIp: string;
};

/** The player's workstation at `address` on this LAN, when it is the caller's OWN or the
 *  one their shell STANDS ON — the two a fetch is ever served from, since nothing on the
 *  LAN serves a player's pages to a shell that is neither theirs nor on their box. Found
 *  by the lease its owner holds, and filed under that owner's key: their box keeps one
 *  log however many visitors leave a line in it. Every read here is load-bearing — a
 *  failure means we cannot tell whose box this is, and guessing would land the line on a
 *  generated host that shares the octet. Null falls through to the generated-host path,
 *  which finds nothing for an address only a player holds. */
const workstationTarget = async (
  deps: RecordLanFetchDeps,
  essid: string,
  standing: { readonly callerKey: string; readonly callerMachineId: string | undefined },
  address: string,
  sourceIp: string,
): Promise<FetchTarget | null> => {
  const leases = await deps.listLeasesByEssid(essid);
  if (leases.error) return null;
  const lease = (leases.data ?? []).find((row) => lanAddressFor(essid, row.octet) === address);
  if (lease === undefined) return null;

  const occupants = await deps.listOccupantsByEssid(essid);
  if (occupants.error) return null;
  const holder = (occupants.data ?? []).find((row) => row.owner_key === lease.owner_key);
  if (holder === undefined) return null;
  const servesTheCaller =
    holder.owner_key === standing.callerKey ||
    holder.workstation_machine_id === standing.callerMachineId;
  if (!servesTheCaller) return null;

  const patches = await deps.findPatches({ machine_id: holder.workstation_machine_id });
  if (patches.error) return null;
  const fs = materializeWorkstationFs(holder, patches.data);
  return {
    machineId: holder.workstation_machine_id,
    fs,
    ports: readOpenPorts(fs),
    writerKey: holder.owner_key,
    sourceIp,
  };
};

/** The host at `address` on a deep layer the caller's box reaches, or null when none is.
 *  A `HandlerResponse` means a read the trace cannot proceed without failed (a switch's
 *  live ACL): a 500 rather than a silently wrong line. Nobody owns a deep NPC host, and
 *  every visitor reaches the identical box, so its log accretes under the network's key. */
const deepLayerTarget = async (
  deps: RecordLanFetchDeps,
  essid: string,
  callerMachineId: string,
  address: string,
): Promise<FetchTarget | HandlerResponse | null> => {
  for (const segment of segmentsReachedFrom(essid, callerMachineId) ?? []) {
    const { fronting } = segment;
    if (fronting === null) continue;
    let frontingFs = chainGatewayBaseFs(essid, fronting);
    if (fronting.host.kind === 'switch') {
      const patches = await deps.findPatches({ machine_id: fronting.machineId });
      if (patches.error) return { status: 500, body: { error: 'patches_lookup_failed' } };
      frontingFs = materializeMachineFs(frontingFs, patches.data);
    }
    const onLayer = resolveDeepScanHosts(essid, fronting, frontingFs).hosts.find(
      (entry) => entry.host.ip === address,
    );
    if (onLayer !== undefined) {
      return {
        machineId: onLayer.machineId,
        fs: onLayer.baseFs,
        ports: onLayer.ports,
        writerKey: apGatewayLogWriterKey(essid),
        sourceIp: segment.address ?? 'unknown',
      };
    }
  }
  return null;
};

/** The generated NPC sibling at `address` on the caller's regenerated LAN, resolved
 *  through the SAME identity map scan and ssh use so the three can never disagree about
 *  which box an address is. Its log files under the network's own key. */
const generatedHostTarget = (
  essid: string,
  address: string,
  sourceIp: string,
): FetchTarget | null => {
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === address);
  if (host === undefined) return null;
  const identity = resolveLanHostIdentity(host, essid);
  return {
    machineId: identity.machineId,
    fs: identity.baseFs,
    ports: readOpenPorts(identity.baseFs),
    writerKey: apGatewayLogWriterKey(essid),
    sourceIp,
  };
};

/** The box the shell stands ON, when the network generates it: a LAN host, a gateway at
 *  any depth, or the machine on a deep layer. The caller named it and the vantage already
 *  confirmed the session they hold there, so it is resolved by what it IS rather than by
 *  an address: where the LAN sees a deep box is the gateway in front of it, which is a
 *  different machine. Its own ports, unfiltered, because nothing stands between a box and
 *  itself. Null for a player's workstation, which the network does not generate. */
const standingBoxTarget = (essid: string, callerMachineId: string): FetchTarget | null => {
  const fs = generatedBaseFsForMachineId(essid, callerMachineId);
  if (fs === null) return null;
  return {
    machineId: callerMachineId,
    fs,
    ports: readOpenPorts(fs),
    writerKey: apGatewayLogWriterKey(essid),
    sourceIp: LOOPBACK_IPV4,
  };
};

/** The box at the address a request names, among the networks the caller reaches, nearest
 *  first: a deep layer the box reaches, then a player's workstation, then a generated
 *  LAN sibling. The arms are exclusive by construction — a deep address is never a LAN
 *  one, and only a player holds a lease — so the order settles a fetch of a workstation
 *  onto the live box rather than a generated collision. */
const addressedTarget = async (
  deps: RecordLanFetchDeps,
  request: {
    readonly essid: string;
    readonly target: string;
    readonly callerMachineId: string | undefined;
  },
  callerKey: string,
  vantageSourceIp: string | null,
): Promise<FetchTarget | HandlerResponse | null> => {
  // Loopback that reaches here stands on a player's workstation, which is found at the
  // lease it holds. A box the server cannot place at an address has none to resolve
  // loopback to, so nothing is logged.
  const address = request.target === LOOPBACK_IPV4 ? vantageSourceIp : request.target;
  if (address === null) return null;
  const sourceIp = vantageSourceIp ?? 'unknown';

  const deep =
    request.callerMachineId === undefined
      ? null
      : await deepLayerTarget(deps, request.essid, request.callerMachineId, address);
  if (deep !== null) return deep;
  return (
    (await workstationTarget(
      deps,
      request.essid,
      { callerKey, callerMachineId: request.callerMachineId },
      address,
      sourceIp,
    )) ?? generatedHostTarget(request.essid, address, sourceIp)
  );
};

export const handleRecordLanFetch = async (
  body: unknown,
  deps: RecordLanFetchDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, recordLanFetchSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // The LAN boundary: the caller learns about — and leaves a line on — only the network
  // it is standing on, placed from where the server puts it rather than from a claim.
  const vantage = await resolveCallerVantageOn(
    deps,
    publicKey,
    payload.caller_machine_id,
    payload.essid,
  );
  if (!vantage.ok) return { status: vantage.status, body: { error: vantage.error } };

  // Loopback names the box the shell stands ON, and the line records a local visit.
  const loopback = payload.target === LOOPBACK_IPV4;
  const standing =
    loopback && payload.caller_machine_id !== undefined
      ? standingBoxTarget(payload.essid, payload.caller_machine_id)
      : null;
  const resolved =
    standing ??
    (await addressedTarget(
      deps,
      {
        essid: payload.essid,
        target: payload.target,
        callerMachineId: payload.caller_machine_id,
      },
      publicKey,
      vantage.sourceIp,
    ));
  if (resolved === null) return { status: 200, body: { ok: true } };
  if ('status' in resolved) return resolved;

  // Only a REACHED web server logs. The client already decided something answered; the
  // server checks the tree it resolved rather than taking that on trust, and a web
  // server is service-specific — a box listening on ssh answered nothing here. On a deep
  // layer the ports are already ACL-shaped, so a port the switch denies refuses here too.
  const serving = resolved.ports.some(
    (entry) => entry.port === payload.port && entry.service === SERVICE_CATALOG.http.service,
  );
  if (!serving) return { status: 200, body: { ok: true } };

  const view = createFsView(resolved.fs, { userType: 'root' });
  // One clock reading for the whole request, because the server handled ONE request —
  // stamping per line would spread a sweep across a span nothing observed. A loopback
  // fetch is recorded as local, whatever the box's address on the LAN is.
  const time = asGameTime(deps.now());
  const recordedSource = loopback ? LOOPBACK_IPV4 : resolved.sourceIp;
  const lines = payload.paths.map((requestPath) => {
    const filePath = resolveWebPath(requestPath);
    const page = filePath === null ? null : view.read(filePath);
    const content = page === null || !page.ok ? null : page.content;
    return formatAccessLogLine({
      time,
      sourceIp: recordedSource,
      // The path AS ASKED FOR, never as resolved: a request that resolved to nothing
      // is exactly the line a defender needs to see.
      path: requestPath,
      status: content === null ? 404 : 200,
      size: content === null ? 0 : content.length,
    });
  });

  try {
    // ONE append for the whole run, the way the hydra sweep lands on `auth.log`: a
    // per-line write would re-read and re-upsert the entire log for every path tried.
    await appendMachineLog(
      { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: resolved.writerKey,
        machineId: resolved.machineId,
        path: ACCESS_LOG_PATH,
        owner: ACCESS_LOG_OWNER,
        permissions: ACCESS_LOG_PERMISSIONS,
      },
      lines.join('\n'),
    );
  } catch {
    // best-effort: the fetch already happened, and a logging failure must not surface.
  }

  return { status: 200, body: { ok: true } };
};
