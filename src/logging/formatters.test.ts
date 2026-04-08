import { describe, expect, it } from 'vitest';

import {
  formatAccessLog,
  formatFtpConnect,
  formatFtpLoginFailed,
  formatFtpLoginOk,
  formatMysqlAccessDenied,
  formatMysqlConnect,
  formatRedisAuth,
  formatRedisAuthDenied,
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
    const result = formatSyslogLine({
      date,
      hostname: 'webserver',
      service: 'sshd',
      pid: 2341,
      message: 'test message',
    });
    expect(result).toBe('Mar 21 14:30:15 webserver sshd[2341]: test message');
  });

  it('space-pads single-digit days', () => {
    const date = new Date('2026-03-05T09:05:03Z');
    const result = formatSyslogLine({
      date,
      hostname: 'host',
      service: 'svc',
      pid: 1234,
      message: 'msg',
    });
    expect(result).toBe('Mar  5 09:05:03 host svc[1234]: msg');
  });

  it('zero-pads time components', () => {
    const date = new Date('2026-01-01T01:02:03Z');
    const result = formatSyslogLine({
      date,
      hostname: 'h',
      service: 's',
      pid: 1,
      message: 'm',
    });
    expect(result).toBe('Jan  1 01:02:03 h s[1]: m');
  });
});

describe('formatSshAccepted', () => {
  it('formats SSH accepted password entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSshAccepted({
      date,
      hostname: 'webserver',
      pid: 2341,
      user: 'admin',
      fromIp: '192.168.1.100',
      port: 54321,
    });
    expect(result).toBe(
      'Mar 21 14:30:15 webserver sshd[2341]: Accepted password for admin from 192.168.1.100 port 54321 ssh2',
    );
  });
});

describe('formatSshAcceptedKey', () => {
  it('formats SSH accepted publickey entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSshAcceptedKey({
      date,
      hostname: 'webserver',
      pid: 2341,
      user: 'admin',
      fromIp: '192.168.1.100',
      port: 54321,
    });
    expect(result).toBe(
      'Mar 21 14:30:15 webserver sshd[2341]: Accepted publickey for admin from 192.168.1.100 port 54321 ssh2',
    );
  });
});

describe('formatSshFailed', () => {
  it('formats SSH failed password entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSshFailed({
      date,
      hostname: 'webserver',
      pid: 2341,
      user: 'admin',
      fromIp: '192.168.1.100',
      port: 54321,
    });
    expect(result).toBe(
      'Mar 21 14:30:15 webserver sshd[2341]: Failed password for admin from 192.168.1.100 port 54321 ssh2',
    );
  });
});

describe('formatSuSuccess', () => {
  it('formats successful su entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSuSuccess({
      date,
      hostname: 'localhost',
      pid: 3456,
      targetUser: 'root',
      fromUser: 'user',
    });
    expect(result).toBe('Mar 21 14:30:15 localhost su[3456]: Successful su for root by user');
  });
});

describe('formatSuFailed', () => {
  it('formats failed su entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSuFailed({
      date,
      hostname: 'localhost',
      pid: 3456,
      targetUser: 'root',
      fromUser: 'user',
    });
    expect(result).toBe('Mar 21 14:30:15 localhost su[3456]: FAILED su for root by user');
  });
});

describe('formatScpAccepted', () => {
  it('formats SCP accepted entry (uses sshd service)', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatScpAccepted({
      date,
      hostname: 'fileserver',
      pid: 2500,
      user: 'admin',
      fromIp: '10.0.0.5',
      port: 49152,
    });
    expect(result).toBe(
      'Mar 21 14:30:15 fileserver sshd[2500]: Accepted password for admin from 10.0.0.5 port 49152 ssh2',
    );
  });
});

