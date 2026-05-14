import { describe, it, expect, vi } from 'vitest';
import type { RemoteMachine, DnsRecord } from './types';
import type { RequestHandler } from '../themedNetworks/types';
import { resolveHttpTarget, dispatchHttpRequest } from './http';

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

type ContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly dnsRecords?: readonly DnsRecord[];
  readonly files?: Readonly<Record<string, string>>;
  readonly resolveNat?: (
    ip: string,
    port: number,
  ) => { readonly ip: string; readonly port: number };
  readonly getHandler?: (machineIp: string) => RequestHandler | undefined;
};

const createMockContext = (config: ContextConfig = {}) => {
  const {
    machines = [getMockMachine()],
    dnsRecords = [getMockDnsRecord()],
    files = {
      '/var/www/html/index.html': '<html><body>Welcome</body></html>',
      '/var/www/html/config.php': '<?php echo "Config"; ?>',
      '/var/www/api/users.json': '{"users":[]}',
    },
    resolveNat = (ip: string, port: number) => ({ ip, port }),
    getHandler,
  } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    resolveDomain: (domain: string) => dnsRecords.find((r) => r.domain === domain),
    resolveNat,
    readFileFromMachine: ({ path }: { readonly path: string }): string | null =>
      files[path] ?? null,
    getHandler,
  };
};

// --- resolveHttpTarget ---

describe('resolveHttpTarget', () => {
  it('throws invalid-URL error for unparseable input', () => {
    expect(() => resolveHttpTarget(createMockContext(), '', 'curl')).toThrow('curl: invalid URL: ');
  });

  it('throws unresolved-host error when DNS lookup fails', () => {
    const ctx = createMockContext({ dnsRecords: [] });
    expect(() => resolveHttpTarget(ctx, 'http://unknown.host/', 'curl')).toThrow(
      'curl: Could not resolve host: unknown.host',
    );
  });

  it('throws connection-refused when machine is not present', () => {
    const ctx = createMockContext({
      dnsRecords: [getMockDnsRecord({ domain: 'ghost.local', ip: '10.0.0.99' })],
      machines: [],
    });
    expect(() => resolveHttpTarget(ctx, 'http://ghost.local/', 'curl')).toThrow(
      'curl: Failed to connect to ghost.local port 80: Connection refused',
    );
  });

  it('throws connection-refused when HTTP port is closed', () => {
    const ctx = createMockContext({
      machines: [
        getMockMachine({
          ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: false }],
        }),
      ],
    });
    expect(() => resolveHttpTarget(ctx, 'http://webserver.local/', 'curl')).toThrow(
      'Connection refused',
    );
  });

  it('throws connection-refused when port serves a non-HTTP service', () => {
    const ctx = createMockContext({
      machines: [
        getMockMachine({
          ports: [{ port: 80, service: 'ftp', serviceVersion: 'latest', open: true }],
        }),
      ],
    });
    expect(() => resolveHttpTarget(ctx, 'http://webserver.local/', 'curl')).toThrow(
      'Connection refused',
    );
  });

  it('throws connection-refused for an unmapped port number', () => {
    expect(() =>
      resolveHttpTarget(createMockContext(), 'http://webserver.local:8080/', 'curl'),
    ).toThrow('curl: Failed to connect to webserver.local port 8080: Connection refused');
  });

  it('returns the validated target for a direct IP', () => {
    const ctx = createMockContext();
    const target = resolveHttpTarget(ctx, 'http://192.168.1.75/', 'curl');
    expect(target.targetIP).toBe('192.168.1.75');
    expect(target.machine.ip).toBe('192.168.1.75');
    expect(target.port.port).toBe(80);
    expect(target.parsed.path).toBe('/');
  });

  it('returns the validated target after DNS resolution', () => {
    const ctx = createMockContext();
    const target = resolveHttpTarget(ctx, 'http://webserver.local/index.html', 'curl');
    expect(target.targetIP).toBe('192.168.1.75');
    expect(target.parsed.path).toBe('/index.html');
  });

  it('uses the commandName prefix for invalid-URL errors', () => {
    expect(() => resolveHttpTarget(createMockContext(), '', 'lynx')).toThrow('lynx: invalid URL: ');
  });

  it('uses the commandName prefix for connection-refused errors', () => {
    const ctx = createMockContext({ machines: [] });
    expect(() => resolveHttpTarget(ctx, 'http://webserver.local/', 'lynx')).toThrow(
      'lynx: Failed to connect to webserver.local port 80: Connection refused',
    );
  });
});

// --- dispatchHttpRequest ---

