/**
 * Reaching a box that serves a named daemon, before anything is asked of it.
 *
 * Every door that answers with the box's own DATA — the database login and every
 * statement behind it, the key-value connection and every statement behind that — has
 * to establish the same four things first: that the address names a real host on the
 * caller's own LAN, that the box boots, that the daemon is actually listening, and
 * what the box's filesystem currently IS. Only then is there something to answer with.
 *
 * Which daemon is the only thing that differs, so it is a PARAMETER rather than a
 * second copy of this file. Four vantages, a boot gate, a journal replay and a pidfile
 * check are the same work in the same order whichever door asked — which is what made
 * the terminal box's missing journal replay ONE gap to close rather than one per door
 * once it was finally closed where the walk builds that box.
 *
 * They share it rather than each doing it because the answers have to agree. A login
 * that consulted the pidfiles and a statement that did not would leave a prompt
 * answering queries against a daemon the player has already stopped — and it is the
 * per-statement repeat of exactly this check that lets a stopped daemon drop a
 * session, since no session row exists to be invalidated instead.
 *
 * The filesystem is the box's REAL one: journal replayed over the seeded base, the
 * same tree `cat` shows. A door reading a locally regenerated baseline would refuse
 * an account the player can see sitting in the datadir, or serve a table they
 * already dropped.
 *
 * FOUR VANTAGES, one function. A port that addresses the hidden layer behind an inner
 * gateway resolves down the forward chain instead of on the caller's own LAN; a
 * PUBLIC address resolves through somebody else's access point to the occupant behind
 * a forward they opened; and a private address on the caller's own ESSID may belong to
 * a FELLOW OCCUPANT rather than to a generated sibling — but the rest, materialize,
 * boot-gate, is the daemon listening, is the same work in the same order. Routing here
 * rather than in a second pair of handlers is what keeps the login and every statement
 * behind it agreeing about the reach by construction.
 *
 * On the same WiFi there is no router, no NAT and no forward to pass through, so the
 * whole reach is the occupancy table: the caller must be ON the ESSID to reach anything
 * on it, the target must still be on it, and the address each of them answers to is the
 * LEASE the server issued. That is why `nmcli disconnect` is a defence here and nothing
 * like it is on the public path — occupancy IS the reach.
 *
 * The vantage is decided from the ADDRESS, server-side, never from anything the client
 * says about where it is standing. A public address names an access point rather than a
 * machine, so the port is the whole of how a box behind it is named at all — and a box
 * whose owner opened no forward has no name an outsider can say.
 */

