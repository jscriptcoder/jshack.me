import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import { createRediscliCommand } from './rediscli';

const getMockDbMachine = (): RemoteMachine => ({
  ip: '10.0.1.20',
  hostname: 'db-primary',
  ports: [
    { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
    { port: 3306, service: 'mysql', serviceVersion: 'latest', open: true },
    { port: 6379, service: 'redis', serviceVersion: 'latest', open: true },
  ],
  users: [{ username: 'redis', passwordHash: 'abc123', userType: 'user' }],
});

const getMockWebMachine = (): RemoteMachine => ({
  ip: '10.0.1.50',
  hostname: 'web01',
  ports: [
    { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
    { port: 80, service: 'http', serviceVersion: 'latest', open: true },
  ],
  users: [],
});

const createMockContext = (machines: readonly RemoteMachine[] = [getMockDbMachine()]) => ({
  getMachine: (ip: string) => machines.find((m) => m.ip === ip),
  findMachineByIp: (ip: string) => machines.find((m) => m.ip === ip),
  getLocalIP: () => '192.168.1.100',
  resolveDomain: () => undefined,
});

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

const collectAsync = (result: AsyncOutput) => {
  const lines: string[] = [];
  let followUp: unknown = undefined;
  result.start(
    (line) => lines.push(line),
    (fu) => {
      followUp = fu;
    },
  );
  vi.advanceTimersByTime(5000);
  return { lines, followUp };
};

describe('rediscli command', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('connects to a machine with open Redis port', () => {
    const ctx = createMockContext();
    const cmd = createRediscliCommand(ctx);
    const result = cmd.fn('10.0.1.20');
    expect(isAsyncOutput(result)).toBe(true);

    const { lines, followUp } = collectAsync(result as AsyncOutput);
    expect(lines.some((l) => l.includes('Connecting'))).toBe(true);
    expect(followUp).toBeDefined();
    expect((followUp as { __type: string }).__type).toBe('redis_prompt');
  });

  it('passes password through to prompt data', () => {
    const ctx = createMockContext();
    const cmd = createRediscliCommand(ctx);
    const result = cmd.fn('10.0.1.20', 'mypassword');
    const { followUp } = collectAsync(result as AsyncOutput);
    expect((followUp as { password?: string }).password).toBe('mypassword');
  });

  it('throws when no arguments provided', () => {
    const ctx = createMockContext();
    const cmd = createRediscliCommand(ctx);
    expect(() => cmd.fn()).toThrow();
  });

  it('throws when machine does not exist', () => {
    const ctx = createMockContext();
    const cmd = createRediscliCommand(ctx);
    expect(() => cmd.fn('10.99.99.99')).toThrow('Connection refused');
  });

  it('throws when Redis port is not open', () => {
    const ctx = createMockContext([getMockWebMachine()]);
    const cmd = createRediscliCommand(ctx);
    expect(() => cmd.fn('10.0.1.50')).toThrow('Connection refused');
  });
});
