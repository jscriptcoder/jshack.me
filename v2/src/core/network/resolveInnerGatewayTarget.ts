/**
 * resolveInnerGatewayTarget — what `<inner gateway IP>:<port>` actually reaches.
 *
 * A player's own LAN carries inner gateways, and each one fronts a hidden deep layer.
 * The forwards that expose it live in the gateway's `/etc/iptables/rules.v4` on its
 * SERVER-side journal (the player added them with `nano` after rooting it), so this can
 * never be resolved from the client's static world: the journal is replayed here, and
 * the destination port is routed through `machineServing`:
 *
 *   - a NAT-forwarded port → a box on this gateway's deep layer: the terminal NPC or the
 *     CHILD GATEWAY that fronts the next layer down. A forward to a child gateway replays
 *     ITS journal, re-checks `canBoot` (a bricked intermediate darkens everything below),
 *     and follows the forward one layer deeper — so a chain of forwards reaches an
 *     arbitrarily deep box. A forward to a stray address, or to a port the target is not
 *     serving, is dark.
 *   - a gateway's own `:22` → the gateway itself.
 *   - any other port → unreachable.
 *
 * One resolver, two callers: `ssh` authenticates through it and `hydra` sweeps through
 * it, so a password hydra reports for a deep box is one ssh then accepts — by
 * construction rather than by two chain walks staying in step.
 *
 * The chain is regenerated from the ESSID and the shared journal, never from the
 * caller's key: these boxes stand on the access point's LAN, so every occupant of an
 * ESSID resolves the SAME gateway, the same forwards and the same deep hosts. Nothing
 * here reads the occupant or lease tables — the deep layer needs no cross-player lookup,
 * which is a different claim from it being private, and only the first one is true.
 */

