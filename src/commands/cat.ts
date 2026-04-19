import type { Command } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode, PermissionResult } from '../filesystem/types';

// Adapter interface for filesystem operations — allows cat to work
// across shell and NC modes with different backing stores.
export type CatAdapter = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly canTraverse: (path: string) => PermissionResult;
};

// Core cat logic shared across shell and NC modes.
export const readFileContent = (adapter: CatAdapter, args: readonly unknown[]): string => {
  const { resolvePath, getNode, getUserType, canTraverse } = adapter;

  const path = args[0] as string | undefined;
  if (!path) {
    throw new Error('cat: missing file operand');
  }

  const userType = getUserType();
  const targetPath = resolvePath(path);

  const traversal = canTraverse(targetPath);
  if (!traversal.allowed) {
    throw new Error(`cat: ${path}: Permission denied`);
  }

  const node = getNode(targetPath);
  if (!node) {
    throw new Error(`cat: ${path}: No such file or directory`);
  }

  if (node.type === 'directory') {
    throw new Error(`cat: ${path}: Is a directory`);
  }

  if (!node.permissions.read.includes(userType)) {
    throw new Error(`cat: ${path}: Permission denied`);
  }

  return node.content ?? '';
};

type CatContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly canTraverse: (path: string) => PermissionResult;
};

export const createCatCommand = (context: CatContext): Command => ({
  name: 'cat',
  category: 'filesystem',
  description: 'Display file contents',
  manual: {
    synopsis: 'cat <path>',
    description: 'Display the contents of a file. The file must be readable by the current user.',
    arguments: [
      {
        name: 'path',
        description: 'Path to the file to display (absolute or relative)',
        required: true,
      },
    ],
    examples: [
      { command: 'cat /etc/passwd', description: 'Display the passwd file' },
      { command: 'cat readme.txt', description: 'Display a file in the current directory' },
      { command: 'cat ../file.txt', description: 'Display a file in the parent directory' },
    ],
  },
  fn: (...args: unknown[]): string => readFileContent(context, args),
});
