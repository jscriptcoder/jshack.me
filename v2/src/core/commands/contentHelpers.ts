/**
 * Shared content-processing helpers for commands that read file bytes.
 *
 * Per the "consolidate small related helpers" project rule, multiple small
 * pure helpers live in one topic file rather than file-per-helper.
 */

/** Split file content into lines, dropping the trailing empty segment that
 *  `split('\n')` yields for newline-terminated files. A normal file doesn't
 *  produce a spurious blank line at the end; a file with no trailing
 *  newline keeps its final line intact.
 *
 *  Consumers: cat (projects to TerminalLine), grep (filters strings). */
export const splitContentLines = (content: string): readonly string[] => {
  const segments = content.split('\n');
  return segments[segments.length - 1] === '' ? segments.slice(0, -1) : segments;
};
