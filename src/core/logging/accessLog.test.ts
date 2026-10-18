import { describe, expect, it } from 'vitest';
import { asGameTime } from '../types.js';
import { formatAccessLogLine, type AccessLogEvent } from './accessLog.js';

/**
 * Access-log (`/var/log/access.log`) line formatting — Apache Combined Log Format, the
 * shape a player recognises on sight. Ported from legacy
 * `src/logging/formatters.ts:formatAccessLog`. Pure: the timestamp is supplied, so the
 * whole line is assertable.
 */

// 2026-07-30 13:55:36 UTC — every component two digits, so padding is NOT exercised here.
const JUL_30 = asGameTime(Date.UTC(2026, 6, 30, 13, 55, 36));

const accessEvent = (overrides?: Partial<AccessLogEvent>): AccessLogEvent => ({
  time: JUL_30,
  sourceIp: '198.51.100.22',
  path: '/index.html',
  status: 200,
  size: 23,
  ...overrides,
});

describe('formatAccessLogLine', () => {
  it('renders a served request in Apache Combined shape', () => {
    const line = formatAccessLogLine(accessEvent());

    expect(line).toBe(
      '198.51.100.22 - - [30/Jul/2026:13:55:36 +0000] "GET /index.html HTTP/1.1" 200 23',
    );
  });

  it('zero-pads every date and time component (UTC)', () => {
    // The single-digit case: a day, hour, minute or second under 10 must render as
    // `05`, not `5`, or the column alignment every log reader relies on collapses.
    const line = formatAccessLogLine(
      accessEvent({
        time: asGameTime(Date.UTC(2026, 0, 5, 4, 7, 9)),
        sourceIp: '10.0.0.5',
        path: '/',
        size: 12,
      }),
    );

    expect(line).toBe('10.0.0.5 - - [05/Jan/2026:04:07:09 +0000] "GET / HTTP/1.1" 200 12');
  });

  it('renders a 404 with a zero body size — the line a directory sweep leaves behind', () => {
    const line = formatAccessLogLine(
      accessEvent({
        sourceIp: '203.0.113.9',
        path: '/wp-admin/setup-config.php',
        status: 404,
        size: 0,
      }),
    );

    expect(line).toBe(
      '203.0.113.9 - - [30/Jul/2026:13:55:36 +0000] "GET /wp-admin/setup-config.php HTTP/1.1" 404 0',
    );
  });

  it('records a source it could not resolve as `unknown` rather than leaving the field blank', () => {
    // A blank first field would shift every column and read as a malformed line; the
    // server says plainly that it could not place the requester.
    const line = formatAccessLogLine(accessEvent({ sourceIp: 'unknown', path: '/', size: 5 }));

    expect(line).toBe('unknown - - [30/Jul/2026:13:55:36 +0000] "GET / HTTP/1.1" 200 5');
  });

  it('records the method a request really used, so a POST reads as a POST', () => {
    // A form sent to a server that takes none is refused, and the refusal is only worth
    // something to a defender if the line says what was tried. The body is never part of
    // the line: a sign-up's password must not land in a log anybody can read.
    const line = formatAccessLogLine(
      accessEvent({ method: 'POST', path: '/signup', status: 405, size: 166 }),
    );

    expect(line).toBe(
      '198.51.100.22 - - [30/Jul/2026:13:55:36 +0000] "POST /signup HTTP/1.1" 405 166',
    );
  });
});

describe('a field the caller typed, on an access.log line', () => {
  it('cannot close the request early and fake the status and size the server stamps after it', () => {
    const line = formatAccessLogLine(accessEvent({ path: '/x HTTP/1.1" 200 0 "' }));

    expect(line).toBe(
      String.raw`198.51.100.22 - - [30/Jul/2026:13:55:36 +0000] "GET /x\x20HTTP/1.1\x22\x20200\x200\x20\x22 HTTP/1.1" 200 23`,
    );
  });

  it('cannot fake the timestamp with a swept account', () => {
    const line = formatAccessLogLine(
      accessEvent({ path: '/', status: 401, size: 0 }),
      'admin [01/Jan/2026',
    );

    expect(line).toBe(
      String.raw`198.51.100.22 - admin\x20\x5b01/Jan/2026 [30/Jul/2026:13:55:36 +0000] "GET / HTTP/1.1" 401 0`,
    );
  });
});
