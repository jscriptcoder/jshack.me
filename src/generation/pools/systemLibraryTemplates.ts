import type { VersionTemplate } from './serviceTemplates';

// Shared system library templates used by the procedural timeline generator
// (see src/generation/timeline/). Mirrors the shape of serviceTemplates and
// firmwareTemplates so buildTimelineFromTemplate walks library timelines
// without any special-casing.
//
// The 8 libraries chosen cover all 8 VulnerabilityEffect kinds through their
// linked commands (see src/commands/libraryDeps.ts when it lands). Starting
// tuples are chosen to look plausible as "currently shipping" versions
// circa 2026. libc intentionally omitted from v1 — its blast radius is too
// broad (every command depends on it), which would collapse gameplay to
// "am I in a libc-CVE window?". libc can be added later with careful tuning.

export type SystemLibrary =
  | 'libpam'
  | 'libcrypt'
  | 'libsystemd'
  | 'libreadline'
  | 'libssl'
  | 'libz'
  | 'libxml2'
  | 'libpcre';

export const systemLibraryTemplates: Readonly<Record<SystemLibrary, VersionTemplate>> = {
  libpam: { prefix: 'libpam ', separator: '.', startTuple: [1, 5, 3] },
  libcrypt: { prefix: 'libcrypt ', separator: '.', startTuple: [4, 4, 36] },
  libsystemd: { prefix: 'libsystemd ', separator: '.', startTuple: [255, 4, 0] },
  libreadline: { prefix: 'libreadline ', separator: '.', startTuple: [8, 2, 10] },
  libssl: { prefix: 'OpenSSL ', separator: '.', startTuple: [3, 2, 1] },
  libz: { prefix: 'zlib ', separator: '.', startTuple: [1, 3, 1] },
  libxml2: { prefix: 'libxml2 ', separator: '.', startTuple: [2, 12, 5] },
  libpcre: { prefix: 'PCRE2 ', separator: '.', startTuple: [10, 43, 0] },
};

export const SYSTEM_LIBRARIES: readonly SystemLibrary[] = Object.keys(
  systemLibraryTemplates,
) as readonly SystemLibrary[];
