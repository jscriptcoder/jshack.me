import type { Command } from '../../components/Terminal/types';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';

type FtpLlsContext = {
  readonly getOriginMachine: () => MachineId;
  readonly getOriginCwd: () => string;
  readonly getOriginUserType: () => UserType;
  readonly resolvePathForMachine: (path: string, cwd: string) => string;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly listDirectoryFromMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    userType: UserType,
  ) => string[] | null;
  readonly canTraverseOnMachine: (
    machineId: MachineId,
    path: string,
    userType: UserType,
  ) => PermissionResult;
};

export const createFtpLlsCommand = (context: FtpLlsContext): Command => ({
  name: 'lls',
  description: 'List local directory contents',
  manual: {
    synopsis: 'lls([path], [flags])',
    description:
      'List the contents of a directory on the local machine (where the FTP connection was initiated from). Hidden files (starting with .) are not shown by default. If no path is given, lists the current local directory.',
    arguments: [
      {
        name: 'path',
        description: 'Directory to list (optional, defaults to current local directory)',
        required: false,
      },
      { name: 'flags', description: 'Options: "-a" to show hidden files', required: false },
    ],
    examples: [
      { command: 'lls()', description: 'List current local directory' },
      { command: 'lls("-a")', description: 'List all files including hidden ones' },
      { command: 'lls("/home/jshacker")', description: 'List /home/jshacker on local machine' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const originMachine = context.getOriginMachine();
    const originCwd = context.getOriginCwd();
    const userType = context.getOriginUserType();

    const stringArgs = args.filter((arg): arg is string => typeof arg === 'string');
    const showAll = stringArgs.some((arg) => arg.startsWith('-') && arg.includes('a'));
    const path = stringArgs.find((arg) => !arg.startsWith('-'));

    const targetPath = path ?? originCwd;
    const resolvedPath = context.resolvePathForMachine(targetPath, originCwd);

    const traversal = context.canTraverseOnMachine(originMachine, resolvedPath, userType);
    if (!traversal.allowed) {
      throw new Error(`lls: ${targetPath}: Permission denied`);
    }

    const node = context.getNodeFromMachine(originMachine, resolvedPath, '/');
    if (!node) {
      throw new Error(`lls: ${targetPath}: No such file or directory`);
    }
    if (!node.permissions.read.includes(userType)) {
      throw new Error(`lls: ${targetPath}: Permission denied`);
    }

    if (node.type === 'file') {
      return node.name;
    }

    const entries = context.listDirectoryFromMachine(originMachine, resolvedPath, '/', userType);
    if (!entries) {
      throw new Error(`lls: ${targetPath}: Permission denied`);
    }

    const visibleEntries = entries.filter((entry) => showAll || !entry.startsWith('.'));

    if (visibleEntries.length === 0) {
      return '(empty directory)';
    }

    // Format entries with type indicators
    const formattedEntries = visibleEntries.map((entry) => {
      const entryPath = resolvedPath === '/' ? `/${entry}` : `${resolvedPath}/${entry}`;
      const entryNode = context.getNodeFromMachine(originMachine, entryPath, '/');
      if (entryNode?.type === 'directory') {
        return `${entry}/`;
      }
      return entry;
    });

    return formattedEntries.join('  ');
  },
});
