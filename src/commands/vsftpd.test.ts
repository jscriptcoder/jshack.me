import { describe, it, expect, vi } from 'vitest';
import { startVsftpd, type VsftpdAdapter } from './vsftpd';

const createAdapter = (overrides: Partial<VsftpdAdapter> = {}): VsftpdAdapter => ({
  isPortOpen: overrides.isPortOpen ?? (() => false),
  readPidFile: overrides.readPidFile ?? (() => undefined),
  writePidFile: overrides.writePidFile ?? vi.fn(),
});

describe('startVsftpd', () => {
  it('returns already-running message when FTP port is open', () => {
    const adapter = createAdapter({ isPortOpen: () => true });
    const result = startVsftpd(adapter, []);
    expect(result).toContain('already running');
  });

  it('returns already-running message when pid file exists', () => {
    const adapter = createAdapter({ readPidFile: () => 'vsftpd:port=21' });
    const result = startVsftpd(adapter, []);
    expect(result).toContain('already running');
  });

  it('shows actual running port from pid file, not requested port', () => {
    const adapter = createAdapter({ readPidFile: () => 'vsftpd:port=21' });
    const result = startVsftpd(adapter, [2121]);
    expect(result).toContain('port 21');
    expect(result).not.toContain('port 2121');
  });

  it('starts vsftpd on default port 21 when no args given', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile });
    const result = startVsftpd(adapter, []);
    expect(writePidFile).toHaveBeenCalledWith('vsftpd:port=21');
    expect(result).toContain('port 21');
  });

  it('starts vsftpd on custom port when port number given', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile });
    const result = startVsftpd(adapter, [2121]);
    expect(writePidFile).toHaveBeenCalledWith('vsftpd:port=2121');
    expect(result).toContain('port 2121');
  });

  it('throws on invalid port number', () => {
    const adapter = createAdapter();
    expect(() => startVsftpd(adapter, [0])).toThrow();
    expect(() => startVsftpd(adapter, [70000])).toThrow();
    expect(() => startVsftpd(adapter, ['abc'])).toThrow();
  });

  it('checks the requested port for already-running status', () => {
    const isPortOpen = vi.fn((port: number) => port === 2121);
    const adapter = createAdapter({ isPortOpen });
    const result = startVsftpd(adapter, [2121]);
    expect(isPortOpen).toHaveBeenCalledWith(2121);
    expect(result).toContain('already running');
  });
});
