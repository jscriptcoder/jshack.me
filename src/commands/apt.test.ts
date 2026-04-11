import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileNode, FilePermissions } from '../filesystem/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { RemoteMachine } from '../network/types';
import { createAptCommand } from './apt';

const mkBinaryNode = (name: string): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  content: '\x7fELF',
});

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

type MockAptConfig = {
  readonly machine?: string;
  readonly userType?: 'root' | 'user' | 'guest';
  readonly installedTools?: readonly string[];
  readonly wifiConnected?: boolean;
  readonly currentMachine?: RemoteMachine;
  readonly initialFiles?: Readonly<Record<string, string>>;
};

type CreatedFile = {
  readonly path: string;
  readonly content: string;
  readonly permissions?: FilePermissions;
};

const createMockAptContext = (config: MockAptConfig = {}) => {
  const {
    machine = '10.0.0.1',
    userType = 'root',
    installedTools = [],
    wifiConnected = true,
    currentMachine,
    initialFiles = {},
  } = config;
  const createdFiles: CreatedFile[] = [];
  const writtenFiles: Array<{ path: string; content: string }> = [];
  const fileContents: Record<string, string> = { ...initialFiles };

  // Keep createdFiles / writtenFiles in sync with fileContents so tests can
  // introspect either.
  return {
    context: {
      getMachine: () => machine,
      getCurrentMachine: () => currentMachine,
      getNode: (path: string): FileNode | null => {
        const name = path.replace('/usr/bin/', '');
        if (installedTools.includes(name)) return mkBinaryNode(name);
        if (createdFiles.some((f) => f.path === path)) return mkBinaryNode(name);
        if (fileContents[path] !== undefined) return mkBinaryNode(name);
        return null;
      },
      readFile: (path: string): string | null => fileContents[path] ?? null,
      createFile: (
        path: string,
        content: string,
        _userType: string,
        permissions?: FilePermissions,
      ) => {
        createdFiles.push({ path, content, permissions });
        fileContents[path] = content;
        return { allowed: true };
      },
      writeFile: (path: string, content: string, _userType: string) => {
        writtenFiles.push({ path, content });
        fileContents[path] = content;
        return { allowed: true };
      },
      getUserType: () => userType,
      isWifiConnected: () => wifiConnected,
    },
    createdFiles,
    writtenFiles,
    fileContents,
  };
};

// Minimal helper to build a RemoteMachine fixture for upgrade tests
const mkMachine = (
  ports: readonly {
    readonly port: number;
    readonly service: string;
    readonly serviceVersion: string;
    readonly open?: boolean;
  }[],
): RemoteMachine => ({
  ip: '10.0.0.1',
  hostname: 'test-host',
  ports: ports.map((p) => ({
    port: p.port,
    service: p.service,
    serviceVersion: p.serviceVersion,
    open: p.open ?? true,
  })),
  users: [],
});

