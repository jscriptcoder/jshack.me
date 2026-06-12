import { describe, expect, it } from 'vitest';
import { asGameTime } from '../types';
import { derivePid, formatSshdAuthLine, formatSuAuthLine } from './authLog';

/**
 * Auth-log line formatting — the syslog-style `/var/log/auth.log` entry `su`
 * writes on a user switch. Ported from legacy `src/logging/formatters.ts`:
 *   `MMM DD HH:MM:SS <hostname> su[<pid>]: <message>`
 * with `Successful su for <target> by <from>` / `FAILED su for <target> by <from>`.
 * Pure given its inputs (the timestamp is supplied, never read from the clock),
 * so the rendered string is fully assertable.
 */

// 2026-06-07 14:32:01 UTC — a date that exercises month name, space-padded day,
// and zero-padded time fields.
const JUN_7 = asGameTime(Date.UTC(2026, 5, 7, 14, 32, 1));

describe('formatSuAuthLine', () => {
  it('renders a successful switch as a syslog su line', () => {
    const line = formatSuAuthLine({
      outcome: 'success',
      targetUser: 'root',
      fromUser: 'neo',
      hostname: 'workstation',
      time: JUN_7,
      pid: 4242,
    });

    expect(line).toBe('Jun  7 14:32:01 workstation su[4242]: Successful su for root by neo');
  });

  it('renders a failed switch as a FAILED su line', () => {
    const line = formatSuAuthLine({
      outcome: 'failure',
      targetUser: 'root',
      fromUser: 'neo',
      hostname: 'workstation',
      time: JUN_7,
      pid: 4242,
    });

    expect(line).toBe('Jun  7 14:32:01 workstation su[4242]: FAILED su for root by neo');
  });

  it('zero-pads time fields and space-pads the day-of-month (UTC)', () => {
    // 2026-01-03 04:05:06 UTC → single-digit month/day/time components.
    const line = formatSuAuthLine({
      outcome: 'success',
      targetUser: 'guest',
      fromUser: 'root',
      hostname: 'rig',
      time: asGameTime(Date.UTC(2026, 0, 3, 4, 5, 6)),
      pid: 7,
    });

    expect(line).toBe('Jan  3 04:05:06 rig su[7]: Successful su for guest by root');
  });

  it('carries the actual target and from users into the message', () => {
    const line = formatSuAuthLine({
      outcome: 'success',
      targetUser: 'alice',
      fromUser: 'guest',
      hostname: 'box',
      time: JUN_7,
      pid: 100,
    });

    expect(line).toContain('Successful su for alice by guest');
  });
});

describe('formatSshdAuthLine', () => {
  it('renders a successful ssh login as an sshd Accepted line', () => {
    const line = formatSshdAuthLine({
      outcome: 'success',
      user: 'root',
      fromIp: '192.168.1.50',
      hostname: 'fileserver-7',
      time: JUN_7,
      pid: 4242,
    });

    expect(line).toBe(
      'Jun  7 14:32:01 fileserver-7 sshd[4242]: Accepted password for root from 192.168.1.50',
    );
  });

  it('renders a rejected ssh login as an sshd Failed line', () => {
    const line = formatSshdAuthLine({
      outcome: 'failure',
      user: 'admin',
      fromIp: '10.0.0.5',
      hostname: 'fileserver-7',
      time: JUN_7,
      pid: 4242,
    });

    expect(line).toBe(
      'Jun  7 14:32:01 fileserver-7 sshd[4242]: Failed password for admin from 10.0.0.5',
    );
  });

  it('carries the actual user and source ip into the message', () => {
    const line = formatSshdAuthLine({
      outcome: 'success',
      user: 'alice',
      fromIp: '172.16.4.9',
      hostname: 'box',
      time: JUN_7,
      pid: 100,
    });

    expect(line).toContain('Accepted password for alice from 172.16.4.9');
  });
});

describe('derivePid', () => {
  it('maps a seed into a plausible 4-digit pid range (1000–9999)', () => {
    expect(derivePid(0)).toBeGreaterThanOrEqual(1000);
    expect(derivePid(1_750_000_123_456)).toBeLessThanOrEqual(9999);
    expect(derivePid(1_750_000_123_456)).toBeGreaterThanOrEqual(1000);
  });

  it('is deterministic for a given seed', () => {
    expect(derivePid(123456)).toBe(derivePid(123456));
  });

  it('varies with the seed', () => {
    expect(derivePid(1000)).not.toBe(derivePid(1001));
  });
});
