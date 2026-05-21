import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { RequestHandler } from '../themedNetworks/types';
import { createCurlCommand, parseUrl } from './curl';

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

type CurlContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly dnsRecords?: readonly DnsRecord[];
  readonly files?: Readonly<Record<string, string>>;
  readonly getHandler?: (machineIp: string) => RequestHandler | undefined;
};

const createMockCurlContext = (config: CurlContextConfig = {}) => {
  const {
    machines = [getMockMachine()],
    dnsRecords = [getMockDnsRecord()],
    files = {
      '/var/www/html/index.html': '<html><body>Welcome</body></html>',
      '/var/www/html/config.php': '<?php echo "Config"; ?>',
      '/var/www/api/users.json': '{"users":[]}',
    },
    getHandler,
  } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    resolveDomain: (domain: string) => dnsRecords.find((r) => r.domain === domain),
    resolveNat: (ip: string, port: number) => ({ ip, port }),
    readFileFromMachine: ({ path }: { readonly path: string }): string | null =>
      files[path] ?? null,
    getHandler,
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
  vi.advanceTimersByTime(700);
  return lines;
};

// --- Tests ---

describe('curl command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('should throw error when no URL given', () => {
      const curl = createCurlCommand(createMockCurlContext());
      expect(() => curl.fn()).toThrow('curl: no URL specified');
    });

    it('should throw error when host cannot be resolved', () => {
      const curl = createCurlCommand(createMockCurlContext({ dnsRecords: [] }));
      expect(() => curl.fn('http://unknown.host/')).toThrow(
        'curl: Could not resolve host: unknown.host',
      );
    });

    it('should throw error when machine is not found', () => {
      const curl = createCurlCommand(
        createMockCurlContext({
          dnsRecords: [getMockDnsRecord({ domain: 'ghost.local', ip: '10.0.0.99' })],
          machines: [],
        }),
      );
      expect(() => curl.fn('http://ghost.local/')).toThrow('Connection refused');
    });

    it('should throw error when HTTP port is not open', () => {
      const curl = createCurlCommand(
        createMockCurlContext({
          machines: [
            getMockMachine({
              ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: false }],
            }),
          ],
        }),
      );
      expect(() => curl.fn('http://webserver.local/')).toThrow('Connection refused');
    });

    it('should throw error when port is not an HTTP service', () => {
      const curl = createCurlCommand(
        createMockCurlContext({
          machines: [
            getMockMachine({
              ports: [{ port: 80, service: 'ftp', serviceVersion: 'latest', open: true }],
            }),
          ],
        }),
      );
      expect(() => curl.fn('http://webserver.local/')).toThrow('Connection refused');
    });

    it('should throw error for wrong port number', () => {
      const curl = createCurlCommand(createMockCurlContext());
      expect(() => curl.fn('http://webserver.local:8080/')).toThrow('Connection refused');
    });
  });

  describe('GET requests', () => {
    it('should fetch index.html for root path', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://webserver.local/'));
      expect(lines.join('\n')).toContain('<html><body>Welcome</body></html>');
    });

    it('should fetch file by path', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://webserver.local/config.php'));
      expect(lines.join('\n')).toContain('<?php echo "Config"; ?>');
    });

    it('should return 404 for missing file', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://webserver.local/missing.html'));
      expect(lines.join('\n')).toContain('404 Not Found');
    });

    it('should support shorthand URL without protocol', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('webserver.local/'));
      expect(lines.join('\n')).toContain('<html><body>Welcome</body></html>');
    });

    it('should resolve domain via DNS', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://webserver.local/index.html'));
      expect(lines.join('\n')).toContain('Welcome');
    });

    it('should work with direct IP address', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://192.168.1.75/'));
      expect(lines.join('\n')).toContain('<html><body>Welcome</body></html>');
    });
  });

  describe('POST requests', () => {
    it('should fetch API endpoint', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://webserver.local/api/users', '-X POST'));
      expect(lines.join('\n')).toContain('{"users":[]}');
    });

    it('should return 404 for missing API endpoint', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://webserver.local/api/missing', '-X POST'));
      expect(lines.join('\n')).toContain('"error"');
      expect(lines.join('\n')).toContain('Not Found');
    });

    it('should return 400 for POST to non-API path', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://webserver.local/index.html', '-X POST'));
      expect(lines.join('\n')).toContain('Invalid API endpoint');
    });
  });

  describe('headers with -i flag', () => {
    it('should not include headers without -i flag', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://webserver.local/'));
      const output = lines.join('\n');
      expect(output).not.toContain('HTTP/1.1');
      expect(output).not.toContain('Server:');
    });

    it('should include headers with -i flag', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://webserver.local/', '-i'));
      const output = lines.join('\n');
      expect(output).toContain('HTTP/1.1 200 OK');
      expect(output).toContain('Server:');
      expect(output).toContain('Content-Type:');
      expect(output).toContain('Content-Length:');
    });

    it('should include per-machine custom headers with -i flag', () => {
      const curl = createCurlCommand(
        createMockCurlContext({
          machines: [getMockMachine({ ip: '192.168.1.1', hostname: 'gateway' })],
          dnsRecords: [getMockDnsRecord({ domain: 'gateway.local', ip: '192.168.1.1' })],
        }),
      );
      const lines = collectAsyncLines(curl.fn('http://gateway.local/', '-i'));
      const output = lines.join('\n');
      expect(output).toContain('X-Powered-By: PHP/7.4.3');
    });

    it('should show 404 headers with -i flag', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://webserver.local/missing.html', '-i'));
      const output = lines.join('\n');
      expect(output).toContain('HTTP/1.1 404 Not Found');
    });

    it('should combine -i and -X POST flags', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://webserver.local/api/users', '-i -X POST'));
      const output = lines.join('\n');
      expect(output).toContain('HTTP/1.1 200 OK');
      expect(output).toContain('application/json');
      expect(output).toContain('{"users":[]}');
    });
  });

  describe('async behavior', () => {
    it('should return AsyncOutput', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const result = curl.fn('http://webserver.local/');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should not complete before delay', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const result = curl.fn('http://webserver.local/');

      let completed = false;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          () => {
            completed = true;
          },
        );
      }

      vi.advanceTimersByTime(300);
      expect(completed).toBe(false);
    });

    it('should complete after delay', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const result = curl.fn('http://webserver.local/');

      let completed = false;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          () => {
            completed = true;
          },
        );
      }

      vi.advanceTimersByTime(700);
      expect(completed).toBe(true);
    });

    it('should support cancellation', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const result = curl.fn('http://webserver.local/');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
        result.cancel?.();
        vi.advanceTimersByTime(1000);
      }

      expect(lines).toHaveLength(0);
    });
  });

  describe('.headers sidecar files', () => {
    it('should inject sidecar headers into response with -i flag', () => {
      const curl = createCurlCommand(
        createMockCurlContext({
          files: {
            '/var/www/html/index.html': '<html><body>Welcome</body></html>',
            '/var/www/html/index.html.headers': 'X-Secret-Key: admin:s3cret\nX-Custom: value123',
          },
        }),
      );
      const lines = collectAsyncLines(curl.fn('http://webserver.local/', '-i'));
      const output = lines.join('\n');
      expect(output).toContain('X-Secret-Key: admin:s3cret');
      expect(output).toContain('X-Custom: value123');
    });

    it('should not show sidecar headers without -i flag', () => {
      const curl = createCurlCommand(
        createMockCurlContext({
          files: {
            '/var/www/html/index.html': '<html><body>Welcome</body></html>',
            '/var/www/html/index.html.headers': 'X-Secret-Key: admin:s3cret',
          },
        }),
      );
      const lines = collectAsyncLines(curl.fn('http://webserver.local/'));
      const output = lines.join('\n');
      expect(output).not.toContain('X-Secret-Key');
    });

    it('should handle missing sidecar file gracefully', () => {
      const curl = createCurlCommand(
        createMockCurlContext({
          files: {
            '/var/www/html/index.html': '<html><body>Welcome</body></html>',
          },
        }),
      );
      const lines = collectAsyncLines(curl.fn('http://webserver.local/', '-i'));
      const output = lines.join('\n');
      expect(output).toContain('HTTP/1.1 200 OK');
      expect(output).toContain('Welcome');
    });

    it('should inject sidecar headers for non-root paths', () => {
      const curl = createCurlCommand(
        createMockCurlContext({
          files: {
            '/var/www/html/admin/config.json': '{"debug": false}',
            '/var/www/html/admin/config.json.headers': 'X-Internal-Auth: user:pass',
          },
        }),
      );
      const lines = collectAsyncLines(curl.fn('http://webserver.local/admin/config.json', '-i'));
      const output = lines.join('\n');
      expect(output).toContain('X-Internal-Auth: user:pass');
      expect(output).toContain('"debug"');
    });
  });

  describe('flags-first argument order', () => {
    it('should support -i flag before URL', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('-i', 'http://webserver.local/'));
      const output = lines.join('\n');
      expect(output).toContain('HTTP/1.1 200 OK');
      expect(output).toContain('Welcome');
    });

    it('should support -X POST flag before URL', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('-X POST', 'http://webserver.local/api/users'));
      const output = lines.join('\n');
      expect(output).toContain('{"users":[]}');
    });

    it('should support separate -i and -X POST flags before URL', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('-i', '-X POST', 'http://webserver.local/api/users'));
      const output = lines.join('\n');
      expect(output).toContain('HTTP/1.1 200 OK');
      expect(output).toContain('{"users":[]}');
    });

    it('should support flags before shorthand URL', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('-i', 'webserver.local/'));
      const output = lines.join('\n');
      expect(output).toContain('HTTP/1.1 200 OK');
      expect(output).toContain('Welcome');
    });
  });

  describe('custom port', () => {
    it('should support non-standard HTTP port', () => {
      const curl = createCurlCommand(
        createMockCurlContext({
          machines: [
            getMockMachine({
              ip: '203.0.113.42',
              ports: [{ port: 8080, service: 'http-alt', serviceVersion: 'latest', open: true }],
            }),
          ],
          dnsRecords: [getMockDnsRecord({ domain: 'darknet.ctf', ip: '203.0.113.42' })],
          files: {
            '/var/www/html/index.html': '<h1>Darknet</h1>',
          },
        }),
      );
      const lines = collectAsyncLines(curl.fn('http://darknet.ctf:8080/'));
      expect(lines.join('\n')).toContain('<h1>Darknet</h1>');
    });
  });

  describe('NAT resolution', () => {
    it('should read from the internal machine filesystem when NAT forwards', () => {
      // Router at public IP has port 80 open, but web content is on the internal machine
      const routerIP = '103.182.227.201';
      const internalIP = '10.147.206.10';
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
        readFileFromMachine: ({
          machineId,
          path,
        }: {
          readonly machineId: string;
          readonly path: string;
        }): string | null => {
          // Only the internal machine has web content
          if (machineId === internalIP && path === '/var/www/html/index.html') {
            return '<html>Internal Web Server</html>';
          }
          return null;
        },
      };
      const curl = createCurlCommand(context);
      const lines = collectAsyncLines(curl.fn(`http://${routerIP}/`));
      expect(lines.join('\n')).toContain('Internal Web Server');
    });

    it('should read sidecar headers from NAT-resolved machine', () => {
      const routerIP = '103.182.227.201';
      const internalIP = '10.147.206.10';
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
        readFileFromMachine: ({
          machineId,
          path,
        }: {
          readonly machineId: string;
          readonly path: string;
        }): string | null => {
          if (machineId !== internalIP) return null;
          if (path === '/var/www/html/status') return 'Status OK';
          if (path === '/var/www/html/status.headers') return 'X-Credentials: admin:secret';
          return null;
        },
      };
      const curl = createCurlCommand(context);
      const lines = collectAsyncLines(curl.fn(`http://${routerIP}/status`, '-i'));
      const output = lines.join('\n');
      expect(output).toContain('Status OK');
      expect(output).toContain('X-Credentials: admin:secret');
    });
  });

  describe('access logging callback', () => {
    it('calls onHttpRequest with GET details on success', () => {
      const onHttpRequest = vi.fn();
      const context = { ...createMockCurlContext(), onHttpRequest };
      const curl = createCurlCommand(context);
      collectAsyncLines(curl.fn('http://192.168.1.75/index.html'));

      expect(onHttpRequest).toHaveBeenCalledWith({
        targetIP: '192.168.1.75',
        port: 80,
        method: 'GET',
        path: '/index.html',
        status: 200,
        size: expect.any(Number),
      });
    });

    it('calls onHttpRequest with 404 on missing file', () => {
      const onHttpRequest = vi.fn();
      const context = { ...createMockCurlContext(), onHttpRequest };
      const curl = createCurlCommand(context);
      collectAsyncLines(curl.fn('http://192.168.1.75/missing'));

      expect(onHttpRequest).toHaveBeenCalledWith({
        targetIP: '192.168.1.75',
        port: 80,
        method: 'GET',
        path: '/missing',
        status: 404,
        size: 48,
      });
    });

    it('calls onHttpRequest with POST method', () => {
      const onHttpRequest = vi.fn();
      const context = { ...createMockCurlContext(), onHttpRequest };
      const curl = createCurlCommand(context);
      collectAsyncLines(curl.fn('-X POST', 'http://192.168.1.75/api/users'));

      expect(onHttpRequest).toHaveBeenCalledWith({
        targetIP: '192.168.1.75',
        port: 80,
        method: 'POST',
        path: '/api/users',
        status: 200,
        size: expect.any(Number),
      });
    });
  });

  describe('cross-LAN async pre-resolve', () => {
    // Mirrors ssh.ts's findMachineByIpAsync fallback. When the player
    // types `curl http://<foreign public IP>/` against another player's
    // workstation hosting apache2/nginx via NAT-forward, the command
    // awaits findMachineByIpAsync to materialize the foreign network
    // before fetching. Sync hits short-circuit the async path.

    it('falls back to findMachineByIpAsync when sync getMachine misses', async () => {
      const foreignMachine = getMockMachine({
        ip: '203.0.113.42',
        hostname: 'foreign-router',
        ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: true }],
      });
      const findMachineByIpAsync = vi.fn(async (ip: string) =>
        ip === '203.0.113.42' ? foreignMachine : undefined,
      );
      const context = {
        ...createMockCurlContext({ machines: [] }),
        findMachineByIpAsync,
      };
      const curl = createCurlCommand(context);

      const result = curl.fn('http://203.0.113.42/');
      expect(isAsyncOutput(result)).toBe(true);

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
      expect(completed).toBe(true);
      expect(lines.some((l) => l.includes('Welcome'))).toBe(true);
    });

    it('emits Connection refused via onLine when async resolver returns undefined', async () => {
      const findMachineByIpAsync = vi.fn(async () => undefined);
      const context = {
        ...createMockCurlContext({ machines: [] }),
        findMachineByIpAsync,
      };
      const curl = createCurlCommand(context);

      const result = curl.fn('http://203.0.113.99/');
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
        ...createMockCurlContext(),
        findMachineByIpAsync,
      };
      const curl = createCurlCommand(context);

      curl.fn('http://192.168.1.75/');

      expect(findMachineByIpAsync).not.toHaveBeenCalled();
    });

    it('throws synchronously on sync miss when findMachineByIpAsync is omitted (legacy)', () => {
      const context = createMockCurlContext({ machines: [] });
      const curl = createCurlCommand(context);

      expect(() => curl.fn('http://192.168.1.99/')).toThrow(/Connection refused|Could not resolve/);
    });
  });

  describe('handler dispatch', () => {
    it('uses handler response when handler returns non-null', () => {
      const handler: RequestHandler = () => ({
        statusCode: 200,
        statusText: 'OK',
        contentType: 'text/plain',
        body: 'handler-body',
      });
      const curl = createCurlCommand(createMockCurlContext({ getHandler: () => handler }));
      const lines = collectAsyncLines(curl.fn('http://192.168.1.75/'));
      expect(lines.join('\n')).toContain('handler-body');
    });

    it('falls back to static-file pipeline when handler returns null', () => {
      const handler: RequestHandler = () => null;
      const curl = createCurlCommand(createMockCurlContext({ getHandler: () => handler }));
      const lines = collectAsyncLines(curl.fn('http://192.168.1.75/'));
      expect(lines.join('\n')).toContain('<html><body>Welcome</body></html>');
    });

    it('falls back to static-file pipeline when no getHandler provided', () => {
      const curl = createCurlCommand(createMockCurlContext());
      const lines = collectAsyncLines(curl.fn('http://192.168.1.75/'));
      expect(lines.join('\n')).toContain('<html><body>Welcome</body></html>');
    });

    it('falls back to static when getHandler returns undefined for the target', () => {
      const curl = createCurlCommand(createMockCurlContext({ getHandler: () => undefined }));
      const lines = collectAsyncLines(curl.fn('http://192.168.1.75/'));
      expect(lines.join('\n')).toContain('<html><body>Welcome</body></html>');
    });

    it('passes method, path, and query to the handler', () => {
      const received = vi.fn();
      const handler: RequestHandler = (args) => {
        received(args);
        return { statusCode: 200, statusText: 'OK', contentType: 'text/plain', body: '' };
      };
      const curl = createCurlCommand(createMockCurlContext({ getHandler: () => handler }));
      collectAsyncLines(curl.fn('http://192.168.1.75/search?q=foo&page=2'));

      expect(received).toHaveBeenCalledWith({
        method: 'GET',
        path: '/search',
        query: 'q=foo&page=2',
      });
    });

    it('passes method=POST for -X POST', () => {
      const received = vi.fn();
      const handler: RequestHandler = (args) => {
        received(args);
        return { statusCode: 200, statusText: 'OK', contentType: 'text/plain', body: '' };
      };
      const curl = createCurlCommand(createMockCurlContext({ getHandler: () => handler }));
      collectAsyncLines(curl.fn('-X POST', 'http://192.168.1.75/api/users'));

      expect(received).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST', path: '/api/users' }),
      );
    });

    it('looks up the handler keyed by the resolved (post-NAT) machine IP', () => {
      const seenIps: string[] = [];
      const getHandler = (ip: string): RequestHandler | undefined => {
        seenIps.push(ip);
        return undefined;
      };
      const curl = createCurlCommand(createMockCurlContext({ getHandler }));
      collectAsyncLines(curl.fn('http://192.168.1.75/'));

      expect(seenIps).toContain('192.168.1.75');
    });

    it('exposes machine fs reads to the handler', () => {
      const handler: RequestHandler = (_args, fs) => ({
        statusCode: 200,
        statusText: 'OK',
        contentType: 'text/plain',
        body: fs.readFile('/etc/secret') ?? 'missing',
      });
      const curl = createCurlCommand(
        createMockCurlContext({
          files: {
            '/etc/secret': 'top-secret-value',
            '/var/www/html/index.html': '<html></html>',
          },
          getHandler: () => handler,
        }),
      );
      const lines = collectAsyncLines(curl.fn('http://192.168.1.75/'));
      expect(lines.join('\n')).toContain('top-secret-value');
    });

    it('emits handler-supplied content-type when -i flag includes headers', () => {
      const handler: RequestHandler = () => ({
        statusCode: 200,
        statusText: 'OK',
        contentType: 'application/json',
        body: '{"ok":true}',
      });
      const curl = createCurlCommand(createMockCurlContext({ getHandler: () => handler }));
      const lines = collectAsyncLines(curl.fn('-i', 'http://192.168.1.75/'));
      const output = lines.join('\n');
      expect(output).toContain('Content-Type: application/json');
      expect(output).toContain('{"ok":true}');
    });

    it('reports handler status code through onHttpRequest', () => {
      const handler: RequestHandler = () => ({
        statusCode: 418,
        statusText: "I'm a teapot",
        contentType: 'text/plain',
        body: 'short and stout',
      });
      const onHttpRequest = vi.fn();
      const context = {
        ...createMockCurlContext({ getHandler: () => handler }),
        onHttpRequest,
      };
      const curl = createCurlCommand(context);
      collectAsyncLines(curl.fn('http://192.168.1.75/'));

      expect(onHttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({ status: 418, size: 'short and stout'.length }),
      );
    });
  });
});

