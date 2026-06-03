import { describe, expect, it } from 'vitest';
import { generateWifi } from './generateWifi';
import { bssidFromEssid, type WifiNetwork } from '../network/wifi';
import { secrets } from '../secrets/__encoded';

/**
 * `generateWifi` is the seeded WiFi-scan generator: deterministic from the
 * player's identity pubkey, like the workstation FS. It must yield a small set
 * of access points — a few crackable (carrying a real pool password) plus noise
 * APs that each fail exactly one aircrack gate (WPA3 / weak signal / hidden) so
 * Slice 4's `aircrack` can re-derive the failure from observable state.
 *
 * Tests assert the generation INVARIANTS the rest of the arc leans on, not a
 * hand-computed sequence — determinism via repeated calls, counts, and the
 * crackable/noise gate separation.
 */

const POOL = JSON.parse(secrets.WIFI_PASSWORDS) as readonly string[];

const SEED_A = 'a'.repeat(64);
const SEED_B = 'b'.repeat(64);
// This seed happens to roll a `hidden` noise AP — exercises the `<hidden>`
// ESSID substitution and the derive-BSSID-from-the-ORIGINAL-essid rule.
const SEED_HIDDEN = '0'.repeat(64);

const isCrackable = (network: WifiNetwork): network is Extract<WifiNetwork, { crackable: true }> =>
  network.crackable;

/** The three aircrack failure gates a noise AP must hit exactly one of. */
const failedGates = (network: WifiNetwork): readonly string[] =>
  [
    network.encryption === 'WPA3' ? 'wpa3' : null,
    network.power < -80 ? 'weak' : null,
    network.essid === '<hidden>' ? 'hidden' : null,
  ].filter((gate): gate is string => gate !== null);

describe('generateWifi', () => {
  it('is deterministic — the same identity yields byte-identical networks', () => {
    expect(generateWifi(SEED_A)).toEqual(generateWifi(SEED_A));
  });

  it('yields different networks for different identities', () => {
    const bssidsA = generateWifi(SEED_A).map((network) => network.bssid);
    const bssidsB = generateWifi(SEED_B).map((network) => network.bssid);
    expect(bssidsA).not.toEqual(bssidsB);
  });

  it('yields 2-3 crackable and 3-5 noise networks', () => {
    const networks = generateWifi(SEED_A);
    const crackable = networks.filter(isCrackable);
    const noise = networks.filter((network) => !network.crackable);

    expect(crackable.length).toBeGreaterThanOrEqual(2);
    expect(crackable.length).toBeLessThanOrEqual(3);
    expect(noise.length).toBeGreaterThanOrEqual(3);
    expect(noise.length).toBeLessThanOrEqual(5);
  });

  it('gives every crackable AP a real pool password and makes it gate-passable', () => {
    for (const network of generateWifi(SEED_A).filter(isCrackable)) {
      expect(POOL).toContain(network.password);
      expect(network.encryption).toBe('WPA2');
      // Strong, realistic signal band: comfortably above the -80 weak gate so
      // the AP is always crackable. The tight band also pins the seeded range.
      expect(network.power).toBeGreaterThanOrEqual(-65);
      expect(network.power).toBeLessThanOrEqual(-35);
      expect(network.essid).not.toBe('<hidden>');
      expect(network.bssid).toBe(bssidFromEssid(network.essid));
    }
  });

  it('makes every noise AP fail exactly one aircrack gate and carry no password', () => {
    for (const network of generateWifi(SEED_A).filter((candidate) => !candidate.crackable)) {
      expect(failedGates(network)).toHaveLength(1);
      expect('password' in network).toBe(false);
      // Realistic dBm band spanning both the weak (-95..-81) and non-weak
      // (-78..-65) noise ranges — pins the seeded power, no positive values.
      expect(network.power).toBeGreaterThanOrEqual(-95);
      expect(network.power).toBeLessThanOrEqual(-65);
    }
  });

  it('shuffles crackable and noise together into a stable seeded order', () => {
    // Golden snapshot for SEED_A: locks the seeded selection + interleave. The
    // crackable APs (BEAN-THERE / GRAD-STUDENT / STARK) are NOT front-loaded —
    // proof the final shuffle actually mixes the two populations.
    const order = generateWifi(SEED_A).map((network) => ({
      essid: network.essid,
      encryption: network.encryption,
      crackable: network.crackable,
    }));
    expect(order).toEqual([
      { essid: 'BEAN-THERE-WIFI', encryption: 'WPA2', crackable: true },
      { essid: 'GRAD-STUDENT-WIFI', encryption: 'WPA2', crackable: true },
      { essid: 'DIRECT-roku', encryption: 'WPA3', crackable: false },
      { essid: 'Eero-Living-Room', encryption: 'WPA3', crackable: false },
      { essid: 'STARK-WIFI', encryption: 'WPA2', crackable: true },
      { essid: 'SUBWAY_WIFI', encryption: 'WPA2', crackable: false },
      { essid: 'MCDONALDS-WIFI', encryption: 'WPA3', crackable: false },
    ]);
  });

  it('assigns each AP a distinct channel from the 1-11 band', () => {
    const channels = generateWifi(SEED_A).map((network) => network.channel);
    expect(new Set(channels).size).toBe(channels.length);
    for (const channel of channels) {
      expect(channel).toBeGreaterThanOrEqual(1);
      expect(channel).toBeLessThanOrEqual(11);
    }
  });

  it('keeps every power inside its realistic dBm band across many identities', () => {
    // Sweep many seeds so a widened range (a mutated bound) eventually emits an
    // out-of-band value — a single seed's small PRNG fractions can hide it.
    for (let index = 0; index < 40; index++) {
      const seed = index.toString().padStart(64, '0');
      for (const network of generateWifi(seed)) {
        if (network.crackable) {
          expect(network.power).toBeGreaterThanOrEqual(-65);
          expect(network.power).toBeLessThanOrEqual(-35);
        } else {
          expect(network.power).toBeGreaterThanOrEqual(-95);
          expect(network.power).toBeLessThanOrEqual(-65);
        }
      }
    }
  });

  it('derives visible BSSIDs from the ESSID (uppercase six-octet MAC)', () => {
    for (const network of generateWifi(SEED_A)) {
      expect(network.bssid).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
      if (network.essid !== '<hidden>') {
        expect(network.bssid).toBe(bssidFromEssid(network.essid));
      }
    }
  });

  it('masks a hidden AP as <hidden> but keeps its real (original-ESSID) BSSID', () => {
    const hidden = generateWifi(SEED_HIDDEN).filter((network) => network.essid === '<hidden>');
    expect(hidden.length).toBeGreaterThan(0);
    for (const network of hidden) {
      // BSSID is derived from the ORIGINAL essid, so it must NOT collide on the
      // placeholder's hash — that's what stops every hidden AP sharing one MAC.
      expect(network.bssid).not.toBe(bssidFromEssid('<hidden>'));
      expect(network.bssid).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
    }
  });
});
