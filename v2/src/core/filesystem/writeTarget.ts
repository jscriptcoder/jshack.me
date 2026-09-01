/**
 * Where a whole-file write is allowed to land — the decision, not the sentence.
 *
 * Two callers ask it: the `>` redirect, which opens its target before the
 * command runs because that is what bash does, and a script's `fs.writeFile`,
 * which has no such ordering constraint. They say different things about a
 * refusal — one is `bash:`, the other `node:` — so the WORDING stays with each
 * of them, exactly as `PATCH_ERROR_REASON` leaves the command's own name to the
 * command. What must not differ is the RULE, because the rule is tier
 * permissions: a path one door refuses and the other accepts is a hole.
 *
 * The three refusals are deliberately the same three `FsReadResult` already
 * names, so one formatter can word a failed read and a failed write alike.
 */

import type { AbsPath } from '../types';
import type { FsView } from '../commands/types';
import { dirname, resolveAbsPath } from './path';

export type WriteTarget =
  | { readonly ok: true; readonly target: AbsPath; readonly isNew: boolean }
  | {
      readonly ok: false;
      readonly error: 'is_directory' | 'not_found' | 'permission_denied';
    };

/** Resolve `rawTarget` against the view's cwd and decide whether a whole-file
 *  write may land there.
 *
 *  Takes the view rather than the whole env so an append can ask about the
 *  machine as RELOADED rather than as this client last saw it.
 *
 *  `isNew` reports that the target does not exist yet, which the write needs so
 *  a freshly created file is stamped `is_new` while an overwrite leaves the
 *  stored flag alone. */
export const resolveWriteTarget = (fs: FsView, rawTarget: string): WriteTarget => {
  const target = resolveAbsPath(fs.cwd(), rawTarget);
  const node = fs.stat(target);
  if (node?.kind === 'directory') {
    return { ok: false, error: 'is_directory' };
  }
  const parent = dirname(target);
  const parentNode = fs.stat(parent);
  if (parentNode === null || parentNode.kind !== 'directory') {
    return { ok: false, error: 'not_found' };
  }
  // Asymmetric on purpose: an overwrite is governed by the file, a new file by
  // the directory that would gain an entry.
  const writable = node !== null ? fs.canWrite(target) : fs.canWrite(parent);
  if (!writable.allowed) {
    return { ok: false, error: 'permission_denied' };
  }
  return { ok: true, target, isNew: node === null };
};
