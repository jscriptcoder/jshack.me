import type { Command } from '../../components/Terminal/types';
import type { FileNode } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';
import { executeBash, type BashAdapter } from '../bash';

type NcBashContext = {
  readonly getMachine: () => MachineId;
  readonly getUserType: () => UserType;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly findCommand: (name: string) => ((...args: unknown[]) => unknown) | undefined;
};

export const createNcBashCommand = (context: NcBashContext): Command => ({
  name: 'bash',
  category: 'network',
  description: 'Execute binary by filesystem path',
  fn: (binaryPath?: unknown, ...args: unknown[]) => {
    if (typeof binaryPath !== 'string' || !binaryPath) {
      throw new Error('bash: missing binary path\nUsage: bash("/path/to/binary", ...args)');
    }

    const machine = context.getMachine();
    const adapter: BashAdapter = {
      getNode: (path) => context.getNodeFromMachine(machine, path, '/'),
      getUserType: context.getUserType,
      findCommand: context.findCommand,
    };

    return executeBash(adapter, binaryPath, args);
  },
});
