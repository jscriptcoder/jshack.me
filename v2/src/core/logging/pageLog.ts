/**
 * CUPS page-log line formatting — the `/var/log/cups/page_log` entry the scheduler writes
 * when a job finishes printing, in the format every generated `cupsd.conf` asks for:
 *
 *     Brother_HL-L2350DW sthompson 306 [03/Jul/2026:14:22:05 +0000] total 3 - 192.168.97.252 special-issue.pdf iso_a4_210x297mm one-sided
 *
 * Queue, user, job id, when, the page total, the billing code (`-` where nobody set one),
 * the host the job came from, its title, the paper and the sides.
 *
 * Pure, framework-agnostic (core/): every value is supplied by the caller.
 */

import type { GameTime } from '../types';
import type { FilePermissions } from '../filesystem/types';
import { formatAccessTimestamp } from './accessLog';

/** `/var/log/cups/page_log`'s tier. **Root's alone**: every line names who printed what
 *  from where, which is the spool beside it said again, and the spool is root's. */
export const PAGE_LOG_PERMISSIONS: FilePermissions = {
  read: ['root'],
  write: ['root'],
  execute: [],
};

export type PageLogEvent = {
  readonly queue: string;
  readonly user: string;
  readonly jobId: number;
  readonly time: GameTime;
  readonly pages: number;
  /** The address the job came from, or `localhost`. */
  readonly host: string;
  readonly title: string;
  readonly media: string;
  readonly sides: string;
};

export const formatPageLogLine = (event: PageLogEvent): string =>
  [
    event.queue,
    event.user,
    event.jobId,
    `[${formatAccessTimestamp(event.time)}]`,
    'total',
    event.pages,
    '-',
    event.host,
    event.title,
    event.media,
    event.sides,
  ].join(' ');
