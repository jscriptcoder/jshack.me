// Path-glob matcher shared across read-allowlist (patchRegistry) and
// projected-content allowlist (machineFilesystems). Both modules need
// the same `*` / `**` semantics so consistency is load-bearing — the
// no-session read filter and the auth-content projection list have
// overlapping entries (e.g. `/var/run/*.pid`) and must agree on shape.
//
// Glob semantics:
//   `**`   → matches any characters, including slashes (recursive)
//   `*`    → matches any characters within a single path segment (no slash)
//   other  → escaped literally so regex metacharacters in paths
//            (`.`, `+`, `?`, `(`, etc.) match themselves
//
// Order matters in the compilation: `**` must be replaced before `*`,
// otherwise the single-segment branch would consume the first star of
// a recursive pattern and leave a stray `*` behind.

const REGEX_META = /[.+?^${}()|[\]\\]/g;
const escapeLiterals = (segment: string): string => segment.replace(REGEX_META, '\\$&');

export const compileGlobPattern = (pattern: string): RegExp => {
  const body = pattern
    .split('**')
    .map((between) => between.split('*').map(escapeLiterals).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${body}$`);
};

// True if `path` matches at least one glob pattern in `patterns`.
// Returns false for an empty pattern list.
export const matchesAnyGlobPattern = (path: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => compileGlobPattern(pattern).test(path));
