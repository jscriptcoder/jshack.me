/**
 * cp — copy files, and with `-r`/`-R` whole directories, on the box the shell
 * stands on, through the server-backed `PatchApi`.
 *
 * A copy is a new file the copier made: it belongs to the shell's user and takes
 * the tier defaults, exactly as `touch`, a `>` redirect and an `scp` landing do. So
 * a copied script is not executable until `chmod +x`, and a guest's copy of a
 * root-writable file is one the guest can edit. Carrying the source's permissions
 * would not do, because in the tier model the owner is granted nothing by owning:
 * the copy of `/etc/passwd` would stay root-writable in the guest's own home.
 *
 * Overwriting an existing file leaves it its owner and permissions — the bytes
 * change, the terms do not.
 *
 * Every check runs against the live (patched) `fs` view before the write it guards,
 * and every refusal names the path as the player typed it, as coreutils does. A
 * refused source does not stop the others; the command then exits 1.
 */

import { PATCH_ERROR_REASON, type Command, type CommandEnv, type CommandResult } from './types.js';
import type { Directory } from '../filesystem/types.js';
import { dirname } from '../filesystem/path.js';
import { defaultFilePermissions } from '../filesystem/defaultPermissions.js';
import { resolveWriteTarget, type WriteTarget } from '../filesystem/writeTarget.js';
import { childPlace, isBeneath, readOperands, refusals, type Place } from './fileOperands.js';

/** Copy one file. `parentIsOurs` says this copy just created the directory it lands
 *  in, which the view, read before any write, has never heard of — so it cannot be
 *  asked, and needs no asking: nobody else could have put a file there. */
const copyFile = async (
  env: CommandEnv,
  source: Place,
  landing: Place,
  parentIsOurs: boolean,
): Promise<string | null> => {
  const read = env.fs.read(source.path);
  if (!read.ok) {
    return read.error === 'permission_denied'
      ? `cp: cannot open '${source.typed}' for reading: Permission denied`
      : `cp: cannot stat '${source.typed}': No such file or directory`;
  }
  const cannotCreate = (reason: string) =>
    `cp: cannot create regular file '${landing.typed}': ${reason}`;

  const target: WriteTarget = parentIsOurs
    ? { ok: true, target: landing.path, isNew: true }
    : resolveWriteTarget(env.fs, landing.path);
  if (!target.ok) {
    if (target.error === 'is_directory') {
      return `cp: cannot overwrite directory '${landing.typed}' with non-directory`;
    }
    return cannotCreate(
      target.error === 'permission_denied' ? 'Permission denied' : 'No such file or directory',
    );
  }

  // Both have to be NAMED: the write layer stamps the shell's own defaults on a write
  // that names none, an overwrite included.
  const existing = target.isNew ? null : env.fs.stat(target.target);
  const written = await env.patches.write(target.target, read.content, {
    owner: existing?.owner ?? env.session.username,
    permissions: existing?.perms ?? defaultFilePermissions(env.session.userType),
    ...(target.isNew ? { isNew: true } : {}),
  });
  return written.ok ? null : cannotCreate(PATCH_ERROR_REASON[written.error]);
};

/** Copy a directory and everything under it. Returns every refusal met on the way;
 *  a refused directory skips its own subtree and nothing else. */
const copyTree = async (
  env: CommandEnv,
  source: Place,
  directory: Directory,
  landing: Place,
  parentIsOurs: boolean,
): Promise<readonly string[]> => {
  // `stat` answers whatever the tier, so the tree in hand would let a copy walk a
  // directory the shell may not list — and print every name in it as it went.
  if (!env.fs.list(source.path).ok) {
    return [`cp: cannot open directory '${source.typed}': Permission denied`];
  }
  const existing = parentIsOurs ? null : env.fs.stat(landing.path);
  if (existing?.kind === 'file') {
    return [
      `cp: cannot overwrite non-directory '${landing.typed}' with directory '${source.typed}'`,
    ];
  }
  const creating = existing === null;
  if (creating) {
    const cannotCreate = (reason: string) =>
      `cp: cannot create directory '${landing.typed}': ${reason}`;
    if (!parentIsOurs) {
      const parent = env.fs.stat(dirname(landing.path));
      if (parent?.kind !== 'directory') return [cannotCreate('No such file or directory')];
      if (!env.fs.canWrite(dirname(landing.path)).allowed) {
        return [cannotCreate('Permission denied')];
      }
    }
    const made = await env.patches.mkdir(landing.path);
    if (!made.ok) return [cannotCreate(PATCH_ERROR_REASON[made.error])];
  }

  const errors: string[] = [];
  for (const [name, node] of directory.entries) {
    const from = childPlace(source, name);
    const to = childPlace(landing, name);
    if (node.kind === 'directory') {
      errors.push(...(await copyTree(env, from, node, to, creating)));
    } else {
      const error = await copyFile(env, from, to, creating);
      if (error !== null) errors.push(error);
    }
  }
  return errors;
};

const copyOne = async (
  env: CommandEnv,
  source: Place,
  landing: Place,
  recursive: boolean,
): Promise<readonly string[]> => {
  const node = env.fs.stat(source.path);
  if (node !== null && landing.path === source.path) {
    return [`cp: '${source.typed}' and '${landing.typed}' are the same file`];
  }
  if (node?.kind !== 'directory') {
    const error = await copyFile(env, source, landing, false);
    return error === null ? [] : [error];
  }
  if (!recursive) return [`cp: -r not specified; omitting directory '${source.typed}'`];
  if (isBeneath(landing.path, source.path)) {
    return [`cp: cannot copy a directory, '${source.typed}', into itself, '${landing.typed}'`];
  }
  return copyTree(env, source, node, landing, false);
};

const execute = async (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  const read = readOperands(env, 'cp', args);
  if (!read.ok) return read.refusal;

  const recursive = flags.get('-r') === true || flags.get('-R') === true;
  const errors: string[] = [];
  for (const source of read.operands.sources) {
    errors.push(...(await copyOne(env, source, read.operands.landingFor(source), recursive)));
  }
  return refusals(errors);
};

export const cp: Command = {
  name: 'cp',
  description: 'Copy files and directories',
  category: 'filesystem',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-r': 'boolean', '-R': 'boolean' },
  manual: {
    synopsis: 'cp [-r] <source> [sources...] <destination>',
    description:
      'Copy files, and with -r whole directories. A copy is a new file you made: it is yours, with the default permissions of a new file, so a copied script needs chmod +x before it runs. Copying onto an existing file replaces its content and keeps its owner and permissions. With several sources the destination must be a directory. You need to be able to read each source and write where it lands.',
    arguments: [
      { name: '-r', description: 'Copy directories and everything inside them (also -R)' },
      { name: 'source', description: 'One or more files or directories to copy', required: true },
      {
        name: 'destination',
        description: 'The new name, or a directory to copy into',
        required: true,
      },
    ],
    examples: [
      { command: 'cp notes.txt notes.txt.bak', description: 'Back up a file before editing it' },
      { command: 'cp a.txt b.txt /tmp', description: 'Copy several files into a directory' },
      { command: 'cp -r stash /tmp/stash2', description: 'Copy a directory and its contents' },
    ],
  },
  execute,
};
