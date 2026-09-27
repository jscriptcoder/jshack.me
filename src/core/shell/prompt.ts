/**
 * Terminal prompt formatting — pure string assembly, shared by the live
 * input prompt and the echoed command line in the scrollback so they never
 * drift. Producing a `TerminalLine` keeps it framework-agnostic (the UI just
 * renders whatever lines it's given).
 */

import type { TerminalLine } from '../commands/types';
import type { UserType } from '../types';

export type PromptLocation = {
  readonly username: string;
  readonly host: string;
  readonly cwd: string;
  /** Drives the trailing symbol: `#` for root, `$` otherwise. Optional so
   *  existing callers default to `$`. */
  readonly userType?: UserType;
};

export const formatPrompt = (location: PromptLocation): string =>
  `${location.username}@${location.host}:${location.cwd}${location.userType === 'root' ? '#' : '$'}`;

/** The scrollback line that echoes a typed command under its prompt. */
export const commandEchoLine = (location: PromptLocation, command: string): TerminalLine => ({
  kind: 'prompt',
  content: `${formatPrompt(location)} ${command}`,
});
