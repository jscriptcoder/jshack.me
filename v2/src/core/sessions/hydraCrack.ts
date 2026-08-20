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
 * just to logins.
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
import { generateHomeLan } from '../generation/generateHomeLan';
import { machineIdForLanHost, resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { canBoot } from '../boot/bootFiles';
import { isOwnWorkstation } from '../identity/workstation';
import {
  authorizeMachineAccess,
  type FindActiveSession,
} from '../patches/authorizeMachineAccess';
import { readOpenPorts } from '../services/pidfile';
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
  const fromIp = standing?.ip ?? payload.source_ip ?? 'unknown';

  // Resolve the target on the caller's OWN regenerated LAN — proves target_ip is a
  // real reachable host, and yields what is needed to rebuild its filesystem.
  const host = lanHosts.find((candidate) => candidate.ip === payload.target_ip);
  if (host === undefined) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  const { machineId, baseFs } = resolveLanHostIdentity(host, payload.essid);

  const patches = await deps.findPatches({ machine_id: machineId });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const hostFs = materializeMachineFs(baseFs, patches.data);

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

  // The pidfiles are the truth about what is listening: a stopped daemon leaves
  // nothing to attack, exactly as it leaves nothing to connect to.
  const open = readOpenPorts(hostFs).find((port) => port.service === spec.service);
  if (open === undefined) {
    return { status: 404, body: { error: 'service_not_running' } };
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
    username: payload.username,
    wordlist: content,
    hostname: host.hostname,
    fromIp,
    stamp: deps.now(),
    formatAttempt: spec.sweepLog.formatAttempt,
  });

  // Nothing tried, nothing recorded — an empty wordlist or a named account that
  // does not exist leaves the box's log exactly as it found it.
  if (trace.length > 0) {
    await recordSweep(deps, { writerKey: publicKey, machineId, sweepLog: spec.sweepLog }, trace);
  }

  return { status: 200, body: { port: open.port, cracked, wordlistFound: true } };
};
