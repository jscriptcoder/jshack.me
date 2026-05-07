import { useCallback, type Dispatch, type SetStateAction } from 'react';
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
import type { UserType } from '../session/types';
import type { MachineId } from './machineFileSystems';
import { getIdentity } from '../identity';
import {
  upsertPatch as upsertPatchOnServer,
  removePatch as removePatchOnServer,
} from '../patchRegistry/client';
import {
  resolvePath as resolvePathUtil,
  getNodeAtPath,
  updateNodeAtPath,
  ensureChildAtPath,
  removeChildAtPath,
  applyPatchToList,
  planDirectoryCreation,
  type FileSystemsState,
} from './fileSystemUtils';
import type { createSyncChannel } from '../utils/crossTabSync';

export type FileSystemMutations = {
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
  readonly writeFileToMachine: (op: MachineWriteOp) => PermissionResult;
  readonly createFileOnMachine: (op: MachineCreateOp) => PermissionResult;
  readonly upsertFileOnMachine: (op: MachineWriteOp) => PermissionResult;
  readonly createDirectoryOnMachine: (op: MachineMkdirOp) => PermissionResult;
  readonly deleteNodeFromMachine: (op: MachineDeleteOp) => PermissionResult;
  readonly updatePermissions: (
    path: string,
    permissions: FilePermissions,
    userType: UserType,
  ) => PermissionResult;
  readonly flushPendingPatches: () => Promise<void>;
};

type Inputs = {
  readonly fileSystem: FileNode;
  readonly currentMachine: MachineId;
  readonly currentPath: string;
  readonly setFileSystems: Dispatch<SetStateAction<FileSystemsState>>;
  readonly setPatches: Dispatch<SetStateAction<readonly FileSystemPatch[]>>;
  readonly syncChannelRef: { current: ReturnType<typeof createSyncChannel> | null };
  readonly patchesRef: { current: readonly FileSystemPatch[] };
  readonly localWritesSinceMount: { current: boolean };
  readonly pendingPatchesRef: { current: Set<Promise<unknown>> };
  readonly pendingWritesRef: { current: Map<string, FileSystemPatch> };
  readonly canWriteFromMachine: (op: MachineFileOp) => PermissionResult;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly resolvePathForMachine: (path: string, cwd: string) => string;
};

