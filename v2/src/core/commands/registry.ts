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

import { aircrack } from './aircrack';
import { airdump } from './airdump';
import { airmon } from './airmon';
import { apt } from './apt';
import { cat } from './cat';
import { cd } from './cd';
import { echo } from './echo';
import { exit } from './exit';
import { grep } from './grep';
import { help } from './help';
import { identity } from './identity';
import { ifconfig } from './ifconfig';
import { ls } from './ls';
import { man } from './man';
import { mkdir } from './mkdir';
import { nmap } from './nmap';
import { nmcli } from './nmcli';
import { pwd } from './pwd';
import { rm } from './rm';
import { sshd } from './sshd';
import { su } from './su';
import { touch } from './touch';
import { isAlwaysAvailable, wrapWithBinaryCheck } from './availability';
import { wrapWithLibraryCheck } from './libraryDeps';
import type { Command } from './types';

const builtins: readonly Command[] = [
  aircrack,
  airdump,
  airmon,
  apt,
  cat,
  cd,
  echo,
  exit,
  grep,
  help,
  identity,
  ifconfig,
  ls,
  man,
  mkdir,
  nmap,
  nmcli,
  pwd,
  rm,
  sshd,
  su,
  touch,
];

/** Gate a command behind its binary + linked libraries, unless it's a
 *  builtin/game command (no real binary). The binary check is OUTERMOST so a
 *  missing binary reports `command not found` before the library check can fire
 *  its linker error. Both wrappers preserve metadata and read `env.fs` at run
 *  time, so the filesystem stays the source of truth for availability. */
const gate = (command: Command): Command =>
  isAlwaysAvailable(command.name)
    ? command
    : wrapWithBinaryCheck(wrapWithLibraryCheck(command));

export const commandRegistry: ReadonlyMap<string, Command> = new Map(
  builtins.map((command) => [command.name, gate(command)]),
);
