// Builds the parent-path chain consumed by permissionWalker.canRead /
// canWrite. The walker checks traverse (execute) on every directory
// between root and the target; this helper produces that chain.
//
// Ordering: root-to-immediate-parent. The walker iterates left-to-right
// and short-circuits on the first deny, so reversed input would give
// wrong answers in pathological permission layouts.
//
// Excludes the target itself — the walker checks the target's read/write
// list separately. For `/` the chain is empty (target IS the root).
//
// Normalises trailing slashes and collapses internal repeats so callers
// don't have to pre-clean inputs from the wire.

export const ancestorPaths = (path: string): readonly string[] => {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return [];
  const ancestors: string[] = ['/'];
  for (let i = 0; i < segments.length - 1; i += 1) {
    ancestors.push(`/${segments.slice(0, i + 1).join('/')}`);
  }
  return ancestors;
};
