import type { Command } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import type { RemoteMachine } from '../network/types';

type Process = {
  readonly pid: number;
  readonly user: string;
  readonly command: string;
};

export type PsAdapter = {
  readonly getMachineInfo: () => RemoteMachine | undefined;
  readonly readPidFile: (path: string) => string | undefined;
};

// Maps open port services to their daemon process entries.
// Only includes services that represent long-running daemons.
const SERVICE_TO_PROCESS: Readonly<Record<string, { readonly binary: string; readonly user: string }>> = {
  http: { binary: '/usr/sbin/nginx', user: 'www-data' },
  https: { binary: '/usr/sbin/nginx', user: 'www-data' },
  'http-alt': { binary: '/usr/sbin/nginx', user: 'www-data' },
  mysql: { binary: '/usr/sbin/mysqld', user: 'mysql' },
  postgresql: { binary: '/usr/sbin/postgres', user: 'postgres' },
  elite: { binary: '/usr/sbin/elite', user: 'root' },
};

// Derives running processes from PID files and open ports.
// PID files are the source of truth for sshd/ftpd. Open ports
// determine other daemon processes (nginx, mysqld, etc.).
export const listProcesses = (adapter: PsAdapter): readonly Process[] => {
  const processes: Process[] = [{ pid: 1, user: 'root', command: '/sbin/init' }];
  let nextPid = 100;

  // sshd from PID file
  const sshdContent = adapter.readPidFile('/var/run/sshd.pid');
  if (sshdContent) {
    const match = sshdContent.match(/^sshd:port=(\d+)$/);
    const port = match ? Number(match[1]) : 22;
    processes.push({ pid: nextPid++, user: 'root', command: `/usr/sbin/sshd -p ${port}` });
  }

  // ftpd from PID file
  const ftpdContent = adapter.readPidFile('/var/run/ftpd.pid');
  if (ftpdContent) {
    const match = ftpdContent.match(/^ftpd:port=(\d+)$/);
    const port = match ? Number(match[1]) : 21;
    processes.push({ pid: nextPid++, user: 'root', command: `/usr/sbin/ftpd -p ${port}` });
  }

  // Other daemons from open ports (deduplicate by binary path)
  const machineInfo = adapter.getMachineInfo();
  const seenBinaries = new Set<string>();
  if (machineInfo) {
    for (const port of machineInfo.ports) {
      if (!port.open) continue;
      const process = SERVICE_TO_PROCESS[port.service];
      if (!process || seenBinaries.has(process.binary)) continue;
      seenBinaries.add(process.binary);
      processes.push({ pid: nextPid++, user: process.user, command: process.binary });
    }
  }

  return processes;
};

const formatProcessTable = (processes: readonly Process[]): string => {
  const header = 'PID     USER       COMMAND';
  const rows = processes.map(
    (p) =>
      `${String(p.pid).padEnd(8)}${p.user.padEnd(11)}${p.command}`,
  );
  return [header, ...rows].join('\n');
};

export type PsContext = {
  readonly getMachine: () => string;
  readonly getMachineInfo: (ip: string) => RemoteMachine | undefined;
  readonly getNodeFromMachine: (machineId: string, path: string, cwd: string) => FileNode | null;
};

export const createPsCommand = (context: PsContext): Command => ({
  name: 'ps',
  category: 'general',
  description: 'Report running processes',
  manual: {
    synopsis: 'ps()',
    description: 'Display a snapshot of running processes on the current machine.',
    arguments: [],
    examples: [{ command: 'ps()', description: 'List all running processes' }],
  },
  fn: (): string => {
    const machine = context.getMachine();
    const machineInfo = context.getMachineInfo(machine);

    const adapter: PsAdapter = {
      getMachineInfo: () => machineInfo,
      readPidFile: (path) => {
        const node = context.getNodeFromMachine(machine, path, '/');
        return node?.type === 'file' ? (node.content ?? undefined) : undefined;
      },
    };

    return formatProcessTable(listProcesses(adapter));
  },
});
