/**
 * handleNmapScan — the server-side scan action (scan-logging Slice 3a). It is the
 * handler nmap gains a round-trip to: it verifies the signed envelope, places the
 * caller on the network they stand on (`resolveCallerVantage`: at home, or in a shell
 * on the box they name) and refuses any other, REGENERATES that LAN from the essid
 * (v2's pure generation, no stored projection), resolves the scanned hosts, and —
 * server-internal — appends
 * ONE aggregate `/var/log/kern.log` line to EACH of them via the shared
 * `appendMachineLog` primitive (the same seam ssh's auth.log uses).
 *
 * A target on a deep layer the caller's box reaches (`segmentsReachedFrom`) is swept
 * there instead, each line naming the address the box is seen at on that layer; a target
 * on no network the caller reaches is refused like another network.
 *
 * Per-host, never per probe: a real scan touches every reachable host and each
 * firewall records the probe independently. The line lists that host's own open
 * ports (from its `/var/run/*.pid` files); a service-less host still records a
 * 0-hit probe. The player's OWN workstation is skipped — it is keyed by its
 * workstation_id, not `hostMachineId`, so the generic remote-log path can't
 * address it (self-scan logging is a separate concern).
 *
 * Per-viewer for now: the line lands on `(caller_player_key, machine_id)`, so the
 * SAME identity reads its own trace after breaking in (parity with the shipped
 * ssh auth.log). Slice 3b re-keys the row to a shared machine record so a
 * DIFFERENT identity can read it — the write call here is unchanged by that swap.
 *
 * Best-effort logging: a per-host write failure never fails the scan; the action
 * always reports how many hosts it recorded.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan.js';
import { chainGatewayBaseFs, resolveLanHostIdentity } from '../generation/lanHostIdentity.js';
import { segmentsReachedFrom, type ChainLink } from '../generation/lanTopology.js';
import { materializeMachineFs } from '../network/materializeMachineFs.js';
import { resolveDeepScanHosts, type DeepScanHost } from './deepScanHosts.js';
import { lanAddressesByOwner, type LanLeaseRow } from '../network/lanAddress.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import {
  parseScanTarget,
  hostsInScanTarget,
  octetInScanTarget,
  type ScanTarget,
} from '../network/scanTarget.js';
import {
  materializeWorkstationFs,
  type OwnerPatchRow,
} from '../network/materializeWorkstationFs.js';
import { canBoot } from '../boot/bootFiles.js';
import { readOpenPorts } from '../services/pidfile.js';
import {
  formatNmapScanAggregate,
  KERN_LOG_OWNER,
  KERN_LOG_PATH,
  KERN_LOG_PERMISSIONS,
} from '../logging/kernLog.js';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog.js';
import { asGameTime } from '../types.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { resolveCallerVantageOn, type CallerVantageDeps } from '../sessions/callerVantage.js';

/** The occupancy fields a same-LAN scan trace needs: whose row it is (the LAN-boundary
 *  gate + self-exclusion + LAN-IP match), the workstation the trace lands on + its
 *  hostname for the line, and the identity fields that rebuild the box to read its real
 *  open ports. A structural superset of `OccupantWorkstation`, so it feeds
 *  `materializeWorkstationFs` directly. */
export type ScanOccupant = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly workstation_machine_name: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

export type NmapScanDeps = CallerVantageDeps & {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the kern.log line. */
  readonly now: () => number;
  /** Read the current content of a log file on this machine's shared journal,
   *  keyed `(machine_id, path, writer_key)`. */
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the appended kern.log line on the scanned host). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** Every occupant of the ESSID (auth fields included — server-internal): the trace
   *  reads it for each fellow occupant whose LAN IP the scan touches. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly ScanOccupant[] | null; readonly error: unknown }>;
  /** Every lease held on this ESSID, in ONE read: which fellow occupants the scanned
   *  range actually covers, and the source address their traces carry. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
  /** A scanned occupant's FULL workstation journal (scoped to machine_id, server order)
   *  replayed over its seeded base — drives the boot gate + the real-port read. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through; the
// refine rejects a client-supplied player_key (the server stamps it from the
// verified pubkey). The client never names a log path or content.
const nmapScanSchema = z
  .looseObject({
    action: z.literal('nmapScan'),
    essid: z.string().min(1),
    target: z.string().min(1),
    caller_machine_id: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload));

type ScanContext = {
  readonly essid: string;
  readonly sourceIp: string;
  readonly time: number;
  /** Whose row every own-LAN trace in this sweep lands in: the ESSID's stable key, since
   *  these boxes are the generator's and the access point's rather than any player's. */
  readonly writerKey: string;
};

/** Stamp one host's kern.log with the aggregate scan line via the shared system-
 *  log primitive. Best-effort: a write failure must never break the sweep. */
