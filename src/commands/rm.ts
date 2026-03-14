import type { Command } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode, PermissionResult } from '../filesystem/types';

type DeleteOptions = {
  readonly recursive?: boolean;
};

type RmContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly deleteNode: (
    path: string,
    userType: UserType,
    options?: DeleteOptions,
  ) => PermissionResult;
};

// Parses flags (-r, -f, -rf, -fr) from args, returning flags and remaining paths
const parseArgs = (
  args: readonly unknown[],
): { readonly recursive: boolean; readonly force: boolean; readonly paths: readonly string[] } => {
  let recursive = false;
  let force = false;
  const paths: string[] = [];

  for (const arg of args) {
    if (typeof arg !== 'string') continue;
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      const flags = arg.slice(1);
      for (const ch of flags) {
        if (ch === 'r' || ch === 'R') recursive = true;
        else if (ch === 'f') force = true;
        else throw new Error(`rm: invalid option -- '${ch}'`);
      }
    } else {
      paths.push(arg);
    }
  }

  return { recursive, force, paths };
};

export const createRmCommand = (context: RmContext): Command => ({
  name: 'rm',
  category: 'filesystem',
  description: 'Remove files or directories',
  manual: {
    synopsis: 'rm([flags], path, [path2, ...])',
    description:
      'Remove files or directories. Directories require the -r flag. Use -f to suppress errors for non-existent files.',
    arguments: [
      {
        name: 'flags',
        description: '-r (recursive, required for directories), -f (force, ignore nonexistent)',
        required: false,
      },
      {
        name: 'path',
        description: 'Path to the file or directory to remove',
        required: true,
      },
    ],
    examples: [
      { command: 'rm("file.txt")', description: 'Remove a file' },
      { command: 'rm("-r", "/boot")', description: 'Remove a directory recursively' },
      { command: 'rm("-rf", "/boot")', description: 'Force remove a directory' },
      { command: 'rm("a.txt", "b.txt")', description: 'Remove multiple files' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const { resolvePath, getNode, getUserType, deleteNode } = context;
    const { recursive, force, paths } = parseArgs(args);

    if (paths.length === 0) {
      throw new Error('rm: missing operand');
    }

    const userType = getUserType();
    const errors: string[] = [];

    for (const path of paths) {
      const targetPath = resolvePath(path);
      const node = getNode(targetPath);

      if (!node) {
        if (!force) errors.push(`rm: cannot remove '${path}': No such file or directory`);
        continue;
      }

      const result = deleteNode(path, userType, { recursive });
      if (!result.allowed && result.error) {
        errors.push(result.error);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }

    return '';
  },
});