describe('parseUrl', () => {
  describe('without query string', () => {
    it('parses full URL with path — query is empty', () => {
      expect(parseUrl('http://192.168.1.1/index.html')).toEqual({
        protocol: 'http',
        host: '192.168.1.1',
        port: 80,
        path: '/index.html',
        query: '',
      });
    });

    it('parses URL with no path — path defaults to "/", query empty', () => {
      expect(parseUrl('http://findit.io')).toEqual({
        protocol: 'http',
        host: 'findit.io',
        port: 80,
        path: '/',
        query: '',
      });
    });

    it('parses https default port', () => {
      const result = parseUrl('https://findit.io/');
      expect(result?.port).toBe(443);
      expect(result?.protocol).toBe('https');
    });

    it('parses explicit port', () => {
      const result = parseUrl('http://findit.io:8080/');
      expect(result?.port).toBe(8080);
    });

    it('parses shorthand without protocol', () => {
      expect(parseUrl('192.168.1.1/index.html')).toEqual({
        protocol: 'http',
        host: '192.168.1.1',
        port: 80,
        path: '/index.html',
        query: '',
      });
    });

    it('returns null for invalid URLs', () => {
      expect(parseUrl('')).toBeNull();
    });
  });

  describe('with query string', () => {
    it('extracts single-param query from URL with no path', () => {
      expect(parseUrl('http://findit.io?q=graphic+card')).toEqual({
        protocol: 'http',
        host: 'findit.io',
        port: 80,
        path: '/',
        query: 'q=graphic+card',
      });
    });

    it('extracts query from URL with explicit "/" path', () => {
      const result = parseUrl('http://findit.io/?q=foo');
      expect(result?.path).toBe('/');
      expect(result?.query).toBe('q=foo');
    });

    it('extracts query from URL with non-root path', () => {
      const result = parseUrl('http://findit.io/search?q=foo');
      expect(result?.path).toBe('/search');
      expect(result?.query).toBe('q=foo');
    });

    it('extracts multi-param query', () => {
      const result = parseUrl('http://findit.io?q=foo&page=2&sort=date');
      expect(result?.query).toBe('q=foo&page=2&sort=date');
    });

    it('extracts query alongside explicit port', () => {
      const result = parseUrl('http://findit.io:8080/search?q=foo');
      expect(result).toEqual({
        protocol: 'http',
        host: 'findit.io',
        port: 8080,
        path: '/search',
        query: 'q=foo',
      });
    });

    it('extracts query from shorthand URL without protocol', () => {
      const result = parseUrl('findit.io?q=foo');
      expect(result).toEqual({
        protocol: 'http',
        host: 'findit.io',
        port: 80,
        path: '/',
        query: 'q=foo',
      });
    });

    it('keeps URL-encoded characters in query string verbatim', () => {
      // Query parsing/decoding is the handler's job — parseUrl just splits.
      const result = parseUrl('http://findit.io?q=hello%20world');
      expect(result?.query).toBe('q=hello%20world');
    });

    it('treats empty query as empty string, not undefined', () => {
      const result = parseUrl('http://findit.io/?');
      expect(result?.query).toBe('');
    });
  });
});
