/**
 * The cross-player READ filter (Story 2, slice 2c — tier 2).
 *
 * D1 (cross-player hops are SERVER-served): the server materializes the owner's
 * box (regenerated baseline + the owner's persisted patches) and must return a
 * tree pruned to exactly what the CALLER's tier may read — because the HTTP
 * response IS the threat surface (`project_read_path_privacy_gap`): anything left
 * in the body is visible to DevTools/curl regardless of how the UI renders it.
 *
 * Pruning reuses the shared permission walker (`canRead`, the same allow/deny the
 * write path enforces) so client and server can't drift: a node survives iff every
 * ancestor directory is traversable for the tier AND the node itself is readable.
 * A dropped directory takes its whole subtree with it. `root` reads everything
 * (the walker short-circuits), so a root caller gets the tree back unchanged.
 *
 * Tier 1 (owner → unfiltered) bypasses this module entirely (the handler returns
 * the materialized tree as-is). Tier 2 is the active-session walker tier below.
 * Tier 3 (no session → externally-observable allowlist) is `filterTreeToAllowlist`.
 */

import { canRead } from '../filesystem/walker';
import type { Directory, FileNode, FilePermissions } from '../filesystem/types';
import type { UserType } from '../types';

/** Filter one directory's entries for `userType`, recursing into surviving
 *  subdirectories. `parentChain` is every ancestor's perms from root down to this
 *  directory's parent — the chain the walker checks for traversability. */
const filterDir = (
  directory: Directory,
  userType: UserType,
  parentChain: readonly FilePermissions[],
): Directory => {
  const chain = [...parentChain, directory.perms];
  const entries = new Map<string, FileNode>(
    [...directory.entries]
      .filter(([, node]) => canRead(userType, node.perms, chain).allowed)
      .map(([name, node]) => [
        name,
        node.kind === 'directory' ? filterDir(node, userType, chain) : node,
      ]),
  );
  return { ...directory, entries };
};

/** Prune `tree` to the nodes `userType` may read, server-side, before it leaves
 *  over the wire. Pure: the input tree is never mutated. */
export const filterTreeForRead = (tree: Directory, userType: UserType): Directory =>
  filterDir(tree, userType, []);

/**
 * Externally-observable allowlist (tier 3 — no-session readers). Files whose
 * content leaks from off-box via simulated network protocols: pidfiles → open
 * ports, /var/www → curl, NAT rules → probing, the dpkg manifest → `nmap -sV`
 * versions. Everything NOT matching default-denies — /etc/passwd's inline hashes,
 * /root, home dotfiles, wallet keys. Ported from the legacy read-path filter.
 *
 * TRIPWIRE: /var/lib/dpkg/status leaks the whole package list, not just running
 * services. Harmless while CVEs are port-bound; if off-port (kernel/libc) CVEs
 * land, narrow it to running-service entries only.
 */
export const EXTERNALLY_OBSERVABLE_ALLOWLIST: readonly string[] = [
  '/var/run/*.pid',
  '/etc/iptables/rules.v4',
  '/etc/snmp/snmpd.conf',
  '/etc/switch/acl.conf',
  '/var/www/**',
  '/var/lib/dpkg/status',
];

const toSegments = (path: string): readonly string[] =>
  path.split('/').filter((segment) => segment.length > 0);

/** Match a single path segment against a glob segment: `*` matches any run of
 *  characters WITHIN the segment (never `/`). Anchored both ends, so `*.pid`
 *  matches `sshd.pid` but not `sshd.pid.bak`, and `rules.v4` matches only itself. */
const segmentMatches = (pattern: string, segment: string): boolean =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*')}$`,
  ).test(segment);

/** Glob-match a path's segments against a pattern's segments. A trailing `**`
 *  absorbs all remaining path segments (recursive) once the literal prefix before
 *  it matches; every other pattern segment matches exactly one path segment via
 *  `segmentMatches`. The allowlist only ever uses `**` as the LAST segment, so a
 *  terminal `**` is the only recursive form we implement. */
const segmentsMatch = (
  patternSegments: readonly string[],
  pathSegments: readonly string[],
): boolean => {
  const doubleStar = patternSegments.indexOf('**');
  if (doubleStar === -1) {
    return (
      patternSegments.length === pathSegments.length &&
      patternSegments.every((pattern, index) => segmentMatches(pattern, pathSegments[index]))
    );
  }
  const prefix = patternSegments.slice(0, doubleStar);
  return (
    pathSegments.length >= prefix.length &&
    prefix.every((pattern, index) => segmentMatches(pattern, pathSegments[index]))
  );
};

const matchesAllowlist = (path: string): boolean =>
  EXTERNALLY_OBSERVABLE_ALLOWLIST.some((pattern) =>
    segmentsMatch(toSegments(pattern), toSegments(path)),
  );

/** Prune one directory to the externally-observable allowlist: recurse first, then
 *  keep a file iff its absolute path matches the allowlist, and a directory iff it
 *  still has a surviving child (empty dirs are dropped so structure doesn't leak). */
const allowlistDir = (directory: Directory, prefix: string): Directory => {
  const entries = new Map<string, FileNode>(
    [...directory.entries]
      .map(([name, node]): [string, FileNode] => [
        name,
        node.kind === 'directory' ? allowlistDir(node, `${prefix}/${name}`) : node,
      ])
      .filter(([name, node]) =>
        node.kind === 'directory' ? node.entries.size > 0 : matchesAllowlist(`${prefix}/${name}`),
      ),
  );
  return { ...directory, entries };
};

/** Prune `tree` to ONLY the externally-observable allowlist (the no-session tier).
 *  Default-deny: anything off the allowlist is dropped before the response leaves.
 *  Pure: the input tree is never mutated. */
export const filterTreeToAllowlist = (tree: Directory): Directory => allowlistDir(tree, '');
