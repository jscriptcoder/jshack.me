/**
 * node — run a JavaScript file on this machine.
 *
 * The script's output is this command's OWN `CommandResult` lines, not a
 * direct write to scrollback: that is what keeps `node sweep.js | grep OPEN`
 * and `node sweep.js > out.txt` working, exactly as a real `node` pipes its
 * stdout.
 */

import type { Command, CommandEnv, CommandResult, FsReadResult, TerminalLine } from './types';
import { resolveAbsPath } from '../filesystem/path';
import { createScriptConsole } from '../scripting/console';
import { describeScriptError, runScript } from '../scripting/runScript';

type FsReadError = Extract<FsReadResult, { readonly ok: false }>['error'];

/** The house style `cat` sets, under this command's name. Kept inline for the
 *  same reason cat keeps its own: the read-error family is not uniform across
 *  commands (`grep` quotes its target), so a shared helper would serve fewer
 *  callers than it looks like it would. */
const formatReadError = (target: string, error: FsReadError): string => {
  switch (error) {
    case 'not_found':
      return `node: ${target}: No such file or directory`;
    case 'is_directory':
      return `node: ${target}: Is a directory`;
    case 'permission_denied':
      return `node: ${target}: Permission denied`;
  }
};

const refusal = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode: 1,
});

const execute = async (env: CommandEnv, args: readonly string[]): Promise<CommandResult> => {
  const [target] = args;
  if (target === undefined) {
    return refusal('node: missing file operand');
  }

  // READ permission is the whole gate, deliberately — the execute bit is not
  // consulted and adding it would be a regression, not a fix. `nano` stamps
  // `execute: ['root']` on everything a user writes and the game has no
  // `chmod`, so an execute check would stop every non-root player running the
  // script they just wrote. Real node opens a script for reading too.
  const source = env.fs.read(resolveAbsPath(env.fs.cwd(), target));
  if (!source.ok) {
    return refusal(formatReadError(target, source.error));
  }

  const lines: TerminalLine[] = [];
  const outcome = await runScript(source.content, {
    console: createScriptConsole((line) => lines.push(line)),
  });

  if (!outcome.ok) {
    return {
      kind: 'sync',
      lines: [...lines, { kind: 'error', content: describeScriptError(outcome.error) }],
      exitCode: 1,
    };
  }

  return { kind: 'sync', lines, exitCode: 0 };
};

export const node: Command = {
  name: 'node',
  description: 'Run a JavaScript file',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'node' },
  manual: {
    synopsis: 'node [script]',
    description:
      "Run a JavaScript file on this machine. The script gets a console: console.log writes normal output, console.error an error line, console.debug a dim one. That output is node's own stdout, so it pipes and redirects like any other command. Non-string values print as JSON, and an array of strings prints one element per line. A script may await, and an error it throws is reported before node exits 1. Scripts cannot yet call the machine's other commands or read and write files.",
    arguments: [{ name: 'script', description: 'Path to the JavaScript file to run' }],
    examples: [
      { command: 'node hello.js', description: 'Run a script in the current directory' },
      {
        command: 'node /root/sweep.js | grep OPEN',
        description: "Filter a script's output like any other command",
      },
    ],
  },
  execute,
};