import {
  buildDeepHostFs,
  generateDeepLayer,
  seedNetworkDepth,
  type FrontingGateway,
} from '../generation/generateDeepLayer';
import { innerGatewayAt, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { hostMachineId } from '../generation/remoteHostId';
import { materializeMachineFs, type OwnerPatchRow } from './materializeMachineFs';
import { resolveChildGatewayHop } from './childGatewayHop';
import { machineServing } from './machineServing';
import { readOpenPorts } from '../services/pidfile';
import { canBoot } from '../boot/bootFiles';
import type { Directory } from '../filesystem/types';

export type InnerGatewayTargetDeps = {
  /** A machine's FULL patch journal (scoped to its `machine_id`, server order) so each
   *  gateway on the chain can be replayed — both to ask `canBoot` and to read the live
   *  `rules.v4` forward off the materialized tree. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
};

/** The box a destination port reaches down the chain: its materialized tree, the machine
 *  id every caller must agree on, the hostname a log line carries, and the port ON that
 *  box the request actually arrived at. */
export type InnerGatewayTarget = {
  readonly fs: Directory;
  readonly machineId: string;
  readonly hostname: string;
  /** The address the target saw: the `.1` of the deep subnet the connection arrived
   *  through (the fronting gateway), since NAT is all a deep box is ever shown. `null`
   *  when the reach landed on the inner gateway's OWN `:22` — a Layer-1 box reached
   *  directly, not a deep one. */
  readonly sourceIp: string | null;
  /** The port ON THE TARGET the requested port reaches: the gateway's own listening
   *  port, or the far side of a NAT forward. A caller naming a service must check it
   *  against THIS rather than any port the box happens to have open, or a forward to one
   *  daemon becomes a door to every daemon. */
  readonly reachedPort: number;
};

export type InnerGatewayTargetResult =
  | { readonly ok: true; readonly target: InnerGatewayTarget }
  | { readonly ok: false; readonly status: number; readonly error: string };

const UNREACHABLE: InnerGatewayTargetResult = {
  ok: false,
  status: 404,
  error: 'host_unreachable',
};

const LOOKUP_FAILED: InnerGatewayTargetResult = {
  ok: false,
  status: 500,
  error: 'patches_lookup_failed',
};

/** The invariants every hop of the chain walk shares: the essid the deep layers
 *  regenerate from, the network's seeded chain depth (the bound that makes the walk
 *  finite), and the journal fetch that replays each child gateway. No identity: the chain
 *  descends from a gateway the access point owns, so every occupant walks the same one. */
type ChainContext = {
  readonly essid: string;
  readonly depth: number;
  readonly findPatches: InnerGatewayTargetDeps['findPatches'];
};

/** The gateway the walk currently sits on: a `FrontingGateway` plus the hostname the
 *  landed box's log line carries (its seeded name). */
type WalkGateway = FrontingGateway & { readonly hostname: string };

/** Does this materialized tree run a daemon on `port`? A forward whose internal port
 *  no box behind the gateway serves is a dark DNAT target. */
const servesInternalPort = (fs: Directory, port: number): boolean =>
  readOpenPorts(fs).some((openPort) => openPort.port === port);

/**
 * Resolve `<inner>:<port>` to its target by walking the forward chain from the gateway at
 * `position` (1-based; the inner gateway is position 1).
 *
 * The walk is bounded by `depth`: a gateway at `position` fronts a child only while
 * `position < depth`, and the position strictly increases each hop, so the recursion
 * terminates. Regenerating a child needs its journal, so a fetch failure surfaces as
 * `patches_lookup_failed` rather than a false `host_unreachable`.
 */
const resolveTargetAt = async (
  context: ChainContext,
  gatewayFs: Directory,
  frontingGateway: WalkGateway,
  port: number,
  position: number,
  arrivalSubnet: string | null,
): Promise<InnerGatewayTargetResult> => {
  const served = machineServing({ routerFs: gatewayFs, port });
  if (served.kind === 'router') {
    // Landing on this gateway's own `:22`. The source IP is the `.1` of the subnet the
    // connection arrived on — `null` at the top of the walk (the inner gateway, a
    // Layer-1 box reached directly), a deep `.1` for a child gateway reached through a
    // forward.
    return {
      ok: true,
      target: {
        fs: gatewayFs,
        machineId: frontingGateway.machineId,
        hostname: frontingGateway.hostname,
        sourceIp: arrivalSubnet === null ? null : `${arrivalSubnet}.1`,
        reachedPort: port,
      },
    };
  }
  if (served.kind === 'none') {
    return UNREACHABLE;
  }
  // The gateway forwards `port` onto its deep layer. Regenerate the layer; it hangs a
  // child gateway only while this gateway sits above the home's seeded depth.
  const deep = generateDeepLayer(context.essid, frontingGateway, {
    hangsChild: position < context.depth,
  });
  // The forward reaches the terminal NPC — the box the session lands on, or the accounts
  // a sweep is run against.
  if (served.internalIp === deep.host.ip) {
    const deepFs = buildDeepHostFs(context.essid, deep.host);
    return servesInternalPort(deepFs, served.internalPort)
      ? {
          ok: true,
          target: {
            fs: deepFs,
            machineId: hostMachineId(deep.host, context.essid),
            hostname: deep.host.hostname,
            sourceIp: `${deep.subnet}.1`,
            reachedPort: served.internalPort,
          },
        }
      : UNREACHABLE;
  }
  // The forward reaches the CHILD GATEWAY that fronts the next layer down. Resolve it
  // (replay its own journal, boot-gate it), refuse it when a brick takes the deeper chain
  // dark, then walk one layer deeper on the forward's internal port — which may be the
  // child's own `:22` (land on the child) or another forward (continue the chain).
  if (deep.childGateway !== null && served.internalIp === deep.childGateway.ip) {
    const hop = await resolveChildGatewayHop({
      parentMachineId: frontingGateway.machineId,
      childIp: deep.childGateway.ip,
      childKind: deep.childGateway.kind,
      findPatches: context.findPatches,
    });
    if (hop.kind === 'lookup_failed') {
      return LOOKUP_FAILED;
    }
    if (hop.kind === 'bricked') {
      return UNREACHABLE;
    }
    return resolveTargetAt(
      context,
      hop.fs,
      {
        machineId: hop.machineId,
        kind: deep.childGateway.kind,
        hostname: deep.childGateway.hostname,
      },
      served.internalPort,
      position + 1,
      deep.subnet,
    );
  }
  // The forward points at no box on the layer — a stray internal IP, a dark DNAT target.
  return UNREACHABLE;
};

export const resolveInnerGatewayTarget = async (
  deps: InnerGatewayTargetDeps,
  request: { readonly essid: string; readonly target: string; readonly port: number },
): Promise<InnerGatewayTargetResult> => {
  // The target must be a genuine inner gateway on the regenerated LAN — the edge `.1`, a
  // sibling, or an off-LAN address finds nothing (no journal read).
  const gateway = innerGatewayAt(request.essid, request.target);
  if (gateway === null) {
    return UNREACHABLE;
  }

  // The shared resolver maps the gateway to the SAME machine id + seeded base the scan
  // gate and the client use, so the journal it replays is the box everyone agrees on.
  const { machineId: gatewayMachineId, baseFs } = resolveLanHostIdentity(gateway, request.essid);
  const patches = await deps.findPatches({ machine_id: gatewayMachineId });
  if (patches.error) {
    return LOOKUP_FAILED;
  }

  // Replay the gateway's journal, then ask `canBoot`. A root `rm /boot/vmlinuz` tombstone
  // bricks the gateway, so it stops answering — the deep entrance goes dark, refused
  // before any credential is checked.
  const gatewayFs = materializeMachineFs(baseFs, patches.data);
  if (!canBoot(gatewayFs).ok) {
    return UNREACHABLE;
  }

  return resolveTargetAt(
    {
      essid: request.essid,
      depth: seedNetworkDepth(request.essid),
      findPatches: deps.findPatches,
    },
    gatewayFs,
    { machineId: gatewayMachineId, kind: gateway.kind, hostname: gateway.hostname },
    request.port,
    1,
    null,
  );
};
