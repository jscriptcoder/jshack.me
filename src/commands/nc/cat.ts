import type { Command } from '../../components/Terminal/types';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';
import { readFileContent, type CatAdapter } from '../cat';

type NcCatContext = {
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

export const createNcCatCommand = (context: NcCatContext): Command => ({
  name: 'cat',
  category: 'network',
  description: 'Read file contents',
  fn: (...args: unknown[]): string => {
    const adapter: CatAdapter = {
      resolvePath: (path) => context.resolvePath(path, context.getCwd()),
      getNode: (path) => context.getNodeFromMachine(context.getMachine(), path, context.getCwd()),
      getUserType: context.getUserType,
      canTraverse: (path) =>
        context.canTraverseOnMachine(context.getMachine(), path, context.getUserType()),
    };
    return readFileContent(adapter, args);
  },
});
