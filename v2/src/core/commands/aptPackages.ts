/**
 * Apt package catalog — the binary/availability model's "tool → package"
 * knowledge (Slice 2: the `apt install <pkg>` hint).
 *
 * The gating decision stays purely FS-driven (`availability.ts` reads the
 * filesystem). This catalog is consulted ONLY to enrich the not-found error:
 * `bash: nmap: command not found. Install with: apt install nmap`. Producing
 * that hint inherently needs to know which package ships a given binary — that
 * lookup is what lives here.
 *
 * Ported from legacy `src/commands/availability.ts` (`APT_PACKAGES`). `extraFiles`
 * has since landed — a package can ship data files as well as binaries — while
 * `description` / `version` arrive with the version-and-patch work. The mapping
 * itself is faithful: these are the packages whose binaries the connectivity arc
 * and later exploit chains depend on.
 */

import type { AbsPath } from '../types';
import type { FilePermissions } from '../filesystem/types';
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
  readonly content: string;
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
        content: formatWordlist(DEFAULT_WORDLIST),
        permissions: WORDLIST_PERMISSIONS,
      },
    ],
  },
  {
    name: 'gobuster',
    extraFiles: [
      {
        path: DIRLIST_PATH,
        content: formatDirlist(DEFAULT_DIRLIST),
        permissions: DIRLIST_PERMISSIONS,
      },
    ],
  },
  { name: 'snmp', binaries: ['snmpwalk', 'snmpset'] },
  // One package, both halves: the client you point at somebody else's database
  // and the daemon that makes yours one. A player who installed `mysql` and then
  // had to find out what the SERVER package was called would be reading a
  // catalogue to learn a name the world never says out loud.
  { name: 'mysql', binaries: ['mysql', 'mysqld'], daemons: ['mysqld'] },
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
