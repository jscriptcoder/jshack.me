/**
 * The `redis> ` prompt — a sub-shell, not a screen.
 *
 * While a connection is held, lines the player types are answered from HERE instead of
 * the ordinary command registry, on the rule `ftpShell.ts` states and `mysqlShell.ts`
 * repeats: an outer `cat` at an inner prompt would quietly read the machine the player
 * is standing on while they believe they are addressing the remote one. This door
 * reaches no filesystem at all, so falling through would answer with the one machine
 * the connection bought no access to.
 *
 * LESS is decided locally here than at `mysql>`, and that is the interesting
 * difference. The way out and the verb list are answered here, because neither needs a
 * store. Everything else is sent — including a word this client could see is not a
 * verb. A prompt that recognised its own vocabulary would answer `unknown command`
 * from memory, and a player whose box stopped answering an hour ago would go on being
 * politely corrected. Every line making the trip is the whole of how an eviction is
 * discovered: there is no session row for anything to invalidate.
 *
 * What is held is the connection, because each statement re-sends it. Once a store has
 * accepted an `AUTH` that includes the password, and holding it here is the ONLY place
 * being past a lock is remembered — no row on either side of the wire keeps it. This
 * client still never judges one: it notices what the daemon accepted. So leaving is
 * dropping local state, and dropping the way back in with it.
 */

import { runOwnStatement } from './redisOwnBox';
import { isOwnBoxTarget } from '../network/interfaces';
import type { CommandEnv, CommandResult, RedisConnection, TerminalLine } from './types';

const text = (content: string): TerminalLine => ({ kind: 'text', content });

/** Always synchronous, and typed that way: the prompt answers one line at a time, and
 *  `rediscli` composes an early `AUTH`'s answer onto its greeting without having to ask
 *  which shape came back. */
type PromptResult = Extract<CommandResult, { readonly kind: 'sync' }>;

const result = (lines: readonly TerminalLine[], exitCode = 0): PromptResult => ({
  kind: 'sync',
  lines,
  exitCode,
});

/** What an evicted prompt says. There is no push channel and no session row to
 *  invalidate, so a daemon stopped mid-connection can only be discovered by the next
 *  statement — which makes the drop necessarily lazy, and this the first the player
 *  hears of it. The real client's words, not the database door's: this is a socket
 *  closing, and there is no query it was lost during. */
const LOST = 'Error: Server closed the connection';

/** What `help` lists, as synopsis/description pairs rather than pre-aligned strings:
 *  the column is computed from the longest synopsis, so adding a verb cannot quietly
 *  knock the list out of alignment.
 *
 *  It lists what the door ACCEPTS TODAY and nothing more. The write verbs are coming,
 *  and listing them early would send a player hunting for a syntax that does not exist
 *  yet — the opposite failure to the database prompt's, which lists its write verbs
 *  precisely because it answers them with a refusal rather than a blank look. */
const HELP_ROWS: readonly (readonly [string, string])[] = [
  ['AUTH <password>', 'Unlock a store that holds a secret'],
  ['KEYS [pattern]', 'List keys, optionally matching a glob'],
  ['GET <key>', 'Read one value'],
  // The quoting rule belongs on the row, because it is the half of this verb's syntax
  // a player cannot guess: the store takes exactly one value, so a value that needs a
  // space needs quotes around it. A row promising a bare multi-word value would read as
  // true and be refused by the door.
  ['SET <key> <value>', 'Write a value, quoted if it contains a space'],
  ['DEL <key>', 'Remove one key'],
  ['DBSIZE', 'Count the keys held'],
  ['exit / quit', 'Leave redis mode'],
];

const HELP_WIDTH = Math.max(...HELP_ROWS.map(([synopsis]) => synopsis.length));

const helpLines = (): readonly TerminalLine[] => [
  text('Supported commands:'),
  ...HELP_ROWS.map(([synopsis, description]) =>
    text(`  ${synopsis.padEnd(HELP_WIDTH)} ${description}`),
  ),
];

/** The password an `AUTH` the daemon ACCEPTED was carrying, read off the line the
 *  player typed. Nothing is judged here — the box did that, and this only notices what
 *  it decided, which is the difference between remembering a verdict and inventing one.
 *
 *  Anchored at the FRONT, so a key called `conf:auth` and a verb called `AUTHOR` are not
 *  mistaken for it. Deliberately not anchored at the end: what it takes is the word the
 *  door's own parser would take, whatever follows. The door refuses a two-word `AUTH`
 *  today, so nothing reaches here with a tail — and if it ever stops refusing one, this
 *  holds what the daemon weighed rather than dropping it. */
const ACCEPTED_SECRET = /^auth\s+(\S+)/i;

/** The held connection is passed IN rather than read from the env, as `mysql>`'s is:
 *  the prompt cannot run a statement it is not holding. */
export const runRedisLine = async (
  env: CommandEnv,
  line: string,
  connection: RedisConnection,
): Promise<PromptResult> => {
  const typed = line.trim();

  // A bare Enter at a prompt is not a mistake — say nothing back.
  if (typed === '') return result([]);

  // Ahead of anything sent, so the way out is never unsupported syntax and never
  // depends on the box still being there.
  if (/^(exit|quit)$/i.test(typed)) {
    env.redis.leave();
    return result([]);
  }

  if (/^help$/i.test(typed)) return result(helpLines());

  // The line goes exactly as typed. The server parses it, so trimming or lower-casing
  // here would be this client deciding what the daemon was asked.
  const answer = isOwnBoxTarget(env.network, connection.targetIp)
    ? await runOwnStatement(env, { ...connection, statement: line })
    : await env.redis.run({ ...connection, statement: line });

  // An eviction closes the prompt and prints no farewell: a quit is the player
  // leaving, this is the box leaving, and a prompt that answered every statement with
  // the same error would strand them somewhere that reaches nothing.
  if (answer.kind === 'lost') {
    env.redis.leave();
    return result([{ kind: 'error', content: LOST }], 1);
  }

  // A password the store just accepted is one every later statement has to carry, so
  // the prompt starts holding it. A refused one is not held: this client would then be
  // sending a secret the daemon has already said no to.
  const accepted = answer.failed ? null : ACCEPTED_SECRET.exec(typed);
  const secret = accepted?.[1];
  if (secret !== undefined) env.redis.enter({ ...connection, password: secret });

  const kind = answer.failed ? 'error' : 'text';
  return result(
    answer.output.map((content) => ({ kind, content })),
    answer.failed ? 1 : 0,
  );
};
