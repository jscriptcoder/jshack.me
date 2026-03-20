import { describe, it, expect } from 'vitest';
import { generateWifiNetworks } from './generateWifi';

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
});
