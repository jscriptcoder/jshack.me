import { describe, expect, it, vi } from 'vitest';

import { createRedisAuthHandler, createRedisConnectHandler, type RedisAuthDeps } from './redisAuth';

const makeLogFs = () => ({
  readFileFromMachine: vi.fn().mockReturnValue(null),
  writeFileToMachine: vi.fn().mockReturnValue({ allowed: true }),
  createFileOnMachine: vi.fn().mockReturnValue({ allowed: true }),
});

const makeDeps = (overrides: Partial<RedisAuthDeps> = {}): RedisAuthDeps => ({
  sessionMachine: 'localhost',
  getLocalIP: () => '10.45.12.100',
  getPublicIP: () => '198.51.100.42',
  resolveNat: (ip, port) => ({ ip, port }),
  logFs: makeLogFs(),
  ...overrides,
});

describe('createRedisConnectHandler', () => {
  it('writes a connect line to /var/log/redis.log on the target', () => {
    const logFs = makeLogFs();
    const handler = createRedisConnectHandler(makeDeps({ logFs }));

    handler('10.0.1.20', 6379);

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '10.0.1.20', path: '/var/log/redis.log' }),
    );
    const call = logFs.createFileOnMachine.mock.calls[0]?.[0] as { readonly content: string };
    expect(call.content).toContain('Client connected from');
  });

  it('lands on the backend when port 6379 is NAT-forwarded', () => {
    const logFs = makeLogFs();
    const handler = createRedisConnectHandler(
      makeDeps({
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 6379 ? { ip: '10.0.1.20', port: 6379 } : { ip, port },
        logFs,
      }),
    );

    handler('203.0.113.5', 6379);

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '10.0.1.20' }),
    );
  });
});

describe('createRedisAuthHandler', () => {
  it('writes an authenticated line on success', () => {
    const logFs = makeLogFs();
    const handler = createRedisAuthHandler(makeDeps({ logFs }));

    handler(true, '10.0.1.20', 6379);

    const call = logFs.createFileOnMachine.mock.calls[0]?.[0] as { readonly content: string };
    expect(call.content).toContain('authenticated successfully');
  });

  it('writes an authentication-failed line on rejection', () => {
    const logFs = makeLogFs();
    const handler = createRedisAuthHandler(makeDeps({ logFs }));

    handler(false, '10.0.1.20', 6379);

    const call = logFs.createFileOnMachine.mock.calls[0]?.[0] as { readonly content: string };
    expect(call.content).toContain('authentication failed');
  });

  it('lands on the backend when port 6379 is NAT-forwarded', () => {
    const logFs = makeLogFs();
    const handler = createRedisAuthHandler(
      makeDeps({
        resolveNat: (ip, port) =>
          ip === '203.0.113.5' && port === 6379 ? { ip: '10.0.1.20', port: 6379 } : { ip, port },
        logFs,
      }),
    );

    handler(false, '203.0.113.5', 6379);

    expect(logFs.createFileOnMachine).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: '10.0.1.20' }),
    );
  });
});
