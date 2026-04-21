import { describe, it, expect } from 'vitest';
import { findLibraryCve, findLatestSafeLibrary } from './systemLibraryLookup';
import { buildTimelineFromTemplate, CVE_TIMING_CONFIG } from './timeline';
import { systemLibraryTemplates } from './pools/systemLibraryTemplates';

const TIMING = CVE_TIMING_CONFIG;

// Walk a library timeline to pick specific entries for the tests — same
// sequence the lookup walks internally, so these entries are guaranteed to
// exist in the procedural timeline. Mirrors the `vendorEntry` helper in
// firmwareLookup.test.ts.
const libraryEntry = (
  library: keyof typeof systemLibraryTemplates,
  upTo: number,
  offset: number,
) => {
  const timeline = buildTimelineFromTemplate(
    systemLibraryTemplates[library],
    `library:${library}`,
    upTo,
    TIMING,
  );
  return timeline[offset]!;
};

describe('findLibraryCve', () => {
  it('returns a CVE for a library+version whose publishedAt <= gameTime', () => {
    const entry = libraryEntry('libpam', 500, 2);
    const vuln = findLibraryCve('libpam', entry.version, entry.publishedAt);
    expect(vuln).toBeDefined();
    expect(vuln?.serviceVersion).toBe(entry.version);
  });

  it('returns undefined for a version whose publishedAt is still in the future', () => {
    const entry = libraryEntry('libssl', 500, 4);
    const vuln = findLibraryCve('libssl', entry.version, entry.publishedAt - 1);
    expect(vuln).toBeUndefined();
  });

  it('returns undefined for a version string that does not exist in the timeline', () => {
    const vuln = findLibraryCve('libsystemd', 'libsystemd 999.999.999', 1000);
    expect(vuln).toBeUndefined();
  });

  it('returns undefined for an unknown library', () => {
    const vuln = findLibraryCve('no-such-library' as 'libpam', 'Whatever 1.0.0', 1000);
    expect(vuln).toBeUndefined();
  });

  it('is deterministic: same inputs produce the same CVE id', () => {
    const entry = libraryEntry('libpcre', 300, 1);
    const a = findLibraryCve('libpcre', entry.version, entry.publishedAt);
    const b = findLibraryCve('libpcre', entry.version, entry.publishedAt);
    expect(a?.cve).toBe(b?.cve);
  });

  it('produces distinct CVE ids across different libraries', () => {
    // Library template ids must be disjoint from service/firmware ids so
    // CVEs don't collide. Pin this by checking that two different library
    // CVEs at the same timeline index have different ids.
    const entryPam = libraryEntry('libpam', 500, 3);
    const entryCrypt = libraryEntry('libcrypt', 500, 3);
    const pamVuln = findLibraryCve('libpam', entryPam.version, entryPam.publishedAt);
    const cryptVuln = findLibraryCve('libcrypt', entryCrypt.version, entryCrypt.publishedAt);
    expect(pamVuln?.cve).not.toBe(cryptVuln?.cve);
  });

  it('never returns info severity', () => {
    for (let offset = 0; offset < 10; offset++) {
      const entry = libraryEntry('libxml2', 1000, offset);
      const vuln = findLibraryCve('libxml2', entry.version, entry.publishedAt);
      if (vuln) expect(vuln.severity).not.toBe('info');
    }
  });
});

describe('findLatestSafeLibrary (patch delay enforcement)', () => {
  it('returns undefined during the patch-delay gap after a library CVE publishes', () => {
    const vulnerable = libraryEntry('libpam', 500, 3);
    expect(findLatestSafeLibrary('libpam', vulnerable.publishedAt)).toBeUndefined();
  });

  it('returns the fix once the patch delay has elapsed', () => {
    const timeline = buildTimelineFromTemplate(
      systemLibraryTemplates.libpam,
      'library:libpam',
      500,
      TIMING,
    );
    const vulnerable = timeline[3]!;
    const next = timeline[4]!;
    const fixReleased = vulnerable.publishedAt + vulnerable.patchDelay;
    expect(findLatestSafeLibrary('libpam', fixReleased)).toBe(next.version);
  });

  it('returns the starting version at gameTime 0 (always released, no prev)', () => {
    const timeline = buildTimelineFromTemplate(
      systemLibraryTemplates.libssl,
      'library:libssl',
      100,
      TIMING,
    );
    expect(findLatestSafeLibrary('libssl', 0)).toBe(timeline[0]!.version);
  });

  it('returns undefined for an unknown library', () => {
    expect(findLatestSafeLibrary('no-such-library' as 'libpam', 1000)).toBeUndefined();
  });
});
