/**
 * runCommandLine — turn a raw input line into a command invocation.
 *
 * Two-phase parse:
 *   1. tokenize() — whitespace-separated tokens with shell-style quoting.
 *      An unterminated quote returns `{ ok: false, error: '...' }`, which
 *      we surface as `bash: <error>` and exit 2 before any command runs.
 *   2. bindFlags(rest, command.flags ?? {}) — classifies each remaining
 *      token as a flag or a positional argument and surfaces unknown-flag
 *      and missing-value errors as exit 2 without invoking the command.
 *
 * Exit-code conventions:
 *   0   — empty input (no-op) or successful command
 *   2   — parse-time error (tokenizer OR binder)
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
  const tokenized = tokenize(input);
  if (!tokenized.ok) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: `bash: ${tokenized.error}` }],
      exitCode: 2,
    };
  }

  const [name, ...rest] = tokenized.tokens;
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

  const bound = bindFlags(rest, command.flags ?? {}, { stacking: command.stacking ?? false });
  if (!bound.ok) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: `${command.name}: ${bound.error}` }],
      exitCode: 2,
    };
  }

  return command.execute(env, bound.positional, bound.flags);
};
