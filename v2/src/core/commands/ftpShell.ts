/**
 * The `ftp>` prompt — a sub-shell, not a screen.
 *
 * While an ftp session is held, lines the player types are answered from HERE
 * instead of the ordinary command registry. That refusal is the point: `ls` at
 * `ftp>` must not reach the outer shell's `ls`, because the player believes they
 * are looking at the remote machine and the outer command would quietly list the
 * one they are standing on. A real ftp client answers `?Invalid command` for the
 * same reason, and so does this.
 *
 * The map is deliberately tiny. Browsing and transfers arrive with the slices that
 * make them mean something; a command listed before it works is a worse lie than a
 * missing one.
 */

import type { CommandEnv, CommandResult, TerminalLine } from './types';

const text = (content: string): TerminalLine => ({ kind: 'text', content });

const result = (lines: readonly TerminalLine[], exitCode = 0): CommandResult => ({
  kind: 'sync',
  lines,
  exitCode,
});

/** What `help` lists — the name and what it does, in the order a player meets them. */
const FTP_COMMANDS: readonly { readonly name: string; readonly description: string }[] = [
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
  const [name] = line.trim().split(/\s+/);
  // A bare Enter at a prompt is not a mistake — say nothing back.
  if (name === undefined || name === '') return result([]);

  if (name === 'quit' || name === 'bye') {
    env.ftp.leave();
    return result([text('221 Goodbye.')]);
  }

  if (name === 'help' || name === '?') return result(helpLines());

  return result([{ kind: 'error', content: `?Invalid command: ${name}` }], 1);
};
