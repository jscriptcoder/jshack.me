/**
 * passwordSweep — what a wordlist attack recovers, and what the target's log
 * records it having tried.
 *
 * The rule the whole credential layer rests on lives here: an account falls if and
 * only if its password is a WORD IN THE FILE. A password absent from the list is
 * uncrackable however weak it looks, and one present in it falls however strong it
 * looks — which is what makes growing the list the progression rather than a
 * cosmetic detail.
 *
 * Every hydra path shares this, deliberately. The sweep and the trace it writes
 * must not depend on how the target was reached: a box attacked across the network
 * has to fall to exactly the words that would take it from the same LAN, and record
 * the attempt the same way. Two copies of this rule would be two difficulty curves.
 *
 * Pure: no clock, no journal, no network. The caller supplies the words, the
 * accounts, the address to record and the stamp.
 */

import { md5 } from '../generation/md5';
import type { CredentialAttempt } from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import { asGameTime } from '../types';
import { orderPatchesForReplay } from '../patches/orderPatchesForReplay';
import type { PathPatchRow } from '../patches/upsertPatch';
import type { NamedPasswdAccount } from '../sessions/passwdAccount';

export type CrackedCredential = {
  readonly username: string;
  readonly password: string;
};

export type Sweep = {
  /** The accounts that fell, with the plaintext that opened them. */
  readonly cracked: readonly CrackedCredential[];
  /** One line per password actually TRIED, in the order tried — the defender's
   *  whole view of the attack. Empty when nothing was attempted, so a box with
   *  nothing to attack keeps its log exactly as the sweep found it. */
  readonly trace: readonly string[];
};

/** The wordlist file as the box holds it: every writer's row at the path replayed
 *  in chronological order, the last write winning. A winning row with no content
 *  is a deletion, so a removed file reads as absent rather than empty — which is
 *  what makes `apt install hydra` a real recovery rather than a no-op. */
export const wordlistOn = (rows: readonly PathPatchRow[] | null): string | null =>
  orderPatchesForReplay(rows ?? []).at(-1)?.content ?? null;

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
 *  the caller has — whether the account fell (the gate: no word, no crack, however
 *  weak the real password is) and how many passwords were TRIED before it did,
 *  which is what the defender's log records. */
type AccountSweep = {
  readonly account: NamedPasswdAccount;
  readonly matchedAt: number;
};

export const sweepAccounts = (options: {
  readonly accounts: readonly NamedPasswdAccount[];
  readonly username: string | undefined;
  readonly wordlist: string;
  readonly hostname: string;
  readonly fromIp: string;
  readonly stamp: number;
  /** How the attacked service writes one attempt into its own log. The sweep knows
   *  what was tried; the service knows how that reads to its defender. */
  readonly formatAttempt: (attempt: CredentialAttempt) => string;
}): Sweep => {
  const words = wordsIn(options.wordlist);
  const sweeps: readonly AccountSweep[] = accountsUnderAttack(
    options.accounts,
    options.username,
  ).map((account) => ({
    account,
    matchedAt: words.findIndex((word) => md5(word) === account.hash),
  }));

  const cracked = sweeps.flatMap(({ account, matchedAt }) => {
    const password = matchedAt === -1 ? undefined : words[matchedAt];
    return password === undefined ? [] : [{ username: account.username, password }];
  });

  // The sweep as the TARGET saw it: the matched password recorded as a success and
  // the rest as failures, in the attacked service's own log shape. An account that
  // fell records only the words that came before its match — the rest were never sent.
  const trace = sweeps.flatMap(({ account, matchedAt }) =>
    Array.from({ length: matchedAt === -1 ? words.length : matchedAt + 1 }, (_unused, attempt) =>
      options.formatAttempt({
        outcome: attempt === matchedAt ? 'success' : 'failure',
        user: account.username,
        fromIp: options.fromIp,
        hostname: options.hostname,
        time: asGameTime(options.stamp),
        pid: derivePid(options.stamp),
      }),
    ),
  );

  return { cracked, trace };
};
