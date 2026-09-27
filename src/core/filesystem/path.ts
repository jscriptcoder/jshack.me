/**
 * Pure absolute-path utilities. No filesystem access — these are string
 * operations against the `AbsPath` brand.
 */

import { asAbsPath, type AbsPath } from '../types';

const ROOT = asAbsPath('/');

/** Resolve an input (absolute or relative to `cwd`) to an absolute path.
 *  Normalizes `..`, `.`, and consecutive slashes. */
export const resolveAbsPath = (cwd: AbsPath, input: string): AbsPath => {
  const base = input.startsWith('/') ? '/' : `${cwd}/`;
  return normalize(`${base}${input}`);
};

/** Normalize a path string to canonical absolute form. Folds a segment stack
 *  left-to-right: `.` and empty segments drop, `..` pops the previous segment. */
export const normalize = (input: string): AbsPath => {
  const stack = input.split('/').reduce<readonly string[]>((acc, segment) => {
    if (segment === '' || segment === '.') return acc;
    if (segment === '..') return acc.slice(0, -1);
    return [...acc, segment];
  }, []);
  return asAbsPath(stack.length === 0 ? '/' : `/${stack.join('/')}`);
};

/** Decompose an absolute path into its ancestor chain, root-first, including the leaf.
 *
 *  ancestorPaths('/etc/passwd')  → ['/', '/etc', '/etc/passwd']
 *  ancestorPaths('/')            → ['/']
 */
export const ancestorPaths = (path: AbsPath): readonly AbsPath[] => {
  if (path === ROOT) return [ROOT];
  const segments = path.split('/').filter((segment) => segment !== '');
  const ancestors = segments.map((_, index) =>
    asAbsPath(`/${segments.slice(0, index + 1).join('/')}`),
  );
  return [ROOT, ...ancestors];
};

/** Split a path into (parent, basename). For `/`, parent is `/` and basename is `''`. */
export const dirname = (path: AbsPath): AbsPath => {
  if (path === ROOT) return ROOT;
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash === 0) return ROOT;
  return asAbsPath(path.slice(0, lastSlash));
};

export const basename = (path: AbsPath): string => {
  if (path === ROOT) return '';
  const lastSlash = path.lastIndexOf('/');
  return path.slice(lastSlash + 1);
};
