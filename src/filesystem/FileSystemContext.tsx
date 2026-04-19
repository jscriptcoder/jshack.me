import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  FileNode,
  FilePermissions,
  FileSystemPatch,
  MachineCreateOp,
  MachineDeleteOp,
  MachineFileOp,
  MachineMkdirOp,
  MachineWriteOp,
  PermissionResult,
} from './types';
import { useSession, type UserType } from '../session/SessionContext';
import { getDefaultHomePath, type MachineId } from './machineFileSystems';
import { getCachedFilesystemPatches, getDatabase } from '../utils/storageCache';
import { saveFilesystemPatches } from '../utils/storage';
import { createSyncChannel, type SyncMessage } from '../utils/crossTabSync';
import {
  resolvePath as resolvePathUtil,
  getNodeAtPath,
  checkTraversal,
  updateNodeAtPath,
  ensureChildAtPath,
  removeChildAtPath,
  upsertPatch,
  applyPatches,
  type FileSystemsState,
} from './fileSystemUtils';

type FileSystemContextValue = {
  readonly fileSystem: FileNode;
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly canRead: (path: string, userType: UserType) => PermissionResult;
  readonly canWrite: (path: string, userType: UserType) => PermissionResult;
  readonly listDirectory: (path: string, userType: UserType) => string[] | null;
  readonly readFile: (path: string, userType: UserType) => string | null;
  readonly writeFile: (path: string, content: string, userType: UserType) => PermissionResult;
  readonly createFile: (
    path: string,
    content: string,
    userType: UserType,
    permissions?: FilePermissions,
  ) => PermissionResult;
  readonly createDirectory: (
    path: string,
    userType: UserType,
    options?: { readonly parents?: boolean; readonly permissions?: FilePermissions },
  ) => PermissionResult;
  readonly deleteNode: (
    path: string,
    userType: UserType,
    options?: { readonly recursive?: boolean },
  ) => PermissionResult;
  readonly getDefaultHomePath: (machineId: string, username: string) => string;
  readonly resolvePathForMachine: (path: string, cwd: string) => string;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly canReadFromMachine: (op: MachineFileOp) => PermissionResult;
  readonly canWriteFromMachine: (op: MachineFileOp) => PermissionResult;
  readonly listDirectoryFromMachine: (op: MachineFileOp) => string[] | null;
  readonly readFileFromMachine: (op: MachineFileOp) => string | null;
  readonly writeFileToMachine: (op: MachineWriteOp) => PermissionResult;
  readonly createFileOnMachine: (op: MachineCreateOp) => PermissionResult;
  readonly createDirectoryOnMachine: (op: MachineMkdirOp) => PermissionResult;
  readonly deleteNodeFromMachine: (op: MachineDeleteOp) => PermissionResult;
  readonly updatePermissions: (
    path: string,
    permissions: FilePermissions,
    userType: UserType,
  ) => PermissionResult;
  readonly canTraverse: (path: string, userType: UserType) => PermissionResult;
  readonly canTraverseOnMachine: (
    machineId: MachineId,
    path: string,
    userType: UserType,
  ) => PermissionResult;
};

const FileSystemContext = createContext<FileSystemContextValue | null>(null);

// Only localhost persists across WiFi/mission transitions
const PERSISTENT_MACHINE_KEYS = new Set(['localhost']);

type FileSystemProviderProps = {
  readonly children: ReactNode;
  readonly localhostFileSystem: FileNode;
  readonly missionFileSystems?: Readonly<Record<string, FileNode>>;
  readonly homeFileSystems?: Readonly<Record<string, FileNode>>;
};

