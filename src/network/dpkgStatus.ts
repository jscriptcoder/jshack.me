// Simplified parser + writer for /var/lib/dpkg/status.
//
// Real Debian/Ubuntu tracks installed package metadata in this file in an
// RFC-822-like format: entries separated by blank lines, each entry is a
// series of `Key: Value` lines. We use a small subset of the real fields
// (Package, Version, Status) and preserve any unknown fields when rewriting
// individual entries so future enrichment doesn't lose data.
//
// The game uses this file as the overlay source for service versions:
// - Generated at machine-creation time with one entry per running service
// - Mutated by `apt upgrade` when a player patches a service
// - Read by nmap / msfconsole via applyVersionOverlay

export const DPKG_STATUS_PATH = '/var/lib/dpkg/status';

export type DpkgEntry = {
  readonly pkg: string;
  readonly version: string;
  // Raw text of the full entry (all fields, in original order). When we
  // update the Version field, we preserve all other lines as-is.
  readonly rawBlock: string;
};

// Parse a dpkg status file into a map keyed by Package name. Unknown blocks
// (missing Package or Version) are silently skipped — they can't be used as
// version overlays anyway.
export const parseDpkgStatus = (content: string): ReadonlyMap<string, DpkgEntry> => {
  const entries = new Map<string, DpkgEntry>();
  if (content.trim().length === 0) return entries;

  const blocks = content.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const pkgMatch = /^Package:\s*(.+)$/m.exec(block);
    const versionMatch = /^Version:\s*(.+)$/m.exec(block);
    if (!pkgMatch || !versionMatch) continue;
    const pkg = pkgMatch[1]?.trim() ?? '';
    const version = versionMatch[1]?.trim() ?? '';
    if (pkg.length === 0 || version.length === 0) continue;
    entries.set(pkg, { pkg, version, rawBlock: block });
  }
  return entries;
};

// Shortcut for the common overlay read: just the Package → Version map.
export const parseDpkgVersions = (content: string): ReadonlyMap<string, string> => {
  const result = new Map<string, string>();
  for (const [pkg, entry] of parseDpkgStatus(content)) {
    result.set(pkg, entry.version);
  }
  return result;
};

// Serialize a list of entries back to file content. Blocks are separated by a
// single blank line, matching real dpkg status formatting.
export const formatDpkgStatus = (entries: readonly DpkgEntry[]): string =>
  entries.map((e) => e.rawBlock).join('\n\n') + '\n';

// Build a fresh entry for a new package. Used when seeding a machine's
// status file at generation time and when adding an entry during apt upgrade
// for a service that wasn't already tracked.
export const buildEntry = (pkg: string, version: string): DpkgEntry => ({
  pkg,
  version,
  rawBlock: `Package: ${pkg}\nStatus: install ok installed\nVersion: ${version}`,
});

// Build an initial dpkg status file for a machine, with one entry per
// unique service running on any of its ports. Used at generation time to
// seed a plausible /var/lib/dpkg/status so players see entries for their
// running services even on a fresh machine.
export const buildInitialDpkgStatus = (
  ports: readonly { readonly service: string; readonly serviceVersion: string }[],
): string => {
  const seen = new Map<string, string>();
  for (const port of ports) {
    if (!seen.has(port.service)) seen.set(port.service, port.serviceVersion);
  }
  if (seen.size === 0) return '';
  const entries = Array.from(seen, ([pkg, version]) => buildEntry(pkg, version));
  return formatDpkgStatus(entries);
};

// Update an existing entry's Version field while preserving all other lines
// in the block. If the package isn't present, a new entry is appended.
// Returns the new full file content.
export const setDpkgVersion = (content: string, pkg: string, version: string): string => {
  const existing = parseDpkgStatus(content);
  const allEntries: DpkgEntry[] = [];
  let replaced = false;

  for (const [existingPkg, entry] of existing) {
    if (existingPkg === pkg) {
      const newBlock = entry.rawBlock.replace(/^Version:\s*.+$/m, `Version: ${version}`);
      allEntries.push({ pkg, version, rawBlock: newBlock });
      replaced = true;
    } else {
      allEntries.push(entry);
    }
  }

  if (!replaced) {
    allEntries.push(buildEntry(pkg, version));
  }

  return formatDpkgStatus(allEntries);
};
