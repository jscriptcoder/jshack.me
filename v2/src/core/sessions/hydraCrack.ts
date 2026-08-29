/**
 * handleHydraCrack — the server-side credential sweep behind the `hydra` command.
 *
 * It answers one question: which of this host's accounts have a password that
 * appears in YOUR wordlist? Everything about where that answer comes from is
 * deliberate.
 *
 * SERVER-side, from the same `/etc/passwd` `ssh` validates against, resolved the
 * same way (regenerate the LAN, resolve the host, replay its journal). A hydra
 * that read a locally regenerated baseline would go stale the moment anyone
 * patched the passwd, and would hand the player a credential `ssh` then rejects —
 * which reads as a broken game, not a stale cache.
 *
 * The wordlist is read from the JOURNAL of the machine the caller is standing on,
 * never from the request. The list is the whole mechanic — membership in it is
 * what makes a password crackable — so accepting it as a client claim would let
 * one unlogged request carry a pool recovered from the shipped bundle. Read from
 * the journal, growing your coverage means really writing to a box, which is the
 * in-game action the mechanic is built around.
 *
 * That read is MACHINE-scoped, not writer-scoped: a file belongs to the box it is
 * on, so the list the tools use is the one the last writer left there, whoever
 * that was — the same rule `cat` gets from the materialized tree. Anything else
 * would let a player read a wordlist plainly present on their screen while the
 * tool insisted there was none. The wordlist exists ONLY as a patch (apt wrote it;
 * no base filesystem carries it), so the winning row IS the file, and a deletion
 * row is the file being gone.
 *
 * Reachability mirrors `authCreateSession` exactly — unknown host, bricked box,
 * service not listening — so a dead machine is dark to every tool rather than
 * just to logins. Including WHO is at the address: a fellow occupant of the same
 * WiFi is a real box at a real lease, and it outranks the generated sibling the
 * seed put on that octet. That merge is the target RESOLUTION's rather than any
 * one service's, so every door in the catalog reaches a neighbour — a tool that
 * answered by a different rule depending on the service named would be worse than
 * one that could not reach them at all.
 *
 * The attempt is TRACED on the target, one `auth.log` line per password tried
 * rather than one per account. The volume is the behaviour: a sweep is the
 * noisiest thing a player can do to a box, and a defender who reads it back must
 * see that. It also prices the attack — the visible cost is what an offline
 * cracker buys its way out of later. Nothing is written when nothing was
 * attempted: a refused, dead or serviceless target must not be probeable through
 * its own log.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { machineIdForLanHost, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { materializeWorkstationFs } from '../network/materializeWorkstationFs';
import { lanAddressesByOwner, type LanLeaseRow } from '../network/lanAddress';
import type { NatOccupantRow } from '../network/resolvePublicTarget';
import type { Directory } from '../filesystem/types';
import { canBoot } from '../boot/bootFiles';
import { isOwnWorkstation } from '../identity/workstation';
import {
  authorizeMachineAccess,
  type FindActiveSession,
} from '../patches/authorizeMachineAccess';
import { portsOpenToNetwork } from '../network/portsOpenToNetwork';
import { WORDLIST_PATH } from '../wordlist/defaultWordlist';
import { serviceByName, type SweepLog } from '../services/serviceCatalog';
import { sweepAccounts, wordlistOn } from '../wordlist/passwordSweep';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog';
import type { ListPathPatchesResult } from '../patches/upsertPatch';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

export type HydraCrackDeps = {
  readonly nonceStore: NonceStore;
  /** Whether the caller currently holds a session on the machine they say they
   *  are standing on — the L1 rule shared with the patch endpoints, so hydra and
   *  a write from the same shell cannot disagree about where the player is. */
  readonly findActiveSession: FindActiveSession;
  /** The server's wall clock, epoch-ms (UTC) — stamps the sweep's auth.log lines.
   *  One sweep is one attack, so every line in it carries the same stamp. */
  readonly now: () => number;
  /** The TARGET host's journal, replayed over its seeded base so the sweep reads
   *  the box's real `/etc/passwd` and its real running services. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  /** Who is currently ON the ESSID. Occupancy is what makes a fellow player's box
   *  present at all here — and it gates itself: only an occupant may sweep the LAN
   *  they are on. The same read `nmap` and the same-LAN login resolve through. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly NatOccupantRow[] | null; readonly error: unknown }>;
  /** Every lease held on this ESSID, in ONE read: which occupant answers to the
   *  address swept, and the address the trace is stamped with. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
  /** Every writer's rows at the wordlist path on the machine the caller is
   *  standing on. Machine-scoped, exactly like the read behind a save's
   *  base-content check: the file belongs to the box, not to whoever wrote it
   *  last. The handler picks the row a reader materializes. */
  readonly listPathPatches: (query: {
    readonly machine_id: string;
    readonly path: string;
  }) => Promise<ListPathPatchesResult>;
  /** The TARGET's current auth.log content — the read half of the system-written
   *  trace, so a sweep appends to the box's history instead of replacing it. */
  readonly readAuthLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the whole sweep, appended to the target's auth.log). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields (action/ts/nonce) pass through; the refine rejects a
