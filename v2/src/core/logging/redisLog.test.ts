import { describe, expect, it } from 'vitest';
import {
  REDIS_LOG_OWNER,
  REDIS_LOG_PATH,
  REDIS_LOG_PERMISSIONS,
  formatRedisAttemptLine,
  formatRedisConnectLine,
} from './redisLog';
import { asGameTime } from '../types';

/**
 * `/var/log/redis.log` is the defender's whole view of who has reached their store.
 *
 * Three line shapes carry it, and the split between them is the point: arriving and
 * naming a password are two events here, where mysql's protocol makes them one. A
 * store that asks for no password therefore produces an arrival line and NOTHING
 * else — no wall of failures, because there was nothing to fail. That is the honest
 * consequence of a door anyone can open, and it is why the arrival line has to exist
 * at all.
 *
 * No line names an account, because the store has none. What it can say is who tried.
 */

const attempt = (overrides: Partial<Parameters<typeof formatRedisAttemptLine>[0]> = {}) => ({
  outcome: 'failure' as const,
  user: '',
  fromIp: '10.0.0.9',
  hostname: 'www-7',
  time: asGameTime(Date.UTC(2026, 7, 20, 9, 14, 2)),
  pid: 4471,
  ...overrides,
});

describe('a redis.log line', () => {
  it('records a client reaching the store before any password is named', () => {
    expect(formatRedisConnectLine(attempt())).toBe(
      '4471:M 20 Aug 2026 09:14:02.000 * Client connected from 10.0.0.9',
    );
  });

  it('marks an accepted password as a notice, and a refused one as a warning', () => {
    // `*` and `#` are real Redis's own severity marks, which is what lets a defender
    // skim a file of them and see the one that landed.
    expect(formatRedisAttemptLine(attempt({ outcome: 'success' }))).toBe(
      '4471:M 20 Aug 2026 09:14:02.000 * Client 10.0.0.9 authenticated successfully',
    );
    expect(formatRedisAttemptLine(attempt())).toBe(
      '4471:M 20 Aug 2026 09:14:02.000 # Client 10.0.0.9 authentication failed',
    );
  });

  it('names no account on any line, because the store answers to a password alone', () => {
    const named = formatRedisAttemptLine(attempt({ outcome: 'success', user: 'sqladmin' }));

    expect(named).not.toContain('sqladmin');
  });

  it('space-pads a single-digit day, as the daemon it imitates does', () => {
    const early = attempt({ time: asGameTime(Date.UTC(2026, 0, 5, 0, 0, 0)) });

    expect(formatRedisConnectLine(early)).toBe(
      '4471:M  5 Jan 2026 00:00:00.000 * Client connected from 10.0.0.9',
    );
  });

  it('keeps the log readable by anyone on the box and writable only by the system', () => {
    // Getting onto the box is the gate; once there, the record of who else has been is
    // exactly what a defender is entitled to. Root-only write is what stops a visitor
    // editing away the line that says they came.
    expect(REDIS_LOG_PATH).toBe('/var/log/redis.log');
    expect(REDIS_LOG_OWNER).toBe('root');
    expect(REDIS_LOG_PERMISSIONS).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root'],
    });
  });
});
