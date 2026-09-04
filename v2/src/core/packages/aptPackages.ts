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
 * It lives BELOW the command layer because it is world data rather than a command's
 * private table: the world generator reads it to decide which programs a box that
 * runs a service carries, and a catalog that could only be read from inside `apt`
 * would have to be restated wherever else a box is built. Nothing here imports
 * `commands/` — which is why `AptExtraFile.content` takes a narrowed
 * `PackageFileContext` rather than the whole command environment.
 *
 * Ported from legacy `src/commands/availability.ts` (`APT_PACKAGES`); `description`
 * / `version` arrive with the version-and-patch work. The mapping itself is
 * faithful: these are the packages whose binaries the connectivity arc and later
 * exploit chains depend on.
 */

import type { AbsPath, PlayerKeyHex } from '../types';
import type { Directory, FilePermissions } from '../filesystem/types';
import { DATADIR_FILE, SERVICE_CONFIG_FILE } from '../generation/baseFs';
import { DATADIR_PATH } from '../mysql/datadir';
import { ownDatabase } from '../mysql/ownDatabase';
import { DATADIR_PATH as STORE_PATH } from '../redis/datadir';
import { ownStore } from '../redis/ownStore';
import { formatRedisConf, REDIS_CONF_PATH } from '../generation/generateRedisStore';
import {
  LOCAL_FILTER_SEED,
  RULES_V4_PATH,
  RULES_V4_PERMISSIONS,
} from '../network/iptablesRules';
import { pidfilePath } from '../services/pidfile';
import { md5 } from '../generation/md5';
import { SNMPD_CONF_PATH, SNMPD_CONF_PERMISSIONS, SNMPD_CONF_SEED } from '../snmp/conf';
import { ownAgentCommunity } from '../snmp/ownAgent';
import {
  formatSnmpdState,
  SNMPD_STATE_PATH,
  SNMPD_STATE_PERMISSIONS,
} from '../snmp/rwCommunity';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
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
  readonly content: (box: PackageFileContext) => string;
  /** Lines to print once this file has actually landed. Tied to the WRITE rather than
   *  to the install, so a package that kept the player's existing copy says nothing —
   *  which is what stops a secret from being re-announced to whoever reinstalls. */
  readonly noteOnInstall?: (box: PackageFileContext) => readonly string[];
  readonly permissions: FilePermissions;
};

/**
 * What a shipped file is computed against: the box receiving it, narrowed to the
 * three things a package's bytes can ask about.
 *
 * Narrow DELIBERATELY, rather than taking the whole command environment. This
 * catalog is world data — the world generator reads it to decide what a box
 * carries — and a package whose content could reach the shell would make that data
 * depend on the layer above it. `CommandEnv` satisfies this shape structurally, so
 * `apt` still passes its own env through unchanged.
 */