// client-supplied player_key (the server stamps it from the verified signature).
// `username` is optional: absent means sweep every account the box has.
const hydraCrackSchema = z
  .looseObject({
    action: z.literal('hydraCrack'),
    essid: z.string().min(1),
    target_ip: z.string().min(1),
    service: z.string().min(1),
    username: z.string().min(1).optional(),
    caller_machine_id: z.string().min(1),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** Land the whole sweep on the target's auth.log as ONE append — a per-line write
 *  would re-read and re-upsert the entire log for every password tried. Same
 *  system-log seam `ssh` uses, and best-effort for the same reason: a logging
 *  failure must never swallow an attack that really happened. */
const recordSweep = async (
  deps: HydraCrackDeps,
  target: { readonly writerKey: string; readonly machineId: string; readonly sweepLog: SweepLog },
  trace: readonly string[],
): Promise<void> => {
  try {
    await appendMachineLog(
      { readLog: deps.readAuthLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: target.writerKey,
        machineId: target.machineId,
        path: target.sweepLog.path,
        owner: target.sweepLog.owner,
        permissions: target.sweepLog.permissions,
      },
      trace.join('\n'),
    );
  } catch {
    // best-effort: the sweep's result stands regardless of a logging failure.
  }
};

/** The box a sweep is about to attack, whoever put it there. `rebuild` is the one
 *  thing that differs between a generated sibling and a real player's workstation —
 *  which baseline the journal's rows land on — so the journal is read ONCE, after
 *  this, and every gate below it is shared. */
type SweepTarget = {
  readonly machineId: string;
  readonly hostname: string;
  readonly rebuild: (patches: readonly OwnerPatchRow[] | null) => Directory;
  /** Whose row the trace accretes under: the TARGET OWNER's on a real player's box,
   *  since the system owns its logs and two attackers must not erase each other; the
   *  caller's own on a generated box nobody owns. */
  readonly writerKey: string;
  /** The address the target saw the sweep arrive from. */
  readonly fromIp: string;
};

type SweepTargetResult =
  | { readonly ok: true; readonly target: SweepTarget }
  | { readonly ok: false; readonly response: HandlerResponse };

/**
 * Which box is at that address: a FELLOW OCCUPANT first, then the generated world.
 *
 * The LAN boundary comes first — only a live occupant of the ESSID may reach a box on
 * it — so a caller with no occupancy row is simply shown the generated world, exactly
 * as before. The address is the LEASE rather than a derivation, self is excluded (your
 * own box is not somebody to sweep), and a real occupant wins an octet the generator
 * also filled: the precedence `nmap` renders and `ssh` logs in by.
 *
 * A read that FAILS is a refusal rather than a fall-through: sweeping the seeded box
 * standing where a real player is would write the trace onto the wrong machine.
 */
const resolveSweepTarget = async (
  deps: HydraCrackDeps,
  request: {
    readonly essid: string;
    readonly targetIp: string;
    readonly callerKey: string;
    readonly lanHosts: readonly LanHost[];
    /** The address of the box the caller is STANDING on, when they are on a LAN box
     *  rather than their own workstation. Server-derived either way. */
    readonly standingIp: string | undefined;
    /** What the client says its own address is — honest on the player's own
     *  workstation, and never consulted for a cross-player target. */
    readonly claimedIp: string | undefined;
  },
): Promise<SweepTargetResult> => {
  const occupants = await deps.listOccupantsByEssid(request.essid);
  if (occupants.error) {
    return { ok: false, response: { status: 500, body: { error: 'occupants_lookup_failed' } } };
  }
  const rows = occupants.data ?? [];

  if (rows.some((row) => row.owner_key === request.callerKey)) {
    const leases = await deps.listLeasesByEssid(request.essid);
    if (leases.error) {
      return { ok: false, response: { status: 500, body: { error: 'leases_lookup_failed' } } };
    }
    const addresses = lanAddressesByOwner(request.essid, leases.data ?? []);
    const callerAddress = addresses.get(request.callerKey);
    const occupant = rows.find(
      (row) =>
        row.owner_key !== request.callerKey && addresses.get(row.owner_key) === request.targetIp,
    );
    // An occupant with no lease has no address here, and a caller with none has no
    // address to be traced at — either way there is no neighbour at this address.
    if (occupant !== undefined && callerAddress !== undefined) {
      return {
        ok: true,
        target: {
          machineId: occupant.workstation_machine_id,
          hostname: occupant.workstation_machine_name,
          rebuild: (patches) => materializeWorkstationFs(occupant, patches),
          writerKey: occupant.owner_key,
          // The lease, never the claim: a defender's log is their evidence, and the
          // pivot the caller stands on still wins where there is one, because that is
          // the box their neighbour would actually have seen.
          fromIp: request.standingIp ?? callerAddress,
        },
      };
    }
  }

  // The caller's OWN regenerated LAN — which proves target_ip names a reachable host
  // rather than an arbitrary number, and yields what rebuilds its filesystem.
  const host = request.lanHosts.find((candidate) => candidate.ip === request.targetIp);
  if (host === undefined) {
    return { ok: false, response: { status: 404, body: { error: 'host_unreachable' } } };
  }
  const { machineId, baseFs } = resolveLanHostIdentity(host, request.essid);
  return {
    ok: true,
    target: {
      machineId,
      hostname: host.hostname,
      rebuild: (patches) => materializeMachineFs(baseFs, patches),
      // Nobody owns a generated box, so the caller's key is the only stable thing
      // there is to write the trace under.
      writerKey: request.callerKey,
      fromIp: request.standingIp ?? request.claimedIp ?? 'unknown',
    },
  };
};

export const handleHydraCrack = async (
  body: unknown,
  deps: HydraCrackDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, hydraCrackSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // The caller names the machine they are standing on — the box whose wordlist is
  // read and whose address the trace records — so that name has to be checked.
  // The same L1 rule the patch endpoints use: your own workstation, or a machine
  // you currently hold a session on. Unverified, it would read a file off a box
  // the caller never reached.
  const access = await authorizeMachineAccess(
    publicKey,
    payload.caller_machine_id,
    deps.findActiveSession,
  );
  if (!access.ok) {
    return { status: access.status, body: { error: access.error } };
  }

  const lanHosts = generateHomeLan(payload.essid).hosts;

  // Where the sweep really came from. On the player's own workstation the client's
  // address is the honest one, and matching `ssh` there matters more than purity
  // (`authCreateSession` trusts the same field for a same-LAN login). Standing
  // anywhere else, the box the player is on is what the target sees, so it is
  // DERIVED from the machine they named — a claimed address would let a player
  // launch from a pivot and write the trace up as somebody else.
  const standing = lanHosts.find(
    (candidate) => machineIdForLanHost(candidate, payload.essid) === payload.caller_machine_id,
  );
  if (standing === undefined && !isOwnWorkstation(payload.caller_machine_id, publicKey)) {
    return { status: 403, body: { error: 'caller_not_on_lan' } };
  }
  const located = await resolveSweepTarget(deps, {
    essid: payload.essid,
    targetIp: payload.target_ip,
    callerKey: publicKey,
    lanHosts,
    standingIp: standing?.ip,
    claimedIp: payload.source_ip ?? undefined,
  });
  if (!located.ok) return located.response;
  const { machineId, hostname, rebuild, writerKey, fromIp } = located.target;

  const patches = await deps.findPatches({ machine_id: machineId });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const hostFs = rebuild(patches.data);

  // A bricked box is dark on every interface. Refuse before anything is attacked,
  // so a dead machine cannot be probed for which accounts it used to have.
  if (!canBoot(hostFs).ok) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // A service the world has no row for is answered exactly like one that is not
  // running: the caller learns nothing about the box either way, and resolving the
  // row here is what gives the trace below a log to land in.
  const spec = serviceByName(payload.service);
  if (spec === undefined) {
    return { status: 404, body: { error: 'service_not_running' } };
  }

  // The pidfiles are the truth about what is listening, less whatever the box refuses
  // the network: a stopped daemon leaves nothing to attack, and neither does a port its
  // owner filtered. Skipped here, a filter would be walked around by the one command
  // whose whole purpose is getting in.
  const open = portsOpenToNetwork(hostFs).find((port) => port.service === spec.service);
  if (open === undefined) {
    return { status: 404, body: { error: 'service_not_running' } };
  }


  // A door whose secret belongs to the SERVICE has one lock or none at all. None is not
  // an empty sweep: reporting nothing found would tell the player the store held, when
  // in fact it was never shut.
  const secret = spec.secretOn?.(hostFs);
  if (spec.secretOn !== undefined && secret === undefined) {
    return { status: 404, body: { error: 'no_password_set' } };
  }

  const wordlist = await deps.listPathPatches({
    machine_id: payload.caller_machine_id,
    path: WORDLIST_PATH,
  });
  if (wordlist.error) {
    return { status: 500, body: { error: 'wordlist_lookup_failed' } };
  }

  // A missing file is a real state, not an error: the wordlist is an ordinary
  // file and root can remove it. Say so, rather than reporting an empty sweep
  // that looks like a hardened target.
  const content = wordlistOn(wordlist.data);
  if (content === null) {
    return { status: 200, body: { port: open.port, cracked: [], wordlistFound: false } };
  }

  const { cracked, trace } = sweepAccounts({
    accounts: spec.accountsOn(hostFs),
    database: spec.databaseOn?.(hostFs),
    secret,
    username: payload.username,
    wordlist: content,
    hostname,
    fromIp,
    stamp: deps.now(),
    formatAttempt: spec.sweepLog.formatAttempt,
  });

  // Nothing tried, nothing recorded — an empty wordlist or a named account that
  // does not exist leaves the box's log exactly as it found it.
  if (trace.length > 0) {
    await recordSweep(deps, { writerKey, machineId, sweepLog: spec.sweepLog }, trace);
  }

  return { status: 200, body: { port: open.port, cracked, wordlistFound: true } };
};
