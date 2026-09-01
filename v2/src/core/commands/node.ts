/**
 * node — run a JavaScript file on this machine.
 *
 * The script's output is this command's OWN `CommandResult` lines, not a
 * direct write to scrollback: that is what keeps `node sweep.js | grep OPEN`
 * and `node sweep.js > out.txt` working, exactly as a real `node` pipes its
 * stdout.
 */

import type { Command, CommandEnv, CommandResult, TerminalLine } from './types';
import { resolveAbsPath } from '../filesystem/path';
import { createScriptConsole } from '../scripting/console';
import { buildCommandContext, isShellError } from '../scripting/commandContext';
import { describeScriptError, runScript } from '../scripting/runScript';
import { buildFsApi, formatNodeFsError } from '../scripting/fsApi';
import { createLineStream } from '../scripting/lineStream';
import { streamedResult } from './streaming';

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
  const scriptPath = resolveAbsPath(env.fs.cwd(), target);
  const source = env.fs.read(scriptPath);
  if (!source.ok) {
    return refusal(formatNodeFsError(target, source.error));
  }

  // The registry arrives at RUN time, not through a static import: `registry.ts`
  // imports this module to list it among the builtins, so a static back-edge
  // would be a load-order cycle. `help` and `man` reach it the same way.
  const { commandRegistry } = await import('./registry');

  // Output leaves as it is produced rather than being reported at the end. A
  // script is the one command whose run has no fixed length — a sweep can take a
  // minute — so collecting first would show the player a spinner and nothing
  // else for the whole of it, with no way to tell work from a hang.
  const stream = createLineStream();

  const script = async (): Promise<number> => {
    const outcome = await runScript(source.content, {
      ...buildCommandContext(env, commandRegistry, stream.emit),
      // All four last, so no command name can displace them: the script's own
      // voice, its filesystem, what it was called with and the one await it can
      // always be interrupted at are not things the registry gets to take over.
      console: createScriptConsole(stream.emit),
      fs: buildFsApi(env),
      // Real node's numbering: the interpreter, then the RESOLVED script path,
      // then the player's own arguments — so `process.argv.slice(2)` is what a
      // script reads. `argv[1]` is resolved rather than echoed back because a
      // script asking where it lives must get an answer it can hand to `fs`.
      process: { argv: ['/usr/bin/node', scriptPath, ...args.slice(1)] },
      // The env's sleep, not a hand-rolled setTimeout, because that one rejects
      // when the run is aborted. Otherwise a sleeping script would be the one
      // place Ctrl-C could not reach.
      sleep: env.sleep,
    });

    // Asked of the RUN, not of the error, and asked whether the script failed
    // or finished. A defensive loop — `try { await nmap(h) } catch {}` — catches
    // the abort along with the failures it was written for and comes back with
    // `ok`, so a check living in the failure branch below would never see it and
    // the player's Ctrl-C would exit 0 in silence. Matching the error by name
    // instead would let a script forge an interrupt by throwing its own.
    //
    // Thrown rather than printed: `^C` is a text line, i.e. stdout, so a
    // `node sweep.js > out.txt` would capture the marker into the file and a
    // pipeline would run on as though the sweep had finished. Rejecting unwinds
    // both, and `state.ts` already turns it into `^C` for every other streamed
    // command. It happens AFTER the drain, so what the script printed survives.
    if (env.signal.aborted) {
      throw env.signal.reason;
    }

    if (outcome.ok) {
      return 0;
    }

    // A refusal or a flag mistake is the SHELL speaking, and it says at a
    // script exactly what it would have said at the prompt — no `Error:` in
    // front of it. Everything else is the script's own throw, and reads like
    // one.
    stream.emit({
      kind: 'error',
      content: isShellError(outcome.error)
        ? outcome.error.message
        : describeScriptError(outcome.error),
    });
    return 1;
  };

  async function* run(): AsyncGenerator<TerminalLine, number> {
    // Started before the drain, so the script is already running — and has
    // already queued whatever it printed before its first await — by the time
    // anyone pulls. The exit code is awaited after the drain has ended, which
    // is the only point at which it is known.
    const finished = script().finally(stream.close);
    yield* stream.lines;
    return await finished;
  }

  return streamedResult(run());
};

export const node: Command = {
  name: 'node',
  description: 'Run a JavaScript file',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'installed-package', packageName: 'node' },
  manual: {
    synopsis: 'node [script] [arguments]',
    description:
      "Run a JavaScript file on this machine. The script gets a console: console.log writes normal output, console.error an error line, console.debug a dim one. That output is node's own stdout, so it pipes and redirects like any other command. Non-string values print as JSON, and an array of strings prints one element per line. An error the script throws is reported before node exits 1. " +
      "Every command on this machine is a function the script can call, and every call is awaited: const out = await nmap('10.0.0.5'). A call hands back the command's stdout as an array of lines carrying .exitCode, so a sweep can branch on whether a host fell; spreading that array ([...out]) drops the exit code. A nonzero exit is not an error — only a refusal, a bad flag or the script's own mistake stops it. Anything the command writes to stderr goes to the terminal as it happens. " +
      "A hyphenated command answers to its camelCase name: redis-cli is redisCli, aircrack-ng is aircrackNg. Flags are a trailing object with the dashed keys you already type: hydra(host, 'ssh', {'-p': 2222}). A flag the command does not declare is an error, as it is at the prompt, and a false value simply leaves the flag off. " +
      "Commands that would move the shell somewhere the script cannot follow refuse: ssh, su, exit, reboot, nano, lynx, mysql, redis-cli, ftp, and nc except with -l. " +
      "The filesystem is fs, awaited like everything else: await fs.readFile(path) hands back the file as a string, await fs.writeFile(path, data) replaces it, and await fs.appendFile(path, data) adds to the end — the shell has no >>, so a script gets append before the prompt does. Data is saved the way console.log prints it, so an array of lines is written one per line with no trailing newline — saving a command's captured output writes exactly what a > redirect would. Nothing is inserted between an append and what was already there. " +
      "A failure throws, in the same words node uses when it cannot open a script: No such file or directory, Is a directory, Permission denied. A write happens at your own tier, so a script can reach no file you could not write at this prompt, and an append against a file somebody else changed in the meantime is refused rather than overwriting them. There is no fs.exists — a readFile in a try/catch answers that — and no readdir, unlink or mkdir, because ls, rm and mkdir are already commands. " +
      "A script is handed what it was run with. process.argv holds the interpreter, then the script's own resolved path, then your arguments, so process.argv.slice(2) is the list you passed: node sweep.js 10.0.0.5 ssh gives it ['10.0.0.5', 'ssh']. An argument that starts with a dash has to come after --, or the shell reads it as a flag of node's own and refuses before the script runs: node sweep.js -- -v 10.0.0.5. " +
      "Pace a script with await sleep(ms), and stop one with Ctrl-C. An interrupted script ends at its next await, keeps everything it has already printed, and sends nothing more: no command starts and no file is written after the key. A loop with no await anywhere in it cannot be interrupted, so give a long one a sleep.",
    arguments: [
      { name: 'script', description: 'Path to the JavaScript file to run' },
      { name: 'arguments', description: "Passed to the script as process.argv from index 2" },
    ],
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
      {
        command: "await fs.appendFile('/root/loot.txt', out)",
        description: 'Inside a script: add what this host gave up to the report so far',
      },
      {
        command: 'const [target] = process.argv.slice(2)',
        description: 'Inside a script: read the host the player named on the command line',
      },
    ],
  },
  execute,
};
