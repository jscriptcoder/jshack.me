/**
 * handleResolvePublicScan — server-side resolution of a cross-player public-IP
 * scan (Story 1, slice 1a).
 *
 * Today `nmap` only reaches a player's OWN regenerated LAN; a public IP is "out of
 * range". This handler is what makes one identity's `nmap <public IP>` resolve
 * against ANOTHER identity's machine: it verifies the caller's signed envelope and
 * looks the target up in the public-IP registry written on join
 * (`registerNetwork`). The caller's identity is authenticated (envelope + replay
 * guard) but not otherwise consulted — any authenticated player may scan any
 * public IP, exactly like the real internet.
 *
 * Slice 1a reported existence only (host up / down); 1b reads open ports. Story
 * 5.1.1b flips the resolved machine from the workstation to the ROUTER: a public
 * IP maps to the owner's router (`router_machine_id`), a distinct seeded box that
 * bears the public IP and runs its own `sshd:22`. The workstation is dark behind
 * NAT until the owner opts a forward in (Story 5.1.3). The router's journal is
 * replayed over its seeded base to ask `canBoot` (a bricked router takes the whole
 * public IP dark), and its ports come from the single `scanResult` total function
 * — which, fed the router's parsed `/etc/iptables/rules.v4`, will surface forwards
 * once they exist.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import type { NonceStore } from '../signedRequest/nonceStore';
import { materializeRouterFs } from '../network/materializeRouterFs';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import { canBoot } from '../boot/bootFiles';
import { parseForwardRules, readRulesV4 } from '../network/iptablesRules';
import { scanResult } from './scanResult';
import { buildWorkstationPortResolver } from './workstationPortResolver';
import type { Directory } from '../filesystem/types';
import type { OpenPort } from '../services/pidfile';

/** The registry fields the router scan needs. For the boot-state check + the
 *  router's own ports: which router the public IP maps to (`router_machine_id` — its
 *  journal scope) and the `owner_key` that seeds its base FS. For liveness-gating a
 *  NAT forward to the workstation behind NAT (Story 5.1.3b): the workstation's
 *  machine id (its journal scope), the `essid` (with `owner_key`, derives its LAN
 *  IP), and its identity (to reconstruct its tree). */
export type RegistryLookup = {
  readonly router_machine_id: string;
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly essid: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

export type ResolvePublicScanDeps = {
  readonly nonceStore: NonceStore;
  readonly findRegistryByPublicIp: (
    publicIp: string,
  ) => Promise<{ readonly data: RegistryLookup | null; readonly error: unknown }>;
  /** Read the resolved ROUTER's FULL patch journal (scoped to `machine_id`) so the
   *  scan can replay it over the seeded router base — both to ask `canBoot` (a
   *  `/boot` tombstone takes the public IP dark) and to materialize the tree
   *  `scanResult` reads the open ports from. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
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

/** The forward-liveness resolver `scanResult` consumes, or `null` when the
 *  workstation journal read fails (→ the caller fails the scan with 500, like the
 *  router read). The router's `rules.v4` is the single source of truth for forwards;
 *  we parse it ONLY to decide whether a workstation read is even needed — a fresh
 *  box (no forward) returns a resolver that resolves nothing and skips the extra
 *  journal fetch. When a forward exists, read the workstation behind NAT so
 *  `scanResult` shows the forward only while its target port is up. */
type ForwardResolver = (internalIp: string) => readonly OpenPort[];

const resolveForwardTargets = async (
  deps: ResolvePublicScanDeps,
  registry: RegistryLookup,
  routerFs: Directory,
): Promise<ForwardResolver | null> => {
  if (parseForwardRules(readRulesV4(routerFs)).length === 0) {
    return () => [];
  }
  const workstationPatches = await deps.findPatches({
    machine_id: registry.workstation_machine_id,
  });
  if (workstationPatches.error) return null;
  return buildWorkstationPortResolver({ registry, workstationPatches: workstationPatches.data });
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

  const { data, error } = await deps.findRegistryByPublicIp(verified.payload.target);
  if (error) {
    return { status: 500, body: { error: 'registry_lookup_failed' } };
  }
  if (data === null) {
    return { status: 200, body: { ok: true, found: false, ports: [] } };
  }

  // Replay the ROUTER's journal over its seeded base, then ask `canBoot`. A root
  // `rm /boot/vmlinuz` (tombstone) makes the router unbootable, so it stops
  // answering scans — host-down, no ports — and the whole public IP goes dark.
  const patches = await deps.findPatches({ machine_id: data.router_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const routerFs = materializeRouterFs(data, patches.data);
  if (!canBoot(routerFs).ok) {
    return { status: 200, body: { ok: true, found: false, ports: [] } };
  }

  // The router's open ports from the single `scanResult` total function (external
  // vantage = own ports ∪ live forwards). The router's own `sshd:22` is seeded into
  // its base FS; forwards parse off `/etc/iptables/rules.v4`, each surfaced only
  // while the workstation behind it is actually serving the internal port.
  const resolveTargetPorts = await resolveForwardTargets(deps, data, routerFs);
  if (resolveTargetPorts === null) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const ports = scanResult({ vantage: 'external', routerFs, resolveTargetPorts });
  return { status: 200, body: { ok: true, found: true, ports } };
};
