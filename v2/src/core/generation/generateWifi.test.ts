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
  it('is deterministic — the same identity and scan index yield byte-identical networks', () => {
    expect(generateWifi({ seedPubkeyHex: SEED_A })).toEqual(generateWifi({ seedPubkeyHex: SEED_A }));
  });

  it('yields different networks for different identities', () => {
    const bssidsA = generateWifi({ seedPubkeyHex: SEED_A }).map((network) => network.bssid);
    const bssidsB = generateWifi({ seedPubkeyHex: SEED_B }).map((network) => network.bssid);
    expect(bssidsA).not.toEqual(bssidsB);
  });

  it('yields 2-3 crackable and 3-5 noise networks', () => {
    const networks = generateWifi({ seedPubkeyHex: SEED_A });
    const crackable = networks.filter(isCrackable);
    const noise = networks.filter((network) => !network.crackable);

    expect(crackable.length).toBeGreaterThanOrEqual(2);
    expect(crackable.length).toBeLessThanOrEqual(3);
    expect(noise.length).toBeGreaterThanOrEqual(3);
    expect(noise.length).toBeLessThanOrEqual(5);
  });

  it('derives each crackable AP password from its ESSID (same network → same password for everyone)', () => {
    // Sweep many identities and group every crackable sighting by ESSID. The
    // password is the network's IDENTITY (ESSID-seeded), like the BSSID — so the
    // same AP must crack to the same password for whoever sees it, never a
    // per-player draw.
    const occurrences = new Map<string, string[]>();
    for (let index = 0; index < 80; index++) {
      const seed = index.toString().padStart(64, '0');
      for (const network of generateWifi({ seedPubkeyHex: seed }).filter(isCrackable)) {
        const passwords = occurrences.get(network.essid) ?? [];
        passwords.push(network.password);
        occurrences.set(network.essid, passwords);
      }
    }

    const repeated = [...occurrences.values()].filter((passwords) => passwords.length > 1);
    // The sweep must actually surface a repeated ESSID, else the check is vacuous.
    expect(repeated.length).toBeGreaterThan(0);
    // Each repeated ESSID carries ONE password across every sighting.
    for (const passwords of repeated) {
      expect(new Set(passwords).size).toBe(1);
    }
    // ...and the password tracks the ESSID, not a constant: distinct ESSIDs do
    // not all collapse onto a single password (kills a constant-seed mutant).
    const distinctPasswords = new Set([...occurrences.values()].map((passwords) => passwords[0]!));
    expect(distinctPasswords.size).toBeGreaterThan(1);
  });

  it('gives every crackable AP a real pool password and makes it gate-passable', () => {
    for (const network of generateWifi({ seedPubkeyHex: SEED_A }).filter(isCrackable)) {
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
    for (const network of generateWifi({ seedPubkeyHex: SEED_A }).filter(
      (candidate) => !candidate.crackable,
    )) {
      expect(failedGates(network)).toHaveLength(1);
      expect('password' in network).toBe(false);
      // Realistic dBm band spanning both the weak (-95..-81) and non-weak
      // (-78..-65) noise ranges — pins the seeded power, no positive values.
      expect(network.power).toBeGreaterThanOrEqual(-95);
      expect(network.power).toBeLessThanOrEqual(-65);
    }
  });

  it('shuffles crackable and noise together into a stable seeded order', () => {
    // Golden snapshot for SEED_A's first scan: locks the seeded selection +
    // interleave. The crackable APs (ACME-CORP / STARK-WIFI) sit at positions 3
    // and 6, interleaved with noise rather than grouped — proof the final shuffle
    // actually mixes the two populations.
    const order = generateWifi({ seedPubkeyHex: SEED_A }).map((network) => ({
      essid: network.essid,
      encryption: network.encryption,
      crackable: network.crackable,
    }));
    expect(order).toEqual([
      { essid: '<hidden>', encryption: 'WPA2', crackable: false },
      { essid: '<hidden>', encryption: 'WPA2', crackable: false },
      { essid: 'ACME-CORP', encryption: 'WPA2', crackable: true },
      { essid: 'SUBWAY_WIFI', encryption: 'WPA2', crackable: false },
      { essid: 'FREE_INTERNET', encryption: 'WPA3', crackable: false },
      { essid: 'STARK-WIFI', encryption: 'WPA2', crackable: true },
      { essid: 'ASUS_RT_AC68U', encryption: 'WPA3', crackable: false },
    ]);
  });

  it('assigns each AP a distinct channel from the 1-11 band', () => {
    const channels = generateWifi({ seedPubkeyHex: SEED_A }).map((network) => network.channel);
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
      for (const network of generateWifi({ seedPubkeyHex: seed })) {
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
    for (const network of generateWifi({ seedPubkeyHex: SEED_A })) {
      expect(network.bssid).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
      if (network.essid !== '<hidden>') {
        expect(network.bssid).toBe(bssidFromEssid(network.essid));
      }
    }
  });

  it('masks a hidden AP as <hidden> but keeps its real (original-ESSID) BSSID', () => {
    const hidden = generateWifi({ seedPubkeyHex: SEED_HIDDEN }).filter(
      (network) => network.essid === '<hidden>',
    );
    expect(hidden.length).toBeGreaterThan(0);
    for (const network of hidden) {
      // BSSID is derived from the ORIGINAL essid, so it must NOT collide on the
      // placeholder's hash — that's what stops every hidden AP sharing one MAC.
      expect(network.bssid).not.toBe(bssidFromEssid('<hidden>'));
      expect(network.bssid).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
    }
  });

  it('re-rolls per scan index — re-scanning need not yield the same networks', () => {
    const rolls = [0, 1, 2, 3, 4].map((scanIndex) =>
      generateWifi({ seedPubkeyHex: SEED_A, scanIndex })
        .map((network) => network.essid)
        .join(','),
    );
    // The scan index is mixed into the seed, so five consecutive scans are not all
    // identical — re-scanning is a fresh roll ("relocating").
    expect(new Set(rolls).size).toBeGreaterThan(1);
  });

  it('is deterministic for a given identity and scan index', () => {
    expect(generateWifi({ seedPubkeyHex: SEED_A, scanIndex: 7 })).toEqual(
      generateWifi({ seedPubkeyHex: SEED_A, scanIndex: 7 }),
    );
  });

  it('can inject a currently-occupied ESSID (even outside the catalog) as a crackable AP', () => {
    // Neither pool contains this name, so it can ONLY reach the scan via injection.
    const occupied = 'PLAYER-A-LIVE-NET';
    const sightings: Extract<WifiNetwork, { crackable: true }>[] = [];
    for (let scanIndex = 0; scanIndex < 20; scanIndex++) {
      const hit = generateWifi({ seedPubkeyHex: SEED_B, scanIndex, occupiedEssids: [occupied] }).find(
        (network) => network.essid === occupied,
      );
      if (hit !== undefined && hit.crackable) sightings.push(hit);
    }

    // Injection actually surfaces it within a handful of "relocations".
    expect(sightings.length).toBeGreaterThan(0);
    for (const network of sightings) {
      expect(network.bssid).toBe(bssidFromEssid(occupied));
      expect(POOL).toContain(network.password);
    }
    // ESSID-seeded: every sighting cracks to the SAME password (the key that works
    // for everyone), never a per-scan draw.
    expect(new Set(sightings.map((network) => network.password)).size).toBe(1);
  });

  it('surfaces at most a bounded sample of occupied ESSIDs in any single scan', () => {
    // More occupied networks than a single scan should reveal. The per-scan cap
    // keeps the injected list realistic — a player never sees EVERY live network
    // at once, only a bounded handful per "relocation".
    const PER_SCAN_CAP = 3;
    const occupied = ['NET-A', 'NET-B', 'NET-C', 'NET-D', 'NET-E', 'NET-F'];
    let mostSeenInOneScan = 0;
    for (let scanIndex = 0; scanIndex < 40; scanIndex++) {
      const roll = generateWifi({ seedPubkeyHex: SEED_B, scanIndex, occupiedEssids: occupied });
      const seen = roll.filter((network) => occupied.includes(network.essid)).length;
      mostSeenInOneScan = Math.max(mostSeenInOneScan, seen);
    }
    // It actually injects more than one (not trivially capped at zero/one)...
    expect(mostSeenInOneScan).toBeGreaterThan(1);
    // ...but never more than the cap, even with far more networks available.
    expect(mostSeenInOneScan).toBeLessThanOrEqual(PER_SCAN_CAP);
  });

  it('never surfaces an ESSID that is neither in the catalog nor currently occupied', () => {
    const ghost = 'GHOST-NET-NEVER-OCCUPIED';
    for (let scanIndex = 0; scanIndex < 20; scanIndex++) {
      const roll = generateWifi({
        seedPubkeyHex: SEED_B,
        scanIndex,
        occupiedEssids: ['A-DIFFERENT-OCCUPIED-NET'],
      });
      expect(roll.find((network) => network.essid === ghost)).toBeUndefined();
    }
  });

  it('never doubles an occupied ESSID the base draw already produced', () => {
    for (let scanIndex = 0; scanIndex < 20; scanIndex++) {
      const base = generateWifi({ seedPubkeyHex: SEED_A, scanIndex });
      const baseCrackable = base.filter(isCrackable).map((network) => network.essid);
      // Feeding the base-drawn ESSIDs back as "occupied" must not duplicate any of
      // them — they are deduped out of the injectable set.
      const roll = generateWifi({ seedPubkeyHex: SEED_A, scanIndex, occupiedEssids: baseCrackable });
      for (const essid of baseCrackable) {
        expect(roll.filter((network) => network.essid === essid)).toHaveLength(1);
      }
    }
  });
});
