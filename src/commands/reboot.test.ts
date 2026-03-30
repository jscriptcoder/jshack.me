import { describe, it, expect, vi } from 'vitest';
import type { FileNode } from '../filesystem/types';
import type { RemoteMachine } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import { createRebootCommand } from './reboot';

const makeMockFile = (name: string, content?: string): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root'],
  },
  content: content ?? 'binary',
});

const makeMockDir = (name: string, children: Record<string, FileNode> = {}): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children,
});

type MockConfig = {
  readonly machine?: string;
  readonly hostname?: string;
  readonly bootFiles?: Record<string, FileNode | null>;
  readonly canReturn?: boolean;
  readonly machineInfo?: RemoteMachine | undefined;
  readonly varRunDir?: FileNode | null;
};

const createMockContext = (config: MockConfig = {}) => {
  const {
    machine = '192.168.1.50',
    hostname = 'fileserver',
    bootFiles = {
      '/boot/vmlinuz': makeMockFile('vmlinuz'),
      '/boot/initrd.img': makeMockFile('initrd.img'),
    },
    canReturn = true,
    machineInfo = undefined,
    varRunDir = null,
  } = config;

  return {
    getMachine: () => machine,
    getMachineInfo: () => machineInfo,
    getNodeFromMachine: (_machineId: string, path: string, _cwd: string): FileNode | null => {
      if (path === '/var/run') return varRunDir;
      // Resolve PID files from within /var/run directory
      if (path.startsWith('/var/run/') && varRunDir?.type === 'directory' && varRunDir.children) {
        const fileName = path.slice('/var/run/'.length);
        return varRunDir.children[fileName] ?? null;
      }
      return bootFiles[path] ?? null;
    },
    readFileFromMachine: ({ path }: { readonly path: string }) =>
      path === '/etc/hostname' ? hostname : null,
    popSession: vi.fn(),
    canReturn: () => canReturn,
    markMachineBricked: vi.fn(),
  };
};

// Collects all async output lines and waits for completion
const runAsync = (result: AsyncOutput): Promise<{ readonly lines: string[] }> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    result.start(
      (line) => lines.push(line),
      () => resolve({ lines }),
    );
  });

