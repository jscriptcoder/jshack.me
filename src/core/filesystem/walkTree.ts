/**
 * walkTree — depth-first traversal of a machine's filesystem that can only go
 * where the session can go.
 *
 * The rule this exists to hold in ONE place: a directory is descended into only
 * when `list` succeeds there. `stat` answers with no permission check at all
 * (see `fsView.ts`), so a walk that enumerated through it would report the
 * contents of every directory the session cannot open — a convenience tool
 * turned into an oracle for whatever someone bothered to lock away. `stat` is
 * used here only to describe a child that a successful listing already named,
 * which is what `ls -l` in that directory prints anyway.
 *
 * That rule is the reason this is shared rather than copied. Two loops enforcing
 * one permission boundary is how the boundary drifts in one caller and not the
 * other, and the failure is silent: the walk still returns plausible results.
 *
 * `visit` decides what a node CONTRIBUTES; it does not steer the walk. Every
 * reachable entry is visited, directories included, before the entries beneath
 * it — so a caller interested only in files returns nothing for a directory
 * rather than skipping it, and a caller that reports directories gets them
 * ahead of their contents. Entries are visited in alphabetical order at each
 * level.
 */

import type { AbsPath } from '../types';
import type { FsView } from '../commands/types';
import type { FileNode } from './types';
import { resolveAbsPath } from './path';

export const walkTree = <T>(
  fs: FsView,
  directory: AbsPath,
  visit: (path: AbsPath, node: FileNode) => readonly T[],
): readonly T[] => {
  const listing = fs.list(directory);
  if (!listing.ok) return [];

  return [...listing.entries].sort().flatMap((name) => {
    const childPath = resolveAbsPath(directory, name);
    const node = fs.stat(childPath);
    // Unreachable in practice, and required by the type: every name here came
    // out of a listing of this same tree, so it resolves. Kept as a total
    // answer rather than an assertion — a walk is not the place to throw.
    if (node === null) return [];

    // Asking a file for its listing answers `not_a_directory`, so recursing
    // into one would be harmless — this says what the walk MEANS rather than
    // guarding against a wrong answer.
    const deeper = node.kind === 'directory' ? walkTree(fs, childPath, visit) : [];
    return [...visit(childPath, node), ...deeper];
  });
};
