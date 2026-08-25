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
 * What is held is the connection, because each statement re-sends it. Unlike `mysql>`
 * that is not a credential — there is none — so leaving is dropping local state and
 * nothing more.
 */

import type { CommandEnv, CommandResult, RedisConnectParams, TerminalLine } from './types';

const text = (content: string): TerminalLine => ({ kind: 'text', content });

const result = (lines: readonly TerminalLine[], exitCode = 0): CommandResult => ({
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
  ['KEYS [pattern]', 'List keys, optionally matching a glob'],
  ['GET <key>', 'Read one value'],
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

/** The held connection is passed IN rather than read from the env, as `mysql>`'s is:
 *  the prompt cannot run a statement it is not holding. */
export const runRedisLine = async (
  env: CommandEnv,
  line: string,
  connection: RedisConnectParams,
): Promise<CommandResult> => {
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
  const answer = await env.redis.run({ ...connection, statement: line });

  // An eviction closes the prompt and prints no farewell: a quit is the player
  // leaving, this is the box leaving, and a prompt that answered every statement with
  // the same error would strand them somewhere that reaches nothing.
  if (answer.kind === 'lost') {
    env.redis.leave();
    return result([{ kind: 'error', content: LOST }], 1);
  }

  const kind = answer.failed ? 'error' : 'text';
  return result(
    answer.output.map((content) => ({ kind, content })),
    answer.failed ? 1 : 0,
  );
};
