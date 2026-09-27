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
 * answered. Being past it is not a state this module holds: the password rides on every
 * statement, because there is nothing on either side of the wire remembering the last
 * one.
 *
 * Two kinds of line leave a mark on the box. A judged password, and a statement that
 * actually CHANGED the store — never a read, and never a write that turned out to do
 * nothing. What the record carries about a change is the statement rendered, not the
 * statement: the file it goes to is world-readable where the store is root-only, and
 * every visitor appends to it, so the one part a caller controls arrives with its
 * control characters gone, its whitespace collapsed and its length bounded.
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
  /** Present only when a password was actually JUDGED. Absent for every read, for a
   *  typo, and for an `AUTH` at a store holding no secret: nothing was weighed, so a
   *  line saying somebody tried would be an invention the defender reads as an attack. */
  readonly attempt?: 'success' | 'failure';
  /** The store as this statement left it, present ONLY when the statement changed it —
   *  absent for every read, every refusal, and every `DEL` that found nothing.
   *
   *  Its presence is what a caller keys the datadir write on, rather than the verb: a
   *  `DEL` against a key the store never held is a write verb that wrote nothing, and a
   *  caller deciding from the verb would persist an unchanged store. */
  readonly store?: RedisStore;
  /** What the daemon should record about this statement, absent when it should record
   *  nothing. Rendered, never raw — see the note at the top of this file about the file
   *  it lands in. The tag and the text only: where the line goes, and what time it
   *  carries, are the caller's business. */
  readonly logged?: string;
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

/** Every control character becomes a space before anything is read off the line.
 *
 *  A player at the prompt cannot type a newline; the statement field on the wire can
 *  carry one, and the record this door writes is a line-oriented file other accounts
 *  read. Collapsing them here rather than at the formatter means a smuggled second verb
 *  arrives as extra words on the first — which every verb below refuses by arity — and
 *  means nothing a store holds can forge a line in somebody else's terminal either. */
const withoutControls = (line: string): string => line.replace(/\p{Cc}/gu, ' ');

/** A double-quoted run is ONE token; everything else splits on whitespace.
 *
 *  `SET` is why this exists: it is the only verb here that takes a value, and a value
 *  is the only argument that can want a space in it. Two quoted runs stay two tokens,
 *  so `SET k "a" "b"` is a `SET` with one argument too many rather than a value of
 *  `a" "b` — which is what joining the remainder and stripping the outer quotes gave
 *  the tool this door replaces.
 *
 *  The quoted run's CONTENTS are captured, so what is inside the quotes is what the
 *  token is — rather than stripping the quotes back off afterwards, which is a second
 *  rule about a shape this pattern has already decided and no input can disagree with. */
const tokenize = (line: string): readonly string[] =>
  [...withoutControls(line).matchAll(/"([^"]*)"|\S+/g)].map((token) => token[1] ?? token[0]);

/** Everything the door can be ASKED. Kept apart from the one thing it can be TOLD:
 *  `AUTH` names no key and hands back no data, and leaving it out of this union is what
 *  keeps the reader below total over questions alone rather than answering a password
 *  with a lookup. */
type Question =
  | { readonly kind: 'keys'; readonly pattern: string }
  | { readonly kind: 'get'; readonly key: string }
  | { readonly kind: 'dbsize' };

/** Everything the door can be TOLD about its own contents. Apart from the questions
 *  because the answer is not the point of one: what a caller gets back is a receipt,
 *  and what the box keeps is a changed store and a line saying who changed it. */
type Mutation =
  | { readonly kind: 'set'; readonly key: string; readonly value: string }
  | { readonly kind: 'del'; readonly key: string };

type Command = Question | Mutation | { readonly kind: 'auth'; readonly password: string };

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

  // Exactly a key and a value, where a quoted run counts as one of each. A verb that
  // read the first two tokens and shrugged at the rest would store something the player
  // did not type and say `OK` about it — the same silent-ignore this file's `AUTH`
  // arity note was written for.
  if (verb === 'SET') {
    const value = tokens[2];
    return first === undefined || value === undefined || tokens.length > 3
      ? missingArgument(verb)
      : { ok: true, command: { kind: 'set', key: first, value } };
  }

  // One key, for the same reason: removing one of the two somebody named, and answering
  // `(integer) 1` about it, is worse than refusing the line.
  if (verb === 'DEL') {
    return first === undefined || tokens.length > 2
      ? missingArgument(verb)
      : { ok: true, command: { kind: 'del', key: first } };
  }

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

/** How long a value may be where the RECORD carries it. The store itself is not
 *  bounded — this is the length of one entry in a shared, world-readable file that
 *  every visitor appends to, and a single value long enough to bury the entries around
 *  it would cost a defender the two lines worth finding. */
const RECORDED_VALUE_LIMIT = 100;

/** A value as the record should carry it: whitespace collapsed to single spaces, and
 *  cut with an ellipsis past the limit. The STORE keeps what the player wrote — a store
 *  that squeezed its own values would answer `GET` with something nobody set — so this
 *  squeezes the rendering alone. */
const recordedValue = (value: string): string => {
  const collapsed = value.replace(/\s+/g, ' ');
  return collapsed.length > RECORDED_VALUE_LIMIT
    ? `${collapsed.slice(0, RECORDED_VALUE_LIMIT)}...`
    : collapsed;
};

/**
 * What a change does to the store, and what it leaves behind about itself.
 *
 * A `DEL` against a key the store never held is the one write here that writes nothing:
 * it answers honestly, changes nothing and records nothing, because a line saying a key
 * was removed would be a line about an event that did not happen. A `SET` always wrote,
 * even to the value a key already carries — real Redis performs it, and hiding a write
 * that really happened from the one file a defender reads, to save a patch, is the
 * wrong trade.
 */
const applyMutation = (store: RedisStore, mutation: Mutation): StoreStatementResult => {
  if (mutation.kind === 'set') {
    return {
      output: ['OK'],
      failed: false,
      store: { ...store, keys: { ...store.keys, [mutation.key]: mutation.value } },
      logged: `SET ${mutation.key} "${recordedValue(mutation.value)}"`,
    };
  }

  if (store.keys[mutation.key] === undefined) return answered(['(integer) 0']);

  return {
    output: ['(integer) 1'],
    failed: false,
    store: {
      ...store,
      keys: Object.fromEntries(
        Object.entries(store.keys).filter(([key]) => key !== mutation.key),
      ),
    },
    logged: `DEL ${mutation.key}`,
  };
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

  // Everything the store could say about itself, and everything it could be told, is
  // behind this. A locked store refuses a write with the same words it refuses a read:
  // a store that declined them differently would tell a player which keys it holds.
  if (!opensTo(store, password)) return refused(NOAUTH);

  return parsed.command.kind === 'set' || parsed.command.kind === 'del'
    ? applyMutation(store, parsed.command)
    : answered(execute(store, parsed.command));
};
