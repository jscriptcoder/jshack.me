import { describe, expect, it } from 'vitest';
import {
  MYSQL_LOG_OWNER,
  MYSQL_LOG_PATH,
  MYSQL_LOG_PERMISSIONS,
  formatMysqlAttemptLine,
  formatMysqlConnectLine,
} from './mysqlLog';
import { asGameTime } from '../types';

/**
 * `/var/log/mysql.log` is the defender's whole view of who has knocked on their
 * database. Two line shapes carry that: a refusal, and an acceptance that names the
 * database the credential opened.
 *
 * The difference between them is the signal. A wall of denials is somebody trying;
 * one Connect naming a database among them is somebody who got in. A refusal that
 * leaked the name would hand an attacker the one fact they had not yet earned, and
 * an acceptance that withheld it would flatten the two into the same line.
 *
 * The stamp is mysql's own — ISO with microseconds, UTC — and is a third shape again,
 * shared with neither `auth.log` nor `vsftpd.log`. A daemon that writes its own file
 * writes its own format.
 */

const attempt = (overrides: Partial<Parameters<typeof formatMysqlAttemptLine>[0]> = {}) => ({
  outcome: 'failure' as const,
  user: 'readonly',
  fromIp: '10.0.0.9',
  hostname: 'db-11',
  time: asGameTime(Date.UTC(2026, 7, 20, 9, 14, 2)),
  pid: 4471,
  ...overrides,
});

describe('a mysql.log line', () => {
  it('names the database on the connection that was accepted', () => {
    expect(formatMysqlAttemptLine(attempt({ outcome: 'success', database: 'shop_prod' }))).toBe(
      '2026-08-20T09:14:02.000000Z\t4471 Connect\treadonly@10.0.0.9 on shop_prod using TCP/IP',
    );
  });

  it('refuses without naming the database', () => {
    expect(formatMysqlAttemptLine(attempt())).toBe(
      "2026-08-20T09:14:02.000000Z\t4471 Connect\tAccess denied for user 'readonly'@'10.0.0.9' (using password: YES)",
    );
  });

  it('still names no database on a refusal when one was supplied', () => {
    // A client that never authenticated was never told which database it would have
    // reached. Leaking the name here would give a sweep that opened nothing the same
    // intelligence as one that opened everything.
    expect(formatMysqlAttemptLine(attempt({ database: 'shop_prod' }))).not.toContain('shop_prod');
  });

  it('reports an accepted attempt and a client connection identically', () => {
    // To the daemon writing this file they are one event: a credential was accepted
    // and a database was opened. Two shapes would tell a defender that a sweep which
    // landed and a login are different things, which they are not.
    const accepted = attempt({ outcome: 'success', database: 'shop_prod' });
    expect(formatMysqlAttemptLine(accepted)).toBe(
      formatMysqlConnectLine({
        user: accepted.user,
        fromIp: accepted.fromIp,
        time: accepted.time,
        pid: accepted.pid,
        database: 'shop_prod',
      }),
    );
  });
});

describe('the mysql.log stamp', () => {
  it('pads every single-digit part of the clock', () => {
    // 2026-01-05T03:07:09, not 2026-1-5T3:7:9 — an unpadded field would sort wrongly
    // and read as a different daemon's format.
    expect(
      formatMysqlAttemptLine(attempt({ time: asGameTime(Date.UTC(2026, 0, 5, 3, 7, 9)) })),
    ).toContain('2026-01-05T03:07:09.000000Z');
  });

  it('is UTC, not the reader-s local time', () => {
    // Every occupant of a box reads one history. A stamp rendered in whoever happens
    // to be looking would put two players' accounts of the same attack out of step.
    expect(
      formatMysqlAttemptLine(attempt({ time: asGameTime(Date.UTC(2026, 11, 31, 23, 59, 59)) })),
    ).toContain('2026-12-31T23:59:59.000000Z');
  });

  it('always reports six zeroes for the fraction', () => {
    // Game time has second resolution. Inventing microseconds would imply a precision
    // nothing here is recorded at.
    expect(
      formatMysqlAttemptLine(attempt({ time: asGameTime(Date.UTC(2026, 7, 20, 9, 14, 2) + 500) })),
    ).toContain('09:14:02.000000Z');
  });
});

describe('the mysql.log file identity', () => {
  it('is readable by every tier and writable only by root', () => {
    // Getting onto the box is the gate; once there, any account may read the record
    // of who else has been trying. Only the daemon writes it, so a visitor can never
    // edit away the evidence of their visit.
    expect(MYSQL_LOG_PERMISSIONS).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root'],
    });
    expect(MYSQL_LOG_OWNER).toBe('root');
    expect(MYSQL_LOG_PATH).toBe('/var/log/mysql.log');
  });
});