describe('reboot command', () => {
  // Use fake timers so tests don't wait for real delays
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const runWithTimers = async (result: AsyncOutput) => {
    const promise = runAsync(result);
    // Advance past all scheduled delays
    await vi.advanceTimersByTimeAsync(10000);
    return promise;
  };

  describe('successful reboot', () => {
    it('should show boot sequence and pop session on remote machine', async () => {
      const context = createMockContext();
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      expect(result.__type).toBe('async');

      const { lines } = await runWithTimers(result);

      expect(lines).toContain('Broadcast message from root@fileserver:');
      expect(lines).toContain('Loading vmlinuz...');
      expect(lines).toContain('Loading initrd.img...');
      expect(lines).toContain('System rebooted successfully.');
      expect(context.popSession).toHaveBeenCalled();
      expect(context.markMachineBricked).not.toHaveBeenCalled();
    });

    it('should not pop session on localhost', async () => {
      const context = createMockContext({ machine: 'localhost', canReturn: false });
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      const { lines } = await runWithTimers(result);

      expect(lines).toContain('System rebooted successfully.');
      expect(context.popSession).not.toHaveBeenCalled();
      expect(context.markMachineBricked).not.toHaveBeenCalled();
    });
  });

  describe('bricking — vmlinuz missing', () => {
    it('should show GRUB error and brick machine', async () => {
      const context = createMockContext({
        bootFiles: {
          '/boot/initrd.img': makeMockFile('initrd.img'),
        },
      });
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      const { lines } = await runWithTimers(result);

      expect(lines).toContain("error: file '/boot/vmlinuz' not found.");
      expect(lines).toContain('GRUB error: no loaded kernel.');
      expect(lines).toContain('System halted.');
      expect(context.markMachineBricked).toHaveBeenCalledWith('192.168.1.50');
      expect(context.popSession).toHaveBeenCalled();
    });
  });

  describe('bricking — initrd.img missing', () => {
    it('should load kernel then show panic', async () => {
      const context = createMockContext({
        bootFiles: {
          '/boot/vmlinuz': makeMockFile('vmlinuz'),
        },
      });
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      const { lines } = await runWithTimers(result);

      expect(lines).toContain('Loading vmlinuz...');
      expect(lines).toContain("error: file '/boot/initrd.img' not found.");
      expect(lines).toContain('Kernel panic - not syncing: VFS: Unable to mount root fs');
      expect(lines).toContain('System halted.');
      expect(context.markMachineBricked).toHaveBeenCalledWith('192.168.1.50');
      expect(context.popSession).toHaveBeenCalled();
    });
  });

  describe('bricking — both files missing', () => {
    it('should show GRUB error (vmlinuz checked first)', async () => {
      const context = createMockContext({ bootFiles: {} });
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      const { lines } = await runWithTimers(result);

      expect(lines).toContain("error: file '/boot/vmlinuz' not found.");
      expect(lines).toContain('GRUB error: no loaded kernel.');
      expect(lines).not.toContain('Loading vmlinuz...');
      expect(context.markMachineBricked).toHaveBeenCalledWith('192.168.1.50');
    });
  });

  describe('bricking on localhost', () => {
    it('should mark localhost as bricked without popping session', async () => {
      const context = createMockContext({
        machine: 'localhost',
        canReturn: false,
        bootFiles: {},
      });
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      const { lines } = await runWithTimers(result);

      expect(lines).toContain('System halted.');
      expect(context.markMachineBricked).toHaveBeenCalledWith('localhost');
      expect(context.popSession).not.toHaveBeenCalled();
    });
  });

  describe('dynamic service stopping', () => {
    it('should show no service stop messages when no services are running', async () => {
      const context = createMockContext();
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      const { lines } = await runWithTimers(result);

      const stopLines = lines.filter((l) => l.startsWith('[ OK ] Stopping'));
      // Only "Stopping system logging..." (always present)
      expect(stopLines).toEqual(['[ OK ] Stopping system logging...']);
    });

    it('should show SSH stop message when sshd PID file exists', async () => {
      const context = createMockContext({
        varRunDir: makeMockDir('run', {
          'sshd.pid': makeMockFile('sshd.pid', 'sshd:port=22'),
        }),
      });
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      const { lines } = await runWithTimers(result);

      expect(lines).toContain('[ OK ] Stopping OpenSSH server...');
    });

    it('should show FTP stop message when vsftpd PID file exists', async () => {
      const context = createMockContext({
        varRunDir: makeMockDir('run', {
          'vsftpd.pid': makeMockFile('vsftpd.pid', 'vsftpd:port=21'),
        }),
      });
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      const { lines } = await runWithTimers(result);

      expect(lines).toContain('[ OK ] Stopping vsftpd FTP server...');
    });

    it('should show nginx stop message when nginx PID file exists', async () => {
      const context = createMockContext({
        varRunDir: makeMockDir('run', {
          'nginx.pid': makeMockFile('nginx.pid', '/usr/sbin/nginx:port=80'),
        }),
      });
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      const { lines } = await runWithTimers(result);

      expect(lines).toContain('[ OK ] Stopping nginx web server...');
    });

    it('should show multiple service stop messages', async () => {
      const context = createMockContext({
        varRunDir: makeMockDir('run', {
          'sshd.pid': makeMockFile('sshd.pid', 'sshd:port=22'),
          'nginx.pid': makeMockFile('nginx.pid', '/usr/sbin/nginx:port=80'),
          'mysqld.pid': makeMockFile('mysqld.pid', '/usr/sbin/mysqld:port=3306'),
        }),
      });
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      const { lines } = await runWithTimers(result);

      expect(lines).toContain('[ OK ] Stopping OpenSSH server...');
      expect(lines).toContain('[ OK ] Stopping nginx web server...');
      expect(lines).toContain('[ OK ] Stopping MySQL database server...');
      expect(lines).toContain('[ OK ] Stopping system logging...');
    });

    it('should show netcat listener stop message with port', async () => {
      const context = createMockContext({
        varRunDir: makeMockDir('run', {
          'nc-4444.pid': makeMockFile(
            'nc-4444.pid',
            'nc:port=4444,user=hacker,userType=user,home=/home/hacker',
          ),
        }),
      });
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      const { lines } = await runWithTimers(result);

      expect(lines).toContain('[ OK ] Stopping netcat listener on port 4444...');
    });
  });

  describe('cancellation', () => {
    it('should provide a cancel function', () => {
      const context = createMockContext();
      const reboot = createRebootCommand(context);
      const result = reboot.fn() as AsyncOutput;

      expect(result.cancel).toBeDefined();
    });
  });
});
