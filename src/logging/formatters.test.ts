import { describe, expect, it } from 'vitest';

import {
  formatScpAccepted,
  formatScpFailed,
  formatSshAccepted,
  formatSshAcceptedKey,
  formatSshFailed,
  formatSuFailed,
  formatSuSuccess,
  formatSyslogLine,
} from './formatters';

describe('formatSyslogLine', () => {
  it('formats a syslog line with correct components', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSyslogLine(date, 'webserver', 'sshd', 2341, 'test message');
    expect(result).toBe('Mar 21 14:30:15 webserver sshd[2341]: test message');
  });

  it('space-pads single-digit days', () => {
    const date = new Date('2026-03-05T09:05:03Z');
    const result = formatSyslogLine(date, 'host', 'svc', 1234, 'msg');
    expect(result).toBe('Mar  5 09:05:03 host svc[1234]: msg');
  });

  it('zero-pads time components', () => {
    const date = new Date('2026-01-01T01:02:03Z');
    const result = formatSyslogLine(date, 'h', 's', 1, 'm');
    expect(result).toBe('Jan  1 01:02:03 h s[1]: m');
  });
});

describe('formatSshAccepted', () => {
  it('formats SSH accepted password entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSshAccepted(date, 'webserver', 2341, 'admin', '192.168.1.100', 54321);
    expect(result).toBe(
      'Mar 21 14:30:15 webserver sshd[2341]: Accepted password for admin from 192.168.1.100 port 54321 ssh2',
    );
  });
});

describe('formatSshAcceptedKey', () => {
  it('formats SSH accepted publickey entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSshAcceptedKey(date, 'webserver', 2341, 'admin', '192.168.1.100', 54321);
    expect(result).toBe(
      'Mar 21 14:30:15 webserver sshd[2341]: Accepted publickey for admin from 192.168.1.100 port 54321 ssh2',
    );
  });
});

describe('formatSshFailed', () => {
  it('formats SSH failed password entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSshFailed(date, 'webserver', 2341, 'admin', '192.168.1.100', 54321);
    expect(result).toBe(
      'Mar 21 14:30:15 webserver sshd[2341]: Failed password for admin from 192.168.1.100 port 54321 ssh2',
    );
  });
});

describe('formatSuSuccess', () => {
  it('formats successful su entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSuSuccess(date, 'localhost', 3456, 'root', 'user');
    expect(result).toBe('Mar 21 14:30:15 localhost su[3456]: Successful su for root by user');
  });
});

describe('formatSuFailed', () => {
  it('formats failed su entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSuFailed(date, 'localhost', 3456, 'root', 'user');
    expect(result).toBe('Mar 21 14:30:15 localhost su[3456]: FAILED su for root by user');
  });
});

describe('formatScpAccepted', () => {
  it('formats SCP accepted entry (uses sshd service)', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatScpAccepted(date, 'fileserver', 2500, 'admin', '10.0.0.5', 49152);
    expect(result).toBe(
      'Mar 21 14:30:15 fileserver sshd[2500]: Accepted password for admin from 10.0.0.5 port 49152 ssh2',
    );
  });
});

describe('formatScpFailed', () => {
  it('formats SCP failed entry (uses sshd service)', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatScpFailed(date, 'fileserver', 2500, 'admin', '10.0.0.5', 49152);
    expect(result).toBe(
      'Mar 21 14:30:15 fileserver sshd[2500]: Failed password for admin from 10.0.0.5 port 49152 ssh2',
    );
  });
});
