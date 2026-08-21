/**
 * mysql-log line formatting — the `/var/log/mysql.log` entries the database daemon
 * writes for every connection it accepts and every one it turns away:
 *
 *     2026-08-20T09:14:02.000000Z	4471 Connect	readonly@10.0.0.9 on shop_prod using TCP/IP
 *     2026-08-20T09:14:03.000000Z	4472 Connect	Access denied for user 'root'@'10.0.0.9' (using password: YES)
 *
 * Like `vsftpd.log` and unlike `auth.log`, the daemon writes its own file rather
 * than handing the entry to syslog, so there is no hostname and no `service[pid]:`
 * tag. The timestamp is a third shape again — mysql's own ISO-with-microseconds —
 * so nothing here is shared with the other two formatters beyond the idea.
 *
 * The accepted line names the DATABASE, which the refused line cannot: a client
 * that never authenticated was never told which database it would have reached.
 * That difference is the defender's most useful signal — a wall of denials followed
 * by one Connect naming a database is a sweep that landed.
 *
 * Pure, framework-agnostic (core/): the timestamp and connection id are supplied by
 * the caller.
 */

import { asAbsPath, type AbsPath, type GameTime } from '../types';
import type { FilePermissions } from '../filesystem/types';
import type { CredentialAttempt } from './authLog';

/** The canonical `/var/log/mysql.log` storage identity — single source of truth shared
 *  by the boot seed (`generation/remoteHostFs`) and every server-side appender, so the
 *  seeded file and each appended patch agree on path, owner, and perms. World-READABLE
 *  like the other trace files: once you are ON the box any account may read it, and
 *  getting on the box is the gate. Root-only WRITE — the daemon's append models a
 *  system write, so a visitor can never edit away the record of their visit. NOT on the
 *  tier-3 allowlist: you have to get in to read it. */
export const MYSQL_LOG_PATH: AbsPath = asAbsPath('/var/log/mysql.log');
export const MYSQL_LOG_OWNER = 'root';
export const MYSQL_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

const padZero = (value: number): string => value.toString().padStart(2, '0');

/** Format mysql's own stamp (UTC) — `2026-08-20T09:14:02.000000Z`. The fractional
 *  part is always six zeroes: game time has second resolution, and inventing
 *  microseconds would imply a precision no event here is recorded at. */
const formatMysqlTimestamp = (time: GameTime): string => {
  const date = new Date(time);
  const day = `${date.getUTCFullYear()}-${padZero(date.getUTCMonth() + 1)}-${padZero(date.getUTCDate())}`;
  const clock = `${padZero(date.getUTCHours())}:${padZero(date.getUTCMinutes())}:${padZero(date.getUTCSeconds())}`;
  return `${day}T${clock}.000000Z`;
};

/**
 * Render what one statement did, for the daemon's own log.
 *
 * `Query` is what real MySQL's general log calls a statement it ran, and it carries
 * the statement — normalized upstream, so there is no forging a second line and no
 * faking these tab-delimited columns with a player's own text. `Denied` is this
 * game's, for a write an account was not allowed to run: mysql itself would put that
 * in the error log, and this box keeps one file.
 *
 * A refusal carries the message without the error code the client was shown, the same
 * split `Access denied` already makes above — the log says what happened, the client
 * is told which error it was.
 */
export const formatMysqlStatementLine = ({
  time,
  pid,
  tag,
  detail,
}: {
  readonly time: GameTime;
  readonly pid: number;
  readonly tag: 'Query' | 'Denied';
  readonly detail: string;
}): string => `${formatMysqlTimestamp(time)}\t${pid} ${tag}\t${detail}`;

/** Render an accepted connection, naming the database the client reached. */
export const formatMysqlConnectLine = ({
  user,
  fromIp,
  time,
  pid,
  database,
}: Pick<CredentialAttempt, 'user' | 'fromIp' | 'time' | 'pid'> & {
  readonly database: string;
}): string =>
  `${formatMysqlTimestamp(time)}\t${pid} Connect\t${user}@${fromIp} on ${database} using TCP/IP`;

/** Render one credential attempt as its `/var/log/mysql.log` line. A refusal names no
 *  database, for the reason in the module docstring; an acceptance IS the connect line
 *  above, naming the database the credential opened. */
export const formatMysqlAttemptLine = ({
  outcome,
  user,
  fromIp,
  time,
  pid,
  database,
}: CredentialAttempt): string =>
  outcome === 'success'
    ? // One shape for an accepted connection, not two: a sweep that opens an account
      // and a client that opens one are the same event to the daemon writing this file.
      // The fallback is never taken — a door with no database has no accounts to
      // accept, so a success here always arrived with one.
      formatMysqlConnectLine({ user, fromIp, time, pid, database: database ?? '' })
    : `${formatMysqlTimestamp(time)}\t${pid} Connect\tAccess denied for user '${user}'@'${fromIp}' (using password: YES)`;
