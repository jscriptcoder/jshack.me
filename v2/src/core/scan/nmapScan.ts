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
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { buildRouterBaseFs } from '../generation/routerFs';
import { hostMachineId } from '../generation/remoteHostId';
import { computeRouterId } from '../identity/router';
import { assignHomeNetwork } from '../network/homeNetwork';
import { parseScanTarget, hostsInScanTarget } from '../network/scanTarget';
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

export type NmapScanDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the kern.log line. */
  readonly now: () => number;
  /** Read the current content of a log file on this machine's shared journal,
   *  keyed `(machine_id, path, writer_key)`. */
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the appended kern.log line on the scanned host). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
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
  // The `.1` gateway is the player's OWN ROUTER — a journal-backed box reached at
  // run time via `ssh root@.1` → `computeRouterId`, with its real services in the
  // router base FS. Both its trace TARGET (machine id) and its PORT list must come
  // from the router, not the generic coordinate path: its `hostMachineId` is a
  // dead-end nobody reads, and its `buildRemoteHostFs` ports are unrelated to the
  // sshd the scanner actually sees (so a generic read would log "ports none" for a
  // router visibly running ssh). A generic NPC sibling keeps the coordinate path
  // (the owner never logs into it). Mirrors `ssh.ts`'s own-router branch. The writer
  // stays the caller, who is the owner on this own-LAN path — still owner-keyed.
  const isRouter = host.kind === 'router';
  const hostFs = isRouter
    ? buildRouterBaseFs(context.publicKey)
    : buildRemoteHostFs(context.publicKey, context.essid, host);
  const machineId = isRouter ? computeRouterId(context.publicKey) : hostMachineId(host, context.essid);
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

  return { status: 200, body: { ok: true, hostsLogged: hosts.length } };
};
