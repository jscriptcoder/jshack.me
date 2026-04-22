import { describe, expect, it } from 'vitest';

import {
  formatAccessLog,
  formatFtpConnect,
  formatFtpLoginFailed,
  formatFtpLoginOk,
  formatGobusterScanAggregate,
  formatHydraBruteForceFtp,
  formatHydraBruteForceMysql,
  formatHydraBruteForceRedis,
  formatHydraBruteForceSnmp,
  formatHydraBruteForceSsh,
  formatMysqlAccessDenied,
  formatMysqlConnect,
  formatRedisAuth,
  formatRedisConnect,
  formatRedisAuthDenied,
  formatScpAccepted,
  formatScpFailed,
  formatSnmpCommunityDiscovered,
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

describe('formatRedisConnect', () => {
  it('formats Redis client connection entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatRedisConnect({ date, pid: 1234, sourceIp: '192.168.1.100' });
    expect(result).toBe('1234:M 21 Mar 2026 14:30:15.000 * Client connected from 192.168.1.100');
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

describe('formatGobusterScanAggregate', () => {
  it('formats a mod_security-style directory enumeration entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatGobusterScanAggregate({
      date,
      sourceIp: '192.168.1.100',
      port: 80,
      probedCount: 50,
      hitCount: 12,
    });
    expect(result).toBe(
      '[21/Mar/2026:14:30:15 +0000] [mod_security] [client 192.168.1.100] Directory enumeration detected on port 80 — 50 paths probed, 12 hits (gobuster)',
    );
  });

  it('zero-pads single-digit day and time components', () => {
    const date = new Date('2026-01-05T09:05:03Z');
    const result = formatGobusterScanAggregate({
      date,
      sourceIp: '10.0.0.5',
      port: 8080,
      probedCount: 1,
      hitCount: 0,
    });
    expect(result).toBe(
      '[05/Jan/2026:09:05:03 +0000] [mod_security] [client 10.0.0.5] Directory enumeration detected on port 8080 — 1 paths probed, 0 hits (gobuster)',
    );
  });
});

describe('formatHydraBruteForceSsh', () => {
  it('formats an ssh brute-force aggregate with attempt and success counts', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatHydraBruteForceSsh({
      date,
      hostname: 'webserver',
      pid: 2341,
      sourceIp: '192.168.1.100',
      attempts: 384,
      successes: 2,
    });
    expect(result).toBe(
      'Mar 21 14:30:15 webserver sshd[2341]: Brute-force attempt from 192.168.1.100 — 384 authentication failures, 2 accepted',
    );
  });

  it('reports zero successes when no user cracked', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatHydraBruteForceSsh({
      date,
      hostname: 'webserver',
      pid: 2341,
      sourceIp: '192.168.1.100',
      attempts: 128,
      successes: 0,
    });
    expect(result).toBe(
      'Mar 21 14:30:15 webserver sshd[2341]: Brute-force attempt from 192.168.1.100 — 128 authentication failures, 0 accepted',
    );
  });

  it('space-pads single-digit days (syslog convention)', () => {
    const date = new Date('2026-03-05T09:05:03Z');
    const result = formatHydraBruteForceSsh({
      date,
      hostname: 'host',
      pid: 1,
      sourceIp: '10.0.0.5',
      attempts: 1,
      successes: 0,
    });
    expect(result).toBe(
      'Mar  5 09:05:03 host sshd[1]: Brute-force attempt from 10.0.0.5 — 1 authentication failures, 0 accepted',
    );
  });
});

describe('formatHydraBruteForceFtp', () => {
  it('formats an ftp brute-force aggregate in vsftpd style', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatHydraBruteForceFtp({
      date,
      sourceIp: '192.168.1.100',
      attempts: 384,
      successes: 2,
    });
    expect(result).toBe(
      '[2026-03-21 14:30:15] BRUTE FORCE: Client "192.168.1.100" — 384 login attempts, 2 successful',
    );
  });

  it('reports zero successes when no user cracked', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatHydraBruteForceFtp({
      date,
      sourceIp: '192.168.1.100',
      attempts: 128,
      successes: 0,
    });
    expect(result).toBe(
      '[2026-03-21 14:30:15] BRUTE FORCE: Client "192.168.1.100" — 128 login attempts, 0 successful',
    );
  });
});

describe('formatHydraBruteForceMysql', () => {
  it('formats a mysql brute-force aggregate as a Connect event', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatHydraBruteForceMysql({
      date,
      threadId: 42,
      sourceIp: '192.168.1.100',
      attempts: 256,
      successes: 1,
    });
    expect(result).toBe(
      "2026-03-21T14:30:15.000000Z\t42 Connect\tBrute-force attempt from '192.168.1.100' — 256 attempts, 1 accepted",
    );
  });

  it('reports zero successes when no user cracked', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatHydraBruteForceMysql({
      date,
      threadId: 42,
      sourceIp: '192.168.1.100',
      attempts: 128,
      successes: 0,
    });
    expect(result).toBe(
      "2026-03-21T14:30:15.000000Z\t42 Connect\tBrute-force attempt from '192.168.1.100' — 128 attempts, 0 accepted",
    );
  });
});

describe('formatHydraBruteForceRedis', () => {
  it('formats a redis brute-force aggregate as a warning-level entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatHydraBruteForceRedis({
      date,
      pid: 1234,
      sourceIp: '192.168.1.100',
      attempts: 60,
      successes: 1,
    });
    expect(result).toBe(
      '1234:M 21 Mar 2026 14:30:15.000 # Client 192.168.1.100 brute-force attempt — 60 password attempts, 1 authenticated',
    );
  });

  it('reports zero successes when requirepass is not in the wordlist', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatHydraBruteForceRedis({
      date,
      pid: 1234,
      sourceIp: '192.168.1.100',
      attempts: 60,
      successes: 0,
    });
    expect(result).toBe(
      '1234:M 21 Mar 2026 14:30:15.000 # Client 192.168.1.100 brute-force attempt — 60 password attempts, 0 authenticated',
    );
  });
});

describe('formatHydraBruteForceSnmp', () => {
  it('formats an snmp community-string brute-force aggregate', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatHydraBruteForceSnmp({
      date,
      hostname: 'iotcam',
      pid: 987,
      sourceIp: '192.168.1.100',
      attempts: 12,
      successes: 1,
    });
    expect(result).toBe(
      'Mar 21 14:30:15 iotcam snmpd[987]: Brute-force community string attempt from 192.168.1.100 — 12 probed, 1 found',
    );
  });

  it('reports zero successes when no community string matches', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatHydraBruteForceSnmp({
      date,
      hostname: 'iotcam',
      pid: 987,
      sourceIp: '192.168.1.100',
      attempts: 12,
      successes: 0,
    });
    expect(result).toBe(
      'Mar 21 14:30:15 iotcam snmpd[987]: Brute-force community string attempt from 192.168.1.100 — 12 probed, 0 found',
    );
  });
});

describe('formatSnmpCommunityDiscovered', () => {
  it('formats a discovered-community syslog entry', () => {
    const date = new Date('2026-03-21T14:30:15Z');
    const result = formatSnmpCommunityDiscovered({
      date,
      hostname: 'iotcam',
      pid: 987,
      sourceIp: '192.168.1.100',
      community: 'private',
    });
    expect(result).toBe(
      'Mar 21 14:30:15 iotcam snmpd[987]: Community string "private" accessed from 192.168.1.100',
    );
  });
});
