/**
 * handleHydraCrack — the server-side credential sweep behind the `hydra` command.
 *
 * It answers one question: which of this host's accounts have a password that appears
 * in YOUR wordlist? Everything about where that answer comes from is deliberate.
 *
 * ONE door for every target, because reachability is not hydra's to decide. A box on
 * the caller's own LAN, a fellow occupant's workstation, a box on a deep layer behind
 * one of the caller's gateways, and a box across the world behind somebody's forward
 * are all reached through the SAME `reachServiceHost` the data doors and the login
 * use — so a password hydra reports is one `ssh` then accepts, and a box dark to one
 * tool is dark to all of them, by construction rather than by four rules staying in
 * step. The three separate endpoints this door used to carry (own-LAN, inner-gateway,
 * public) collapsed into that shared reach when the vantage moved onto the shell's box.
 *
 * WHERE THE CALLER STANDS is derived from the session they hold on the box they name,
 * never from the request. A sweep launched from a hop is traced to the hop — the hop's
 * own LAN address on its network, the fronting gateway's `.1` down a chain, the hop
 * network's public address across the world — because a log line on a box the caller
 * does not own is the defender's only evidence, and evidence a client could write is
 * none. A caller naming a network they are not on, or a box they hold no shell on, is
 * refused before anything is reached.
 *
 * The TARGET is resolved SERVER-side from the same `/etc/passwd` `ssh` validates
 * against — regenerate the LAN, replay the box's journal, read its real accounts and
 * its real running services — so a hydra reading a locally regenerated baseline cannot
 * hand the player a credential `ssh` then rejects.
 *
 * The wordlist is read from the JOURNAL of the machine the caller is standing on, never
 * from the request: membership in it is the whole mechanic, so accepting it as a client
 * claim would let one unlogged request carry a pool recovered from the shipped bundle.
 * That read is MACHINE-scoped, so the list is the one the last writer left on the box,
 * whoever that was — the same rule `cat` gets from the materialized tree.
 *
 * The attempt is TRACED on the target, one `auth.log` line per password tried rather
 * than one per account: the volume is the behaviour, a sweep being the noisiest thing a
 * player can do to a box. Nothing is written when nothing was attempted — a refused,
 * dead or serviceless target must not be probeable through its own log — and the trace
 * accretes under the box's own writer key (the target owner's on a player's box, the
 * network's own stable key on a box nobody owns), so a sweep and a login never split one
 * log into two rows the newest of which wins.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { reachServiceHost, type HandlerResponse, type ServiceHostLookup } from './serviceHost.js';
import { resolveCallerVantageOn, type CallerVantageDeps } from './callerVantage.js';
import { WORDLIST_PATH } from '../wordlist/defaultWordlist.js';
import { serviceByName } from '../services/serviceCatalog.js';
import { sweepAccounts, wordlistOn } from '../wordlist/passwordSweep.js';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog.js';
import type { ListPathPatchesResult, PatchRow } from '../patches/upsertPatch.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

export type HydraCrackDeps = ServiceHostLookup &
  CallerVantageDeps & {
    readonly nonceStore: NonceStore;
    /** The server's wall clock, epoch-ms (UTC) — stamps the sweep's log lines. One
     *  sweep is one attack, so every line in it carries the same stamp. */
    readonly now: () => number;
    /** Every writer's rows at the wordlist path on the machine the caller is standing
     *  on. Machine-scoped, exactly like the read behind a save's base-content check: the
     *  file belongs to the box, not to whoever wrote it last. The sweep uses the row a
     *  reader would materialize. */
    readonly listPathPatches: (query: {
      readonly machine_id: string;
      readonly path: string;
    }) => Promise<ListPathPatchesResult>;
    /** The TARGET's current service log — the read half of the appended trace, so a
     *  sweep adds to the box's history instead of replacing it. */
    readonly readAuthLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
    /** Write a patch (here: the whole sweep, appended to the target's log). */
    readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  };

export type { HandlerResponse };

