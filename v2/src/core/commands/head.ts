/**
 * head — print the first lines of a file.
 *
 * Behavior:
 * - With a file arg, reads it and prints the first N lines (default 10).
 * - With -n N, prints the first N lines instead.
 * - N must be a non-negative integer string; anything else exits 2.
 * - With no file arg, exits 1 with a usage hint.
 *
 * Multi-file support (with `==> file <==` headers) is deferred — the first
 * positional is used and the rest are currently ignored. No real player
 * needs it yet; revisit when one does.
 *
 * Exit codes:
 *   0 — file read successfully (or N=0 producing no output)
 *   1 — missing file operand, or file unreadable
 *   2 — invalid -n value
 */

import type { Command, CommandEnv, CommandResult } from './types';
import { resolveAbsPath } from '../filesystem/path';
import { formatReadError, toContentLines } from './fsReadHelpers';

const DEFAULT_LINE_COUNT = 10;

type LineCountResult =
  | { readonly ok: true; readonly n: number }
  | { readonly ok: false; readonly raw: string };

/** Accept non-negative integer strings only. `-5`, `5.5`, `foo`, and the
 *  empty string all fail the regex; `5`, `0`, `999` pass.
 *  `raw === true` is unreachable for a `'string'`-typed flag but the union
 *  forces us to discriminate at the type level — see commit notes for the
 *  equivalent-mutant acceptance. */
const parseLineCount = (raw: string | true | undefined): LineCountResult => {
  if (raw === undefined) return { ok: true, n: DEFAULT_LINE_COUNT };
  if (raw === true) return { ok: false, raw: 'true' };
  if (!/^\d+$/.test(raw)) return { ok: false, raw };
  return { ok: true, n: Number.parseInt(raw, 10) };
};

const execute = async (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  const lineCount = parseLineCount(flags.get('-n'));
  if (!lineCount.ok) {
    return {
      kind: 'sync',
      lines: [
        { kind: 'error', content: `head: invalid number of lines: '${lineCount.raw}'` },
      ],
      exitCode: 2,
    };
  }

  if (args.length === 0) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: 'head: missing file operand' }],
      exitCode: 1,
    };
  }

  const arg = args[0];
  const result = env.fs.read(resolveAbsPath(env.fs.cwd(), arg));
  if (!result.ok) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: formatReadError('head', arg, result.error) }],
      exitCode: 1,
    };
  }

  return {
    kind: 'sync',
    lines: toContentLines(result.content).slice(0, lineCount.n),
    exitCode: 0,
  };
};

export const head: Command = {
  name: 'head',
  description: 'Output the first lines of a file',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-n': 'string' },
  manual: {
    synopsis: 'head [-n N] file',
    description:
      'Print the first N lines of the file (default 10). Equivalent to cat for files shorter than N lines.',
    examples: ['head /etc/passwd', 'head -n 5 /var/log/auth.log'],
  },
  execute,
};
