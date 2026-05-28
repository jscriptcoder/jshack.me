/**
 * Terminal UI state — module-level Solid signals (per decisions.md D2:
 * module-level signals over Context). The terminal is an app singleton, so
 * the scrollback + input + cwd live here, not in a provider.
 *
 * `runInput` is the seam between the DOM and `core/`: it echoes the typed
 * line into the scrollback, builds a CommandEnv from current state, runs the
 * line through the framework-agnostic `runCommandLine`, and mirrors the
 * resulting lines into the scrollback. `cd` mutates the cwd signal via the
 * `setCwd` callback threaded into the env.
 */

import { createSignal } from 'solid-js';
import type { AbsPath } from '../core/types';
import type { Command, TerminalLine } from '../core/commands/types';
import { cat } from '../core/commands/cat';
import { cd } from '../core/commands/cd';
import { echo } from '../core/commands/echo';
import { ls } from '../core/commands/ls';
import { pwd } from '../core/commands/pwd';
import { runCommandLine } from '../core/shell/runLine';
import { commandEchoLine } from '../core/shell/prompt';
import { buildCommandEnv } from './env';
import { SEED_HOME, SEED_HOST, seedFs, seedIdentity, seedSession } from './seed';

const COMMANDS: ReadonlyMap<string, Command> = new Map([
  ['cat', cat],
  ['cd', cd],
  ['echo', echo],
  ['ls', ls],
  ['pwd', pwd],
]);

const [scrollback, setScrollback] = createSignal<readonly TerminalLine[]>([]);
const [input, setInput] = createSignal('');
const [cwd, setCwd] = createSignal<AbsPath>(SEED_HOME);

export { cwd, input, scrollback, setInput };

/** Clear the terminal. Doubles as the backing for a future `clear` command. */
export const resetTerminal = (): void => {
  setScrollback([]);
  setInput('');
  setCwd(SEED_HOME);
};

export const runInput = async (): Promise<void> => {
  const line = input();
  setInput('');

  const session = seedSession();
  setScrollback((previous) => [
    ...previous,
    commandEchoLine({ username: session.username, host: SEED_HOST, cwd: cwd() }, line),
  ]);

  const env = buildCommandEnv({
    identity: seedIdentity(),
    session,
    root: seedFs(),
    cwd,
    onCwdChange: setCwd,
  });

  const result = await runCommandLine(env, line, COMMANDS);
  if (result.kind === 'sync') {
    setScrollback((previous) => [...previous, ...result.lines]);
  }
};
