/**
 * handleResolveOccupantFetch — the server-side gate for a web fetch of any box on the
 * network the caller stands on but the player's own: a FELLOW OCCUPANT's, at the
 * address it holds, or one the network generates.
 *
 * The player's own box at home is the one box the client reads for itself. A fellow
 * occupant's workstation is built from THEIR identity and THEIR journal, which live
 * here, so a fetch of one is the same round trip a scan of one already is
 * (`handleResolveOccupantScan`). A box the network generates is served from its journal
 * too, because somebody may have rewritten its pages, stopped its web server or bricked
 * it, and a reader on its own network must see what a reader across the internet sees.
 * That covers a host on the LAN, a host on a deep layer the caller's shell reaches, and
 * the box a shell stands on, over loopback.
 *
 * The web is the door with no credential, so reaching the port is the whole gate, and
 * the gate is the one the scan draws: the caller must stand on the network (at home on
 * it, or in a shell on a box that is), the box must be there (a lease whose holder is on
 * the WiFi now, or a box the network generates), the box must boot, and the port must
 * be one it answers to the NETWORK with a web server behind it. A port the box's filter
 * closes refuses, exactly as the scan shows it shut, and so does one the switch in front
 * of a deep layer denies. The one caller no filter stops is a shell on the box itself:
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
 * The box that answered records the visit: one line in its OWNER's log (the network's,
 * for a box nobody owns), from the address the server places the caller at. A 404 is
 * recorded as readily as a 200; only a fetch that reached no web server leaves nothing,
 * there being no server to write it.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { lanAddressesByOwner, type LanLeaseRow } from './lanAddress.js';
import { bootableOccupantFs } from './natHosts.js';
import { portsOpenToNetwork } from './portsOpenToNetwork.js';
import { webProgramOn } from './webServing.js';
import { METHOD_NOT_ALLOWED_PAGE, resolveWebPath } from './http.js';
import { LOOPBACK_IPV4 } from './interfaces.js';
import { readOpenPorts, type OpenPort } from '../services/pidfile.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import {
  chainGatewayBaseFs,
  networkBaseFsForMachineId,
  resolveLanHostIdentity,
} from '../generation/lanHostIdentity.js';
import { segmentsReachedFrom, type ChainLink } from '../generation/lanTopology.js';
import { deniedPortsFor, resolveDeepScanHosts } from '../scan/deepScanHosts.js';
import { materializeMachineFs } from './materializeMachineFs.js';
import { canBoot } from '../boot/bootFiles.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import { createFsView } from '../filesystem/fsView.js';
import {
  ACCESS_LOG_OWNER,
  ACCESS_LOG_PATH,
  ACCESS_LOG_PERMISSIONS,
  formatAccessLogLine,
} from '../logging/accessLog.js';
import { appendMachineLog, type AppendLog } from '../patches/appendMachineLog.js';
import { asGameTime } from '../types.js';
import { resolveCallerVantageOn, type CallerVantageDeps } from '../sessions/callerVantage.js';
import type { HttpFetchOccupant } from './resolveHttpFetch.js';
import type { Directory } from '../filesystem/types.js';
import type { OwnerPatchRow } from './materializeWorkstationFs.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

/** What it takes to find a web server on the network from where the caller stands.
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
   *  boots, what it runs, what it filters and the pages themselves. Also the journal of
   *  a switch in front of a deep layer, whose live ACL decides what the layer answers. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
};

export type ResolveOccupantFetchDeps = OccupantWebTargetDeps & {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the access.log line. */
  readonly now: () => number;
  readonly appendLog: AppendLog;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

