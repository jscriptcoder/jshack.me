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
 * A LOCKED store answers nothing about itself. Not the key, not the value, not the
 * count, and not whether the key exists — one refusal for all of them, because an
 * answer that varied would let a player map a store they cannot open by watching which
 * questions it declines differently.
 *
 * The refusal comes AFTER the parse, not before, which is the order both real Redis
 * and legacy arrived at: the command lookup runs first, so a typo is a typo whether
 * or not you are in. Nothing is disclosed by that — the player learns about their own
 * spelling, not about the store.
 */

import type { RedisStore } from './types';

export type StoreStatementRequest = {
  readonly store: RedisStore;
  /** The line exactly as the player typed it — parsed here, never on the client. */
  readonly line: string;
};

export type StoreStatementResult = {
  /** Rendered lines, ready to print. Never the store, never a parsed command. */
  readonly output: readonly string[];
  /** Whether the terminal should draw this in the error colour and exit non-zero. */
  readonly failed: boolean;
};

const NOAUTH = '(error) NOAUTH Authentication required.';

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

type Command =
  | { readonly kind: 'keys'; readonly pattern: string }
  | { readonly kind: 'get'; readonly key: string }
  | { readonly kind: 'dbsize' };

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

const execute = (store: RedisStore, command: Command): readonly string[] => {
  if (command.kind === 'keys') return listKeys(store, command.pattern);
  if (command.kind === 'dbsize') return [`(integer) ${Object.keys(store.keys).length}`];

  const value = store.keys[command.key];
  return [value === undefined ? '(nil)' : `"${value}"`];
};

export const runStatement = ({ store, line }: StoreStatementRequest): StoreStatementResult => {
  const tokens = tokenize(line);

  // A bare Enter is not a mistake — say nothing back, and do not call it a failure.
  if (tokens.length === 0) return answered([]);

  const parsed = parse(tokens);
  if (!parsed.ok) return refused(parsed.message);

  // Everything the store could say about itself is behind this. There is no way past
  // it yet: a locked store is one nobody can open until the verb that opens it lands.
  if (store.requirepassHash !== null) return refused(NOAUTH);

  return answered(execute(store, parsed.command));
};
