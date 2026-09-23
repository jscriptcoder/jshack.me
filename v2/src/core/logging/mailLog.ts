/**
 * postfix-log line formatting — the `/var/log/mail.log` entries a mail server writes as
 * it takes a message in, queues it, drops a copy into each mailbox and lets it go:
 *
 *     Jun 18 09:12:04 mx-12 postfix/smtpd[2211]: 3A9F21: client=desktop-14.acme.lan[192.168.4.14]
 *     Jun 18 09:12:04 mx-12 postfix/cleanup[2213]: 3A9F21: message-id=<20260618091204.3A9F21@acme.lan>
 *     Jun 18 09:12:04 mx-12 postfix/qmgr[1180]: 3A9F21: from=<mrodriguez@acme.lan>, size=1832, nrcpt=2 (queue active)
 *     Jun 18 09:12:05 mx-12 postfix/local[2214]: 3A9F21: to=<jchen@acme.lan>, relay=local, status=sent (delivered to mailbox)
 *     Jun 18 09:12:05 mx-12 postfix/qmgr[1180]: 3A9F21: removed
 *
 * postfix logs through syslog, so these are ordinary syslog lines with the daemon that
 * wrote each one in the tag — which is why there is no timestamp of its own here, unlike
 * `mysql.log` and `vsftpd.log` beside it.
 *
 * **The queue id is the message's own.** It is the id the transfer agent stamped, which
 * the delivered copy carries in its `Received:` line and inside its `Message-ID`. So a
 * player who greps one id out of a mailbox finds the very line that put it there, and a
 * log naming a message no mailbox holds would be the box contradicting itself.
 *
 * Real postfix also writes `delay=` and `dsn=` on a delivery. Neither is here: the world
 * keeps time to the second, so hundredths of a second of queue latency would be a
 * precision nothing in the game models — the same reason `mysql.log` stamps `.000000`.
 *
 * Pure, framework-agnostic (core/): every timestamp, pid and id is supplied by the
 * caller.
 */

import type { GameTime } from '../types';
import type { FilePermissions } from '../filesystem/types';
import { formatSyslogLine } from './syslog';

/** `/var/log/mail.log`'s tier. **Root's alone**, unlike every other log on the box: its
 *  lines name who wrote to whom across the whole organisation, which is the same recon
 *  `/var/mail` itself is kept at (`MAIL_SPOOL_DIR`). A world-readable index of the spool
 *  would hand back the escalation the spool charges for. Debian agrees for its own
 *  reason — `mail.log` is `root:adm`, not world-readable like `syslog` beside it. */
export const MAIL_LOG_PERMISSIONS: FilePermissions = {
  read: ['root'],
  write: ['root'],
  execute: ['root'],
};

/** What every line of this file shares: when it was written, the box that wrote it, the
 *  pid of the postfix daemon that wrote it, and the message it is about. */
type PostfixLine = {
  readonly time: GameTime;
  readonly hostname: string;
  readonly pid: number;
  /** The id the transfer agent stamped, which the delivered copy carries. */
  readonly queueId: string;
};

const postfix = (line: PostfixLine, daemon: string, message: string): string =>
  formatSyslogLine({
    time: line.time,
    hostname: line.hostname,
    service: `postfix/${daemon}`,
    pid: line.pid,
    message: `${line.queueId}: ${message}`,
  });

/** Where a message came in from: the sending machine as the server resolved it, and its
 *  address. A message written on the mail server itself comes in over the loopback, which
 *  is what postfix names it. */
export const formatPostfixClientLine = (
  line: PostfixLine & { readonly client: string; readonly clientIp: string },
): string => postfix(line, 'smtpd', `client=${line.client}[${line.clientIp}]`);

/** The id the message carries in its own headers, written down beside the queue id — the
 *  one line that lets a player pair a mailbox against this file. */
export const formatPostfixMessageIdLine = (
  line: PostfixLine & { readonly messageId: string },
): string => postfix(line, 'cleanup', `message-id=<${line.messageId}>`);

/** The message entering the queue: who sent it, how big the file will be, and how many
 *  mailboxes it is bound for. */
export const formatPostfixQueuedLine = (
  line: PostfixLine & {
    readonly from: string;
    readonly size: number;
    readonly recipients: number;
  },
): string =>
  postfix(
    line,
    'qmgr',
    `from=<${line.from}>, size=${line.size}, nrcpt=${line.recipients} (queue active)`,
  );

/** One copy written into one mailbox. `relay=local` is the local delivery agent, which is
 *  the only relay a box that keeps its own spool ever uses. */
export const formatPostfixDeliveredLine = (
  line: PostfixLine & { readonly recipient: string },
): string =>
  postfix(line, 'local', `to=<${line.recipient}>, relay=local, status=sent (delivered to mailbox)`);

/** The message leaving the queue, once every copy is written. */
export const formatPostfixRemovedLine = (line: PostfixLine): string =>
  postfix(line, 'qmgr', 'removed');