describe('apt command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('no arguments', () => {
    it('throws when called without arguments', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      expect(() => apt.fn()).toThrow('apt: missing subcommand');
    });
  });

  describe('apt install', () => {
    it('throws when no package name specified', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      expect(() => apt.fn('install')).toThrow('No package name specified');
    });

    it('throws network error on localhost when WiFi is not connected', () => {
      const { context } = createMockAptContext({
        machine: 'localhost',
        wifiConnected: false,
      });
      const apt = createAptCommand(context);
      expect(() => apt.fn('install', 'nmap')).toThrow('network is unreachable');
    });

    it('installs on localhost when WiFi is connected', () => {
      const { context } = createMockAptContext({
        machine: 'localhost',
        wifiConnected: true,
      });
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'nmap');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('throws when not root on remote machine', () => {
      const { context } = createMockAptContext({ userType: 'user' });
      const apt = createAptCommand(context);
      expect(() => apt.fn('install', 'nmap')).toThrow('are you root?');
    });

    it('throws for unknown package', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      expect(() => apt.fn('install', 'invalid-pkg')).toThrow(
        'E: Unable to locate package invalid-pkg',
      );
    });

    it('returns already installed message when binary exists', () => {
      const { context } = createMockAptContext({ installedTools: ['nmap'] });
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'nmap') as string;
      expect(result).toContain('already the newest version');
    });

    it('returns AsyncOutput and creates binary on successful install', () => {
      const { context, createdFiles } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'nmap');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );

      // Advance past max jitter range
      vi.advanceTimersByTime(3000);

      expect(lines.some((l) => l.includes('Reading package lists'))).toBe(true);
      expect(lines.some((l) => l.includes('Setting up nmap'))).toBe(true);
      expect(createdFiles.some((f) => f.path === '/usr/bin/nmap')).toBe(true);
    });

    it('creates binary with world-executable permissions', () => {
      const { context, createdFiles } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'nmap');

      if (!isAsyncOutput(result)) return;

      result.start(
        () => {},
        () => {},
      );

      vi.advanceTimersByTime(3000);

      const created = createdFiles.find((f) => f.path === '/usr/bin/nmap');
      expect(created?.permissions).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      });
    });

    it('creates root-only binary for restricted commands like gpg', () => {
      const { context, createdFiles } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'gpg');

      if (!isAsyncOutput(result)) return;

      result.start(
        () => {},
        () => {},
      );

      vi.advanceTimersByTime(3000);

      const created = createdFiles.find((f) => f.path === '/usr/bin/gpg');
      expect(created?.permissions?.execute).toEqual(['root']);
    });

    it('calls onComplete after install finishes', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'nmap');

      if (!isAsyncOutput(result)) return;

      let completed = false;
      result.start(
        () => {},
        () => {
          completed = true;
        },
      );

      vi.advanceTimersByTime(3000);
      expect(completed).toBe(true);
    });

    it('multi-binary package creates all binaries (snmp → snmpwalk + snmpset)', () => {
      const { context, createdFiles } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'snmp');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      result.start(
        () => {},
        () => {},
      );

      vi.advanceTimersByTime(3000);

      expect(createdFiles.some((f) => f.path === '/usr/bin/snmpwalk')).toBe(true);
      expect(createdFiles.some((f) => f.path === '/usr/bin/snmpset')).toBe(true);
      // Should NOT create /usr/bin/snmp (that's the package name, not a binary)
      expect(createdFiles.some((f) => f.path === '/usr/bin/snmp')).toBe(false);
    });

    it('multi-binary package reports already installed when all binaries exist', () => {
      const { context } = createMockAptContext({ installedTools: ['snmpwalk', 'snmpset'] });
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'snmp') as string;
      expect(result).toContain('already the newest version');
    });

    it('multi-binary package installs missing binaries when some already exist', () => {
      const { context, createdFiles } = createMockAptContext({ installedTools: ['airmon'] });
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'aircrack');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      result.start(
        () => {},
        () => {},
      );

      vi.advanceTimersByTime(3000);

      // Should only create missing binaries, not the existing one
      expect(createdFiles.some((f) => f.path === '/usr/bin/airdump')).toBe(true);
      expect(createdFiles.some((f) => f.path === '/usr/bin/aircrack')).toBe(true);
      expect(createdFiles.some((f) => f.path === '/usr/bin/airmon')).toBe(false);
    });
  });

  describe('apt list', () => {
    it('lists all available packages', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('list') as string;
      expect(result).toContain('nmap');
      expect(result).toContain('john');
      expect(result).toContain('ftp');
      expect(result).toContain('netcat');
    });

    it('shows installed status for tools with binaries present', () => {
      const { context } = createMockAptContext({ installedTools: ['nmap'] });
      const apt = createAptCommand(context);
      const result = apt.fn('list') as string;
      expect(result).toContain('[installed]');
    });

    it('shows not installed status when binaries are absent', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('list') as string;
      expect(result).toContain('[not installed]');
    });

    it('filters to installed only with --installed flag', () => {
      const { context } = createMockAptContext({ installedTools: ['nmap'] });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '--installed') as string;
      expect(result).toContain('nmap');
      expect(result).toContain('Listing installed packages');
    });

    it('accepts -i as shorthand for --installed', () => {
      const { context } = createMockAptContext({ installedTools: ['nmap'] });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '-i') as string;
      expect(result).toContain('nmap');
      expect(result).toContain('Listing installed packages');
    });
  });

  describe('extra files', () => {
    it('creates extra files alongside binaries on install', () => {
      const { context, createdFiles } = createMockAptContext();
      const apt = createAptCommand(context);
      // hydra has extraFiles defined in APT_PACKAGES
      const result = apt.fn('install', 'hydra');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      result.start(
        () => {},
        () => {},
      );

      vi.advanceTimersByTime(3000);

      // Binary should be created
      expect(createdFiles.some((f) => f.path === '/usr/bin/hydra')).toBe(true);
      // Extra file should also be created
      const extraFile = createdFiles.find((f) => f.path === '/usr/share/wordlists/passwords.txt');
      expect(extraFile).toBeDefined();
      expect(extraFile?.content).toBeTruthy();
      // Extra files should be readable by all, writable by root, not executable
      expect(extraFile?.permissions).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: [],
      });
    });

    it('does not re-create extra files that already exist', () => {
      const existingFiles = new Set(['/usr/share/wordlists/passwords.txt']);
      const createdFiles: CreatedFile[] = [];

      const context = {
        getMachine: () => '10.0.0.1',
        getNode: (path: string): FileNode | null => {
          if (existingFiles.has(path)) return mkBinaryNode('passwords.txt');
          if (createdFiles.some((f) => f.path === path)) return mkBinaryNode('file');
          return null;
        },
        createFile: (
          path: string,
          content: string,
          _userType: string,
          permissions?: FilePermissions,
        ) => {
          createdFiles.push({ path, content, permissions });
          return { allowed: true };
        },
        getUserType: () => 'root' as const,
        isWifiConnected: () => true,
      };

      const apt = createAptCommand(context);
      const result = apt.fn('install', 'hydra');

      if (!isAsyncOutput(result)) return;

      result.start(
        () => {},
        () => {},
      );

      vi.advanceTimersByTime(3000);

      // Binary should be created
      expect(createdFiles.some((f) => f.path === '/usr/bin/hydra')).toBe(true);
      // Extra file should NOT be re-created (already exists)
      expect(createdFiles.some((f) => f.path === '/usr/share/wordlists/passwords.txt')).toBe(false);
    });

    it('installs missing extra files even when binary already exists', () => {
      const { context, createdFiles } = createMockAptContext({ installedTools: ['hydra'] });
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'hydra');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      result.start(
        () => {},
        () => {},
      );

      vi.advanceTimersByTime(3000);

      // Binary should NOT be re-created (already exists)
      expect(createdFiles.some((f) => f.path === '/usr/bin/hydra')).toBe(false);
      // Extra file should be created (was missing)
      expect(createdFiles.some((f) => f.path === '/usr/share/wordlists/passwords.txt')).toBe(true);
    });
  });

  describe('invalid subcommand', () => {
    it('throws for unknown subcommand', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      expect(() => apt.fn('remove')).toThrow("Invalid operation 'remove'");
    });
  });

  describe('apt upgrade', () => {
    it('requires root', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({ userType: 'user', currentMachine: machine });
      const apt = createAptCommand(context);
      expect(() => apt.fn('upgrade')).toThrow('are you root?');
    });

    it('requires WiFi on localhost', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({
        machine: 'localhost',
        wifiConnected: false,
        currentMachine: machine,
      });
      const apt = createAptCommand(context);
      expect(() => apt.fn('upgrade')).toThrow('network is unreachable');
    });

    it('writes an entry to /var/lib/dpkg/status for each vulnerable service', () => {
      const machine = mkMachine([
        { port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.6' }, // safe
        { port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }, // CVE-2021-41773
        { port: 3306, service: 'mysql', serviceVersion: 'MySQL 5.5.23' }, // CVE-2012-2122
      ]);
      const { context, fileContents } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      const statusContent = fileContents['/var/lib/dpkg/status'] ?? '';
      expect(statusContent).toContain('Package: http');
      expect(statusContent).toContain('Package: mysql');
      // ssh was safe, so it should NOT be in the status file
      expect(statusContent).not.toContain('Package: ssh');
    });

    it('status file entries use the default safe sentinel version', () => {
      // In PR A there's no version timeline yet, so the upgrade target is
      // defaultServiceVersion(service) which returns 'latest'.
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context, fileContents } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade');

      if (!isAsyncOutput(result)) return;
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      const statusContent = fileContents['/var/lib/dpkg/status'] ?? '';
      expect(statusContent).toMatch(/Package: http[\s\S]*?Version: latest/);
    });

    it('preserves existing status file entries when upgrading', () => {
      // Simulate a machine that already has a seeded status file with ssh
      // entry, then upgrade http. The ssh entry should still be present.
      const initialStatus = `Package: ssh
Status: install ok installed
Version: OpenSSH 9.6
`;
      const machine = mkMachine([
        { port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.6' },
        { port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' },
      ]);
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        initialFiles: { '/var/lib/dpkg/status': initialStatus },
      });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade');

      if (!isAsyncOutput(result)) return;
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      const statusContent = fileContents['/var/lib/dpkg/status'] ?? '';
      expect(statusContent).toContain('Package: ssh');
      expect(statusContent).toContain('Package: http');
      expect(statusContent).toContain('Version: OpenSSH 9.6');
      expect(statusContent).toContain('Version: latest');
    });

    it('reports already-current when no services have active CVEs', () => {
      const machine = mkMachine([
        { port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.6' },
        { port: 80, service: 'http', serviceVersion: 'Apache/9.9.9' }, // no CVE match
      ]);
      const { context, fileContents } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade');

      // Either returns a sync string or an async output — both valid
      if (typeof result === 'string') {
        expect(result).toMatch(/0 (upgraded|to upgrade)/);
      } else if (isAsyncOutput(result)) {
        const lines: string[] = [];
        result.start(
          (line) => lines.push(line),
          () => {},
        );
        vi.advanceTimersByTime(5000);
        expect(lines.some((l) => /0 (upgraded|to upgrade)/.test(l))).toBe(true);
      }

      // No status file should be written
      expect(fileContents['/var/lib/dpkg/status']).toBeUndefined();
    });

    it('upgrades a specific service when given a service name', () => {
      const machine = mkMachine([
        { port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' },
        { port: 3306, service: 'mysql', serviceVersion: 'MySQL 5.5.23' },
      ]);
      const { context, fileContents } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade', 'http');

      if (!isAsyncOutput(result)) return;
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      const statusContent = fileContents['/var/lib/dpkg/status'] ?? '';
      // Only http should appear in the status file, not mysql
      expect(statusContent).toContain('Package: http');
      expect(statusContent).not.toContain('Package: mysql');
    });

    it('throws when upgrading a service that is not running on the current machine', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      expect(() => apt.fn('upgrade', 'mysql')).toThrow(/not running|Unable to locate/);
    });

    it('reports already-current for a specific service that is already safe', () => {
      const machine = mkMachine([{ port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.6' }]);
      const { context, fileContents } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade', 'ssh');

      if (typeof result === 'string') {
        expect(result).toMatch(/already|0 (upgraded|to upgrade)/);
      } else if (isAsyncOutput(result)) {
        const lines: string[] = [];
        result.start(
          (line) => lines.push(line),
          () => {},
        );
        vi.advanceTimersByTime(5000);
        expect(lines.some((l) => /already|0 (upgraded|to upgrade)/.test(l))).toBe(true);
      }
      // No status file should be written since nothing was upgraded
      expect(fileContents['/var/lib/dpkg/status']).toBeUndefined();
    });

    it('displays realistic apt upgrade output lines', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade');

      if (!isAsyncOutput(result)) return;
      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      vi.advanceTimersByTime(5000);

      expect(lines.some((l) => l.includes('Reading package lists'))).toBe(true);
      expect(lines.some((l) => /\d+ upgraded/.test(l))).toBe(true);
      expect(lines.some((l) => l.includes('http'))).toBe(true);
    });
  });
});
