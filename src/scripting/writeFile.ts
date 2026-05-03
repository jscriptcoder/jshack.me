import type { UserType } from '../session/types';
import type { FileNode, PermissionResult } from '../filesystem/types';
import { stringify } from '../utils/stringify';

export type WriteFileContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly createFile: (path: string, content: string, userType: UserType) => PermissionResult;
  readonly writeFile: (path: string, content: string, userType: UserType) => PermissionResult;
};

export type WriteFile = (path: string, content: unknown) => void;

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const formatContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (isStringArray(content)) return content.join('\n');
  return stringify(content);
};

export const createWriteFile = (context: WriteFileContext): WriteFile => {
  const { resolvePath, getNode, getUserType, createFile, writeFile } = context;

  return (path, content) => {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('writeFile: missing path');
    }

    const userType = getUserType();
    const body = formatContent(content);
    const existing = getNode(resolvePath(path));
    const result = existing ? writeFile(path, body, userType) : createFile(path, body, userType);

    if (!result.allowed) {
      throw new Error(`writeFile: ${result.error}`);
    }
  };
};
