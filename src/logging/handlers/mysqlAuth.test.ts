import { describe, expect, it, vi } from 'vitest';

import { createMysqlAuthHandler, type MysqlAuthDeps } from './mysqlAuth';

const makeLogFs = () => ({
  readFileFromMachine: vi.fn().mockReturnValue(null),
  writeFileToMachine: vi.fn().mockReturnValue({ allowed: true }),
  createFileOnMachine: vi.fn().mockReturnValue({ allowed: true }),
});

const makeDeps = (overrides: Partial<MysqlAuthDeps> = {}): MysqlAuthDeps => ({
  sessionMachine: 'localhost',
  ownWorkstationId: 'localhost',
  getLocalIP: () => '10.45.12.100',
  getPublicIP: () => '198.51.100.42',
  resolveNat: (ip, port) => ({ ip, port }),
  readFileFromMachine: () => null,
  logFs: makeLogFs(),
  ...overrides,
});

describe('createMysqlAuthHandler', () => {
  it('writes mysql.log to the backend when port 3306 is NAT-forwarded', () => {
    const logFs = makeLogFs();
    const handler = createMysqlAuthHandler(
      makeDeps({
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 3306 ? { ip: '10.0.1.20', port: 3306 } : { ip, port },
        logFs,
      }),
    );

    handler({ success: true, user: 'dbadmin', targetIP: '203.0.113.5', port: 3306 });

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '10.0.1.20', path: '/var/log/mysql.log' }),
    );
  });

  it('reads the database name from the backend (not router) when NAT-forwarded', () => {
    const readFileFromMachine = vi.fn().mockReturnValue(JSON.stringify({ name: 'webapp_db' }));
    const handler = createMysqlAuthHandler(
      makeDeps({
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 3306 ? { ip: '10.0.1.20', port: 3306 } : { ip, port },
        readFileFromMachine,
      }),
    );

    handler({ success: true, user: 'dbadmin', targetIP: '203.0.113.5', port: 3306 });

    expect(readFileFromMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '10.0.1.20' }),
    );
  });

  it('includes the resolved database name in the connect log line', () => {
    const logFs = makeLogFs();
    const handler = createMysqlAuthHandler(
      makeDeps({
        readFileFromMachine: () => JSON.stringify({ name: 'webapp_db', tables: {} }),
        logFs,
      }),
    );

    handler({ success: true, user: 'alice', targetIP: '10.0.1.20', port: 3306 });

    const call = logFs.createFileOnMachine.mock.calls[0]?.[0] as { readonly content: string };
    expect(call.content).toContain('webapp_db');
  });

  it('writes access denied to the backend on failed auth', () => {
    const logFs = makeLogFs();
    const handler = createMysqlAuthHandler(
      makeDeps({
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 3306 ? { ip: '10.0.1.20', port: 3306 } : { ip, port },
        logFs,
      }),
    );

    handler({ success: false, user: 'eve', targetIP: '203.0.113.5', port: 3306 });

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '10.0.1.20', path: '/var/log/mysql.log' }),
    );
    const call = logFs.createFileOnMachine.mock.calls[0]?.[0] as { readonly content: string };
    expect(call.content).toContain('Access denied');
  });

  it('writes to target IP unchanged when no NAT rule matches (router-native mysqld)', () => {
    const logFs = makeLogFs();
    const handler = createMysqlAuthHandler(
      makeDeps({
        resolveNat: (ip, port) => ({ ip, port }),
        logFs,
      }),
    );

    handler({ success: true, user: 'root', targetIP: '192.168.1.50', port: 3306 });

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '192.168.1.50' }),
    );
  });
});