describe('formatScpFailed', () => {
  it('formats SCP failed entry (uses sshd service)', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatScpFailed({
      date,
      hostname: 'fileserver',
      pid: 2500,
      user: 'admin',
      fromIp: '10.0.0.5',
      port: 49152,
    });
    expect(result).toBe(
      'Mar 21 14:30:15 fileserver sshd[2500]: Failed password for admin from 10.0.0.5 port 49152 ssh2',
    );
  });
});

describe('formatFtpConnect', () => {
  it('formats FTP connect entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatFtpConnect(date, '192.168.1.100');
    expect(result).toBe('[2026-03-21 14:30:15] CONNECT: Client "192.168.1.100"');
  });
});

describe('formatFtpLoginOk', () => {
  it('formats FTP successful login entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatFtpLoginOk({
      date,
      clientIp: '192.168.1.100',
      user: 'ftpuser',
    });
    expect(result).toBe('[2026-03-21 14:30:15] OK LOGIN: Client "192.168.1.100", user "ftpuser"');
  });
});

describe('formatFtpLoginFailed', () => {
  it('formats FTP failed login entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatFtpLoginFailed({
      date,
      clientIp: '192.168.1.100',
      user: 'baduser',
    });
    expect(result).toBe('[2026-03-21 14:30:15] FAIL LOGIN: Client "192.168.1.100", user "baduser"');
  });
});

describe('formatMysqlConnect', () => {
  it('formats MySQL successful connection entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatMysqlConnect({
      date,
      threadId: 42,
      user: 'admin',
      sourceIp: '192.168.1.100',
      dbName: 'webapp_db',
    });
    expect(result).toBe(
      '2026-03-21T14:30:15.000000Z\t42 Connect\tadmin@192.168.1.100 on webapp_db using TCP/IP',
    );
  });
});

describe('formatMysqlAccessDenied', () => {
  it('formats MySQL access denied entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatMysqlAccessDenied({
      date,
      threadId: 42,
      user: 'admin',
      sourceIp: '192.168.1.100',
    });
    expect(result).toBe(
      "2026-03-21T14:30:15.000000Z\t42 Connect\tAccess denied for user 'admin'@'192.168.1.100' (using password: YES)",
    );
  });
});

describe('formatRedisAuth', () => {
  it('formats Redis auth success entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatRedisAuth({ date, pid: 1234, sourceIp: '192.168.1.100' });
    expect(result).toBe(
      '1234:M 21 Mar 2026 14:30:15.000 * Client 192.168.1.100 authenticated successfully',
    );
  });
});

describe('formatRedisAuthDenied', () => {
  it('formats Redis auth denied entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatRedisAuthDenied({ date, pid: 1234, sourceIp: '192.168.1.100' });
    expect(result).toBe(
      '1234:M 21 Mar 2026 14:30:15.000 # Client 192.168.1.100 authentication failed',
    );
  });
});

describe('formatAccessLog', () => {
  it('formats Apache Combined Log Format entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatAccessLog({
      date,
      clientIp: '192.168.1.100',
      method: 'GET',
      path: '/index.html',
      status: 200,
      size: 1234,
    });
    expect(result).toBe(
      '192.168.1.100 - - [21/Mar/2026:14:30:15 +0000] "GET /index.html HTTP/1.1" 200 1234',
    );
  });

  it('formats 404 response', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatAccessLog({
      date,
      clientIp: '10.0.0.5',
      method: 'GET',
      path: '/secret',
      status: 404,
      size: 48,
    });
    expect(result).toBe('10.0.0.5 - - [21/Mar/2026:14:30:15 +0000] "GET /secret HTTP/1.1" 404 48');
  });

  it('formats POST request', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatAccessLog({
      date,
      clientIp: '10.0.0.5',
      method: 'POST',
      path: '/api/login',
      status: 200,
      size: 89,
    });
    expect(result).toBe(
      '10.0.0.5 - - [21/Mar/2026:14:30:15 +0000] "POST /api/login HTTP/1.1" 200 89',
    );
  });
});
