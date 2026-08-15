/**
 * The `ftp>` prompt — a sub-shell, not a screen.
 *
 * While an ftp session is held, lines the player types are answered from HERE
 * instead of the ordinary command registry. That refusal is the point: `cat` at
 * `ftp>` must not reach the outer shell's `cat`, because the player believes they
 * are looking at the remote machine and the outer command would quietly read the
 * one they are standing on.
 *
 * Two machines are in the room, and every command here names which one it means.
 * `ls`/`cd`/`pwd` address the REMOTE box through `env.ftp`; the `l`-prefixed trio
 * addresses the ORIGIN through the untouched `env.fs`, which is why an ftp session
 * being parallel rather than a hop is what makes the pair possible at all.
 *
 * Which voice each answer speaks is not decoration. `cd` and `pwd` are control-
 * channel commands, so they answer in vsftpd's own numbered responses. A listing
 * is DATA the far side produced, so it arrives as the remote's own `ls` output —
 * and by running the shell's `ls` over the remote binding, a path the credential
 * cannot reach is refused by exactly the walker that would refuse it over `ssh`.
 * The local trio speaks unnumbered: nothing it does touches the control channel.
 *
 * The map is deliberately tiny. Transfers arrive with the slices that make them
 * mean something; a command listed before it works is a worse lie than a missing
 * one.
 */

import { resolveAbsPath } from '../filesystem/path';
import { bindFlags } from '../shell/bindFlags';
import type { AbsPath } from '../types';
import { ls } from './ls';
import type { CommandEnv, CommandResult, FsView, TerminalLine } from './types';

const text = (content: string): TerminalLine => ({ kind: 'text', content });

const result = (lines: readonly TerminalLine[], exitCode = 0): CommandResult => ({
  kind: 'sync',
  lines,
  exitCode,
});

const failure = (content: string): CommandResult =>
  result([{ kind: 'error', content }], 1);

/** One of the two machines: its tree at whatever tier addresses it, and the way
 *  to move its working directory. Naming the pair is what stops a command from
 *  reading one machine and moving the other. */
type Binding = {
  readonly fs: FsView;
  readonly setCwd: (path: AbsPath) => void;
};

const remoteOf = (env: CommandEnv): Binding => ({ fs: env.ftp.fs, setCwd: env.ftp.setCwd });

const originOf = (env: CommandEnv): Binding => ({ fs: env.fs, setCwd: env.setCwd });

/** Resolve `rawTarget` against the binding's own cwd and move there, or report
 *  nothing when it isn't a directory this tier can enter. The caller decides what
 *  to SAY about either outcome — the two machines answer in different voices. */
const moveTo = (binding: Binding, rawTarget: string): AbsPath | null => {
  const target = resolveAbsPath(binding.fs.cwd(), rawTarget);
  if (!binding.fs.list(target).ok) return null;
  binding.setCwd(target);
  return target;
};

/** List through the shell's own `ls`, over the named binding. Reusing the command
 *  rather than reimplementing it is what makes the flags, the sort, the long
 *  format AND the permission refusal identical on both machines. */
const listThrough = async (
  env: CommandEnv,
  binding: Binding,
  args: readonly string[],
): Promise<CommandResult> => {
  const bound = bindFlags(args, ls.flags ?? {}, { stacking: ls.stacking ?? false });
  if (!bound.ok) return failure(`ls: ${bound.error}`);
  return ls.execute({ ...env, fs: binding.fs }, bound.positional, bound.flags);
};

/** What `help` lists — the name and what it does, in the order a player meets
 *  them. The remote half first: that is the machine they came here for. */
const FTP_COMMANDS: readonly { readonly name: string; readonly description: string }[] = [
  { name: 'ls', description: 'List a directory on the remote machine' },
  { name: 'cd', description: 'Change the remote working directory' },
  { name: 'pwd', description: 'Print the remote working directory' },
  { name: 'lls', description: 'List a directory on your own machine' },
  { name: 'lcd', description: 'Change your own working directory' },
  { name: 'lpwd', description: 'Print your own working directory' },
  { name: 'help', description: 'Show this list' },
  { name: 'quit', description: 'Close the session and return to your shell' },
  { name: 'bye', description: 'Same as quit' },
];

const helpLines = (): readonly TerminalLine[] => [
  text('Commands may be abbreviated. Commands are:'),
  text(''),
  ...FTP_COMMANDS.map((command) => text(`  ${command.name.padEnd(8)}${command.description}`)),
];

/** Answer one line typed at the `ftp>` prompt. */
export const runFtpLine = async (env: CommandEnv, line: string): Promise<CommandResult> => {
  const [name, ...args] = line.trim().split(/\s+/);
  // A bare Enter at a prompt is not a mistake — say nothing back.
  if (name === undefined || name === '') return result([]);

  if (name === 'quit' || name === 'bye') {
    env.ftp.leave();
    return result([text('221 Goodbye.')]);
  }

  if (name === 'help' || name === '?') return result(helpLines());

  if (name === 'ls') return listThrough(env, remoteOf(env), args);
  if (name === 'lls') return listThrough(env, originOf(env), args);

  if (name === 'pwd') {
    return result([text(`257 "${env.ftp.fs.cwd()}" is the current directory.`)]);
  }
  if (name === 'lpwd') return result([text(`Local directory: ${env.fs.cwd()}`)]);

  if (name === 'cd') {
    const target = args[0];
    if (target === undefined) return failure('usage: cd remote-directory');
    // One refusal for missing, not-a-directory and permission-denied alike —
    // vsftpd's own, and telling them apart would map out a stranger's box for
    // free from outside the tier that is allowed to see it.
    if (moveTo(remoteOf(env), target) === null) {
      return failure('550 Failed to change directory.');
    }
    return result([text('250 Directory successfully changed.')]);
  }

  if (name === 'lcd') {
    const target = args[0];
    if (target === undefined) return failure('usage: lcd local-directory');
    const moved = moveTo(originOf(env), target);
    if (moved === null) return failure(`lcd: ${target}: No such directory`);
    return result([text(`Local directory now ${moved}`)]);
  }

  return result([{ kind: 'error', content: `?Invalid command: ${name}` }], 1);
};
