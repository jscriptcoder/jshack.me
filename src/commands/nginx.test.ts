import { describe, it, expect, vi } from 'vitest';
import { startNginx, NGINX_STARTER_INDEX_HTML, type NginxAdapter } from './nginx';
import type { UserType } from '../session/types';

const createAdapter = (overrides: Partial<NginxAdapter> = {}): NginxAdapter => ({
  isPortOpen: overrides.isPortOpen ?? (() => false),
  readPidFile: overrides.readPidFile ?? (() => undefined),
  writePidFile: overrides.writePidFile ?? vi.fn(),
  indexHtmlExists: overrides.indexHtmlExists ?? (() => false),
  writeIndexHtml: overrides.writeIndexHtml ?? vi.fn(),
  username: overrides.username ?? 'root',
  userType: (overrides.userType ?? 'root') as UserType,
});

describe('startNginx — port parsing', () => {
  it('starts on default port 80 when no args given', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile });
    const result = startNginx(adapter, []);
    expect(writePidFile).toHaveBeenCalled();
    expect(result).toContain('port 80');
  });

  it('starts on custom high port for a regular user', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile, userType: 'user', username: 'alice' });
    const result = startNginx(adapter, [8080]);
    expect(writePidFile).toHaveBeenCalled();
    expect(result).toContain('port 8080');
  });

  it('throws on invalid port number', () => {
    const adapter = createAdapter();
    expect(() => startNginx(adapter, [0])).toThrow();
    expect(() => startNginx(adapter, [70000])).toThrow();
    expect(() => startNginx(adapter, ['abc'])).toThrow();
  });
});

describe('startNginx — privileged port (<1024) gating', () => {
  it('rejects port 80 for a non-root user', () => {
    const adapter = createAdapter({ userType: 'user', username: 'alice' });
    expect(() => startNginx(adapter, [80])).toThrow();
  });

  it('rejects port 1023 (boundary just below privileged threshold) for a non-root user', () => {
    const adapter = createAdapter({ userType: 'user', username: 'alice' });
    expect(() => startNginx(adapter, [1023])).toThrow();
  });

  it('accepts port 1024 (boundary at privileged threshold) for a non-root user', () => {
    const adapter = createAdapter({ userType: 'user', username: 'alice' });
    expect(() => startNginx(adapter, [1024])).not.toThrow();
  });

  it('accepts port 80 for root', () => {
    const adapter = createAdapter({ userType: 'root', username: 'root' });
    expect(() => startNginx(adapter, [80])).not.toThrow();
  });

  it('rejects port 80 for a guest user', () => {
    const adapter = createAdapter({ userType: 'guest', username: 'anon' });
    expect(() => startNginx(adapter, [80])).toThrow();
  });
});

describe('startNginx — already-running state', () => {
  it('returns already-running message when nginx.pid exists (short form)', () => {
    const adapter = createAdapter({ readPidFile: () => '/usr/sbin/nginx:port=80' });
    const result = startNginx(adapter, []);
    expect(result).toContain('already running');
  });

  it('returns already-running message when nginx.pid exists (extended form)', () => {
    const adapter = createAdapter({
      readPidFile: () => '/usr/sbin/nginx:port=80,user=root,userType=root,home=/root',
    });
    const result = startNginx(adapter, []);
    expect(result).toContain('already running');
  });

  it('shows actual running port from pid file, not requested port', () => {
    const adapter = createAdapter({ readPidFile: () => '/usr/sbin/nginx:port=80' });
    const result = startNginx(adapter, [8080]);
    expect(result).toContain('port 80');
    expect(result).not.toContain('port 8080');
  });

  it('extracts running port from multi-line themed-network pid content', () => {
    // Themed networks ship multi-line content for multi-port nginx
    // (findit.io has port 80 + 443). Report the first running port.
    const adapter = createAdapter({
      readPidFile: () => '/usr/sbin/nginx:port=80\n/usr/sbin/nginx:port=443',
    });
    const result = startNginx(adapter, []);
    expect(result).toContain('already running');
    expect(result).toContain('port 80');
  });

  it('returns already-running message when target port is already open', () => {
    const adapter = createAdapter({ isPortOpen: () => true });
    const result = startNginx(adapter, []);
    expect(result).toContain('already running');
  });

  it('does NOT write pid file when already running', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({
      writePidFile,
      readPidFile: () => '/usr/sbin/nginx:port=80',
    });
    startNginx(adapter, []);
    expect(writePidFile).not.toHaveBeenCalled();
  });
});

