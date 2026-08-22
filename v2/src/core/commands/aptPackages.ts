/**
 * Apt package catalog — what each package IS: the binaries it provides, which of
 * them are daemons, and the data files it lays down beside them.
 *
 * Whether a command RUNS is never decided here. That stays purely FS-driven
 * (`availability.ts` reads the filesystem), so removing a binary makes its command
 * not-found again with no list to keep in sync. This catalog answers the two
 * questions the filesystem cannot: which package to name in the not-found hint
 * (`bash: nmap: command not found. Install with: apt install nmap`), and what an
 * install should put on the box in the first place.
 *
 * Ported from legacy `src/commands/availability.ts` (`APT_PACKAGES`); `description`
 * / `version` arrive with the version-and-patch work. The mapping itself is
 * faithful: these are the packages whose binaries the connectivity arc and later
 * exploit chains depend on.
 */

import type { AbsPath } from '../types';
import type { FilePermissions } from '../filesystem/types';
import type { CommandEnv } from './types';
import { DATADIR_FILE } from '../generation/baseFs';
import { DATADIR_PATH } from '../mysql/datadir';
import { ownDatabase } from '../mysql/ownDatabase';
import {
  DEFAULT_WORDLIST,
  formatWordlist,
  WORDLIST_PATH,
  WORDLIST_PERMISSIONS,
} from '../wordlist/defaultWordlist';
import {
  DEFAULT_DIRLIST,
  DIRLIST_PATH,
  DIRLIST_PERMISSIONS,
  formatDirlist,
} from '../network/defaultDirlist';

/** A data file a package installs alongside its binaries. Some tools are useless
 *  without one — hydra with no wordlist has nothing to try — and the file is a
 *  normal file on the box afterwards: readable, editable, and the player's to
 *  curate. */
export type AptExtraFile = {
  readonly path: AbsPath;
  /** The bytes to lay down, computed against the box receiving them.
   *
   *  A function rather than a constant because not every shipped file is the same
   *  for every player: a wordlist is the world's and reads the same everywhere, but
   *  a database is its owner's, drawn from their identity and answering to their
   *  own root password. */
  readonly content: (env: CommandEnv) => string;
  readonly permissions: FilePermissions;
};

/** One installable apt package. `binaries` defaults to `[name]` when the
 *  package ships a single binary that matches its name. */
export type AptPackage = {
  readonly name: string;
  /** Binary names this package provides, when they differ from `name`. */
  readonly binaries?: readonly string[];
  /** Which of this package's binaries are DAEMONS — the ones you run to bring a
   *  service up. They install into `/usr/sbin` beside the pre-installed `sshd`
   *  and `vsftpd` rather than into `/usr/bin` with the tools.
   *
   *  A marker over `binaries` rather than a second list, so a package that ships
   *  both halves names each binary once: `mysql` provides the client and the
   *  daemon, and only the second is admin's. */
  readonly daemons?: readonly string[];
  /** Data files this package ships. Omitted by packages that ship only code. */
  readonly extraFiles?: readonly AptExtraFile[];
};

export const APT_PACKAGES: readonly AptPackage[] = [
  { name: 'nmap' },
  { name: 'john' },
  { name: 'netcat', binaries: ['nc'] },
  { name: 'ftp' },
  { name: 'metasploit', binaries: ['msfconsole'] },
  { name: 'aircrack', binaries: ['airmon', 'airdump', 'aircrack'] },
  { name: 'gpg' },
  { name: 'node' },
  {
    name: 'hydra',
    extraFiles: [
      {
        path: WORDLIST_PATH,
        content: () => formatWordlist(DEFAULT_WORDLIST),
        permissions: WORDLIST_PERMISSIONS,
      },
    ],
  },
  {
    name: 'gobuster',
    extraFiles: [
      {
        path: DIRLIST_PATH,
        content: () => formatDirlist(DEFAULT_DIRLIST),
        permissions: DIRLIST_PERMISSIONS,
      },
    ],
  },
  { name: 'snmp', binaries: ['snmpwalk', 'snmpset'] },
  // One package, both halves: the client you point at somebody else's database
  // and the daemon that makes yours one. A player who installed `mysql` and then
  // had to find out what the SERVER package was called would be reading a
  // catalogue to learn a name the world never says out loud.
  {
    name: 'mysql',
    binaries: ['mysql', 'mysqld'],
    daemons: ['mysqld'],
    // The daemon arrives with a database to serve, the way hydra arrives with a
    // wordlist to try. Bought rather than shipped from boot: a fresh box has nothing
    // that could open one, and running a database is meant to be a choice with a
    // consequence — you installed it, you started it, you are now a target.
    extraFiles: [
      {
        path: DATADIR_PATH,
        content: (env) =>
          JSON.stringify(
            ownDatabase({
              ownerKeyHex: env.identity.publicKeyHex,
              hostname: env.hostname,
              fs: env.fs.root(),
            }),
          ),
        permissions: DATADIR_FILE,
      },
    ],
  },
  { name: 'redis-tools', binaries: ['rediscli'] },
  { name: 'lynx' },
  { name: 'apache2', daemons: ['apache2'] },
  { name: 'nginx', daemons: ['nginx'] },
];

/** Binary name → package name, for the install hint. Derived from
 *  `APT_PACKAGES`: each package's binaries (or its own name) point back to it. */
const binaryToPackage: ReadonlyMap<string, string> = new Map(
  APT_PACKAGES.flatMap((pkg) => (pkg.binaries ?? [pkg.name]).map((binary) => [binary, pkg.name])),
);

/** The apt package that provides `binary`, or `undefined` if it isn't a known
 *  apt tool (a system utility, a builtin, or simply unknown). */
export const packageForBinary = (binary: string): string | undefined => binaryToPackage.get(binary);
