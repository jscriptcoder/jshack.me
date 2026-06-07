import { describe, expect, it } from 'vitest';
import { createPrng } from './prng';
import { generatePublicIp, publicFirstOctets } from './ip';

/**
 * `generatePublicIp` is the seeded WAN/public-IP generator (ported from legacy
 * `src/generation/ip.ts`). It draws a routable, non-RFC1918 address so a home
 * router / themed network has a believable public face. Determinism is the
 * contract: the same seed always yields the same IP, so a public IP can be
 * re-derived from a stable namespace (e.g. an ESSID) without storing it.
 */

describe('generatePublicIp', () => {
  it('is deterministic for a given seed', () => {
    const first = generatePublicIp(createPrng('acme-corp'));
    const second = generatePublicIp(createPrng('acme-corp'));

    expect(second).toBe(first);
  });

  it('always draws the first octet from the routable public-prefix pool', () => {
    // Sweep many seeds: the leading octet is ALWAYS one of the realistic
    // hosting prefixes, so the address can never collide with an RFC1918
    // private range (10/172.16-31/192.168) or loopback by construction.
    for (let seed = 0; seed < 100; seed++) {
      const firstOctet = Number(generatePublicIp(createPrng(`net-${seed}`)).split('.')[0]);
      expect(publicFirstOctets).toContain(firstOctet);
    }
  });

  it('keeps the remaining octets inside their host ranges', () => {
    for (let seed = 0; seed < 100; seed++) {
      const [, second, third, fourth] = generatePublicIp(createPrng(`host-${seed}`))
        .split('.')
        .map(Number);

      // Octets 2-3 span 1-254; the final octet starts at 2 (avoiding a .0/.1
      // network/gateway address), matching the legacy generator.
      expect(second).toBeGreaterThanOrEqual(1);
      expect(second).toBeLessThanOrEqual(254);
      expect(third).toBeGreaterThanOrEqual(1);
      expect(third).toBeLessThanOrEqual(254);
      expect(fourth).toBeGreaterThanOrEqual(2);
      expect(fourth).toBeLessThanOrEqual(254);
    }
  });

  it('derives the exact address for a fixed seed (golden lock)', () => {
    // Pins the draw order (first octet, then octets 2/3/4) and every range.
    expect(generatePublicIp(createPrng('GOLDEN-SEED'))).toBe('203.104.5.165');
  });
});
