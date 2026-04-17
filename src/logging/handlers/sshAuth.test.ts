import { describe, expect, it, vi } from 'vitest';

import { createSshAuthHandler, type SshAuthDeps } from './sshAuth';

const makeLogFs = () => ({
  readFileFromMachine: vi.fn().mockReturnValue(null),
  writeFileToMachine: vi.fn().mockReturnValue({ allowed: true }),
  createFileOnMachine: vi.fn().mockReturnValue({ allowed: true }),
});

const makeDeps = (overrides: Partial<SshAuthDeps> = {}): SshAuthDeps => ({
  sessionMachine: 'localhost',
  getLocalIP: () => '10.45.12.100',
  getPublicIP: () => '198.51.100.42',
  resolveNat: (ip, port) => ({ ip, port }),
  getMachine: () => undefined,
  logFs: makeLogFs(),
  ...overrides,
});

describe('createSshAuthHandler', () => {
  it('writes auth.log entry to the backend when SSH port is NAT-forwarded', () => {
    const logFs = makeLogFs();
    const handler = createSshAuthHandler(
      makeDeps({
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 2222 ? { ip: '10.0.1.20', port: 22 } : { ip, port },
        getMachine: (ip) =>
          ip === '10.0.1.20' ? { hostname: 'backend' } : { hostname: 'router' },
        logFs,
      }),
    );

    handler(true, 'admin', '203.0.113.5', 2222, 'password');

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '10.0.1.20', path: '/var/log/auth.log' }),
    );
  });

  it('writes to target IP unchanged when no NAT rule matches (router-native sshd)', () => {
    const logFs = makeLogFs();
    const handler = createSshAuthHandler(
      makeDeps({
        resolveNat: (ip, port) => ({ ip, port }),
        getMachine: (ip) => (ip === '203.0.113.5' ? { hostname: 'router' } : undefined),
        logFs,
      }),
    );

    handler(false, 'root', '203.0.113.5', 22, 'password');

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '203.0.113.5' }),
    );
  });

  it('uses the resolved backend hostname in the log line', () => {
    const logFs = makeLogFs();
    const handler = createSshAuthHandler(
      makeDeps({
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 2222 ? { ip: '10.0.1.20', port: 22 } : { ip, port },
        getMachine: (ip) =>
          ip === '10.0.1.20' ? { hostname: 'backend' } : { hostname: 'router' },
        logFs,
      }),
    );

    handler(true, 'admin', '203.0.113.5', 2222, 'publickey');

    const call = logFs.createFileOnMachine.mock.calls[0]?.[0] as { readonly content: string };
    expect(call.content).toContain('backend');
    expect(call.content).not.toContain('router');
  });

  it('formats publickey-accepted vs password-accepted vs failed differently', () => {
    const logFs = makeLogFs();
    const handler = createSshAuthHandler(
      makeDeps({ getMachine: () => ({ hostname: 'host' }), logFs }),
    );

    handler(true, 'alice', '10.0.1.20', 22, 'publickey');
    handler(true, 'bob', '10.0.1.20', 22, 'password');
    handler(false, 'eve', '10.0.1.20', 22, 'password');

    const contents = logFs.createFileOnMachine.mock.calls
      .concat(logFs.writeFileToMachine.mock.calls)
      .map((call) => (call[0] as { readonly content: string }).content)
      .join('\n');
    expect(contents).toContain('publickey');
    expect(contents).toMatch(/Accepted password/);
    expect(contents).toMatch(/Failed password/);
  });
});
