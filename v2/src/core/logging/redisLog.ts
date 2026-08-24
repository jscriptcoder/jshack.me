/**
 * redis-log line formatting — the `/var/log/redis.log` entries the store daemon writes
 * when a client reaches it and when one names a password:
 *
 *     4471:M 20 Aug 2026 09:14:02.000 * Client connected from 10.0.0.9
 *     4472:M 20 Aug 2026 09:14:03.000 * Client 10.0.0.9 authenticated successfully
 *     4473:M 20 Aug 2026 09:14:04.000 # Client 10.0.0.9 authentication failed
 *
 * Two events, one line each — unlike mysql beside it, which collapses them, because
 * the mysql protocol carries credentials in the connect handshake and this one does
 * not. A client here opens a socket first and names a password afterwards, or never.
 *
 * That split is what the arrival line is FOR, and it is the whole of the defender's
 * evidence against a store that asks for no password: with no `AUTH` there is no wall
 * of failures, only one line saying somebody arrived. The stores that are open are
 * also the ones where theft is nearly invisible.
 *
 * The `*` and `#` are real Redis's own severity marks — notice and warning — so the
 * two outcomes are told apart by a character a player who has seen the real thing
 * already reads. `M` is the role field, always master: this world has no replicas.
 *
 * Pure, framework-agnostic (core/): the timestamp and connection id are supplied by
 * the caller.
 */

import { asAbsPath, type AbsPath, type GameTime } from '../types';
import type { FilePermissions } from '../filesystem/types';
import type { CredentialAttempt } from './authLog';

/** The canonical `/var/log/redis.log` storage identity — single source of truth shared
 *  by the boot seed (`generation/remoteHostFs`) and every server-side appender, so the
 *  seeded file and each appended patch agree on path, owner, and perms. World-READABLE
 *  like the other trace files: once you are ON the box any account may read it, and
 *  getting on the box is the gate. Root-only WRITE — the daemon's append models a
 *  system write, so a visitor can never edit away the record of their visit. NOT on the
 *  tier-3 allowlist: you have to get in to read it.
 *
 *  The path is not chosen here so much as read off the box: the conf every store
 *  publishes says `logfile /var/log/redis.log`, and a daemon writing anywhere else
 *  would contradict a file a guest can read. */
export const REDIS_LOG_PATH: AbsPath = asAbsPath('/var/log/redis.log');
export const REDIS_LOG_OWNER = 'root';
export const REDIS_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

const MONTHS: readonly string[] = [
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
];

const padZero = (value: number): string => value.toString().padStart(2, '0');

/** Format redis's own stamp (UTC) — `20 Aug 2026 09:14:02.000`. The day is space-padded
 *  and the milliseconds are always three zeroes: game time has second resolution, and
 *  inventing a millisecond would imply a precision no event here is recorded at. */
const formatRedisTimestamp = (time: GameTime): string => {
  const date = new Date(time);
  const day = date.getUTCDate().toString().padStart(2, ' ');
  const clock = `${padZero(date.getUTCHours())}:${padZero(date.getUTCMinutes())}:${padZero(date.getUTCSeconds())}`;
  return `${day} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${clock}.000`;
};

/** Render a client REACHING the store, before any password is named. On a store that
 *  asks for none this is the only line the visit ever produces. */
export const formatRedisConnectLine = ({
  fromIp,
  time,
  pid,
}: Pick<CredentialAttempt, 'fromIp' | 'time' | 'pid'>): string =>
  `${pid}:M ${formatRedisTimestamp(time)} * Client connected from ${fromIp}`;

/** Render one password attempt as its `/var/log/redis.log` line. It names no account,
 *  because the store has none: the secret belongs to the service, so what the log can
 *  say is who tried and whether they got in. */
export const formatRedisAttemptLine = ({ outcome, fromIp, time, pid }: CredentialAttempt): string =>
  outcome === 'success'
    ? `${pid}:M ${formatRedisTimestamp(time)} * Client ${fromIp} authenticated successfully`
    : `${pid}:M ${formatRedisTimestamp(time)} # Client ${fromIp} authentication failed`;
