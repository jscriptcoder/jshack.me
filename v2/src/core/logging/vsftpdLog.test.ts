import { describe, expect, it } from 'vitest';
import { asGameTime } from '../types';
import { VSFTPD_LOG_OWNER, VSFTPD_LOG_PATH, formatVsftpdLoginLine } from './vsftpdLog';

/**
 * vsftpd-log (`/var/log/vsftpd.log`) line formatting — the FTP daemon's own file,
 * in vsftpd's own shape. Not syslog: like `access.log`, this is written by the
 * daemon into its own file rather than handed to syslog, so it carries no hostname
 * and no `service[pid]:` tag. Pure: the timestamp and pid are supplied, so the whole
 * line is assertable.
 *
 * This log is what makes ftp the LOUD door. Reading a file over ssh is silent —
 * nothing logs a `cat` — while the same theft through ftp is itemised. That is what
 * real FTP does, and it is the fair price of ftp being a second way in.
 */

// 2026-08-14 13:55:38 UTC — a Friday, and every component two digits, so padding is
// NOT exercised here.
const AUG_14 = asGameTime(Date.UTC(2026, 7, 14, 13, 55, 38));

describe('the vsftpd log storage identity', () => {
  it('lives at /var/log/vsftpd.log, owned by root', () => {
    // The literal path IS the interface: a defender types it into `cat`, and every
    // other assertion in the suite compares against the constant, so only spelling it
    // out here can catch the file moving.
    expect(VSFTPD_LOG_PATH).toBe('/var/log/vsftpd.log');
    // Owner decides who may write. A log an attacker's tier could own is a log they
    // could rewrite — the record of what they took would be theirs to edit.
    expect(VSFTPD_LOG_OWNER).toBe('root');
  });
});

describe('formatVsftpdLoginLine', () => {
  it('renders an accepted login as OK LOGIN, naming the account and the client', () => {
    const line = formatVsftpdLoginLine({
      outcome: 'success',
      user: 'guest',
      fromIp: '10.0.0.9',
      hostname: 'nas-04',
      time: AUG_14,
      pid: 4471,
    });

    expect(line).toBe('Fri Aug 14 13:55:38 2026 [pid 4471] [guest] OK LOGIN: Client "10.0.0.9"');
  });

  it('renders a rejected login as FAIL LOGIN — the wall a sweep leaves behind', () => {
    const line = formatVsftpdLoginLine({
      outcome: 'failure',
      user: 'guest',
      fromIp: '10.0.0.9',
      hostname: 'nas-04',
      time: AUG_14,
      pid: 4471,
    });

    expect(line).toBe('Fri Aug 14 13:55:38 2026 [pid 4471] [guest] FAIL LOGIN: Client "10.0.0.9"');
  });

  it('never names the host it runs on — a daemon writing its own file has no need to', () => {
    // The one structural difference from auth.log, and the reason `formatSyslogLine`
    // is not reusable here: a syslog line identifies the host and the service, this
    // one identifies neither.
    const line = formatVsftpdLoginLine({
      outcome: 'success',
      user: 'root',
      fromIp: '192.168.1.30',
      hostname: 'workstation-neo',
      time: AUG_14,
      pid: 88,
    });

    expect(line).not.toContain('workstation-neo');
    expect(line).toBe('Fri Aug 14 13:55:38 2026 [pid 88] [root] OK LOGIN: Client "192.168.1.30"');
  });

  it('space-pads a single-digit day and zero-pads the clock, as asctime does', () => {
    // vsftpd stamps `%a %b %e %H:%M:%S %Y`: the day is SPACE-padded (`Jan  5`, two
    // spaces) while the clock is zero-padded. Getting this wrong is invisible until a
    // player reads a log from the first nine days of a month.
    const line = formatVsftpdLoginLine({
      outcome: 'failure',
      user: 'admin',
      fromIp: '10.0.0.2',
      hostname: 'nas-04',
      time: asGameTime(Date.UTC(2026, 0, 5, 4, 7, 9)),
      pid: 12,
    });

    expect(line).toBe('Mon Jan  5 04:07:09 2026 [pid 12] [admin] FAIL LOGIN: Client "10.0.0.2"');
  });
});
