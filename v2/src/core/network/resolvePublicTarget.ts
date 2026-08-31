/**
 * resolvePublicTarget — what a public IP and destination port actually reach.
 *
 * A public IP names an ACCESS POINT, not a machine. Its gateway is materialized
 * first because it decides everything downstream: the boot gate (a `/boot`
 * tombstone takes the whole address dark), the port routing, and — for a port the
 * gateway serves itself — the target tree.
 *
 *   - a port the GATEWAY serves (its seeded `sshd:22`) → the gateway itself,
 *     root-only, its admin password seeded from the ESSID. It has no owner, so its
 *     log accretes under the AP's stable log-writer key.
 *   - a NAT-forwarded port → the occupant who LEASES the address that forward
 *     names. Every occupant of a shared AP can publish a working forward, and two
 *     forwards on one gateway reach two different boxes.
 *   - any other port → unreachable.
 *
 * One resolution, and it is meant to have several callers: whatever authenticates
 * against this tree and whatever attacks it must land on the SAME box, or the game
 * hands a player a credential that is then refused. A second copy of this sequence
 * is precisely how that bug arrives, so there is deliberately only one.
 *
 * Pure/framework-agnostic (core/): every lookup is injected. A refusal carries the
 * status and reason its caller returns verbatim, mirroring `authorizeMachineAccess`.
 */

import { seedApGatewayHostname } from '../generation/routerFs';
import { materializeApGatewayFs } from './materializeRouterFs';
import type { OwnerPatchRow } from './materializeWorkstationFs';
import { machineServing, type ServedMachine } from './machineServing';
import { bootableOccupantFs } from './natHosts';
import { lanAddressesByOwner, type LanLeaseRow } from './lanAddress';
import { portsOpenToNetwork } from './portsOpenToNetwork';
import { canBoot } from '../boot/bootFiles';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter';
import { frontedSegment } from './frontedSegment';
import type { Directory } from '../filesystem/types';

/** One occupant a NAT forward can land on: its machine id (the journal scope AND
 *  the session target), the `owner_key` that rebuilds its tree and owns its logs,
 *  and the identity fields the reconstructed passwd is derived from. A structural
 *  superset of the scan path's row, so the shared resolver takes it verbatim. */
export type NatOccupantRow = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly workstation_username: string;
  /** The owner's player-chosen workstation hostname — the name a forwarded-port
   *  `auth.log` line carries, mirroring the gateway's seeded hostname. */
  readonly workstation_machine_name: string;
  readonly workstation_root_hash: string;
};

/** What a public IP resolves to: the AP that bears it. The GATEWAY always exists —
 *  it is the access point's own infrastructure rather than a machine that joins the
 *  network — so `router_machine_id` (its journal scope AND the port-22 target) and
 *  the `essid` (which seeds its FS, recovers its admin password and keys its
 *  occupancy) are always present. */
export type ApNetworkLookup = {
  readonly router_machine_id: string;
  readonly essid: string;
};

