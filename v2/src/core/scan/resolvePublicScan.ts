/**
 * handleResolvePublicScan — server-side resolution of a cross-player public-IP scan.
 *
 * `nmap <public IP>` from one identity resolves against the ACCESS POINT that bears
 * that address: the caller's signed envelope is verified (and not otherwise consulted —
 * any authenticated player may scan any public IP, exactly like the real internet), the
 * public IP is looked up to its ESSID, and the ESSID's shared GATEWAY answers. The
 * gateway is a distinct seeded box that runs its own `sshd:22`; every occupant's
 * workstation is dark behind NAT until a forward opts it in.
 *
 * The gateway's journal is replayed over its seeded base both to ask `canBoot` (a
 * `/boot` tombstone takes the whole public IP dark) and to read the live
 * `/etc/iptables/rules.v4` its forwards parse off. A forward names an internal address,
 * and the box answering to that address is whoever LEASES it — so the ports on a shared
 * AP are its own `sshd` plus EVERY occupant's live forwards, each gated on the liveness
 * of its own target.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { materializeApGatewayFs } from '../network/materializeRouterFs';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import { canBoot } from '../boot/bootFiles';
import { parseForwardRules, readRulesV4 } from '../network/iptablesRules';
import { scanResult } from './scanResult';
import { bootableOccupantFs, natPortResolver } from '../network/natHosts';
import { lanAddressesByOwner, type LanLeaseRow } from '../network/lanAddress';
import { seedApGatewayHostname } from '../generation/routerFs';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter';
import {
  formatNmapScanAggregate,
  KERN_LOG_OWNER,
  KERN_LOG_PATH,
  KERN_LOG_PERMISSIONS,
} from '../logging/kernLog';
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
import type { Directory } from '../filesystem/types';
import type { OpenPort } from '../services/pidfile';
import type { NonceStore } from '../signedRequest/nonceStore';

/** One occupant a NAT forward can reach: its machine id (the journal scope), the
 *  `owner_key` (with the essid, finds its LAN lease) and the identity needed to
 *  reconstruct its tree for the forward's liveness gate. */
export type NatOccupantRow = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

/** What a public IP resolves to: the AP that bears it. The GATEWAY always exists — it
 *  is the access point's own infrastructure rather than a machine that joins the
 *  network, so it answers whether or not anyone is on the WiFi; `router_machine_id` is
 *  its journal scope and the `essid` seeds its base FS and keys its occupancy. */
export type ApNetworkLookup = {
  readonly router_machine_id: string;
  readonly essid: string;
};

export type ResolvePublicScanDeps = {
  readonly nonceStore: NonceStore;
  readonly findNetworkByPublicIp: (
    publicIp: string,
  ) => Promise<{ readonly data: ApNetworkLookup | null; readonly error: unknown }>;
  /** Read a machine's FULL patch journal (scoped to `machine_id`). Used for the GATEWAY
   *  — replayed over its seeded base to ask `canBoot` and to read its live forward
   *  table — and for each occupant a forward points at, to gate that forward on the
   *  target box actually serving the internal port. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  /** Who is currently ON the ESSID. Occupancy is the reachability test, so a forward
   *  naming the address of somebody who has left the WiFi reaches nothing. Read only
   *  when the gateway actually forwards something. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly NatOccupantRow[] | null; readonly error: unknown }>;
  /** Every lease held on this ESSID, in ONE read — the addresses of record. The same
   *  read the same-LAN path resolves addresses from, so a forward and a same-LAN scan
   *  can never disagree on where a box is. Also fixes whose row the AP's own log
   *  accretes under. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
  /** The server's wall clock, epoch-ms (UTC) — stamps the kern.log trace line. */
  readonly now: () => number;
  /** Read the current content of the gateway's kern.log on the shared journal, keyed
   *  `(machine_id, path, writer_key)` — the read half of the appended line. */
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the appended kern.log line on the scanned gateway). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** Resolve the SCANNER's (caller's) own home public IP from their verified owner
   *  key — the truthful source IP of the scan, server-derived so a client cannot
   *  forge it or frame another network. `null` (no home network) → source unknown. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity (the caller is the verified pubkey).
