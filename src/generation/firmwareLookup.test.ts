import { describe, it, expect } from 'vitest';
import { findFirmwareCve, findLatestSafeFirmware } from './firmwareLookup';
import { buildTimelineFromTemplate, CVE_TIMING_CONFIG } from './timeline';
import { firmwareTemplates } from './pools/routerFirmware';

const TIMING = CVE_TIMING_CONFIG;

// Walk a vendor timeline to pick specific entries for the tests. This is
// the same sequence the lookup walks internally, so these entries are
// guaranteed to exist in the procedural timeline.
const vendorEntry = (vendor: keyof typeof firmwareTemplates, upTo: number, offset: number) => {
  const timeline = buildTimelineFromTemplate(
    firmwareTemplates[vendor],
    `firmware:${vendor}`,
    upTo,
    TIMING,
  );
  return timeline[offset]!;
};

describe('findFirmwareCve', () => {
  it('returns a CVE for a vendor+version whose publishedAt <= gameTime', () => {
    const entry = vendorEntry('mikrotik', 500, 2);
    const vuln = findFirmwareCve('mikrotik', entry.version, entry.publishedAt);
    expect(vuln).toBeDefined();
    expect(vuln?.serviceVersion).toBe(entry.version);
  });

  it('returns undefined for a version whose publishedAt is still in the future', () => {
    const entry = vendorEntry('cisco', 500, 4);
    // gameTime = 1 day before the CVE publishes → not yet live
    const vuln = findFirmwareCve('cisco', entry.version, entry.publishedAt - 1);
    expect(vuln).toBeUndefined();
  });

  it('returns undefined for a version string that does not exist in the timeline', () => {
    const vuln = findFirmwareCve('openwrt', 'OpenWRT 999.999.999', 1000);
    expect(vuln).toBeUndefined();
  });

  it('returns undefined for an unknown vendor', () => {
    const vuln = findFirmwareCve('no-such-vendor' as 'mikrotik', 'Whatever 1.0.0', 1000);
    expect(vuln).toBeUndefined();
  });

  it('is deterministic: same inputs produce the same CVE id', () => {
    const entry = vendorEntry('pfsense', 300, 1);
    const a = findFirmwareCve('pfsense', entry.version, entry.publishedAt);
    const b = findFirmwareCve('pfsense', entry.version, entry.publishedAt);
    expect(a?.cve).toBe(b?.cve);
  });

  it('never returns info severity (Phase 3: info is non-exploitable)', () => {
    // Walk a few entries across a vendor and confirm none come back info.
    for (let offset = 0; offset < 10; offset++) {
      const entry = vendorEntry('ddwrt', 1000, offset);
      const vuln = findFirmwareCve('ddwrt', entry.version, entry.publishedAt);
      if (vuln) expect(vuln.severity).not.toBe('info');
    }
  });
});

describe('findLatestSafeFirmware (patch delay enforcement)', () => {
  it('returns undefined during the patch-delay gap after a firmware CVE publishes', () => {
    const vulnerable = vendorEntry('mikrotik', 500, 3);
    expect(findLatestSafeFirmware('mikrotik', vulnerable.publishedAt)).toBeUndefined();
  });

  it('returns the fix once the patch delay has elapsed', () => {
    const timeline = buildTimelineFromTemplate(
      firmwareTemplates.mikrotik,
      'firmware:mikrotik',
      500,
      TIMING,
    );
    const vulnerable = timeline[3]!;
    const next = timeline[4]!;
    const fixReleased = vulnerable.publishedAt + vulnerable.patchDelay;
    expect(findLatestSafeFirmware('mikrotik', fixReleased)).toBe(next.version);
  });

  it('returns undefined for an unknown vendor', () => {
    expect(findLatestSafeFirmware('no-such-vendor' as 'mikrotik', 1000)).toBeUndefined();
  });
});
