import { describe, it, expect } from 'vitest';
import { generateWifiNetworks, crackableEssidPool, noiseEssidPool } from './generateWifi';
import type { WifiTier } from '../network/wifiNetworks';

describe('generateWifiNetworks', () => {
  it('should produce deterministic output for same seed', () => {
    const a = generateWifiNetworks('test-seed');
    const b = generateWifiNetworks('test-seed');
    expect(a).toEqual(b);
  });

  it('should produce different output for different seeds', () => {
    const a = generateWifiNetworks('seed-a');
    const b = generateWifiNetworks('seed-b');
    const aEssids = a.map((n) => n.essid).join(',');
    const bEssids = b.map((n) => n.essid).join(',');
    expect(aEssids).not.toBe(bEssids);
  });

  it('should have 2-3 crackable networks', () => {
    // Test across multiple seeds
    for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10']) {
      const networks = generateWifiNetworks(seed);
      const crackable = networks.filter((n) => n.crackable);
      expect(crackable.length).toBeGreaterThanOrEqual(2);
      expect(crackable.length).toBeLessThanOrEqual(3);
    }
  });

  it('should have 3-5 noise networks', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const networks = generateWifiNetworks(seed);
      const noise = networks.filter((n) => !n.crackable);
      expect(noise.length).toBeGreaterThanOrEqual(3);
      expect(noise.length).toBeLessThanOrEqual(5);
    }
  });

  it('should give each crackable network a unique password', () => {
    const networks = generateWifiNetworks('password-test');
    const crackable = networks.filter((n) => n.crackable);
    const passwords = crackable.map((n) => n.password);
    expect(new Set(passwords).size).toBe(passwords.length);
  });

  it('should give each crackable network a unique essid', () => {
    const networks = generateWifiNetworks('essid-test');
    const crackable = networks.filter((n) => n.crackable);
    const essids = crackable.map((n) => n.essid);
    expect(new Set(essids).size).toBe(essids.length);
  });

  it('should have all crackable networks as WPA2', () => {
    const networks = generateWifiNetworks('enc-test');
    const crackable = networks.filter((n) => n.crackable);
    expect(crackable.every((n) => n.encryption === 'WPA2')).toBe(true);
  });

  it('should have crackable networks with strong signal (>= -65 dBm)', () => {
    const networks = generateWifiNetworks('signal-test');
    const crackable = networks.filter((n) => n.crackable);
    expect(crackable.every((n) => n.power >= -65)).toBe(true);
  });

  it('should have valid BSSID format on all networks', () => {
    const networks = generateWifiNetworks('bssid-test');
    const macRegex = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;
    expect(networks.every((n) => macRegex.test(n.bssid))).toBe(true);
  });

  it('should have unique BSSIDs across all networks', () => {
    const networks = generateWifiNetworks('unique-bssid');
    const bssids = networks.map((n) => n.bssid);
    expect(new Set(bssids).size).toBe(bssids.length);
  });

  it('should include noise networks that are not crackable', () => {
    const networks = generateWifiNetworks('noise-test');
    const noise = networks.filter((n) => !n.crackable);
    // Noise should have no password
    expect(noise.every((n) => n.password === undefined)).toBe(true);
    // Some noise should be WPA3 or have weak signal or be hidden
    const hasVariety =
      noise.some((n) => n.encryption === 'WPA3') ||
      noise.some((n) => n.power < -80) ||
      noise.some((n) => n.essid === '<hidden>');
    expect(hasVariety).toBe(true);
  });

  it('produces the same BSSID for the same crackable ESSID across different seeds', () => {
    // Cross-seed search: find a crackable ESSID that appears in two
    // different seed rolls, and assert both rolls produced the same
    // BSSID. With 50 templates and ~2-3 picks per seed, we'll usually
    // hit a match within the first handful of seeds.
    const seedA = 'cross-seed-a';
    const aCrackable = generateWifiNetworks(seedA).filter((n) => n.crackable);
    let matched = false;
    for (let i = 0; i < 50; i++) {
      const otherCrackable = generateWifiNetworks(`cross-seed-other-${i}`).filter(
        (n) => n.crackable,
      );
      for (const a of aCrackable) {
        const b = otherCrackable.find((n) => n.essid === a.essid);
        if (!b) continue;
        expect(b.bssid).toBe(a.bssid);
        matched = true;
      }
      if (matched) break;
    }
    expect(matched).toBe(true);
  });
});

describe('crackableEssidPool', () => {
  it('should contain exactly 50 entries', () => {
    expect(crackableEssidPool.length).toBe(50);
  });

  it('should have unique ESSIDs across the pool', () => {
    const essids = crackableEssidPool.map((e) => e.essid);
    expect(new Set(essids).size).toBe(essids.length);
  });

  it('should tag every entry with a valid tier', () => {
    const validTiers: readonly WifiTier[] = ['crowded', 'shared', 'solo'];
    expect(
      crackableEssidPool.every((e) => (validTiers as readonly string[]).includes(e.tier)),
    ).toBe(true);
  });

  it('should include at least one entry for each tier', () => {
    const tiers = new Set(crackableEssidPool.map((e) => e.tier));
    expect(tiers.has('crowded')).toBe(true);
    expect(tiers.has('shared')).toBe(true);
    expect(tiers.has('solo')).toBe(true);
  });
});

describe('noiseEssidPool', () => {
  it('should contain exactly 40 entries', () => {
    expect(noiseEssidPool.length).toBe(40);
  });

  it('should have unique ESSIDs across the pool', () => {
    expect(new Set(noiseEssidPool).size).toBe(noiseEssidPool.length);
  });
});

describe('generateWifiNetworks tier emission', () => {
  it('should set a valid tier on every crackable network', () => {
    const validTiers: readonly WifiTier[] = ['crowded', 'shared', 'solo'];
    for (const seed of ['t1', 't2', 't3', 't4', 't5']) {
      const networks = generateWifiNetworks(seed);
      const crackable = networks.filter((n) => n.crackable);
      for (const net of crackable) {
        expect(net.tier).toBeDefined();
        expect((validTiers as readonly string[]).includes(net.tier as string)).toBe(true);
      }
    }
  });

  it('should leave tier undefined on every noise network', () => {
    for (const seed of ['t1', 't2', 't3', 't4', 't5']) {
      const networks = generateWifiNetworks(seed);
      const noise = networks.filter((n) => !n.crackable);
      expect(noise.every((n) => n.tier === undefined)).toBe(true);
    }
  });

  it('should match the catalog tier for each emitted crackable network', () => {
    const networks = generateWifiNetworks('tier-match-seed');
    const crackable = networks.filter((n) => n.crackable);
    for (const net of crackable) {
      const poolEntry = crackableEssidPool.find((e) => e.essid === net.essid);
      expect(poolEntry).toBeDefined();
      expect(net.tier).toBe(poolEntry!.tier);
    }
  });
});
