import { describe, expect, it, vi } from 'vitest';

import { createNcConnectHandler, type NcConnectDeps } from './ncConnect';

const makeLogFs = () => ({
  readFileFromMachine: vi.fn().mockReturnValue(null),
  writeFileToMachine: vi.fn().mockReturnValue({ allowed: true }),
  createFileOnMachine: vi.fn().mockReturnValue({ allowed: true }),
});

const makeDeps = (overrides: Partial<NcConnectDeps> = {}): NcConnectDeps => ({
  sessionMachine: 'localhost',
  getLocalIP: () => '10.45.12.100',
  getPublicIP: () => '198.51.100.42',
  resolveNat: (ip, port) => ({ ip, port }),
  getMachine: () => undefined,
  logFs: makeLogFs(),
  ...overrides,
});

describe('createNcConnectHandler', () => {
  it('writes syslog entry to the backend when the port is NAT-forwarded', () => {
    const logFs = makeLogFs();
    const handler = createNcConnectHandler(
      makeDeps({
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 4444 ? { ip: '10.0.1.20', port: 4444 } : { ip, port },
        getMachine: (ip) => (ip === '10.0.1.20' ? { hostname: 'backend' } : { hostname: 'router' }),
        logFs,
      }),
    );

    handler({ targetIp: '203.0.113.5', port: 4444, success: true });

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '10.0.1.20', path: '/var/log/syslog' }),
    );
  });

  it('writes syslog entry to target IP unchanged when no NAT rule matches', () => {
    const logFs = makeLogFs();
    const handler = createNcConnectHandler(
      makeDeps({
        resolveNat: (ip, port) => ({ ip, port }),
        getMachine: (ip) => (ip === '203.0.113.5' ? { hostname: 'router' } : undefined),
        logFs,
      }),
    );

    handler({ targetIp: '203.0.113.5', port: 4444, success: true });

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '203.0.113.5' }),
    );
  });

  it('uses the resolved backend hostname in the log line', () => {
    const logFs = makeLogFs();
    const handler = createNcConnectHandler(
      makeDeps({
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 4444 ? { ip: '10.0.1.20', port: 4444 } : { ip, port },
        getMachine: (ip) => (ip === '10.0.1.20' ? { hostname: 'backend' } : { hostname: 'router' }),
        logFs,
      }),
    );

    handler({ targetIp: '203.0.113.5', port: 4444, success: true });

    const call = logFs.createFileOnMachine.mock.calls[0]?.[0] as { readonly content: string };
    expect(call.content).toContain('backend');
    expect(call.content).not.toContain('router');
  });
});
