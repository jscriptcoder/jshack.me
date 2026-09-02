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

import { aircrackNg } from './aircrackNg';
import { airodumpNg } from './airodumpNg';
import { airmonNg } from './airmonNg';
import { apt } from './apt';
import { author } from './author';
import { cat } from './cat';
import { cd } from './cd';
import { clear } from './clear';
import { curl } from './curl';
import { apache2, mysqld, nginx, redisServer, sshd, vsftpd } from './daemon';
import { echo } from './echo';
import { exit } from './exit';
import { grep } from './grep';
import { help } from './help';
import { identity } from './identity';
import { ifconfig } from './ifconfig';
import { gobuster } from './gobuster';
import { lynx } from './lynx';
import { john } from './john';
import { kill } from './kill';
import { ls } from './ls';
import { man } from './man';
import { mkdir } from './mkdir';
import { nano } from './nano';
import { nc } from './nc';
import { nmap } from './nmap';
import { nmcli } from './nmcli';
import { node } from './node';
import { ping } from './ping';
import { ps } from './ps';
import { pwd } from './pwd';
import { reboot } from './reboot';
import { newGame } from './newGame';
import { rm } from './rm';
import { hydra } from './hydra';
import { ftp } from './ftp';
import { mysql } from './mysql';
import { redisCli } from './redisCli';
import { snmpset } from './snmpset';
import { snmpwalk } from './snmpwalk';
import { scp } from './scp';
import { ssh } from './ssh';
import { su } from './su';
import { systemctl } from './systemctl';
import { theme } from './theme';
import { touch } from './touch';
import { whoami } from './whoami';
import { xterm } from './xterm';
import { isAlwaysAvailable, wrapWithBinaryCheck } from './availability';
import { wrapWithLibraryCheck } from './libraryDeps';
import type { Command } from './types';

const builtins: readonly Command[] = [
  aircrackNg,
  airodumpNg,
  airmonNg,
  apache2,
  apt,
  author,
  cat,
  cd,
  clear,
  curl,
  echo,
  exit,
  gobuster,
  grep,
  help,
  identity,
  ifconfig,
  john,
  kill,
  ls,
  lynx,
  man,
  mkdir,
  nano,
  nc,
  nginx,
  nmap,
  nmcli,
  node,
  ping,
  ps,
  pwd,
  reboot,
  newGame,
  rm,
  hydra,
  ftp,
  mysql,
  redisCli,
  snmpset,
  snmpwalk,
  mysqld,
  redisServer,
  scp,
  ssh,
  sshd,
  vsftpd,
  su,
  systemctl,
  theme,
  touch,
  whoami,
  xterm,
];

/** Gate a command behind its binary + linked libraries, unless it's a
 *  builtin/game command (no real binary). The binary check is OUTERMOST so a
 *  missing binary reports `command not found` before the library check can fire
 *  its linker error. Both wrappers preserve metadata and read `env.fs` at run
 *  time, so the filesystem stays the source of truth for availability. */
const gate = (command: Command): Command =>
  isAlwaysAvailable(command.name) ? command : wrapWithBinaryCheck(wrapWithLibraryCheck(command));

export const commandRegistry: ReadonlyMap<string, Command> = new Map(
  builtins.map((command) => [command.name, gate(command)]),
);
