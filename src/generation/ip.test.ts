import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { publicFirstOctets, generatePublicIp, generatePrivateSubnet } from './ip';

describe('publicFirstOctets', () => {
  it('contains exactly 12 realistic hosting/cloud prefixes', () => {
    expect(publicFirstOctets).toEqual([45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212]);
  });
});

describe('generatePublicIp', () => {
  it('returns a valid dotted-quad IP', () => {
    const ip = generatePublicIp(createPrng('test'));
    expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('uses a first octet from the known prefix pool', () => {
    for (let i = 0; i < 20; i++) {
      const ip = generatePublicIp(createPrng(`pub-${i}`));
      const firstOctet = Number(ip.split('.')[0]);
      expect(publicFirstOctets).toContain(firstOctet);
    }
  });

  it('generates octets within valid ranges', () => {
    for (let i = 0; i < 20; i++) {
      const ip = generatePublicIp(createPrng(`range-${i}`));
      const [, o2, o3, o4] = ip.split('.').map(Number);
      expect(o2).toBeGreaterThanOrEqual(1);
      expect(o2).toBeLessThanOrEqual(254);
      expect(o3).toBeGreaterThanOrEqual(1);
      expect(o3).toBeLessThanOrEqual(254);
      expect(o4).toBeGreaterThanOrEqual(2);
      expect(o4).toBeLessThanOrEqual(254);
    }
  });

  it('is deterministic for the same seed', () => {
    const ip1 = generatePublicIp(createPrng('determinism'));
    const ip2 = generatePublicIp(createPrng('determinism'));
    expect(ip1).toBe(ip2);
  });

  it('produces varied first octets across seeds', () => {
    const firstOctets = new Set(
      Array.from({ length: 30 }, (_, i) => {
        const ip = generatePublicIp(createPrng(`variety-${i}`));
        return Number(ip.split('.')[0]);
      }),
    );
    expect(firstOctets.size).toBeGreaterThanOrEqual(3);
  });
});

describe('generatePrivateSubnet', () => {
  it('returns a valid 3-octet subnet prefix', () => {
    const subnet = generatePrivateSubnet(createPrng('test'));
    const parts = subnet.split('.');
    expect(parts.length).toBe(3);
    parts.forEach((p) => expect(Number(p)).not.toBeNaN());
  });

  it('produces only RFC 1918 ranges', () => {
    for (let i = 0; i < 50; i++) {
      const subnet = generatePrivateSubnet(createPrng(`rfc-${i}`));
      const [o1, o2] = subnet.split('.').map(Number);
      const isClass10 = o1 === 10;
      const isClass172 = o1 === 172 && o2! >= 16 && o2! <= 31;
      const isClass192 = o1 === 192;
      expect(isClass10 || isClass172 || isClass192).toBe(true);
    }
  });

  it('avoids 192.168.1.x', () => {
    for (let i = 0; i < 50; i++) {
      const subnet = generatePrivateSubnet(createPrng(`avoid-${i}`));
      expect(subnet).not.toBe('192.168.1');
    }
  });

  it('is deterministic for the same seed', () => {
    const s1 = generatePrivateSubnet(createPrng('determinism'));
    const s2 = generatePrivateSubnet(createPrng('determinism'));
    expect(s1).toBe(s2);
  });

  it('produces all three RFC 1918 range types across seeds', () => {
    const prefixes = new Set(
      Array.from({ length: 50 }, (_, i) => {
        const subnet = generatePrivateSubnet(createPrng(`range-type-${i}`));
        return Number(subnet.split('.')[0]);
      }),
    );
    expect(prefixes.has(10)).toBe(true);
    expect(prefixes.has(172)).toBe(true);
    expect(prefixes.has(192)).toBe(true);
  });
});
