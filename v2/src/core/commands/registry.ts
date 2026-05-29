/**
 * commandRegistry — single source of truth for the builtin command set.
 *
 * The internal `builtins` array is the only place a new command's import
 * lives. The exported `Map` is derived from it, keyed by `command.name` —
 * this makes name/key drift impossible (no manual `['ls', cat]` typos),
 * and a future `help` / `man` consumer can iterate the builtins list
 * directly without a separate enumeration.
 *
 * Per the framework-agnostic boundary spec, the UI imports this Map and
 * passes it into `runCommandLine`. `core/` never reaches back into UI
 * state; it only declares what commands exist.
 */

import { cat } from './cat';
import { cd } from './cd';
import { echo } from './echo';
import { grep } from './grep';
import { identity } from './identity';
import { ls } from './ls';
import { mkdir } from './mkdir';
import { pwd } from './pwd';
import type { Command } from './types';

const builtins: readonly Command[] = [cat, cd, echo, grep, identity, ls, mkdir, pwd];

export const commandRegistry: ReadonlyMap<string, Command> = new Map(
  builtins.map((command) => [command.name, command]),
);