describe('startNginx — pid file extended-form content', () => {
  it('stamps root user when invoked as root on default port', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile, userType: 'root', username: 'root' });
    startNginx(adapter, []);
    expect(writePidFile).toHaveBeenCalledWith(
      '/usr/sbin/nginx:port=80,user=root,userType=root,home=/root',
    );
  });

  it('stamps invoking regular user (not www-data) on a high port', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({
      writePidFile,
      userType: 'user',
      username: 'alice',
    });
    startNginx(adapter, [8080]);
    expect(writePidFile).toHaveBeenCalledWith(
      '/usr/sbin/nginx:port=8080,user=alice,userType=user,home=/home/alice',
    );
  });

  it('stamps guest user on a high port', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({
      writePidFile,
      userType: 'guest',
      username: 'anon',
    });
    startNginx(adapter, [9000]);
    expect(writePidFile).toHaveBeenCalledWith(
      '/usr/sbin/nginx:port=9000,user=anon,userType=guest,home=/home/anon',
    );
  });

  it('uses /usr/sbin/nginx binary prefix matching the infra parser format', () => {
    const writePidFile = vi.fn();
    const adapter = createAdapter({ writePidFile });
    startNginx(adapter, []);
    const writtenContent = writePidFile.mock.calls[0][0];
    expect(writtenContent.startsWith('/usr/sbin/nginx:')).toBe(true);
  });
});

describe('startNginx — starter index.html', () => {
  it('creates /var/www/html/index.html when it does NOT exist', () => {
    const writeIndexHtml = vi.fn();
    const adapter = createAdapter({
      writeIndexHtml,
      indexHtmlExists: () => false,
    });
    startNginx(adapter, []);
    expect(writeIndexHtml).toHaveBeenCalledWith(NGINX_STARTER_INDEX_HTML);
  });

  it('does NOT overwrite an existing /var/www/html/index.html', () => {
    const writeIndexHtml = vi.fn();
    const adapter = createAdapter({
      writeIndexHtml,
      indexHtmlExists: () => true,
    });
    startNginx(adapter, []);
    expect(writeIndexHtml).not.toHaveBeenCalled();
  });

  it('does NOT create index.html when daemon is already running', () => {
    const writeIndexHtml = vi.fn();
    const adapter = createAdapter({
      writeIndexHtml,
      readPidFile: () => '/usr/sbin/nginx:port=80',
    });
    startNginx(adapter, []);
    expect(writeIndexHtml).not.toHaveBeenCalled();
  });
});

describe('startNginx — successful start output', () => {
  it('returns multi-line confirmation message', () => {
    const adapter = createAdapter();
    const result = startNginx(adapter, []);
    expect(result).toContain('Starting');
    expect(result).toContain('nginx');
    expect(result).toContain('port 80');
  });
});

describe('NGINX_STARTER_INDEX_HTML', () => {
  it('is a complete HTML document', () => {
    expect(NGINX_STARTER_INDEX_HTML).toContain('<!DOCTYPE html>');
    expect(NGINX_STARTER_INDEX_HTML).toContain('</html>');
  });

  it('contains the iconic "Welcome to nginx!" message', () => {
    expect(NGINX_STARTER_INDEX_HTML).toContain('Welcome to nginx!');
  });
});
