import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { FileNode, FileSystemPatch, PermissionResult } from './types';
import { useSession, type UserType } from '../session/SessionContext';
import { machineFileSystems, getDefaultHomePath, type MachineId } from './machineFileSystems';
import { getCachedFilesystemPatches, getDatabase } from '../utils/storageCache';
import { saveFilesystemPatches } from '../utils/storage';

type FileSystemContextValue = {
  readonly fileSystem: FileNode;
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly canRead: (path: string, userType: UserType) => PermissionResult;
  readonly canWrite: (path: string, userType: UserType) => PermissionResult;
  readonly listDirectory: (path: string, userType: UserType) => string[] | null;
  readonly readFile: (path: string, userType: UserType) => string | null;
  readonly writeFile: (path: string, content: string, userType: UserType) => PermissionResult;
  readonly createFile: (path: string, content: string, userType: UserType) => PermissionResult;
  readonly getDefaultHomePath: (machineId: string, username: string) => string;
  readonly resolvePathForMachine: (path: string, cwd: string) => string;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly canReadFromMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    userType: UserType,
  ) => PermissionResult;
  readonly canWriteFromMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    userType: UserType,
  ) => PermissionResult;
  readonly listDirectoryFromMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    userType: UserType,
  ) => string[] | null;
  readonly readFileFromMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    userType: UserType,
  ) => string | null;
  readonly writeFileToMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    content: string,
    userType: UserType,
  ) => PermissionResult;
  readonly createFileOnMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    content: string,
    userType: UserType,
  ) => PermissionResult;
};

const FileSystemContext = createContext<FileSystemContextValue | null>(null);

