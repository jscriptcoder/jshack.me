/**
 * Reaching a box — and, for the doors that want one, reaching a box that serves a
 * NAMED DAEMON.
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
 * FOUR VANTAGES, one resolver. A port that addresses the hidden layer behind an inner
 * gateway resolves down the forward chain instead of on the caller's own LAN; a
 * PUBLIC address resolves through somebody else's access point to the occupant behind
 * a forward they opened; and a private address on the caller's own ESSID may belong to
 * a FELLOW OCCUPANT rather than to a generated sibling — but the rest, materialize,
 * boot-gate, is the same work in the same order. Routing here rather than in a second
 * pair of handlers is what keeps the login and every statement behind it agreeing
 * about the reach by construction.
 *
 * THE DAEMON CHECK SITS ABOVE THE REACH, not inside it. `reachBox` answers "which box
 * is at this address and port, and what is it right now"; `reachServiceHost` adds "and
 * the daemon holding that port had better be the one I asked for". Split because not
 * every door knows which daemon it wants: one that aims at a bare port and derives the
 * service from whatever answers there needs the same four vantages and must not get
 * them from a second copy — and a caller cannot be trusted to NAME the service, since
 * routing on a claim is exactly what the signed schema exists to prevent.
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

import { generateHomeLan } from '../generation/generateHomeLan.js';
import { isPublicIp } from '../generation/ip.js';
import {
  resolvePublicTarget,
  type NatOccupantRow,
  type ResolvePublicTargetDeps,
} from '../network/resolvePublicTarget.js';
import { lanAddressesByOwner } from '../network/lanAddress.js';
import { materializeWorkstationFs } from '../network/materializeWorkstationFs.js';
import {
  resolveVantageSourceIp,
  type FindHomeNetworkByOwnerKey,
  type FindPublicIpByEssid,
} from '../logging/crossPlayerSourceIp.js';
import {
  chainGatewayBaseFs,
  forwardsIntoDeepLayer,
  resolveLanHostIdentity,
} from '../generation/lanHostIdentity.js';
import { segmentsReachedFrom } from '../generation/lanTopology.js';
import { deniedPortsFor, resolveDeepScanHosts } from '../scan/deepScanHosts.js';
import { resolveInnerGatewayTarget } from '../network/resolveInnerGatewayTarget.js';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs.js';
import { canBoot } from '../boot/bootFiles.js';
import { portsOpenToNetwork } from '../network/portsOpenToNetwork.js';
import { frontedSegment } from '../network/frontedSegment.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import { LOOPBACK_IPV4 } from '../network/interfaces.js';
import type { Directory } from '../filesystem/types.js';

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
  /** The attacker's own network, for the address a cross-player line records when they
   *  operate from their own workstation. Their VERIFIED key resolves it; a defender's log
   *  is evidence, so nothing a client sends can reach it. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
  /** One network's public address, by ESSID — the address a public reach FROM A HOP is
   *  seen at, because an actor operating from a box on that network goes out through ITS
   *  access point rather than their own. Keyed on the network they stand on (server-derived
   *  from the session), not on who owns it, which is the whole of how a hop masks the
   *  origin on the public path the same way it does on the LAN. */
  readonly findPublicIpByEssid: FindPublicIpByEssid;
};

