/**
 * runCommandLine — turn a raw input line into a command invocation.
 *
 * Two-phase parse:
 *   1. tokenize() — whitespace-separated tokens today; quoted strings + the
 *      unterminated-quote error arrive in Slice 3 (which will reshape
 *      tokenize's return type to a Result).
 *   2. bindFlags(rest, command.flags ?? {}) — classifies each remaining
 *      token as a flag or a positional argument and surfaces unknown-flag
 *      errors as exit 2 without invoking the command.
 *
 * Exit-code conventions:
 *   0   — empty input (no-op) or successful command
 *   2   — parse-time error (binder; Slice 3 adds the tokenizer branch)
 *   127 — unknown command name
 *   *   — anything else is the command's own exit code
 */

import type { Command, CommandEnv, CommandResult } from '../commands/types';
import { tokenize } from './tokenize';
import { bindFlags } from './bindFlags';

export const runCommandLine = async (
  env: CommandEnv,
  input: string,
  commands: ReadonlyMap<string, Command>,
): Promise<CommandResult> => {
  const [name, ...rest] = tokenize(input);
  if (name === undefined) {
    return { kind: 'sync', lines: [], exitCode: 0 };
  }

  const command = commands.get(name);
  if (command === undefined) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: `bash: ${name}: command not found` }],
      exitCode: 127,
    };
  }

  const bound = bindFlags(rest, command.flags ?? {});
  if (!bound.ok) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: `${command.name}: ${bound.error}` }],
      exitCode: 2,
    };
  }

  return command.execute(env, bound.positional, bound.flags);
};
