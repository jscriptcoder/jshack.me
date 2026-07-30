import { describe, expect, it } from 'vitest';
import { asGameTime } from '../types';
import { formatAccessLogLine } from './accessLog';

/**
 * Access-log (`/var/log/access.log`) line formatting — Apache Combined Log Format, the
 * shape a player recognises on sight. Ported from legacy
 * `src/logging/formatters.ts:formatAccessLog`. Pure: the timestamp is supplied, so the
 * whole line is assertable.
 */

// 2026-07-30 13:55:36 UTC — every component two digits, so padding is NOT exercised here.
const JUL_30 = asGameTime(Date.UTC(2026, 6, 30, 13, 55, 36));

describe('formatAccessLogLine', () => {
  it('renders a served request in Apache Combined shape', () => {
    const line = formatAccessLogLine({
      time: JUL_30,
      sourceIp: '198.51.100.22',
      path: '/index.html',
      status: 200,
      size: 23,
    });

    expect(line).toBe(
      '198.51.100.22 - - [30/Jul/2026:13:55:36 +0000] "GET /index.html HTTP/1.1" 200 23',
    );
  });

  it('zero-pads every date and time component (UTC)', () => {
    // The single-digit case: a day, hour, minute or second under 10 must render as
    // `05`, not `5`, or the column alignment every log reader relies on collapses.
    const line = formatAccessLogLine({
      time: asGameTime(Date.UTC(2026, 0, 5, 4, 7, 9)),
      sourceIp: '10.0.0.5',
      path: '/',
      status: 200,
      size: 12,
    });

    expect(line).toBe('10.0.0.5 - - [05/Jan/2026:04:07:09 +0000] "GET / HTTP/1.1" 200 12');
  });

  it('renders a 404 with a zero body size — the line a directory sweep leaves behind', () => {
    const line = formatAccessLogLine({
      time: JUL_30,
      sourceIp: '203.0.113.9',
      path: '/wp-admin/setup-config.php',
      status: 404,
      size: 0,
    });

    expect(line).toBe(
      '203.0.113.9 - - [30/Jul/2026:13:55:36 +0000] "GET /wp-admin/setup-config.php HTTP/1.1" 404 0',
    );
  });

  it('records a source it could not resolve as `unknown` rather than leaving the field blank', () => {
    // A blank first field would shift every column and read as a malformed line; the
    // server says plainly that it could not place the requester.
    const line = formatAccessLogLine({
      time: JUL_30,
      sourceIp: 'unknown',
      path: '/',
      status: 200,
      size: 5,
    });

    expect(line).toBe('unknown - - [30/Jul/2026:13:55:36 +0000] "GET / HTTP/1.1" 200 5');
  });
});
