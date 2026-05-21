import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import { createGobusterCommand } from './gobuster';

// --- Factory Functions ---

const getMockMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '192.168.1.75',
  hostname: 'webserver',
  ports: [
    { port: 80, service: 'http', serviceVersion: 'latest', open: true },
    { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
  ],
  users: [{ username: 'www-data', userType: 'user' }],
  ...overrides,
});

const getMockDnsRecord = (overrides?: Partial<DnsRecord>): DnsRecord => ({
  domain: 'webserver.local',
  ip: '192.168.1.75',
  type: 'A',
  ...overrides,
});

const makeFile = (name: string, content: string): FileNode => ({
  name,
  type: 'file',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: [],
  },
  content,
});

const makeDir = (name: string, children: Record<string, FileNode>): FileNode => ({
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

const defaultWebRoot = makeDir('html', {
  'index.html': makeFile('index.html', '<html><body>Welcome</body></html>'),
  status: makeFile('status', 'OK'),
  admin: makeDir('admin', {
    'config.json': makeFile('config.json', '{"debug": false}'),
  }),
});

// Default dirlist matches the entries in defaultWebRoot
const DEFAULT_DIRLIST = 'index.html\nstatus\nadmin';

const mkDirlistNode = (content: string = DEFAULT_DIRLIST): FileNode => ({
  name: 'dirlist.txt',
  type: 'file',
  owner: 'root',
  permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  content,
});

type GobusterContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly dnsRecords?: readonly DnsRecord[];
  readonly webRoot?: FileNode | null;
  readonly localFiles?: Readonly<Record<string, FileNode>>;
  readonly currentPath?: string;
};

const createMockContext = (config: GobusterContextConfig = {}) => {
  const {
    machines = [getMockMachine()],
    dnsRecords = [getMockDnsRecord()],
    webRoot = defaultWebRoot,
    localFiles = { '/usr/share/wordlists/dirlist.txt': mkDirlistNode() },
    currentPath = '/home/user',
  } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    resolveDomain: (domain: string) => dnsRecords.find((r) => r.domain === domain),
    resolveNat: (ip: string, port: number) => ({ ip, port }),
    getNodeFromMachine: (_machineId: string, path: string, _cwd: string): FileNode | null => {
      if (path === '/var/www/html') return webRoot;
      return null;
    },
    getLocalNode: (path: string) => (localFiles[path] as FileNode | undefined) ?? null,
    getCurrentPath: () => currentPath,
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

const collectAsyncLines = (result: unknown): readonly string[] => {
  const lines: string[] = [];
  if (isAsyncOutput(result)) {
    result.start(
      (line) => lines.push(line),
      () => {},
    );
  }
  vi.advanceTimersByTime(30000);
  return lines;
};

// --- Tests ---

describe('gobuster command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('should throw when mode is missing', () => {
      const gobuster = createGobusterCommand(createMockContext());
      expect(() => gobuster.fn()).toThrow('missing mode argument');
    });

    it('should throw when mode is not "dir"', () => {
      const gobuster = createGobusterCommand(createMockContext());
      expect(() => gobuster.fn('vhost', 'http://192.168.1.75')).toThrow("unsupported mode 'vhost'");
    });

    it('should throw when URL is missing', () => {
      const gobuster = createGobusterCommand(createMockContext());
      expect(() => gobuster.fn('dir')).toThrow('missing URL argument');
    });

    it('should throw when host cannot be resolved', () => {
      const gobuster = createGobusterCommand(createMockContext({ dnsRecords: [] }));
      expect(() => gobuster.fn('dir', 'http://unknown.host')).toThrow(
        'Could not resolve host: unknown.host',
      );
    });

    it('should throw when machine is not found', () => {
      const gobuster = createGobusterCommand(
        createMockContext({
          dnsRecords: [getMockDnsRecord({ domain: 'ghost.local', ip: '10.0.0.99' })],
          machines: [],
        }),
      );
      expect(() => gobuster.fn('dir', 'http://ghost.local')).toThrow('Connection refused');
    });

    it('should throw when HTTP port is not open', () => {
      const gobuster = createGobusterCommand(
        createMockContext({
          machines: [
            getMockMachine({
              ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: false }],
            }),
          ],
        }),
      );
      expect(() => gobuster.fn('dir', 'http://webserver.local')).toThrow('Connection refused');
    });

    it('should throw when port is not an HTTP service', () => {
      const gobuster = createGobusterCommand(
        createMockContext({
          machines: [
            getMockMachine({
              ports: [{ port: 80, service: 'ftp', serviceVersion: 'latest', open: true }],
            }),
          ],
        }),
      );
      expect(() => gobuster.fn('dir', 'http://webserver.local')).toThrow('Connection refused');
    });

    it('should throw when no web root exists', () => {
      const gobuster = createGobusterCommand(createMockContext({ webRoot: null }));
      expect(() => gobuster.fn('dir', 'http://webserver.local')).toThrow('no web root found');
    });
  });

  describe('successful scan', () => {
    it('should return AsyncOutput', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const result = gobuster.fn('dir', 'http://webserver.local');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should show header with Gobuster banner', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));
      expect(lines.some((l) => l.includes('Gobuster v3.6'))).toBe(true);
    });

    it('should show the target URL in header', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));
      expect(lines.some((l) => l.includes('http://webserver.local'))).toBe(true);
    });

    it('should list discovered files with status 200', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));
      const indexLine = lines.find((l) => l.includes('/index.html'));
      expect(indexLine).toBeDefined();
      expect(indexLine).toContain('Status: 200');
    });

    it('should list discovered directories with status 301', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));
      const adminLine = lines.find((l) => l.includes('/admin') && !l.includes('/admin/'));
      expect(adminLine).toBeDefined();
      expect(adminLine).toContain('Status: 301');
      expect(adminLine).toContain('Size: 0');
    });

    it('should show files inside subdirectories', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));
      const configLine = lines.find((l) => l.includes('/admin/config.json'));
      expect(configLine).toBeDefined();
      expect(configLine).toContain('Status: 200');
    });

    it('should show file size', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));
      const statusLine = lines.find((l) => l.includes('/status'));
      expect(statusLine).toBeDefined();
      expect(statusLine).toContain('Size: 2');
    });

    it('should show result count in footer', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));
      const footerLine = lines.find((l) => l.includes('Scan complete'));
      expect(footerLine).toBeDefined();
      expect(footerLine).toContain('results found');
    });
  });

  describe('.headers sidecar filtering', () => {
    it('should filter out .headers sidecar files from results', () => {
      const webRoot = makeDir('html', {
        'index.html': makeFile('index.html', '<html>Test</html>'),
        'index.html.headers': makeFile('index.html.headers', 'X-Secret: value'),
        status: makeFile('status', 'OK'),
        'status.headers': makeFile('status.headers', 'X-Token: abc'),
      });

      const gobuster = createGobusterCommand(createMockContext({ webRoot }));
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));

      expect(lines.some((l) => l.includes('.headers'))).toBe(false);
      expect(lines.some((l) => l.includes('/index.html'))).toBe(true);
      expect(lines.some((l) => l.includes('/status'))).toBe(true);
    });
  });

  describe('URL formats', () => {
    it('should work with direct IP address', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://192.168.1.75'));
      expect(lines.some((l) => l.includes('/index.html'))).toBe(true);
    });

    it('should work with shorthand URL without protocol', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const lines = collectAsyncLines(gobuster.fn('dir', '192.168.1.75'));
      expect(lines.some((l) => l.includes('/index.html'))).toBe(true);
    });

    it('should work with custom port', () => {
      const gobuster = createGobusterCommand(
        createMockContext({
          machines: [
            getMockMachine({
              ports: [{ port: 8080, service: 'http-alt', serviceVersion: 'latest', open: true }],
            }),
          ],
        }),
      );
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local:8080'));
      expect(lines.some((l) => l.includes('/index.html'))).toBe(true);
    });

    it('should resolve domain names via DNS', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));
      expect(lines.some((l) => l.includes('/index.html'))).toBe(true);
    });
  });

  describe('NAT resolution', () => {
    it('should read from the internal machine filesystem when NAT forwards', () => {
      const routerIP = '103.182.227.201';
      const internalIP = '10.147.206.10';

      const internalWebRoot = makeDir('html', {
        'secret.html': makeFile('secret.html', '<html>Secret Content</html>'),
      });

      const dirlistNode = mkDirlistNode('secret.html');
      const context = {
        getMachine: (ip: string) =>
          ip === routerIP
            ? getMockMachine({
                ip: routerIP,
                ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: true }],
              })
            : undefined,
        resolveDomain: () => undefined,
        resolveNat: (ip: string, port: number) =>
          ip === routerIP ? { ip: internalIP, port } : { ip, port },
        getNodeFromMachine: (machineId: string, path: string, _cwd: string): FileNode | null => {
          if (machineId === internalIP && path === '/var/www/html') return internalWebRoot;
          return null;
        },
        getLocalNode: (path: string) =>
          path === '/usr/share/wordlists/dirlist.txt' ? dirlistNode : null,
        getCurrentPath: () => '/home/user',
      };

      const gobuster = createGobusterCommand(context);
      const lines = collectAsyncLines(gobuster.fn('dir', `http://${routerIP}`));
      expect(lines.some((l) => l.includes('/secret.html'))).toBe(true);
    });

    it('should resolve NAT using the actual port, not hardcoded 80', () => {
      const routerIP = '103.182.227.201';
      const httpAltInternalIP = '10.147.206.20';

      const altWebRoot = makeDir('html', {
        'dashboard.html': makeFile('dashboard.html', '<html>Dashboard</html>'),
      });

      const dirlistNode = mkDirlistNode('dashboard.html');
      const context = {
        getMachine: (ip: string) =>
          ip === routerIP
            ? getMockMachine({
                ip: routerIP,
                ports: [{ port: 8080, service: 'http-alt', serviceVersion: 'latest', open: true }],
              })
            : undefined,
        resolveDomain: () => undefined,
        resolveNat: (ip: string, port: number) =>
          ip === routerIP && port === 8080 ? { ip: httpAltInternalIP, port } : { ip, port },
        getNodeFromMachine: (machineId: string, path: string, _cwd: string): FileNode | null => {
          if (machineId === httpAltInternalIP && path === '/var/www/html') return altWebRoot;
          return null;
        },
        getLocalNode: (path: string) =>
          path === '/usr/share/wordlists/dirlist.txt' ? dirlistNode : null,
        getCurrentPath: () => '/home/user',
      };

      const gobuster = createGobusterCommand(context);
      const lines = collectAsyncLines(gobuster.fn('dir', `http://${routerIP}:8080`));
      expect(lines.some((l) => l.includes('/dashboard.html'))).toBe(true);
    });
  });

  describe('cancellation', () => {
    it('should support cancellation', () => {
      const gobuster = createGobusterCommand(createMockContext());
      const result = gobuster.fn('dir', 'http://webserver.local');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
        result.cancel?.();
        vi.advanceTimersByTime(30000);
      }

      expect(lines).toHaveLength(0);
    });
  });

  describe('wordlist filtering', () => {
    it('should only show entries matching the dirlist', () => {
      const webRoot = makeDir('html', {
        admin: makeDir('admin', {
          'config.json': makeFile('config.json', '{"debug": false}'),
        }),
        secret: makeDir('secret', {
          'hidden.txt': makeFile('hidden.txt', 'top secret'),
        }),
        'index.html': makeFile('index.html', '<html>Test</html>'),
      });

      // Dirlist contains "admin" and "index.html" but NOT "secret"
      const gobuster = createGobusterCommand(
        createMockContext({
          webRoot,
          localFiles: {
            '/usr/share/wordlists/dirlist.txt': mkDirlistNode('admin\nindex.html'),
          },
        }),
      );
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));

      expect(lines.some((l) => l.includes('/admin'))).toBe(true);
      expect(lines.some((l) => l.includes('/admin/config.json'))).toBe(true);
      expect(lines.some((l) => l.includes('/index.html'))).toBe(true);
      // secret dir and its children should be hidden
      expect(lines.some((l) => l.includes('/secret'))).toBe(false);
      expect(lines.some((l) => l.includes('/hidden.txt'))).toBe(false);
    });

    it('should show zero results when no entries match dirlist', () => {
      const gobuster = createGobusterCommand(
        createMockContext({
          localFiles: {
            '/usr/share/wordlists/dirlist.txt': mkDirlistNode('nonexistent'),
          },
        }),
      );
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));
      expect(lines.some((l) => l.includes('0 results found'))).toBe(true);
    });

    it('should throw when dirlist wordlist is not found', () => {
      const gobuster = createGobusterCommand(createMockContext({ localFiles: {} }));
      expect(() => gobuster.fn('dir', 'http://webserver.local')).toThrow(
        'wordlist not found: dirlist.txt',
      );
    });

    it('should find dirlist in cwd before /usr/share/wordlists/', () => {
      const webRoot = makeDir('html', {
        admin: makeDir('admin', {
          'config.json': makeFile('config.json', '{}'),
        }),
        'index.html': makeFile('index.html', '<html></html>'),
      });

      // cwd dirlist only has "admin", system dirlist has "index.html"
      const gobuster = createGobusterCommand(
        createMockContext({
          webRoot,
          localFiles: {
            '/home/user/dirlist.txt': mkDirlistNode('admin'),
            '/usr/share/wordlists/dirlist.txt': mkDirlistNode('index.html'),
          },
          currentPath: '/home/user',
        }),
      );
      const lines = collectAsyncLines(gobuster.fn('dir', 'http://webserver.local'));

      // Should use cwd dirlist (admin only)
      expect(lines.some((l) => l.includes('/admin'))).toBe(true);
      expect(lines.some((l) => l.includes('/index.html'))).toBe(false);
    });
  });

  describe('scan aggregate callback', () => {
    it('calls onScanAggregate exactly once per scan with probed and hit counts', () => {
      const onScanAggregate = vi.fn();
      const context = { ...createMockContext(), onScanAggregate };
      const gobuster = createGobusterCommand(context);
      collectAsyncLines(gobuster.fn('dir', 'http://192.168.1.75'));

      // defaultWebRoot has: /index.html, /status, /admin (dir), /admin/config.json.
      // DEFAULT_DIRLIST = 'index.html\nstatus\nadmin' → 3 probed entries.
      // Hit count is 4 because /admin/config.json is reached via the 'admin' top-level match.
      expect(onScanAggregate).toHaveBeenCalledTimes(1);
      expect(onScanAggregate).toHaveBeenCalledWith({
        targetIp: '192.168.1.75',
        port: 80,
        probedCount: 3,
        hitCount: 4,
      });
    });

    it('calls onScanAggregate with zero hits when no entries match', () => {
      const onScanAggregate = vi.fn();
      const context = {
        ...createMockContext({
          localFiles: {
            '/usr/share/wordlists/dirlist.txt': mkDirlistNode('nonexistent'),
          },
        }),
        onScanAggregate,
      };
      const gobuster = createGobusterCommand(context);
      collectAsyncLines(gobuster.fn('dir', 'http://192.168.1.75'));

      expect(onScanAggregate).toHaveBeenCalledTimes(1);
      expect(onScanAggregate).toHaveBeenCalledWith({
        targetIp: '192.168.1.75',
        port: 80,
        probedCount: 1,
        hitCount: 0,
      });
    });

    it('reports the actual port scanned (not hardcoded 80)', () => {
      const onScanAggregate = vi.fn();
      const context = {
        ...createMockContext({
          machines: [
            getMockMachine({
              ports: [{ port: 8080, service: 'http-alt', serviceVersion: 'latest', open: true }],
            }),
          ],
        }),
        onScanAggregate,
      };
      const gobuster = createGobusterCommand(context);
      collectAsyncLines(gobuster.fn('dir', 'http://192.168.1.75:8080'));

      expect(onScanAggregate).toHaveBeenCalledWith(
        expect.objectContaining({ port: 8080, targetIp: '192.168.1.75' }),
      );
    });

    it('does not call onScanAggregate when the scan is cancelled before completion', () => {
      const onScanAggregate = vi.fn();
      const context = { ...createMockContext(), onScanAggregate };
      const gobuster = createGobusterCommand(context);
      const result = gobuster.fn('dir', 'http://192.168.1.75');

      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          () => {},
        );
        result.cancel?.();
        vi.advanceTimersByTime(30000);
      }

      expect(onScanAggregate).not.toHaveBeenCalled();
    });
  });

  describe('cross-LAN async pre-resolve', () => {
    // Mirrors ssh.ts's findMachineByIpAsync fallback. When the player
    // types `gobuster dir http://<foreign public IP>` against another
    // player's workstation hosting apache2/nginx via NAT-forward, the
    // command awaits findMachineByIpAsync to materialize the foreign
    // network before walking /var/www/html.

    it('falls back to findMachineByIpAsync when sync getMachine misses', async () => {
      const foreignMachine = getMockMachine({ ip: '203.0.113.42' });
      const findMachineByIpAsync = vi.fn(async (ip: string) =>
        ip === '203.0.113.42' ? foreignMachine : undefined,
      );
      const context = {
        ...createMockContext({ machines: [] }),
        findMachineByIpAsync,
      };
      const gobuster = createGobusterCommand(context);

      const result = gobuster.fn('dir', 'http://203.0.113.42');
      const lines: string[] = [];
      let completed = false;
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {
            completed = true;
          },
        );
      }
      await vi.runAllTimersAsync();

      expect(findMachineByIpAsync).toHaveBeenCalledWith('203.0.113.42');
      expect(lines.some((l) => l.includes('Gobuster v3.6'))).toBe(true);
      expect(completed).toBe(true);
    });

    it('emits Connection refused via onLine when async resolver returns undefined', async () => {
      const findMachineByIpAsync = vi.fn(async () => undefined);
      const context = {
        ...createMockContext({ machines: [] }),
        findMachineByIpAsync,
      };
      const gobuster = createGobusterCommand(context);

      const result = gobuster.fn('dir', 'http://203.0.113.99');
      const lines: string[] = [];
      let completed = false;
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {
            completed = true;
          },
        );
      }
      await vi.runAllTimersAsync();

      expect(findMachineByIpAsync).toHaveBeenCalledWith('203.0.113.99');
      expect(lines.some((l) => l.includes('Connection refused'))).toBe(true);
      expect(completed).toBe(true);
    });

    it('does NOT call findMachineByIpAsync when sync getMachine hits', () => {
      const findMachineByIpAsync = vi.fn(async () => undefined);
      const context = {
        ...createMockContext(),
        findMachineByIpAsync,
      };
      const gobuster = createGobusterCommand(context);

      gobuster.fn('dir', 'http://192.168.1.75');

      expect(findMachineByIpAsync).not.toHaveBeenCalled();
    });

    it('throws synchronously on sync miss when findMachineByIpAsync is omitted (legacy)', () => {
      const context = createMockContext({ machines: [] });
      const gobuster = createGobusterCommand(context);
      expect(() => gobuster.fn('dir', 'http://10.0.0.1')).toThrow('Connection refused');
    });
  });
});
