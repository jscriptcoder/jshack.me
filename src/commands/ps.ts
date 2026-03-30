import type { Command } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import type { RemoteMachine } from '../network/types';
import { parseNcPidContent } from '../network/ncStateParser';
import { NC_PID_FILE_PREFIX } from './nc';

type Process = {
  readonly pid: number;
  readonly user: string;
  readonly command: string;
};

export type PsAdapter = {
  readonly getMachineInfo: () => RemoteMachine | undefined;
  readonly readDirectory: (path: string) => Readonly<Record<string, string>> | undefined;
};

// Parses infrastructure PID file content: "binary:port=N" → { binary, port }
export const parseInfraPid = (
  content: string,
): { readonly binary: string; readonly port: number } | null => {
  const match = content.match(/^(.+):port=(\d+)$/);
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { binary: match[1]!, port };
};

// Maps PID file names to the user that runs the daemon.
export const PID_FILE_USERS: Readonly<Record<string, string>> = {
  'sshd.pid': 'root',
  'vsftpd.pid': 'root',
  'nginx.pid': 'www-data',
  'mysqld.pid': 'mysql',
  'postgres.pid': 'postgres',
  'redis.pid': 'redis',
  'mongod.pid': 'mongodb',
  'postfix.pid': 'postfix',
  'dovecot.pid': 'dovecot',
  'mosquitto.pid': 'mosquitto',
  'snmpd.pid': 'snmp',
  'smbd.pid': 'root',
  'modbusd.pid': 'root',
  'openvpn.pid': 'root',
  'vncserver.pid': 'root',
  'rsyncd.pid': 'root',
};

// Derives running processes entirely from PID files in /var/run/.
// All daemons (sshd, vsftpd, nginx, mysql, nc listeners, etc.) are discovered
// by scanning PID files — no open-port-based heuristics.
export const listProcesses = (adapter: PsAdapter): readonly Process[] => {
  const processes: Process[] = [{ pid: 1, user: 'root', command: '/sbin/init' }];
  let nextPid = 100;

  const varRunEntries = adapter.readDirectory('/var/run');
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
          });
        }
        continue;
      }

      // sshd/vsftpd: short name format (sshd:port=22, vsftpd:port=21)
      if (name === 'sshd.pid') {
        const match = content.match(/^sshd:port=(\d+)$/);
        const port = match ? Number(match[1]) : 22;
        processes.push({ pid: nextPid++, user: 'root', command: `/usr/sbin/sshd -p ${port}` });
        continue;
      }
      if (name === 'vsftpd.pid') {
        const match = content.match(/^vsftpd:port=(\d+)$/);
        const port = match ? Number(match[1]) : 21;
        processes.push({ pid: nextPid++, user: 'root', command: `/usr/sbin/vsftpd -p ${port}` });
        continue;
      }

      // Infrastructure daemons: binary:port=N format
      const parsed = parseInfraPid(content);
      if (!parsed) continue;
      const user = PID_FILE_USERS[name] ?? 'root';
      processes.push({ pid: nextPid++, user, command: parsed.binary });
    }
  }

  // Backdoor NC ports from open port list (pre-existing backdoors without PID files)
  const machineInfo = adapter.getMachineInfo();
  if (machineInfo) {
    const ncPidPorts = new Set(
      processes
        .filter((p) => p.command.includes('/usr/bin/nc'))
        .map((p) => {
          const match = p.command.match(/(\d+)$/);
          return match ? Number(match[1]) : 0;
        }),
    );
    for (const port of machineInfo.ports) {
      if (port.service !== 'elite' || !port.open || ncPidPorts.has(port.port)) continue;
      processes.push({
        pid: nextPid++,
        user: port.owner?.username ?? 'root',
        command: `/usr/bin/nc -lvnp ${port.port}`,
      });
    }
  }

  return processes;
};

const formatProcessTable = (processes: readonly Process[]): string => {
  const header = 'PID     USER       COMMAND';
  const rows = processes.map((p) => `${String(p.pid).padEnd(8)}${p.user.padEnd(11)}${p.command}`);
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
      readDirectory: (path) => {
        const node = context.getNodeFromMachine(machine, path, '/');
        if (node?.type !== 'directory' || !node.children) return undefined;
        const entries: Record<string, string> = {};
        for (const [name, child] of Object.entries(node.children)) {
          if (child.type === 'file' && child.content) entries[name] = child.content;
        }
        return entries;
      },
    };

    return formatProcessTable(listProcesses(adapter));
  },
});
