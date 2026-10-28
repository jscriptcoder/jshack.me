/**
 * talkit-log line formatting — the `/var/log/talkit.log` entry the forum writes for each
 * thread a player starts, and each comment:
 *
 *     2026-10-19 14:37:02 post #12 by neo from 203.0.113.7
 *     2026-10-19 14:52:40 comment #3 on #12 by trinity from 198.51.100.4
 *
 * The forum's own file, not a syslog line: an application log in its own words, stamped
 * in UTC as the forum prints its times, with the seconds a log needs. `access.log` already
 * holds every POST beside the visitor's address; this line ties that address to the
 * handle and the thread or comment, so a root on talkit.io learns who writes from where
 * without matching timestamps by hand. Nothing tells the writer it is written.
 *
 * The handle came from the poster's login, so it goes through `escapeLogField`, as every
 * field a caller typed does. The id and the address are the server's own.
 *
 * Pure, framework-agnostic (core/): the timestamp is supplied by the caller.
 */

import { asAbsPath, type AbsPath, type GameTime } from '../types.js';
import type { FilePermissions } from '../filesystem/types.js';
import { escapeLogField } from './escapeLogField.js';
import { formatAppLogTimestamp } from './appLogTimestamp.js';

/** The canonical `/var/log/talkit.log` storage identity. World-READABLE like the other
 *  trace files, since getting on the box is the gate; root-only WRITE, as the forum's
 *  append is a system write. No boot seed: the file appears with the first post or
 *  comment. */
export const TALKIT_LOG_PATH: AbsPath = asAbsPath('/var/log/talkit.log');
export const TALKIT_LOG_OWNER = 'root';
export const TALKIT_LOG_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

/** The line for a thread that went up: when, which thread, whose handle, from where. */
export const formatTalkitPostLine = (post: {
  readonly time: GameTime;
  readonly id: number;
  readonly handle: string;
  readonly sourceIp: string;
}): string =>
  `${formatAppLogTimestamp(post.time)} post #${post.id} by ${escapeLogField(post.handle)} from ${post.sourceIp}`;

/** The line for a comment that went up: when, which comment on which thread, whose
 *  handle, from where. */
export const formatTalkitCommentLine = (comment: {
  readonly time: GameTime;
  readonly threadId: number;
  readonly number: number;
  readonly handle: string;
  readonly sourceIp: string;
}): string =>
  `${formatAppLogTimestamp(comment.time)} comment #${comment.number} on #${comment.threadId} by ${escapeLogField(comment.handle)} from ${comment.sourceIp}`;
