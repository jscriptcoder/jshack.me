import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type {
  FileNode,
  FilePermissions,
  MachineCreateOp,
  MachineDeleteOp,
  MachineFileOp,
  MachineMkdirOp,
  MachineWriteOp,
  PermissionResult,
} from './types';
import { useSession } from '../session/SessionContext';
import type { UserType } from '../session/types';
import { type MachineId } from './machineFileSystems';
import { useFileSystemReaders } from './useFileSystemReaders';
import { useFileSystemSync } from './useFileSystemSync';
import { useFileSystemMutations } from './useFileSystemMutations';

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
  // True between mount and the first listPatchesForMachines resolve (success OR failure).
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

type FileSystemProviderProps = {
  readonly children: ReactNode;
  readonly localhostFileSystem: FileNode;
  readonly missionFileSystems?: Readonly<Record<string, FileNode>>;
  readonly homeFileSystems?: Readonly<Record<string, FileNode>>;
  readonly lanOccupantHostnames?: readonly string[];
};

export const FileSystemProvider = ({
  children,
  localhostFileSystem,
  missionFileSystems,
  homeFileSystems,
  lanOccupantHostnames,
}: FileSystemProviderProps) => {
  const { session, hostname, ftpSession, ncSession, mysqlSession, redisSession } = useSession();
  // The player's workstation filesystem is keyed under their workstation_id
  // (= suffixed hostname). Same value used for storage (patches.machine_id),
  // Realtime channel name, and the home_network_occupants.hostname column
  // others see. The legacy 'localhost' literal is gone from storage; the
  // localhostFileSystem PROP name is kept for now to keep this PR focused
  // — its content is the player's workstation filesystem.
  const workstationId = hostname;

  // Collect the canonical machine_ids of every active TRANSIENT
  // (protocol) session.
  // The shell-class session.machine drives one branch of the cross-
  // player base-FS fetch in useFileSystemSync; transient sessions
  // (FTP / nc / MySQL / Redis) drive a parallel branch — they don't
  // change session.machine, so without this list the trigger would
  // miss them entirely. Each transient session's machineId field is
  // populated with the canonical workstation_id for cross-player
  // targets (see useAuthentication.ts) so parseWorkstationId can do
  // the workstation-pattern check directly.
  const protocolSessionMachineIds = useMemo(() => {
    const ids: string[] = [];
    if (ftpSession) ids.push(ftpSession.remoteMachine);
    if (ncSession) ids.push(ncSession.machineId);
    if (mysqlSession) ids.push(mysqlSession.machineId);
    if (redisSession) ids.push(redisSession.machineId);
    return ids;
  }, [ftpSession, ncSession, mysqlSession, redisSession]);

  const sync = useFileSystemSync({
    workstationId,
    localhostFileSystem,
    homeFileSystems,
    missionFileSystems,
    lanOccupantHostnames,
    session,
    protocolSessionMachineIds,
  });
  const {
    fileSystems,
    setFileSystems,
    setPatches,
    isRehydrating,
    syncChannelRef,
    patchesRef,
    localWritesSinceMount,
    pendingPatchesRef,
    pendingWritesRef,
  } = sync;

  // session.machine is typed as string but always holds a valid MachineId at runtime
  // (set by SSH/session logic). MachineId is currently a string alias, so no cast
  // is needed; the named type just documents the intent.
  const currentMachine: MachineId = session.machine;
  const currentPath = session.currentPath;
  // Fallback to the player's own workstation as a safety net — in practice
  // currentMachine always matches a key in fileSystems because SSH only
  // connects to known machines.
  const fileSystem = fileSystems[currentMachine] ?? fileSystems[workstationId];

  const readers = useFileSystemReaders({
    fileSystems,
    fileSystem,
    currentMachine,
    currentPath,
  });
  const {
    resolvePath,
    resolvePathForMachine,
    getNode,
    getNodeFromMachine,
    canRead,
    canWrite,
    canReadFromMachine,
    canWriteFromMachine,
    listDirectory,
    listDirectoryFromMachine,
    readFile,
    readFileFromMachine,
    canTraverse,
    canTraverseOnMachine,
    getDefaultHomePath: getDefaultHomePathFn,
  } = readers;

  const mutations = useFileSystemMutations({
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
  });
  const {
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
  } = mutations;

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
        canTraverse,
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
