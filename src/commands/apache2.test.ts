import { describe, it, expect, vi } from 'vitest';
import { startApache2, APACHE2_STARTER_INDEX_HTML, type Apache2Adapter } from './apache2';
import type { UserType } from '../session/types';

const createAdapter = (overrides: Partial<Apache2Adapter> = {}): Apache2Adapter => ({
  isPortOpen: overrides.isPortOpen ?? (() => false),
  readPidFile: overrides.readPidFile ?? (() => undefined),
  writePidFile: overrides.writePidFile ?? vi.fn(),
  indexHtmlExists: overrides.indexHtmlExists ?? (() => false),
  writeIndexHtml: overrides.writeIndexHtml ?? vi.fn(),
  username: overrides.username ?? 'root',
  userType: (overrides.userType ?? 'root') as UserType,
});

describe('startApache2 — port parsing', () => {
  it('starts on default port 80 when no args given', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile });
    const result = startApache2(adapter, []);
    expect(writePidFile).toHaveBeenCalled();
    expect(result).toContain('port 80');
  });

  it('starts on custom port when numeric arg given (high port — no privilege check)', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile, userType: 'user', username: 'alice' });
    const result = startApache2(adapter, [8080]);
    expect(writePidFile).toHaveBeenCalled();
    expect(result).toContain('port 8080');
  });

  it('throws on invalid port number', () => {
    const adapter = createAdapter();
    expect(() => startApache2(adapter, [0])).toThrow();
    expect(() => startApache2(adapter, [70000])).toThrow();
    expect(() => startApache2(adapter, ['abc'])).toThrow();
  });
});

describe('startApache2 — privileged port (<1024) gating', () => {
  it('rejects port 80 for a non-root user', () => {
    const adapter = createAdapter({ userType: 'user', username: 'alice' });
    expect(() => startApache2(adapter, [80])).toThrow();
  });

  it('rejects port 443 for a non-root user', () => {
    const adapter = createAdapter({ userType: 'user', username: 'alice' });
    expect(() => startApache2(adapter, [443])).toThrow();
  });

  it('rejects port 1023 (boundary just below privileged threshold) for a non-root user', () => {
    const adapter = createAdapter({ userType: 'user', username: 'alice' });
    expect(() => startApache2(adapter, [1023])).toThrow();
  });

  it('accepts port 1024 (boundary at privileged threshold) for a non-root user', () => {
    const adapter = createAdapter({ userType: 'user', username: 'alice' });
    expect(() => startApache2(adapter, [1024])).not.toThrow();
  });

  it('accepts port 80 for root', () => {
    const adapter = createAdapter({ userType: 'root', username: 'root' });
    expect(() => startApache2(adapter, [80])).not.toThrow();
  });

  it('rejects port 80 for a guest user', () => {
    const adapter = createAdapter({ userType: 'guest', username: 'anon' });
    expect(() => startApache2(adapter, [80])).toThrow();
  });
});

describe('startApache2 — already-running state', () => {
  it('returns already-running message when apache2.pid exists', () => {
    const adapter = createAdapter({
      readPidFile: () => 'apache2:port=80,user=root,userType=root,home=/root',
    });
    const result = startApache2(adapter, []);
    expect(result).toContain('already running');
  });

  it('shows actual running port from pid file, not requested port', () => {
    const adapter = createAdapter({
      readPidFile: () => 'apache2:port=80,user=root,userType=root,home=/root',
    });
    const result = startApache2(adapter, [8080]);
    expect(result).toContain('port 80');
    expect(result).not.toContain('port 8080');
  });

  it('returns already-running message when target port is already open', () => {
    const adapter = createAdapter({ isPortOpen: () => true });
    const result = startApache2(adapter, []);
    expect(result).toContain('already running');
  });

  it('checks the requested port (not default) for already-open status', () => {
    const isPortOpen = vi.fn((port: number) => port === 8080);
    const adapter = createAdapter({
      isPortOpen,
      userType: 'user',
      username: 'alice',
    });
    const result = startApache2(adapter, [8080]);
    expect(isPortOpen).toHaveBeenCalledWith(8080);
    expect(result).toContain('already running');
  });

  it('does NOT write pid file when already running', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({
      writePidFile,
      readPidFile: () => 'apache2:port=80,user=root,userType=root,home=/root',
    });
    startApache2(adapter, []);
    expect(writePidFile).not.toHaveBeenCalled();
  });
});

describe('startApache2 — pid file extended-form content', () => {
  it('stamps root user when invoked as root on default port', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile, userType: 'root', username: 'root' });
    startApache2(adapter, []);
    expect(writePidFile).toHaveBeenCalledWith('apache2:port=80,user=root,userType=root,home=/root');
  });

  it('stamps invoking regular user (not www-data) on a high port', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({
      writePidFile,
      userType: 'user',
      username: 'alice',
    });
    startApache2(adapter, [8080]);
    expect(writePidFile).toHaveBeenCalledWith(
      'apache2:port=8080,user=alice,userType=user,home=/home/alice',
    );
  });

  it('stamps guest user on a high port', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({
      writePidFile,
      userType: 'guest',
      username: 'anon',
    });
    startApache2(adapter, [9000]);
    expect(writePidFile).toHaveBeenCalledWith(
      'apache2:port=9000,user=anon,userType=guest,home=/home/anon',
    );
  });
});

describe('startApache2 — starter index.html', () => {
  it('creates /var/www/html/index.html when it does NOT exist', () => {
    const writeIndexHtml = vi.fn();
    const adapter = createAdapter({
      writeIndexHtml,
      indexHtmlExists: () => false,
    });
    startApache2(adapter, []);
    expect(writeIndexHtml).toHaveBeenCalledWith(APACHE2_STARTER_INDEX_HTML);
  });

  it('does NOT overwrite an existing /var/www/html/index.html', () => {
    const writeIndexHtml = vi.fn();
    const adapter = createAdapter({
      writeIndexHtml,
      indexHtmlExists: () => true,
    });
    startApache2(adapter, []);
    expect(writeIndexHtml).not.toHaveBeenCalled();
  });

  it('does NOT create index.html when daemon is already running', () => {
    const writeIndexHtml = vi.fn();
    const adapter = createAdapter({
      writeIndexHtml,
      readPidFile: () => 'apache2:port=80,user=root,userType=root,home=/root',
    });
    startApache2(adapter, []);
    expect(writeIndexHtml).not.toHaveBeenCalled();
  });
});

describe('startApache2 — successful start output', () => {
  it('returns multi-line confirmation message', () => {
    const adapter = createAdapter();
    const result = startApache2(adapter, []);
    expect(result).toContain('Starting');
    expect(result).toContain('apache2');
    expect(result).toContain('port 80');
  });
});

describe('APACHE2_STARTER_INDEX_HTML', () => {
  it('is a complete HTML document', () => {
    expect(APACHE2_STARTER_INDEX_HTML).toContain('<!DOCTYPE html>');
    expect(APACHE2_STARTER_INDEX_HTML).toContain('</html>');
  });

  it('contains the iconic "It works!" message', () => {
    expect(APACHE2_STARTER_INDEX_HTML).toContain('It works!');
  });
});
