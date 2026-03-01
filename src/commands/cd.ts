import type { Command } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode } from '../filesystem/types';

type CdContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly setCurrentPath: (path: string) => void;
  readonly getUserType: () => UserType;
  readonly getHomePath: () => string;
};

export const createCdCommand = (context: CdContext): Command => ({
  name: 'cd',
  description: 'Change current directory',
  manual: {
    synopsis: 'cd([path])',
    description:
      'Change the current working directory. If no path is specified, changes to the home directory of the current user.',
    arguments: [
      {
        name: 'path',
        description: 'Path to the directory to change to (absolute or relative)',
        required: false,
      },
    ],
    examples: [
      { command: 'cd()', description: 'Change to home directory' },
      { command: 'cd("/")', description: 'Change to root directory' },
      { command: 'cd("/etc")', description: 'Change to /etc directory' },
      { command: 'cd("..")', description: 'Change to parent directory' },
      { command: 'cd("subdir")', description: 'Change to a subdirectory' },
    ],
  },
  fn: (...args: unknown[]): undefined => {
    const path = args[0] as string | undefined;
    const { resolvePath, getNode, setCurrentPath, getUserType, getHomePath } = context;
    const userType = getUserType();

    const targetPath = path ? resolvePath(path) : getHomePath();
    const node = getNode(targetPath);

    if (!node) {
      throw new Error(`cd: ${path}: No such file or directory`);
    }

    if (node.type !== 'directory') {
      throw new Error(`cd: ${path}: Not a directory`);
    }

    if (!node.permissions.read.includes(userType)) {
      throw new Error(`cd: ${path}: Permission denied`);
    }

    setCurrentPath(targetPath);
    return undefined;
  },
});
