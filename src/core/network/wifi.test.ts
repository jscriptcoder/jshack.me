import { describe, expect, it } from 'vitest';
import { bssidFromEssid } from './wifi';

/**
 * `bssidFromEssid` derives a deterministic AP MAC from the ESSID — the AP's
 * identity in our model — so two players who see the same network see the same
 * BSSID (matching real WiFi: one physical AP, one MAC). Asserted against
 * independent sha256 vectors (computed via Node's crypto, not @noble) so the
 * derivation is real, not a stub, and any mutation to the byte slice / hex
 * formatting is caught.
 */
describe('bssidFromEssid (independent sha256 vectors)', () => {
  it('derives the first six sha256 bytes as uppercase colon-joined hex', () => {
    expect(bssidFromEssid('ACME-CORP')).toBe('CD:98:E8:66:71:2A');
    expect(bssidFromEssid('NULL-BYTE')).toBe('F4:F8:0B:54:E4:3A');
    expect(bssidFromEssid('STARBUCKS')).toBe('0F:1A:52:39:E1:CC');
  });

  it('derives from the empty string (the all-zeros-length edge)', () => {
    expect(bssidFromEssid('')).toBe('E3:B0:C4:42:98:FC');
  });

  it('is a pure function of the ESSID — same input, same BSSID', () => {
    expect(bssidFromEssid('GLOBEX-NET')).toBe(bssidFromEssid('GLOBEX-NET'));
  });
});
