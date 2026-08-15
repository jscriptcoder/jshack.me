/**
 * vsftpd-log line formatting — the `/var/log/vsftpd.log` entries the FTP daemon
 * writes for every login and every transfer:
 *
 *     Fri Aug 14 13:55:38 2026 [pid 4471] [guest] OK LOGIN: Client "10.0.0.9"
 *
 * Like `access.log` and unlike `auth.log`, this is NOT a syslog line: the daemon
 * writes its own file rather than handing the entry to syslog, so there is no
 * hostname and no `service[pid]:` tag. `formatSyslogLine` is therefore not reusable
 * here — the timestamp is a different shape too (asctime, with the year at the end).
 * Only `MONTHS` is shared, exactly as `access.log` shares it.
 *
 * This file is what makes ftp the LOUD door. Reading a file over ssh is silent —
 * no command logs a `cat` — so the same theft is invisible through one door and
 * itemised through the other. That is what real FTP does, and it is the fair price
 * of ftp being a second way in: the defender learns WHAT was taken, which is a
 * signal ssh cannot give.
 *
 * Pure, framework-agnostic (core/): the timestamp and pid are supplied by the caller.
 */

import { asAbsPath, type AbsPath, type GameTime } from '../types';
import type { FilePermissions } from '../filesystem/types';
import type { CredentialAttempt } from './authLog';
import { MONTHS } from './syslog';

/** The canonical `/var/log/vsftpd.log` storage identity — single source of truth shared
 *  by the boot seed (`generation/remoteHostFs`) and every server-side appender, so the
 *  seeded file and each appended patch agree on path, owner, and perms. World-READABLE,
 *  matching the other trace files: once you are ON the box any account may read it, and
 *  getting on the box is the gate. Root-only WRITE — the daemon's append models a system
 *  write, never a player-tier one, so a visitor can never edit away the record of their
 *  visit. NOT on the tier-3 allowlist: you have to get in to read it. */
export const VSFTPD_LOG_PATH: AbsPath = asAbsPath('/var/log/vsftpd.log');
export const VSFTPD_LOG_OWNER = 'root';
export const VSFTPD_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const padZero = (value: number): string => value.toString().padStart(2, '0');

/** Format vsftpd's `%a %b %e %H:%M:%S %Y` stamp (UTC) — `Fri Aug 14 13:55:38 2026`.
 *  The day is SPACE-padded and the clock zero-padded, as asctime renders them; the
 *  difference only shows on the first nine days of a month. */
const formatVsftpdTimestamp = (time: GameTime): string => {
  const date = new Date(time);
  const weekday = WEEKDAYS[date.getUTCDay()];
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate().toString().padStart(2, ' ');
  const clock = `${padZero(date.getUTCHours())}:${padZero(date.getUTCMinutes())}:${padZero(date.getUTCSeconds())}`;
  return `${weekday} ${month} ${day} ${clock} ${date.getUTCFullYear()}`;
};

/** Render one login attempt as its `/var/log/vsftpd.log` line — `OK LOGIN` for an
 *  accepted credential, `FAIL LOGIN` for a rejected one (real vsftpd logs both, which
 *  is what turns a wordlist sweep into a visible wall). */
export const formatVsftpdLoginLine = ({
  outcome,
  user,
  fromIp,
  time,
  pid,
}: CredentialAttempt): string =>
  `${formatVsftpdTimestamp(time)} [pid ${pid}] [${user}] ${outcome === 'success' ? 'OK' : 'FAIL'} LOGIN: Client "${fromIp}"`;
