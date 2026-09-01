/**
 * The filesystem, as a script can reach it.
 *
 * Three methods, all awaited, because writes are a server round trip and a
 * `readFileSync` beside a `writeFile` that could not be synchronous would teach
 * two rules where the language has one: everything in a script is awaited.
 *
 * There is no `exists`, no `readdir`, no `mkdir` and no `stat`. The first is the
 * only one that could honestly be synchronous, so it would be the single
 * exception to that rule — and a `readFile` in a try/catch already answers the
 * question. The rest are commands the script can already call.
 */

import type { CommandEnv, FsReadResult, PatchResult } from '../commands/types';
import { PATCH_ERROR_REASON } from '../commands/types';
import { resolveAbsPath } from '../filesystem/path';
import { resolveWriteTarget } from '../filesystem/writeTarget';
import { formatScriptValue } from './format';
import { shellError } from './commandContext';

type FsReadError = Extract<FsReadResult, { readonly ok: false }>['error'];

/** What `node` says about a filesystem error — whether it is the script it could
 *  not open or a file the script itself could not read.
 *
 *  ONE voice for both, which is why this lives here rather than inside the
 *  command: a player who mistypes a path at `node` and a player who mistypes one
 *  inside their script have made the same mistake, and a box that answered it
 *  two ways would be teaching two vocabularies for one event.
 *
 *  Thrown as a `shellError`, so `node` prints it BARE. `Error: node: x: No such
 *  file or directory` would tell the player their script went wrong when what
 *  went wrong is the file — the same reason a refusal is printed bare. */
export const formatNodeFsError = (target: string, error: FsReadError): string => {
  switch (error) {
    case 'not_found':
      return `node: ${target}: No such file or directory`;
    case 'is_directory':
      return `node: ${target}: Is a directory`;
    case 'permission_denied':
      return `node: ${target}: Permission denied`;
  }
};

/** A patch that did not land is not a saved file, and a script told nothing
 *  would carry on composing a report that will never exist. The sentence is
 *  the shared one every command uses for the same failure; only the name in
 *  front of it is ours. */
const orThrow = (path: string, written: PatchResult): void => {
  if (!written.ok) {
    throw shellError(`node: ${path}: ${PATCH_ERROR_REASON[written.error]}`);
  }
};

export type ScriptFs = {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, data: unknown) => Promise<void>;
  readonly appendFile: (path: string, data: unknown) => Promise<void>;
};

export const buildFsApi = (env: CommandEnv): ScriptFs => ({
  readFile: async (path) => {
    const result = env.fs.read(resolveAbsPath(env.fs.cwd(), path));
    if (!result.ok) {
      throw shellError(formatNodeFsError(path, result.error));
    }
    return result.content;
  },

  writeFile: async (path, data) => {
    const resolved = resolveWriteTarget(env.fs, path);
    if (!resolved.ok) {
      throw shellError(formatNodeFsError(path, resolved.error));
    }
    // The same formatter `console.log` uses, so a value a script printed and a
    // value it saved can never render two different ways. A `string[]` joins
    // with newlines and gains no trailing one, which is byte-for-byte what the
    // `>` redirect writes for the same command output.
    orThrow(
      path,
      await env.patches.write(resolved.target, formatScriptValue(data), {
        isNew: resolved.isNew,
      }),
    );
  },

  appendFile: async (path, data) => {
    // An append is a read-modify-write, so it is asked of the MACHINE, never of
    // the tree this client is holding. That distinction is the whole of
    // `FsView.reload()`: a whole-file write composed from the cached copy does
    // not merely miss a write that landed after this client pulled — it REVERTS
    // it. On any box a fellow occupant can reach, a sweep adding one line per
    // host is exactly the shape that would erase somebody else's edit.
    const machine = await env.fs.reload();

    const resolved = resolveWriteTarget(machine, path);
    if (!resolved.ok) {
      throw shellError(formatNodeFsError(path, resolved.error));
    }

    // An absent file is the ordinary first-line case, not a failure: the first
    // append is what creates it. Anything else is, and a script told nothing
    // would go on appending to a file it never read.
    const existing = machine.read(resolved.target);
    if (!existing.ok && existing.error !== 'not_found') {
      throw shellError(formatNodeFsError(path, existing.error));
    }
    const base = existing.ok ? existing.content : '';

    // Nothing is inserted between the two. The existing file's own trailing
    // newline is what puts the addition on its own row, exactly as real
    // `appendFile` behaves; a seam that guessed would corrupt a file whose
    // format is not line-oriented.
    //
    // Naming the base is what turns a silent revert into a refusal: the server
    // compares its hash against the row a reader would materialize, so a write
    // that landed in the window between the reload and here is answered
    // `modified_since_open` rather than flattened. The script hears it and can
    // retry; the other occupant's edit stays. That is the opposite posture to
    // the daemons' own log appender, which names no base — a dropped log line is
    // worse than a raced one for a defender's evidence, and a player's loot file
    // is not that.
    orThrow(
      path,
      await env.patches.write(resolved.target, `${base}${formatScriptValue(data)}`, {
        isNew: resolved.isNew,
        baseContent: base,
      }),
    );
  },
});
