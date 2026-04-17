import { describe, it, expect } from 'vitest';
import { pickPatternForEffect } from './attackPatterns';
import { createPrng } from './prng';
import type { VulnerabilityEffect } from '../network/types';

const prng = () => createPrng('attack-pattern-test');

const ALL_EFFECTS: readonly VulnerabilityEffect[] = [
  { kind: 'shell_limited', tier: 'user' },
  { kind: 'shell_full', tier: 'user' },
  { kind: 'file_read', tier: 'user' },
  { kind: 'dir_list', tier: 'user' },
  { kind: 'file_write', tier: 'user' },
  { kind: 'password_reset', tier: 'user' },
  { kind: 'backdoor_port_open', tier: 'user', port: 4444 },
  { kind: 'script_exec', tier: 'user' },
];

describe('pickPatternForEffect', () => {
  it('http services use /var/log/access.log with method+path+status', () => {
    for (const effect of ALL_EFFECTS) {
      const pattern = pickPatternForEffect('http', effect, prng());
      expect(pattern.logFile).toBe('/var/log/access.log');
      expect('method' in pattern && 'path' in pattern && 'status' in pattern).toBe(true);
    }
  });

  it('ftp uses /var/log/vsftpd.log with a command', () => {
    for (const effect of ALL_EFFECTS) {
      const pattern = pickPatternForEffect('ftp', effect, prng());
      expect(pattern.logFile).toBe('/var/log/vsftpd.log');
      expect('command' in pattern).toBe(true);
    }
  });

  it('mysql uses /var/log/mysql.log with a query', () => {
    for (const effect of ALL_EFFECTS) {
      const pattern = pickPatternForEffect('mysql', effect, prng());
      expect(pattern.logFile).toBe('/var/log/mysql.log');
      expect('query' in pattern).toBe(true);
    }
  });

  it('redis uses /var/log/redis.log with a message', () => {
    for (const effect of ALL_EFFECTS) {
      const pattern = pickPatternForEffect('redis', effect, prng());
      expect(pattern.logFile).toBe('/var/log/redis.log');
      expect('message' in pattern).toBe(true);
    }
  });

  it('mail services (smtp/imap/pop3) use /var/log/mail.log', () => {
    const services = ['smtp', 'imap', 'pop3'] as const;
    for (const service of services) {
      for (const effect of ALL_EFFECTS) {
        const pattern = pickPatternForEffect(service, effect, prng());
        expect(pattern.logFile).toBe('/var/log/mail.log');
      }
    }
  });

  it('syslog-based services (postgresql, mongodb, smb, etc.) use /var/log/syslog', () => {
    const services = ['postgresql', 'mongodb', 'smb', 'rsync', 'vnc', 'dns', 'mqtt'] as const;
    for (const service of services) {
      for (const effect of ALL_EFFECTS) {
        const pattern = pickPatternForEffect(service, effect, prng());
        expect(pattern.logFile).toBe('/var/log/syslog');
        expect('daemon' in pattern).toBe(true);
      }
    }
  });

  it('unknown service falls back to syslog with the service name as daemon', () => {
    const pattern = pickPatternForEffect(
      'no-such-service',
      { kind: 'shell_limited', tier: 'user' },
      prng(),
    );
    expect(pattern.logFile).toBe('/var/log/syslog');
    if (pattern.logFile === '/var/log/syslog') {
      expect(pattern.daemon).toBe('no-such-service');
    }
  });

  it('is deterministic given the same prng seed', () => {
    const a = pickPatternForEffect('http', { kind: 'file_read', tier: 'user' }, prng());
    const b = pickPatternForEffect('http', { kind: 'file_read', tier: 'user' }, prng());
    expect(a).toEqual(b);
  });

  it('file_read pattern references reading (path/query/command mentions read or traversal)', () => {
    const pattern = pickPatternForEffect('http', { kind: 'file_read', tier: 'user' }, prng());
    if (pattern.logFile === '/var/log/access.log') {
      expect(pattern.path).toMatch(/\.\.|etc\/(passwd|shadow)|file=/i);
    }
  });

  it('backdoor_port_open pattern references the port number', () => {
    const pattern = pickPatternForEffect(
      'http',
      { kind: 'backdoor_port_open', tier: 'user', port: 31337 },
      prng(),
    );
    if (pattern.logFile === '/var/log/access.log') {
      expect(pattern.path).toContain('31337');
    }
  });

  it('script_exec pattern mentions script-like content', () => {
    const pattern = pickPatternForEffect('redis', { kind: 'script_exec', tier: 'user' }, prng());
    if (pattern.logFile === '/var/log/redis.log') {
      expect(pattern.message).toMatch(/script|eval|lua|exec/i);
    }
  });
});
