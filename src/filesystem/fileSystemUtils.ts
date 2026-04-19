import type { FileNode, FileSystemPatch, PermissionResult } from './types';
import type { MachineId } from './machineFileSystems';
import type { UserType } from '../session/SessionContext';

export type FileSystemsState = Readonly<Record<string, FileNode>>;

export const normalizePath = (path: string): string => {
  const parts = path.split('/').filter(Boolean);
  const resolved = parts.reduce<readonly string[]>((acc, part) => {
    if (part === '..') return acc.slice(0, -1);
    if (part !== '.') return [...acc, part];
    return acc;
  }, []);
  return '/' + resolved.join('/');
};

export const resolvePath = (path: string, cwd: string): string => {
  if (path.startsWith('/')) return normalizePath(path);
  if (path === '..') {
    const parts = cwd.split('/').filter(Boolean);
    return '/' + parts.slice(0, -1).join('/') || '/';
  }
  if (path === '.') return cwd;
  const combined = cwd === '/' ? `/${path}` : `${cwd}/${path}`;
  return normalizePath(combined);
};

// Verifies execute permission on every directory along the path (excluding the target itself).
// Real Unix requires execute (traverse) permission on each parent directory to access a file.
export const checkTraversal = (
  fs: FileNode,
  resolvedPath: string,
  userType: UserType,
): PermissionResult => {
  if (userType === 'root') return { allowed: true };

  const parts = resolvedPath.split('/').filter(Boolean);
  if (parts.length === 0) return { allowed: true };

  // Check execute on root directory
  if (!fs.permissions.execute.includes(userType)) {
    return { allowed: false, error: 'Permission denied: /' };
  }

  // Walk each parent directory (all segments except the last, which is the target)
  let current: FileNode = fs;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current.children) return { allowed: true };
    const next = current.children[parts[i] as string];
    if (!next) return { allowed: true };
    if (next.type === 'directory' && !next.permissions.execute.includes(userType)) {
      return { allowed: false, error: `Permission denied: /${parts.slice(0, i + 1).join('/')}` };
    }
    current = next;
  }

  return { allowed: true };
};

export const getNodeAtPath = (fs: FileNode, resolvedPath: string): FileNode | null => {
  const parts = resolvedPath.split('/').filter(Boolean);
  return parts.reduce<FileNode | null>((current, part) => {
    if (!current || current.type !== 'directory' || !current.children) return null;
    return current.children[part] ?? null;
  }, fs);
};

// Recursively navigates an immutable filesystem tree and applies `updater` to the
// node at `pathParts`. Returns a new tree with only the affected path rebuilt.
export const updateNodeAtPath = (
  root: FileNode,
  pathParts: readonly string[],
  updater: (node: FileNode) => FileNode,
): FileNode => {
  if (pathParts.length === 0) return updater(root);

  const [first, ...rest] = pathParts;
  if (root.type !== 'directory' || !root.children) return root;

  return {
    ...root,
    children: {
      ...root.children,
      [first]: updateNodeAtPath(root.children[first], rest, updater),
    },
  };
};

// Like addChildAtPath but creates missing intermediate directories automatically.
// Used by createFile to support deep paths (like mkdir -p + touch).
const mkDirNode = (name: string): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children: {},
});

export const ensureChildAtPath = (
  root: FileNode | undefined,
  pathParts: readonly string[],
  childName: string,
  child: FileNode,
): FileNode => {
  if (!root || root.type !== 'directory') {
    // If root is missing or not a directory, create a directory to hold the path
    const dir = root ?? mkDirNode('');
    if (dir.type !== 'directory') return dir;
    return ensureChildAtPath(dir, pathParts, childName, child);
  }

  if (pathParts.length === 0) {
    return {
      ...root,
      children: {
        ...root.children,
        [childName]: child,
      },
    };
  }

  const [first, ...rest] = pathParts;

  const existing = root.children?.[first] ?? mkDirNode(first as string);

  return {
    ...root,
    children: {
      ...root.children,
      [first]: ensureChildAtPath(existing, rest, childName, child),
    },
  };
};