const logHostScan = async (
  deps: NmapScanDeps,
  context: ScanContext,
  host: LanHost,
): Promise<void> => {
  // The shared resolver maps the host to the SAME machine id + base FS that ssh/auth
  // use, so the scan trace lands where `ssh root@<host>` resolves: the edge router
  // and an inner gateway log on their real router record + real ports (their
  // `hostMachineId` is a dead-end nobody reads, and the generic FS would log "ports
  // none" for a box visibly running ssh); a generic NPC sibling keeps its coordinate
  // path. The writer is the ESSID's, resolved once for the whole sweep: nobody owns a
  // generated box, and every occupant of this WiFi scans the identical one.
  const { machineId, baseFs: hostFs } = resolveLanHostIdentity(host, context.essid);
  const ports = readOpenPorts(hostFs);
  const line = formatNmapScanAggregate({
    time: asGameTime(context.time),
    hostname: host.hostname,
    sourceIp: context.sourceIp,
    probedPorts: ports.map((port) => port.port),
  });
  try {
    await appendMachineLog(
      { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: context.writerKey,
        machineId,
        path: KERN_LOG_PATH,
        owner: KERN_LOG_OWNER,
        permissions: KERN_LOG_PERMISSIONS,
      },
      line,
    );
  } catch {
    // best-effort: the scan stands regardless of a logging failure.
  }
};

/** Stamp a same-LAN scan onto one fellow occupant's REAL workstation kern.log. The
 *  keystone: `writerKey` is the TARGET OWNER's key — the system owns its
 *  logs, so scanners accrete into ONE row; the scanner's identity lives in the line's
 *  source IP. The probed ports are the occupant's REAL open ports, materialized from
 *  their own journal (never fabricated from the scanner's seed). A bricked/dark box, a
 *  journal read failure, or a best-effort write failure leaves no line. */
const traceOneOccupant = async (
  deps: NmapScanDeps,
  occupant: ScanOccupant,
  sourceIp: string,
  time: number,
): Promise<void> => {
  const patches = await deps.findPatches({ machine_id: occupant.workstation_machine_id });
  if (patches.error) return;
  const fs = materializeWorkstationFs(occupant, patches.data);
  // A bricked (dark) box doesn't answer scans — leave no trace, like the public path.
  if (!canBoot(fs).ok) return;
  const line = formatNmapScanAggregate({
    time: asGameTime(time),
    hostname: occupant.workstation_machine_name,
    sourceIp,
    probedPorts: readOpenPorts(fs).map((openPort) => openPort.port),
  });
  try {
    await appendMachineLog(
      { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: occupant.owner_key,
        machineId: occupant.workstation_machine_id,
        path: KERN_LOG_PATH,
        owner: KERN_LOG_OWNER,
        permissions: KERN_LOG_PERMISSIONS,
      },
      line,
    );
  } catch {
    // best-effort: the scan stands regardless of a logging failure.
  }
};

/** Trace every REAL fellow occupant the scan touches. Where `logHostScan` records the
 *  caller's OWN regenerated NPC siblings, this reads the ESSID occupancy and writes on
 *  the actual boxes of other players: self excluded (own box is the own-LAN path), and
 *  only for occupants whose LAN IP the scan target covers. The caller has already been
 *  placed on this LAN. A scanner with no address there leaves no trace rather than one
 *  from an invented source. Best-effort: an occupancy read failure simply skips the
 *  cross-player traces. */
const traceOccupants = async (
  deps: NmapScanDeps,
  args: {
    readonly scannerKey: string;
    readonly essid: string;
    readonly target: ScanTarget | null;
    readonly sourceIp: string | null;
    readonly time: number;
  },
): Promise<void> => {
  if (args.target === null || args.sourceIp === null) return;
  const occupants = await deps.listOccupantsByEssid(args.essid);
  if (occupants.error) return;
  const rows = occupants.data ?? [];

  // The addresses the range is matched against come from the leases. Best-effort like
  // the occupancy read above: a lease failure simply leaves no cross-player traces
  // rather than matching a guessed address.
  const leases = await deps.listLeasesByEssid(args.essid);
  if (leases.error) return;
  const addresses = lanAddressesByOwner(args.essid, leases.data ?? []);

  for (const occupant of rows) {
    if (occupant.owner_key === args.scannerKey) continue;
    // No lease is no address on this LAN: there is nothing for the range to cover.
    const lanIp = addresses.get(occupant.owner_key);
    if (lanIp === undefined) continue;
    if (!octetInScanTarget(Number(lanIp.split('.')[3]), args.target)) continue;
    await traceOneOccupant(deps, occupant, args.sourceIp, args.time);
  }
};

/** Stamp one touched deep host's kern.log with the aggregate scan line. Best-effort, like
 *  the LAN sweep: a write failure never breaks the scan. */
