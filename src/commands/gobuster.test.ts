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
    { port: 80, service: 'http', open: true },
    { port: 22, service: 'ssh', open: true },
  ],
  users: [{ username: 'www-data', passwordHash: 'abc', userType: 'user' }],
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

type GobusterContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly dnsRecords?: readonly DnsRecord[];
  readonly webRoot?: FileNode | null;
};

const createMockContext = (config: GobusterContextConfig = {}) => {
  const {
    machines = [getMockMachine()],
    dnsRecords = [getMockDnsRecord()],
    webRoot = defaultWebRoot,
  } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    resolveDomain: (domain: string) => dnsRecords.find((r) => r.domain === domain),
    resolveNat: (ip: string, port: number) => ({ ip, port }),
    getNodeFromMachine: (_machineId: string, path: string, _cwd: string): FileNode | null => {
      if (path === '/var/www/html') return webRoot;
      return null;
    },
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
          machines: [getMockMachine({ ports: [{ port: 80, service: 'http', open: false }] })],
        }),
      );
      expect(() => gobuster.fn('dir', 'http://webserver.local')).toThrow('Connection refused');
    });

    it('should throw when port is not an HTTP service', () => {
      const gobuster = createGobusterCommand(
        createMockContext({
          machines: [getMockMachine({ ports: [{ port: 80, service: 'ftp', open: true }] })],
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
          machines: [getMockMachine({ ports: [{ port: 8080, service: 'http-alt', open: true }] })],
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

      const context = {
        getMachine: (ip: string) =>
          ip === routerIP
            ? getMockMachine({ ip: routerIP, ports: [{ port: 80, service: 'http', open: true }] })
            : undefined,
        resolveDomain: () => undefined,
        resolveNat: (ip: string, port: number) =>
          ip === routerIP ? { ip: internalIP, port } : { ip, port },
        getNodeFromMachine: (machineId: string, path: string, _cwd: string): FileNode | null => {
          if (machineId === internalIP && path === '/var/www/html') return internalWebRoot;
          return null;
        },
      };

      const gobuster = createGobusterCommand(context);
      const lines = collectAsyncLines(gobuster.fn('dir', `http://${routerIP}`));
      expect(lines.some((l) => l.includes('/secret.html'))).toBe(true);
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
});
