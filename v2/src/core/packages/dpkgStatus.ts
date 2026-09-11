/**
 * `/var/lib/dpkg/status` — the package manifest every box carries, in the
 * RFC-822-like format real Debian uses: blocks separated by a blank line, each a
 * run of `Key: Value` lines.
 *
 * This is the game's single source of truth for what version a package is on. A
 * version scan reads it (`nmap -sV`), a CVE is keyed on it, and upgrading is what
 * moves it — which is why the service catalog's `banner` is deliberately
 * version-free: a build number announced by the daemon would be a second,
 * contradicting authority over the fact vulnerabilities are keyed on.
 *
 * `Package` is the APT package name (`openssh-server`, `bind9`, `libpcre`), never
 * the service label `nmap` prints — apt must not answer to two names for one
 * thing. `Version` is the bare tuple (`9.7.0`); the vendor prefix a scan displays
 * (`OpenSSH `) is presentation, and belongs to the version template.
 *
 * Unknown fields in a block are preserved when rewriting, so enrichment later
 * cannot lose data it does not understand.
 */

import type { Directory, FilePermissions } from '../filesystem/types';
import { SERVICE_CONFIG_FILE } from '../generation/baseFs';

/** Where the manifest lives, who owns it and what it permits — shared by the generator
 *  that stamps it and every command that rewrites it, so a patched manifest and a
 *  generated one cannot disagree. World-readable, root-write, never executable: real
 *  dpkg's 644 root:root, and the same rung `/etc/*.conf` sits on, because what software
 *  a box runs is the lowest tier of recon and costs no credential. The tier-3 allowlist
 *  already publishes it, so this permission and that allowlist entry have to agree. */
export const DPKG_STATUS_PATH = '/var/lib/dpkg/status';
export const DPKG_STATUS_OWNER = 'root';
export const DPKG_STATUS_PERMISSIONS: FilePermissions = SERVICE_CONFIG_FILE;

export type DpkgEntry = {
  readonly pkg: string;
  readonly version: string;
  /** The block's full text, fields in their original order. */
  readonly rawBlock: string;
};

// Horizontal whitespace only. `\s*` here — which is what legacy used — also matches
// the newline, so a `Package:` line with an empty value swallows the line BELOW it as
// its own value: a block reading `Package:` then `Version: 3.0.0` parses as a package
// literally named "Version: 3.0.0". A field's value cannot span lines in RFC-822.
const PACKAGE_FIELD = /^Package:[ \t]*(.+)$/m;
const VERSION_FIELD = /^Version:[ \t]*(.+)$/m;

/** Parse a status file into entries keyed by package name. A block missing either
 *  field names no package or no version, so it cannot answer the one question this
 *  file exists to answer, and is skipped rather than half-read. */
export const parseDpkgStatus = (content: string): ReadonlyMap<string, DpkgEntry> =>
  new Map(
    content
      // No empty-block filter: the separator's own `\s*` absorbs runs of blank lines,
      // so the only block splitting can ever yield empty is from empty input — and
      // that one is dropped below anyway for naming neither field.
      .split(/\n\s*\n/)
      .flatMap((block) => {
        const pkg = PACKAGE_FIELD.exec(block)?.[1]?.trim() ?? '';
        const version = VERSION_FIELD.exec(block)?.[1]?.trim() ?? '';
        if (pkg.length === 0 || version.length === 0) return [];
        return [[pkg, { pkg, version, rawBlock: block }] as const];
      }),
  );

/** The common read: package → version, with the blocks dropped. */
export const parseDpkgVersions = (content: string): ReadonlyMap<string, string> =>
  new Map(Array.from(parseDpkgStatus(content), ([pkg, entry]) => [pkg, entry.version]));

/** One installed package's block. `Status` is the only value real dpkg ever shows
 *  for a package the box actually has — nothing in the game models half-installed
 *  or removed-but-configured states. */
export const buildEntry = (pkg: string, version: string): DpkgEntry => ({
  pkg,
  version,
  rawBlock: `Package: ${pkg}\nStatus: install ok installed\nVersion: ${version}`,
});

/** The manifest with one package's version changed and every other byte left where it
 *  was: fields nothing here understands, blocks the parser skips, the blank lines
 *  between them. An upgrade moves a version; it does not get to tidy a file its owner
 *  may have written by hand. Split on the parser's own separator, so the block rewritten
 *  is the block a reader reads. */
export const withPackageVersion = (content: string, pkg: string, version: string): string =>
  content
    .split(/(\n\s*\n)/)
    .map((block) =>
      PACKAGE_FIELD.exec(block)?.[1]?.trim() === pkg
        ? block.replace(VERSION_FIELD, `Version: ${version}`)
        : block,
    )
    .join('');

/** Serialize entries back to file content: one blank line between blocks, and a
 *  trailing newline, as dpkg writes it. */
export const formatDpkgStatus = (entries: readonly DpkgEntry[]): string =>
  `${entries.map((entry) => entry.rawBlock).join('\n\n')}\n`;

/** The manifest with rows appended for packages it does not name yet, in dpkg's own
 *  shape — a blank line between blocks — and every existing byte left where it was. */
export const withPackageEntries = (content: string, entries: readonly DpkgEntry[]): string => {
  if (entries.length === 0) return content;
  const appended = formatDpkgStatus(entries);
  return content.trim() === '' ? appended : `${content}\n${appended}`;
};

/** The manifest text off a box's tree, or '' for a box that carries no manifest —
 *  which parses to no packages, so a missing file is a missing answer rather than a
 *  crash. Walks the tree the way the port readers do; this layer has no path
 *  resolver. Shared by every reader so a box cannot report one version to a scan and
 *  another to `apt`. */
export const readDpkgStatus = (root: Directory): string => {
  const varDir = root.entries.get('var');
  if (varDir?.kind !== 'directory') return '';
  const lib = varDir.entries.get('lib');
  if (lib?.kind !== 'directory') return '';
  const dpkg = lib.entries.get('dpkg');
  if (dpkg?.kind !== 'directory') return '';
  const status = dpkg.entries.get('status');
  return status?.kind === 'file' ? status.content : '';
};
