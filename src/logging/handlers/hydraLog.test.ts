import { describe, expect, it, vi } from 'vitest';

import type { HydraBruteForceInfo } from '../../commands/hydra';
import { createHydraLogHandler, type HydraLogDeps } from './hydraLog';

const makeLogFs = () => ({
  readFileFromMachine: vi.fn().mockReturnValue(null),
  writeFileToMachine: vi.fn().mockReturnValue({ allowed: true }),
  createFileOnMachine: vi.fn().mockReturnValue({ allowed: true }),
});

const makeDeps = (overrides: Partial<HydraLogDeps> = {}): HydraLogDeps => ({
  sessionMachine: 'localhost',
  ownWorkstationId: 'localhost',
  getLocalIP: () => '10.45.12.100',
  getPublicIP: () => '198.51.100.42',
  resolveNat: (ip, port) => ({ ip, port }),
  getMachine: (ip) => ({ hostname: ip === '10.0.1.20' ? 'backend' : 'host' }),
  readFileFromMachine: vi.fn().mockReturnValue(null),
  logFs: makeLogFs(),
  ...overrides,
});

// Helper: read back what the handler wrote to a given log file path.
// The handler now composes all lines per (machineId, path) and calls
// appendToMachineLog once, so each path produces a single fs op (create
// when the file is new, write when it already exists). Multiple lines for
// the same path land inside that op's `content` joined with `\n`.
const writesTo = (
  logFs: ReturnType<typeof makeLogFs>,
  path: string,
): readonly { readonly machineId: string; readonly content: string }[] =>
  [...logFs.createFileOnMachine.mock.calls, ...logFs.writeFileToMachine.mock.calls]
    .map(
      (c) =>
        c[0] as { readonly machineId: string; readonly path: string; readonly content: string },
    )
    .filter((op) => op.path === path);

const bruteForceInfo = (overrides: Partial<HydraBruteForceInfo> = {}): HydraBruteForceInfo => ({
  targetIp: '192.168.1.50',
  port: 22,
  service: 'ssh',
  attempts: 384,
  successes: [],
  ...overrides,
});

