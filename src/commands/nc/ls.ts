import type { Command } from '../../components/Terminal/types';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/types';
import type { MachineId } from '../../filesystem/machineFileSystems';
import { listDirectory, type LsAdapter } from '../ls';

type NcLsContext = {
  readonly getMachine: () => MachineId;
  readonly getCwd: () => string;
  readonly getUserType: () => UserType;
  readonly resolvePath: (path: string, cwd: string) => string;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly canTraverseOnMachine: (
    machineId: MachineId,
    path: string,
    userType: UserType,
  ) => PermissionResult;
};

export const createNcLsCommand = (context: NcLsContext): Command => ({
  name: 'ls',
  category: 'network',
  description: 'List directory contents',
  fn: (...args: unknown[]): string => {
    const adapter: LsAdapter = {
      getCwd: context.getCwd,
      resolvePath: (path) => context.resolvePath(path, context.getCwd()),
      getNode: (path) => context.getNodeFromMachine(context.getMachine(), path, context.getCwd()),
      getUserType: context.getUserType,
      canTraverse: (path) =>
        context.canTraverseOnMachine(context.getMachine(), path, context.getUserType()),
    };
    return listDirectory(adapter, args, 'ls');
  },
});
