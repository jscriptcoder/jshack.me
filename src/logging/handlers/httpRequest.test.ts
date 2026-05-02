import { describe, expect, it, vi } from 'vitest';

import { createHttpRequestHandler, type HttpRequestDeps } from './httpRequest';

const makeLogFs = () => ({
  readFileFromMachine: vi.fn().mockReturnValue(null),
  writeFileToMachine: vi.fn().mockReturnValue({ allowed: true }),
  createFileOnMachine: vi.fn().mockReturnValue({ allowed: true }),
});

const makeDeps = (overrides: Partial<HttpRequestDeps> = {}): HttpRequestDeps => ({
  sessionMachine: 'localhost',
  ownWorkstationId: 'localhost',
  getLocalIP: () => '10.45.12.100',
  getPublicIP: () => '198.51.100.42',
  resolveNat: (ip, port) => ({ ip, port }),
  logFs: makeLogFs(),
  ...overrides,
});

describe('createHttpRequestHandler', () => {
  it('writes access log to backend IP when the web port is NAT-forwarded', () => {
    const logFs = makeLogFs();
    const handler = createHttpRequestHandler(
      makeDeps({
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 8080 ? { ip: '10.0.1.20', port: 80 } : { ip, port },
        logFs,
      }),
    );

    handler({
      targetIP: '203.0.113.5',
      port: 8080,
      method: 'GET',
      path: '/admin',
      status: 200,
      size: 1234,
    });

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '10.0.1.20', path: '/var/log/access.log' }),
    );
  });

  it('routes to the right backend based on port (distinguishes 8080 vs 8443 forwards)', () => {
    const logFs = makeLogFs();
    const handler = createHttpRequestHandler(
      makeDeps({
        resolveNat: (ip, port) => {
          if (ip === '203.0.113.5' && port === 8080) return { ip: '10.0.1.20', port: 80 };
          if (ip === '203.0.113.5' && port === 8443) return { ip: '10.0.1.30', port: 443 };
          return { ip, port };
        },
        logFs,
      }),
    );

    handler({
      targetIP: '203.0.113.5',
      port: 8443,
      method: 'GET',
      path: '/',
      status: 200,
      size: 100,
    });

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '10.0.1.30' }),
    );
  });

  it('writes access log to target IP unchanged when no NAT rule matches', () => {
    const logFs = makeLogFs();
    const handler = createHttpRequestHandler(
      makeDeps({
        resolveNat: (ip, port) => ({ ip, port }),
        logFs,
      }),
    );

    handler({
      targetIP: '192.168.1.75',
      port: 80,
      method: 'GET',
      path: '/index.html',
      status: 200,
      size: 500,
    });

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '192.168.1.75' }),
    );
  });
});