export const useFileSystemMutations = ({
  fileSystem,
  currentMachine,
  currentPath,
  setFileSystems,
  setPatches,
  syncChannelRef,
  patchesRef,
  localWritesSinceMount,
  pendingPatchesRef,
  pendingWritesRef,
  canWriteFromMachine,
  getNodeFromMachine,
  resolvePathForMachine,
}: Inputs): FileSystemMutations => {
  // Registers a fire-and-forget patch network promise into the pending
  // set so flushPendingPatches() can await it. The promise is removed
  // on settle (success OR rejection) so the set always reflects only
  // currently-in-flight calls.
  const trackPending = (promise: Promise<unknown>): void => {
    pendingPatchesRef.current.add(promise);
    void promise.finally(() => {
      pendingPatchesRef.current.delete(promise);
    });
  };

  // Register a local write into pendingWritesRef so any cross-player
  // hint refetch in flight can replay it on top of the server-truth
  // result. The entry is only cleared if THIS patch is still the
  // latest at this (machineId, path) — a subsequent write on the
  // same path will have replaced it, and that newer entry's own
  // settle handler is responsible for cleanup.
  const trackPendingWrite = (patch: FileSystemPatch, settled: Promise<unknown>): void => {
    const key = `${patch.machineId}::${patch.path}`;
    pendingWritesRef.current.set(key, patch);
    void settled.finally(() => {
      if (pendingWritesRef.current.get(key) === patch) {
        pendingWritesRef.current.delete(key);
      }
    });
  };

  // Broadcasts a patch to other tabs, fires the right server-side call, and
  // updates local patch state. The server-side dispatch is fire-and-forget —
  // sync callers don't await; failures are logged but never block the UI.
  // See feedback memory: feedback_react_context_server_integration.md.
  //
  // Deletion of a patch-created file (isNew) removes the patch entirely
  // instead of recording a null patch — the file never existed in the base
  // filesystem. Deletion of a base filesystem file records a null patch.
  // Both cases also remove any child patches under the deleted path.
  //
  // Server dispatch table:
  //   write/create (content !== null)        → upsertPatchOnServer
  //   delete isNew (content === null & isNew) → removePatchOnServer (handles
  //                                              descendants via path_prefix)
  //   delete base  (content === null & !isNew)→ removePatchOnServer THEN
  //                                              upsertPatchOnServer (null
  //                                              marker after descendant
  //                                              cleanup)
  //
  // The existing-row lookup for the isNew vs base decision uses patchesRef,
  // not the live setPatches prev. A rare race (rapid create+delete in the
  // same tick) might pick the wrong branch and leave a stale null marker
  // server-side; the local in-memory state is still correct, and the
  // marker is harmless on the next rehydration (applyPatches treats it as
  // a deletion — same outcome).
  const broadcastAndRecordPatch = useCallback(
    (patch: FileSystemPatch) => {
      syncChannelRef.current?.broadcast({ type: 'filesystem-patch', patch });
      localWritesSinceMount.current = true;

      const existing = patchesRef.current.find(
        (p) => p.machineId === patch.machineId && p.path === patch.path,
      );
      let serverPromise: Promise<unknown>;
      if (patch.content !== null) {
        serverPromise = upsertPatchOnServer(getIdentity(), patch).catch((error) => {
          console.error('[fs] upsertPatch failed:', error);
        });
      } else if (existing?.isNew) {
        serverPromise = removePatchOnServer(getIdentity(), {
          machineId: patch.machineId,
          path: patch.path,
        }).catch((error) => {
          console.error('[fs] removePatch (isNew) failed:', error);
        });
      } else {
        // Base-file deletion: drop descendants first (they don't make sense
        // once the parent is marked deleted), then record the null marker.
        serverPromise = removePatchOnServer(getIdentity(), {
          machineId: patch.machineId,
          path: patch.path,
        })
          .then(() => upsertPatchOnServer(getIdentity(), patch))
          .catch((error) => {
            console.error('[fs] removePatch+upsertPatch failed:', error);
          });
      }
      trackPending(serverPromise);
      trackPendingWrite(patch, serverPromise);

      setPatches((prev) => applyPatchToList(prev, patch));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
    [
      canWriteFromMachine,
      getNodeFromMachine,
      resolvePathForMachine,
      broadcastAndRecordPatch,
      setFileSystems,
    ],
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
    [
      resolvePathForMachine,
      canWriteFromMachine,
      getNodeFromMachine,
      broadcastAndRecordPatch,
      setFileSystems,
    ],
  );

  // Either-or: writes if the file exists, creates if it doesn't.
  // msfconsole's writeRemoteFile uses this so file_write / password_reset /
  // backdoor_port_open all work whether the destination path exists or not
  // (file_write and backdoor_port_open typically write brand-new paths).
  // Existing-file branch preserves the file's owner; new-file branch sets
  // owner to `userType`.
  const upsertFileOnMachine = useCallback(
    (op: MachineWriteOp): PermissionResult => {
      const node = getNodeFromMachine(op.machineId, op.path, op.cwd);
      if (node && node.type === 'file') {
        return writeFileToMachine(op);
      }
      return createFileOnMachine({
        machineId: op.machineId,
        path: op.path,
        cwd: op.cwd,
        content: op.content,
        userType: op.userType,
      });
    },
    [getNodeFromMachine, writeFileToMachine, createFileOnMachine],
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

      const plan = planDirectoryCreation({
        parts: resolvedPath.split('/').filter(Boolean),
        targetPath: path,
        parents: parents ?? false,
        getNode: (p) => getNodeFromMachine(machineId, p, '/'),
        canWriteParent: (p) => canWriteFromMachine({ machineId, path: p, cwd: '/', userType }),
      });

      if (!plan.ok) return { allowed: false, error: plan.error };
      if (plan.toCreate.length === 0) return { allowed: true };

      const defaultPermissions: FilePermissions = {
        read: ['root', 'user', 'guest'],
        write: ['root', userType],
        execute: ['root', 'user', 'guest'],
      };

      plan.toCreate.forEach((dirPath) => {
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
    [
      resolvePathForMachine,
      canWriteFromMachine,
      getNodeFromMachine,
      broadcastAndRecordPatch,
      setFileSystems,
    ],
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
    [
      resolvePathForMachine,
      canWriteFromMachine,
      getNodeFromMachine,
      broadcastAndRecordPatch,
      setFileSystems,
    ],
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
    [fileSystem, currentPath, currentMachine, broadcastAndRecordPatch, setFileSystems],
  );

  // Snapshots the in-flight set at call time, then awaits all of them.
  // Patches dispatched AFTER the snapshot are not awaited (they belong to
  // a later body, not this transient-session body). allSettled — we don't
  // care if individual patches reject; the inner .catch already swallows
  // network errors, this is a safety net so flush never throws.
  const flushPendingPatches = useCallback(async (): Promise<void> => {
    const inflight = [...pendingPatchesRef.current];
    if (inflight.length === 0) return;
    await Promise.allSettled(inflight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    writeFile,
    createFile,
    createDirectory,
    deleteNode,
    writeFileToMachine,
    createFileOnMachine,
    upsertFileOnMachine,
    createDirectoryOnMachine,
    deleteNodeFromMachine,
    updatePermissions,
    flushPendingPatches,
  };
};
