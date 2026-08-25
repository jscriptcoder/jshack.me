/**
 * What a key-value store answers, and what it refuses.
 *
 * The whole surface is a handful of words, against the database door's 659-line
 * parser — which is the door's character rather than an omission. A store has no
 * tables, no columns, no accounts and no tiers: it holds strings under names, and the
 * only question it can be asked about permission is whether it holds a secret.
 *
 * The parse happens HERE, server-side, for the reason the database door's does: a
 * client that recognised its own verbs would answer `unknown command` without asking
 * the box — and a prompt whose box has died would keep politely correcting the
 * player's spelling. Every line makes the trip, so every line is a chance to discover
 * the daemon is gone.
 *
 * A LOCKED store answers nothing about itself until its secret is produced. Not the
 * key, not the value, not the count, and not whether the key exists — one refusal for
 * all of them, because an answer that varied would let a player map a store they cannot
 * open by watching which questions it declines differently.
 *
 * `AUTH` is the way past that, and it is the only line here that is JUDGED rather than
 * answered — the only one, therefore, that the target's log records. Being past it is
 * not a state this module holds: the password rides on every statement, because there
 * is nothing on either side of the wire remembering the last one.
 *
 * The refusal comes AFTER the parse, not before, which is the order both real Redis
 * and legacy arrived at: the command lookup runs first, so a typo is a typo whether
 * or not you are in. Nothing is disclosed by that — the player learns about their own
 * spelling, not about the store.
 */

import { md5 } from '../generation/md5';
import type { RedisStore } from './types';

export type StoreStatementRequest = {
  readonly store: RedisStore;
  /** The line exactly as the player typed it — parsed here, never on the client. */
  readonly line: string;
  /** What the caller is holding, re-sent with every statement because nothing here
   *  remembers them between two. Absent is the ordinary state: most of this door's
   *  traffic is against stores that ask for nothing. */
  readonly password?: string;
};

export type StoreStatementResult = {
  /** Rendered lines, ready to print. Never the store, never a parsed command. */
  readonly output: readonly string[];
  /** Whether the terminal should draw this in the error colour and exit non-zero. */
  readonly failed: boolean;
  /** Present only when a password was actually JUDGED — which is the one thing this
   *  door records. Absent for every read, for a typo, and for an `AUTH` at a store
   *  holding no secret: nothing was weighed, so a line saying somebody tried would be
   *  an invention the defender reads as an attack. */
  readonly attempt?: 'success' | 'failure';
};

const NOAUTH = '(error) NOAUTH Authentication required.';
const NO_SECRET = '(error) ERR Client sent AUTH, but no password is set';
const WRONG_SECRET = '(error) ERR invalid password';

const answered = (output: readonly string[]): StoreStatementResult => ({ output, failed: false });

const refused = (message: string): StoreStatementResult => ({ output: [message], failed: true });

/** Only `*` is a wildcard. Everything else a pattern can contain is a literal —
 *  including `?`, which real Redis treats as a single-character wildcard and this door
 *  does not. Escaping it rather than passing it through is what keeps `KEYS ?` a
 *  question that returns nothing instead of a regex the server cannot compile. */
const globToRegex = (pattern: string): RegExp =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')}$`);

/** Split on whitespace. Nothing here takes a value, so nothing here takes an argument
 *  with a space in it — the quoted-run handling this carried belongs with the verb that
 *  needs it, and would be untestable machinery until then. */
const tokenize = (line: string): readonly string[] =>
  line.split(/\s+/).filter((token) => token !== '');

/** Everything the door can be ASKED. Kept apart from the one thing it can be TOLD:
 *  `AUTH` names no key and hands back no data, and leaving it out of this union is what
 *  keeps the reader below total over questions alone rather than answering a password
 *  with a lookup. */
type Question =
  | { readonly kind: 'keys'; readonly pattern: string }
  | { readonly kind: 'get'; readonly key: string }
  | { readonly kind: 'dbsize' };

type Command = Question | { readonly kind: 'auth'; readonly password: string };

type Parsed =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly message: string };

/** A verb it knows, given nothing to work on. Named in lower case however it was
 *  typed, as the real daemon names it. */