export const addChildAtPath = (
  root: FileNode,
  pathParts: readonly string[],
  childName: string,
  child: FileNode,
): FileNode => {
  if (pathParts.length === 0) {
    if (root.type !== 'directory') return root;
    return {
      ...root,
      children: {
        ...root.children,
        [childName]: child,
      },
    };
  }

  const [first, ...rest] = pathParts;
  if (root.type !== 'directory' || !root.children) return root;

  return {
    ...root,
    children: {
      ...root.children,
      [first]: addChildAtPath(root.children[first], rest, childName, child),
    },
  };
};

// Immutably removes a named child from the directory at the given path.
// Uses destructuring to exclude the target child from the children record.
export const removeChildAtPath = (
  root: FileNode,
  pathParts: readonly string[],
  childName: string,
): FileNode => {
  if (pathParts.length === 0) {
    if (root.type !== 'directory' || !root.children) return root;
    const { [childName]: _removed, ...remaining } = root.children;
    return {
      ...root,
      children: remaining,
    };
  }

  const [first, ...rest] = pathParts;
  if (root.type !== 'directory' || !root.children) return root;

  return {
    ...root,
    children: {
      ...root.children,
      [first]: removeChildAtPath(root.children[first], rest, childName),
    },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isValidPermissions = (value: unknown): boolean =>
  isRecord(value) &&
  Array.isArray(value.read) &&
  Array.isArray(value.write) &&
  Array.isArray(value.execute);

export type DirectoryPlanResult =
  | { readonly ok: true; readonly toCreate: readonly string[] }
  | { readonly ok: false; readonly error: string };

// Plans which intermediate directories need to be created for a mkdir call.
// Pure — takes a node-lookup function and a parent-write-permission checker
// so it can be tested without a real filesystem. The caller is responsible
// for actually creating the directories returned in `toCreate`.
//
// Key invariant: only the FIRST missing segment's parent is checked for write
// permission. Once the chain starts creating new directories, the caller owns
// them, so their children don't need their parent re-validated — and couldn't
// be, since those parents aren't in the filesystem snapshot yet.
export const planDirectoryCreation = (options: {
  readonly parts: readonly string[];
  readonly targetPath: string;
  readonly parents: boolean;
  readonly getNode: (path: string) => FileNode | null;
  readonly canWriteParent: (path: string) => { readonly allowed: boolean };
}): DirectoryPlanResult => {
  const { parts, targetPath, parents, getNode, canWriteParent } = options;

  type State = { readonly cursor: string; readonly toCreate: readonly string[] };
  type Step =
    | { readonly ok: true; readonly state: State }
    | { readonly ok: false; readonly error: string };

  const final = parts.reduce<Step>(
    (step, segment, i) => {
      if (!step.ok) return step;
      const { cursor, toCreate } = step.state;
      const nextPath = cursor === '/' ? `/${segment}` : `${cursor}/${segment}`;
      const node = getNode(nextPath);

      if (node) {
        if (node.type !== 'directory') {
          return {
            ok: false,
            error: `mkdir: cannot create directory '${targetPath}': Not a directory`,
          };
        }
        return { ok: true, state: { cursor: nextPath, toCreate } };
      }

      const isFinalSegment = i === parts.length - 1;
      if (!isFinalSegment && !parents) {
        return {
          ok: false,
          error: `mkdir: cannot create directory '${targetPath}': No such file or directory`,
        };
      }

      // Only re-check the cursor's writability while the plan is still empty.
      // After that we own every subsequent parent by construction.
      if (toCreate.length === 0 && !canWriteParent(cursor).allowed) {
        return {
          ok: false,
          error: `mkdir: cannot create directory '${targetPath}': Permission denied`,
        };
      }

      return { ok: true, state: { cursor: nextPath, toCreate: [...toCreate, nextPath] } };
    },
    { ok: true, state: { cursor: '/', toCreate: [] } },
  );

  if (!final.ok) return final;
  return { ok: true, toCreate: final.state.toCreate };
};

export const isValidPatch = (value: unknown): value is FileSystemPatch =>
  isRecord(value) &&
  typeof value.machineId === 'string' &&
  typeof value.path === 'string' &&
  (typeof value.content === 'string' || value.content === null) &&
  typeof value.owner === 'string' &&
  ['root', 'user', 'guest'].includes(value.owner) &&
  (value.permissions === undefined || isValidPermissions(value.permissions)) &&
  (value.isNew === undefined || value.isNew === true) &&
  (value.nodeType === undefined || value.nodeType === 'file' || value.nodeType === 'directory');

// Preserves `isNew` from the existing patch so a create-then-write sequence
// retains the flag (enabling clean removal on deletion instead of a null patch).
export const upsertPatch = (
  patches: readonly FileSystemPatch[],
  patch: FileSystemPatch,
): readonly FileSystemPatch[] => {
  const existingIndex = patches.findIndex(
    (p) => p.machineId === patch.machineId && p.path === patch.path,
  );
  if (existingIndex === -1) return [...patches, patch];

  const existing = patches[existingIndex];
  const merged = existing?.isNew && !patch.isNew ? { ...patch, isNew: true as const } : patch;
  return patches.map((p, i) => (i === existingIndex ? merged : p));
};

// Replays filesystem patches onto a base filesystem state. Each patch either updates
// an existing file's content or creates a new file at the specified path with inferred
// permissions. This is how changes persist across page reloads via IndexedDB.
export const applyPatches = (
  base: FileSystemsState,
  patches: readonly FileSystemPatch[],
): FileSystemsState =>
  patches.reduce<FileSystemsState>((state, patch) => {
    const machineId = patch.machineId as MachineId;
    const machineFs = state[machineId];
    if (!machineFs) return state;

    const parts = patch.path.split('/').filter(Boolean);

    // Directory-create patch — upsert an empty directory at the path. No-op if
    // the directory (or any other node) already exists there, so replaying a
    // mkdir patch never clobbers contents added later by file patches.
    if (patch.nodeType === 'directory') {
      const existing = getNodeAtPath(machineFs, patch.path);
      if (existing) return state;
      const dirName = parts[parts.length - 1];
      const dirParts = parts.slice(0, -1);
      const newDir: FileNode = {
        name: dirName ?? '',
        type: 'directory',
        owner: patch.owner,
        permissions: patch.permissions ?? {
          read: ['root', 'user', 'guest'],
          write: ['root', patch.owner],
          execute: ['root', 'user', 'guest'],
        },
        children: {},
      };
      return {
        ...state,
        [machineId]: ensureChildAtPath(machineFs, dirParts, dirName ?? '', newDir),
      };
    }

    // Deletion patch — remove the node from the filesystem
    if (patch.content === null) {
      const childName = parts[parts.length - 1];
      const dirParts = parts.slice(0, -1);
      return {
        ...state,
        [machineId]: removeChildAtPath(machineFs, dirParts, childName),
      };
    }

    // After the null check above, content is guaranteed to be a string
    const content = patch.content;
    const existingNode = getNodeAtPath(machineFs, patch.path);

    if (existingNode) {
      return {
        ...state,
        [machineId]: updateNodeAtPath(machineFs, parts, (node) => ({
          ...node,
          content,
          // Use explicit patch permissions if provided, otherwise preserve original
          ...(patch.permissions ? { permissions: patch.permissions } : {}),
        })),
      };
    }

    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);
    const newFile: FileNode = {
      name: fileName,
      type: 'file',
      owner: patch.owner,
      // Use explicit patch permissions if provided, otherwise default to no-execute
      permissions: patch.permissions ?? {
        read: ['root', patch.owner],
        write: ['root', patch.owner],
        execute: ['root'],
      },
      content,
    };

    return {
      ...state,
      [machineId]: ensureChildAtPath(machineFs, dirParts, fileName, newFile),
    };
  }, base);
