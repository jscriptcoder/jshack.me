import { describe, it, expect, vi } from 'vitest';
import { startNcat, type NcatAdapter } from './ncat';

const createAdapter = (overrides: Partial<NcatAdapter> = {}): NcatAdapter => ({
  isPortOpen: overrides.isPortOpen ?? (() => false),
  pidFileExists: overrides.pidFileExists ?? (() => false),
  writePidFile: overrides.writePidFile ?? vi.fn(),
  username: overrides.username ?? 'webadmin',
  userType: overrides.userType ?? 'user',
});

describe('startNcat', () => {
  it('starts listener on valid high port for non-root user', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile });

    const result = startNcat(adapter, [4444]);

    expect(result).toContain('listening on port 4444');
    expect(writePidFile).toHaveBeenCalledWith(
      4444,
      'ncat:port=4444,user=webadmin,userType=user,home=/home/webadmin',
    );
  });

  it('starts listener on privileged port for root', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile, username: 'root', userType: 'root' });

    const result = startNcat(adapter, [443]);

    expect(result).toContain('listening on port 443');
    expect(writePidFile).toHaveBeenCalledWith(
      443,
      'ncat:port=443,user=root,userType=root,home=/root',
    );
  });

  it('rejects privileged port for non-root user', () => {
    const adapter = createAdapter({ userType: 'user' });

    expect(() => startNcat(adapter, [80])).toThrow('permission denied');
  });

  it('rejects privileged port for guest user', () => {
    const adapter = createAdapter({ username: 'ftpuser', userType: 'guest' });

    expect(() => startNcat(adapter, [443])).toThrow('permission denied');
  });

  it('allows high port for guest user', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({
      writePidFile,
      username: 'ftpuser',
      userType: 'guest',
    });

    const result = startNcat(adapter, [8888]);

    expect(result).toContain('listening on port 8888');
    expect(writePidFile).toHaveBeenCalled();
  });

  it('rejects port already open on machine', () => {
    const adapter = createAdapter({ isPortOpen: (port) => port === 4444 });

    expect(() => startNcat(adapter, [4444])).toThrow('already in use');
  });

  it('rejects port with existing pid file', () => {
    const adapter = createAdapter({ pidFileExists: (port) => port === 4444 });

    expect(() => startNcat(adapter, [4444])).toThrow('already listening');
  });

  it('rejects missing port argument', () => {
    const adapter = createAdapter();

    expect(() => startNcat(adapter, [])).toThrow('usage');
  });

  it('rejects non-numeric port', () => {
    const adapter = createAdapter();

    expect(() => startNcat(adapter, ['abc'])).toThrow('invalid port');
  });

  it('rejects port out of range', () => {
    const adapter = createAdapter({ userType: 'root' });

    expect(() => startNcat(adapter, [0])).toThrow('invalid port');
    expect(() => startNcat(adapter, [70000])).toThrow('invalid port');
  });
});
