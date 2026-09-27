/**
 * dpkg-log line formatting — the `/var/log/dpkg.log` entry a box keeps when a package is
 * rolled BACKWARDS onto an older release:
 *
 *     2026-08-14 13:56:02 downgrade redis 7.9.7 7.2.5 Client "203.0.113.199"
 *
 * Like `access.log` and `vsftpd.log`, and unlike `auth.log`, this is NOT a syslog line:
 * dpkg writes its own file rather than handing the entry to syslog, so there is no
 * hostname and no `service[pid]:` tag. `formatSyslogLine` is therefore not reusable here,
 * and neither is any existing timestamp — dpkg's stamp is `YYYY-MM-DD HH:MM:SS`, a shape
 * no other log in this game uses. Each log module owns its own stamp for exactly this
 * reason; sharing one would make every daemon's format hostage to the others.
 *
 * The `Client "ip"` field is a deliberate hybrid. Real `dpkg.log` names no address,
 * because real dpkg is never run by a stranger — here it can be, and a record of a
 * downgrade that does not say who did it answers the wrong half of the owner's question.
 * The field is spelled exactly as the vsftpd exploit lines spell it, so a player who has
 * read one log meets a familiar column in a new file. Nothing in this game PARSES a log —
 * the defender reads with `cat` — so one line in one file beats a more faithful pair of
 * files the reader would have to correlate.
 *
 * No architecture column, though real dpkg writes `redis:amd64`. The manifest that every
 * scan and exploit reads names `Package`, `Status` and `Version` and nothing else, so an
 * arch here would be the only token in the line that no other part of the world could
 * corroborate.
 *
 * Pure, framework-agnostic (core/): the timestamp is supplied by the caller.
 */

import { asAbsPath, type AbsPath, type GameTime } from '../types';
import type { FilePermissions } from '../filesystem/types';

/** The canonical `/var/log/dpkg.log` storage identity — single source of truth shared by
 *  every server-side appender, so each appended patch agrees on path, owner and perms.
 *  World-READABLE, matching the other trace files: the owner reads this after something
 *  went wrong and may not be sitting as root, and a record its own reader cannot open is
 *  no record at all. Root-only WRITE — the downgrade is a system action, so a visitor who
 *  reached user or guest can never edit away the note the box took of them. */
export const DPKG_LOG_PATH: AbsPath = asAbsPath('/var/log/dpkg.log');
export const DPKG_LOG_OWNER = 'root';
export const DPKG_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

const padZero = (value: number): string => value.toString().padStart(2, '0');

/** Format dpkg's `%Y-%m-%d %H:%M:%S` stamp (UTC) — `2026-08-14 13:56:02`. Every field is
 *  zero-padded, including the month and day: dpkg's log is read in file order, and a
 *  ragged left edge is what makes a long one unreadable. */
const formatDpkgTimestamp = (time: GameTime): string => {
  const date = new Date(time);
  const day = `${date.getUTCFullYear()}-${padZero(date.getUTCMonth() + 1)}-${padZero(date.getUTCDate())}`;
  const clock = `${padZero(date.getUTCHours())}:${padZero(date.getUTCMinutes())}:${padZero(date.getUTCSeconds())}`;
  return `${day} ${clock}`;
};

/** One package moving backwards, from the BOX's point of view — which is whose log this
 *  is. `fromIp` keeps the name every other log module gives the actor's address, rather
 *  than avoiding the echo with `fromVersion`: consistency across the log modules is worth
 *  more than reading prettily in this one. */
export type PackageDowngrade = {
  readonly packageName: string;
  /** The release the box was on. Written first, as dpkg writes it. */
  readonly fromVersion: string;
  /** The older release it landed on. */
  readonly toVersion: string;
  /** The client's source address, server-derived on every cross-player path. */
  readonly fromIp: string;
  readonly time: GameTime;
};

/** Render one downgrade as its `/var/log/dpkg.log` line.
 *
 *  Old version then new, because that is dpkg's column order and because it is the order
 *  that tells the owner which WAY the box moved: reversed, the same two numbers describe
 *  an upgrade, and the record would mean the opposite of what happened.
 *
 *  One shape for every downgrade, whoever ran it — there is nothing here to branch on.
 *  An owner who knows what their own address looks like in this file is the one equipped
 *  to notice an address that is not theirs. */
export const formatPackageDowngradeLine = ({
  packageName,
  fromVersion,
  toVersion,
  fromIp,
  time,
}: PackageDowngrade): string =>
  `${formatDpkgTimestamp(time)} downgrade ${packageName} ${fromVersion} ${toVersion} Client "${fromIp}"`;
