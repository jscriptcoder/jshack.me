/**
 * Shared helpers for commands that read files and emit their content as
 * terminal lines. Used by `cat`, `head`, and any future read-style command
 * (`tail`, `less`, `grep`, …).
 *
 * Behaviour is exercised through each consumer's tests — these helpers
 * have no isolated unit tests per the project's "don't extract for
 * testability" rule. Mutation testing of this file is therefore driven by
 * cat.test.ts and head.test.ts (and friends).
 */

import type { FsReadResult, TerminalLine } from './types';

type FsReadError = Extract<FsReadResult, { readonly ok: false }>['error'];

/** Split file content into output lines, dropping the trailing empty
 *  element that `split('\n')` yields for newline-terminated files (so a
 *  normal file doesn't print a spurious blank line at the end). */
export const toContentLines = (content: string): readonly TerminalLine[] => {
  const segments = content.split('\n');
  const body = segments[segments.length - 1] === '' ? segments.slice(0, -1) : segments;
  return body.map((line) => ({ kind: 'text', content: line }));
};

/** Format a `<cmd>: <target>: <reason>` error line for a failed FS read. */
export const formatReadError = (
  cmd: string,
  target: string,
  error: FsReadError,
): string => {
  switch (error) {
    case 'not_found':
      return `${cmd}: ${target}: No such file or directory`;
    case 'is_directory':
      return `${cmd}: ${target}: Is a directory`;
    case 'permission_denied':
      return `${cmd}: ${target}: Permission denied`;
  }
};
