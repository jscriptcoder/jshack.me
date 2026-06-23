/**
 * handleResolveInnerGatewayScan — server-side resolution of the player's OWN-LAN
 * `nmap` of an inner gateway (multi-layer depth).
 *
 * Unlike a sibling NPC, an inner gateway is scanned from the UPSTREAM side: the
 * player sits on Layer 1, the gateway's deeper layer hangs behind it, so the scan
 * runs at the `external` vantage where a NAT forward is visible. The forward lives
 * in the gateway's `/etc/iptables/rules.v4` on its SERVER-side journal (the player
 * edits it with `nano` after rooting the gateway), so the scan can't be computed
 * from the client's static world — the server regenerates the gateway from the
 * VERIFIED pubkey + essid, replays its journal, asks `canBoot` (a bricked gateway
 * takes the deep entrance dark), and reports its own `sshd:22` plus any LIVE forward
 * via the single `scanResult` total function.
 *
 * The deep layer stays PRIVATE: the gateway is the caller's own box (regenerated
 * from their key), nothing here touches the cross-player `network_registry`, and a
 * forward is surfaced only while the deep host behind it is actually serving the
 * internal port (`buildDeepLayerPortResolver`).
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { DEEP_LAYER_INDEX } from '../generation/generateDeepLayer';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { canBoot } from '../boot/bootFiles';
import { scanResult } from './scanResult';
import { buildDeepLayerPortResolver } from './deepLayerPortResolver';
import type { NonceStore } from '../signedRequest/nonceStore';

export type ResolveInnerGatewayScanDeps = {
  readonly nonceStore: NonceStore;
  /** The inner gateway's FULL patch journal (scoped to its `machine_id`, server
   *  order) so the scan can replay it over the seeded gateway base — both to ask
   *  `canBoot` and to read the live `rules.v4` forward off the materialized tree. */
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
const resolveInnerGatewayScanSchema = z
  .looseObject({
    action: z.literal('resolveInnerGatewayScan'),
    essid: z.string().min(1),
    target: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

const HOST_DOWN: HandlerResponse = { status: 200, body: { ok: true, found: false, ports: [] } };

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** The target host, but only when it is genuinely an INNER GATEWAY on the caller's
 *  regenerated LAN — a `router` host at a non-`.1` octet. The edge `.1` (own-LAN
 *  `sameLAN` scan, client-side), an ordinary sibling, and an off-LAN address all
 *  fall through to null → host-down (a forged or mis-routed target finds nothing). */
const innerGatewayAt = (publicKey: string, essid: string, target: string): LanHost | null => {
  const host = generateHomeLan(publicKey, essid).hosts.find((candidate) => candidate.ip === target);
  if (host === undefined || host.kind !== 'router' || octetOf(host) === 1) return null;
  return host;
};

export const handleResolveInnerGatewayScan = async (
  body: unknown,
  deps: ResolveInnerGatewayScanDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveInnerGatewayScanSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const gateway = innerGatewayAt(publicKey, payload.essid, payload.target);
  if (gateway === null) {
    return HOST_DOWN;
  }

  // The shared resolver maps the gateway to the SAME machine id + seeded base FS the
  // client and the ssh gate use, so the scan reads the box everyone agrees on.
  const { machineId, baseFs } = resolveLanHostIdentity(gateway, publicKey, payload.essid);
  const patches = await deps.findPatches({ machine_id: machineId });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }

  // Replay the gateway's journal over its seeded base, then ask `canBoot`. A root
  // `rm /boot/vmlinuz` tombstone bricks the gateway, so it stops answering — the
  // deep entrance goes dark (host-down, no ports).
  const gatewayFs = materializeMachineFs(baseFs, patches.data);
  if (!canBoot(gatewayFs).ok) {
    return HOST_DOWN;
  }

  // External vantage = the gateway's own ports ∪ its live forwards. The forward's
  // liveness is gated on the one deep host behind it actually serving the internal
  // port (`buildDeepLayerPortResolver`), so a forward to a dead address or a port
  // the deep host doesn't run never surfaces.
  const resolveTargetPorts = buildDeepLayerPortResolver({
    seedPubkeyHex: publicKey,
    essid: payload.essid,
    layerIndex: DEEP_LAYER_INDEX,
  });
  const ports = scanResult({ vantage: 'external', routerFs: gatewayFs, resolveTargetPorts });

  return { status: 200, body: { ok: true, found: true, ports } };
};
