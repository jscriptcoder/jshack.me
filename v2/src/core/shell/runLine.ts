/**
 * runCommandLine — turn a raw input line into a command invocation.
 *
 * Dispatches the first whitespace-separated token to a command in the
 * lookup, passing the rest as positional args. Unknown commands and empty
 * input are handled here so the UI only ever has to render a CommandResult.
 *
 * `parseLine` is an INTERIM parser: it splits on whitespace and nothing
 * more. Quotes, pipes, redirects, and flags arrive with the real shell
 * tokenizer/parser (core/shell/tokenizer.ts + parser.ts) — at which point
 * this splitter is replaced, not extended.
 */

import type { Command, CommandEnv, CommandResult } from '../commands/types';

/** No command exercises flags yet; the real parser will populate this. */
const NO_FLAGS: ReadonlyMap<string, string | true> = new Map();

type ParsedLine = { readonly name: string; readonly args: readonly string[] };

const parseLine = (input: string): ParsedLine | null => {
  // `\S+` runs are the whitespace-separated tokens; no match ⇒ blank line.
  const [name, ...args] = input.match(/\S+/g) ?? [];
  if (name === undefined) return null;
  return { name, args };
};

export const runCommandLine = async (
  env: CommandEnv,
  input: string,
  commands: ReadonlyMap<string, Command>,
): Promise<CommandResult> => {
  const parsed = parseLine(input);
  if (parsed === null) {
    return { kind: 'sync', lines: [], exitCode: 0 };
  }

  const command = commands.get(parsed.name);
  if (command === undefined) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: `bash: ${parsed.name}: command not found` }],
      exitCode: 127,
    };
  }

  return command.execute(env, parsed.args, NO_FLAGS);
};
