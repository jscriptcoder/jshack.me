/**
 * mkdir — create directories on the current machine through the server-backed
 * `PatchApi`.
 *
 * Legacy interface parity (per `v2_match_legacy_command_interface`): only `-p`
 * is accepted; the error texts match legacy
 * (`mkdir: cannot create directory '<arg>': <reason>`), and error messages
 * preserve the ORIGINAL argument rather than the resolved absolute path.
 *
 * Without `-p`, every parent must already exist and the target must not.
 * With `-p`, missing intermediates are created (one patch per level, in
 * parent→child order, so a replay materializes the chain correctly) and an
 * existing target is not an error. Permission and shape checks run against the
 * live (patched) `fs` view BEFORE any write is issued.
 */

import type { AbsPath } from '../types';
import { asAbsPath } from '../types';
import type { Command, CommandEnv, CommandResult, FsView, PatchResult } from './types';
import { resolveAbsPath } from '../filesystem/path';

const PATCH_ERROR_MESSAGE: Record<Extract<PatchResult, { ok: false }>['error'], string> = {
  no_session: 'Permission denied',
  permission_denied: 'Permission denied',
  network_error: 'service unavailable',
};

const cannotCreate = (target: string, reason: string): string =>
  `mkdir: cannot create directory '${target}': ${reason}`;

const segmentsOf = (path: AbsPath): readonly string[] =>
  path.split('/').filter((segment) => segment !== '');

type PlanResult =
  | { readonly ok: true; readonly toCreate: readonly AbsPath[] }
  | { readonly ok: false; readonly error: string };

/** Walk the resolved segments, accumulating which intermediate directories
 *  must be created. Pure over the `fs` view. Only the FIRST missing segment's
 *  parent is checked for write permission — once the plan starts creating
 *  directories, the caller owns every subsequent parent by construction. */
const planDirectoryCreation = (
  fs: FsView,
  resolved: AbsPath,
  target: string,
  parents: boolean,
): PlanResult => {
  type Step =
    | { readonly ok: true; readonly cursor: AbsPath; readonly toCreate: readonly AbsPath[] }
    | { readonly ok: false; readonly error: string };

  const parts = segmentsOf(resolved);
  const final = parts.reduce<Step>(
    (step, segment, index) => {
      if (!step.ok) return step;
      const nextPath = asAbsPath(step.cursor === '/' ? `/${segment}` : `${step.cursor}/${segment}`);
      const node = fs.stat(nextPath);

      if (node !== null) {
        if (node.kind !== 'directory') {
          return { ok: false, error: cannotCreate(target, 'Not a directory') };
        }
        return { ok: true, cursor: nextPath, toCreate: step.toCreate };
      }

      const isFinal = index === parts.length - 1;
      if (!isFinal && !parents) {
        return { ok: false, error: cannotCreate(target, 'No such file or directory') };
      }

      if (step.toCreate.length === 0 && !fs.canWrite(step.cursor).allowed) {
        return { ok: false, error: cannotCreate(target, 'Permission denied') };
      }

      return { ok: true, cursor: nextPath, toCreate: [...step.toCreate, nextPath] };
    },
    { ok: true, cursor: asAbsPath('/'), toCreate: [] },
  );

  if (!final.ok) return final;
  return { ok: true, toCreate: final.toCreate };
};

/** Create one path argument. Returns an error string, or null on success. */
const createOnePath = async (
  env: CommandEnv,
  rawArg: string,
  parents: boolean,
): Promise<string | null> => {
  const resolved = resolveAbsPath(env.fs.cwd(), rawArg);

  if (env.fs.stat(resolved) !== null) {
    return parents ? null : cannotCreate(rawArg, 'File exists');
  }

  const plan = planDirectoryCreation(env.fs, resolved, rawArg, parents);
  if (!plan.ok) return plan.error;

  for (const dirPath of plan.toCreate) {
    const result = await env.patches.mkdir(dirPath);
    if (!result.ok) return cannotCreate(rawArg, PATCH_ERROR_MESSAGE[result.error]);
  }
  return null;
};

const execute = async (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
): Promise<CommandResult> => {
  if (args.length === 0) {
    return {
      kind: 'sync',
      lines: [{ kind: 'error', content: 'mkdir: missing operand' }],
      exitCode: 1,
    };
  }

  const parents = flags.get('-p') === true;
  const errors: string[] = [];
  for (const rawArg of args) {
    const error = await createOnePath(env, rawArg, parents);
    if (error !== null) errors.push(error);
  }

  return {
    kind: 'sync',
    lines: errors.map((content) => ({ kind: 'error', content })),
    exitCode: errors.length === 0 ? 0 : 1,
  };
};

export const mkdir: Command = {
  name: 'mkdir',
  description: 'Create directories',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '-p': 'boolean' },
  manual: {
    synopsis: 'mkdir [-p] <path> [paths...]',
    description:
      'Create one or more directories. Without -p, the parent of each target must already exist and the target itself must not. With -p, missing intermediate directories are created automatically and an existing target is not treated as an error.',
    examples: ['mkdir stash', 'mkdir -p /tmp/a/b/c', 'mkdir docs logs tmp'],
  },
  execute,
};