describe('dispatchHttpRequest', () => {
  it('returns 200 with file content for a static GET', () => {
    const ctx = createMockContext();
    const target = resolveHttpTarget(ctx, 'http://webserver.local/', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(result.response.statusCode).toBe(200);
    expect(result.response.body).toContain('Welcome');
  });

  it('returns 200 for a non-root static path', () => {
    const ctx = createMockContext();
    const target = resolveHttpTarget(ctx, 'http://webserver.local/config.php', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(result.response.statusCode).toBe(200);
    expect(result.response.body).toContain('<?php echo "Config"; ?>');
  });

  it('returns 404 when the static file is missing', () => {
    const ctx = createMockContext();
    const target = resolveHttpTarget(ctx, 'http://webserver.local/missing.html', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(result.response.statusCode).toBe(404);
    expect(result.response.body).toContain('404 Not Found');
  });

  it('returns 200 with handler body when getHandler returns a non-null response', () => {
    const handler: RequestHandler = () => ({
      statusCode: 200,
      statusText: 'OK',
      contentType: 'text/plain',
      body: 'handler-body',
    });
    const ctx = createMockContext({ getHandler: () => handler });
    const target = resolveHttpTarget(ctx, 'http://192.168.1.75/', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(result.response.body).toBe('handler-body');
  });

  it('falls back to the static-file pipeline when handler returns null', () => {
    const handler: RequestHandler = () => null;
    const ctx = createMockContext({ getHandler: () => handler });
    const target = resolveHttpTarget(ctx, 'http://192.168.1.75/', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(result.response.body).toContain('Welcome');
  });

  it('falls back to the static-file pipeline when no getHandler is configured', () => {
    const ctx = createMockContext();
    const target = resolveHttpTarget(ctx, 'http://192.168.1.75/', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(result.response.body).toContain('Welcome');
  });

  it('returns 200 with API content for a POST to /api/<name>', () => {
    const ctx = createMockContext();
    const target = resolveHttpTarget(ctx, 'http://webserver.local/api/users', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'POST' });
    expect(result.response.statusCode).toBe(200);
    expect(result.response.body).toContain('{"users":[]}');
  });

  it('returns 404 for a POST to a missing API endpoint', () => {
    const ctx = createMockContext();
    const target = resolveHttpTarget(ctx, 'http://webserver.local/api/missing', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'POST' });
    expect(result.response.statusCode).toBe(404);
  });

  it('returns 400 for a POST to a non-/api/ path', () => {
    const ctx = createMockContext();
    const target = resolveHttpTarget(ctx, 'http://webserver.local/index.html', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'POST' });
    expect(result.response.statusCode).toBe(400);
    expect(result.response.body).toContain('Invalid API endpoint');
  });

  it('reads from the NAT-resolved internal IP', () => {
    const routerIP = '103.182.227.201';
    const internalIP = '10.147.206.10';
    const machines = [
      getMockMachine({
        ip: routerIP,
        ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: true }],
      }),
    ];
    const ctx = {
      getMachine: (ip: string) => machines.find((m) => m.ip === ip),
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
        if (machineId === internalIP && path === '/var/www/html/index.html') {
          return '<html>Internal Web Server</html>';
        }
        return null;
      },
    };
    const target = resolveHttpTarget(ctx, `http://${routerIP}/`, 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(result.response.body).toContain('Internal Web Server');
  });

  it('returns the pre-NAT target IP for logging, even after NAT translation', () => {
    const routerIP = '103.182.227.201';
    const internalIP = '10.147.206.10';
    const ctx = {
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
      readFileFromMachine: () => null,
    };
    const target = resolveHttpTarget(ctx, `http://${routerIP}/`, 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(result.targetIP).toBe(routerIP);
  });

  it('echoes the method, path, and port back in the result', () => {
    const ctx = createMockContext();
    const target = resolveHttpTarget(ctx, 'http://webserver.local/anywhere', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'POST' });
    expect(result.method).toBe('POST');
    expect(result.path).toBe('/anywhere');
    expect(result.port).toBe(80);
  });

  it('passes method, path, and query through to the handler', () => {
    const received = vi.fn();
    const handler: RequestHandler = (args) => {
      received(args);
      return { statusCode: 200, statusText: 'OK', contentType: 'text/plain', body: '' };
    };
    const ctx = createMockContext({ getHandler: () => handler });
    const target = resolveHttpTarget(ctx, 'http://192.168.1.75/search?q=foo&page=2', 'curl');
    dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(received).toHaveBeenCalledWith({
      method: 'GET',
      path: '/search',
      query: 'q=foo&page=2',
    });
  });

  it('looks up the handler keyed by the post-NAT machine IP', () => {
    const seenIps: string[] = [];
    const routerIP = '103.182.227.201';
    const internalIP = '10.147.206.10';
    const ctx = {
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
      readFileFromMachine: () => null,
      getHandler: (ip: string): RequestHandler | undefined => {
        seenIps.push(ip);
        return undefined;
      },
    };
    const target = resolveHttpTarget(ctx, `http://${routerIP}/`, 'curl');
    dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(seenIps).toContain(internalIP);
  });

  it('exposes machine fs reads to the handler', () => {
    const handler: RequestHandler = (_args, fs) => ({
      statusCode: 200,
      statusText: 'OK',
      contentType: 'text/plain',
      body: fs.readFile('/etc/secret') ?? 'missing',
    });
    const ctx = createMockContext({
      files: {
        '/etc/secret': 'top-secret-value',
        '/var/www/html/index.html': '<html></html>',
      },
      getHandler: () => handler,
    });
    const target = resolveHttpTarget(ctx, 'http://192.168.1.75/', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(result.response.body).toBe('top-secret-value');
  });

  it('includes sidecar headers on a static GET response', () => {
    const ctx = createMockContext({
      files: {
        '/var/www/html/index.html': '<html></html>',
        '/var/www/html/index.html.headers': 'X-Secret: admin:s3cret',
      },
    });
    const target = resolveHttpTarget(ctx, 'http://webserver.local/', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'GET' });
    const headerEntries = result.response.headers.map(([k, v]) => `${k}: ${v}`);
    expect(headerEntries).toContain('X-Secret: admin:s3cret');
  });

  it('does not crash on a handler with an unusual status code', () => {
    const handler: RequestHandler = () => ({
      statusCode: 418,
      statusText: "I'm a teapot",
      contentType: 'text/plain',
      body: 'short and stout',
    });
    const ctx = createMockContext({ getHandler: () => handler });
    const target = resolveHttpTarget(ctx, 'http://192.168.1.75/', 'curl');
    const result = dispatchHttpRequest(ctx, target, { method: 'GET' });
    expect(result.response.statusCode).toBe(418);
    expect(result.response.body).toBe('short and stout');
  });
});
