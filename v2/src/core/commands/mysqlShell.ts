/**
 * The `mysql>` prompt — a sub-shell, not a screen.
 *
 * While a connection is held, lines the player types are answered from HERE
 * instead of the ordinary command registry, on the rule `ftpShell.ts` already
 * states: an outer `cat` at an inner prompt would quietly read the machine the
 * player is standing on while they believe they are addressing the remote one.
 * Here the gap is wider still, because a database connection reaches no
 * filesystem at all — so an outer command is not merely misdirected, it is
 * answering a question this door cannot ask.
 *
 * Unlike `ftp>` there are no two machines to keep straight and no local half:
 * every line is SQL or it is nothing. There is also no session to end. The whole
 * of what is held is the credential, because each statement re-sends it, so
 * leaving is dropping local state and nothing more.
 */

import { normalizeStatement } from '../mysql/statements';
import type { CommandEnv, CommandResult, TerminalLine } from './types';

const text = (content: string): TerminalLine => ({ kind: 'text', content });

const result = (lines: readonly TerminalLine[], exitCode = 0): CommandResult => ({
  kind: 'sync',
  lines,
  exitCode,
});

/** What a line this door does not recognise gets back. NOT a syntax error: telling a
 *  player their statement is malformed when the truth is that it is unsupported sends
 *  them to fix spelling that was never wrong. */
const UNSUPPORTED = 'ERROR: Unsupported SQL syntax. This MySQL instance supports basic queries only.';

/** What `help` lists, as synopsis/description pairs rather than pre-aligned strings:
 *  the column is computed from the longest synopsis, so adding a verb here cannot
 *  quietly knock the list out of alignment the way legacy's hand-spaced rows are. */
const HELP_ROWS: readonly (readonly [string, string])[] = [
  ['SHOW TABLES;', 'List all tables'],
  ['DESCRIBE <table>;', 'Show table columns'],
  ['SELECT [*|cols] FROM <table> [WHERE ...];', 'Query rows'],
  ["UPDATE <table> SET col='val' [WHERE ...];", 'Modify rows'],
  ['DELETE FROM <table> [WHERE ...];', 'Delete rows'],
  ['DROP TABLE <table>;', 'Drop a table'],
  ['exit / quit', 'Leave mysql mode'],
];

const HELP_WIDTH = Math.max(...HELP_ROWS.map(([synopsis]) => synopsis.length));

/** Write verbs are listed alongside the reads because this door does accept them --
 *  it answers them with a permission denial, which is a different thing from not
 *  understanding them, and a player told otherwise goes hunting for a syntax they
 *  already have. */
const helpLines = (): readonly TerminalLine[] => [
  text('Supported commands:'),
  ...HELP_ROWS.map(([synopsis, description]) =>
    text(`  ${synopsis.padEnd(HELP_WIDTH)} ${description}`),
  ),
];

export const runMysqlLine = async (env: CommandEnv, line: string): Promise<CommandResult> => {
  const statement = normalizeStatement(line);

  // A bare Enter at a prompt is not a mistake -- say nothing back.
  if (statement === '') return result([]);

  // Ahead of any verb table, so the way out is never unsupported syntax and never
  // needs a semicolon. `Bye` is the player leaving of their own accord; an eviction
  // by a stopped daemon closes the same prompt and deliberately prints nothing.
  if (/^(exit|quit)$/i.test(statement)) {
    env.mysql.leave();
    return result([text('Bye')]);
  }

  if (/^help$/i.test(statement)) return result(helpLines());

  return result([{ kind: 'error', content: UNSUPPORTED }], 1);
};
