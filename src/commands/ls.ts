import type { Command } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode, PermissionResult } from '../filesystem/types';

type LsContext = {
  readonly getCurrentPath: () => string;
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly canTraverse: (path: string) => PermissionResult;
};

export const createLsCommand = (context: LsContext): Command => ({
  name: 'ls',
  description: 'List directory contents',
  manual: {
    synopsis: 'ls([path], [flags])',
    description:
      'List the contents of a directory. Directories are shown with a trailing slash. Hidden files (starting with .) are not shown by default. If no path is specified, lists the current directory.',
    arguments: [
      {
        name: 'path',
        description: 'Path to the directory to list (absolute or relative)',
        required: false,
      },
      { name: 'flags', description: 'Options: "-a" to show hidden files', required: false },
    ],
    examples: [
      { command: 'ls()', description: 'List contents of current directory' },
      { command: 'ls("-a")', description: 'List all files including hidden ones' },
      { command: 'ls("/")', description: 'List contents of root directory' },
      { command: 'ls("/home", "-a")', description: 'List all files in /home including hidden' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const { getCurrentPath, resolvePath, getNode, getUserType, canTraverse } = context;

    // Parse arguments - can be path, flags, or both in any order
    const stringArgs = args.filter((arg): arg is string => typeof arg === 'string');
    const showAll = stringArgs.some((arg) => arg.startsWith('-') && arg.includes('a'));
    const path = stringArgs.find((arg) => !arg.startsWith('-'));

    const userType = getUserType();
    const targetPath = path ? resolvePath(path) : getCurrentPath();

    const traversal = canTraverse(targetPath);
    if (!traversal.allowed) {
      throw new Error(`ls: cannot open directory '${targetPath}': Permission denied`);
    }

    const node = getNode(targetPath);

    if (!node) {
      throw new Error(`ls: cannot access '${targetPath}': No such file or directory`);
    }

    if (node.type === 'file') {
      // If it's a file, just return the file name
      return node.name;
    }

    // Check read permission
    if (!node.permissions.read.includes(userType)) {
      throw new Error(`ls: cannot open directory '${targetPath}': Permission denied`);
    }

    if (!node.children || Object.keys(node.children).length === 0) {
      return ''; // Empty directory
    }

    // Format output with directories marked
    const entries = Object.values(node.children)
      .filter((child) => showAll || !child.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => {
        if (child.type === 'directory') {
          return `${child.name}/`;
        }
        return child.name;
      });

    return entries.join('  ');
  },
});
