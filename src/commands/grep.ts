import type { Command } from '../components/Terminal/types';
import type { FileNode, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/types';
import type { ShellContext } from '../shell/types';

type GrepContext = {
  readonly getCurrentPath: () => string;
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly canTraverse: (path: string) => PermissionResult;
};

// ELF magic bytes prefix — binary files start with this
const ELF_MAGIC = '\x7fELF';

const isBinary = (content: string): boolean => content.startsWith(ELF_MAGIC);

const canReadFile = (node: FileNode, userType: UserType): boolean =>
  userType === 'root' || node.permissions.read.includes(userType);

// Search a single file's content for lines matching the pattern
const searchFile = (content: string, pattern: RegExp): readonly string[] =>
  content.split('\n').filter((line) => pattern.test(line));

type GrepMatch = {
  readonly filepath: string;
  readonly line: string;
};

type WalkOptions = {
  readonly pattern: RegExp;
  readonly userType: UserType;
  readonly canTraverse: (path: string) => PermissionResult;
};

// Recursively walk directory tree, searching file contents
const walkAndSearch = (
  node: FileNode,
  currentPath: string,
  options: WalkOptions,
): readonly GrepMatch[] => {
  const { pattern, userType, canTraverse } = options;
  if (node.type !== 'directory' || !node.children) return [];

  // Check read permission on directory (root bypasses)
  if (userType !== 'root' && !node.permissions.read.includes(userType)) return [];

  const sortedChildren = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));

  return sortedChildren.flatMap((child) => {
    const childPath = currentPath === '/' ? `/${child.name}` : `${currentPath}/${child.name}`;

    if (child.type === 'file') {
      const content = child.content ?? '';
      if (!canReadFile(child, userType) || isBinary(content)) return [];
      return searchFile(content, pattern).map((line) => ({ filepath: childPath, line }));
    }

    const traversal = canTraverse(childPath);
    if (!traversal.allowed) return [];
    return walkAndSearch(child, childPath, options);
  });
};

const searchOnFilesystem = (context: GrepContext, args: readonly unknown[]): string => {
  const stringArgs = args.filter((arg): arg is string => typeof arg === 'string');

  if (stringArgs.length < 2) {
    throw new Error('grep: usage: grep <pattern> <path> [-l]');
  }

  const [rawPattern, rawPath] = stringArgs;
  const flags = stringArgs.slice(2);
  const listOnly = flags.some((f) => f.includes('l'));
  const searchPath = context.resolvePath(rawPath);
  const node = context.getNode(searchPath);

  if (!node) {
    throw new Error(`grep: '${rawPath}': No such file or directory`);
  }

  const pattern = new RegExp(rawPattern, 'i');

  if (node.type === 'file') {
    const content = node.content ?? '';
    if (isBinary(content)) return '';
    const matches = searchFile(content, pattern);
    if (listOnly) return matches.length > 0 ? searchPath : '';
    return matches.join('\n');
  }

  const matches = walkAndSearch(node, searchPath, {
    pattern,
    userType: context.getUserType(),
    canTraverse: context.canTraverse,
  });

  if (listOnly) {
    const uniqueFiles = [...new Set(matches.map((m) => m.filepath))];
    return uniqueFiles.join('\n');
  }

  return matches.map((m) => `${m.filepath}:${m.line}`).join('\n');
};

const searchStdin = (stdin: string, args: readonly unknown[]): string => {
  const stringArgs = args.filter((arg): arg is string => typeof arg === 'string');
  if (stringArgs.length < 1) {
    throw new Error('grep: usage: grep <pattern> <path> [-l]');
  }

  const pattern = new RegExp(stringArgs[0], 'i');
  return searchFile(stdin, pattern).join('\n');
};

export const createGrepCommand = (context: GrepContext): Command => ({
  name: 'grep',
  category: 'filesystem',
  description: 'Search file contents for a pattern',
  manual: {
    synopsis: 'grep <pattern> <path> [-l]',
    description:
      'Search for lines matching a pattern in file contents. If path is a file, searches that file. If path is a directory, searches all files recursively. When piped (no path argument), searches the piped input. All searches are case-insensitive. Use "-l" to list only filenames containing matches. Binary files are skipped.',
    arguments: [
      { name: 'pattern', description: 'String to search for (case-insensitive)' },
      {
        name: 'path',
        description: 'File or directory to search (use "." for current directory)',
      },
      {
        name: '-l',
        description: 'Optional: list only filenames containing matches',
        required: false,
      },
    ],
    examples: [
      { command: 'grep password /etc/passwd', description: 'Search a single file' },
      { command: 'grep secret /home', description: 'Recursively search a directory' },
      { command: 'grep key . -l', description: 'List filenames containing "key"' },
      { command: 'grep admin /var/log', description: 'Search log files for "admin"' },
    ],
  },
  fn: (...args: unknown[]): string => searchOnFilesystem(context, args),
  fnShell: (ctx: ShellContext, ...args: unknown[]): string => {
    // A path arg still means filesystem mode even when stdin is fed.
    const hasPathArg = args.filter((a) => typeof a === 'string').length >= 2;
    if (hasPathArg) return searchOnFilesystem(context, args);
    return searchStdin(ctx.stdin ?? '', args);
  },
});
