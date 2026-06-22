/**
 * handleNmapScan — the server-side scan action (scan-logging Slice 3a). It is the
 * handler nmap gains a round-trip to: it verifies the signed envelope, REGENERATES
 * the caller's own LAN from the verified pubkey + essid (v2's pure generation, no
 * stored projection), resolves the scanned hosts, and — server-internal — appends
 * ONE aggregate `/var/log/kern.log` line to EACH of them via the shared
 * `appendMachineLog` primitive (the same seam ssh's auth.log uses).
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
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { assignHomeNetwork } from '../network/homeNetwork';
import {
  parseScanTarget,
  hostsInScanTarget,
  octetInScanTarget,
  type ScanTarget,
} from '../network/scanTarget';
import {
  materializeWorkstationFs,
  type OwnerPatchRow,
} from '../network/materializeWorkstationFs';
import { canBoot } from '../boot/bootFiles';
import { readOpenPorts } from '../services/pidfile';
import {
  formatNmapScanAggregate,
  KERN_LOG_OWNER,
  KERN_LOG_PATH,
  KERN_LOG_PERMISSIONS,
} from '../logging/kernLog';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog';
import { asGameTime } from '../types';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/** The occupancy fields a same-LAN scan trace needs: whose row it is (the LAN-boundary
 *  gate + self-exclusion + LAN-IP match), the workstation the trace lands on + its
 *  hostname for the line, and the identity fields that rebuild the box to read its real
 *  open ports. A structural superset of `RegistryWorkstation`, so it feeds
 *  `materializeWorkstationFs` directly. */
export type ScanOccupant = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly workstation_machine_name: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

export type NmapScanDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the kern.log line. */
  readonly now: () => number;
  /** Read the current content of a log file on this machine's shared journal,
   *  keyed `(machine_id, path, writer_key)`. */
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the appended kern.log line on the scanned host). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** Every occupant of the ESSID (auth fields included — server-internal): the
   *  LAN-boundary gate reads it for the caller, and the trace for each fellow occupant
   *  whose LAN IP the scan touches. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly ScanOccupant[] | null; readonly error: unknown }>;
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
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

type ScanContext = {
  readonly publicKey: string;
  readonly essid: string;
  readonly sourceIp: string;
  readonly time: number;
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
  // path. The writer stays the caller, who is the owner on this own-LAN path.
  const { machineId, baseFs: hostFs } = resolveLanHostIdentity(host, context.publicKey, context.essid);
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
        writerKey: context.publicKey,
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
 *  keystone (decision 1): `writerKey` is the TARGET OWNER's key — the system owns its
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
 *  the actual boxes of other players: gated on the caller being a live occupant (the LAN
 *  boundary — you must be on the LAN to scan it), self excluded (own box is the own-LAN
 *  path), and only for occupants whose LAN IP the scan target covers. Best-effort: an
 *  occupancy read failure simply skips the cross-player traces. */
const traceOccupants = async (
  deps: NmapScanDeps,
  args: {
    readonly scannerKey: string;
    readonly essid: string;
    readonly target: ScanTarget | null;
    readonly sourceIp: string;
    readonly time: number;
  },
): Promise<void> => {
  if (args.target === null) return;
  const occupants = await deps.listOccupantsByEssid(args.essid);
  if (occupants.error) return;
  const rows = occupants.data ?? [];
  // LAN boundary: only a live occupant of the ESSID may trace fellow occupants.
  if (!rows.some((row) => row.owner_key === args.scannerKey)) return;

  for (const occupant of rows) {
    if (occupant.owner_key === args.scannerKey) continue;
    const lanIp = assignHomeNetwork(occupant.owner_key, args.essid).localIp;
    if (!octetInScanTarget(Number(lanIp.split('.')[3]), args.target)) continue;
    await traceOneOccupant(deps, occupant, args.sourceIp, args.time);
  }
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

  // Resolve the scanned hosts on the caller's OWN regenerated LAN. An invalid or
  // foreign target selects nothing (the command rejects these before calling; a
  // forged one simply finds no real hosts to record). The own workstation is
  // excluded — it is keyed by its workstation_id, not hostMachineId.
  const lan = generateHomeLan(publicKey, payload.essid);
  const selfIp = assignHomeNetwork(publicKey, payload.essid).localIp;
  const parsed = parseScanTarget(payload.target, lan.subnet);
  const hosts = (parsed.ok ? hostsInScanTarget(lan, parsed.target) : []).filter(
    (host) => host.ip !== selfIp,
  );

  const context: ScanContext = {
    publicKey,
    essid: payload.essid,
    sourceIp: payload.source_ip ?? 'unknown',
    time: deps.now(),
  };
  for (const host of hosts) {
    await logHostScan(deps, context, host);
  }

  // A same-LAN scan also leaves a trace on REAL fellow occupants the target covers —
  // owner-keyed on their box, with the scanner's own LAN IP (`selfIp`) as the source.
  // Additive to the own-LAN sweep above; `hostsLogged` reports the caller's own-LAN
  // count (the cross-player traces are a server-side side effect the client ignores).
  await traceOccupants(deps, {
    scannerKey: publicKey,
    essid: payload.essid,
    target: parsed.ok ? parsed.target : null,
    sourceIp: selfIp,
    time: context.time,
  });

  return { status: 200, body: { ok: true, hostsLogged: hosts.length } };
};