const missingArgument = (verb: string): Parsed => ({
  ok: false,
  message: `(error) ERR wrong number of arguments for '${verb.toLowerCase()}' command`,
});

const parse = (tokens: readonly string[]): Parsed => {
  const [word, first] = tokens;
  const verb = (word ?? '').toUpperCase();

  // First, because it is the only verb a shut store answers — and last in importance
  // to a store that is open, which is why it names its own two failures rather than
  // sharing the reader's.
  //
  // Exactly one word, where the readers below shrug at a second: a password cannot
  // contain a space, so a line with two is a typo — and weighing the first silently
  // would leave the prompt holding nothing while the daemon said OK, authenticating a
  // player for one statement and shutting them out on the next.
  if (verb === 'AUTH') {
    return first === undefined || tokens.length > 2
      ? missingArgument(verb)
      : { ok: true, command: { kind: 'auth', password: first } };
  }

  // A bare KEYS is KEYS *: a pattern nobody typed cannot be a filter, and refusing it
  // would be this door inventing a rule its own `help` does not state.
  if (verb === 'KEYS') return { ok: true, command: { kind: 'keys', pattern: first ?? '*' } };
  if (verb === 'GET') {
    return first === undefined
      ? missingArgument(verb)
      : { ok: true, command: { kind: 'get', key: first } };
  }
  if (verb === 'DBSIZE') return { ok: true, command: { kind: 'dbsize' } };

  return { ok: false, message: `(error) ERR unknown command '${word}'` };
};

/** Store order, which is the order the generator drew the keys in — the same order
 *  the file lists them, so a player who reads the datadir as root and a player who
 *  only ever reaches the port see one store rather than two. */
const listKeys = (store: RedisStore, pattern: string): readonly string[] => {
  const matching = Object.keys(store.keys).filter((key) => globToRegex(pattern).test(key));
  return matching.length === 0
    ? ['(empty list or set)']
    : matching.map((key, index) => `${index + 1}) "${key}"`);
};

const execute = (store: RedisStore, question: Question): readonly string[] => {
  if (question.kind === 'keys') return listKeys(store, question.pattern);
  if (question.kind === 'dbsize') return [`(integer) ${Object.keys(store.keys).length}`];

  const value = store.keys[question.key];
  return [value === undefined ? '(nil)' : `"${value}"`];
};

/** What a store makes of a password offered to it. The hash is the whole comparison,
 *  so a fold or a prefix is a miss — the secret is only ever as weak as the wordlist
 *  that holds it.
 *
 *  A store with NO secret refuses too, and says something different: there is nothing
 *  here to be let past, which is a fact about the store rather than about the caller.
 *  Real Redis answers exactly this, and it is how a player learns the door was already
 *  open. */
const judge = (store: RedisStore, candidate: string): StoreStatementResult => {
  if (store.requirepassHash === null) return refused(NO_SECRET);
  return md5(candidate) === store.requirepassHash
    ? { output: ['OK'], failed: false, attempt: 'success' }
    : { output: [WRONG_SECRET], failed: true, attempt: 'failure' };
};

/** Whether this statement may be answered at all. An open store answers everyone; a
 *  shut one answers whoever re-sent the password that opens it. Nothing is remembered
 *  between two statements, so being in is not a state the door holds — it is a claim
 *  every line carries and every line has to make good. */
const opensTo = (store: RedisStore, password: string | undefined): boolean =>
  store.requirepassHash === null ||
  (password !== undefined && md5(password) === store.requirepassHash);

export const runStatement = ({
  store,
  line,
  password,
}: StoreStatementRequest): StoreStatementResult => {
  const tokens = tokenize(line);

  // A bare Enter is not a mistake — say nothing back, and do not call it a failure.
  if (tokens.length === 0) return answered([]);

  const parsed = parse(tokens);
  if (!parsed.ok) return refused(parsed.message);

  // Ahead of the wall, because it is the door through it. Real Redis and legacy both
  // look the command up first and then let this one verb past — so a shut store still
  // corrects your spelling, and still tells you nothing else.
  if (parsed.command.kind === 'auth') return judge(store, parsed.command.password);

  // Everything the store could say about itself is behind this.
  if (!opensTo(store, password)) return refused(NOAUTH);

  return answered(execute(store, parsed.command));
};
