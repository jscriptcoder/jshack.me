import type { UserType } from '../session/types';

export type FilePermissions = {
  readonly read: readonly UserType[];
  readonly write: readonly UserType[];
  readonly execute: readonly UserType[];
};

export type FileNode = {
  readonly name: string;
  readonly type: 'file' | 'directory';
  readonly owner: UserType;
  readonly permissions: FilePermissions;
  readonly content?: string;
  readonly children?: Readonly<Record<string, FileNode>>;
};

export type FileSystem = {
  readonly root: FileNode;
};

export type PermissionResult = {
  readonly allowed: boolean;
  readonly error?: string;
};

export type FileSystemPatch = {
  readonly machineId: string;
  readonly path: string;
  readonly content: string | null;
  readonly owner: UserType;
  readonly permissions?: FilePermissions;
  readonly isNew?: true;
  // When omitted, behaves as a file patch (backward compatible). 'directory'
  // lets mkdir persist empty directories across refresh and multi-tab sync.
  readonly nodeType?: 'file' | 'directory';
};

// Options objects for machine-targeted filesystem operations (4+ params)
export type MachineFileOp = {
  readonly machineId: string;
  readonly path: string;
  readonly cwd: string;
  readonly userType: UserType;
};

export type MachineWriteOp = MachineFileOp & {
  readonly content: string;
};

export type MachineCreateOp = MachineWriteOp & {
  readonly permissions?: FilePermissions;
};

export type MachineDeleteOp = MachineFileOp & {
  readonly recursive?: boolean;
};

export type MachineMkdirOp = MachineFileOp & {
  readonly parents?: boolean;
  readonly permissions?: FilePermissions;
};
