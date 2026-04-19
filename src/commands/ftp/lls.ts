import type { Command } from '../../components/Terminal/types';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';
import { listDirectory, type LsAdapter } from '../ls';

type FtpLlsContext = {
  readonly getOriginMachine: () => MachineId;
  readonly getOriginCwd: () => string;
  readonly getOriginUserType: () => UserType;
  readonly resolvePathForMachine: (path: string, cwd: string) => string;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly canTraverseOnMachine: (
    machineId: MachineId,
    path: string,
    userType: UserType,
  ) => PermissionResult;
};

export const createFtpLlsCommand = (context: FtpLlsContext): Command => ({
  name: 'lls',
  category: 'network',
  description: 'List local directory contents',
  manual: {
    synopsis: 'lls [path] [flags...]',
    description:
      'List the contents of a directory on the local machine (where the FTP connection was initiated from). Hidden files (starting with .) are not shown by default. If no path is given, lists the current local directory.',
    arguments: [
      {
        name: 'path',
        description: 'Directory to list (optional, defaults to current local directory)',
        required: false,
      },
      {
        name: 'flags',
        description: 'Options: "-a" to show hidden files, "-l" for long listing with permissions',
        required: false,
      },
    ],
    examples: [
      { command: 'lls', description: 'List current local directory' },
      { command: 'lls -a', description: 'List all files including hidden ones' },
      { command: 'lls -l', description: 'Long listing with permissions and owner' },
      { command: 'lls /home', description: 'List /home on local machine' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const adapter: LsAdapter = {
      getCwd: context.getOriginCwd,
      resolvePath: (path) => context.resolvePathForMachine(path, context.getOriginCwd()),
      getNode: (path) => context.getNodeFromMachine(context.getOriginMachine(), path, '/'),
      getUserType: context.getOriginUserType,
      canTraverse: (path) =>
        context.canTraverseOnMachine(context.getOriginMachine(), path, context.getOriginUserType()),
    };
    return listDirectory(adapter, args, 'lls');
  },
});