const resolvePublicScanSchema = z
  .looseObject({
    action: z.literal('resolvePublicScan'),
    target: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

/** The forward-liveness resolver `scanResult` consumes, or the response to return
 *  verbatim when a lookup behind it failed (the scan never guesses at a box it could
 *  not read). */
type ForwardResolution =
  | { readonly ok: true; readonly resolveTargetPorts: (internalIp: string) => readonly OpenPort[] }
  | { readonly ok: false; readonly response: HandlerResponse };

/**
 * Resolve every forward on the gateway to the box behind it. The gateway's `rules.v4`
 * is the single source of truth for what is forwarded; we parse it FIRST so a fresh AP
 * (no forward) resolves nothing and skips the occupancy read and every journal fetch.
 *
 * Where a forward does exist, its internal address is matched to the occupant leasing
 * it — both halves matter: the lease says which address a box answers to, occupancy
 * says the box is still on the WiFi at all. Each matched occupant's journal is read so
 * `scanResult` surfaces the forward only while that box is up and serving the port.
 */
const resolveForwardTargets = async (
  deps: ResolvePublicScanDeps,
  network: ApNetworkLookup,
  gatewayFs: Directory,
  leases: readonly LanLeaseRow[],
): Promise<ForwardResolution> => {
  const forwardedAddresses = new Set(
    parseForwardRules(readRulesV4(gatewayFs)).map((forward) => forward.internalIp),
  );
  if (forwardedAddresses.size === 0) {
    return { ok: true, resolveTargetPorts: () => [] };
  }

  const occupants = await deps.listOccupantsByEssid(network.essid);
  if (occupants.error) {
    return { ok: false, response: { status: 500, body: { error: 'occupants_lookup_failed' } } };
  }
  const addresses = lanAddressesByOwner(network.essid, leases);
  const targets = (occupants.data ?? []).flatMap((occupant) => {
    const lanIp = addresses.get(occupant.owner_key);
    return lanIp !== undefined && forwardedAddresses.has(lanIp) ? [{ occupant, lanIp }] : [];
  });

  const journals = await Promise.all(
    targets.map(async (target) => ({
      ...target,
      patches: await deps.findPatches({ machine_id: target.occupant.workstation_machine_id }),
    })),
  );
  if (journals.some((journal) => journal.patches.error)) {
    return { ok: false, response: { status: 500, body: { error: 'patches_lookup_failed' } } };
  }

  const trees = new Map(
    journals.flatMap(({ occupant, lanIp, patches }) => {
      const occupantFs = bootableOccupantFs(occupant, patches.data);
      return occupantFs === null ? [] : [[lanIp, occupantFs] as const];
    }),
  );
  return { ok: true, resolveTargetPorts: natPortResolver(trees) };
};

/** Stamp the scan onto the TARGET gateway's `/var/log/kern.log` via the shared
 *  system-log primitive. The keystone: the line is written under the AP's own stable
 *  log-writer key rather than the scanner's, so every scanner's line accretes into ONE
 *  row instead of colliding under the last-write-wins fold; the scanner's identity
 *  lives in the line's source IP. Best-effort: a logging failure must never break (or
 *  fabricate) the scan. */
const logCrossPlayerScan = async (
  deps: ResolvePublicScanDeps,
  network: ApNetworkLookup,
  writerKey: string,
  ports: readonly OpenPort[],
  sourceIp: string,
): Promise<void> => {
  const line = formatNmapScanAggregate({
    time: asGameTime(deps.now()),
    hostname: seedApGatewayHostname(network.essid),
    sourceIp,
    probedPorts: ports.map((openPort) => openPort.port),
  });
  try {
    await appendMachineLog(
      { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
      {
        writerKey,
        machineId: network.router_machine_id,
        path: KERN_LOG_PATH,
        owner: KERN_LOG_OWNER,
        permissions: KERN_LOG_PERMISSIONS,
      },
      line,
    );
  } catch {
    // best-effort: the scan result stands regardless of a logging failure.
  }
};

export const handleResolvePublicScan = async (
  body: unknown,
  deps: ResolvePublicScanDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolvePublicScanSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { data, error } = await deps.findNetworkByPublicIp(verified.payload.target);
  if (error) {
    return { status: 500, body: { error: 'network_lookup_failed' } };
  }
  if (data === null) {
    return { status: 200, body: { ok: true, found: false, ports: [] } };
  }

  // Replay the GATEWAY's journal over its seeded base, then ask `canBoot`. A root
  // `rm /boot/vmlinuz` (tombstone) makes it unbootable, so it stops answering scans —
  // host-down, no ports — and the whole public IP goes dark.
  const patches = await deps.findPatches({ machine_id: data.router_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const gatewayFs = materializeApGatewayFs(data, patches.data);
  if (!canBoot(gatewayFs).ok) {
    return { status: 200, body: { ok: true, found: false, ports: [] } };
  }

  // One lease read serves both halves of what follows: where each forwarded box
  // answers, and whose row the AP's own log accretes under. A failure is a clean 500 —
  // an address that cannot be read is never derived as a fallback.
  const leases = await deps.listLeasesByEssid(data.essid);
  if (leases.error) {
    return { status: 500, body: { error: 'leases_lookup_failed' } };
  }

  // The gateway's open ports from the single `scanResult` total function (external
  // vantage = own ports ∪ live forwards). Its own `sshd:22` is seeded into its base FS;
  // forwards parse off `/etc/iptables/rules.v4`, each surfaced only while the box
  // behind it is actually serving the internal port.
  const forwards = await resolveForwardTargets(deps, data, gatewayFs, leases.data ?? []);
  if (!forwards.ok) {
    return forwards.response;
  }
  const ports = scanResult({
    vantage: 'external',
    routerFs: gatewayFs,
    resolveTargetPorts: forwards.resolveTargetPorts,
  });

  // Host-up: leave a truthful kern.log trace on the gateway's shared record. The source
  // IP is the scanner's own home public IP, server-derived from their verified key —
  // never the payload's. An AP nobody has ever leased an address on has no row to write
  // under, so it keeps no log; the scan still reports truthfully.
  const writerKey = apGatewayLogWriterKey(leases.data ?? []);
  if (writerKey !== null) {
    const sourceIp = await resolveCrossPlayerSourceIp(
      deps.findHomeNetworkByOwnerKey,
      verified.publicKey,
    );
    await logCrossPlayerScan(deps, data, writerKey, ports, sourceIp);
  }

  return { status: 200, body: { ok: true, found: true, ports } };
};