import { generateHomeLan } from '../generation/generateHomeLan';
import { isPublicIp } from '../generation/ip';
import {
  resolvePublicTarget,
  type NatOccupantRow,
  type ResolvePublicTargetDeps,
} from '../network/resolvePublicTarget';
import { lanAddressesByOwner } from '../network/lanAddress';
import { materializeWorkstationFs } from '../network/materializeWorkstationFs';
import {
  resolveCrossPlayerSourceIp,
  type FindHomeNetworkByOwnerKey,
} from '../logging/crossPlayerSourceIp';
import { forwardsIntoDeepLayer, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { resolveInnerGatewayTarget } from '../network/resolveInnerGatewayTarget';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { canBoot } from '../boot/bootFiles';
import { readOpenPorts } from '../services/pidfile';
import type { Directory } from '../filesystem/types';

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

/** Everything reaching a host reads, and nothing that writes. Named as its own
 *  contract so a caller cannot hand this function a way to change the box it is only
 *  supposed to find — and built from the PUBLIC resolver's own dep set rather than a
 *  restatement of it, so a data door and `ssh` can never come to disagree about
 *  what resolving a public address takes. */
export type ServiceHostLookup = ResolvePublicTargetDeps & {
  /** The attacker's own network, for the address a cross-player line records. Their
   *  VERIFIED key resolves it; a defender's log is evidence, so nothing a client sends
   *  can reach it. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
};

export type ReachedServiceHost = {
  /** The box's own name, which through a forward only the server can know: a deep
   *  address is absent from the generated LAN, so the client cannot look it up. */
  readonly hostname: string;
  readonly machineId: string;
  /** The box's current filesystem — what the datadir and the pidfiles were read from,
   *  and what an accepted connection will be logged against. */
  readonly hostFs: Directory;
  /** The address the box SAW this request arrive from, when the route decides it: the
   *  fronting gateway's `.1`, because NAT is all a deep box is ever shown, or the
   *  attacker's own public address across the world. `null` on the caller's own LAN,
   *  where the address is the caller's and this seam is never told it — the one thing
   *  it must not invent. */
  readonly sourceIp: string | null;
  /** The key every row this door writes on the target lands under. The TARGET's once
   *  the box has an owner, so a defender's box keeps ONE datadir and ONE log however
   *  many attackers touch it, rather than a row each where the newest erases the rest.
   *  `null` on a box nobody owns, where the caller's own key is the only stable thing
   *  there is to write under. */
  readonly writerKey: string | null;
};

export type ServiceHostReach =
  | { readonly ok: true; readonly reached: ReachedServiceHost }
  | { readonly ok: false; readonly refusal: HandlerResponse };

const UNREACHABLE: HandlerResponse = { status: 404, body: { error: 'host_unreachable' } };

/** A box this door has to REPLAY to find: its journal read once, rebuilt into the
 *  tree the vantage's own baseline calls for, then opened. What differs between a
 *  generated sibling and a player's own box is only which baseline the rows land on,
 *  so both come through here and there is exactly ONE place a journal read can fail
 *  rather than one per vantage saying the same thing. The public vantage does not come
 *  through at all — only the server can know whose box is behind a stranger's forward,
 *  so it arrives already rebuilt. */
const openJournaledBox = async (
  deps: ServiceHostLookup,
  box: {
    readonly hostname: string;
    readonly machineId: string;
    readonly service: string;
    /** The rows made into a filesystem: over a seeded base for a generated box, over
     *  the owner's own identity for a player's. */
    readonly rebuild: (patches: readonly OwnerPatchRow[] | null) => Directory;
    readonly reachedPort: number;
    readonly sourceIp: string | null;
    readonly writerKey: string | null;
  },
): Promise<ServiceHostReach> => {
  const patches = await deps.findPatches({ machine_id: box.machineId });
  if (patches.error) {
    return { ok: false, refusal: { status: 500, body: { error: 'patches_lookup_failed' } } };
  }
  return openServiceOn({
    hostname: box.hostname,
    machineId: box.machineId,
    service: box.service,
    hostFs: box.rebuild(patches.data),
    reachedPort: box.reachedPort,
    sourceIp: box.sourceIp,
    writerKey: box.writerKey,
  });
};

/** A fellow occupant of the caller's own ESSID, and the address the caller answers to
 *  there. `null` for "nobody on this WiFi is at that address", which is not a refusal:
 *  the generated world is asked next, and it is what an own-LAN player normally
 *  reaches. */
type SameLanTarget = {
  readonly occupant: NatOccupantRow;
  /** The caller's LEASED address — what the target's log records for this attempt. It
   *  is read here rather than taken from the request because a defender's log is their
   *  evidence, and evidence a client can write is none. */
  readonly callerAddress: string;
};

type SameLanLookup =
  | { readonly ok: true; readonly target: SameLanTarget | null }
  | { readonly ok: false; readonly refusal: HandlerResponse };

/** Who, if anyone, is standing at that address on the caller's own WiFi.
 *
 *  The LAN boundary comes first: only a live occupant may reach a box on the ESSID, so
 *  a caller with no occupancy row is simply shown the generated world. The address is
 *  the LEASE rather than a derivation, self is excluded (your own box is the client's
 *  own-box path), and a real occupant wins an octet the generator also filled — the
 *  precedence `nmap`, `ssh` and `nc` already answer by.
 *
 *  A read that FAILS is a refusal rather than a fall-through: quietly dropping to the
 *  generated world would route a player's statements onto a seeded box standing where
 *  a real player is, and write their data to it. */
const resolveSameLanOccupant = async (
  deps: ServiceHostLookup,
  target: {
    readonly essid: string;
    readonly targetIp: string;
    readonly actorKey: string;
  },
): Promise<SameLanLookup> => {
  const occupants = await deps.listOccupantsByEssid(target.essid);
  if (occupants.error) {
    return { ok: false, refusal: { status: 500, body: { error: 'occupants_lookup_failed' } } };
  }
  const rows = occupants.data ?? [];
  if (!rows.some((row) => row.owner_key === target.actorKey)) return { ok: true, target: null };

  const leases = await deps.listLeasesByEssid(target.essid);
  if (leases.error) {
    return { ok: false, refusal: { status: 500, body: { error: 'leases_lookup_failed' } } };
  }
  const addresses = lanAddressesByOwner(target.essid, leases.data ?? []);
  const callerAddress = addresses.get(target.actorKey);
  const occupant = rows.find(
    (row) => row.owner_key !== target.actorKey && addresses.get(row.owner_key) === target.targetIp,
  );
  // An occupant holding no lease holds no address here, and a caller holding none has
  // no address to be logged at — either way there is nothing on this vantage to reach.
  return occupant === undefined || callerAddress === undefined
    ? { ok: true, target: null }
    : { ok: true, target: { occupant, callerAddress } };
};

/** Everything after "which box is it, and what is it right now": refuse it if it is
 *  dark, and refuse it unless the daemon asked for is the one on the port this request
 *  REACHED. Shared by every vantage so none can drift on the order or the refusals. */
const openServiceOn = (box: {
  readonly hostname: string;
  readonly machineId: string;
  /** Which daemon has to be the one holding the reached port. The ONE thing that
   *  differs between the doors that share this reach: everything above it — the four
   *  vantages, the boot gate, the journal replay — is the same work in the same order
   *  whether the caller is a database login or a key-value statement. */
  readonly service: string;
  readonly hostFs: Directory;
  readonly reachedPort: number;
  readonly sourceIp: string | null;
  readonly writerKey: string | null;
}): ServiceHostReach => {
  // A bricked box is dark before anything is asked of it, so a dead machine cannot
  // be probed for what it used to hold.
  if (!canBoot(box.hostFs).ok) return { ok: false, refusal: UNREACHABLE };

  // The pidfiles are the truth about what is listening — the same source `nmap`
  // reads. It must be THE NAMED DAEMON ON THE PORT REACHED: a forward to sshd is not a
  // door to the data behind it, and neither is a LAN box's own ssh port.
  const listening = readOpenPorts(box.hostFs).some(
    (open) => open.port === box.reachedPort && open.service === box.service,
  );
  if (!listening) {
    return { ok: false, refusal: { status: 404, body: { error: 'service_not_running' } } };
  }

  return {
    ok: true,
    reached: {
      hostname: box.hostname,
      machineId: box.machineId,
      hostFs: box.hostFs,
      sourceIp: box.sourceIp,
      writerKey: box.writerKey,
    },
  };
};

export const reachServiceHost = async (
  deps: ServiceHostLookup,
  target: {
    readonly essid: string;
    readonly targetIp: string;
    /** The daemon the caller is reaching for, as the pidfiles name it. Passed rather
     *  than assumed so a forward to sshd is never a door to somebody else's service. */
    readonly service: string;
    /** The port the request is addressed to. On an inner gateway a port other than its
     *  own sshd addresses the layer BEHIND it, which is the whole of how a hidden box
     *  is named at all — and on a public address it is the ONLY thing that names a box,
     *  since the address itself names an access point. */
    readonly port: number;
    /** The caller's VERIFIED key. Only ever used to resolve the address a cross-player
     *  line records for them, which is why it is a key rather than an address. */
    readonly actorKey: string;
  },
): Promise<ServiceHostReach> => {
  // A public address belongs to somebody else's access point, so the whole resolution
  // — which network, whose box behind which forward, is that box up and serving — is
  // the server's. It is the SAME resolver `ssh` and `hydra` authenticate through, so a
  // credential one of them earns is one this door then accepts.
  if (isPublicIp(target.targetIp)) {
    const resolved = await resolvePublicTarget(deps, {
      publicIp: target.targetIp,
      port: target.port,
    });
    if (!resolved.ok) {
      return { ok: false, refusal: { status: resolved.status, body: { error: resolved.error } } };
    }
    return openServiceOn({
      hostname: resolved.target.hostname,
      machineId: resolved.target.machineId,
      service: target.service,
      // Already rebuilt from the owner's identity plus their journal — one of the two
      // vantages the server resolves whole, because only it can know whose box it is.
      hostFs: resolved.target.fs,
      reachedPort: resolved.target.reachedPort,
      sourceIp: await resolveCrossPlayerSourceIp(deps.findHomeNetworkByOwnerKey, target.actorKey),
      writerKey: resolved.target.logWriterKey,
    });
  }

  // A private address on the caller's OWN ESSID may be a fellow occupant's box rather
  // than a generated sibling — checked BEFORE the generated world so a real player wins
  // an octet the generator also filled, and before the deep layer for the same reason:
  // a box somebody is standing on outranks the seeded router that used to be there.
  const sameLan = await resolveSameLanOccupant(deps, {
    essid: target.essid,
    targetIp: target.targetIp,
    actorKey: target.actorKey,
  });
  if (!sameLan.ok) return { ok: false, refusal: sameLan.refusal };
  if (sameLan.target !== null) {
    const { occupant, callerAddress } = sameLan.target;
    return openJournaledBox(deps, {
      hostname: occupant.workstation_machine_name,
      machineId: occupant.workstation_machine_id,
      service: target.service,
      rebuild: (patches) => materializeWorkstationFs(occupant, patches),
      reachedPort: target.port,
      // Nothing rewrote the source on the way in: the box really did see the caller's
      // own address on the WiFi they share.
      sourceIp: callerAddress,
      // The target's own key. Their box keeps ONE datadir and ONE log however many
      // neighbours touch it, rather than a row each where the newest erases the rest.
      writerKey: occupant.owner_key,
    });
  }

  if (forwardsIntoDeepLayer({ essid: target.essid, target: target.targetIp, port: target.port })) {
    const resolved = await resolveInnerGatewayTarget(deps, {
      essid: target.essid,
      target: target.targetIp,
      port: target.port,
    });
    if (!resolved.ok) {
      return { ok: false, refusal: { status: resolved.status, body: { error: resolved.error } } };
    }
    return openServiceOn({
      hostname: resolved.target.hostname,
      machineId: resolved.target.machineId,
      service: target.service,
      // The chain walk replayed this box's journal and boot-gated it, so the deep
      // vantage arrives materialized exactly as the public one does. Replaying it again
      // here would be a second read of the same rows to reach the same tree.
      hostFs: resolved.target.fs,
      reachedPort: resolved.target.reachedPort,
      sourceIp: resolved.target.sourceIp,
      // Nobody owns a generated box, so there is no key but the caller's to write under.
      writerKey: null,
    });
  }

  // Resolved on the caller's OWN regenerated LAN, which proves the address names a
  // reachable host rather than an arbitrary number, and yields what is needed to
  // rebuild its filesystem.
  const host = generateHomeLan(target.essid).hosts.find(
    (candidate) => candidate.ip === target.targetIp,
  );
  if (host === undefined) return { ok: false, refusal: UNREACHABLE };

  const { machineId, baseFs } = resolveLanHostIdentity(host, target.essid);
  return openJournaledBox(deps, {
    hostname: host.hostname,
    machineId,
    service: target.service,
    rebuild: (patches) => materializeMachineFs(baseFs, patches),
    reachedPort: target.port,
    // Never invented here. On the caller's own LAN the address the box saw is the
    // caller's, which only the caller can state.
    sourceIp: null,
    writerKey: null,
  });
};
