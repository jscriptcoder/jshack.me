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

import type { CommandEnv, CommandResult, TerminalLine } from './types';

const text = (content: string): TerminalLine => ({ kind: 'text', content });

const result = (lines: readonly TerminalLine[], exitCode = 0): CommandResult => ({
  kind: 'sync',
  lines,
  exitCode,
});

/** Trim, drop the trailing semicolon, collapse the whitespace. One statement per
 *  line, so a terminating `;` carries no information -- and the alternative is the
 *  real client's `->` continuation, which this door declined to pay for. */
const normalize = (line: string): string =>
  line
    .trim()
    .replace(/;\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** What a line this door does not recognise gets back. NOT a syntax error: telling a
 *  player their statement is malformed when the truth is that it is unsupported sends
 *  them to fix spelling that was never wrong. */
const UNSUPPORTED = 'ERROR: Unsupported SQL syntax. This MySQL instance supports basic queries only.';

export const runMysqlLine = async (env: CommandEnv, line: string): Promise<CommandResult> => {
  const statement = normalize(line);

  // A bare Enter at a prompt is not a mistake -- say nothing back.
  if (statement === '') return result([]);

  // Ahead of any verb table, so the way out is never unsupported syntax and never
  // needs a semicolon. `Bye` is the player leaving of their own accord; an eviction
  // by a stopped daemon closes the same prompt and deliberately prints nothing.
  if (/^(exit|quit)$/i.test(statement)) {
    env.mysql.leave();
    return result([text('Bye')]);
  }

  return result([{ kind: 'error', content: UNSUPPORTED }], 1);
};
