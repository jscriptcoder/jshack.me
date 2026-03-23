import type { Command, AsyncOutput } from '../components/Terminal/types';
import type { FileNode, MachineFileOp } from '../filesystem/types';
import type { RemoteMachine } from '../network/types';
import { createCancellationToken } from '../utils/asyncCommand';
import { type PsAdapter, listProcesses } from './ps';

type RebootContext = {
  readonly getMachine: () => string;
  readonly getMachineInfo: (ip: string) => RemoteMachine | undefined;
  readonly getNodeFromMachine: (machineId: string, path: string, cwd: string) => FileNode | null;
  readonly readFileFromMachine: (op: MachineFileOp) => string | null;
  readonly popSession: () => unknown;
  readonly canReturn: () => boolean;
  readonly markMachineBricked: (machine: string) => void;
};

// Maps process binary paths to human-readable service names for shutdown messages
const PROCESS_TO_SERVICE_NAME: Readonly<Record<string, string>> = {
  '/usr/sbin/sshd': 'OpenSSH server',
  '/usr/sbin/vsftpd': 'vsftpd FTP server',
  '/usr/sbin/nginx': 'nginx web server',
  '/usr/sbin/mysqld': 'MySQL database server',
  '/usr/sbin/postgres': 'PostgreSQL database server',
};

const buildStopMessages = (adapter: PsAdapter): readonly string[] => {
  const processes = listProcesses(adapter);

  return processes.flatMap((proc) => {
    // Skip init — not a stoppable service
    if (proc.command === '/sbin/init') return [];

    // Netcat listeners: extract port from command
    if (proc.command.startsWith('/usr/bin/nc')) {
      const portMatch = proc.command.match(/-(?:lvnp|p)\s+(\d+)/);
      const port = portMatch ? portMatch[1] : 'unknown';
      return [`[ OK ] Stopping netcat listener on port ${port}...`];
    }

    // Known daemon binaries
    const binary = proc.command.split(' ')[0];
    const serviceName = PROCESS_TO_SERVICE_NAME[binary];
    if (serviceName) return [`[ OK ] Stopping ${serviceName}...`];

    return [];
  });
};

const DELAY = {
  broadcast: 0,
  stopServices: 600,
  stopLogging: 1200,
  reachedTarget: 1800,
  bios: 2600,
  bootDisk: 3200,
  // Boot file check starts here
  loadKernel: 3800,
  loadInitrd: 4200,
  result: 4800,
} as const;

export const createRebootCommand = (context: RebootContext): Command => ({
  name: 'reboot',
  category: 'filesystem',
  description: 'Reboot the current machine',
  manual: {
    synopsis: 'reboot()',
    description:
      'Reboot the current machine. Requires root privileges. If critical boot files (/boot/vmlinuz, /boot/initrd.img) are missing, the machine will fail to boot and become permanently unreachable.',
    examples: [{ command: 'reboot()', description: 'Reboot the current machine' }],
  },
  fn: (): AsyncOutput => {
    const {
      getMachine,
      getMachineInfo,
      getNodeFromMachine,
      readFileFromMachine,
      popSession,
      canReturn,
      markMachineBricked,
    } = context;

    const machine = getMachine();
    // Read hostname as root to bypass permission checks — reboot already requires root
    const hostname =
      readFileFromMachine({
        machineId: machine,
        path: '/etc/hostname',
        cwd: '/',
        userType: 'root',
      })?.trim() ?? machine;
    const token = createCancellationToken();

    return {
      __type: 'async',
      clearScreen: true,
      start: (onLine, onComplete) => {
        const hasVmlinuz = getNodeFromMachine(machine, '/boot/vmlinuz', '/') !== null;
        const hasInitrd = getNodeFromMachine(machine, '/boot/initrd.img', '/') !== null;

        // Detect running services for realistic shutdown messages
        const adapter: PsAdapter = {
          getMachineInfo: () => getMachineInfo(machine),
          readPidFile: (path) => {
            const node = getNodeFromMachine(machine, path, '/');
            return node?.type === 'file' ? (node.content ?? undefined) : undefined;
          },
          readDirectory: (path) => {
            const node = getNodeFromMachine(machine, path, '/');
            if (node?.type !== 'directory' || !node.children) return undefined;
            const entries: Record<string, string> = {};
            for (const [name, child] of Object.entries(node.children)) {
              if (child.type === 'file' && child.content) entries[name] = child.content;
            }
            return entries;
          },
        };
        const stopMessages = buildStopMessages(adapter);

        // Shutdown sequence
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine(`Broadcast message from root@${hostname}:`);
          onLine('The system is going down for reboot NOW!');
        }, DELAY.broadcast);

        token.schedule(() => {
          if (token.isCancelled()) return;
          for (const msg of stopMessages) {
            onLine(msg);
          }
        }, DELAY.stopServices);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('[ OK ] Stopping system logging...');
        }, DELAY.stopLogging);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('[ OK ] Reached target Shutdown.');
        }, DELAY.reachedTarget);

        // BIOS POST
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('');
          onLine('BIOS POST... OK');
        }, DELAY.bios);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('Booting from disk...');
        }, DELAY.bootDisk);

        // Boot file check: vmlinuz first
        if (!hasVmlinuz) {
          // GRUB can't find kernel — immediate halt
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine('');
            onLine("error: file '/boot/vmlinuz' not found.");
            onLine('GRUB error: no loaded kernel.');
            onLine('');
            onLine('System halted.');
          }, DELAY.loadKernel);

          token.schedule(() => {
            if (token.isCancelled()) return;
            markMachineBricked(machine);
            if (canReturn()) {
              popSession();
            }
            onComplete();
          }, DELAY.result);
          return;
        }

        // vmlinuz exists — try loading kernel
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('Loading vmlinuz...');
        }, DELAY.loadKernel);

        if (!hasInitrd) {
          // Kernel loads but can't mount root filesystem
          token.schedule(() => {
            if (token.isCancelled()) return;
            onLine("error: file '/boot/initrd.img' not found.");
            onLine('Kernel panic - not syncing: VFS: Unable to mount root fs');
            onLine('');
            onLine('System halted.');
          }, DELAY.loadInitrd);

          token.schedule(() => {
            if (token.isCancelled()) return;
            markMachineBricked(machine);
            if (canReturn()) {
              popSession();
            }
            onComplete();
          }, DELAY.result);
          return;
        }

        // Both files exist — successful boot
        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('Loading initrd.img...');
        }, DELAY.loadInitrd);

        token.schedule(() => {
          if (token.isCancelled()) return;
          onLine('');
          onLine('System rebooted successfully.');
          if (canReturn()) {
            popSession();
          }
          onComplete();
        }, DELAY.result);
      },
      cancel: token.cancel,
    };
  },
});
