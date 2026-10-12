/**
 * handleResolveOccupantFetch — the server-side gate for a web fetch of a FELLOW
 * OCCUPANT's box, at the address it holds on the LAN the caller stands on.
 *
 * Every other host on a LAN is the client's to read: a generated box is a function of
 * the network, so `curl` builds its tree and serves the page itself. A player's
 * workstation is built from THEIR identity and THEIR journal, which live here, so a
 * fetch of one is the same round trip a scan of one already is
 * (`handleResolveOccupantScan`). Without it a scan showed a neighbour's web port open
 * and every web tool answered that no such host existed.
 *
 * The web is the door with no credential, so reaching the port is the whole gate, and
 * the gate is the one the scan draws: the caller must stand on the network (at home on
 * it, or in a shell on a box that is), the address must be a lease whose holder is on
 * the WiFi now, the box must boot, and the port must be one it answers to the NETWORK
 * with a web server behind it. A port the owner filtered refuses, exactly as the scan
 * shows it shut. The one caller that filter does not stop is a shell on the box itself:
 * nothing stands between a box and its own address.
 *
 * Three refusals, kept apart because the caller turns them into three sentences and a
 * scan from the same place already tells them apart. `host_unreachable` is an address
 * nothing answers at. `connection_refused` is a box that is there and serves no web on
 * that port. `not_found` is the reached server's 404.
 *
 * The request path arrives RAW and is resolved here, through the `resolveWebPath` every
 * web door uses, so a client can name a URL path and never a file on somebody's box.
 *
 * The box that answered records the visit: one line in its OWNER's log, from the
 * address the server places the caller at. A 404 is recorded as readily as a 200; only
 * a fetch that reached no web server leaves nothing, there being no server to write it.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { lanAddressesByOwner, type LanLeaseRow } from './lanAddress.js';
import { bootableOccupantFs } from './natHosts.js';
import { portsOpenToNetwork } from './portsOpenToNetwork.js';
import { webProgramOn } from './webServing.js';
import { resolveWebPath } from './http.js';
import { LOOPBACK_IPV4 } from './interfaces.js';
import { readOpenPorts } from '../services/pidfile.js';
import { createFsView } from '../filesystem/fsView.js';
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
import { resolveCallerVantageOn, type CallerVantageDeps } from '../sessions/callerVantage.js';
import type { HttpFetchOccupant } from './resolveHttpFetch.js';
import type { Directory } from '../filesystem/types.js';
import type { OwnerPatchRow } from './materializeWorkstationFs.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

/** What it takes to find a fellow occupant's web server from where the caller stands.
 *  Named apart from the fetch's own dependencies because reaching a box and asking it for
 *  something are different jobs: a single page read and a whole path sweep enter through
 *  the same door, and neither may reach a box the other could not. */