export type ReachedServiceHost = {
  /** The network this box was GENERATED under — the one a later read or write
   *  regenerates it from, and the network a session minted here stands on. On the
   *  caller's own LAN and down their own gateway it is the ESSID the request carried;
   *  at a PUBLIC address it is the TARGET's own network, a different one the client has
   *  no way to name, which only the resolver knows. */
  readonly essid: string;
  /** The box's own name, which through a forward only the server can know: a deep
   *  address is absent from the generated LAN, so the client cannot look it up. */
  readonly hostname: string;
  readonly machineId: string;
  /** The box's current filesystem — what the datadir and the pidfiles were read from,
   *  and what an accepted connection will be logged against. */
  readonly hostFs: Directory;
  /** The address this box answers to FROM WHERE THE CALLER STANDS: the address typed on
   *  the caller's own LAN and across the world, and the box's own address on its deep
   *  subnet when a forward carried the request down to it. A door that wants to report
   *  which box it is talking to must read this rather than the request, which through a
   *  forward names the gateway and not the box behind it. */
  readonly localIp: string;
  /** The address the box SAW this request arrive from, when the route decides it: the
   *  fronting gateway's `.1`, because NAT is all a deep box is ever shown, or the
   *  attacker's own public address across the world. `null` on the caller's own LAN,
   *  where the address is the caller's and this seam is never told it — the one thing
   *  it must not invent. */
  readonly sourceIp: string | null;
  /** The key every row this door writes on the target lands under. The TARGET's once
   *  the box has an owner, so a defender's box keeps ONE datadir and ONE log however
   *  many attackers touch it, rather than a row each where the newest erases the rest.
   *
   *  A box nobody owns takes the ESSID's own stable key for the same reason: it is
   *  regenerated from the ESSID and shared by every occupant, so the caller's key would
   *  be stable for one player and different for the next, and a row per caller means the
   *  newest wins outright on replay. */
  readonly writerKey: string;
  /** The `/24` this box's forwards may point INTO, or `null` for a box that fronts no
   *  network at all — which is a REASON to refuse a NAT rule, never missing information.
   *
   *  Answered here because the vantage is the only thing that knows. The ESSID arriving
   *  with a request is the one the CALLER's card is associated with, so a door deriving
   *  the bound from it judges somebody else's router by the attacker's own network: every
   *  address inside the LAN under attack falls outside a subnet drawn for somewhere else,
   *  and the refusal names the right address for a reason that is not true. */
  readonly frontedSegment: string | null;
};

/** A reached box before any daemon has been asked for, which is the same box plus the
 *  one fact only the route knows. */
export type ReachedBox = ReachedServiceHost & {
  /** The port ON THE TARGET this request actually arrived at — the far side of a NAT
   *  forward rather than the port dialled, which through a forward are different
   *  numbers. A caller that means to name the daemon answering here must check it
   *  against THIS, or a forward to one daemon becomes a door to every daemon.
   *
   *  Deliberately absent from `ReachedServiceHost`: the doors that name a daemon have
   *  already had this checked for them, and handing it back would invite a second,
   *  looser check beside the one that already passed. */
  readonly reachedPort: number;
  /** The ports a switch fronting this box's layer drops, read off its live ACL — empty
   *  for every box reached any other way. A deep box behind a switch answers the network
   *  only on the ports the ACL lets through, so a daemon on a denied port is as
   *  unreachable here as a stopped one. Consumed by `reachServiceHost` and never handed
   *  on: the port has been judged by the time a door sees the box. */
  readonly deniedPorts: ReadonlySet<number>;
};

export type ServiceHostReach =
  | { readonly ok: true; readonly reached: ReachedServiceHost }
  | { readonly ok: false; readonly refusal: HandlerResponse };

export type BoxReach =
  | { readonly ok: true; readonly reached: ReachedBox }
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
    readonly essid: string;
    readonly hostname: string;
    readonly machineId: string;
    /** The rows made into a filesystem: over a seeded base for a generated box, over
     *  the owner's own identity for a player's. */
    readonly rebuild: (patches: readonly OwnerPatchRow[] | null) => Directory;
    readonly localIp: string;
    readonly reachedPort: number;
    readonly sourceIp: string | null;
    readonly writerKey: string;
    readonly frontedSegment: string | null;
    /** The switch ACL in front of this box, when it sits on a deep layer; empty for a
     *  box on the caller's own LAN, which no switch fronts. */
    readonly deniedPorts?: ReadonlySet<number>;
  },
): Promise<BoxReach> => {
  const patches = await deps.findPatches({ machine_id: box.machineId });
  if (patches.error) {
    return { ok: false, refusal: { status: 500, body: { error: 'patches_lookup_failed' } } };
  }
  return openBox({
    essid: box.essid,
    hostname: box.hostname,
    machineId: box.machineId,
    hostFs: box.rebuild(patches.data),
    localIp: box.localIp,
    reachedPort: box.reachedPort,
    sourceIp: box.sourceIp,
    writerKey: box.writerKey,
    frontedSegment: box.frontedSegment,
    deniedPorts: box.deniedPorts ?? new Set(),
  });
};

