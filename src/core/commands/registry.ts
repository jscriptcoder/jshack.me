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

import { aircrackNg } from './aircrackNg.js';
import { airodumpNg } from './airodumpNg.js';
import { airmonNg } from './airmonNg.js';
import { apt } from './apt.js';
import { author } from './author.js';
import { cat } from './cat.js';
import { cd } from './cd.js';
import { chmod } from './chmod.js';
import { gpg } from './gpg.js';
import { clear } from './clear.js';
import { curl } from './curl.js';
import { dig } from './dig.js';
import { apache2, mysqld, named, nginx, redisServer, sshd, vsftpd } from './daemon.js';
import { echo } from './echo.js';
import { exit } from './exit.js';
import { find } from './find.js';
import { grep } from './grep.js';
import { head } from './head.js';
import { help } from './help.js';
import { identity } from './identity.js';
import { ifconfig } from './ifconfig.js';
import { gobuster } from './gobuster.js';
import { lynx } from './lynx.js';
import { john } from './john.js';
import { kill } from './kill.js';
import { ldd } from './ldd.js';
import { ls } from './ls.js';
import { man } from './man.js';
import { mkdir } from './mkdir.js';
import { nano } from './nano.js';
import { nc } from './nc.js';
import { nmap } from './nmap.js';
import { nmcli } from './nmcli.js';
import { nslookup } from './nslookup.js';
import { node } from './node.js';
import { ping } from './ping.js';
import { ps } from './ps.js';
import { pwd } from './pwd.js';
import { reboot } from './reboot.js';
import { newGame } from './newGame.js';
import { rm } from './rm.js';
import { hydra } from './hydra.js';
import { msfconsole } from './msfconsole.js';
import { ftp } from './ftp.js';
import { mysql } from './mysql.js';
import { redisCli } from './redisCli.js';
import { snmpset } from './snmpset.js';
import { snmpwalk } from './snmpwalk.js';
import { scp } from './scp.js';
import { ssh } from './ssh.js';
import { strings } from './strings.js';
import { su } from './su.js';
import { systemctl } from './systemctl.js';
import { tail } from './tail.js';
import { theme } from './theme.js';
import { touch } from './touch.js';
import { wc } from './wc.js';
import { whoami } from './whoami.js';
import { xterm } from './xterm.js';
import { isAlwaysAvailable, wrapWithBinaryCheck } from './availability.js';
import { wrapWithLibraryCheck } from './libraryDeps.js';
import type { Command } from './types.js';

const builtins: readonly Command[] = [
  aircrackNg,
  airodumpNg,
  airmonNg,
  apache2,
  apt,
  author,
  cat,
  cd,
  chmod,
  gpg,
  clear,
  curl,
  dig,
  echo,
  exit,
  find,
  gobuster,
  grep,
  head,
  help,
  identity,
  ifconfig,
  john,
  kill,
  ldd,
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
  nslookup,
  ping,
  ps,
  pwd,
  reboot,
  newGame,
  rm,
  hydra,
  msfconsole,
  ftp,
  mysql,
  redisCli,
  snmpset,
  snmpwalk,
  strings,
  mysqld,
  redisServer,
  named,
  scp,
  ssh,
  sshd,
  vsftpd,
  su,
  systemctl,
  tail,
  theme,
  touch,
  wc,
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

/** The same commands for a binary run by its PATH (`/tmp/tool`): the shell has
 *  already found the file and checked its execute bit, so only the library check
 *  applies — searching the system directories by name would refuse a tool the
 *  player carried in. Builtins and game commands have no binary to carry. */
export const carriedCommandRegistry: ReadonlyMap<string, Command> = new Map(
  builtins
    .filter((command) => !isAlwaysAvailable(command.name))
    .map((command) => [command.name, wrapWithLibraryCheck(command)]),
);
