import { describe, it, expect, vi } from 'vitest';
import { createMysqlCommand } from './mysql';
import type { RemoteMachine } from '../network/types';

const makeMachine = (ip: string, hasMysql = true): RemoteMachine => ({
  ip,
  hostname: 'db-server',
  ports: [
    { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
    ...(hasMysql
      ? [{ port: 3306, service: 'mysql' as const, serviceVersion: 'latest', open: true }]
      : []),
  ],
  users: [{ username: 'root', userType: 'root' as const }],
});

const makeContext = (overrides: Partial<Parameters<typeof createMysqlCommand>[0]> = {}) => ({
  getMachine: vi.fn((_ip: string) => undefined as RemoteMachine | undefined),
  findMachineByIp: vi.fn((_ip: string) => undefined as RemoteMachine | undefined),
  getLocalIP: vi.fn(() => '10.0.0.5'),
  resolveDomain: vi.fn(
    (_domain: string) => undefined as { domain: string; ip: string; type: 'A' } | undefined,
  ),
  ...overrides,
});

describe('mysql command', () => {
  it('throws when missing arguments', () => {
    const cmd = createMysqlCommand(makeContext());
    expect(() => cmd.fn()).toThrow('missing arguments');
    expect(() => cmd.fn('10.0.0.5')).toThrow('missing arguments');
  });

  it('connects to a remote machine with mysql port', () => {
    const machine = makeMachine('10.0.0.10');
    const ctx = makeContext({ getMachine: vi.fn(() => machine) });
    const cmd = createMysqlCommand(ctx);
    const result = cmd.fn('10.0.0.10', 'root');
    expect(result).toHaveProperty('__type', 'async');
  });

  it('refuses when no mysql port is open', () => {
    const machine = makeMachine('10.0.0.10', false);
    const ctx = makeContext({ getMachine: vi.fn(() => machine) });
    const cmd = createMysqlCommand(ctx);
    expect(() => cmd.fn('10.0.0.10', 'root')).toThrow('Connection refused');
  });

  it('refuses when machine not found', () => {
    const cmd = createMysqlCommand(makeContext());
    expect(() => cmd.fn('10.0.0.99', 'root')).toThrow('Connection refused');
  });

  describe('localhost resolution', () => {
    it('resolves 127.0.0.1 to local IP', () => {
      const machine = makeMachine('10.0.0.5');
      const getMachine = vi.fn(() => machine);
      const ctx = makeContext({ getMachine, getLocalIP: vi.fn(() => '10.0.0.5') });
      const cmd = createMysqlCommand(ctx);
      cmd.fn('127.0.0.1', 'root');
      expect(getMachine).toHaveBeenCalledWith('10.0.0.5');
    });

    it('resolves localhost to local IP', () => {
      const machine = makeMachine('10.0.0.5');
      const getMachine = vi.fn(() => machine);
      const ctx = makeContext({ getMachine, getLocalIP: vi.fn(() => '10.0.0.5') });
      const cmd = createMysqlCommand(ctx);
      cmd.fn('localhost', 'root');
      expect(getMachine).toHaveBeenCalledWith('10.0.0.5');
    });
  });

  describe('findMachineByIp fallback', () => {
    it('falls back to findMachineByIp when getMachine returns undefined', () => {
      const machine = makeMachine('10.0.0.5');
      const ctx = makeContext({
        getMachine: vi.fn(() => undefined),
        findMachineByIp: vi.fn(() => machine),
      });
      const cmd = createMysqlCommand(ctx);
      const result = cmd.fn('10.0.0.5', 'root');
      expect(result).toHaveProperty('__type', 'async');
      expect(ctx.findMachineByIp).toHaveBeenCalledWith('10.0.0.5');
    });

    it('self-connection works via 127.0.0.1 with fallback', () => {
      const machine = makeMachine('10.0.0.5');
      const ctx = makeContext({
        getMachine: vi.fn(() => undefined),
        findMachineByIp: vi.fn(() => machine),
        getLocalIP: vi.fn(() => '10.0.0.5'),
      });
      const cmd = createMysqlCommand(ctx);
      const result = cmd.fn('127.0.0.1', 'root');
      expect(result).toHaveProperty('__type', 'async');
    });
  });

  describe('domain resolution', () => {
    it('resolves domain names via resolveDomain', () => {
      const machine = makeMachine('10.0.0.10');
      const ctx = makeContext({
        getMachine: vi.fn(() => machine),
        resolveDomain: vi.fn(() => ({ domain: 'db.local', ip: '10.0.0.10', type: 'A' as const })),
      });
      const cmd = createMysqlCommand(ctx);
      const result = cmd.fn('db.local', 'root');
      expect(result).toHaveProperty('__type', 'async');
    });

    it('throws for unknown domain', () => {
      const cmd = createMysqlCommand(makeContext());
      expect(() => cmd.fn('unknown.host', 'root')).toThrow('Unknown MySQL server host');
    });
  });

  describe('cross-LAN async pre-resolve', () => {
    // Mirrors ssh.ts's findMachineByIpAsync fallback. When the player
    // types `mysql <foreign public IP> <user>` against another player's
    // workstation via NAT-forward, the command awaits findMachineByIpAsync
    // to materialize the foreign network before validating port 3306.
    // (Workstation mysqld not yet shipped; wiring is symmetric per
    // project_workstation_daemon_expansion so it "just works" when it does.)

    it('falls back to findMachineByIpAsync when sync getMachine misses', async () => {
      vi.useFakeTimers();
      const foreignMachine = makeMachine('203.0.113.42');
      const findMachineByIpAsync = vi.fn(async (ip: string) =>
        ip === '203.0.113.42' ? foreignMachine : undefined,
      );
      const ctx = makeContext({ findMachineByIpAsync });
      const cmd = createMysqlCommand(ctx);

      const result = cmd.fn('203.0.113.42', 'root');
      let followUp: unknown = null;
      if (typeof result === 'object' && result !== null && '__type' in result) {
        (result as unknown as { start: (...a: unknown[]) => void }).start(
          () => {},
          (data: unknown) => {
            followUp = data;
          },
        );
      }

      await vi.runAllTimersAsync();

      expect(findMachineByIpAsync).toHaveBeenCalledWith('203.0.113.42');
      expect(followUp).toMatchObject({ __type: 'mysql_prompt', targetIP: '203.0.113.42' });
      vi.useRealTimers();
    });

    it('emits Connection refused via onLine when async resolver returns undefined', async () => {
      vi.useFakeTimers();
      const findMachineByIpAsync = vi.fn(async () => undefined);
      const ctx = makeContext({ findMachineByIpAsync });
      const cmd = createMysqlCommand(ctx);

      const result = cmd.fn('203.0.113.99', 'root');
      const lines: string[] = [];
      let completed = false;
      if (typeof result === 'object' && result !== null && '__type' in result) {
        (result as unknown as { start: (...a: unknown[]) => void }).start(
          (line: string) => lines.push(line),
          () => {
            completed = true;
          },
        );
      }

      await vi.runAllTimersAsync();

      expect(findMachineByIpAsync).toHaveBeenCalledWith('203.0.113.99');
      expect(lines.some((l) => l.includes('Connection refused'))).toBe(true);
      expect(completed).toBe(true);
      vi.useRealTimers();
    });

    it('does NOT call findMachineByIpAsync when sync getMachine hits', () => {
      const machine = makeMachine('192.168.1.50');
      const findMachineByIpAsync = vi.fn(async () => undefined);
      const ctx = makeContext({ getMachine: vi.fn(() => machine), findMachineByIpAsync });
      const cmd = createMysqlCommand(ctx);

      cmd.fn('192.168.1.50', 'root');

      expect(findMachineByIpAsync).not.toHaveBeenCalled();
    });

    it('throws synchronously on sync miss when findMachineByIpAsync is omitted (legacy)', () => {
      const cmd = createMysqlCommand(makeContext());
      expect(() => cmd.fn('10.0.0.1', 'root')).toThrow('Connection refused');
    });
  });
});
