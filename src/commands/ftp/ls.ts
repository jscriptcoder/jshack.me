import type { Command } from '../../components/Terminal/types';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';

type FtpLsContext = {
  readonly getRemoteMachine: () => MachineId;
  readonly getRemoteCwd: () => string;
  readonly getRemoteUserType: () => UserType;
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

export const createFtpLsCommand = (context: FtpLsContext): Command => ({
  name: 'ls',
  description: 'List remote directory contents',
  manual: {
    synopsis: 'ls([path], [flags])',
    description:
      'List the contents of a directory on the remote FTP server. Hidden files (starting with .) are not shown by default. If no path is given, lists the current remote directory.',
    arguments: [
      {
        name: 'path',
        description: 'Directory to list (optional, defaults to current remote directory)',
        required: false,
      },
      { name: 'flags', description: 'Options: "-a" to show hidden files', required: false },
    ],
    examples: [
      { command: 'ls()', description: 'List current remote directory' },
      { command: 'ls("-a")', description: 'List all files including hidden ones' },
      { command: 'ls("/srv/ftp")', description: 'List /srv/ftp on remote' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const remoteMachine = context.getRemoteMachine();
    const remoteCwd = context.getRemoteCwd();
    const userType = context.getRemoteUserType();

    const stringArgs = args.filter((arg): arg is string => typeof arg === 'string');
    const showAll = stringArgs.some((arg) => arg.startsWith('-') && arg.includes('a'));
    const path = stringArgs.find((arg) => !arg.startsWith('-'));

    const targetPath = path ?? remoteCwd;
    const resolvedPath = context.resolvePathForMachine(targetPath, remoteCwd);

    const traversal = context.canTraverseOnMachine(remoteMachine, resolvedPath, userType);
    if (!traversal.allowed) {
      throw new Error(`ls: ${targetPath}: Permission denied`);
    }

    const node = context.getNodeFromMachine(remoteMachine, resolvedPath, '/');
    if (!node) {
      throw new Error(`ls: ${targetPath}: No such file or directory`);
    }
    if (!node.permissions.read.includes(userType)) {
      throw new Error(`ls: ${targetPath}: Permission denied`);
    }

    if (node.type === 'file') {
      return node.name;
    }

    const entries = context.listDirectoryFromMachine(remoteMachine, resolvedPath, '/', userType);
    if (!entries) {
      throw new Error(`ls: ${targetPath}: Permission denied`);
    }

    const visibleEntries = entries.filter((entry) => showAll || !entry.startsWith('.'));

    if (visibleEntries.length === 0) {
      return '(empty directory)';
    }

    // Format entries with type indicators
    const formattedEntries = visibleEntries.map((entry) => {
      const entryPath = resolvedPath === '/' ? `/${entry}` : `${resolvedPath}/${entry}`;
      const entryNode = context.getNodeFromMachine(remoteMachine, entryPath, '/');
      if (entryNode?.type === 'directory') {
        return `${entry}/`;
      }
      return entry;
    });

    return formattedEntries.join('  ');
  },
});
