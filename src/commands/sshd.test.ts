import { describe, it, expect, vi } from 'vitest';
import { startSshd, type SshdAdapter } from './sshd';

const createAdapter = (overrides: Partial<SshdAdapter> = {}): SshdAdapter => ({
  isPortOpen: overrides.isPortOpen ?? (() => false),
  pidFileExists: overrides.pidFileExists ?? (() => false),
  writePidFile: overrides.writePidFile ?? vi.fn(),
});

describe('startSshd', () => {
  it('returns already-running message when SSH port is open', () => {
    const adapter = createAdapter({ isPortOpen: () => true });
    const result = startSshd(adapter, []);
    expect(result).toContain('already running');
  });

  it('returns already-running message when pid file exists', () => {
    const adapter = createAdapter({ pidFileExists: () => true });
    const result = startSshd(adapter, []);
    expect(result).toContain('already running');
  });

  it('starts sshd on default port 22 when no args given', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile });
    const result = startSshd(adapter, []);
    expect(writePidFile).toHaveBeenCalledWith('sshd:port=22');
    expect(result).toContain('port 22');
  });

  it('starts sshd on custom port when port number given', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile });
    const result = startSshd(adapter, [2222]);
    expect(writePidFile).toHaveBeenCalledWith('sshd:port=2222');
    expect(result).toContain('port 2222');
  });

  it('throws on invalid port number', () => {
    const adapter = createAdapter();
    expect(() => startSshd(adapter, [0])).toThrow();
    expect(() => startSshd(adapter, [70000])).toThrow();
    expect(() => startSshd(adapter, ['abc'])).toThrow();
  });

  it('checks the requested port for already-running status', () => {
    const isPortOpen = vi.fn((port: number) => port === 2222);
    const adapter = createAdapter({ isPortOpen });
    const result = startSshd(adapter, [2222]);
    expect(isPortOpen).toHaveBeenCalledWith(2222);
    expect(result).toContain('already running');
  });
});