// Recursively navigates an immutable filesystem tree and applies `updater` to the
// node at `pathParts`. Returns a new tree with only the affected path rebuilt.
const updateNodeAtPath = (
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

const addChildAtPath = (
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

type FileSystemsState = Readonly<Record<string, FileNode>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isValidPatch = (value: unknown): value is FileSystemPatch =>
  isRecord(value) &&
  typeof value.machineId === 'string' &&
  typeof value.path === 'string' &&
  typeof value.content === 'string' &&
  typeof value.owner === 'string' &&
  ['root', 'user', 'guest'].includes(value.owner);

const getNodeFromFileSystemStatic = (fs: FileNode, resolvedPath: string): FileNode | null => {
  const parts = resolvedPath.split('/').filter(Boolean);
  return parts.reduce<FileNode | null>((current, part) => {
    if (!current || current.type !== 'directory' || !current.children) return null;
    return current.children[part] ?? null;
  }, fs);
};

// Replays filesystem patches onto a base filesystem state. Each patch either updates
// an existing file's content or creates a new file at the specified path with inferred
// permissions. This is how changes persist across page reloads via IndexedDB.
const applyPatches = (
  base: FileSystemsState,
  patches: readonly FileSystemPatch[],
): FileSystemsState =>
  patches.reduce<FileSystemsState>((state, patch) => {
    const machineId = patch.machineId as MachineId;
    const machineFs = state[machineId];
    if (!machineFs) return state;

    const parts = patch.path.split('/').filter(Boolean);
    const existingNode = getNodeFromFileSystemStatic(machineFs, patch.path);

    if (existingNode) {
      return {
        ...state,
        [machineId]: updateNodeAtPath(machineFs, parts, (node) => ({
          ...node,
          content: patch.content,
        })),
      };
    }

    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);
    const newFile: FileNode = {
      name: fileName,
      type: 'file',
      owner: patch.owner,
      permissions: {
        read: ['root', patch.owner],
        write: ['root', patch.owner],
        execute: ['root', patch.owner],
      },
      content: patch.content,
    };

    return {
      ...state,
      [machineId]: addChildAtPath(machineFs, dirParts, fileName, newFile),
    };
  }, base);

const upsertPatch = (
  patches: readonly FileSystemPatch[],
  patch: FileSystemPatch,
): readonly FileSystemPatch[] => {
  const existingIndex = patches.findIndex(
    (p) => p.machineId === patch.machineId && p.path === patch.path,
  );
  if (existingIndex === -1) return [...patches, patch];

  return patches.map((p, i) => (i === existingIndex ? patch : p));
};

const STATIC_MACHINE_KEYS = new Set(Object.keys(machineFileSystems));

const initializeFileSystems = (): FileSystemsState =>
  applyPatches({ ...machineFileSystems }, getCachedFilesystemPatches());

type FileSystemProviderProps = {
  readonly children: ReactNode;
  readonly missionFileSystems?: Readonly<Record<string, FileNode>>;
};

export const FileSystemProvider = ({ children, missionFileSystems }: FileSystemProviderProps) => {
  const { session } = useSession();
  const [fileSystems, setFileSystems] = useState<FileSystemsState>(initializeFileSystems);
  const [patches, setPatches] = useState<readonly FileSystemPatch[]>(getCachedFilesystemPatches);

  // Only persist patches for static (tutorial) machines — mission filesystem patches are
  // excluded because missions regenerate entirely from their seed on reload.
  useEffect(() => {
    const db = getDatabase();
    if (db) {
      const staticPatches = patches.filter((p) => STATIC_MACHINE_KEYS.has(p.machineId));
      saveFilesystemPatches(db, staticPatches);
    }
  }, [patches]);

  // When a mission starts/ends, merge or remove mission filesystems.
  // Static machine filesystems are always preserved; mission ones are overlaid on top.
  useEffect(() => {
    setFileSystems((prev) => {
      const staticOnly = Object.fromEntries(
        Object.entries(prev).filter(([key]) => STATIC_MACHINE_KEYS.has(key)),
      );
      if (!missionFileSystems) return staticOnly;
      return { ...staticOnly, ...missionFileSystems };
    });
  }, [missionFileSystems]);

  // session.machine is typed as string but always holds a valid MachineId at runtime
  // (set by SSH/session logic). The assertion avoids threading MachineId through SessionContext.
  const currentMachine = session.machine as MachineId;
  const currentPath = session.currentPath;
  // Fallback to localhost as a safety net — in practice currentMachine always matches
  // a key in fileSystems because SSH only connects to known machines
  const fileSystem = fileSystems[currentMachine] ?? fileSystems['localhost'];

  const normalizePath = useCallback((path: string): string => {
    const parts = path.split('/').filter(Boolean);
    const resolved = parts.reduce<readonly string[]>((acc, part) => {
      if (part === '..') return acc.slice(0, -1);
      if (part !== '.') return [...acc, part];
      return acc;
    }, []);
    return '/' + resolved.join('/');
  }, []);

  const resolvePathForMachine = useCallback(
    (path: string, cwd: string): string => {
      if (path.startsWith('/')) return normalizePath(path);
      if (path === '..') {
        const parts = cwd.split('/').filter(Boolean);
        return '/' + parts.slice(0, -1).join('/') || '/';
      }
      if (path === '.') return cwd;
      const combined = cwd === '/' ? `/${path}` : `${cwd}/${path}`;
      return normalizePath(combined);
    },
    [normalizePath],
  );

  const resolvePath = useCallback(
    (path: string): string => {
      return resolvePathForMachine(path, currentPath);
    },
    [resolvePathForMachine, currentPath],
  );

  const getNodeFromFileSystem = useCallback(
    (fs: FileNode, resolvedPath: string): FileNode | null => {
      const parts = resolvedPath.split('/').filter(Boolean);
      return parts.reduce<FileNode | null>((current, part) => {
        if (!current || current.type !== 'directory' || !current.children) return null;
        return current.children[part] ?? null;
      }, fs);
    },
    [],
  );

  const getNodeFromMachine = useCallback(
    (machineId: MachineId, path: string, cwd: string): FileNode | null => {
      const fs = fileSystems[machineId];
      if (!fs) return null;
      const resolvedPath = resolvePathForMachine(path, cwd);
      return getNodeFromFileSystem(fs, resolvedPath);
    },
    [fileSystems, resolvePathForMachine, getNodeFromFileSystem],
  );

  const getNode = useCallback(
    (path: string): FileNode | null => {
      const resolvedPath = path.startsWith('/') ? path : resolvePath(path);
      return getNodeFromFileSystem(fileSystem, resolvedPath);
    },
    [fileSystem, resolvePath, getNodeFromFileSystem],
  );

  const canReadFromMachine = useCallback(
    (machineId: MachineId, path: string, cwd: string, userType: UserType): PermissionResult => {
      const node = getNodeFromMachine(machineId, path, cwd);
      if (!node) return { allowed: false, error: `No such file or directory: ${path}` };
      if (!node.permissions.read.includes(userType))
        return { allowed: false, error: `Permission denied: ${path}` };
      return { allowed: true };
    },
    [getNodeFromMachine],
  );

  const canWriteFromMachine = useCallback(
    (machineId: MachineId, path: string, cwd: string, userType: UserType): PermissionResult => {
      const node = getNodeFromMachine(machineId, path, cwd);
      if (!node) return { allowed: false, error: `No such file or directory: ${path}` };
      if (!node.permissions.write.includes(userType))
        return { allowed: false, error: `Permission denied: ${path}` };
      return { allowed: true };
    },
    [getNodeFromMachine],
  );

  const canRead = useCallback(
    (path: string, userType: UserType): PermissionResult => {
      return canReadFromMachine(currentMachine, path, currentPath, userType);
    },
    [canReadFromMachine, currentMachine, currentPath],
  );

  const canWrite = useCallback(
    (path: string, userType: UserType): PermissionResult => {
      return canWriteFromMachine(currentMachine, path, currentPath, userType);
    },
    [canWriteFromMachine, currentMachine, currentPath],
  );

  const listDirectoryFromMachine = useCallback(
    (machineId: MachineId, path: string, cwd: string, userType: UserType): string[] | null => {
      const permission = canReadFromMachine(machineId, path, cwd, userType);
      if (!permission.allowed) return null;

      const node = getNodeFromMachine(machineId, path, cwd);
      if (!node || node.type !== 'directory' || !node.children) return null;

      return Object.keys(node.children).sort();
    },
    [canReadFromMachine, getNodeFromMachine],
  );

  const readFileFromMachine = useCallback(
    (machineId: MachineId, path: string, cwd: string, userType: UserType): string | null => {
      const permission = canReadFromMachine(machineId, path, cwd, userType);
      if (!permission.allowed) return null;

      const node = getNodeFromMachine(machineId, path, cwd);
      if (!node || node.type !== 'file') return null;

      return node.content ?? '';
    },
    [canReadFromMachine, getNodeFromMachine],
  );

  const listDirectory = useCallback(
    (path: string, userType: UserType): string[] | null => {
      return listDirectoryFromMachine(currentMachine, path, currentPath, userType);
    },
    [listDirectoryFromMachine, currentMachine, currentPath],
  );

  const readFile = useCallback(
    (path: string, userType: UserType): string | null => {
      return readFileFromMachine(currentMachine, path, currentPath, userType);
    },
    [readFileFromMachine, currentMachine, currentPath],
  );

  const writeFileToMachine = useCallback(
    (
      machineId: MachineId,
      path: string,
      cwd: string,
      content: string,
      userType: UserType,
    ): PermissionResult => {
      const permission = canWriteFromMachine(machineId, path, cwd, userType);
      if (!permission.allowed) return permission;

      const node = getNodeFromMachine(machineId, path, cwd);
      if (!node || node.type !== 'file') return { allowed: false, error: `Not a file: ${path}` };

      const resolvedPath = resolvePathForMachine(path, cwd);
      const parts = resolvedPath.split('/').filter(Boolean);
      setFileSystems((prev) => ({
        ...prev,
        [machineId]: updateNodeAtPath(prev[machineId], parts, (fileNode) => ({
          ...fileNode,
          content,
        })),
      }));

      setPatches((prev) =>
        upsertPatch(prev, { machineId, path: resolvedPath, content, owner: node.owner }),
      );

      return { allowed: true };
    },
    [canWriteFromMachine, getNodeFromMachine, resolvePathForMachine],
  );

  const createFileOnMachine = useCallback(
    (
      machineId: MachineId,
      path: string,
      cwd: string,
      content: string,
      userType: UserType,
    ): PermissionResult => {
      const resolvedPath = resolvePathForMachine(path, cwd);
      const parts = resolvedPath.split('/').filter(Boolean);
      const fileName = parts[parts.length - 1];
      const dirParts = parts.slice(0, -1);
      const dirPath = '/' + dirParts.join('/') || '/';

      const parentPermission = canWriteFromMachine(machineId, dirPath, '/', userType);
      if (!parentPermission.allowed) return parentPermission;

      const parentNode = getNodeFromMachine(machineId, dirPath, '/');
      if (!parentNode || parentNode.type !== 'directory')
        return { allowed: false, error: `Not a directory: ${dirPath}` };
      if (parentNode.children?.[fileName]) return { allowed: false, error: `File exists: ${path}` };

      const newFile: FileNode = {
        name: fileName,
        type: 'file',
        owner: userType,
        permissions: {
          read: ['root', userType],
          write: ['root', userType],
          execute: ['root', userType],
        },
        content,
      };

      setFileSystems((prev) => ({
        ...prev,
        [machineId]: addChildAtPath(prev[machineId], dirParts, fileName, newFile),
      }));

      setPatches((prev) =>
        upsertPatch(prev, { machineId, path: resolvedPath, content, owner: userType }),
      );

      return { allowed: true };
    },
    [resolvePathForMachine, canWriteFromMachine, getNodeFromMachine],
  );

  const writeFile = useCallback(
    (path: string, content: string, userType: UserType): PermissionResult => {
      return writeFileToMachine(currentMachine, path, currentPath, content, userType);
    },
    [writeFileToMachine, currentMachine, currentPath],
  );

  const createFile = useCallback(
    (path: string, content: string, userType: UserType): PermissionResult => {
      return createFileOnMachine(currentMachine, path, currentPath, content, userType);
    },
    [createFileOnMachine, currentMachine, currentPath],
  );

  const getDefaultHomePathFn = useCallback((machineId: string, username: string): string => {
    return getDefaultHomePath(machineId, username);
  }, []);

  return (
    <FileSystemContext.Provider
      value={{
        fileSystem,
        resolvePath,
        getNode,
        canRead,
        canWrite,
        listDirectory,
        readFile,
        writeFile,
        createFile,
        getDefaultHomePath: getDefaultHomePathFn,
        resolvePathForMachine,
        getNodeFromMachine,
        canReadFromMachine,
        canWriteFromMachine,
        listDirectoryFromMachine,
        readFileFromMachine,
        writeFileToMachine,
        createFileOnMachine,
      }}
    >
      {children}
    </FileSystemContext.Provider>
  );
};

export const useFileSystem = (): FileSystemContextValue => {
  const context = useContext(FileSystemContext);
  if (!context) {
    throw new Error('useFileSystem must be used within a FileSystemProvider');
  }
  return context;
};
