import { useCallback } from 'react';
import type { FileNode, MachineFileOp, PermissionResult } from './types';
import type { UserType } from '../session/types';
import { getDefaultHomePath, type MachineId } from './machineFileSystems';
import {
  resolvePath as resolvePathUtil,
  getNodeAtPath,
  checkTraversal,
  type FileSystemsState,
} from './fileSystemUtils';
import { canRead as canReadPerms, canWrite as canWritePerms } from './permissionWalker';

export type FileSystemReaders = {
  readonly resolvePath: (path: string) => string;
  readonly resolvePathForMachine: (path: string, cwd: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly canRead: (path: string, userType: UserType) => PermissionResult;
  readonly canWrite: (path: string, userType: UserType) => PermissionResult;
  readonly canReadFromMachine: (op: MachineFileOp) => PermissionResult;
  readonly canWriteFromMachine: (op: MachineFileOp) => PermissionResult;
  readonly listDirectory: (path: string, userType: UserType) => string[] | null;
  readonly listDirectoryFromMachine: (op: MachineFileOp) => string[] | null;
  readonly readFile: (path: string, userType: UserType) => string | null;
  readonly readFileFromMachine: (op: MachineFileOp) => string | null;
  readonly canTraverse: (path: string, userType: UserType) => PermissionResult;
  readonly canTraverseOnMachine: (
    machineId: MachineId,
    path: string,
    userType: UserType,
  ) => PermissionResult;
  readonly getDefaultHomePath: (machineId: string, username: string) => string;
};

type Inputs = {
  readonly fileSystems: FileSystemsState;
  readonly fileSystem: FileNode;
  readonly currentMachine: MachineId;
  readonly currentPath: string;
};

export const useFileSystemReaders = ({
  fileSystems,
  fileSystem,
  currentMachine,
  currentPath,
}: Inputs): FileSystemReaders => {
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
      // Leaf check delegated to the shared L2 walker. parentChain is empty
      // here because checkTraversal above already validated the chain;
      // server-side L2 will populate parentChain from machine_filesystems
      // rows since it doesn't have a tree to walk.
      const leaf = canReadPerms({ userType, target: node.permissions, parentChain: [] });
      if (!leaf.allowed) return { allowed: false, error: `Permission denied: ${path}` };
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
      const leaf = canWritePerms({ userType, target: node.permissions, parentChain: [] });
      if (!leaf.allowed) return { allowed: false, error: `Permission denied: ${path}` };
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

  const canTraverse = useCallback(
    (path: string, userType: UserType): PermissionResult => {
      const resolvedPath = resolvePathUtil(path, currentPath);
      return canTraverseOnMachine(currentMachine, resolvedPath, userType);
    },
    [canTraverseOnMachine, currentMachine, currentPath],
  );

  const getDefaultHomePathFn = useCallback((machineId: string, username: string): string => {
    return getDefaultHomePath(machineId, username);
  }, []);

  return {
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
  };
};
