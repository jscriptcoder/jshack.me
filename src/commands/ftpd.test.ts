import { describe, it, expect, vi } from 'vitest';
import { startFtpd, type FtpdAdapter } from './ftpd';

const createAdapter = (overrides: Partial<FtpdAdapter> = {}): FtpdAdapter => ({
  isPortOpen: overrides.isPortOpen ?? (() => false),
  readPidFile: overrides.readPidFile ?? (() => undefined),
  writePidFile: overrides.writePidFile ?? vi.fn(),
});

describe('startFtpd', () => {
  it('returns already-running message when FTP port is open', () => {
    const adapter = createAdapter({ isPortOpen: () => true });
    const result = startFtpd(adapter, []);
    expect(result).toContain('already running');
  });

  it('returns already-running message when pid file exists', () => {
    const adapter = createAdapter({ readPidFile: () => 'ftpd:port=21' });
    const result = startFtpd(adapter, []);
    expect(result).toContain('already running');
  });

  it('shows actual running port from pid file, not requested port', () => {
    const adapter = createAdapter({ readPidFile: () => 'ftpd:port=21' });
    const result = startFtpd(adapter, [2121]);
    expect(result).toContain('port 21');
    expect(result).not.toContain('port 2121');
  });

  it('starts ftpd on default port 21 when no args given', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile });
    const result = startFtpd(adapter, []);
    expect(writePidFile).toHaveBeenCalledWith('ftpd:port=21');
    expect(result).toContain('port 21');
  });

  it('starts ftpd on custom port when port number given', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile });
    const result = startFtpd(adapter, [2121]);
    expect(writePidFile).toHaveBeenCalledWith('ftpd:port=2121');
    expect(result).toContain('port 2121');
  });

  it('throws on invalid port number', () => {
    const adapter = createAdapter();
    expect(() => startFtpd(adapter, [0])).toThrow();
    expect(() => startFtpd(adapter, [70000])).toThrow();
    expect(() => startFtpd(adapter, ['abc'])).toThrow();
  });

  it('checks the requested port for already-running status', () => {
    const isPortOpen = vi.fn((port: number) => port === 2121);
    const adapter = createAdapter({ isPortOpen });
    const result = startFtpd(adapter, [2121]);
    expect(isPortOpen).toHaveBeenCalledWith(2121);
    expect(result).toContain('already running');
  });
});
