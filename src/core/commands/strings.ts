/**
 * strings — print the runs of readable text inside a file.
 *
 * `strings <file>`, with the real tool's default four-character minimum fixed
 * rather than exposed as a flag, per the house style for argument surfaces.
 *
 * Newline and tab count as printable alongside the visible ASCII range, so a
 * text file comes back as itself rather than as one line per paragraph. That
 * makes a run potentially multi-line, and each run is therefore split before it
 * leaves: a `TerminalLine` is one line by contract, and a piped
 * `strings f | grep x` reads lines, so a single line carrying embedded
 * newlines would hand `grep` the whole file as one string.
 */

import type { Command, CommandEnv, CommandResult, FsReadResult } from './types';
import { resolveAbsPath } from '../filesystem/path';
import { splitContentLines } from './contentHelpers';

/** The real tool's default. Fixed, not configurable — a shorter minimum buries
 *  anything worth reading under two-byte coincidences. */
const MIN_RUN_LENGTH = 4;

const isPrintable = (code: number): boolean =>
  (code >= 32 && code <= 126) || code === 10 || code === 9;

/** Split content into runs of printable characters, keeping those long enough
 *  to be words. Each run is trimmed, which is what silences field padding —
 *  the longest runs in a binary are usually spaces, and four of them are four
 *  printable characters and no information. A run that trims away to nothing
 *  contributes no lines, so it needs no discarding of its own. */
const readableRuns = (content: string): readonly string[] => {
  const runs: string[] = [];
  let current = '';

  for (let index = 0; index < content.length; index++) {
    if (isPrintable(content.charCodeAt(index))) {
      current += content[index];
      continue;
    }
    if (current.length >= MIN_RUN_LENGTH) runs.push(current.trim());
    current = '';
  }
  if (current.length >= MIN_RUN_LENGTH) runs.push(current.trim());

  return runs;
};

type ReadError = Extract<FsReadResult, { readonly ok: false }>['error'];

/** Unquoted paths, matching legacy and matching `cat` — `find` and `grep`
 *  quote theirs. Two dialects in one shell is odd, and it is what a player
 *  already reads today, so the odd part is not this command. */
const formatReadError = (target: string, error: ReadError): string => {
  switch (error) {
    case 'not_found':
      return `strings: ${target}: No such file or directory`;
    case 'is_directory':
      return `strings: ${target}: Is a directory`;
    case 'permission_denied':
      return `strings: ${target}: Permission denied`;
  }
};

const refusal = (message: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content: message }],
  exitCode: 1,
});

const execute = async (env: CommandEnv, args: readonly string[]): Promise<CommandResult> => {
  const [fileArg] = args;
  if (fileArg === undefined) {
    return refusal('strings: missing file operand');
  }

  const read = env.fs.read(resolveAbsPath(env.fs.cwd(), fileArg));
  if (!read.ok) {
    // Named as the player typed it, not as it resolved: a mistyped relative
    // path is their typo, not the shell standing somewhere unexpected.
    return refusal(formatReadError(fileArg, read.error));
  }

  return {
    kind: 'sync',
    lines: readableRuns(read.content)
      .flatMap((run) => splitContentLines(run))
      .map((content) => ({ kind: 'text', content })),
    exitCode: 0,
  };
};

export const strings: Command = {
  name: 'strings',
  description: 'Extract printable strings from a file',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'strings <file>',
    description:
      'Print the runs of printable characters in a file, one per line, ignoring anything shorter than four characters. Newlines and tabs count as printable, so a text file reads back as itself while a binary gives up only the fragments of text inside it. The minimum is fixed at four, the same default the real tool uses.',
    arguments: [{ name: 'file', description: 'The file to scan', required: true }],
    examples: [
      { command: 'strings /bin/ls', description: 'Read the text buried in a binary' },
      {
        command: 'strings /etc/passwd',
        description: 'Read a text file, which comes back unchanged',
      },
      {
        command: 'strings /usr/bin/nmap | grep lib',
        description: 'Search what a binary has to say for itself',
      },
    ],
  },
  execute,
};
