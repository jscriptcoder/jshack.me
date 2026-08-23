/**
 * Reaching a box that serves a database, before anything is asked of it.
 *
 * Both database doors — the login and every statement behind it — have to establish
 * the same four things first: that the address names a real host on the caller's own
 * LAN, that the box boots, that mysqld is actually listening, and what the box's
 * filesystem currently IS. Only then is there something to authenticate against.
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
 * THREE VANTAGES, one function. A port that addresses the hidden layer behind an inner
 * gateway resolves down the forward chain instead of on the caller's own LAN, and a
 * PUBLIC address resolves through somebody else's access point to the occupant behind
 * a forward they opened — but the rest, materialize, boot-gate, is the daemon
 * listening, is the same work in the same order. Routing here rather than in a second
 * pair of handlers is what keeps the login and every statement behind it agreeing
 * about the reach by construction.
 *
 * The vantage is decided from the ADDRESS, server-side, never from anything the client
 * says about where it is standing. A public address names an access point rather than a
 * machine, so the port is the whole of how a box behind it is named at all — and a box
 * whose owner opened no forward has no name an outsider can say.
 *
 * The chain resolver hands back the deep box's SEEDED tree: it replays each gateway's
 * journal to read the forward table, but the box at the end of the chain is the one hop
 * whose own journal nothing reads. That is survivable for a door that authenticates
 * against seeded accounts and fatal for one that answers with DATA — a change written
 * here would persist and never be read back — so this materializes on top of what the
 * resolver returned. The gap itself is the resolver's to close for every door at once.
 */

import { generateHomeLan } from '../generation/generateHomeLan';
import { isPublicIp } from '../generation/ip';
import {
  resolvePublicTarget,
  type ResolvePublicTargetDeps,
} from '../network/resolvePublicTarget';
import {
  resolveCrossPlayerSourceIp,
  type FindHomeNetworkByOwnerKey,
} from '../logging/crossPlayerSourceIp';
import { forwardsIntoDeepLayer, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { resolveInnerGatewayTarget } from '../network/resolveInnerGatewayTarget';
import { materializeMachineFs } from '../network/materializeMachineFs';
import { canBoot } from '../boot/bootFiles';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { Directory } from '../filesystem/types';

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

/** Everything reaching a host reads, and nothing that writes. Named as its own
 *  contract so a caller cannot hand this function a way to change the box it is only
 *  supposed to find — and built from the PUBLIC resolver's own dep set rather than a
 *  restatement of it, so the database door and `ssh` can never come to disagree about
 *  what resolving a public address takes. */
export type MysqlHostLookup = ResolvePublicTargetDeps & {
  /** The attacker's own network, for the address a cross-player line records. Their
   *  VERIFIED key resolves it; a defender's log is evidence, so nothing a client sends
   *  can reach it. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
};

export type ReachedMysqlHost = {
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

export type MysqlHostReach =
  | { readonly ok: true; readonly reached: ReachedMysqlHost }
  | { readonly ok: false; readonly refusal: HandlerResponse };

const UNREACHABLE: HandlerResponse = { status: 404, body: { error: 'host_unreachable' } };

/** A box this door had to GENERATE to find: its seeded base with its own journal
 *  replayed over it, then opened. The public vantage does not come through here — only
 *  the server can know whose box is behind a stranger's forward, so it arrives already
 *  rebuilt from its owner's identity — which leaves exactly ONE place a journal read
 *  can fail, rather than one per vantage saying the same thing. */
const openGeneratedBox = async (
  deps: MysqlHostLookup,
  box: {
    readonly hostname: string;
    readonly machineId: string;
    readonly baseFs: Directory;
    readonly reachedPort: number;
    readonly sourceIp: string | null;
  },
): Promise<MysqlHostReach> => {
  const patches = await deps.findPatches({ machine_id: box.machineId });
  if (patches.error) {
    return { ok: false, refusal: { status: 500, body: { error: 'patches_lookup_failed' } } };
  }
  return openDatabaseOn({
    ...box,
    hostFs: materializeMachineFs(box.baseFs, patches.data),
    // Nobody owns a generated box, so there is no key but the caller's to write under.
    writerKey: null,
  });
};

/** Everything after "which box is it, and what is it right now": refuse it if it is
 *  dark, and refuse it unless mysqld is the daemon on the port this request REACHED.
 *  Shared by every vantage so none can drift on the order or the refusals. */
const openDatabaseOn = (box: {
  readonly hostname: string;
  readonly machineId: string;
  readonly hostFs: Directory;
  readonly reachedPort: number;
  readonly sourceIp: string | null;
  readonly writerKey: string | null;
}): MysqlHostReach => {
  // A bricked box is dark before anything is asked of it, so a dead machine cannot
  // be probed for which database accounts it used to have.
  if (!canBoot(box.hostFs).ok) return { ok: false, refusal: UNREACHABLE };

  // The pidfiles are the truth about what is listening — the same source `nmap`
  // reads. It must be mysqld ON THE PORT REACHED: a forward to sshd is not a door to
  // the database, and neither is a LAN box's own ssh port.
  const listening = readOpenPorts(box.hostFs).some(
    (open) => open.port === box.reachedPort && open.service === SERVICE_CATALOG.mysql.service,
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

export const reachMysqlHost = async (
  deps: MysqlHostLookup,
  target: {
    readonly essid: string;
    readonly targetIp: string;
    /** The port the request is addressed to. On an inner gateway a port other than its
     *  own sshd addresses the layer BEHIND it, which is the whole of how a hidden box
     *  is named at all — and on a public address it is the ONLY thing that names a box,
     *  since the address itself names an access point. */
    readonly port: number;
    /** The caller's VERIFIED key. Only ever used to resolve the address a cross-player
     *  line records for them, which is why it is a key rather than an address. */
    readonly actorKey: string;
  },
): Promise<MysqlHostReach> => {
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
    return openDatabaseOn({
      hostname: resolved.target.hostname,
      machineId: resolved.target.machineId,
      // Already rebuilt from the owner's identity plus their journal — the one vantage
      // that arrives materialized, because only the server can know whose box it is.
      hostFs: resolved.target.fs,
      reachedPort: resolved.target.reachedPort,
      sourceIp: await resolveCrossPlayerSourceIp(deps.findHomeNetworkByOwnerKey, target.actorKey),
      writerKey: resolved.target.logWriterKey,
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
    return openGeneratedBox(deps, {
      hostname: resolved.target.hostname,
      machineId: resolved.target.machineId,
      baseFs: resolved.target.fs,
      reachedPort: resolved.target.reachedPort,
      sourceIp: resolved.target.sourceIp,
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
  return openGeneratedBox(deps, {
    hostname: host.hostname,
    machineId,
    baseFs,
    reachedPort: target.port,
    // Never invented here. On the caller's own LAN the address the box saw is the
    // caller's, which only the caller can state.
    sourceIp: null,
  });
};