const logDeepHostScan = async (
  deps: NmapScanDeps,
  context: ScanContext,
  entry: DeepScanHost,
): Promise<void> => {
  const line = formatNmapScanAggregate({
    time: asGameTime(context.time),
    hostname: entry.host.hostname,
    sourceIp: context.sourceIp,
    probedPorts: entry.ports.map((port) => port.port),
  });
  try {
    await appendMachineLog(
      { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: context.writerKey,
        machineId: entry.machineId,
        path: KERN_LOG_PATH,
        owner: KERN_LOG_OWNER,
        permissions: KERN_LOG_PERMISSIONS,
      },
      line,
    );
  } catch {
    // best-effort: the scan stands regardless of a logging failure.
  }
};

/** Sweep a deep layer the caller reaches, logging each host the target covers under the
 *  address the caller is seen at on that layer. A switch fronting the layer drops the
 *  ports its live `acl.conf` denies, read off its journal; a router filters nothing, so
 *  its journal is never read. */
const traceLayer = async (
  deps: NmapScanDeps,
  args: {
    readonly essid: string;
    readonly target: ScanTarget;
    /** The gateway fronting the layer swept. */
    readonly fronting: ChainLink;
    /** The address the caller is seen at on that layer. */
    readonly address: string | null;
  },
): Promise<HandlerResponse> => {
  const { fronting } = args;
  let frontingFs = chainGatewayBaseFs(args.essid, fronting);
  if (fronting.host.kind === 'switch') {
    const patches = await deps.findPatches({ machine_id: fronting.machineId });
    if (patches.error) return { status: 500, body: { error: 'patches_lookup_failed' } };
    frontingFs = materializeMachineFs(frontingFs, patches.data);
  }
  const resolution = resolveDeepScanHosts(args.essid, fronting, frontingFs);
  const touched = resolution.hosts.filter((entry) =>
    octetInScanTarget(Number(entry.host.ip.split('.')[3]), args.target),
  );
  const context: ScanContext = {
    essid: args.essid,
    sourceIp: args.address ?? 'unknown',
    time: deps.now(),
    writerKey: apGatewayLogWriterKey(args.essid),
  };
  for (const entry of touched) {
    await logDeepHostScan(deps, context, entry);
  }
  return { status: 200, body: { ok: true, hostsLogged: touched.length } };
};

export const handleNmapScan = async (
  body: unknown,
  deps: NmapScanDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, nmapScanSchema, { nonceStore: deps.nonceStore });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // LAN boundary: a scan sweeps only the network the caller stands on — at home on it,
  // or in a shell on a box that is — and is logged from where the server places them
  // there, never from an address or a network the client claims.
  const vantage = await resolveCallerVantageOn(
    deps,
    publicKey,
    payload.caller_machine_id,
    payload.essid,
  );
  if (!vantage.ok) return { status: vantage.status, body: { error: vantage.error } };

  // A target on a deep layer the box reaches is swept there. Only a box the network
  // generates stands on or above a layer; a player's own workstation reaches the LAN
  // alone.
  const reached =
    payload.caller_machine_id === undefined
      ? null
      : segmentsReachedFrom(payload.essid, payload.caller_machine_id);
  for (const segment of reached ?? []) {
    const { fronting } = segment;
    const onLayer = parseScanTarget(payload.target, segment.subnet);
    if (fronting !== null && onLayer.ok) {
      return traceLayer(deps, {
        essid: payload.essid,
        target: onLayer.target,
        fronting,
        address: segment.address,
      });
    }
  }

  // Otherwise the target is on the LAN, or on no network the caller reaches at all —
  // which is the same refusal as naming another network. A malformed target selects
  // nothing (the command rejects these before calling). The caller's own workstation
  // needs no exclusion here: the generator places NPC filler only — the player is
  // added client-side at its leased address — so it was never in this list.
  const lan = generateHomeLan(payload.essid);
  const parsed = parseScanTarget(payload.target, lan.subnet);
  if (!parsed.ok && parsed.reason === 'foreign') {
    return { status: 403, body: { error: 'wrong_network' } };
  }
  const hosts = parsed.ok ? hostsInScanTarget(lan, parsed.target) : [];

  const context: ScanContext = {
    essid: payload.essid,
    sourceIp: vantage.sourceIp ?? 'unknown',
    time: deps.now(),
    writerKey: apGatewayLogWriterKey(payload.essid),
  };
  for (const host of hosts) {
    await logHostScan(deps, context, host);
  }

  // A same-LAN scan also leaves a trace on REAL fellow occupants the target covers —
  // owner-keyed on their box, from the same address the sweep above names. Additive to the
  // own-LAN sweep above; `hostsLogged` reports the caller's own-LAN count (the
  // cross-player traces are a server-side side effect the client ignores).
  await traceOccupants(deps, {
    scannerKey: publicKey,
    essid: payload.essid,
    target: parsed.ok ? parsed.target : null,
    sourceIp: vantage.sourceIp,
    time: context.time,
  });

  return { status: 200, body: { ok: true, hostsLogged: hosts.length } };
};
