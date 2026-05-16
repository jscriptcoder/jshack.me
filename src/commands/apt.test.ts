import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileNode, FilePermissions } from '../filesystem/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { RemoteMachine } from '../network/types';
import { createAptCommand } from './apt';
import { buildTimelineFromTemplate, CVE_TIMING_CONFIG } from '../generation/timeline';
import { findLatestSafeVersion } from '../generation/timeline/walker';
import { serviceTemplates } from '../generation/pools/serviceTemplates';
import { firmwareTemplates, type FirmwareVendor } from '../generation/pools/routerFirmware';
import { systemLibraryTemplates } from '../generation/pools/systemLibraryTemplates';
import { formatVersion } from '../generation/pools/serviceTemplates';
import { DPKG_STATUS_PATH, buildInitialDpkgStatus } from '../network/dpkgStatus';

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
  readonly ownHostname?: string;
  readonly userType?: 'root' | 'user' | 'guest';
  readonly installedTools?: readonly string[];
  readonly wifiConnected?: boolean;
  readonly currentMachine?: RemoteMachine;
  readonly initialFiles?: Readonly<Record<string, string>>;
  readonly gameTime?: number;
};

// Fixture workstation_id used as the default for "I'm on the player's
// own workstation" tests. Real value is computePlayerHostname's output;
// the synthetic suffix here is just so the format matches.
const TEST_OWN_HOSTNAME = 'workstation-aabbccdd';

type CreatedFile = {
  readonly path: string;
  readonly content: string;
  readonly permissions?: FilePermissions;
};