export type ResolvePublicTargetDeps = {
  readonly findNetworkByPublicIp: (
    publicIp: string,
  ) => Promise<{ readonly data: ApNetworkLookup | null; readonly error: unknown }>;
  /** A machine's FULL patch journal (scoped to `machine_id`, server order). Used for
   *  the GATEWAY — replayed over its seeded base for the boot gate and the live forward
   *  table — and for the box a forward reaches, for its services and its passwd. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  /** Who is currently ON the ESSID. Occupancy is the reachability test, so a forward
   *  naming the address of somebody who has left the WiFi reaches nothing. Read only
   *  when the requested port is actually forwarded. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly NatOccupantRow[] | null; readonly error: unknown }>;
  /** Every lease held on this ESSID, in ONE read — the addresses of record. The same
   *  read the same-LAN path resolves addresses from, so the two gates can never
   *  disagree on where a box is. Also fixes whose row the gateway's own log accretes
   *  under. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
};

/** The box behind the public IP: which tree to read, the machine id a session lands
 *  on and a log line is written to, the hostname that line carries, whose row it
 *  accretes under (the reached occupant's own key, or the AP's stable log-writer key
 *  when the target is the ownerless gateway — `null` on an AP nobody has ever leased
 *  an address on, which then keeps no log), and the ESSID the address belongs to. */
export type PublicTarget = {
  readonly fs: Directory;
  readonly machineId: string;
  readonly hostname: string;
  readonly logWriterKey: string | null;
  readonly essid: string;
  /** The `/24` this box's forwards may point INTO, or `null` for a box that fronts no
   *  network at all. Answered HERE because only this resolver knows which of the two it
   *  handed back: the access point's gateway fronts the LAN behind it, while an
   *  occupant's workstation reached through a forward stands on that LAN and fronts
   *  nothing. A caller cannot work it out — the ESSID travelling with a public request
   *  is the one the CALLER is associated with, and judging somebody else's router by the
   *  attacker's own network is how every destination inside the LAN under attack came to
   *  be refused. */
  readonly frontedSegment: string | null;
  /** The port ON THE TARGET that the requested destination port actually reaches: the
   *  gateway's own listening port, or the far side of a NAT forward. A caller naming a
   *  service must check it against THIS rather than against any port the box happens to
   *  have open, or a forward to one daemon becomes a door to every daemon. */
  readonly reachedPort: number;
};

export type PublicTargetResult =
  | { readonly ok: true; readonly target: PublicTarget }
  | { readonly ok: false; readonly status: number; readonly error: string };

// The destination ssh port when the caller names none — a bare `ssh user@host` is
// port 22. Callers normally carry a resolved port; defaulting here keeps every one
// of them correct, and keeps the default from forking between them.
const DEFAULT_SSH_PORT = 22;

/** The gateway itself as a target — the box the public IP belongs to, root-only, its
 *  admin password seeded from the ESSID. Ownerless, so its log accretes under the
 *  AP's stable log-writer key. */
const gatewayTarget = (
  network: ApNetworkLookup,
  gatewayFs: Directory,
  leases: readonly LanLeaseRow[],
  port: number,
): PublicTarget => ({
  fs: gatewayFs,
  machineId: network.router_machine_id,
  hostname: seedApGatewayHostname(network.essid),
  logWriterKey: apGatewayLogWriterKey(leases),
  essid: network.essid,
  // An access point's gateway IS a router — `generateHomeLan` builds the `.1` as one —
  // so this states the device rather than assuming one, and the LAN it fronts is the
  // network its own address sits on.
  frontedSegment: frontedSegment({
    essid: network.essid,
    machineId: network.router_machine_id,
    kind: 'router',
  }),
  reachedPort: port,
});

/**
 * Resolve a NAT-forwarded port to its target: the occupant leasing the address the
 * forward names. Both halves of that lookup matter — the lease says which address a box
 * answers to, occupancy says the box is still on the WiFi at all — so a forward to an
 * unleased address, or to a lease whose holder has disconnected, reaches nothing.
 */
const resolveForwardTarget = async (
  deps: ResolvePublicTargetDeps,
  network: ApNetworkLookup,
  forwarded: { readonly internalIp: string; readonly internalPort: number },
  leases: readonly LanLeaseRow[],
): Promise<PublicTargetResult> => {
  const occupants = await deps.listOccupantsByEssid(network.essid);
  if (occupants.error) {
    return { ok: false, status: 500, error: 'occupants_lookup_failed' };
  }
  const addresses = lanAddressesByOwner(network.essid, leases);
  const occupant = (occupants.data ?? []).find(
    (row) => addresses.get(row.owner_key) === forwarded.internalIp,
  );
  // The forward points at no host: a stray internal IP, an address nobody leases, or
  // one whose holder has taken their box off this WiFi.
  if (occupant === undefined) {
    return { ok: false, status: 404, error: 'host_unreachable' };
  }

  const patches = await deps.findPatches({ machine_id: occupant.workstation_machine_id });
  if (patches.error) {
    return { ok: false, status: 500, error: 'patches_lookup_failed' };
  }
  const occupantFs = bootableOccupantFs(occupant, patches.data);
  // A bricked box behind the NAT can't come up, so the forward reaches a dead host.
  if (occupantFs === null) {
    return { ok: false, status: 404, error: 'host_unreachable' };
  }
  // The internal service isn't answering the network — never started, or running behind
  // the target's own filter. The forward's SPECIFIC internal port, not merely "any
  // service is up".
  //
  // Filtered here rather than a layer later, and that is the whole point: routing on the
  // raw pidfiles let a stopped daemon fail HERE as host_unreachable while a filtered one
  // routed fine and was refused above as service_not_running. Two names for one silence
  // is an oracle — a stranger could tell a box that is defending a port from one that
  // never had it. This box TERMINATES the forwarded traffic, so its filter governs;
  // the gateway that merely passes the traffic through keeps its own filter out of it.
  const listening = portsOpenToNetwork(occupantFs).some(
    (openPort) => openPort.port === forwarded.internalPort,
  );
  if (!listening) {
    return { ok: false, status: 404, error: 'host_unreachable' };
  }
  return {
    ok: true,
    target: {
      fs: occupantFs,
      machineId: occupant.workstation_machine_id,
      hostname: occupant.workstation_machine_name,
      logWriterKey: occupant.owner_key,
      essid: network.essid,
      // A box behind the NAT stands on the LAN and has nothing behind IT, so a forward
      // written here could not route anywhere whatever address it named.
      frontedSegment: null,
      reachedPort: forwarded.internalPort,
    },
  };
};

export const resolvePublicTarget = async (
  deps: ResolvePublicTargetDeps,
  request: { readonly publicIp: string; readonly port: number | undefined },
): Promise<PublicTargetResult> => {
  const { data, error } = await deps.findNetworkByPublicIp(request.publicIp);
  if (error) {
    return { ok: false, status: 500, error: 'network_lookup_failed' };
  }
  if (data === null) {
    return { ok: false, status: 404, error: 'host_unreachable' };
  }

  // Materialize the GATEWAY once: it drives the boot gate, the port routing, and — for
  // a gateway-served port — the target tree, all off one consistent tree.
  const patches = await deps.findPatches({ machine_id: data.router_machine_id });
  if (patches.error) {
    return { ok: false, status: 500, error: 'patches_lookup_failed' };
  }
  const gatewayFs = materializeApGatewayFs(data, patches.data);

  // A bricked gateway (a `/boot` tombstone) takes the whole public IP dark: refuse
  // before anything behind it is reached — nothing gets through a dead box.
  if (!canBoot(gatewayFs).ok) {
    return { ok: false, status: 404, error: 'host_unreachable' };
  }

  // Route by destination port BEFORE any occupancy or lease work: a port nothing serves
  // reaches nothing, and asking who is on the AP would not change that.
  const destinationPort = request.port ?? DEFAULT_SSH_PORT;
  const served: ServedMachine = machineServing({ routerFs: gatewayFs, port: destinationPort });
  if (served.kind === 'none') {
    return { ok: false, status: 404, error: 'host_unreachable' };
  }

  // The gateway's own INPUT chain drops a packet addressed TO IT before anything is
  // routed. Routing reads the pidfiles and cannot see a filter, so a port its owner had
  // denied used to route fine and be refused a layer later under a name of its own —
  // leaving "filtered" as the ONE state a stranger could pick out from the world, when
  // an address bearing no network, a bricked gateway, a stopped daemon and a refused
  // community all answer alike. A defence that announces itself tells a scanner which
  // boxes are worth a wordlist.
  //
  // A FORWARD is deliberately untouched: an INPUT rule governs traffic the box
  // terminates, never traffic it passes through, so closing the agent's own port cannot
  // also close a door somebody opened onto their workstation.
  const openToWorld = portsOpenToNetwork(gatewayFs).some(
    (open) => open.port === destinationPort,
  );
  if (served.kind === 'router' && !openToWorld) {
    return { ok: false, status: 404, error: 'host_unreachable' };
  }

  // One lease read serves both halves of what follows: which box a forward reaches, and
  // whose row the gateway's own log accretes under. A failure is a clean 500 — an
  // address that cannot be read is never derived as a fallback.
  const leases = await deps.listLeasesByEssid(data.essid);
  if (leases.error) {
    return { ok: false, status: 500, error: 'leases_lookup_failed' };
  }
  return served.kind === 'router'
    ? { ok: true, target: gatewayTarget(data, gatewayFs, leases.data ?? [], destinationPort) }
    : resolveForwardTarget(deps, data, served, leases.data ?? []);
};
