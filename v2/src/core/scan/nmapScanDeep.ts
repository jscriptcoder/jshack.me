/**
 * handleNmapScanDeep — the deep-layer counterpart of `handleNmapScan`. A pivot scan
 * from a gateway the active shell stands on fires this fire-and-forget server side-
 * effect: it verifies the signed envelope, RE-DERIVES the vantage from the verified
 * pubkey + the claimed `vantage_machine_id` (a machine_id that is not a real gateway
 * in the caller's own chain logs nothing — the vantage can't be forged), regenerates
 * the deep `/24` behind it through the shared `resolveDeepScanHosts`, and appends ONE
 * aggregate `/var/log/kern.log` line to EACH touched deep host (the terminal NPC,
 * plus the child gateway when the layer hangs one and the scan target covers it).
 *
 * The line lists that host's open ports — POST-ACL when the vantage is a switch,
 * whose `/etc/switch/acl.conf` is read off its materialized journal — sourced from
 * the fronting gateway's downstream `.1`. The writer is the CALLER's own key: deep
 * boxes are private per-viewer NPCs, so the trace accretes under the player who reads
 * it back once they breach the box (parity with the deep-reach auth.log).
 *
 * Best-effort logging: a per-host write failure never fails the scan; the action
 * reports how many hosts the scan target touched.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { chainGatewayVantageForMachineId } from '../generation/lanHostIdentity';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { parseScanTarget, octetInScanTarget } from '../network/scanTarget';
import { resolveDeepScanHosts, type DeepScanHost } from './deepScanHosts';
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
import type { HandlerResponse } from './nmapScan';

export type NmapScanDeepDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the kern.log line. */
  readonly now: () => number;
  /** Read the current content of a host's kern.log on the shared journal, keyed
   *  `(machine_id, path, writer_key)`. */
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the appended kern.log line on a touched deep host). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** The vantage gateway's FULL patch journal (scoped to its `machine_id`, server
   *  order), replayed over its seeded base so a switch vantage's live `acl.conf`
   *  edits filter the trace the same way they filter the on-screen scan. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
};

const OK_NOTHING: HandlerResponse = { status: 200, body: { ok: true, hostsLogged: 0 } };

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity (the caller is the verified pubkey).
const nmapScanDeepSchema = z
  .looseObject({
    action: z.literal('nmapScanDeep'),
    essid: z.string().min(1),
    target: z.string().min(1),
    vantage_machine_id: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

/** Stamp one touched deep host's kern.log with the aggregate scan line via the shared
 *  system-log primitive. Best-effort: a write failure must never break the sweep. */
const logDeepHostScan = async (
  deps: NmapScanDeepDeps,
  args: {
    readonly entry: DeepScanHost;
    readonly sourceIp: string;
    readonly writerKey: string;
    readonly time: number;
  },
): Promise<void> => {
  const line = formatNmapScanAggregate({
    time: asGameTime(args.time),
    hostname: args.entry.host.hostname,
    sourceIp: args.sourceIp,
    probedPorts: args.entry.ports.map((port) => port.port),
  });
  try {
    await appendMachineLog(
      { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: args.writerKey,
        machineId: args.entry.machineId,
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

export const handleNmapScanDeep = async (
  body: unknown,
  deps: NmapScanDeepDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, nmapScanDeepSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // The claimed vantage must be a genuine gateway in the NETWORK's deep chain — a forged
  // or non-gateway machine_id resolves to nothing, so there is nothing to log. One walk
  // yields both the vantage and its seeded base FS (the switch ACL surface).
  const vantage = chainGatewayVantageForMachineId(payload.essid, payload.vantage_machine_id);
  if (vantage === null) {
    return OK_NOTHING;
  }

  // A switch vantage filters its downstream by its live `/etc/switch/acl.conf`, so its
  // journal must be replayed to read the player's edits; a router forwards rather than
  // filters, so its seeded base FS is enough and no journal read is needed.
  let vantageFs = vantage.baseFs;
  if (vantage.kind === 'switch') {
    const patches = await deps.findPatches({ machine_id: vantage.machineId });
    if (patches.error) {
      return { status: 500, body: { error: 'patches_lookup_failed' } };
    }
    vantageFs = materializeMachineFs(vantage.baseFs, patches.data);
  }

  const resolution = resolveDeepScanHosts(payload.essid, vantage, vantageFs);
  const parsed = parseScanTarget(payload.target, resolution.subnet);
  // The touched hosts ARE the resolved deep hosts whose octet the scan target covers —
  // filtered straight off the resolution, so the trace carries the same machine_id +
  // ports the resolver computed (no re-lookup that could miss).
  const touched = parsed.ok
    ? resolution.hosts.filter((entry) =>
        octetInScanTarget(Number(entry.host.ip.split('.')[3]), parsed.target),
      )
    : [];

  const time = deps.now();
  for (const entry of touched) {
    await logDeepHostScan(deps, {
      entry,
      sourceIp: resolution.sourceIp,
      writerKey: publicKey,
      time,
    });
  }

  return { status: 200, body: { ok: true, hostsLogged: touched.length } };
};
