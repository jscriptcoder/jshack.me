import type { Command } from '../../components/Terminal/types';
import type { FileNode, PermissionResult } from '../../filesystem/types';
import type { UserType } from '../../session/SessionContext';
import type { MachineId } from '../../filesystem/machineFileSystems';
import type { RemoteMachine } from '../../network/types';
import { startSshd, PID_FILE_PATH, type SshdAdapter } from '../sshd';

type NcSshdContext = {
  readonly getMachine: () => MachineId;
  readonly getUserType: () => UserType;
  readonly getMachineInfo: (ip: string) => RemoteMachine | undefined;
  readonly getNodeFromMachine: (machineId: MachineId, path: string, cwd: string) => FileNode | null;
  readonly createFileOnMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    content: string,
    userType: UserType,
  ) => PermissionResult;
};

export const createNcSshdCommand = (context: NcSshdContext): Command => ({
  name: 'sshd',
  category: 'network',
  description: 'Start SSH server',
  fn: (...args: unknown[]): string => {
    const userType = context.getUserType();
    if (userType !== 'root') {
      throw new Error('sshd: Permission denied (requires root)');
    }

    const machine = context.getMachine();
    const machineInfo = context.getMachineInfo(machine);

    const adapter: SshdAdapter = {
      isPortOpen: (port) =>
        machineInfo?.ports.some((p) => p.port === port && p.service === 'ssh' && p.open) ?? false,
      readPidFile: () => {
        const node = context.getNodeFromMachine(machine, PID_FILE_PATH, '/');
        return node?.type === 'file' ? node.content ?? undefined : undefined;
      },
      writePidFile: (content) =>
        context.createFileOnMachine(machine, PID_FILE_PATH, '/', content, 'root'),
    };

    return startSshd(adapter, args);
  },
});
