import type { Vulnerability } from '../network/types';
import { buildTimelineFromTemplate, buildGeneratedVuln, CVE_TIMING_CONFIG } from './timeline';
import { systemLibraryTemplates, type SystemLibrary } from './pools/systemLibraryTemplates';

// System library CVE lookup for pre-installed /bin/ and /usr/sbin/ commands.
//
// Mirrors firmwareLookup's shape — walks each library's procedural timeline
// via buildTimelineFromTemplate. There is no hand-authored historical CVE
// layer for libraries; every library CVE is procedurally generated.
//
// Libraries are consumed differently from services or firmware: the
// Vulnerability returned here carries the CVE metadata (id, severity,
// publishedAt, description) but its effect is a *placeholder* — the real
// effect used at exploit time is rolled from the attacking command's own
// effect pool (one libpcre CVE yields `dir_list` via `ls`, `file_read` via
// `grep`, etc.). That per-command dispatch lives in Step 3.

const LIBRARY_WALK_CAP_MULTIPLIER = 2;

export const findLibraryCve = (
  library: SystemLibrary,
  libraryVersion: string,
  gameTime: number,
): Vulnerability | undefined => {
  const template = systemLibraryTemplates[library];
  if (!template) return undefined;

  const walkCap = gameTime + CVE_TIMING_CONFIG.maxSafeWindowDays * LIBRARY_WALK_CAP_MULTIPLIER;
  const timeline = buildTimelineFromTemplate(
    template,
    `library:${library}`,
    walkCap,
    CVE_TIMING_CONFIG,
  );

  const entry = timeline.find((e) => e.version === libraryVersion);
  if (!entry) return undefined;
  if (entry.publishedAt > gameTime) return undefined;

  const vuln = buildGeneratedVuln(library, entry);
  if (vuln.severity === 'info') return undefined;
  return vuln;
};

// Looks up a specific library version in the procedural timeline. Returns
// true if the version is reachable within the install walk budget. Used by
// `apt install <library>=<version>` to validate a pinned version. Mirrors
// findPinnableFirmwareVersion.
const INSTALL_WALK_BUDGET_DAYS = 730;

export const findPinnableLibraryVersion = (
  library: SystemLibrary,
  libraryVersion: string,
  gameTime: number,
): boolean => {
  const template = systemLibraryTemplates[library];
  if (!template) return false;

  const timeline = buildTimelineFromTemplate(
    template,
    `library:${library}`,
    gameTime + INSTALL_WALK_BUDGET_DAYS,
    CVE_TIMING_CONFIG,
  );
  return timeline.some((e) => e.version === libraryVersion);
};

// Returns the newest library version whose CVE has not yet been "published"
// AND whose release has occurred (prev.publishedAt + prev.patchDelay <= gameTime).
// Returns undefined during the patch-delay gap when no fix is yet released.
// Mirrors findLatestSafeFirmware.
export const findLatestSafeLibrary = (
  library: SystemLibrary,
  gameTime: number,
): string | undefined => {
  const template = systemLibraryTemplates[library];
  if (!template) return undefined;

  const timeline = buildTimelineFromTemplate(
    template,
    `library:${library}`,
    gameTime,
    CVE_TIMING_CONFIG,
  );
  const i = timeline.findIndex((e) => e.publishedAt > gameTime);
  if (i === -1) return undefined;
  const entry = timeline[i]!;
  if (i === 0) return entry.version;
  const prev = timeline[i - 1]!;
  if (prev.publishedAt + prev.patchDelay <= gameTime) return entry.version;
  return undefined;
};
