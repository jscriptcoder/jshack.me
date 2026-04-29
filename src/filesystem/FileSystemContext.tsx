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
import { getIdentity } from '../identity';
import {
  upsertPatch as upsertPatchOnServer,
  removePatch as removePatchOnServer,
  listPatchesForMachines as listPatchesForMachinesFromServer,
  clearTransientPatches as clearTransientPatchesOnServer,
} from '../patchRegistry/client';
import {
  resolvePath as resolvePathUtil,
  getNodeAtPath,
  checkTraversal,
  updateNodeAtPath,
  ensureChildAtPath,
  removeChildAtPath,
  upsertPatch,
  applyPatches,
  planDirectoryCreation,
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
  // Write-or-create: existing files get the writeFileToMachine path
  // (overwrite content, preserve owner/permissions); missing paths get
  // the createFileOnMachine path (new file owned by `userType`). Used by
  // msfconsole's writeRemoteFile so effects that target new paths
  // (file_write, backdoor_port_open) actually fire upsertPatch.
  readonly upsertFileOnMachine: (op: MachineWriteOp) => PermissionResult;
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
  // True between mount and the first listPatches resolve (success OR failure).
  // No UI gates on this today (the IndexedDB cache covers initial paint), but
  // exposed for future loading-indicator wiring.
  readonly isRehydrating: boolean;
  // Resolves when every patch network call that was in flight at the
  // moment of the call has settled. Used by transient-session wrappers
  // (scp/snmpset/msfconsole one-shots) to wait for fire-and-forget
  // upsertPatch / removePatch calls before the wrapping endSession
  // fires — otherwise endSession can land at the server first and the
  // patch hits 403 no_session via the L1 gate.
  readonly flushPendingPatches: () => Promise<void>;
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
  // True between mount and the first listPatches resolve (success or failure).
  const [isRehydrating, setIsRehydrating] = useState(true);
  // Create channel inside effect so StrictMode's cleanup + re-run cycle gets
  // a fresh (open) channel. The ref is updated so broadcastAndRecordPatch always
  // posts on the currently-active channel.
  const syncChannelRef = useRef<ReturnType<typeof createSyncChannel> | null>(null);
  // patchesRef mirrors `patches` so broadcastAndRecordPatch can look up the
  // existing patch (for the isNew vs base-file decision) without re-creating
  // the callback on every patches change. See the useEffect below the state.
  const patchesRef = useRef<readonly FileSystemPatch[]>(patches);
  // propsRef captures the latest base/home/mission filesystems so the
  // rehydration .then() can rebuild fileSystems from the freshest layered
  // base, even if props changed during the in-flight listPatches.
  const propsRef = useRef({ localhostFileSystem, homeFileSystems, missionFileSystems });
  // Set to true the first time the user does any local write/delete after
  // mount. The rehydration .then() reads this and SKIPS server-truth
  // replacement when local writes are in flight — those upserts are already
  // heading to the server fire-and-forget, the next mount will see the merged
  // truth. Avoids clobbering a user's just-typed change if listPatches lands
  // a few hundred ms after mount.
  const localWritesSinceMount = useRef(false);
  // In-flight patch network calls. Each upsertPatch/removePatch promise
  // gets registered here on dispatch and removed on settle. Used by
  // flushPendingPatches() to let transient-session wrappers wait for
  // fire-and-forget patches to land before they end the session — see
  // the FileSystemContextValue.flushPendingPatches doc-comment.
  const pendingPatchesRef = useRef<Set<Promise<unknown>>>(new Set());

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

  // Keep patchesRef and propsRef in sync with the current state/props so
  // ref-readers always observe the latest committed values.
  useEffect(() => {
    patchesRef.current = patches;
  }, [patches]);
  useEffect(() => {
    propsRef.current = { localhostFileSystem, homeFileSystems, missionFileSystems };
  }, [localhostFileSystem, homeFileSystems, missionFileSystems]);

  // Mount rehydration — fetch the cross-player patch set for the
  // machines in our current view and replace local state if no local
  // writes have happened yet. The IndexedDB cache covers fast initial
  // paint; this useEffect performs the cross-device + cross-player sync
  // once the network responds.
  //
  // machine_ids is computed from the props at mount time: localhost is
  // always present; home and mission keysets are added when supplied.
  // De-duplicated via Set in case home and mission overlap (e.g. shared
  // public IP).
  //
  // Race window: a local write before listPatchesForMachines resolves
  // sets localWritesSinceMount and we skip replacement (the local upsert
  // is already on its way to the server fire-and-forget, the next mount
  // will reconcile).
  //
  // Mid-session limitation: when home or mission filesystems mount
  // AFTER initial rehydration (e.g. player cracks a new WiFi mid-session),
  // those machines aren't fetched here. Cross-player patches for them
  // surface on next page reload. Live-fetch on transition is a tracked
  // follow-up.
  useEffect(() => {
    const props = propsRef.current;
    const machineIds = Array.from(
      new Set([
        'localhost',
        ...Object.keys(props.homeFileSystems ?? {}),
        ...Object.keys(props.missionFileSystems ?? {}),
      ]),
    );

    let cancelled = false;
    void listPatchesForMachinesFromServer(getIdentity(), machineIds)
      .then((serverPatches) => {
        if (cancelled) return;
        if (localWritesSinceMount.current) return;
        // Replace patches state + IndexedDB cache + rebuild fileSystems
        // from the freshest layered base.
        setPatches(serverPatches);
        const db = getDatabase();
        if (db) saveFilesystemPatches(db, [...serverPatches]);
        const props = propsRef.current;
        const base = { localhost: props.localhostFileSystem };
        const withHome = props.homeFileSystems ? { ...base, ...props.homeFileSystems } : base;
        const merged = props.missionFileSystems
          ? { ...withHome, ...props.missionFileSystems }
          : withHome;
        setFileSystems(applyPatches(merged, serverPatches));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[fs] patch rehydration failed:', error);
      })
      .finally(() => {
        if (!cancelled) setIsRehydrating(false);
      });
    return () => {
      cancelled = true;
    };
    // Mount-only — props are read via propsRef.current inside the .then()
    // so we don't need them in deps.
  }, []);

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
      // Mirror server-side: drop everything except localhost for this player.
      // Fire-and-forget — failure is logged but shouldn't block the local
      // filter from completing (worst case: stale rows get pruned next time).
      void clearTransientPatchesOnServer(getIdentity()).catch((error) => {
        console.error('[fs] clearTransientPatches failed:', error);
      });
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

  const broadcastAndRecordPatch = useCallback((patch: FileSystemPatch) => {
    syncChannelRef.current?.broadcast({ type: 'filesystem-patch', patch });
    localWritesSinceMount.current = true;

    const existing = patchesRef.current.find(
      (p) => p.machineId === patch.machineId && p.path === patch.path,
    );
    if (patch.content !== null) {
      trackPending(
        upsertPatchOnServer(getIdentity(), patch).catch((error) => {
          console.error('[fs] upsertPatch failed:', error);
        }),
      );
    } else if (existing?.isNew) {
      trackPending(
        removePatchOnServer(getIdentity(), {
          machineId: patch.machineId,
          path: patch.path,
        }).catch((error) => {
          console.error('[fs] removePatch (isNew) failed:', error);
        }),
      );
    } else {
      // Base-file deletion: drop descendants first (they don't make sense
      // once the parent is marked deleted), then record the null marker.
      trackPending(
        removePatchOnServer(getIdentity(), {
          machineId: patch.machineId,
          path: patch.path,
        })
          .then(() => upsertPatchOnServer(getIdentity(), patch))
          .catch((error) => {
            console.error('[fs] removePatch+upsertPatch failed:', error);
          }),
      );
    }

    setPatches((prev) => {
      if (patch.content !== null) return upsertPatch(prev, patch);

      const existingInPrev = prev.find(
        (p) => p.machineId === patch.machineId && p.path === patch.path,
      );
      const deletedPrefix = patch.path.endsWith('/') ? patch.path : patch.path + '/';
      const withoutChildren = prev.filter(
        (p) => !(p.machineId === patch.machineId && p.path.startsWith(deletedPrefix)),
      );

      // File was created via patch — just remove the patch (no null patch needed)
      if (existingInPrev?.isNew) {
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

  // Snapshots the in-flight set at call time, then awaits all of them.
  // Patches dispatched AFTER the snapshot are not awaited (they belong to
  // a later body, not this transient-session body). allSettled — we don't
  // care if individual patches reject; the inner .catch already swallows
  // network errors, this is a safety net so flush never throws.
  const flushPendingPatches = useCallback(async (): Promise<void> => {
    const inflight = [...pendingPatchesRef.current];
    if (inflight.length === 0) return;
    await Promise.allSettled(inflight);
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
        upsertFileOnMachine,
        createDirectoryOnMachine,
        deleteNodeFromMachine,
        updatePermissions,
        canTraverse: canTraverseFn,
        canTraverseOnMachine,
        isRehydrating,
        flushPendingPatches,
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