export type OccupantWebTargetDeps = CallerVantageDeps & {
  /** Who is currently ON the ESSID, with the identity fields that rebuild each box.
   *  Occupancy is half the reach: a lease outlives it, so an address whose holder has
   *  left the WiFi answers nothing. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly HttpFetchOccupant[] | null; readonly error: unknown }>;
  /** Every lease held on this ESSID, in ONE read — the addresses of record, the same
   *  read the scan resolves a neighbour through. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
  /** The reached box's FULL journal, replayed over its generated base: whether it
   *  boots, what it runs, what it filters and the pages themselves. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
};

export type ResolveOccupantFetchDeps = OccupantWebTargetDeps & {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the access.log line. */
  readonly now: () => number;
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

/** The web server a request reached on a fellow occupant's box, with the log identity
 *  its visit is written under and the address the server places the caller at. */
export type OccupantWebTarget = {
  readonly fs: Directory;
  /** The program serving the web there (`nginx`, `apache2`). */
  readonly server: string;
  readonly machineId: string;
  /** The log is the OWNER's, never the requester's: a visitor who wrote their own row
   *  could rewrite the record of their own visit. */
  readonly logWriterKey: string;
  /** `unknown` for a caller the LAN cannot place, never an address they sent. */
  readonly sourceIp: string;
};

const UNREACHABLE: HandlerResponse = { status: 404, body: { error: 'host_unreachable' } };
const REFUSED: HandlerResponse = { status: 404, body: { error: 'connection_refused' } };
const NOT_FOUND: HandlerResponse = { status: 404, body: { error: 'not_found' } };

// Loose so the envelope fields pass through; the refine keeps the codebase-wide posture
// that a client never claims identity (the caller is the verified pubkey). Any other
// field a client sends is simply not read — a source address included, since the
// server derives it.
const resolveOccupantFetchSchema = z
  .looseObject({
    action: z.literal('resolveOccupantFetch'),
    essid: z.string().min(1),
    target: z.string().min(1),
    port: z.number().int(),
    /** The URL path as written by the client, NOT a filesystem path. */
    path: z.string().min(1),
    /** The box the fetch ran from. Absent means the caller's own workstation. */
    caller_machine_id: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload));

/**
 * Find the web server at `request.target` on the network the caller stands on — the whole
 * reach in one place, so a page read and a path sweep can never disagree about which box
 * answered or whether it answered at all.
 */
export const resolveOccupantWebTarget = async (
  deps: OccupantWebTargetDeps,
  caller: { readonly publicKey: string; readonly machineId: string | undefined },
  request: { readonly essid: string; readonly target: string; readonly port: number },
): Promise<OccupantWebTarget | HandlerResponse> => {
  // LAN boundary first, so no page and no hint of who is here reaches a caller who is
  // not standing on this network — placed by the server, never by the ESSID they sent.
  const vantage = await resolveCallerVantageOn(
    deps,
    caller.publicKey,
    caller.machineId,
    request.essid,
  );
  if (!vantage.ok) return { status: vantage.status, body: { error: vantage.error } };

  const occupants = await deps.listOccupantsByEssid(request.essid);
  if (occupants.error) {
    return { status: 500, body: { error: 'occupants_lookup_failed' } };
  }
  const leases = await deps.listLeasesByEssid(request.essid);
  if (leases.error) {
    return { status: 500, body: { error: 'leases_lookup_failed' } };
  }
  const addresses = lanAddressesByOwner(request.essid, leases.data ?? []);
  // Loopback names the box the caller's shell stands ON, found by the machine it is: a
  // visitor there holds no address to name it by. Any other target is a lease.
  const loopback = request.target === LOOPBACK_IPV4;
  const occupant = (occupants.data ?? []).find((row) =>
    loopback
      ? row.workstation_machine_id === caller.machineId
      : addresses.get(row.owner_key) === request.target,
  );
  if (occupant === undefined) return UNREACHABLE;

  const patches = await deps.findPatches({ machine_id: occupant.workstation_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const occupantFs = bootableOccupantFs(occupant, patches.data);
  if (occupantFs === null) return UNREACHABLE;

  // What the box answers to the NETWORK, so a web tool refuses exactly the port a scan
  // showed shut. A shell on the box itself reaches its own address past its own filter.
  const standsOnIt = caller.machineId === occupant.workstation_machine_id;
  const ports = standsOnIt ? readOpenPorts(occupantFs) : portsOpenToNetwork(occupantFs);
  const reachable = ports.some((entry) => entry.port === request.port);
  const server = reachable ? webProgramOn(occupantFs, request.port) : undefined;
  if (server === undefined) return REFUSED;

  return {
    fs: occupantFs,
    server,
    machineId: occupant.workstation_machine_id,
    logWriterKey: occupant.owner_key,
    // A loopback request never left the box, so it is recorded as a local visit.
    sourceIp: loopback ? LOOPBACK_IPV4 : (vantage.sourceIp ?? 'unknown'),
  };
};

export const handleResolveOccupantFetch = async (
  body: unknown,
  deps: ResolveOccupantFetchDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveOccupantFetchSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const target = await resolveOccupantWebTarget(
    deps,
    { publicKey, machineId: payload.caller_machine_id },
    payload,
  );
  if ('status' in target) return target;

  // Read as the SERVER, not as the caller: a page published under the document root is
  // written by root and readable by root alone, and the requester has no account here.
  const filePath = resolveWebPath(payload.path);
  const page =
    filePath === null ? null : createFsView(target.fs, { userType: 'root' }).read(filePath);
  const content = page === null || !page.ok ? null : page.content;

  const line = formatAccessLogLine({
    time: asGameTime(deps.now()),
    sourceIp: target.sourceIp,
    // The path AS ASKED FOR, never as resolved: a request that resolved to nothing is
    // exactly the line a defender needs to see.
    path: payload.path,
    status: content === null ? 404 : 200,
    size: content === null ? 0 : content.length,
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

  return content === null
    ? NOT_FOUND
    : { status: 200, body: { ok: true, content, server: target.server } };
};