export const FileSystemProvider = ({
  children,
  localhostFileSystem,
  missionFileSystems,
  homeFileSystems,
}: FileSystemProviderProps) => {
  const { session } = useSession();
  const [fileSystems, setFileSystems] = useState<FileSystemsState>(() =>
    applyPatches({ localhost: localhostFileSystem }, getCachedFilesystemPatches()),
  );
  const [patches, setPatches] = useState<readonly FileSystemPatch[]>(getCachedFilesystemPatches);
  // Create channel inside effect so StrictMode's cleanup + re-run cycle gets
  // a fresh (open) channel. The ref is updated so broadcastAndRecordPatch always
  // posts on the currently-active channel.
  const syncChannelRef = useRef<ReturnType<typeof createSyncChannel> | null>(null);

  // Subscribe to filesystem patches from other tabs.
  // BroadcastChannel does not deliver messages to the posting tab, so no echo guard needed.
  useEffect(() => {
    const channel = createSyncChannel();
    syncChannelRef.current = channel;
    channel.onMessage((message: SyncMessage) => {
      if (message.type !== 'filesystem-patch') return;
      const patch = message.patch;

      setFileSystems((prev) => applyPatches(prev, [patch]));
      setPatches((prev) => {
        if (patch.content !== null) return upsertPatch(prev, patch);

        const existing = prev.find((p) => p.machineId === patch.machineId && p.path === patch.path);
        const deletedPrefix = patch.path.endsWith('/') ? patch.path : patch.path + '/';
        const withoutChildren = prev.filter(
          (p) => !(p.machineId === patch.machineId && p.path.startsWith(deletedPrefix)),
        );

        if (existing?.isNew) {
          return withoutChildren.filter(
            (p) => !(p.machineId === patch.machineId && p.path === patch.path),
          );
        }

        return upsertPatch(withoutChildren, patch);
      });
    });
    return () => channel.close();
  }, []);

  // Persist all patches (static + mission) to IndexedDB. Mission patches are replayed
  // on top of regenerated filesystems when the page reloads with an active mission seed.
  useEffect(() => {
    const db = getDatabase();
    if (db) {
      saveFilesystemPatches(db, [...patches]);
    }
  }, [patches]);

  // Track whether the missionFileSystems effect is running for the first time.
  // On initial mount with a persisted mission, we replay cached patches so the
  // user's in-progress work (apt installs, nano edits, etc.) survives page reload.
  const isInitialMissionMount = useRef(true);

  // Snapshot of cached patches at mount time — used only once during initial
  // mission replay and never updated, avoiding a stale dependency in the effect.
  const cachedPatchesAtMount = useMemo(() => getCachedFilesystemPatches(), []);

  // When a mission starts/ends, merge or remove mission filesystems.
  // Static machine filesystems are always preserved; mission ones are overlaid on top.
  useEffect(() => {
    // On runtime mission transitions (not initial mount), clean up old mission
    // patches — they belong to the previous mission and shouldn't carry over.
    if (!isInitialMissionMount.current) {
      setPatches((prev) => prev.filter((p) => PERSISTENT_MACHINE_KEYS.has(p.machineId)));
    }

    setFileSystems((prev) => {
      const staticOnly = Object.fromEntries(
        Object.entries(prev).filter(([key]) => PERSISTENT_MACHINE_KEYS.has(key)),
      );

      // Layer: static (localhost) + home network + mission network
      const withHome = homeFileSystems ? { ...staticOnly, ...homeFileSystems } : staticOnly;
      const merged = missionFileSystems ? { ...withHome, ...missionFileSystems } : withHome;

      if (!missionFileSystems && !homeFileSystems) {
        isInitialMissionMount.current = false;
        return staticOnly;
      }

      // On initial mount, replay persisted non-static patches on top of regenerated
      // filesystems so the user's in-progress changes survive page reload.
      if (isInitialMissionMount.current) {
        isInitialMissionMount.current = false;
        const dynamicPatches = cachedPatchesAtMount.filter(
          (p) => !PERSISTENT_MACHINE_KEYS.has(p.machineId),
        );
        if (dynamicPatches.length > 0) {
          return applyPatches(merged, dynamicPatches);
        }
      }

      return merged;
    });
  }, [missionFileSystems, homeFileSystems, cachedPatchesAtMount]);

  // session.machine is typed as string but always holds a valid MachineId at runtime
  // (set by SSH/session logic). The assertion avoids threading MachineId through SessionContext.
  const currentMachine = session.machine as MachineId;
  const currentPath = session.currentPath;
  // Fallback to localhost as a safety net — in practice currentMachine always matches
  // a key in fileSystems because SSH only connects to known machines
  const fileSystem = fileSystems[currentMachine] ?? fileSystems['localhost'];

  const resolvePathForMachine = useCallback(
    (path: string, cwd: string): string => resolvePathUtil(path, cwd),
    [],
  );

  const resolvePath = useCallback(
    (path: string): string => resolvePathUtil(path, currentPath),
    [currentPath],
  );

  const getNodeFromMachine = useCallback(
    (machineId: MachineId, path: string, cwd: string): FileNode | null => {
      const fs = fileSystems[machineId];
      if (!fs) return null;
      const resolvedPath = resolvePathUtil(path, cwd);
      return getNodeAtPath(fs, resolvedPath);
    },
    [fileSystems],
  );

  const getNode = useCallback(
    (path: string): FileNode | null => {
      const resolvedPath = path.startsWith('/') ? path : resolvePathUtil(path, currentPath);
      return getNodeAtPath(fileSystem, resolvedPath);
    },
    [fileSystem, currentPath],
  );

  const canReadFromMachine = useCallback(
    ({ machineId, path, cwd, userType }: MachineFileOp): PermissionResult => {
      const fs = fileSystems[machineId];
      if (!fs) return { allowed: false, error: `No such file or directory: ${path}` };
      const resolvedPath = resolvePathUtil(path, cwd);
      const traversal = checkTraversal(fs, resolvedPath, userType);
      if (!traversal.allowed) return { allowed: false, error: `Permission denied: ${path}` };
      const node = getNodeAtPath(fs, resolvedPath);
      if (!node) return { allowed: false, error: `No such file or directory: ${path}` };
      if (!node.permissions.read.includes(userType))
        return { allowed: false, error: `Permission denied: ${path}` };
      return { allowed: true };
    },
    [fileSystems],
  );

  const canWriteFromMachine = useCallback(
    ({ machineId, path, cwd, userType }: MachineFileOp): PermissionResult => {
      const fs = fileSystems[machineId];
      if (!fs) return { allowed: false, error: `No such file or directory: ${path}` };
      const resolvedPath = resolvePathUtil(path, cwd);
      const traversal = checkTraversal(fs, resolvedPath, userType);
      if (!traversal.allowed) return { allowed: false, error: `Permission denied: ${path}` };
      const node = getNodeAtPath(fs, resolvedPath);
      if (!node) return { allowed: false, error: `No such file or directory: ${path}` };
      if (!node.permissions.write.includes(userType))
        return { allowed: false, error: `Permission denied: ${path}` };
      return { allowed: true };
    },
    [fileSystems],
  );

  const canRead = useCallback(
    (path: string, userType: UserType): PermissionResult => {
      return canReadFromMachine({ machineId: currentMachine, path, cwd: currentPath, userType });
    },
    [canReadFromMachine, currentMachine, currentPath],
  );

  const canWrite = useCallback(
    (path: string, userType: UserType): PermissionResult => {
      return canWriteFromMachine({ machineId: currentMachine, path, cwd: currentPath, userType });
    },
    [canWriteFromMachine, currentMachine, currentPath],
  );

  const listDirectoryFromMachine = useCallback(
    (op: MachineFileOp): string[] | null => {
      const permission = canReadFromMachine(op);
      if (!permission.allowed) return null;

      const node = getNodeFromMachine(op.machineId, op.path, op.cwd);
      if (!node || node.type !== 'directory' || !node.children) return null;

      return Object.keys(node.children).sort();
    },
    [canReadFromMachine, getNodeFromMachine],
  );

  const readFileFromMachine = useCallback(
    (op: MachineFileOp): string | null => {
      const permission = canReadFromMachine(op);
      if (!permission.allowed) return null;

      const node = getNodeFromMachine(op.machineId, op.path, op.cwd);
      if (!node || node.type !== 'file') return null;

      return node.content ?? '';
    },
    [canReadFromMachine, getNodeFromMachine],
  );

  const listDirectory = useCallback(
    (path: string, userType: UserType): string[] | null => {
      return listDirectoryFromMachine({
        machineId: currentMachine,
        path,
        cwd: currentPath,
        userType,
      });
    },
    [listDirectoryFromMachine, currentMachine, currentPath],
  );

  const readFile = useCallback(
    (path: string, userType: UserType): string | null => {
      return readFileFromMachine({ machineId: currentMachine, path, cwd: currentPath, userType });
    },
    [readFileFromMachine, currentMachine, currentPath],
  );

  // Broadcasts a patch to other tabs and updates local patch state.
  // Deletion of a patch-created file (isNew) removes the patch entirely instead of
  // recording a null patch — the file never existed in the base filesystem.
  // Deletion of a base filesystem file records a null patch.
  // Both cases also remove any child patches under the deleted path.
  const broadcastAndRecordPatch = useCallback((patch: FileSystemPatch) => {
    syncChannelRef.current?.broadcast({ type: 'filesystem-patch', patch });
    setPatches((prev) => {
      if (patch.content !== null) return upsertPatch(prev, patch);

      const existing = prev.find((p) => p.machineId === patch.machineId && p.path === patch.path);
      const deletedPrefix = patch.path.endsWith('/') ? patch.path : patch.path + '/';
      const withoutChildren = prev.filter(
        (p) => !(p.machineId === patch.machineId && p.path.startsWith(deletedPrefix)),
      );

      // File was created via patch — just remove the patch (no null patch needed)
      if (existing?.isNew) {
        return withoutChildren.filter(
          (p) => !(p.machineId === patch.machineId && p.path === patch.path),
        );
      }

      // Base filesystem file — record a null patch to mark deletion
      return upsertPatch(withoutChildren, patch);
    });
  }, []);

  const writeFileToMachine = useCallback(
    ({ machineId, path, cwd, content, userType }: MachineWriteOp): PermissionResult => {
      const permission = canWriteFromMachine({ machineId, path, cwd, userType });
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

      broadcastAndRecordPatch({
        machineId,
        path: resolvedPath,
        content,
        owner: node.owner,
        permissions: node.permissions,
      });

      return { allowed: true };
    },
    [canWriteFromMachine, getNodeFromMachine, resolvePathForMachine, broadcastAndRecordPatch],
  );

  const createFileOnMachine = useCallback(
    ({
      machineId,
      path,
      cwd,
      content,
      userType,
      permissions,
    }: MachineCreateOp): PermissionResult => {
      const resolvedPath = resolvePathForMachine(path, cwd);
      const parts = resolvedPath.split('/').filter(Boolean);
      const fileName = parts[parts.length - 1];
      const dirParts = parts.slice(0, -1);
      const dirPath = '/' + dirParts.join('/') || '/';

      const parentNode = getNodeFromMachine(machineId, dirPath, '/');
      const parentExists = parentNode?.type === 'directory';

      // If parent exists, check write permission and file collision
      if (parentExists) {
        const parentPermission = canWriteFromMachine({
          machineId,
          path: dirPath,
          cwd: '/',
          userType,
        });
        if (!parentPermission.allowed) return parentPermission;
        if (parentNode.children?.[fileName])
          return { allowed: false, error: `File exists: ${path}` };
      } else if (userType !== 'root') {
        // Only root can auto-create intermediate directories
        return { allowed: false, error: `Not a directory: ${dirPath}` };
      }

      const defaultPermissions: FilePermissions = {
        read: ['root', userType],
        write: ['root', userType],
        execute: ['root'],
      };

      const newFile: FileNode = {
        name: fileName,
        type: 'file',
        owner: userType,
        permissions: permissions ?? defaultPermissions,
        content,
      };

      // ensureChildAtPath auto-creates missing intermediate directories
      setFileSystems((prev) => ({
        ...prev,
        [machineId]: ensureChildAtPath(prev[machineId], dirParts, fileName, newFile),
      }));

      broadcastAndRecordPatch({
        machineId,
        path: resolvedPath,
        content,
        owner: userType,
        isNew: true,
        ...(permissions ? { permissions } : {}),
      });

      return { allowed: true };
    },
    [resolvePathForMachine, canWriteFromMachine, getNodeFromMachine, broadcastAndRecordPatch],
  );

  const createDirectoryOnMachine = useCallback(
    ({
      machineId,
      path,
      cwd,
      userType,
      parents,
      permissions,
    }: MachineMkdirOp): PermissionResult => {
      const resolvedPath = resolvePathForMachine(path, cwd);

      if (resolvedPath === '/') {
        return { allowed: false, error: `mkdir: cannot create directory '${path}': File exists` };
      }

      const existing = getNodeFromMachine(machineId, resolvedPath, '/');

      if (existing) {
        if (parents) return { allowed: true };
        return { allowed: false, error: `mkdir: cannot create directory '${path}': File exists` };
      }

      const parts = resolvedPath.split('/').filter(Boolean);

      type WalkState =
        | { readonly ok: true; readonly cursor: string; readonly toCreate: readonly string[] }
        | { readonly ok: false; readonly error: string };

      // Walk the path segment-by-segment, checking per-intermediate permissions
      // so a caller with write on /tmp can't escalate into /root via mkdir -p.
      const walk = parts.reduce<WalkState>(
        (state, segment, i) => {
          if (!state.ok) return state;

          const nextPath = state.cursor === '/' ? `/${segment}` : `${state.cursor}/${segment}`;
          const node = getNodeFromMachine(machineId, nextPath, '/');

          if (node) {
            if (node.type !== 'directory') {
              return {
                ok: false,
                error: `mkdir: cannot create directory '${path}': Not a directory`,
              };
            }
            return { ok: true, cursor: nextPath, toCreate: state.toCreate };
          }

          const isFinalSegment = i === parts.length - 1;
          if (!isFinalSegment && !parents) {
            return {
              ok: false,
              error: `mkdir: cannot create directory '${path}': No such file or directory`,
            };
          }

          const parentPermission = canWriteFromMachine({
            machineId,
            path: state.cursor,
            cwd: '/',
            userType,
          });
          if (!parentPermission.allowed) {
            return {
              ok: false,
              error: `mkdir: cannot create directory '${path}': Permission denied`,
            };
          }

          return { ok: true, cursor: nextPath, toCreate: [...state.toCreate, nextPath] };
        },
        { ok: true, cursor: '/', toCreate: [] },
      );

      if (!walk.ok) return { allowed: false, error: walk.error };
      if (walk.toCreate.length === 0) return { allowed: true };

      const defaultPermissions: FilePermissions = {
        read: ['root', 'user', 'guest'],
        write: ['root', userType],
        execute: ['root', 'user', 'guest'],
      };

      walk.toCreate.forEach((dirPath) => {
        const dirParts = dirPath.split('/').filter(Boolean);
        const dirName = dirParts[dirParts.length - 1] ?? '';
        const parentParts = dirParts.slice(0, -1);

        const newDir: FileNode = {
          name: dirName,
          type: 'directory',
          owner: userType,
          permissions: permissions ?? defaultPermissions,
          children: {},
        };

        setFileSystems((prev) => ({
          ...prev,
          [machineId]: ensureChildAtPath(prev[machineId], parentParts, dirName, newDir),
        }));

        broadcastAndRecordPatch({
          machineId,
          path: dirPath,
          content: null,
          owner: userType,
          isNew: true,
          nodeType: 'directory',
          ...(permissions ? { permissions } : { permissions: defaultPermissions }),
        });
      });

      return { allowed: true };
    },
    [resolvePathForMachine, canWriteFromMachine, getNodeFromMachine, broadcastAndRecordPatch],
  );

  const deleteNodeFromMachine = useCallback(
    ({ machineId, path, cwd, userType, recursive }: MachineDeleteOp): PermissionResult => {
      const resolvedPath = resolvePathForMachine(path, cwd);
      if (resolvedPath === '/')
        return { allowed: false, error: 'rm: cannot remove root directory' };

      const parts = resolvedPath.split('/').filter(Boolean);
      const childName = parts[parts.length - 1];
      const dirParts = parts.slice(0, -1);
      const dirPath = '/' + dirParts.join('/') || '/';

      const parentPermission = canWriteFromMachine({
        machineId,
        path: dirPath,
        cwd: '/',
        userType,
      });
      if (!parentPermission.allowed)
        return { allowed: false, error: `rm: cannot remove '${path}': Permission denied` };

      const node = getNodeFromMachine(machineId, resolvedPath, '/');
      if (!node)
        return { allowed: false, error: `rm: cannot remove '${path}': No such file or directory` };

      if (node.type === 'directory' && !recursive)
        return { allowed: false, error: `rm: cannot remove '${path}': Is a directory` };

      setFileSystems((prev) => ({
        ...prev,
        [machineId]: removeChildAtPath(prev[machineId], dirParts, childName),
      }));

      broadcastAndRecordPatch({ machineId, path: resolvedPath, content: null, owner: userType });

      return { allowed: true };
    },
    [resolvePathForMachine, canWriteFromMachine, getNodeFromMachine, broadcastAndRecordPatch],
  );

  const deleteNode = useCallback(
    (
      path: string,
      userType: UserType,
      options?: { readonly recursive?: boolean },
    ): PermissionResult => {
      return deleteNodeFromMachine({
        machineId: currentMachine,
        path,
        cwd: currentPath,
        userType,
        recursive: options?.recursive,
      });
    },
    [deleteNodeFromMachine, currentMachine, currentPath],
  );

  const writeFile = useCallback(
    (path: string, content: string, userType: UserType): PermissionResult => {
      return writeFileToMachine({
        machineId: currentMachine,
        path,
        cwd: currentPath,
        content,
        userType,
      });
    },
    [writeFileToMachine, currentMachine, currentPath],
  );

  const createFile = useCallback(
    (
      path: string,
      content: string,
      userType: UserType,
      permissions?: FilePermissions,
    ): PermissionResult => {
      return createFileOnMachine({
        machineId: currentMachine,
        path,
        cwd: currentPath,
        content,
        userType,
        permissions,
      });
    },
    [createFileOnMachine, currentMachine, currentPath],
  );

  const createDirectory = useCallback(
    (
      path: string,
      userType: UserType,
      options?: { readonly parents?: boolean; readonly permissions?: FilePermissions },
    ): PermissionResult => {
      return createDirectoryOnMachine({
        machineId: currentMachine,
        path,
        cwd: currentPath,
        userType,
        parents: options?.parents,
        permissions: options?.permissions,
      });
    },
    [createDirectoryOnMachine, currentMachine, currentPath],
  );

  const updatePermissions = useCallback(
    (path: string, permissions: FilePermissions, userType: UserType): PermissionResult => {
      const resolvedPath = resolvePathUtil(path, currentPath);
      const node = getNodeAtPath(fileSystem, resolvedPath);
      if (!node) return { allowed: false, error: `No such file or directory: ${path}` };

      // Only owner or root can change permissions
      if (userType !== 'root' && userType !== node.owner) {
        return { allowed: false, error: `Operation not permitted: ${path}` };
      }

      const parts = resolvedPath.split('/').filter(Boolean);
      setFileSystems((prev) => ({
        ...prev,
        [currentMachine]: updateNodeAtPath(prev[currentMachine], parts, (fileNode) => ({
          ...fileNode,
          permissions,
        })),
      }));

      broadcastAndRecordPatch({
        machineId: currentMachine,
        path: resolvedPath,
        content: node.content ?? null,
        owner: node.owner,
        permissions,
      });

      return { allowed: true };
    },
    [fileSystem, currentPath, currentMachine, broadcastAndRecordPatch],
  );

  const canTraverseOnMachine = useCallback(
    (machineId: MachineId, path: string, userType: UserType): PermissionResult => {
      const fs = fileSystems[machineId];
      if (!fs) return { allowed: false, error: `Permission denied: ${path}` };
      const result = checkTraversal(fs, path, userType);
      if (!result.allowed) return { allowed: false, error: `Permission denied: ${path}` };
      return { allowed: true };
    },
    [fileSystems],
  );

  const canTraverseFn = useCallback(
    (path: string, userType: UserType): PermissionResult => {
      const resolvedPath = resolvePathUtil(path, currentPath);
      return canTraverseOnMachine(currentMachine, resolvedPath, userType);
    },
    [canTraverseOnMachine, currentMachine, currentPath],
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
        createDirectory,
        deleteNode,
        getDefaultHomePath: getDefaultHomePathFn,
        resolvePathForMachine,
        getNodeFromMachine,
        canReadFromMachine,
        canWriteFromMachine,
        listDirectoryFromMachine,
        readFileFromMachine,
        writeFileToMachine,
        createFileOnMachine,
        createDirectoryOnMachine,
        deleteNodeFromMachine,
        updatePermissions,
        canTraverse: canTraverseFn,
        canTraverseOnMachine,
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
