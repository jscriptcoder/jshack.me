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
 * The wordlist is read from the CALLER'S OWN journal, never from the request. The
 * list is the whole mechanic — membership in it is what makes a password
 * crackable — so accepting it as a client claim would let one unlogged request
 * carry a pool recovered from the shipped bundle. Read from the journal, growing
 * your coverage means really writing to your own box, which is the in-game action
 * the mechanic is built around. The wordlist exists ONLY as a patch (apt wrote it;
 * no base filesystem carries it), so one row IS the file.
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
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { canBoot } from '../boot/bootFiles';
import { isOwnWorkstation } from '../identity/workstation';
import { readOpenPorts } from '../services/pidfile';
import { md5 } from '../generation/md5';
import { WORDLIST_PATH } from '../wordlist/defaultWordlist';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSshdAuthLine,
} from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import { asGameTime } from '../types';
import { accountsIn, type NamedPasswdAccount } from './passwdAccount';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog';
import type { LanHost } from '../generation/generateHomeLan';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

export type CrackedCredential = {
  readonly username: string;
  readonly password: string;
};

export type HydraCrackDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the sweep's auth.log lines.
   *  One sweep is one attack, so every line in it carries the same stamp. */
  readonly now: () => number;
  /** The TARGET host's journal, replayed over its seeded base so the sweep reads
   *  the box's real `/etc/passwd` and its real running services. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  /** The CALLER's own wordlist patch. The wordlist only ever exists as a patch
   *  (apt wrote it; no base FS carries it), so the row IS the file. */
  readonly readWordlist: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
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

/** Split a wordlist file into candidate passwords. Blank lines are dropped: an
 *  editor leaves a trailing newline behind, and "the empty password" is not
 *  something the player typed into their list. No generated account hashes to
 *  `md5('')`, so today this changes no outcome — it keeps the file's meaning
 *  honest rather than fixing a bug. */
const wordsIn = (content: string): readonly string[] =>
  content.split('\n').filter((word) => word.length > 0);

/** The accounts this run attacks: the one named, or every account the box has.
 *  A named account that does not exist yields nothing to try — the same silence a
 *  real sweep gives, revealing no account list. */
const accountsUnderAttack = (
  accounts: readonly NamedPasswdAccount[],
  username: string | undefined,
): readonly NamedPasswdAccount[] =>
  username === undefined ? accounts : accounts.filter((account) => account.username === username);

/** How a sweep went against one account: where in the wordlist its password was
 *  found, or -1 when the list does not hold it. One number answers both questions
 *  the handler has — whether the account fell (the gate: no word, no crack,
 *  however weak the real password is) and how many passwords were TRIED before it
 *  did, which is what the defender's log records. */
type AccountSweep = {
  readonly account: NamedPasswdAccount;
  readonly matchedAt: number;
};

const sweepAccount = (account: NamedPasswdAccount, words: readonly string[]): AccountSweep => ({
  account,
  matchedAt: words.findIndex((word) => md5(word) === account.hash),
});

const credentialFrom = (
  { account, matchedAt }: AccountSweep,
  words: readonly string[],
): CrackedCredential | null => {
  const password = matchedAt === -1 ? undefined : words[matchedAt];
  return password === undefined ? null : { username: account.username, password };
};

/** The sweep as the TARGET saw it: one line per password tried, in the order they
 *  were tried, `Accepted` for the one that matched and `Failed` for the rest.
 *  An account that fell records only the words that came before its match — the
 *  rest were never sent. */
const traceOf = (
  sweeps: readonly AccountSweep[],
  words: readonly string[],
  attack: { readonly host: LanHost; readonly fromIp: string; readonly stamp: number },
): readonly string[] =>
  sweeps.flatMap(({ account, matchedAt }) =>
    Array.from({ length: matchedAt === -1 ? words.length : matchedAt + 1 }, (_unused, attempt) =>
      formatSshdAuthLine({
        outcome: attempt === matchedAt ? 'success' : 'failure',
        user: account.username,
        fromIp: attack.fromIp,
        hostname: attack.host.hostname,
        time: asGameTime(attack.stamp),
        pid: derivePid(attack.stamp),
      }),
    ),
  );

/** Land the whole sweep on the target's auth.log as ONE append — a per-line write
 *  would re-read and re-upsert the entire log for every password tried. Same
 *  system-log seam `ssh` uses, and best-effort for the same reason: a logging
 *  failure must never swallow an attack that really happened. */
const recordSweep = async (
  deps: HydraCrackDeps,
  target: { readonly writerKey: string; readonly machineId: string },
  trace: readonly string[],
): Promise<void> => {
  try {
    await appendMachineLog(
      { readLog: deps.readAuthLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: target.writerKey,
        machineId: target.machineId,
        path: AUTH_LOG_PATH,
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
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

  // The caller names the machine their wordlist is read from, so that name has to
  // be checked: unverified, it would read a file off someone else's box.
  if (!isOwnWorkstation(payload.caller_machine_id, publicKey)) {
    return { status: 403, body: { error: 'not_own_machine' } };
  }

  // Resolve the target on the caller's OWN regenerated LAN — proves target_ip is a
  // real reachable host, and yields what is needed to rebuild its filesystem.
  const host = generateHomeLan(payload.essid).hosts.find(
    (candidate) => candidate.ip === payload.target_ip,
  );
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

  // The pidfiles are the truth about what is listening: a stopped daemon leaves
  // nothing to attack, exactly as it leaves nothing to connect to.
  const open = readOpenPorts(hostFs).find((port) => port.service === payload.service);
  if (open === undefined) {
    return { status: 404, body: { error: 'service_not_running' } };
  }

  const wordlist = await deps.readWordlist({
    writer_key: publicKey,
    machine_id: payload.caller_machine_id,
    path: WORDLIST_PATH,
  });
  if (wordlist.error) {
    return { status: 500, body: { error: 'wordlist_lookup_failed' } };
  }

  // A missing row is a real state, not an error: the wordlist is an ordinary file
  // on the player's own box and root can remove it. Say so, rather than reporting
  // an empty sweep that looks like a hardened target.
  const content = wordlist.data?.content ?? null;
  if (content === null) {
    return { status: 200, body: { port: open.port, cracked: [], wordlistFound: false } };
  }

  const words = wordsIn(content);
  const sweeps = accountsUnderAttack(accountsIn(hostFs), payload.username).map((account) =>
    sweepAccount(account, words),
  );
  const cracked = sweeps.flatMap((sweep) => {
    const credential = credentialFrom(sweep, words);
    return credential === null ? [] : [credential];
  });

  // Nothing tried, nothing recorded — an empty wordlist or a named account that
  // does not exist leaves the box's log exactly as it found it.
  const trace = traceOf(sweeps, words, {
    host,
    fromIp: payload.source_ip ?? 'unknown',
    stamp: deps.now(),
  });
  if (trace.length > 0) {
    await recordSweep(deps, { writerKey: publicKey, machineId }, trace);
  }

  return { status: 200, body: { port: open.port, cracked, wordlistFound: true } };
};
