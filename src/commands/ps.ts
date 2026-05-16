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

// Parses infrastructure PID file content. Accepts two shapes:
//   short    — `binary:port=N`                                       (themed-network generators)
//   extended — `binary:port=N,user=U,userType=T,home=H`              (player-run daemons)
// The extended owner group is captured so callers can prefer the pid-
// content user over the static PID_FILE_USERS fallback.
export const parseInfraPid = (
  content: string,
): { readonly binary: string; readonly port: number; readonly user?: string } | null => {
  const match = content.match(
    /^(.+?):port=(\d+)(?:,user=([^,\n\r]+),userType=[^,\n\r]+,home=[^,\n\r]+)?$/,
  );
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { binary: match[1]!, port, user: match[3] };
};

// Fallback owner for pid files that ship the short form `binary:port=N`
// (no embedded user). Used only when the pid content does not carry a
// `user=…` field — e.g. themed-network nginx shipped via
// `buildInfrastructurePidFiles` where the generator stamps `www-data` as
// the static port owner. Player-run daemons (apache2, nginx) write the
// extended form and supply the invoking user directly, so this map is
// never consulted for them. `apache2.pid` is intentionally absent: every
// apache2 pid file comes from the player command and is required to be
// extended; a malformed apache2.pid is skipped rather than defaulted.
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

      // Apache2: short name + extended owner fields (apache2:port=N,user=U,...).
      // Owner derives from pid content (player's invoking user, not www-data).
      if (name === 'apache2.pid') {
        const match = content.match(
          /^apache2:port=(\d+),user=([^,\n\r]+),userType=[^,\n\r]+,home=[^,\n\r]+$/,
        );
        if (!match) continue;
        const port = Number(match[1]);
        const user = match[2]!;
        processes.push({ pid: nextPid++, user, command: `/usr/sbin/apache2 -p ${port}` });
        continue;
      }

      // Infrastructure daemons: binary:port=N or binary:port=N,user=U,... .
      // Prefer pid-content user when present (player-run nginx); fall back
      // to the static PID_FILE_USERS table for themed-network short form.
      const parsed = parseInfraPid(content);
      if (!parsed) continue;
      const user = parsed.user ?? PID_FILE_USERS[name] ?? 'root';
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
    machineInfo.ports
      .filter((port) => port.service === 'elite' && port.open && !ncPidPorts.has(port.port))
      .forEach((port) => {
        processes.push({
          pid: nextPid++,
          user: port.owner?.username ?? 'root',
          command: `/usr/bin/nc -lvnp ${port.port}`,
        });
      });
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
    synopsis: 'ps',
    description: 'Display a snapshot of running processes on the current machine.',
    arguments: [],
    examples: [{ command: 'ps', description: 'List all running processes' }],
  },
  fn: (): string => {
    const machine = context.getMachine();
    const machineInfo = context.getMachineInfo(machine);

    const adapter: PsAdapter = {
      getMachineInfo: () => machineInfo,
      readDirectory: (path) => {
        const node = context.getNodeFromMachine(machine, path, '/');
        if (node?.type !== 'directory' || !node.children) return undefined;
        return Object.fromEntries(
          Object.entries(node.children)
            .filter(([, child]) => child.type === 'file' && child.content)
            .map(([name, child]) => [name, child.content!]),
        );
      },
    };

    return formatProcessTable(listProcesses(adapter));
  },
});
