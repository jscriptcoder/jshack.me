import type { UserType } from '../session/SessionContext';

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
};
