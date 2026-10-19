/**
 * talkit-log line formatting — the `/var/log/talkit.log` entry the forum writes for each
 * thread a player starts:
 *
 *     2026-10-19 14:37:02 post #12 by neo from 203.0.113.7
 *
 * The forum's own file, not a syslog line: an application log in its own words, stamped
 * in UTC as the forum prints its times, with the seconds a log needs. `access.log` already
 * holds every POST beside the visitor's address; this line ties that address to the
 * handle and the thread, so a root on talkit.io learns who posts from where without
 * matching timestamps by hand. Nothing tells the poster it is written.
 *
 * The handle came from the poster's login, so it goes through `escapeLogField`, as every
 * field a caller typed does. The id and the address are the server's own.
 *
 * Pure, framework-agnostic (core/): the timestamp is supplied by the caller.
 */

import { asAbsPath, type AbsPath, type GameTime } from '../types.js';
import type { FilePermissions } from '../filesystem/types.js';
import { escapeLogField } from './escapeLogField.js';

/** The canonical `/var/log/talkit.log` storage identity. World-READABLE like the other
 *  trace files, since getting on the box is the gate; root-only WRITE, as the forum's
 *  append is a system write. No boot seed: the file appears with the first post. */
export const TALKIT_LOG_PATH: AbsPath = asAbsPath('/var/log/talkit.log');
export const TALKIT_LOG_OWNER = 'root';
export const TALKIT_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

const padZero = (value: number): string => value.toString().padStart(2, '0');

/** `2026-10-19 14:37:02`, in UTC. */
const formatTalkitTimestamp = (time: GameTime): string => {
  const date = new Date(time);
  const day = `${date.getUTCFullYear()}-${padZero(date.getUTCMonth() + 1)}-${padZero(date.getUTCDate())}`;
  return `${day} ${padZero(date.getUTCHours())}:${padZero(date.getUTCMinutes())}:${padZero(date.getUTCSeconds())}`;
};

/** The line for a thread that went up: when, which thread, whose handle, from where. */
export const formatTalkitPostLine = (post: {
  readonly time: GameTime;
  readonly id: number;
  readonly handle: string;
  readonly sourceIp: string;
}): string =>
  `${formatTalkitTimestamp(post.time)} post #${post.id} by ${escapeLogField(post.handle)} from ${post.sourceIp}`;
