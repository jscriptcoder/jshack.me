import type { FileNode, FilePermissions } from '../filesystem/types';
import type { UserType } from '../session/types';

// Pure flatten: walk a FileNode tree and produce one row per node, ready
// to bulk-insert into machine_filesystems. The shape mirrors the L2 dual-
// write SQL function's UPSERT target — owner, permissions (JSONB),
// node_type ('file' | 'directory'), content (nullable for directories).
//
// Used by:
//   - The home-network base-FS backfill (immediately after createNetwork)
//   - The one-time backfill script for existing machines
//   - Future world-network backfill (not in this PR; deferred follow-up)
//
// The function is intentionally tree-walking only — it doesn't know how
// to fetch the FileNode (caller does that via generateHomeNetwork etc.)
// and it doesn't know how to write rows to the DB (caller wires the
// bulk-insert seam). Pure → trivially testable, no Supabase needed.
//
// Path semantics: top-level call uses basePath = '/'. The function
// returns one row for the top-level node itself (path === basePath) and
// one row per descendant (path === basePath + '/' + child segments).
// Path '/' for the root, '/etc' for direct children of root, etc.

export type MachineFsRow = {
  readonly machine_id: string;
  readonly path: string;
  readonly owner: UserType;
  readonly permissions: FilePermissions;
  readonly node_type: 'file' | 'directory';
  readonly content: string | null;
};

const joinPath = (basePath: string, name: string): string =>
  basePath === '/' ? `/${name}` : `${basePath}/${name}`;

// Postgres TEXT columns reject NUL bytes (U+0000) with error code 22P05
// "unsupported Unicode escape sequence". The FS generator places binary
// placeholders (e.g. /usr/bin/nmap as 'ELF\0\0\0...') that carry them.
// We replace NULs with U+FFFD (REPLACEMENT CHARACTER) at flatten time,
// matching the existing handler-level sanitizeContent in
// patchRegistry/handler.ts so base-FS rows and patch rows have the same
// byte shape. Lossy for binary fidelity but the game doesn't depend on
// byte-exact round-trip; apt-installed binaries stay executable from
// gameplay's perspective.
//
// Built via String.fromCharCode rather than literal control characters
// so the source file stays ASCII (literal NUL in source is fragile —
// most editors render it invisibly and some strip it on save).
const NUL = String.fromCharCode(0);
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

const sanitizeContent = (content: string | null | undefined): string | null => {
  if (content === null || content === undefined) return null;
  return content.replaceAll(NUL, REPLACEMENT_CHARACTER);
};

export const flattenFileNode = (
  machineId: string,
  node: FileNode,
  basePath = '/',
): readonly MachineFsRow[] => {
  const self: MachineFsRow = {
    machine_id: machineId,
    path: basePath,
    owner: node.owner,
    permissions: node.permissions,
    node_type: node.type,
    content: node.type === 'file' ? sanitizeContent(node.content) : null,
  };
  if (node.type !== 'directory' || !node.children) return [self];
  const childRows = Object.entries(node.children).flatMap(([name, child]) =>
    flattenFileNode(machineId, child, joinPath(basePath, name)),
  );
  return [self, ...childRows];
};

// Convenience for callers that have a Record<machine_id, FileNode>
// (the shape generateHomeNetwork / generateFileSystems return). Flattens
// every machine's tree into a single rows array suitable for one bulk
// insert.
export const flattenFileSystemsToRows = (
  fileSystems: Readonly<Record<string, FileNode>>,
): readonly MachineFsRow[] =>
  Object.entries(fileSystems).flatMap(([machineId, root]) => flattenFileNode(machineId, root));
