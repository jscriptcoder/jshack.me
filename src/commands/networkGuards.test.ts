import { describe, it, expect, vi } from 'vitest';
import type { Command } from '../components/Terminal/types';
import { isAsyncOutput } from '../components/Terminal/types';
import { wrapWithWifiCheck, wrapWithBrickedCheck } from './networkGuards';

const createMockCommand = (name = 'test'): Command => ({
  name,
  description: 'test command',
  fn: vi.fn((...args: readonly unknown[]) => `executed with ${args.join(', ')}`),
});

describe('wrapWithWifiCheck', () => {
  it('throws when WiFi is required', () => {
    const cmd = createMockCommand();
    const wrapped = wrapWithWifiCheck(cmd, () => true);

    expect(() => wrapped.fn('192.168.1.50')).toThrow(
      'Network is unreachable — wlan0 is not connected',
    );
    expect(cmd.fn).not.toHaveBeenCalled();
  });

  it('delegates to the wrapped command when WiFi is connected', () => {
    const cmd = createMockCommand();
    const wrapped = wrapWithWifiCheck(cmd, () => false);

    const result = wrapped.fn('192.168.1.50');

    expect(result).toBe('executed with 192.168.1.50');
    expect(cmd.fn).toHaveBeenCalledWith('192.168.1.50');
  });

  it('preserves command metadata', () => {
    const cmd: Command = {
      name: 'ping',
      description: 'send ICMP echo',
      manual: { synopsis: 'ping(host)', description: 'ping a host' },
      fn: vi.fn(),
    };
    const wrapped = wrapWithWifiCheck(cmd, () => false);

    expect(wrapped.name).toBe('ping');
    expect(wrapped.description).toBe('send ICMP echo');
    expect(wrapped.manual).toEqual(cmd.manual);
  });

  it('evaluates the predicate at execution time, not wrap time', () => {
    let connected = false;
    const cmd = createMockCommand();
    const wrapped = wrapWithWifiCheck(cmd, () => !connected);

    expect(() => wrapped.fn('host')).toThrow('Network is unreachable');

    connected = true;
    expect(wrapped.fn('host')).toBe('executed with host');
  });
});

describe('wrapWithBrickedCheck', () => {
  it('returns async output with timeout when target is bricked', () => {
    const cmd = createMockCommand();
    const wrapped = wrapWithBrickedCheck(cmd, (m) => m === '192.168.1.50');

    const result = wrapped.fn('192.168.1.50');

    expect(isAsyncOutput(result)).toBe(true);
    expect(cmd.fn).not.toHaveBeenCalled();
  });

  it('shows connecting message immediately, then timeout after delay', () => {
    vi.useFakeTimers();
    const cmd = createMockCommand();
    const wrapped = wrapWithBrickedCheck(cmd, () => true);

    const result = wrapped.fn('10.0.0.5');
    if (!isAsyncOutput(result)) throw new Error('expected async output');

    const lines: string[] = [];
    const onComplete = vi.fn();
    result.start((line) => lines.push(line), onComplete);

    expect(lines).toEqual(['Connecting to 10.0.0.5...']);
    expect(onComplete).not.toHaveBeenCalled();

    // Advance past max jitter range (3000ms base + 25% = 3750ms)
    vi.advanceTimersByTime(4000);

    expect(lines).toEqual([
      'Connecting to 10.0.0.5...',
      'connect: Connection timed out — host 10.0.0.5 appears to be down',
    ]);
    expect(onComplete).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it('supports cancellation before timeout fires', () => {
    vi.useFakeTimers();
    const cmd = createMockCommand();
    const wrapped = wrapWithBrickedCheck(cmd, () => true);

    const result = wrapped.fn('10.0.0.5');
    if (!isAsyncOutput(result)) throw new Error('expected async output');

    const lines: string[] = [];
    const onComplete = vi.fn();
    result.start((line) => lines.push(line), onComplete);
    result.cancel?.();

    vi.advanceTimersByTime(5000);

    expect(lines).toEqual(['Connecting to 10.0.0.5...']);
    expect(onComplete).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('delegates to the wrapped command when target is not bricked', () => {
    const cmd = createMockCommand();
    const wrapped = wrapWithBrickedCheck(cmd, () => false);

    const result = wrapped.fn('192.168.1.50');

    expect(result).toBe('executed with 192.168.1.50');
    expect(cmd.fn).toHaveBeenCalledWith('192.168.1.50');
  });

  it('delegates when no string argument is present', () => {
    const cmd = createMockCommand();
    const wrapped = wrapWithBrickedCheck(cmd, () => true);

    const result = wrapped.fn(42);

    expect(result).toBe('executed with 42');
  });

  it('preserves command metadata', () => {
    const cmd: Command = {
      name: 'ssh',
      description: 'secure shell',
      manual: { synopsis: 'ssh("user@host")', description: 'connect via SSH' },
      fn: vi.fn(),
    };
    const wrapped = wrapWithBrickedCheck(cmd, () => false);

    expect(wrapped.name).toBe('ssh');
    expect(wrapped.description).toBe('secure shell');
    expect(wrapped.manual).toEqual(cmd.manual);
  });
});
