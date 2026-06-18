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
 * Ported from legacy `src/commands/availability.ts` (`APT_PACKAGES`), simplified
 * to `{ name, binaries? }`: the `description` / `version` / `extraFiles` fields
 * land with the future `apt install` command that actually installs them. The
 * mapping itself is faithful — these are the packages whose binaries the
 * connectivity arc and later exploit chains depend on.
 */

/** One installable apt package. `binaries` defaults to `[name]` when the
 *  package ships a single binary that matches its name. */
export type AptPackage = {
  readonly name: string;
  /** Binary names this package provides, when they differ from `name`. */
  readonly binaries?: readonly string[];
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
  { name: 'hydra' },
  { name: 'gobuster' },
  { name: 'snmp', binaries: ['snmpwalk', 'snmpset'] },
  { name: 'mysql' },
  { name: 'redis-tools', binaries: ['rediscli'] },
  { name: 'lynx' },
  { name: 'apache2' },
  { name: 'nginx' },
];

/** Binary name → package name, for the install hint. Derived from
 *  `APT_PACKAGES`: each package's binaries (or its own name) point back to it. */
const binaryToPackage: ReadonlyMap<string, string> = new Map(
  APT_PACKAGES.flatMap((pkg) => (pkg.binaries ?? [pkg.name]).map((binary) => [binary, pkg.name])),
);

/** The apt package that provides `binary`, or `undefined` if it isn't a known
 *  apt tool (a system utility, a builtin, or simply unknown). */
export const packageForBinary = (binary: string): string | undefined => binaryToPackage.get(binary);
