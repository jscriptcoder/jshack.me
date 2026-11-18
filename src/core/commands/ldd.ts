/**
 * ldd — print the shared libraries a command links.
 *
 * `ldd <name-or-path>`. An argument containing a `/` is a path, taken literally
 * against the cwd; a bare name resolves through the same search path the shell
 * uses, as a convenience real `ldd` does not offer. Only the first argument is
 * inspected.
 *
 * What a binary links comes from `libraryDeps`, the same map that makes a
 * command fail to start when a library is missing — so what `ldd` shows and
 * what actually breaks can never disagree. The map is looked up by the tool
 * the binary's content names, never its file name, so a renamed copy answers
 * for what it is.
 *
 * A binary the map does not list prints real `ldd`'s `not a dynamic
 * executable`, and a binary that is not on the box never reaches the map.
 * A missing library still exits 0: that is real `ldd`, which reports the
 * gap rather than failing on it.
 *
 * Load addresses are stable per library rather than randomised as they are on
 * real Linux, so the output is deterministic.
 */

import type { SystemLibrary } from '../generation/libraries.js';
import { stubName } from '../generation/binaries.js';
import type { AbsPath } from '../types.js';
import { binaryPathFor, libraryDeps, resolveLibrary } from './libraryDeps.js';
import type { Command, CommandEnv, CommandResult } from './types.js';

const failure = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode: 1,
});

/** A plausible 12-hex-digit address derived from the library name. */
const fakeLoadAddress = (library: string): string => {
  let hash = 0x7f000000;
  for (let index = 0; index < library.length; index++) {
    hash = (hash * 33 + library.charCodeAt(index)) >>> 0;
  }
  return `(0x${hash.toString(16).padStart(12, '0')})`;
};

const formatLine = (env: CommandEnv, library: SystemLibrary, binaryPath: AbsPath): string => {
  const path = resolveLibrary(env, library, binaryPath);
  const resolution = path === null ? 'not found' : `${path} ${fakeLoadAddress(library)}`;
  return `\t${library}.so => ${resolution}`;
};

const execute: Command['execute'] = async (env, args) => {
  const arg = args[0];
  if (arg === undefined) return failure('ldd: missing file arguments');

  // A path taken literally, a bare name searched — the way the shell finds it.
  const binaryPath = binaryPathFor(env, arg);
  const node = binaryPath === null ? null : env.fs.stat(binaryPath);
  if (binaryPath === null || node === null) {
    return failure(`ldd: ${arg}: No such file or directory`);
  }
  if (node.kind !== 'file') return failure(`ldd: ${arg}: not regular file`);

  const tool = stubName(node.content);
  // `hasOwn`, because content is written by players and `libraryDeps` is a plain
  // object: a stub naming `constructor` must not read a prototype member.
  const deps = tool !== null && Object.hasOwn(libraryDeps, tool) ? libraryDeps[tool] : undefined;
  if (deps === undefined) {
    return {
      kind: 'sync',
      lines: [{ kind: 'text', content: '\tnot a dynamic executable' }],
      exitCode: 1,
    };
  }
  return {
    kind: 'sync',
    lines: deps.map((library) => ({
      kind: 'text',
      content: formatLine(env, library, binaryPath),
    })),
    exitCode: 0,
  };
};

export const ldd: Command = {
  name: 'ldd',
  description: 'Print the shared libraries a command links',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'ldd <command-or-path>',
    description:
      'List the shared libraries a binary links and where each resolves: /lib first, then the directory the binary itself sits in. A library found in neither shows as "not found", which is also why the command itself will refuse to start. A bare name is looked up in /bin, /usr/bin and /usr/sbin; anything with a slash is taken as a path.',
    arguments: [
      {
        name: 'command-or-path',
        description: 'A command name or the path to a binary',
        required: true,
      },
    ],
    examples: [
      { command: 'ldd su', description: 'Show which libraries su depends on' },
      { command: 'ldd /bin/grep', description: 'Inspect a binary by its path' },
    ],
  },
  execute,
};