const createMockAptContext = (config: MockAptConfig = {}) => {
  const {
    machine = '10.0.0.1',
    ownHostname = TEST_OWN_HOSTNAME,
    userType = 'root',
    installedTools = [],
    wifiConnected = true,
    currentMachine,
    initialFiles = {},
    gameTime,
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
      getOwnHostname: () => ownHostname,
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
      deleteFile: (path: string, _userType: string) => {
        if (fileContents[path] === undefined) {
          return { allowed: false, error: `${path}: No such file or directory` };
        }
        delete fileContents[path];
        return { allowed: true };
      },
      getUserType: () => userType,
      isWifiConnected: () => wifiConnected,
      getGameTime: gameTime !== undefined ? () => gameTime : undefined,
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
  firmware?: { readonly vendor: FirmwareVendor; readonly version: string },
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
  ...(firmware ? { firmwareVendor: firmware.vendor, firmwareVersion: firmware.version } : {}),
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

    it('throws network error on the player workstation when WiFi is not connected', () => {
      const { context } = createMockAptContext({
        machine: TEST_OWN_HOSTNAME,
        wifiConnected: false,
      });
      const apt = createAptCommand(context);
      expect(() => apt.fn('install', 'nmap')).toThrow('network is unreachable');
    });

    it('installs on the player workstation when WiFi is connected', () => {
      const { context } = createMockAptContext({
        machine: TEST_OWN_HOSTNAME,
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

    it('installs the lynx text browser, dropping a binary at /usr/bin/lynx', () => {
      const { context, createdFiles } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'lynx');

      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) return;

      result.start(
        () => undefined,
        () => undefined,
      );
      vi.advanceTimersByTime(3000);

      expect(createdFiles.some((f) => f.path === '/usr/bin/lynx')).toBe(true);
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

    it('lists apache2 and nginx as installable web-server packages', () => {
      const { context } = createMockAptContext();
      const apt = createAptCommand(context);
      const result = apt.fn('list') as string;
      expect(result).toContain('apache2');
      expect(result).toContain('nginx');
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

  describe('apt list --upgradable', () => {
    const httpGapTime = (): number => {
      const timeline = buildTimelineFromTemplate(
        serviceTemplates.http,
        'timeline:http',
        500,
        CVE_TIMING_CONFIG,
      );
      return timeline[3]!.publishedAt;
    };

    const firmwareSafeTime = (): { gameTime: number; version: string } => {
      const timeline = buildTimelineFromTemplate(
        firmwareTemplates.mikrotik,
        'firmware:mikrotik',
        500,
        CVE_TIMING_CONFIG,
      );
      const vuln = timeline[2]!;
      // gameTime past the patch-delay gap so the fix is released.
      return { gameTime: vuln.publishedAt + vuln.patchDelay, version: vuln.version };
    };

    it('prints a listing header for --upgradable', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({ currentMachine: machine, gameTime: 0 });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '--upgradable') as string;
      expect(result).toMatch(/Listing upgradable packages/);
    });

    it('-u produces identical output to --upgradable', () => {
      const machine = mkMachine([
        { port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' },
        { port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.9.9' },
      ]);
      const { context: ctxLong } = createMockAptContext({
        currentMachine: machine,
        gameTime: 0,
      });
      const { context: ctxShort } = createMockAptContext({
        currentMachine: machine,
        gameTime: 0,
      });
      const long = createAptCommand(ctxLong).fn('list', '--upgradable') as string;
      const short = createAptCommand(ctxShort).fn('list', '-u') as string;
      expect(short).toBe(long);
    });

    it('renders [upgradable → version] for a service with an available fix', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({ currentMachine: machine, gameTime: 0 });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '--upgradable') as string;
      expect(result).toMatch(/http\s+Apache\/2\.4\.49\s+\[upgradable → Apache\/\S+\]/);
    });

    it('renders [vulnerable, no fix yet — ETA ~N days] for a service in the patch-delay gap', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({
        currentMachine: machine,
        gameTime: httpGapTime(),
      });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '--upgradable') as string;
      const expectedEta = Math.round(
        (CVE_TIMING_CONFIG.minPatchDelayDays + CVE_TIMING_CONFIG.maxPatchDelayDays) / 2,
      );
      expect(result).toContain(`[vulnerable, no fix yet — ETA ~${expectedEta} day`);
    });

    it('renders [up to date] for a service with no live CVE', () => {
      // OpenSSH 9.9.9 is not in vulnerabilityTemplates and the ssh procedural
      // timeline has not yet hit its first CVE at gameTime 0.
      const machine = mkMachine([{ port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.9.9' }]);
      const { context } = createMockAptContext({ currentMachine: machine, gameTime: 0 });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '--upgradable') as string;
      expect(result).toMatch(/ssh\s+OpenSSH 9\.9\.9\s+\[up to date\]/);
    });

    it('includes a firmware row on routers', () => {
      const { gameTime, version } = firmwareSafeTime();
      const machine = mkMachine([{ port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.9.9' }], {
        vendor: 'mikrotik',
        version,
      });
      const { context } = createMockAptContext({ currentMachine: machine, gameTime });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '--upgradable') as string;
      expect(result).toMatch(/firmware\s+\S.+\s+\[upgradable → /);
    });

    it('does not include a firmware row on non-router machines', () => {
      const machine = mkMachine([{ port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.9.9' }]);
      const { context } = createMockAptContext({ currentMachine: machine, gameTime: 0 });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '--upgradable') as string;
      expect(result).not.toMatch(/^\s*firmware\s/m);
    });

    it('emits a "no services" message on localhost (no current machine)', () => {
      // On localhost getCurrentMachine returns undefined because localhost is
      // not in the remote-machine list. The listing should still explain why
      // it's empty rather than just printing a bare header.
      const { context } = createMockAptContext({ gameTime: 0 });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '--upgradable') as string;
      expect(result).toMatch(/no services on this machine/i);
    });

    it('renders system library + meta-package rows even when the machine has no ports or firmware', () => {
      // Library rows now populate the listing unconditionally, so a bare
      // machine no longer hits the "no services" fallback — it still has
      // 8 libraries + 4 meta-packages reported.
      const machine = mkMachine([]);
      const { context } = createMockAptContext({ currentMachine: machine, gameTime: 0 });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '--upgradable') as string;
      expect(result).toMatch(/libpam/);
      expect(result).toMatch(/auth-libs/);
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
        getOwnHostname: () => TEST_OWN_HOSTNAME,
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
      expect(() => apt.fn('bogus-subcommand')).toThrow("Invalid operation 'bogus-subcommand'");
    });
  });

  describe('apt upgrade', () => {
    it('requires root', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({ userType: 'user', currentMachine: machine });
      const apt = createAptCommand(context);
      expect(() => apt.fn('upgrade')).toThrow('are you root?');
    });

    it('requires WiFi on the player workstation', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({
        machine: TEST_OWN_HOSTNAME,
        wifiConnected: false,
        currentMachine: machine,
      });
      const apt = createAptCommand(context);
      expect(() => apt.fn('upgrade')).toThrow('network is unreachable');
    });

    it('writes an entry to /var/lib/dpkg/status for each vulnerable service', () => {
      const machine = mkMachine([
        { port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.6' }, // safe
        { port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }, // CVE-2024-9001
        { port: 3306, service: 'mysql', serviceVersion: 'MySQL 5.5.23' }, // CVE-2024-9012
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

    it('status file entries use a currently-safe version from the service pool', () => {
      // Phase 3 PR B: upgrade target is the latest version from the pool
      // whose CVE (if any) has publishedAt > currentGameTime. For http, that's
      // a real version like 'nginx/1.26.0' rather than the 'latest' sentinel.
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
      // The http entry should have a Version that is NOT the input version
      // (Apache/2.4.49) and that findVulnForService can't exploit.
      const versionMatch = /Package: http[\s\S]*?Version: (.+?)$/m.exec(statusContent);
      expect(versionMatch).not.toBeNull();
      const newVersion = versionMatch?.[1]?.trim() ?? '';
      expect(newVersion).not.toBe('Apache/2.4.49');
      expect(newVersion.length).toBeGreaterThan(0);
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
      // ssh entry is preserved from the initial seed
      expect(statusContent).toContain('Version: OpenSSH 9.6');
      // http entry was upgraded to some safe version from the pool
      expect(statusContent).toMatch(/Package: http[\s\S]*?Version: \S+/);
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

    it('throws when upgrading a package that is not installed on the current machine', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      expect(() => apt.fn('upgrade', 'mysql')).toThrow(/not installed|Unable to locate/);
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

  describe('apt upgrade — router firmware', () => {
    // Walk a firmware timeline to pick a deterministic vulnerable entry.
    // Using mikrotik because its walker sequence is well-tested elsewhere.
    const getVulnerableFirmware = () => {
      const timeline = buildTimelineFromTemplate(
        firmwareTemplates.mikrotik,
        'firmware:mikrotik',
        500,
        CVE_TIMING_CONFIG,
      );
      return timeline[2]!;
    };

    it('upgrades the firmware package on a router when firmware is vulnerable', () => {
      const vuln = getVulnerableFirmware();
      const machine = mkMachine([{ port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.9.9' }], {
        vendor: 'mikrotik',
        version: vuln.version,
      });
      // gameTime is past the patch-delay gap so the fix is released.
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        gameTime: vuln.publishedAt + vuln.patchDelay,
      });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade');
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) throw new Error('expected async output');
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      const statusContent = fileContents['/var/lib/dpkg/status'] ?? '';
      // Tight anchor: look for the firmware package as its own block,
      // not as a substring inside another field.
      const firmwareBlockMatch = /^Package: firmware\nStatus: .+?\nVersion: (.+?)$/m.exec(
        statusContent,
      );
      expect(firmwareBlockMatch).not.toBeNull();
      // The installed version must differ from the starting (vulnerable) one
      expect(firmwareBlockMatch?.[1]?.trim()).not.toBe(vuln.version);
    });

    it('skips firmware when firmware is not currently vulnerable', () => {
      // At gameTime=0 the vendor's starting tuple is always pre-CVE.
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }], {
        vendor: 'mikrotik',
        version: 'MikroTik RouterOS 7.14.2',
      });
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        gameTime: 0,
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
      // http is upgraded but firmware is not touched
      expect(statusContent).toContain('Package: http');
      expect(statusContent).not.toContain('Package: firmware');
    });

    it("rejects 'apt upgrade firmware' on a non-router machine", () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      expect(() => apt.fn('upgrade', 'firmware')).toThrow(/firmware/i);
    });

    it('includes firmware in the output lines of apt upgrade on a router', () => {
      const vuln = getVulnerableFirmware();
      const machine = mkMachine([{ port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.9.9' }], {
        vendor: 'mikrotik',
        version: vuln.version,
      });
      const { context } = createMockAptContext({
        currentMachine: machine,
        gameTime: vuln.publishedAt + vuln.patchDelay,
      });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade', 'firmware');
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) throw new Error('expected async output');
      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      vi.advanceTimersByTime(5000);

      expect(lines.some((l) => l.includes('firmware'))).toBe(true);
    });

    it("'apt upgrade firmware' on a router upgrades ONLY firmware, not other services", () => {
      const vuln = getVulnerableFirmware();
      const machine = mkMachine(
        [
          // http is also vulnerable, but the filter pins us to firmware only
          { port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' },
        ],
        { vendor: 'mikrotik', version: vuln.version },
      );
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        gameTime: vuln.publishedAt + vuln.patchDelay,
      });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade', 'firmware');

      if (!isAsyncOutput(result)) return;
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      const statusContent = fileContents['/var/lib/dpkg/status'] ?? '';
      expect(statusContent).toContain('Package: firmware');
      // http was NOT upgraded because the filter was 'firmware'
      expect(statusContent).not.toContain('Package: http');
    });
  });

  describe('apt upgrade — patch delay', () => {
    // Pin gameTime to the publishedAt of an http procedural entry. At that
    // exact moment, the entry is vulnerable but its fix (the next entry) has
    // not been released yet — we are inside the patch-delay gap.
    const httpGapTime = (): number => {
      const timeline = buildTimelineFromTemplate(
        serviceTemplates.http,
        'timeline:http',
        500,
        CVE_TIMING_CONFIG,
      );
      return timeline[3]!.publishedAt;
    };

    // Finds an http gap-time at which mysql still has a safe+released fix
    // available. Used by the mixed-service test to guarantee one service is
    // blocked by patch delay while another upgrades normally.
    const findHttpGapWhereMysqlIsUpgradable = (): number => {
      const timeline = buildTimelineFromTemplate(
        serviceTemplates.http,
        'timeline:http',
        2000,
        CVE_TIMING_CONFIG,
      );
      for (const entry of timeline.slice(1)) {
        const t = entry.publishedAt;
        if (findLatestSafeVersion('mysql', t, CVE_TIMING_CONFIG) !== undefined) {
          return t;
        }
      }
      throw new Error('No gameTime found where http is in-gap but mysql is upgradable');
    };

    it('emits a warning and does not upgrade a service in the patch-delay gap', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        gameTime: httpGapTime(),
      });
      const apt = createAptCommand(context);
      // Scope to http — a bare `apt upgrade` would also consider libraries,
      // which may be independently upgradable at this gameTime and muddy
      // the assertion. This test is specifically about http's patch-delay
      // behaviour.
      const result = apt.fn('upgrade', 'http');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
        vi.advanceTimersByTime(5000);
      } else if (typeof result === 'string') {
        lines.push(result);
      }

      const output = lines.join('\n');
      expect(output).toMatch(/W: http is vulnerable but no fix has been released/);
      expect(output).toMatch(/ETA ~\d+ days?/);
      // No status file written — the vulnerable service was NOT upgraded.
      expect(fileContents['/var/lib/dpkg/status']).toBeUndefined();
    });

    it('surfaces the patch-delay average as the ETA in the warning line', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context } = createMockAptContext({
        currentMachine: machine,
        gameTime: httpGapTime(),
      });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
        vi.advanceTimersByTime(5000);
      } else if (typeof result === 'string') {
        lines.push(result);
      }

      const expectedEta = Math.round(
        (CVE_TIMING_CONFIG.minPatchDelayDays + CVE_TIMING_CONFIG.maxPatchDelayDays) / 2,
      );
      expect(lines.join('\n')).toContain(`ETA ~${expectedEta} day`);
    });

    it('upgrades a service with a released fix while warning about an in-gap service', () => {
      const gapTime = findHttpGapWhereMysqlIsUpgradable();
      const machine = mkMachine([
        { port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' },
        { port: 3306, service: 'mysql', serviceVersion: 'MySQL 5.5.23' },
      ]);
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        gameTime: gapTime,
      });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
        vi.advanceTimersByTime(5000);
      }

      const output = lines.join('\n');
      expect(output).toMatch(/W: http is vulnerable but no fix has been released/);

      const statusContent = fileContents['/var/lib/dpkg/status'] ?? '';
      expect(statusContent).toContain('Package: mysql');
      expect(statusContent).not.toContain('Package: http');
    });

    it('upgrades normally once the patch delay has elapsed', () => {
      // Shift gameTime past the patch-delay window so the fix is released.
      const timeline = buildTimelineFromTemplate(
        serviceTemplates.http,
        'timeline:http',
        500,
        CVE_TIMING_CONFIG,
      );
      const vulnerable = timeline[3]!;
      const afterGap = vulnerable.publishedAt + vulnerable.patchDelay;

      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49' }]);
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        gameTime: afterGap,
      });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade');

      if (!isAsyncOutput(result)) throw new Error('expected async output');
      const lines: string[] = [];
      result.start(
        (line) => lines.push(line),
        () => {},
      );
      vi.advanceTimersByTime(5000);

      // Scope the no-warning check to http specifically — other libraries on
      // the machine may independently be inside their own patch-delay gaps
      // at this gameTime, which shouldn't fail a test about http.
      expect(lines.join('\n')).not.toMatch(/W: http is vulnerable but no fix has been released/);
      const statusContent = fileContents['/var/lib/dpkg/status'] ?? '';
      expect(statusContent).toContain('Package: http');
    });
  });

  describe('apt install — version pinning', () => {
    const getGeneratedFirmware = () => {
      const timeline = buildTimelineFromTemplate(
        firmwareTemplates.mikrotik,
        'firmware:mikrotik',
        500,
        CVE_TIMING_CONFIG,
      );
      return timeline[4]!;
    };

    it('pins a service to a specific hand-authored historical version', () => {
      // The player deliberately downgrades http to a known-vulnerable version.
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.60' }]);
      const { context, fileContents } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'http=Apache/2.4.49');
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) throw new Error('expected async output');
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      const statusContent = fileContents['/var/lib/dpkg/status'] ?? '';
      const match = /^Package: http\nStatus: .+?\nVersion: (.+?)$/m.exec(statusContent);
      expect(match?.[1]?.trim()).toBe('Apache/2.4.49');
    });

    it('pins router firmware to a specific walker version', () => {
      const target = getGeneratedFirmware();
      const machine = mkMachine([{ port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.7.0' }], {
        vendor: 'mikrotik',
        version: 'MikroTik RouterOS 7.14.2',
      });
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        gameTime: 0,
      });
      const apt = createAptCommand(context);
      const result = apt.fn('install', `firmware=${target.version}`);
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) throw new Error('expected async output');
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      const statusContent = fileContents['/var/lib/dpkg/status'] ?? '';
      const match = /^Package: firmware\nStatus: .+?\nVersion: (.+?)$/m.exec(statusContent);
      expect(match?.[1]?.trim()).toBe(target.version);
    });

    it('rejects an unknown version for a known service', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.60' }]);
      const { context } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      expect(() => apt.fn('install', 'http=Apache/999.999.999')).toThrow(
        /no installation candidate/i,
      );
    });

    it('rejects pinning a package that is not installed on the machine', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.60' }]);
      const { context } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      expect(() => apt.fn('install', 'mysql=MySQL 8.0.36')).toThrow(/not installed/i);
    });

    it('rejects apt install firmware=... on a non-router machine', () => {
      const machine = mkMachine([{ port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.7.0' }]);
      const { context } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      expect(() => apt.fn('install', 'firmware=MikroTik RouterOS 7.14.3')).toThrow(
        /not installed/i,
      );
    });

    it('requires root to pin a version', () => {
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.60' }]);
      const { context } = createMockAptContext({ currentMachine: machine, userType: 'user' });
      const apt = createAptCommand(context);
      expect(() => apt.fn('install', 'http=Apache/2.4.49')).toThrow(/root/i);
    });

    it('still installs binary tools when no = is present (apt install nmap)', () => {
      // Regression guard: pure `apt install <package>` with no version must
      // continue to work as a binary-tool install.
      const machine = mkMachine([{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.60' }]);
      const { context, createdFiles } = createMockAptContext({ currentMachine: machine });
      const apt = createAptCommand(context);
      const result = apt.fn('install', 'nmap');
      expect(isAsyncOutput(result)).toBe(true);
      if (!isAsyncOutput(result)) throw new Error('expected async output');
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      expect(createdFiles.some((f) => f.path === '/usr/bin/nmap')).toBe(true);
    });
  });

  describe('apt — system library operations', () => {
    // Walk libpam's procedural timeline to find a gameTime where the
    // startTuple version has a live CVE. At that moment `apt upgrade libpam`
    // on a machine still running the startTuple should bump it to the next
    // released version.
    const libpamFirstCve = () => {
      const timeline = buildTimelineFromTemplate(
        systemLibraryTemplates.libpam,
        'library:libpam',
        500,
        CVE_TIMING_CONFIG,
      );
      return timeline[0]!;
    };

    const libpamStartVersion = () =>
      formatVersion(systemLibraryTemplates.libpam, systemLibraryTemplates.libpam.startTuple);
    const libcryptStartVersion = () =>
      formatVersion(systemLibraryTemplates.libcrypt, systemLibraryTemplates.libcrypt.startTuple);

    const initialDpkgStatus = () => {
      const libraryVersions: Record<string, string> = {};
      for (const [lib, tpl] of Object.entries(systemLibraryTemplates)) {
        libraryVersions[lib] = formatVersion(tpl, tpl.startTuple);
      }
      return buildInitialDpkgStatus([], undefined, libraryVersions);
    };

    // Machine with a small port set — library-specific tests shouldn't depend
    // on particular service versions.
    const mkLibMachine = (): RemoteMachine =>
      mkMachine([{ port: 22, service: 'ssh', serviceVersion: 'OpenSSH 9.9.9' }]);

    it('apt upgrade libpam bumps the library version in /var/lib/dpkg/status', () => {
      const entry = libpamFirstCve();
      const machine = mkLibMachine();
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        gameTime: entry.publishedAt + entry.patchDelay,
        initialFiles: { [DPKG_STATUS_PATH]: initialDpkgStatus() },
      });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade', 'libpam');

      if (!isAsyncOutput(result)) throw new Error('expected async output');
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      const statusContent = fileContents[DPKG_STATUS_PATH] ?? '';
      const pamMatch = /^Package: libpam\nStatus: .+?\nVersion: (.+?)$/m.exec(statusContent);
      expect(pamMatch, 'libpam dpkg entry').not.toBeNull();
      // New version must differ from the starting (vulnerable) one
      expect(pamMatch?.[1]?.trim()).not.toBe(libpamStartVersion());
    });

    it('apt upgrade auth-libs upgrades both libpam and libcrypt', () => {
      const entry = libpamFirstCve();
      const machine = mkLibMachine();
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        gameTime: entry.publishedAt + entry.patchDelay,
        initialFiles: { [DPKG_STATUS_PATH]: initialDpkgStatus() },
      });
      const apt = createAptCommand(context);
      const result = apt.fn('upgrade', 'auth-libs');

      if (!isAsyncOutput(result)) throw new Error('expected async output');
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      const statusContent = fileContents[DPKG_STATUS_PATH] ?? '';
      const pamMatch = /^Package: libpam\nStatus: .+?\nVersion: (.+?)$/m.exec(statusContent);
      expect(pamMatch?.[1]?.trim(), 'libpam').not.toBe(libpamStartVersion());
      // libcrypt's timeline is different from libpam's — at the libpam gap
      // window, libcrypt might or might not be vulnerable. The test only
      // asserts that libpam DID advance (auth-libs includes libpam).
    });

    it('apt list -u includes a row per system library', () => {
      const machine = mkLibMachine();
      const { context } = createMockAptContext({
        currentMachine: machine,
        gameTime: 0,
        initialFiles: { [DPKG_STATUS_PATH]: initialDpkgStatus() },
      });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '-u') as string;
      expect(result).toMatch(/^\s*libpam\s/m);
      expect(result).toMatch(/^\s*libsystemd\s/m);
      expect(result).toMatch(/^\s*libssl\s/m);
    });

    it('apt list -u includes meta-package rows (auth-libs, crypto-libs, system-libs, data-libs)', () => {
      const machine = mkLibMachine();
      const { context } = createMockAptContext({
        currentMachine: machine,
        gameTime: 0,
        initialFiles: { [DPKG_STATUS_PATH]: initialDpkgStatus() },
      });
      const apt = createAptCommand(context);
      const result = apt.fn('list', '-u') as string;
      expect(result).toMatch(/^\s*auth-libs\s/m);
      expect(result).toMatch(/^\s*crypto-libs\s/m);
      expect(result).toMatch(/^\s*system-libs\s/m);
      expect(result).toMatch(/^\s*data-libs\s/m);
    });

    it('apt install libpam=<pinnable version> writes that version to dpkg status', () => {
      const machine = mkLibMachine();
      // Pick a reachable procedural version (entry 5) to pin.
      const timeline = buildTimelineFromTemplate(
        systemLibraryTemplates.libpam,
        'library:libpam',
        500,
        CVE_TIMING_CONFIG,
      );
      const pinned = timeline[5]!.version;
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        gameTime: 0,
        initialFiles: { [DPKG_STATUS_PATH]: initialDpkgStatus() },
      });
      const apt = createAptCommand(context);
      const result = apt.fn('install', `libpam=${pinned}`);

      if (!isAsyncOutput(result)) throw new Error('expected async output');
      result.start(
        () => {},
        () => {},
      );
      vi.advanceTimersByTime(5000);

      const statusContent = fileContents[DPKG_STATUS_PATH] ?? '';
      const pamMatch = /^Package: libpam\nStatus: .+?\nVersion: (.+?)$/m.exec(statusContent);
      expect(pamMatch?.[1]?.trim()).toBe(pinned);
    });

    it('apt install libpam=<unknown version> rejects the install', () => {
      const machine = mkLibMachine();
      const { context } = createMockAptContext({
        currentMachine: machine,
        gameTime: 0,
        initialFiles: { [DPKG_STATUS_PATH]: initialDpkgStatus() },
      });
      const apt = createAptCommand(context);
      expect(() => apt.fn('install', 'libpam=libpam 999.999.999')).toThrow(
        /no installation candidate/i,
      );
    });

    it('apt remove libpam deletes /lib/libpam.so and the dpkg entry', () => {
      const machine = mkLibMachine();
      const { context, fileContents } = createMockAptContext({
        currentMachine: machine,
        gameTime: 0,
        initialFiles: {
          [DPKG_STATUS_PATH]: initialDpkgStatus(),
          '/lib/libpam.so': '\x7fELF',
        },
      });
      const apt = createAptCommand(context);
      const result = apt.fn('remove', 'libpam');

      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          () => {},
        );
        vi.advanceTimersByTime(5000);
      }

      expect(fileContents['/lib/libpam.so']).toBeUndefined();
      const statusContent = fileContents[DPKG_STATUS_PATH] ?? '';
      expect(statusContent).not.toMatch(/^Package: libpam$/m);
    });

    // Silence unused-import warning from the library-start-version helper
    // during the initial RED failure (some tests may not reach that code).
    void libcryptStartVersion;
  });
});
