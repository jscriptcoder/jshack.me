import { describe, expect, it } from 'vitest';
import { SERVICE_CATALOG } from './serviceCatalog';
import {
  formatPidfileContent,
  parsePidfilePort,
  pidfilePath,
  serviceByPidfileName,
} from './pidfile';

const ssh = SERVICE_CATALOG.ssh;

describe('service pidfile format', () => {
  it('writes the canonical <daemon>:port=<n> line for a running service', () => {
    expect(formatPidfileContent(ssh, 22)).toBe('sshd:port=22');
  });

  it('writes a non-default port into the line', () => {
    expect(formatPidfileContent(ssh, 2222)).toBe('sshd:port=2222');
  });

  it('round-trips the port through format then parse', () => {
    expect(parsePidfilePort(formatPidfileContent(ssh, 22))).toBe(22);
    expect(parsePidfilePort(formatPidfileContent(ssh, 8022))).toBe(8022);
  });

  it('returns null when the content is not the canonical <daemon>:port=<n> shape', () => {
    expect(parsePidfilePort('')).toBeNull();
    expect(parsePidfilePort('sshd')).toBeNull();
    expect(parsePidfilePort('sshd:port=')).toBeNull();
    expect(parsePidfilePort('sshd:port=abc')).toBeNull();
    expect(parsePidfilePort('sshd:port=22 extra')).toBeNull();
    // the WHOLE line must be the canonical shape — leading junk is rejected too.
    expect(parsePidfilePort('garbage sshd:port=22')).toBeNull();
  });

  it('resolves the pidfile path under /var/run', () => {
    expect(pidfilePath(ssh)).toBe('/var/run/sshd.pid');
  });

  it('maps a /var/run pidfile name back to its service spec, and unknown names to undefined', () => {
    expect(serviceByPidfileName('sshd.pid')).toBe(ssh);
    expect(serviceByPidfileName('nginx.pid')).toBe(SERVICE_CATALOG.http);
    expect(serviceByPidfileName('nonesuch.pid')).toBeUndefined();
  });
});
