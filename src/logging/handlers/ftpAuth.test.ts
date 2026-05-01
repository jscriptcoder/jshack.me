import { describe, expect, it, vi } from 'vitest';

import { createFtpAuthHandler, type FtpAuthDeps } from './ftpAuth';

const makeLogFs = () => ({
  readFileFromMachine: vi.fn().mockReturnValue(null),
  writeFileToMachine: vi.fn().mockReturnValue({ allowed: true }),
  createFileOnMachine: vi.fn().mockReturnValue({ allowed: true }),
});

const makeDeps = (overrides: Partial<FtpAuthDeps> = {}): FtpAuthDeps => ({
  sessionMachine: 'localhost',
  getLocalIP: () => '10.45.12.100',
  getPublicIP: () => '198.51.100.42',
  resolveNat: (ip, port) => ({ ip, port }),
  logFs: makeLogFs(),
  ...overrides,
});

describe('createFtpAuthHandler', () => {
  it('writes vsftpd.log to the backend when FTP port is NAT-forwarded', () => {
    const logFs = makeLogFs();
    const handler = createFtpAuthHandler(
      makeDeps({
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 21 ? { ip: '10.0.1.20', port: 21 } : { ip, port },
        logFs,
      }),
    );

    handler({ success: true, user: 'ftpuser', targetIP: '203.0.113.5', port: 21 });

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '10.0.1.20', path: '/var/log/vsftpd.log' }),
    );
  });

  it('writes to target IP unchanged when no NAT rule matches', () => {
    const logFs = makeLogFs();
    const handler = createFtpAuthHandler(
      makeDeps({
        resolveNat: (ip, port) => ({ ip, port }),
        logFs,
      }),
    );

    handler({ success: false, user: 'anonymous', targetIP: '192.168.1.50', port: 21 });

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '192.168.1.50' }),
    );
  });

  it('writes both connect line and OK login on success', () => {
    const logFs = makeLogFs();
    const handler = createFtpAuthHandler(makeDeps({ logFs }));

    handler({ success: true, user: 'alice', targetIP: '10.0.1.20', port: 21 });

    const call = logFs.createFileOnMachine.mock.calls[0]?.[0] as { readonly content: string };
    expect(call.content).toContain('CONNECT');
    expect(call.content).toContain('OK LOGIN');
    expect(call.content).toContain('alice');
  });

  it('writes failed login on failure', () => {
    const logFs = makeLogFs();
    const handler = createFtpAuthHandler(makeDeps({ logFs }));

    handler({ success: false, user: 'eve', targetIP: '10.0.1.20', port: 21 });

    const call = logFs.createFileOnMachine.mock.calls[0]?.[0] as { readonly content: string };
    expect(call.content).toContain('FAIL LOGIN');
  });
});
