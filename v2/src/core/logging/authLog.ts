/**
 * Auth-log line formatting — the syslog-style `/var/log/auth.log` entries that
 * `su` (user switch) and `sshd` (login attempt) write. Ported from legacy
 * `src/logging/formatters.ts`.
 *
 * Format: `MMM DD HH:MM:SS <hostname> <service>[<pid>]: <message>` (UTC) — e.g.
 * `Successful su for <target> by <from>` / `FAILED su for …` and `Accepted
 * password for <user> from <ip>` / `Failed password …` — the exact strings the
 * defender reads back via `cat /var/log/auth.log`, matched by the legacy E2E.
 *
 * The syslog line shape itself lives in `./syslog` (shared with kern.log and
 * future service logs); this module owns only the auth.log identity + messages.
 */

import { asAbsPath, type AbsPath } from '../types';
import type { FilePermissions } from '../filesystem/types';
import { formatSyslogLine } from './syslog';
import type { GameTime } from '../types';

/** The canonical `/var/log/auth.log` storage identity — single source of truth
 *  shared by the boot seed (`generation/workstationFs`) and the server-side
 *  appender (`patches/appendAuthLog`), so the seeded file and every appended
 *  patch agree on path, owner, and perms. World-READABLE (the defender can
 *  `cat` it) but root-only WRITE: `su`'s append models a setuid-root syslog
 *  write, never a player-tier one. */
export const AUTH_LOG_PATH: AbsPath = asAbsPath('/var/log/auth.log');
export const AUTH_LOG_OWNER = 'root';
export const AUTH_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
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

export type SshdAuthEvent = {
  readonly outcome: 'success' | 'failure';
  readonly user: string;
  /** The client's source address (the player's LAN IP for a same-LAN ssh). */
  readonly fromIp: string;
  readonly hostname: string;
  readonly time: GameTime;
  readonly pid: number;
};

/** Render an ssh login attempt as the REMOTE host's `/var/log/auth.log` line —
 *  `Accepted password for <user> from <ip>` on success, `Failed password …` on a
 *  rejected credential (real sshd logs both). Same syslog core as `su`; the
 *  `sshd` service tag is the only structural difference, so future service
 *  loggers (ftp/nc/mysql/redis) follow this exact shape. */
export const formatSshdAuthLine = (event: SshdAuthEvent): string =>
  formatSyslogLine({
    time: event.time,
    hostname: event.hostname,
    service: 'sshd',
    pid: event.pid,
    message:
      event.outcome === 'success'
        ? `Accepted password for ${event.user} from ${event.fromIp}`
        : `Failed password for ${event.user} from ${event.fromIp}`,
  });
