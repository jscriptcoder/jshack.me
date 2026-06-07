/**
 * Auth-log line formatting — the syslog-style `/var/log/auth.log` entry that
 * `su` writes on a user switch. Ported from legacy `src/logging/formatters.ts`.
 *
 * Format: `MMM DD HH:MM:SS <hostname> su[<pid>]: <message>` (UTC), with the
 * message `Successful su for <target> by <from>` on a switch and `FAILED su for
 * <target> by <from>` on a wrong password — the exact strings the defender
 * reads back via `cat /var/log/auth.log`, matched by the legacy E2E.
 *
 * Pure: the timestamp is supplied by the caller (from `env.gameTime()`), never
 * read from the clock here, so the rendered line is deterministic and testable.
 * Kept framework-agnostic (core/) — the syslog format is reused by future
 * loggers (ssh/ftp/scp) with a different `service` tag.
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

type SyslogLineOptions = {
  /** Epoch-ms of the universe clock (`env.gameTime()`). */
  readonly time: GameTime;
  readonly hostname: string;
  readonly service: string;
  readonly pid: number;
  readonly message: string;
};

/** Format a syslog header + message: `MMM DD HH:MM:SS hostname service[pid]: message`.
 *  Day is space-padded to width 2; time fields zero-padded; all UTC. */
const formatSyslogLine = ({ time, hostname, service, pid, message }: SyslogLineOptions): string => {
  const date = new Date(time);
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate().toString().padStart(2, ' ');
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  return `${month} ${day} ${hours}:${minutes}:${seconds} ${hostname} ${service}[${pid}]: ${message}`;
};

export type SuAuthEvent = {
  readonly outcome: 'success' | 'failure';
  readonly targetUser: string;
  readonly fromUser: string;
  readonly hostname: string;
  readonly time: GameTime;
  readonly pid: number;
};

/** Render an `su` switch as its `/var/log/auth.log` line. */
export const formatSuAuthLine = (event: SuAuthEvent): string =>
  formatSyslogLine({
    time: event.time,
    hostname: event.hostname,
    service: 'su',
    pid: event.pid,
    message:
      event.outcome === 'success'
        ? `Successful su for ${event.targetUser} by ${event.fromUser}`
        : `FAILED su for ${event.targetUser} by ${event.fromUser}`,
  });

/** Derive a plausible, deterministic process id (1000–9999) from a numeric seed
 *  (typically `env.now()`). There is no real process model — the pid is cosmetic
 *  syslog realism, so a stable hash of the seed is enough. */
export const derivePid = (seed: number): number => 1000 + (Math.abs(Math.trunc(seed)) % 9000);
