/**
 * Shared syslog primitives — the line shape every `/var/log/*` entry is built
 * on, independent of which log file it lands in. Auth events (auth.log) and the
 * kernel iptables port-scan entry (kern.log) both compose these; future service
 * loggers (vsftpd.log/mysql.log/redis.log) reuse them with their own tag.
 *
 * Pure: the timestamp is supplied by the caller (the server's UTC clock), never
 * read from the clock here, so every rendered line is deterministic + testable.
 * Framework-agnostic (core/) — no I/O, no env.
 */

import type { GameTime } from '../types';

const MONTHS = [
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
] as const;

/** Format the leading syslog timestamp `MMM DD HH:MM:SS` (UTC): day space-padded
 *  to width 2, time fields zero-padded. Shared by every syslog-style line —
 *  `service[pid]:` entries (su/sshd) and the pid-less `kernel:` iptables line. */
export const formatSyslogTimestamp = (time: GameTime): string => {
  const date = new Date(time);
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate().toString().padStart(2, ' ');
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  return `${month} ${day} ${hours}:${minutes}:${seconds}`;
};

export type SyslogLineOptions = {
  /** Epoch-ms of the universe clock — the server's UTC time at append. */
  readonly time: GameTime;
  readonly hostname: string;
  readonly service: string;
  readonly pid: number;
  readonly message: string;
};

/** Format a syslog header + message: `MMM DD HH:MM:SS hostname service[pid]: message`.
 *  Day is space-padded to width 2; time fields zero-padded; all UTC. */
export const formatSyslogLine = ({
  time,
  hostname,
  service,
  pid,
  message,
}: SyslogLineOptions): string =>
  `${formatSyslogTimestamp(time)} ${hostname} ${service}[${pid}]: ${message}`;

/** Derive a plausible, deterministic process id (1000–9999) from a numeric seed
 *  (typically `env.now()`). There is no real process model — the pid is cosmetic
 *  syslog realism, so a stable hash of the seed is enough. */
export const derivePid = (seed: number): number => 1000 + (Math.abs(Math.trunc(seed)) % 9000);