/** A fellow occupant of the caller's own ESSID, and the address the caller answers to
 *  there. `null` for "nobody on this WiFi is at that address", which is not a refusal:
 *  the generated world is asked next, and it is what an own-LAN player normally
 *  reaches. */
export type SameLanTarget = {
  readonly occupant: NatOccupantRow;
  /** The caller's LEASED address — what the target's log records for this attempt. It
   *  is read here rather than taken from the request because a defender's log is their
   *  evidence, and evidence a client can write is none. */
  readonly callerAddress: string;
};

type SameLanLookup =
  | { readonly ok: true; readonly target: SameLanTarget | null }
  | { readonly ok: false; readonly refusal: HandlerResponse };

/** Just the two occupancy reads placing a neighbour takes — narrower than the full
 *  lookup on purpose. A caller that only has to find who is standing at an address on a
 *  shared WiFi (the exploit door) should not have to carry the public-address resolvers
 *  a data door needs to reach across the world. */
export type SameLanLookupDeps = Pick<
  ServiceHostLookup,
  'listOccupantsByEssid' | 'listLeasesByEssid'
>;

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
export const resolveSameLanOccupant = async (
  deps: SameLanLookupDeps,
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

/** Everything after "which box is it": refuse it if it is dark. Shared by every vantage
 *  so none can drift on the order or the refusals. */
const openBox = (box: ReachedBox): BoxReach => {
  // A bricked box is dark before anything is asked of it, so a dead machine cannot
  // be probed for what it used to hold.
  if (!canBoot(box.hostFs).ok) return { ok: false, refusal: UNREACHABLE };

  return { ok: true, reached: box };
};

/**
 * Which box is at this address and port, and what it is right now — the four vantages
 * and the boot gate, with no opinion about what is listening.
 *
 * A door that knows which daemon it wants goes through `reachServiceHost` instead. This
 * is the shape for the one that does not: a bare port, find whatever answers there,
 * derive the service from it.
 */
export const reachBox = async (
  deps: ServiceHostLookup,
  target: {
    /** The network the caller STANDS on, derived server-side from their session — never
     *  the essid the client claimed. Every box below is regenerated from it, so a hop
     *  onto another network reaches that network's boxes and not the player's home. */
    readonly essid: string;
    readonly targetIp: string;
    /** The port the request is addressed to. On an inner gateway a port other than its
     *  own sshd addresses the layer BEHIND it, which is the whole of how a hidden box
     *  is named at all — and on a public address it is the ONLY thing that names a box,
     *  since the address itself names an access point. */
    readonly port: number;
    /** The box the caller is standing on, or `undefined` for their own workstation at
     *  home. Lets the reach find a deep layer the box reaches (`segmentsReachedFrom`) and
     *  resolve `localhost` to the box itself — the hop's own daemon rather than the
     *  player's. */
    readonly callerMachineId: string | undefined;
    /** The address the caller's standing box is seen at on `essid`: its LAN lease at
     *  home, the hop's own LAN address on a hop, `null` for a box the network cannot
     *  place. What a box on this LAN records a connection from — derived here, never a
     *  claim. */
    readonly ownLanSourceIp: string | null;
    /** The caller's VERIFIED key. Only ever used to resolve the address a cross-player
     *  line records for them, which is why it is a key rather than an address. */
    readonly actorKey: string;
  },
): Promise<BoxReach> => {
  // `localhost` names the box the shell stands ON — the hop's own daemon, reached by the
  // address it holds on the network it stands on. The daemon it answers sees the request
  // come over loopback, so that is what a line records however the box is placed on the
  // LAN. A hop the server cannot place at an address has no box for loopback to name.
  const loopback = target.targetIp === LOOPBACK_IPV4;
  const address = loopback ? target.ownLanSourceIp : target.targetIp;
  if (address === null) {
    return { ok: false, refusal: UNREACHABLE };
  }
  // Loopback is the box's own address, so the line says the visit came over loopback
  // rather than from the box's place on the LAN; everywhere else the source is the
  // address the route left (null until an arm fills it from the vantage).
  const loopbackSource = loopback ? LOOPBACK_IPV4 : null;

  // A public address belongs to somebody else's access point, so the whole resolution
  // — which network, whose box behind which forward, is that box up — is the server's.
  // It is the SAME resolver `ssh` and `hydra` authenticate through, so a credential one
  // of them earns is one this door then accepts.
  if (isPublicIp(address)) {
    const resolved = await resolvePublicTarget(deps, {
      publicIp: address,
      port: target.port,
    });
    if (!resolved.ok) {
      return { ok: false, refusal: { status: resolved.status, body: { error: resolved.error } } };
    }
    return openBox({
      // The TARGET's own network, not the WiFi the request travelled with: a public
      // address reaches somebody else's access point, and this is the ESSID a later read
      // or write regenerates the box from, and that a session minted here stands on.
      essid: resolved.target.essid,
      hostname: resolved.target.hostname,
      machineId: resolved.target.machineId,
      // Already rebuilt from the owner's identity plus their journal — one of the two
      // vantages the server resolves whole, because only it can know whose box it is.
      hostFs: resolved.target.fs,
      // The public address IS what this box answers to from outside. Handing back its
      // internal one would tell a stranger the shape of a LAN they have not reached.
      localIp: address,
      reachedPort: resolved.target.reachedPort,
      // The address the far box records this reach from. From a hop it is the HOP
      // network's public address — the access point the request actually left through —
      // and from the player's own workstation it is their home network's, resolved from
      // their verified key. Standing on a box (`callerMachineId`) is the one thing that
      // tells the two apart, and the network they stand on is server-derived, never a
      // claim. This is the seam `crossPlayerSourceIp` promised the pivot would move.
      sourceIp: await resolveVantageSourceIp(deps, {
        actorKey: target.actorKey,
        standingEssid: target.callerMachineId === undefined ? null : target.essid,
      }),
      writerKey: resolved.target.logWriterKey,
      // The access point's own, resolved from ITS essid on the way in. The one the
      // request carried names the caller's network and decides nothing here.
      frontedSegment: resolved.target.frontedSegment,
      deniedPorts: new Set(),
    });
  }

  // A private address on the caller's OWN ESSID may be a fellow occupant's box rather
  // than a generated sibling — checked BEFORE the generated world so a real player wins
  // an octet the generator also filled, and before the deep layer for the same reason:
  // a box somebody is standing on outranks the seeded router that used to be there.
  const sameLan = await resolveSameLanOccupant(deps, {
    essid: target.essid,
    targetIp: address,
    actorKey: target.actorKey,
  });
  if (!sameLan.ok) return { ok: false, refusal: sameLan.refusal };
  if (sameLan.target !== null) {
    const { occupant } = sameLan.target;
    return openJournaledBox(deps, {
      // A fellow occupant of the caller's own WiFi — the same network the request carried.
      essid: target.essid,
      hostname: occupant.workstation_machine_name,
      machineId: occupant.workstation_machine_id,
      rebuild: (patches) => materializeWorkstationFs(occupant, patches),
      localIp: address,
      reachedPort: target.port,
      // The address the caller's standing box is seen at on this LAN — their own lease
      // at home, the hop's address on a hop — derived from the vantage, never claimed.
      sourceIp: loopbackSource ?? target.ownLanSourceIp,
      // The target's own key. Their box keeps ONE datadir and ONE log however many
      // neighbours touch it, rather than a row each where the newest erases the rest.
      writerKey: occupant.owner_key,
      // A fellow occupant's workstation stands on the WiFi and fronts nothing behind it.
      frontedSegment: null,
    });
  }

  if (forwardsIntoDeepLayer({ essid: target.essid, target: address, port: target.port })) {
    const resolved = await resolveInnerGatewayTarget(deps, {
      essid: target.essid,
      target: address,
      port: target.port,
    });
    if (!resolved.ok) {
      return { ok: false, refusal: { status: resolved.status, body: { error: resolved.error } } };
    }
    return openBox({
      // A deep box hangs off the caller's OWN gateway, so it is generated under the
      // ESSID the request carried.
      essid: target.essid,
      hostname: resolved.target.hostname,
      machineId: resolved.target.machineId,
      // The chain walk replayed this box's journal and boot-gated it, so the deep
      // vantage arrives materialized exactly as the public one does. Replaying it again
      // here would be a second read of the same rows to reach the same tree.
      hostFs: resolved.target.fs,
      localIp: resolved.target.localIp,
      reachedPort: resolved.target.reachedPort,
      sourceIp: resolved.target.sourceIp,
      // Nobody OWNS a deep box, but the whole chain is regenerated from the ESSID and
      // every occupant walks the same one, so the caller's own key would give each
      // attacker a row of their own for one path — and the newest wins outright on
      // replay, erasing whoever came before.
      writerKey: apGatewayLogWriterKey(target.essid),
      // The layer behind the box the chain walk stopped on, which only the walk knows.
      frontedSegment: resolved.target.frontedSegment,
      deniedPorts: new Set(),
    });
  }

  // Resolved on the caller's OWN regenerated LAN, which proves the address names a
  // reachable host rather than an arbitrary number, and yields what is needed to
  // rebuild its filesystem.
  const host = generateHomeLan(target.essid).hosts.find((candidate) => candidate.ip === address);
  if (host !== undefined) {
    const { machineId, baseFs } = resolveLanHostIdentity(host, target.essid);
    return openJournaledBox(deps, {
      // A generated box on the caller's own LAN, under the ESSID the request carried.
      essid: target.essid,
      hostname: host.hostname,
      machineId,
      rebuild: (patches) => materializeMachineFs(baseFs, patches),
      localIp: address,
      reachedPort: target.port,
      // The address the caller's standing box is seen at on this LAN, derived from the
      // vantage — their own lease at home, the hop's address on a hop. Loopback records
      // the box's own daemon seeing a local visit.
      sourceIp: loopbackSource ?? target.ownLanSourceIp,
      // Every box on this LAN belongs to the access point or to the generator, never to a
      // player, and every occupant of the ESSID reaches the identical one: a box may not
      // keep two logs, because a row per writer means the newest wins outright on replay.
      // The gateway is the sharpest case, reachable from INSIDE as well as from the world,
      // so an occupant walking their own gateway would erase the lines a stranger's visit
      // left there — but a generated sibling shares its id across the ESSID the same way,
      // and so takes the same key.
      writerKey: apGatewayLogWriterKey(target.essid),
      // The caller's own ESSID genuinely IS this box's network here, so the derivation the
      // set door used to make is correct at this vantage — and only at this one.
      frontedSegment: frontedSegment({ essid: target.essid, machineId, kind: host.kind }),
    });
  }

  // Not on the LAN and not behind a forward the caller typed — but a box on a DEEP
  // LAYER the shell reaches, named by its own address there. The same lookup `nmap` and
  // the deep-layer ssh login resolve a layer through, so a door opens on a deep box
  // exactly where a scan from the same shell drew one. A switch fronting the layer drops
  // the ports its live ACL denies; a router filters nothing, so its journal is never
  // read.
  const deep = await reachDeepLayerBox(deps, {
    essid: target.essid,
    callerMachineId: target.callerMachineId,
    address,
    port: target.port,
    loopbackSource,
  });
  return deep ?? { ok: false, refusal: UNREACHABLE };
};

/** The box at `address` on a deep layer the caller's standing box reaches, journal
 *  replayed so a door reads its live datadir, or `null` when no reached layer carries
 *  it. A switch fronting the layer applies its live ACL; a read failure there surfaces
 *  as a 500 rather than a silently open port. */
const reachDeepLayerBox = async (
  deps: ServiceHostLookup,
  target: {
    readonly essid: string;
    readonly callerMachineId: string | undefined;
    readonly address: string;
    readonly port: number;
    readonly loopbackSource: string | null;
  },
): Promise<BoxReach | null> => {
  if (target.callerMachineId === undefined) return null;
  for (const segment of segmentsReachedFrom(target.essid, target.callerMachineId) ?? []) {
    const { fronting } = segment;
    if (fronting === null) continue;
    let frontingFs = chainGatewayBaseFs(target.essid, fronting);
    if (fronting.host.kind === 'switch') {
      const patches = await deps.findPatches({ machine_id: fronting.machineId });
      if (patches.error) {
        return { ok: false, refusal: { status: 500, body: { error: 'patches_lookup_failed' } } };
      }
      frontingFs = materializeMachineFs(frontingFs, patches.data);
    }
    const onLayer = resolveDeepScanHosts(target.essid, fronting, frontingFs).hosts.find(
      (entry) => entry.host.ip === target.address,
    );
    if (onLayer === undefined) continue;
    return openJournaledBox(deps, {
      // A deep layer hangs off the caller's OWN gateway chain, so its boxes are
      // generated under the ESSID the request carried.
      essid: target.essid,
      hostname: onLayer.host.hostname,
      machineId: onLayer.machineId,
      rebuild: (patches) => materializeMachineFs(onLayer.baseFs, patches),
      localIp: target.address,
      reachedPort: target.port,
      // A box on a layer is seen there at the address the caller's box holds on it — the
      // gateway's `.1` on the way down — unless the request came over loopback.
      sourceIp: target.loopbackSource ?? segment.address,
      // Nobody owns a deep NPC box, and every occupant walks the identical chain, so its
      // log accretes under the network's own key.
      writerKey: apGatewayLogWriterKey(target.essid),
      // A deep host fronts nothing behind it.
      frontedSegment: null,
      // Only the switch's live ACL shapes what the network can reach here.
      deniedPorts: deniedPortsFor(fronting, frontingFs),
    });
  }
  return null;
};

export const reachServiceHost = async (
  deps: ServiceHostLookup,
  target: {
    readonly essid: string;
    readonly targetIp: string;
    /** The box the caller is standing on, forwarded so the reach can find a deep layer
     *  it reaches and resolve `localhost` to it. `undefined` is their own workstation. */
    readonly callerMachineId: string | undefined;
    /** The address that box is seen at on `essid`, server-derived from the vantage —
     *  what a connection on this LAN is recorded from. */
    readonly ownLanSourceIp: string | null;
    /** The daemon the caller is reaching for, as the pidfiles name it. Passed rather
     *  than assumed so a forward to sshd is never a door to somebody else's service. */
    readonly service: string;
    readonly port: number;
    readonly actorKey: string;
  },
): Promise<ServiceHostReach> => {
  const reach = await reachBox(deps, {
    essid: target.essid,
    targetIp: target.targetIp,
    port: target.port,
    callerMachineId: target.callerMachineId,
    ownLanSourceIp: target.ownLanSourceIp,
    actorKey: target.actorKey,
  });
  if (!reach.ok) return { ok: false, refusal: reach.refusal };

  // The pidfiles are the truth about what is listening — the same source `nmap`
  // reads — less whatever the box's own filter refuses the network, and less the ports
  // a switch fronting a deep layer denies. It must be THE NAMED DAEMON ON THE PORT
  // REACHED: a forward to sshd is not a door to the data behind it, and neither is a
  // LAN box's own ssh port.
  //
  // EVERY vantage the reach serves is a remote one, which is what makes a filtered
  // port unreachable from the world, from a neighbour and from down a forward with one
  // check rather than four. The owner's own box never arrives here at all: it is
  // answered on the client, so a filter can never lock them out of their own service.
  //
  // Filtered reads as `service_not_running`, word for word what an unserved port gives.
  // A refusal of its own would be an oracle telling a scanner which ports are worth
  // attacking.
  const listening = portsOpenToNetwork(reach.reached.hostFs).some(
    (open) =>
      open.port === reach.reached.reachedPort &&
      open.service === target.service &&
      !reach.reached.deniedPorts.has(open.port),
  );
  if (!listening) {
    return { ok: false, refusal: { status: 404, body: { error: 'service_not_running' } } };
  }

  // Rebuilt field by field rather than passed through, so `reachedPort` cannot leak
  // into a contract six doors already depend on: they have had the port checked for
  // them, and handing it back would invite a second, looser check beside the one that
  // already passed.
  return {
    ok: true,
    reached: {
      essid: reach.reached.essid,
      hostname: reach.reached.hostname,
      machineId: reach.reached.machineId,
      hostFs: reach.reached.hostFs,
      localIp: reach.reached.localIp,
      sourceIp: reach.reached.sourceIp,
      writerKey: reach.reached.writerKey,
      frontedSegment: reach.reached.frontedSegment,
    },
  };
};
