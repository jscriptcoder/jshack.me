import type { Command } from '../components/Terminal/types';
import type { FileNode, MachineDeleteOp, PermissionResult } from '../filesystem/types';
import type { RemoteMachine } from '../network/types';
import type { UserType } from '../session/SessionContext';
import { parseNcPidContent } from '../network/ncStateParser';
import { NC_PID_FILE_PREFIX } from './nc';
import { PID_FILE_USERS, parseInfraPid } from './ps';

type KillableProcess = {
  readonly pid: number;
  readonly user: string;
  readonly command: string;
  readonly pidFile: string | null; // null = no PID file (machineInfo-only, not killable)
};

export type KillContext = {
  readonly getMachine: () => string;
  readonly getMachineInfo: (ip: string) => RemoteMachine | undefined;
  readonly getNodeFromMachine: (machineId: string, path: string, cwd: string) => FileNode | null;
  readonly deleteNodeFromMachine: (op: MachineDeleteOp) => PermissionResult;
  readonly getUserType: () => UserType;
  readonly getUsername: () => string;
};

// Reads /var/run/ directory entries as name→content pairs
const readVarRun = (
  context: KillContext,
  machine: string,
): Readonly<Record<string, string>> | undefined => {
  const node = context.getNodeFromMachine(machine, '/var/run', '/');
  if (node?.type !== 'directory' || !node.children) return undefined;
  return Object.fromEntries(
    Object.entries(node.children)
      .filter(([, child]) => child.type === 'file' && child.content)
      .map(([name, child]) => [name, child.content!]),
  );
};

// Builds a complete process list with PID file mapping.
// Mirrors the PID assignment logic in ps.ts so kill targets the correct process.
const buildProcessList = (context: KillContext): readonly KillableProcess[] => {
  const machine = context.getMachine();
  const processes: KillableProcess[] = [
    { pid: 1, user: 'root', command: '/sbin/init', pidFile: null },
  ];
  let nextPid = 100;

  const varRunEntries = readVarRun(context, machine);
  if (varRunEntries) {
    for (const [name, content] of Object.entries(varRunEntries)) {
      if (!name.endsWith('.pid')) continue;

      // NC listeners: nc-PORT.pid with owner info
      if (name.startsWith(NC_PID_FILE_PREFIX)) {
        const overrides = parseNcPidContent(content);
        for (const override of overrides) {
          processes.push({
            pid: nextPid++,
            user: override.owner.username,
            command: `/usr/bin/nc -lvnp ${override.port}`,
            pidFile: name,
          });
        }
        continue;
      }

      // sshd/vsftpd: short name format
      if (name === 'sshd.pid') {
        const match = content.match(/^sshd:port=(\d+)$/);
        const port = match ? Number(match[1]) : 22;
        processes.push({
          pid: nextPid++,
          user: 'root',
          command: `/usr/sbin/sshd -p ${port}`,
          pidFile: name,
        });
        continue;
      }
      if (name === 'vsftpd.pid') {
        const match = content.match(/^vsftpd:port=(\d+)$/);
        const port = match ? Number(match[1]) : 21;
        processes.push({
          pid: nextPid++,
          user: 'root',
          command: `/usr/sbin/vsftpd -p ${port}`,
          pidFile: name,
        });
        continue;
      }

      // Infrastructure daemons: binary:port=N format
      const parsed = parseInfraPid(content);
      if (!parsed) continue;
      const user = PID_FILE_USERS[name] ?? 'root';
      processes.push({ pid: nextPid++, user, command: parsed.binary, pidFile: name });
    }
  }

  // Backdoor NC ports from open port list (pre-existing, no PID file)
  const machineInfo = context.getMachineInfo(machine);
  if (machineInfo) {
    const ncPidPorts = new Set(
      processes
        .filter((p) => p.command.includes('/usr/bin/nc'))
        .map((p) => {
          const match = p.command.match(/(\d+)$/);
          return match ? Number(match[1]) : 0;
        }),
    );
    machineInfo.ports
      .filter((port) => port.service === 'elite' && port.open && !ncPidPorts.has(port.port))
      .forEach((port) => {
        processes.push({
          pid: nextPid++,
          user: port.owner?.username ?? 'root',
          command: `/usr/bin/nc -lvnp ${port.port}`,
          pidFile: null,
        });
      });
  }

  return processes;
};

const parsePid = (args: readonly unknown[]): number => {
  if (args.length === 0) {
    throw new Error('kill: usage: kill <pid>');
  }

  const pidStr = String(args[0]);
  const pid = Number(pidStr);
  if (!Number.isInteger(pid) || pid < 1) {
    throw new Error(`kill: ${pidStr}: arguments must be process IDs`);
  }

  return pid;
};

export const createKillCommand = (context: KillContext): Command => ({
  name: 'kill',
  category: 'general',
  description: 'Terminate a process by PID',
  manual: {
    synopsis: 'kill <pid>',
    description: 'Terminate a process by its PID. Use ps to find process IDs.',
    arguments: [{ name: 'pid', description: 'Process ID to terminate', required: true }],
    examples: [{ command: 'kill 100', description: 'Terminate process with PID 100' }],
  },
  fn: (...args: unknown[]): string => {
    const pid = parsePid(args);
    const processes = buildProcessList(context);
    const target = processes.find((p) => p.pid === pid);

    if (!target) {
      throw new Error(`kill: (${pid}): No such process`);
    }

    // PID 1 (init) and processes without PID files cannot be killed
    if (target.pidFile === null) {
      throw new Error(`kill: (${pid}): Operation not permitted`);
    }

    // Permission check: non-root can only kill their own processes
    const userType = context.getUserType();
    if (userType !== 'root') {
      const username = context.getUsername();
      if (target.user !== username) {
        throw new Error(`kill: (${pid}): Operation not permitted`);
      }
    }

    const machine = context.getMachine();
    const result = context.deleteNodeFromMachine({
      machineId: machine,
      path: `/var/run/${target.pidFile}`,
      cwd: '/',
      userType: 'root', // deletion always uses root perms (we already checked permissions above)
    });

    if (!result.allowed) {
      throw new Error(`kill: (${pid}): Operation not permitted`);
    }

    return '';
  },
});