export type PackageFileContext = {
  readonly identity: { readonly publicKeyHex: PlayerKeyHex };
  readonly hostname: string;
  readonly fs: { readonly root: () => Directory };
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
  // The other half of recon: `nmap` asks what is at an address, these ask what an
  // address is called. Both under the name the tools really ship as — nobody types
  // `apt install dig`, and a player who tried would be right to expect it to fail
  // the way it fails on a real box.
  { name: 'dnsutils', binaries: ['dig', 'nslookup'] },
  { name: 'john' },
  { name: 'netcat', binaries: ['nc'] },
  { name: 'ftp' },
  { name: 'metasploit', binaries: ['msfconsole'] },
  { name: 'aircrack-ng', binaries: ['airmon-ng', 'airodump-ng', 'aircrack-ng'] },
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
  // One package, all three parts: the two tools you point at somebody else's device,
  // and the daemon that makes yours one. It ships a file too, and that file is the
  // point — an agent a player runs is a door they opened, and the filter is what lets
  // them close a port to the network while keeping the service for themselves. The
  // only defence in the game that is not `systemctl stop`.
  {
    name: 'snmp',
    binaries: ['snmpwalk', 'snmpset', 'snmpd'],
    daemons: ['snmpd'],
    extraFiles: [
      {
        path: RULES_V4_PATH,
        // The same for every box, unlike a datadir: a filter is a list of the owner's
        // own decisions, and a fresh one has none in it yet.
        content: () => LOCAL_FILTER_SEED,
        permissions: RULES_V4_PERMISSIONS,
      },
      {
        path: SNMPD_CONF_PATH,
        // The same for every box too, and for a reason the filter's does not share:
        // the read-only community is `public` on every device in the world because
        // that string is not a secret in real SNMP either. Nothing here is drawn.
        content: () => SNMPD_CONF_SEED,
        permissions: SNMPD_CONF_PERMISSIONS,
      },
      {
        path: SNMPD_STATE_PATH,
        // The one file here that IS drawn per box, and the only secret this door has.
        // Hashed on the way in, exactly as an account's password is: root can read this
        // file, and a community sitting in it in the clear would make the door a reward
        // for a crack somebody had already finished.
        content: (box) => formatSnmpdState(md5(ownAgentCommunity(box.identity.publicKeyHex))),
        permissions: SNMPD_STATE_PERMISSIONS,
        // The only time this string is legible anywhere. The file beside it holds the
        // hash, and no command reads it back, so the line on screen is the whole of
        // what the owner gets — losing it costs them remote control of their own port
        // table until they rotate it.
        noteOnInstall: (box) => [
          `Read-write community for snmpd on this box: ${ownAgentCommunity(box.identity.publicKeyHex)}`,
          'Store it somewhere. It is kept hashed and will not be shown again.',
        ],
      },
    ],
  },
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
        content: (box) =>
          JSON.stringify(
            ownDatabase({
              ownerKeyHex: box.identity.publicKeyHex,
              hostname: box.hostname,
              fs: box.fs.root(),
            }),
          ),
        permissions: DATADIR_FILE,
      },
    ],
  },
  // One package, both halves, as mysql above: the client you point at somebody else's
  // store and the daemon that makes yours one. Both binaries carry the real hyphenated
  // names; the package keeps the short one, which is what a player types to buy the pair.
  {
    name: 'redis',
    binaries: ['redis-cli', 'redis-server'],
    daemons: ['redis-server'],
    // TWO files, where every other package ships at most one: the store the daemon
    // serves, and the conf the box publishes about it. The conf is not decoration —
    // every generated box running a store carries one, so a player's box without it
    // would read as a different kind of machine to anyone doing recon. They sit on
    // different rungs on purpose: the lock is a hash in the root-only datadir, and the
    // conf names no secret, which is what lets a guest read it.
    extraFiles: [
      {
        path: STORE_PATH,
        content: (box) =>
          JSON.stringify(
            ownStore({
              ownerKeyHex: box.identity.publicKeyHex,
              hostname: box.hostname,
              fs: box.fs.root(),
            }),
          ),
        permissions: DATADIR_FILE,
      },
      {
        path: REDIS_CONF_PATH,
        // The catalog's DEFAULT port, because an install cannot know a port the player
        // has not chosen yet. A daemon started elsewhere leaves this line naming 6379,
        // exactly as a real conf does when the port arrives on the command line — the
        // pidfile is what `nmap` and `ps` read for the live answer, and this is a file
        // the player can edit.
        content: (box) =>
          formatRedisConf({
            hostname: box.hostname,
            port: SERVICE_CATALOG.redis.defaultPort,
            pidfilePath: pidfilePath(SERVICE_CATALOG.redis),
          }),
        permissions: SERVICE_CONFIG_FILE,
      },
    ],
  },
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

/** A package's binaries, defaulted to its own name — the same shape the installer
 *  lays down, so a caller never has to remember the default. */
const binariesOf = (pkg: AptPackage): readonly string[] => pkg.binaries ?? [pkg.name];

/** Which of a package's binaries are daemons — none, for the many that ship only a
 *  tool. Paired with `binariesOf` so neither default has to be remembered twice. */
const daemonsOf = (pkg: AptPackage): readonly string[] => pkg.daemons ?? [];

/** One binary a box carries, and whether apt would file it as a daemon — which is
 *  the whole of what decides `/usr/sbin` over `/usr/bin`. */
export type ServiceBinary = {
  readonly binary: string;
  readonly isDaemon: boolean;
};

/**
 * The binaries a machine RUNNING `service` carries: every package that either
 * shares the service's name or ships its daemon.
 *
 * Read off the same catalog `apt install` installs from rather than restated
 * wherever a box is built, so a package that grows a binary grows it on every box
 * already running that service — and the world generator never has to be told
 * which package a door belongs to.
 *
 * The union is also what lets the two services whose daemons ship with the base
 * image fall out with no case of their own. Nothing in this catalog claims `sshd`
 * or `vsftpd`, so ssh matches nothing at all, ftp matches on its NAME and gets
 * only the client, and http and mysql match on their daemon.
 *
 * `extraFiles` are deliberately absent from this answer. The mysql package ships a
 * datadir drawn from the PLAYER's identity; a generated box already holds its own,
 * and laying the package's over it would overwrite every database in the world.
 */
export const binariesForService = ({
  service,
  daemon,
}: {
  readonly service: string;
  readonly daemon: string;
}): readonly ServiceBinary[] =>
  APT_PACKAGES.filter(
    (pkg) => pkg.name === service || daemonsOf(pkg).includes(daemon),
  ).flatMap((pkg) =>
    binariesOf(pkg).map((binary) => ({
      binary,
      isDaemon: daemonsOf(pkg).includes(binary),
    })),
  );
