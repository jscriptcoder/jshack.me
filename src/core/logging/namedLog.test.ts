import { describe, expect, it } from 'vitest';
import { asGameTime } from '../types';
import {
  NAMED_LOG_OWNER,
  NAMED_LOG_PATH,
  NAMED_LOG_PERMISSIONS,
  formatNamedXfrLine,
} from './namedLog';

/**
 * named-log (`/var/log/named.log`) line formatting — BIND's own channel file, in
 * BIND's own shape. Not syslog: like `vsftpd.log` and `access.log`, the daemon
 * writes its own file, so there is no `hostname service[pid]:` tag and the
 * timestamp is BIND's `DD-Mon-YYYY HH:MM:SS.mmm`. Pure: the time is supplied, so
 * the whole line is assertable.
 *
 * A zone transfer is the loud event on a name server — a completed AXFR and a
 * refused one each write ONE line, and an ordinary lookup writes nothing (BIND's
 * querylog default). The source is named by IP alone, exactly as kern.log and
 * auth.log name a scanner or a login, and the record count mirrors dig's
 * `;; XFR size: N records`: the defender who roots the box learns how much of the
 * zone left, and to whom.
 */

// 2026-09-05 22:13:20.456 UTC — day 5 and ms 456 exercise BIND's zero-padding
// (day to width 2, milliseconds to width 3); the clock fields are already two digits.
const SEP_05 = asGameTime(Date.UTC(2026, 8, 5, 22, 13, 20, 456));

describe('the named log storage identity', () => {
  it('lives at /var/log/named.log, owned by root, world-read and root-write', () => {
    // The literal path IS the interface: a defender types it into `cat`, and the seed
    // and every appended patch compare against the constant, so only spelling it out
    // can catch the file moving.
    expect(NAMED_LOG_PATH).toBe('/var/log/named.log');
    // A log an attacker's tier could own is a log they could rewrite — the record of
    // their transfer would be theirs to edit. Read is world so any account ON the box
    // reads it; write is root so only the daemon's append lands.
    expect(NAMED_LOG_OWNER).toBe('root');
    expect(NAMED_LOG_PERMISSIONS).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root'],
    });
  });
});

describe('formatNamedXfrLine', () => {
  it('renders a completed transfer as an AXFR-ended line naming the source, the zone, and the count', () => {
    const line = formatNamedXfrLine({
      time: SEP_05,
      sourceIp: '203.0.113.7',
      zone: 'grad-student-wifi.lan',
      outcome: { verdict: 'transferred', records: 8 },
    });

    expect(line).toBe(
      "05-Sep-2026 22:13:20.456 client 203.0.113.7 (grad-student-wifi.lan): transfer of 'grad-student-wifi.lan/IN': AXFR ended: 8 records",
    );
  });

  it('renders a refused transfer as a denied line, with no record count', () => {
    const line = formatNamedXfrLine({
      time: SEP_05,
      sourceIp: '203.0.113.7',
      zone: 'oscorp-guest.lan',
      outcome: { verdict: 'denied' },
    });

    expect(line).toBe(
      "05-Sep-2026 22:13:20.456 client 203.0.113.7 (oscorp-guest.lan): zone transfer 'oscorp-guest.lan/IN' denied",
    );
  });

  it('pads a single-digit day to two and sub-100ms to three, and zero-pads the clock, as BIND does', () => {
    // 2026-11-03 09:07:05.007 UTC — day 3, clock 09:07:05, ms 7: every field would
    // render short unpadded, so this is the case that pins the padding.
    const shortComponents = asGameTime(Date.UTC(2026, 10, 3, 9, 7, 5, 7));
    const line = formatNamedXfrLine({
      time: shortComponents,
      sourceIp: '198.51.100.2',
      zone: 'acme-corp.lan',
      outcome: { verdict: 'transferred', records: 12 },
    });

    expect(line).toBe(
      "03-Nov-2026 09:07:05.007 client 198.51.100.2 (acme-corp.lan): transfer of 'acme-corp.lan/IN': AXFR ended: 12 records",
    );
  });
});
