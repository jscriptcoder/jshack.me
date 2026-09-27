/**
 * The `console` a script sees.
 *
 * `console` is a real browser global, so a script body that did not shadow it
 * would send every `console.log` to devtools and leave the player staring at
 * an empty terminal. Injecting one is what makes the script's output the
 * game's output.
 *
 * The three methods are the three line kinds the terminal renders — `log` is
 * the script's stdout, `error` its stderr, `debug` its dim aside. Lines go to
 * a collector the caller owns rather than straight to scrollback, so the
 * caller can put them in its own `CommandResult` and keep a script pipeable.
 */

import type { TerminalLine } from '../commands/types';
import { formatScriptValue } from './format';

export type ScriptConsole = {
  readonly log: (...values: readonly unknown[]) => void;
  readonly error: (...values: readonly unknown[]) => void;
  readonly debug: (...values: readonly unknown[]) => void;
};

/** The three sinks a script can reach — `prompt` is the shell's own line kind
 *  and is deliberately not among them. */
type ScriptSink = 'text' | 'error' | 'dim';

export const createScriptConsole = (emit: (line: TerminalLine) => void): ScriptConsole => {
  const write =
    (kind: ScriptSink) =>
    (...values: readonly unknown[]): void => {
      // One call can produce several lines — a formatted string array, or a
      // string with newlines in it — and the terminal (and any pipe reading
      // it) is line-based, so each becomes its own line.
      const printed = values.map(formatScriptValue).join(' ');
      printed.split('\n').forEach((line) => emit({ kind, content: line }));
    };

  return { log: write('text'), error: write('error'), debug: write('dim') };
};