describe('createHydraLogHandler', () => {
  describe('ssh', () => {
    it('writes aggregate line to /var/log/auth.log with attempt and success counts', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(
        bruteForceInfo({
          service: 'ssh',
          port: 22,
          attempts: 384,
          successes: [{ username: 'guest', password: 'guest' }],
        }),
      );

      const writes = writesTo(logFs, '/var/log/auth.log');
      expect(writes).toHaveLength(1); // aggregate + per-success composed in one append
      expect(writes[0]!.content).toMatch(
        /Brute-force attempt.*384 authentication failures, 1 accepted/,
      );
      expect(writes[0]!.content).toMatch(/Accepted password for guest/);
    });

    it('writes one Accepted password line per cracked user', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(
        bruteForceInfo({
          service: 'ssh',
          successes: [
            { username: 'alice', password: 'pw1' },
            { username: 'bob', password: 'pw2' },
          ],
        }),
      );

      const writes = writesTo(logFs, '/var/log/auth.log');
      const content = writes.map((w) => w.content).join('\n');
      expect(content).toMatch(/Accepted password for alice/);
      expect(content).toMatch(/Accepted password for bob/);
    });

    it('writes only the aggregate line when no user cracked', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(bruteForceInfo({ service: 'ssh', successes: [] }));

      const writes = writesTo(logFs, '/var/log/auth.log');
      expect(writes).toHaveLength(1);
      expect(writes[0]!.content).toMatch(/Brute-force attempt.*0 accepted/);
    });
  });

  describe('ftp', () => {
    it('writes aggregate line to /var/log/vsftpd.log', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(
        bruteForceInfo({
          service: 'ftp',
          port: 21,
          attempts: 256,
          successes: [{ username: 'ftpuser', password: 'admin' }],
        }),
      );

      const writes = writesTo(logFs, '/var/log/vsftpd.log');
      expect(writes).toHaveLength(1);
      expect(writes[0]!.content).toMatch(/BRUTE FORCE.*256 login attempts, 1 successful/);
      expect(writes[0]!.content).toMatch(/OK LOGIN.*user "ftpuser"/);
    });

    it('writes one OK LOGIN line per cracked user', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(
        bruteForceInfo({
          service: 'ftp',
          port: 21,
          successes: [
            { username: 'u1', password: 'p1' },
            { username: 'u2', password: 'p2' },
          ],
        }),
      );

      const writes = writesTo(logFs, '/var/log/vsftpd.log');
      const content = writes.map((w) => w.content).join('\n');
      expect(content).toMatch(/OK LOGIN.*user "u1"/);
      expect(content).toMatch(/OK LOGIN.*user "u2"/);
    });
  });

  describe('mysql', () => {
    it('writes aggregate line to /var/log/mysql.log', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(
        bruteForceInfo({
          service: 'mysql',
          port: 3306,
          attempts: 128,
          successes: [{ username: 'webapp', password: 'password' }],
        }),
      );

      const writes = writesTo(logFs, '/var/log/mysql.log');
      expect(writes).toHaveLength(1);
      expect(writes[0]!.content).toMatch(/Brute-force attempt.*128 attempts, 1 accepted/);
      expect(writes[0]!.content).toMatch(/Connect.*webapp@/);
    });

    it('looks up database name from the backend data.json for the Connect line', () => {
      const logFs = makeLogFs();
      const readFileFromMachine = vi
        .fn()
        .mockReturnValue(JSON.stringify({ name: 'webapp_db', credentials: [], tables: {} }));
      const handler = createHydraLogHandler(makeDeps({ logFs, readFileFromMachine }));

      handler(
        bruteForceInfo({
          service: 'mysql',
          port: 3306,
          successes: [{ username: 'webapp', password: 'password' }],
        }),
      );

      const writes = writesTo(logFs, '/var/log/mysql.log');
      const content = writes.map((w) => w.content).join('\n');
      expect(content).toMatch(/webapp@.*on webapp_db/);
    });
  });

  describe('redis', () => {
    it('writes aggregate line to /var/log/redis.log', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(
        bruteForceInfo({
          service: 'redis',
          port: 6379,
          attempts: 60,
          successes: [{ password: 'admin' }],
        }),
      );

      const writes = writesTo(logFs, '/var/log/redis.log');
      expect(writes).toHaveLength(1);
      expect(writes[0]!.content).toMatch(
        /brute-force attempt.*60 password attempts, 1 authenticated/,
      );
      expect(writes[0]!.content).toMatch(/authenticated successfully/);
    });

    it('writes an authenticated successfully line on crack', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(
        bruteForceInfo({
          service: 'redis',
          port: 6379,
          successes: [{ password: 'admin' }],
        }),
      );

      const writes = writesTo(logFs, '/var/log/redis.log');
      const content = writes.map((w) => w.content).join('\n');
      expect(content).toMatch(/authenticated successfully/);
    });

    it('writes only the aggregate (no success line) when requirepass is not cracked', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(
        bruteForceInfo({
          service: 'redis',
          port: 6379,
          successes: [],
        }),
      );

      const writes = writesTo(logFs, '/var/log/redis.log');
      expect(writes).toHaveLength(1);
      expect(writes[0]!.content).toMatch(/0 authenticated/);
    });
  });

  describe('snmp', () => {
    it('writes aggregate line to /var/log/syslog', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(
        bruteForceInfo({
          service: 'snmp',
          port: 161,
          attempts: 12,
          successes: [{ community: 'private' }],
        }),
      );

      const writes = writesTo(logFs, '/var/log/syslog');
      expect(writes).toHaveLength(1);
      expect(writes[0]!.content).toMatch(
        /Brute-force community string attempt.*12 probed, 1 found/,
      );
      expect(writes[0]!.content).toMatch(/Community string "private" accessed/);
    });

    it('writes a Community string accessed line per discovered community', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(
        bruteForceInfo({
          service: 'snmp',
          port: 161,
          successes: [{ community: 'private' }],
        }),
      );

      const writes = writesTo(logFs, '/var/log/syslog');
      const content = writes.map((w) => w.content).join('\n');
      expect(content).toMatch(/Community string "private" accessed/);
    });
  });

  describe('NAT-aware routing', () => {
    it('writes to the backend machine when the service port is NAT-forwarded', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(
        makeDeps({
          resolveNat: (ip, port) =>
            ip === '203.0.113.5' && port === 2222 ? { ip: '10.0.1.20', port: 22 } : { ip, port },
          getMachine: (ip) =>
            ip === '10.0.1.20' ? { hostname: 'backend' } : { hostname: 'router' },
          logFs,
        }),
      );

      handler(
        bruteForceInfo({
          service: 'ssh',
          targetIp: '203.0.113.5',
          port: 2222,
          successes: [{ username: 'admin', password: 'pw' }],
        }),
      );

      const writes = writesTo(logFs, '/var/log/auth.log');
      writes.forEach((w) => expect(w.machineId).toBe('10.0.1.20'));
    });
  });

  describe('atomic burst', () => {
    // Regression: hydra previously emitted aggregate + per-success lines as
    // two separate appendToMachineLog calls in one React tick. Both reads
    // observed the same pre-batch state and both writes upserted the same
    // (player_key, machine_id, path) row, so the second call clobbered the
    // first. Now hydra composes all lines and appends once. This pins that
    // contract: one fs op per (machineId, path), regardless of how many
    // success lines fire.
    it('emits a single fs op per log path even with many cracked credentials', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(makeDeps({ logFs }));

      handler(
        bruteForceInfo({
          service: 'ssh',
          successes: [
            { username: 'alice', password: 'a' },
            { username: 'bob', password: 'b' },
            { username: 'carol', password: 'c' },
            { username: 'dave', password: 'd' },
          ],
        }),
      );

      const totalCalls =
        logFs.createFileOnMachine.mock.calls.length + logFs.writeFileToMachine.mock.calls.length;
      expect(totalCalls).toBe(1);

      const writes = writesTo(logFs, '/var/log/auth.log');
      expect(writes).toHaveLength(1);
      const content = writes[0]!.content;
      expect(content).toMatch(/Brute-force attempt/);
      expect(content).toMatch(/Accepted password for alice/);
      expect(content).toMatch(/Accepted password for bob/);
      expect(content).toMatch(/Accepted password for carol/);
      expect(content).toMatch(/Accepted password for dave/);
    });
  });

  describe('source IP resolution', () => {
    it('embeds the router public IP when attacking a cross-network target from localhost', () => {
      const logFs = makeLogFs();
      const handler = createHydraLogHandler(
        makeDeps({
          sessionMachine: 'localhost',
          ownWorkstationId: 'localhost',
          getLocalIP: () => '192.168.0.10', // home LAN
          getPublicIP: () => '203.0.113.99', // router WAN
          logFs,
        }),
      );

      handler(
        bruteForceInfo({
          service: 'ssh',
          targetIp: '10.99.99.5', // different network — NAT'd
          port: 22,
          successes: [{ username: 'admin', password: 'pw' }],
        }),
      );

      const writes = writesTo(logFs, '/var/log/auth.log');
      const content = writes.map((w) => w.content).join('\n');
      expect(content).toContain('203.0.113.99');
      expect(content).not.toContain('192.168.0.10');
    });
  });
});
