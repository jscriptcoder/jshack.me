/**
 * handleResolveInnerGatewayScan — server-side resolution of the player's OWN-LAN
 * `nmap` of an inner gateway (multi-layer depth).
 *
 * Unlike a sibling NPC, an inner gateway is scanned from the UPSTREAM side: the
 * player sits on Layer 1, the gateway's deeper layers hang behind it, so the scan
 * runs at the `external` vantage where a NAT forward is visible. Each forward lives
 * in a gateway's `/etc/iptables/rules.v4` on its SERVER-side journal (the player
 * edits it with `nano` after rooting the gateway), so the scan can't be computed
 * from the client's static world — the server regenerates the gateway from the
 * ESSID, replays its journal, asks `canBoot` (a bricked gateway takes the deep
 * entrance dark), and reports its own `sshd:22` plus any LIVE forward via the single
 * `scanResult` total function.
 *
 * A forward to the terminal NPC is live only while that NPC serves the internal port;
 * a forward to the CHILD GATEWAY that fronts the next layer down is resolved by
 * recursing into the child's OWN exposed ports (the same upstream scan, one layer
 * deeper), so a CHAINED forward surfaces only while the whole chain below it stays
 * live — a bricked or dead-ended intermediate takes the chained port dark. Every box
 * down the chain is seeded from the ESSID, so all occupants of an AP walk the SAME
 * deep layers; what makes this an OWN-LAN scan is that the caller is standing on
 * Layer 1 of that network, not that the boxes below belong to them.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { innerGatewayAt, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import {
  generateDeepLayer,
  seedNetworkDepth,
  type FrontingGateway,
} from '../generation/generateDeepLayer';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { resolveChildGatewayHop, resolveDeepHostHop } from '../network/deepLayerHop';
import { parseForwardRules, readRulesV4 } from '../network/iptablesRules';
import { canBoot } from '../boot/bootFiles';
import { readOpenPorts, type OpenPort } from '../services/pidfile';
import { scanResult } from './scanResult';
import type { Directory } from '../filesystem/types';
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

/** A gateway's externally-visible ports resolved down the chain, or a child-journal
 *  fetch that failed mid-walk (→ 500, distinct from a port that simply leads nowhere). */
type ExposedPorts =
  | { readonly kind: 'ports'; readonly ports: readonly OpenPort[] }
  | { readonly kind: 'lookup_failed' };

/** The invariants every hop of the chain walk shares: the essid the deep layers
 *  regenerate from, the network's seeded chain depth (the bound that makes the walk
 *  finite), and the journal fetch that replays each child gateway. No identity: the chain
 *  descends from a gateway the access point owns, so every occupant walks the same one. */
type ChainContext = {
  readonly essid: string;
  readonly depth: number;
  readonly findPatches: ResolveInnerGatewayScanDeps['findPatches'];
};

/**
 * The chain-aware exposed ports of the gateway at `position` (1-based; the inner gateway
 * is position 1): its own `scanResult(external)`, where each NAT forward is live only
 * while the box it targets actually serves the internal port. The terminal NPC behind the
 * gateway answers from its regenerated tree (no journal); a forward to the CHILD GATEWAY
 * that fronts the next layer down is resolved by recursing into the child's OWN exposed
 * ports — so a chained forward surfaces only while the whole chain below it stays live,
 * and a bricked or dead-ended intermediate takes the chained port dark. A child's journal
 * is replayed over its seeded base (a fetch failure surfaces as `lookup_failed`), and the
 * child is resolved only when a forward actually points at it. The walk is bounded by
 * `depth`: a gateway fronts a child only while `position < depth`.
 */
const resolveGatewayExposedPorts = async (
  context: ChainContext,
  gatewayFs: Directory,
  frontingGateway: FrontingGateway,
  position: number,
): Promise<ExposedPorts> => {
  const deep = generateDeepLayer(context.essid, frontingGateway, {
    hangsChild: position < context.depth,
  });
  const forwards = parseForwardRules(readRulesV4(gatewayFs));
  // The terminal NPC is read like every other box on the chain: its own journal replayed
  // over the seeded tree, and boot-gated. Taken straight off the regenerated tree it
  // advertised daemons a player had stopped and hid ones they had moved, so the scan
  // promised doors the reach then refused — and stayed silent about doors that opened.
  const deepHost = await resolveDeepHostHop({
    essid: context.essid,
    host: deep.host,
    findPatches: context.findPatches,
  });
  if (deepHost.kind === 'lookup_failed') {
    return { kind: 'lookup_failed' };
  }
  // A box that cannot boot has no doors: it advertises nothing rather than dropping the
  // whole scan, because the gateway above it is still answering for everything else.
  const targets = new Map<string, readonly OpenPort[]>([
    [deep.host.ip, deepHost.kind === 'box' ? readOpenPorts(deepHost.fs) : []],
  ]);
  // Resolve the child gateway's exposed ports only when a forward actually points at it,
  // recursing one layer deeper so a chained forward is live only while the chain below is.
  const childGateway = deep.childGateway;
  if (childGateway !== null && forwards.some((forward) => forward.internalIp === childGateway.ip)) {
    const hop = await resolveChildGatewayHop({
      parentMachineId: frontingGateway.machineId,
      childIp: childGateway.ip,
      childKind: childGateway.kind,
      findPatches: context.findPatches,
    });
    if (hop.kind === 'lookup_failed') {
      return { kind: 'lookup_failed' };
    }
    if (hop.kind === 'box') {
      const childExposed = await resolveGatewayExposedPorts(
        context,
        hop.fs,
        { machineId: hop.machineId, kind: childGateway.kind },
        position + 1,
      );
      if (childExposed.kind === 'lookup_failed') {
        return childExposed;
      }
      targets.set(childGateway.ip, childExposed.ports);
    }
    // A bricked child is left out of the map — its forward stays dark.
  }
  return {
    kind: 'ports',
    ports: scanResult({
      vantage: 'external',
      routerFs: gatewayFs,
      resolveTargetPorts: (internalIp) => targets.get(internalIp) ?? [],
    }),
  };
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
  // The verified signature is the whole of what the caller's identity decides here: the
  // gateway and the chain behind it belong to the access point, so every occupant scanning
  // this address is scanning one box.
  const { payload } = verified;

  const gateway = innerGatewayAt(payload.essid, payload.target);
  if (gateway === null) {
    return HOST_DOWN;
  }

  // The shared resolver maps the gateway to the SAME machine id + seeded base FS the
  // client and the ssh gate use, so the scan reads the box everyone agrees on.
  const { machineId, baseFs } = resolveLanHostIdentity(gateway, payload.essid);
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

  // External vantage = the gateway's own ports ∪ its live forwards, resolved down the
  // chain: a forward to the terminal NPC is live only while it serves the internal port,
  // and a forward to the child gateway recurses into the child's own exposed ports, so a
  // chained forward surfaces only while the whole chain stays live. A child-journal fetch
  // failure mid-walk is a 500, kept distinct from a port that simply leads nowhere.
  const exposed = await resolveGatewayExposedPorts(
    {
      essid: payload.essid,
      depth: seedNetworkDepth(payload.essid),
      findPatches: deps.findPatches,
    },
    gatewayFs,
    { machineId, kind: gateway.kind },
    1,
  );
  if (exposed.kind === 'lookup_failed') {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }

  return { status: 200, body: { ok: true, found: true, ports: exposed.ports } };
};
