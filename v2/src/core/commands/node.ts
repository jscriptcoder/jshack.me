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
import { buildCommandContext, isShellError } from '../scripting/commandContext';
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

  // The registry arrives at RUN time, not through a static import: `registry.ts`
  // imports this module to list it among the builtins, so a static back-edge
  // would be a load-order cycle. `help` and `man` reach it the same way.
  const { commandRegistry } = await import('./registry');

  const lines: TerminalLine[] = [];
  const emit = (line: TerminalLine): void => {
    lines.push(line);
  };

  const outcome = await runScript(source.content, {
    ...buildCommandContext(env, commandRegistry, emit),
    // Last, so no command name can displace it: the script's own voice is not
    // something the registry gets to take over.
    console: createScriptConsole(emit),
  });

  if (!outcome.ok) {
    // A refusal or a flag mistake is the SHELL speaking, and it says at a
    // script exactly what it would have said at the prompt — no `Error:` in
    // front of it. Everything else is the script's own throw, and reads like
    // one.
    const reported = isShellError(outcome.error)
      ? outcome.error.message
      : describeScriptError(outcome.error);
    return {
      kind: 'sync',
      lines: [...lines, { kind: 'error', content: reported }],
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
      "Run a JavaScript file on this machine. The script gets a console: console.log writes normal output, console.error an error line, console.debug a dim one. That output is node's own stdout, so it pipes and redirects like any other command. Non-string values print as JSON, and an array of strings prints one element per line. An error the script throws is reported before node exits 1. " +
      "Every command on this machine is a function the script can call, and every call is awaited: const out = await nmap('10.0.0.5'). A call hands back the command's stdout as an array of lines carrying .exitCode, so a sweep can branch on whether a host fell; spreading that array ([...out]) drops the exit code. A nonzero exit is not an error — only a refusal, a bad flag or the script's own mistake stops it. Anything the command writes to stderr goes to the terminal as it happens. " +
      "A hyphenated command answers to its camelCase name: redis-cli is redisCli, aircrack-ng is aircrackNg. Flags are a trailing object with the dashed keys you already type: hydra(host, 'ssh', {'-p': 2222}). A flag the command does not declare is an error, as it is at the prompt, and a false value simply leaves the flag off. " +
      "Commands that would move the shell somewhere the script cannot follow refuse: ssh, su, exit, reboot, nano, lynx, mysql, redis-cli, ftp, and nc except with -l. Scripts cannot yet read and write files, take arguments of their own, or sleep.",
    arguments: [{ name: 'script', description: 'Path to the JavaScript file to run' }],
    examples: [
      { command: 'node hello.js', description: 'Run a script in the current directory' },
      {
        command: "const out = await nmap('10.0.0.5')",
        description: "Inside a script: scan a host and keep the scan's lines",
      },
      {
        command: 'node /root/sweep.js | grep OPEN',
        description: "Filter a script's output like any other command",
      },
    ],
  },
  execute,
};
