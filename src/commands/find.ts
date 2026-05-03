import type { Command } from '../components/Terminal/types';
import type { FileNode, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/types';

type FindContext = {
  readonly getCurrentPath: () => string;
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly canTraverse: (path: string) => PermissionResult;
};

// Convert a glob pattern (with * and ?) to a RegExp
const globToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${withWildcards}$`);
};

type WalkOptions = {
  readonly pattern: RegExp;
  readonly userType: UserType;
  readonly ownerFilter: string | undefined;
  readonly canTraverse: (path: string) => PermissionResult;
};

// Recursively walk the filesystem tree, collecting matching paths
const walkTree = (node: FileNode, currentPath: string, options: WalkOptions): readonly string[] => {
  const { pattern, userType, ownerFilter, canTraverse } = options;
  if (node.type !== 'directory' || !node.children) return [];

  // Check read permission on this directory (root bypasses)
  if (userType !== 'root' && !node.permissions.read.includes(userType)) return [];

  const sortedChildren = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));

  return sortedChildren.flatMap((child) => {
    const childPath = currentPath === '/' ? `/${child.name}` : `${currentPath}/${child.name}`;
    const matchesPattern = pattern.test(child.name);
    const matchesOwner = ownerFilter === undefined || child.owner === ownerFilter;

    const match =
      matchesPattern && matchesOwner
        ? [child.type === 'directory' ? `${childPath}/` : childPath]
        : [];

    const recurse =
      child.type === 'directory' && canTraverse(childPath).allowed
        ? walkTree(child, childPath, options)
        : [];

    return [...match, ...recurse];
  });
};

export const createFindCommand = (context: FindContext): Command => ({
  name: 'find',
  category: 'filesystem',
  description: 'Search for files and directories by name',
  manual: {
    synopsis: 'find <path> <pattern> [user]',
    description:
      'Recursively search for files and directories matching a glob pattern. Supports * (any characters) and ? (single character) wildcards. Directories in results are shown with a trailing /. Restricted directories are silently skipped.',
    arguments: [
      { name: 'path', description: 'Directory to search in (use "." for current directory)' },
      {
        name: 'pattern',
        description: 'Glob pattern to match filenames (* = any chars, ? = single char)',
      },
      { name: 'user', description: 'Optional: filter results by file owner', required: false },
    ],
    examples: [
      { command: 'find . *.txt', description: 'Find all .txt files from current directory' },
      { command: 'find / *.key', description: 'Find all .key files from root' },
      {
        command: 'find /home *.log root',
        description: 'Find root-owned .log files in /home',
      },
      { command: 'find . passwd', description: 'Find files named passwd' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const stringArgs = args.filter((arg): arg is string => typeof arg === 'string');

    if (stringArgs.length < 2) {
      throw new Error('find: usage: find <path> <pattern> [user]');
    }

    const [rawPath, pattern, ownerFilter] = stringArgs;
    const searchPath = context.resolvePath(rawPath as string);
    const node = context.getNode(searchPath);

    if (!node) {
      throw new Error(`find: '${rawPath}': No such file or directory`);
    }

    if (node.type !== 'directory') {
      throw new Error(`find: '${rawPath}': Not a directory`);
    }

    const regex = globToRegex(pattern as string);
    const results = walkTree(node, searchPath, {
      pattern: regex,
      userType: context.getUserType(),
      ownerFilter,
      canTraverse: context.canTraverse,
    });

    return results.join('\n');
  },
});
