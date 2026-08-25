import { describe, expect, it } from 'vitest';
import {
  REDIS_LOG_OWNER,
  REDIS_LOG_PATH,
  REDIS_LOG_PERMISSIONS,
  formatRedisAttemptLine,
  formatRedisConnectLine,
  formatRedisMutationLine,
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

  it('names every month it can print, so no line can date itself wrong', () => {
    // A month the formatter never renders in a test is a month whose name can be blanked
    // without anything failing — and the line would then read `20  2026`.
    const names = Array.from({ length: 12 }, (_unused, month) =>
      formatRedisConnectLine(attempt({ time: asGameTime(Date.UTC(2026, month, 20, 9, 14, 2)) }))
        .split(' ')
        .slice(2, 3)
        .join(''),
    );

    expect(names).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]);
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

/**
 * The fourth line shape: what a client CHANGED.
 *
 * Against an open store this is the only evidence that anything was taken seriously —
 * the arrival line says somebody came, and this says what they did while they were
 * here. It is a notice rather than a warning, because a write is not by itself a
 * failure: an open store letting a stranger set a key is the door working as designed,
 * and it is the defender's job to decide whether that stranger should have.
 *
 * The statement arrives already rendered. This formatter neither trusts it nor squeezes
 * it — the verb table does that where the line is parsed, so the two cannot disagree
 * about what a value is allowed to be.
 */
describe('a redis.log line about a change', () => {
  it('names who changed the store and what they ran', () => {
    expect(
      formatRedisMutationLine({
        detail: 'SET sess:0a1b2c3d "{\\"username\\":\\"root\\"}"',
        fromIp: '10.0.0.9',
        time: asGameTime(Date.UTC(2026, 7, 20, 9, 14, 2)),
        pid: 4471,
      }),
    ).toBe(
      '4471:M 20 Aug 2026 09:14:02.000 * Client 10.0.0.9 SET sess:0a1b2c3d "{\\"username\\":\\"root\\"}"',
    );
  });

  it('carries a removal the same way, because both are one thing a client did', () => {
    expect(
      formatRedisMutationLine({
        detail: 'DEL perms:root',
        fromIp: '192.168.1.50',
        time: asGameTime(Date.UTC(2026, 7, 20, 9, 14, 9)),
        pid: 4472,
      }),
    ).toBe('4472:M 20 Aug 2026 09:14:09.000 * Client 192.168.1.50 DEL perms:root');
  });

  it('shares the stamp and the severity mark with the lines beside it', () => {
    // One file, read top to bottom by a defender. A change written in a shape the
    // arrival lines do not share would be a line they skim past.
    const at = asGameTime(Date.UTC(2026, 7, 20, 9, 14, 2));
    const changed = formatRedisMutationLine({
      detail: 'DEL stats:requests',
      fromIp: '10.0.0.9',
      time: at,
      pid: 4471,
    });

    expect(changed.startsWith('4471:M 20 Aug 2026 09:14:02.000 * Client 10.0.0.9 ')).toBe(true);
  });
});
