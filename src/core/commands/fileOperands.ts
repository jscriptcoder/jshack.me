/**
 * The `<source>... <destination>` operands `cp` and `mv` share, and the rule for
 * where each source lands.
 *
 * Both commands read their operands the same way and refuse the same shapes with the
 * same coreutils sentences, differing only in the name that opens them: the last
 * operand is the destination; several sources need it to be a directory; a source
 * lands inside a destination directory under its own name, or as the destination
 * itself otherwise.
 */

import type { CommandEnv, CommandResult, TerminalLine } from './types.js';
import type { AbsPath } from '../types.js';
import { basename, resolveAbsPath } from '../filesystem/path.js';

/** A path both resolved and as the player typed it: the write goes to one, a
 *  refusal names the other, as coreutils does. */
export type Place = { readonly path: AbsPath; readonly typed: string };

export const childPlace = (parent: Place, name: string): Place => ({
  path: resolveAbsPath(parent.path, name),
  typed: `${parent.typed}${parent.typed.endsWith('/') ? '' : '/'}${name}`,
});

/** Is `path` somewhere beneath the directory `ancestor`? The same path is not: a
 *  source landing on itself is "the same file", which each command asks first. */
export const isBeneath = (path: AbsPath, ancestor: AbsPath): boolean =>
  path !== ancestor && path.startsWith(ancestor === '/' ? '/' : `${ancestor}/`);

export const refusals = (errors: readonly string[]): CommandResult => ({
  kind: 'sync',
  lines: errors.map((content): TerminalLine => ({ kind: 'error', content })),
  exitCode: errors.length === 0 ? 0 : 1,
});

export type Operands = {
  readonly sources: readonly Place[];
  /** Where a given source lands. */
  readonly landingFor: (source: Place) => Place;
};

/** Read the operands, or the refusal the command answers with instead. */
export const readOperands = (
  env: CommandEnv,
  command: string,
  args: readonly string[],
):
  | { readonly ok: true; readonly operands: Operands }
  | { readonly ok: false; readonly refusal: CommandResult } => {
  const typedDestination = args.at(-1);
  if (typedDestination === undefined) {
    return { ok: false, refusal: refusals([`${command}: missing file operand`]) };
  }
  if (args.length === 1) {
    return {
      ok: false,
      refusal: refusals([
        `${command}: missing destination file operand after '${typedDestination}'`,
      ]),
    };
  }

  const placeOf = (typed: string): Place => ({ path: resolveAbsPath(env.fs.cwd(), typed), typed });
  const destination = placeOf(typedDestination);
  const intoDirectory = env.fs.stat(destination.path)?.kind === 'directory';
  const sources = args.slice(0, -1).map(placeOf);
  if (sources.length > 1 && !intoDirectory) {
    return {
      ok: false,
      refusal: refusals([`${command}: target '${typedDestination}' is not a directory`]),
    };
  }

  return {
    ok: true,
    operands: {
      sources,
      landingFor: (source) =>
        intoDirectory ? childPlace(destination, basename(source.path)) : destination,
    },
  };
};
