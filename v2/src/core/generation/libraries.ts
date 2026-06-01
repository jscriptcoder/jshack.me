/**
 * Shared-library generation (binary/availability model — Slice 3).
 *
 * Pre-installed system commands link shared libraries under `/lib/*.so`; a
 * command whose linked `.so` is missing fails with the canonical dynamic-linker
 * error (see `core/commands/libraryDeps.ts`). This module is the GENERATION
 * side: the canonical library set and the `/lib` FileNode stamping.
 *
 * The 8 libraries here are NAMES only. In the future each carries a version +
 * CVE timeline, and a live library CVE is a privilege-escalation vector
 * (`msfconsole --local <cmd>` resolves a command's linked libs → root). That
 * versioning layer attaches to the `.so` later WITHOUT changing presence
 * semantics — keeping presence orthogonal to versioning is deliberate. The
 * 8-library set is ported faithfully because the mappings (in `libraryDeps`)
 * ARE that future exploit surface. `libc` is intentionally omitted — its blast
 * radius (every command) would collapse gameplay. See the library-CVE design.
 */

import { BINARY_STUB } from './binaries';
import type { FileNode, FilePermissions } from '../filesystem/types';

/** The shared libraries modelled by the game. Ported verbatim from legacy
 *  `SystemLibrary` (`src/generation/pools/systemLibraryTemplates.ts`). */
export type SystemLibrary =
  | 'libpam'
  | 'libcrypt'
  | 'libsystemd'
  | 'libreadline'
  | 'libssl'
  | 'libz'
  | 'libxml2'
  | 'libpcre';

export const SYSTEM_LIBRARIES: readonly SystemLibrary[] = [
  'libpam',
  'libcrypt',
  'libsystemd',
  'libreadline',
  'libssl',
  'libz',
  'libxml2',
  'libpcre',
];

/** `/lib/*.so` perms: root-owned, world-readable, root-writable, and NOT
 *  executable as a file — a library is linked, never run directly. */
const LIBRARY_PERMS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

/**
 * Build `/lib` entries for the given libraries — one `<lib>.so` stub file each.
 * Presence is all the runtime checks; the stub content stands in for the real
 * shared object (and is where version/CVE metadata will later attach).
 */
export const createLibraryEntries = (
  libraries: readonly SystemLibrary[],
): Readonly<Record<string, FileNode>> =>
  Object.fromEntries(
    libraries.map((lib) => [
      `${lib}.so`,
      {
        kind: 'file' as const,
        content: BINARY_STUB,
        owner: 'root',
        perms: LIBRARY_PERMS,
      } satisfies FileNode,
    ]),
  );
