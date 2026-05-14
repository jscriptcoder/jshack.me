import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildLynxFetch, type LynxFetchContext } from './fetch';
import type { RemoteMachine, DnsRecord } from '../../network/types';
import type { HttpRequestHandler } from '../../logging/handlers/httpRequest';

const getMockMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '192.168.1.75',
  hostname: 'webserver',
  ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: true }],
  users: [],
  ...overrides,
});

const getMockDns = (overrides?: Partial<DnsRecord>): DnsRecord => ({
  domain: 'webserver.local',
  ip: '192.168.1.75',
  type: 'A',
  ...overrides,
});

const createCtx = (config?: {
  readonly machines?: readonly RemoteMachine[];
  readonly dnsRecords?: readonly DnsRecord[];
  readonly files?: Readonly<Record<string, string>>;
  readonly onHttpRequest?: HttpRequestHandler;
}): LynxFetchContext => {
  const machines = config?.machines ?? [getMockMachine()];
  const dnsRecords = config?.dnsRecords ?? [getMockDns()];
  const files = config?.files ?? { '/var/www/html/index.html': '<html>page</html>' };
  return {
    getMachine: (ip) => machines.find((m) => m.ip === ip),
    resolveDomain: (d) => dnsRecords.find((r) => r.domain === d),
    resolveNat: (ip, port) => ({ ip, port }),
    readFileFromMachine: ({ path }) => files[path] ?? null,
    onHttpRequest: config?.onHttpRequest,
  };
};

describe('buildLynxFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves with the HttpResponse for a successful GET', async () => {
    const fetch = buildLynxFetch(createCtx());
    const promise = fetch('http://webserver.local/');
    await vi.advanceTimersByTimeAsync(700);
    const response = await promise;
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('page');
  });

  it('rejects with the resolveHttpTarget error for an unknown host', async () => {
    const fetch = buildLynxFetch(createCtx({ dnsRecords: [] }));
    await expect(fetch('http://unknown.host/')).rejects.toThrow(
      'lynx: Could not resolve host: unknown.host',
    );
  });

  it('rejects with the resolveHttpTarget error for a closed port', async () => {
    const fetch = buildLynxFetch(
      createCtx({
        machines: [
          getMockMachine({
            ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: false }],
          }),
        ],
      }),
    );
    await expect(fetch('http://webserver.local/')).rejects.toThrow('Connection refused');
  });

  it('fires onHttpRequest with the GET access-log payload on success', async () => {
    const onHttpRequest = vi.fn();
    const fetch = buildLynxFetch(createCtx({ onHttpRequest }));
    const promise = fetch('http://webserver.local/index.html');
    await vi.advanceTimersByTimeAsync(700);
    await promise;
    expect(onHttpRequest).toHaveBeenCalledWith({
      targetIP: '192.168.1.75',
      port: 80,
      method: 'GET',
      path: '/index.html',
      status: 200,
      size: expect.any(Number),
    });
  });

  it('does not fire onHttpRequest when validation rejects', async () => {
    const onHttpRequest = vi.fn();
    const fetch = buildLynxFetch(createCtx({ dnsRecords: [], onHttpRequest }));
    await expect(fetch('http://unknown.host/')).rejects.toBeDefined();
    expect(onHttpRequest).not.toHaveBeenCalled();
  });
});
