/**
 * Access-log line formatting — the `/var/log/access.log` entries a web server writes
 * for every request it serves. Apache Combined Log Format, the shape a player will
 * recognise on sight:
 *
 *     198.51.100.22 - - [30/Jul/2026:13:55:36 +0000] "GET /index.html HTTP/1.1" 200 23
 *
 * Unlike `auth.log` and `kern.log` this is NOT a syslog line — it has no hostname and
 * no `service[pid]:` tag, because it is written by the daemon into its own file rather
 * than handed to syslog. Only the month names are shared. Ported from legacy
 * `src/logging/formatters.ts:formatAccessLog`.
 *
 * A 404 is logged exactly like a 200. That is the point of the file: one miss is a typo,
 * a hundred in a row is somebody walking the document root, and the defender can only
 * tell the difference if the misses are written down.
 *
 * Pure, framework-agnostic (core/): the timestamp is supplied by the caller.
 */

import { asAbsPath, type AbsPath, type GameTime } from '../types';
import type { FilePermissions } from '../filesystem/types';
import { MONTHS } from './syslog';

/** The canonical `/var/log/access.log` storage identity — single source of truth shared
 *  by the boot seed (`generation/workstationFs` + `remoteHostFs` + `routerFs`) and the
 *  server-side appender, so the seeded file and every appended patch agree on path,
 *  owner, and perms. World-READABLE, matching `AUTH_LOG_*`/`KERN_LOG_*`: once you are
 *  ON the box any account may read it, and getting on the box is the gate. Root-only
 *  WRITE — the web server's append models a daemon write, never a player-tier one, so a
 *  visitor can never edit away the record of their visit. */
export const ACCESS_LOG_PATH: AbsPath = asAbsPath('/var/log/access.log');
export const ACCESS_LOG_OWNER = 'root';
export const ACCESS_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

export type AccessLogEvent = {
  readonly time: GameTime;
  /** The requester's resolved source IP (server-derived — see `crossPlayerSourceIp`). */
  readonly sourceIp: string;
  /** The URL path AS REQUESTED, not the file that answered it: a request for a path
   *  that resolved to nothing is exactly the line a defender needs to see. */
  readonly path: string;
  readonly status: number;
  /** Bytes returned; `0` for a response with no body. */
  readonly size: number;
};

/** Format the Apache request timestamp `DD/MMM/YYYY:HH:MM:SS +0000` (UTC). The offset
 *  is literal: the universe clock has no timezones, and Apache always renders one. */
const formatAccessTimestamp = (time: GameTime): string => {
  const date = new Date(time);
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = MONTHS[date.getUTCMonth()];
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}:${hours}:${minutes}:${seconds} +0000`;
};

/** Render one served request as its `/var/log/access.log` line. The two `-` fields are
 *  the identd and HTTP-auth user Apache leaves blank on an unauthenticated request —
 *  which, on this door, is every request. */
export const formatAccessLogLine = ({
  time,
  sourceIp,
  path,
  status,
  size,
}: AccessLogEvent): string =>
  `${sourceIp} - - [${formatAccessTimestamp(time)}] "GET ${path} HTTP/1.1" ${status} ${size}`;
