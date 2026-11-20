/**
 * mv — move or rename files and directories on the box the shell stands on,
 * through the server-backed `PatchApi`.
 *
 * A move is a rename: what moves keeps its permissions (and, for a node landing
 * where nothing stood, its owner), and the shell needs write on the directory the
 * source leaves and the one it lands in — never read on the moved files, which a
 * rename does not open. So the content comes from `stat`, not `read`.
 *
 * The patch model has no rename, so a move is the tree written at its new path,
 * parents first, and the source removed LAST: a write that fails part-way leaves
 * the source whole, with at worst a partial copy beside it. A directory is created
 * and then given its own permissions and owner, because `mkdir` alone stamps the
 * shell's defaults.
 *
 * Every check runs against the live (patched) `fs` view before the first write,
 * and every refusal names the path as the player typed it, as coreutils does.
 */

import { PATCH_ERROR_REASON, type Command, type CommandEnv, type CommandResult } from './types.js';
import type { AbsPath } from '../types.js';
import type { FileNode, FilePermissions } from '../filesystem/types.js';
import { dirname, resolveAbsPath } from '../filesystem/path.js';
import { isBeneath, readOperands, refusals, type Place } from './fileOperands.js';

/** One node of the moved tree as it must stand at its new path. */
type Placement = {
  readonly path: AbsPath;
  readonly node: FileNode;
};

/** The moved tree, parents before children, so a replay builds it top down. */
const placementsOf = (node: FileNode, path: AbsPath): readonly Placement[] =>
  node.kind === 'file'
    ? [{ path, node }]
    : [
        { path, node },
        ...[...node.entries].flatMap(([name, entry]) =>
          placementsOf(entry, resolveAbsPath(path, name)),
        ),
      ];

const place = async (env: CommandEnv, { path, node }: Placement) => {
  const terms: { readonly owner: string; readonly permissions: FilePermissions } = {
    owner: node.owner,
    permissions: node.perms,
  };
  if (node.kind === 'file') {
    return env.patches.write(path, node.content, {
      ...terms,
      ...(env.fs.stat(path) === null ? { isNew: true } : {}),
    });
  }
  const made = await env.patches.mkdir(path);
  if (!made.ok) return made;
  return env.patches.setDirectoryPermissions(path, terms.permissions, { owner: terms.owner });
};

const moveOne = async (env: CommandEnv, source: Place, landing: Place): Promise<string | null> => {
  const node = env.fs.stat(source.path);
  if (node === null) return `mv: cannot stat '${source.typed}': No such file or directory`;

  if (landing.path === source.path) {
    return `mv: '${source.typed}' and '${landing.typed}' are the same file`;
  }
  if (node.kind === 'directory' && isBeneath(landing.path, source.path)) {
    return `mv: cannot move '${source.typed}' to a subdirectory of itself, '${landing.typed}'`;
  }
  const existing = env.fs.stat(landing.path);
  if (existing?.kind === 'directory' && node.kind === 'file') {
    return `mv: cannot overwrite directory '${landing.typed}' with non-directory`;
  }
  if (existing?.kind === 'file' && node.kind === 'directory') {
    return `mv: cannot overwrite non-directory '${landing.typed}' with directory '${source.typed}'`;
  }

  const cannotMove = (reason: string) =>
    `mv: cannot move '${source.typed}' to '${landing.typed}': ${reason}`;
  const landingParent = env.fs.stat(dirname(landing.path));
  if (landingParent === null) return cannotMove('No such file or directory');
  if (landingParent.kind !== 'directory') return cannotMove('Not a directory');
  if (!env.fs.canWrite(dirname(source.path)).allowed) return cannotMove('Permission denied');
  if (!env.fs.canWrite(dirname(landing.path)).allowed) return cannotMove('Permission denied');
  // A rename may replace an empty directory, never one still holding something: the
  // moved tree would land on top of it and the two would merge.
  if (existing?.kind === 'directory' && existing.entries.size > 0) {
    return cannotMove('Directory not empty');
  }

  for (const placement of placementsOf(node, landing.path)) {
    const placed = await place(env, placement);
    if (!placed.ok) return cannotMove(PATCH_ERROR_REASON[placed.error]);
  }
  const removed = await env.patches.remove(source.path);
  return removed.ok ? null : cannotMove(PATCH_ERROR_REASON[removed.error]);
};

const execute = async (env: CommandEnv, args: readonly string[]): Promise<CommandResult> => {
  const read = readOperands(env, 'mv', args);
  if (!read.ok) return read.refusal;

  const errors: string[] = [];
  for (const source of read.operands.sources) {
    const error = await moveOne(env, source, read.operands.landingFor(source));
    if (error !== null) errors.push(error);
  }
  return refusals(errors);
};

export const mv: Command = {
  name: 'mv',
  description: 'Move or rename files and directories',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'mv <source> [sources...] <destination>',
    description:
      'Move or rename files and directories. A moved file keeps its permissions, and a moved directory takes everything inside it along. Moving needs write permission on the directory the source leaves and the one it lands in, but not read permission on the file itself. With several sources the destination must be a directory.',
    arguments: [
      { name: 'source', description: 'One or more files or directories to move', required: true },
      {
        name: 'destination',
        description: 'The new name, or a directory to move into',
        required: true,
      },
    ],
    examples: [
      { command: 'mv draft.txt final.txt', description: 'Rename a file' },
      { command: 'mv a.txt b.txt /tmp', description: 'Move several files into a directory' },
      { command: 'mv stash /tmp/.cache', description: 'Move a directory somewhere less obvious' },
    ],
  },
  execute,
};