/** The web server a request reached, with the log identity its visit is written under
 *  and the address the server places the caller at. */
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
    /** A form, which makes the request a POST. No box on a LAN takes one, so it is never
     *  read, only refused. */
    body: z.string().max(4096).optional(),
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
  // A loopback request never left the box, so it is recorded as a local visit.
  const sourceIp = loopback ? LOOPBACK_IPV4 : (vantage.sourceIp ?? 'unknown');

  const box =
    occupant === undefined
      ? await generatedBox(deps, caller.machineId, request, loopback, sourceIp)
      : await occupantBox(deps, occupant, sourceIp);
  if ('status' in box) return box;

  // What the box answers to the NETWORK, so a web tool refuses exactly the port a scan
  // showed shut. A shell on the box itself reaches its own address past its own filter.
  const standsOnIt = caller.machineId === box.machineId;
  const ports = standsOnIt ? readOpenPorts(box.fs) : box.networkPorts;
  const reachable = ports.some((entry) => entry.port === request.port);
  const server = reachable ? webProgramOn(box.fs, request.port) : undefined;
  if (server === undefined) return REFUSED;

  return {
    fs: box.fs,
    server,
    machineId: box.machineId,
    logWriterKey: box.logWriterKey,
    sourceIp: box.sourceIp,
  };
};

/** A box a request reached, up and with its journal replayed, before anybody has asked
 *  whether it serves the web on the port named. */
type ReachedBox = Omit<OccupantWebTarget, 'server'> & {
  /** What the box answers to a caller who is not standing on it: its own filter applied,
   *  and on a deep layer the ACL of the switch in front of it as well. */
  readonly networkPorts: readonly OpenPort[];
};

const PATCHES_FAILED: HandlerResponse = { status: 500, body: { error: 'patches_lookup_failed' } };

/** A fellow occupant's workstation, rebuilt from their identity and their journal. */
const occupantBox = async (
  deps: OccupantWebTargetDeps,
  occupant: HttpFetchOccupant,
  sourceIp: string,
): Promise<ReachedBox | HandlerResponse> => {
  const patches = await deps.findPatches({ machine_id: occupant.workstation_machine_id });
  if (patches.error) return PATCHES_FAILED;
  const fs = bootableOccupantFs(occupant, patches.data);
  if (fs === null) return UNREACHABLE;
  return {
    fs,
    networkPorts: portsOpenToNetwork(fs),
    machineId: occupant.workstation_machine_id,
    logWriterKey: occupant.owner_key,
    sourceIp,
  };
};

/** A generated box with its journal replayed, or unreachable when it cannot boot. Nobody
 *  owns it and every visitor reaches the identical box, so its log accretes under the
 *  network's own key rather than a row per visitor. */
const replayedGeneratedBox = async (
  deps: OccupantWebTargetDeps,
  box: {
    readonly essid: string;
    readonly machineId: string;
    readonly baseFs: Directory;
    readonly deniedByFront: ReadonlySet<number>;
    readonly sourceIp: string;
  },
): Promise<ReachedBox | HandlerResponse> => {
  const patches = await deps.findPatches({ machine_id: box.machineId });
  if (patches.error) return PATCHES_FAILED;
  const fs = materializeMachineFs(box.baseFs, patches.data);
  if (!canBoot(fs).ok) return UNREACHABLE;
  return {
    fs,
    networkPorts: portsOpenToNetwork(fs).filter((open) => !box.deniedByFront.has(open.port)),
    machineId: box.machineId,
    logWriterKey: apGatewayLogWriterKey(box.essid),
    sourceIp: box.sourceIp,
  };
};

const NOTHING_IN_FRONT: ReadonlySet<number> = new Set();

/** The gateway in front of a deep layer as it stands: a switch's live ACL is in its
 *  journal, while a router filters nothing, so only a switch's journal is read. */
const frontingGatewayFs = async (
  deps: OccupantWebTargetDeps,
  essid: string,
  fronting: ChainLink,
): Promise<Directory | HandlerResponse> => {
  const baseFs = chainGatewayBaseFs(essid, fronting);
  if (fronting.host.kind !== 'switch') return baseFs;
  const patches = await deps.findPatches({ machine_id: fronting.machineId });
  return patches.error ? PATCHES_FAILED : materializeMachineFs(baseFs, patches.data);
};

