import type { Command } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode, FilePermissions, PermissionResult } from '../filesystem/types';

type LsContext = {
  readonly getCurrentPath: () => string;
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly canTraverse: (path: string) => PermissionResult;
};

const getPermsForType = (perms: FilePermissions, userType: UserType): string => {
  if (userType === 'root') return 'rwx';
  const r = perms.read.includes(userType) ? 'r' : '-';
  const w = perms.write.includes(userType) ? 'w' : '-';
  const x = perms.execute.includes(userType) ? 'x' : '-';
  return `${r}${w}${x}`;
};

const formatPermissionString = (node: FileNode): string => {
  const typeChar = node.type === 'directory' ? 'd' : '-';
  const ownerPerms = getPermsForType(node.permissions, node.owner);
  const userPerms = getPermsForType(node.permissions, 'user');
  const guestPerms = getPermsForType(node.permissions, 'guest');
  return `${typeChar}${ownerPerms}${userPerms}${guestPerms}`;
};

const formatLongEntry = (child: FileNode): string => {
  const perms = formatPermissionString(child);
  const owner = child.owner.padEnd(5);
  const name = child.type === 'directory' ? `${child.name}/` : child.name;
  return `${perms}  ${owner}  ${name}`;
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
      {
        name: 'flags',
        description: 'Options: "-a" to show hidden files, "-l" for long listing with permissions',
        required: false,
      },
    ],
    examples: [
      { command: 'ls()', description: 'List contents of current directory' },
      { command: 'ls("-a")', description: 'List all files including hidden ones' },
      { command: 'ls("-l")', description: 'Long listing with permissions, owner, and name' },
      { command: 'ls("-la")', description: 'Long listing including hidden files' },
      { command: 'ls("/")', description: 'List contents of root directory' },
      { command: 'ls("/home", "-a")', description: 'List all files in /home including hidden' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const { getCurrentPath, resolvePath, getNode, getUserType, canTraverse } = context;

    // Parse arguments - can be path, flags, or both in any order
    const stringArgs = args.filter((arg): arg is string => typeof arg === 'string');
    const flags = stringArgs.filter((arg) => arg.startsWith('-'));
    const showAll = flags.some((f) => f.includes('a'));
    const longFormat = flags.some((f) => f.includes('l'));
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
      return longFormat ? formatLongEntry(node) : node.name;
    }

    // Check read permission
    if (!node.permissions.read.includes(userType)) {
      throw new Error(`ls: cannot open directory '${targetPath}': Permission denied`);
    }

    if (!node.children || Object.keys(node.children).length === 0) {
      return ''; // Empty directory
    }

    const filtered = Object.values(node.children)
      .filter((child) => showAll || !child.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (longFormat) {
      return filtered.map(formatLongEntry).join('\n');
    }

    return filtered
      .map((child) => (child.type === 'directory' ? `${child.name}/` : child.name))
      .join('  ');
  },
});