// Loose so the envelope fields (action/ts/nonce) pass through; the refine rejects a
// client-supplied player_key (the server stamps it from the verified signature).
// `username` is optional: absent means sweep every account the box has. `port` is
// optional: absent is the named service's default, the box resolved first and the
// daemon checked on that port, the same rule the data doors route by.
const hydraCrackSchema = z
  .looseObject({
    action: z.literal('hydraCrack'),
    essid: z.string().min(1),
    target_ip: z.string().min(1),
    service: z.string().min(1),
    port: z.number().int().positive().optional(),
    username: z.string().min(1).optional(),
    // The box the shell stands on — the server reads WHERE the caller is from it, reads
    // that box's wordlist, and derives the source address itself.
    caller_machine_id: z.string().min(1),
    // Still accepted so an older caller does not 400, but never read: the source address
    // is the vantage's, never a claim.
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

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

  // Where the caller is STANDING, derived from the session they hold on the box they
  // name (or their own occupancy when it is their workstation) — never a claim. A sweep
  // naming a network the caller is not on is refused before anything is reached.
  const vantage = await resolveCallerVantageOn(
    deps,
    publicKey,
    payload.caller_machine_id,
    payload.essid,
  );
  if (!vantage.ok) return { status: vantage.status, body: { error: vantage.error } };

  // A service the world has no row for is answered exactly like one that is not running:
  // the caller learns nothing about the box either way. Resolved BEFORE the reach because
  // it names the port a bare `hydra <ip> snmp` reaches — the named service's default,
  // not sshd's 22 — and gives the sweep below a log to land in.
  const spec = serviceByName(payload.service);
  if (spec === undefined) {
    return { status: 404, body: { error: 'service_not_running' } };
  }

  // The same reach every other door uses, asked for THIS daemon on THIS port: a box
  // whose daemon was stopped, a port its owner filtered, and a port a fronting switch
  // denies are all `service_not_running`, so a dead door is dark to the sweep exactly
  // as it is to a login. Nothing is logged on a box that never answered.
  const reach = await reachServiceHost(deps, {
    essid: vantage.essid,
    targetIp: payload.target_ip,
    callerMachineId: payload.caller_machine_id,
    ownLanSourceIp: vantage.sourceIp,
    port: payload.port ?? spec.defaultPort,
    service: spec.service,
    actorKey: publicKey,
  });
  if (!reach.ok) return reach.refusal;
  const { hostname, hostFs, machineId, sourceIp, writerKey } = reach.reached;

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

  // A missing file is a real state, not an error: the wordlist is an ordinary file and
  // root can remove it. Say so, rather than reporting an empty sweep that looks like a
  // hardened target.
  const content = wordlistOn(wordlist.data);
  const port = payload.port ?? spec.defaultPort;
  if (content === null) {
    return { status: 200, body: { port, cracked: [], wordlistFound: false } };
  }

  const { cracked, trace } = sweepAccounts({
    accounts: spec.accountsOn(hostFs),
    database: spec.databaseOn?.(hostFs),
    secret,
    username: payload.username,
    wordlist: content,
    hostname,
    // The address the target saw, server-derived at the vantage: the hop's own LAN
    // address, the layer `.1` down a chain, or the hop network's public IP.
    fromIp: sourceIp ?? 'unknown',
    stamp: deps.now(),
    formatAttempt: spec.sweepLog.formatAttempt,
  });

  // Nothing tried, nothing recorded — an empty wordlist or a named account that does not
  // exist leaves the box's log exactly as it found it.
  if (trace.length > 0) {
    try {
      await appendMachineLog(
        { readLog: deps.readAuthLog, upsertPatch: deps.upsertPatch },
        {
          // The box's own writer key, resolved by the reach: the TARGET owner's on a
          // player's box, the network's own stable key on a box nobody owns — the same
          // key `ssh` and the data doors write this box's log under, so a sweep never
          // splits one file into rows the newest of which wins on replay.
          writerKey,
          machineId,
          path: spec.sweepLog.path,
          owner: spec.sweepLog.owner,
          permissions: spec.sweepLog.permissions,
        },
        trace.join('\n'),
      );
    } catch {
      // best-effort: the sweep's result stands regardless of a logging failure.
    }
  }

  return { status: 200, body: { port, cracked, wordlistFound: true } };
};