/**
 * The box the network itself generates at the address, when no player holds it: the box a
 * shell stands on, over loopback; a host on a deep layer the shell reaches; or a host on
 * the LAN. Served from its journal like a player's box, because somebody may have
 * rewritten its pages, stopped its web server or bricked it, and a reader on its own
 * network must see what a reader across the internet sees.
 */
const generatedBox = async (
  deps: OccupantWebTargetDeps,
  callerMachineId: string | undefined,
  request: { readonly essid: string; readonly target: string },
  loopback: boolean,
  sourceIp: string,
): Promise<ReachedBox | HandlerResponse> => {
  const { essid } = request;
  if (loopback) {
    // Found by what it is rather than by an address: the access point's own gateway
    // stands on no LAN walk, and a deep box is seen on the LAN as the gateway in front.
    if (callerMachineId === undefined) return UNREACHABLE;
    const baseFs = networkBaseFsForMachineId(essid, callerMachineId);
    return baseFs === null
      ? UNREACHABLE
      : replayedGeneratedBox(deps, {
          essid,
          machineId: callerMachineId,
          baseFs,
          deniedByFront: NOTHING_IN_FRONT,
          sourceIp,
        });
  }

  // A deep address is never a LAN one, so the layers come first and need no tiebreak. A
  // deep box only ever sees the gateway in front of it, whoever is behind that.
  for (const segment of callerMachineId === undefined
    ? []
    : (segmentsReachedFrom(essid, callerMachineId) ?? [])) {
    const { fronting } = segment;
    if (fronting === null) continue;
    const frontingFs = await frontingGatewayFs(deps, essid, fronting);
    if ('status' in frontingFs) return frontingFs;
    const onLayer = resolveDeepScanHosts(essid, fronting, frontingFs).hosts.find(
      (entry) => entry.host.ip === request.target,
    );
    if (onLayer !== undefined) {
      return replayedGeneratedBox(deps, {
        essid,
        machineId: onLayer.machineId,
        baseFs: onLayer.baseFs,
        deniedByFront: deniedPortsFor(fronting, frontingFs),
        sourceIp: segment.address ?? 'unknown',
      });
    }
  }

  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === request.target);
  if (host === undefined) return UNREACHABLE;
  const { machineId, baseFs } = resolveLanHostIdentity(host, essid);
  return replayedGeneratedBox(deps, {
    essid,
    machineId,
    baseFs,
    deniedByFront: NOTHING_IN_FRONT,
    sourceIp,
  });
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

  // A POST is refused before any file is looked at: the box takes no form, and answers
  // every path with the same 405 page.
  const posted = payload.body !== undefined;

  // Read as the SERVER, not as the caller: a page published under the document root is
  // written by root and readable by root alone, and the requester has no account here.
  const filePath = posted ? null : resolveWebPath(payload.path);
  const page =
    filePath === null ? null : createFsView(target.fs, { userType: 'root' }).read(filePath);
  const content = page === null || !page.ok ? null : page.content;

  const line = formatAccessLogLine({
    time: asGameTime(deps.now()),
    method: posted ? 'POST' : 'GET',
    sourceIp: target.sourceIp,
    // The path AS ASKED FOR, never as resolved: a request that resolved to nothing is
    // exactly the line a defender needs to see.
    path: payload.path,
    ...(posted
      ? { status: 405, size: METHOD_NOT_ALLOWED_PAGE.length }
      : { status: content === null ? 404 : 200, size: content === null ? 0 : content.length }),
  });
  try {
    await appendMachineLog(
      { appendLog: deps.appendLog },
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

  if (posted) return { status: 405, body: { error: 'method_not_allowed', server: target.server } };
  return content === null
    ? NOT_FOUND
    : { status: 200, body: { ok: true, content, server: target.server } };
};
