import { describe, it, expect } from 'vitest';
import { bssidFromEssid } from './bssidFromEssid';

describe('bssidFromEssid', () => {
  it('returns a 6-octet uppercase MAC format', () => {
    expect(bssidFromEssid('ACME-CORP')).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
  });

  it('returns the same BSSID for the same ESSID (deterministic)', () => {
    expect(bssidFromEssid('ACME-CORP')).toBe(bssidFromEssid('ACME-CORP'));
  });

  it('returns different BSSIDs for different ESSIDs', () => {
    expect(bssidFromEssid('ACME-CORP')).not.toBe(bssidFromEssid('GLOBEX-NET'));
  });

  it('produces a valid BSSID for an empty ESSID', () => {
    expect(bssidFromEssid('')).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
  });

  it('distinguishes ESSIDs that differ only by case (BSSIDs are not case-folded)', () => {
    // ESSIDs in the catalog are already canonicalized (uppercase). This test
    // documents that bssidFromEssid is case-sensitive — callers should pass
    // the exact ESSID string they want a stable BSSID for.
    expect(bssidFromEssid('ACME-CORP')).not.toBe(bssidFromEssid('acme-corp'));
  });
});
