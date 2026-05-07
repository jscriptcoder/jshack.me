import type { FileNode, FilePermissions } from '../filesystem/types';
import type { UserType } from '../session/types';
import { shouldProjectFsContent } from './projectedContentPaths';

// Pure flatten: walk a FileNode tree and produce one row per node, ready
// to bulk-insert into machine_filesystems. The shape mirrors the L2
// dual-write SQL function's UPSERT target — owner, permissions (JSONB),
// and content (nullable, projected only for paths in
// FS_PROJECTED_CONTENT_PATHS — currently /etc/passwd for the server-side
// userType validation in createSession).
//
// Used by:
//   - The home-network base-FS backfill (immediately after createNetwork)
//   - The one-time backfill script for existing machines
//   - World-network backfill — same flatten works
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
  // Populated only for paths in FS_PROJECTED_CONTENT_PATHS. All other
  // rows leave it null — content lives canonically in the patches table.
  readonly content?: string | null;
};

const joinPath = (basePath: string, name: string): string =>
  basePath === '/' ? `/${name}` : `${basePath}/${name}`;

const projectedContent = (node: FileNode, path: string): string | null =>
  shouldProjectFsContent(path) && node.type === 'file' ? (node.content ?? null) : null;

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
    content: projectedContent(node, basePath),
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
