/**
 * Log-read fakes — what a system log append reads before it writes: every writer's
 * copy of the log at one path on one machine.
 *
 *     readLog: async () => logRead('an earlier line\n'),
 *
 * The defaults stand for the log's own copy, written before anything a test adds.
 */

import type { ListPathPatchesResult, PathPatchRow } from '../../core/patches/upsertPatch.js';

export const logRow = (over: Partial<PathPatchRow> = {}): PathPatchRow => ({
  content: '',
  updated_at: '2026-01-01T00:00:00.000000+00:00',
  writer_key: 'the-log-owner',
  ...over,
});

/** A successful read of a log held as ONE copy with `content` — `null` is a deleted log. */
export const logRead = (content: string | null): ListPathPatchesResult => ({
  data: [logRow({ content })],
  error: null,
});
