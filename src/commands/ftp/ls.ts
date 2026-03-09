import type { Command } from '../../components/Terminal/types';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';
import { listDirectory, type LsAdapter } from '../ls';

type FtpLsContext = {
  readonly getRemoteMachine: () => MachineId;
  readonly getRemoteCwd: () => string;
  readonly getRemoteUserType: () => UserType;
  readonly resolvePathForMachine: (path: string, cwd: string) => string;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly canTraverseOnMachine: (
    machineId: MachineId,
    path: string,
    userType: UserType,
  ) => PermissionResult;
};

export const createFtpLsCommand = (context: FtpLsContext): Command => ({
  name: 'ls',
  category: 'network',
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
      {
        name: 'flags',
        description: 'Options: "-a" to show hidden files, "-l" for long listing with permissions',
        required: false,
      },
    ],
    examples: [
      { command: 'ls()', description: 'List current remote directory' },
      { command: 'ls("-a")', description: 'List all files including hidden ones' },
      { command: 'ls("-l")', description: 'Long listing with permissions and owner' },
      { command: 'ls("/srv/ftp")', description: 'List /srv/ftp on remote' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const adapter: LsAdapter = {
      getCwd: context.getRemoteCwd,
      resolvePath: (path) => context.resolvePathForMachine(path, context.getRemoteCwd()),
      getNode: (path) => context.getNodeFromMachine(context.getRemoteMachine(), path, '/'),
      getUserType: context.getRemoteUserType,
      canTraverse: (path) =>
        context.canTraverseOnMachine(context.getRemoteMachine(), path, context.getRemoteUserType()),
    };
    return listDirectory(adapter, args, 'ls');
  },
});
