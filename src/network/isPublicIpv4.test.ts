import { describe, it, expect } from 'vitest';
import { isPublicIpv4 } from './isPublicIpv4';

describe('isPublicIpv4', () => {
  describe('public ranges', () => {
    it.each([
      // The generator picks from publicFirstOctets in src/generation/ip.ts —
      // every one of those must be classified public so foreign-IP resolution
      // doesn't skip arbitrary game-allocated addresses.
      '45.10.20.30',
      '51.146.70.192',
      '62.1.2.3',
      '78.100.50.25',
      '91.200.30.5',
      '103.45.67.89',
      '138.197.1.1',
      '162.243.10.20',
      '185.50.60.70',
      '198.51.100.7', // TEST-NET-2 — used by world_networks
      '203.0.113.42', // TEST-NET-3 — used by home/world allocator
      '212.110.0.55',
    ])('classifies %s as public', (ip) => {
      expect(isPublicIpv4(ip)).toBe(true);
    });
  });

  describe('private and reserved ranges', () => {
    it.each([
      ['10.0.0.1', '10/8 RFC1918'],
      ['10.255.255.255', '10/8 boundary'],
      ['172.16.0.1', '172.16-31/12 RFC1918'],
      ['172.20.50.50', '172.16-31/12 middle'],
      ['172.31.255.254', '172.16-31/12 upper boundary'],
      ['192.168.1.100', '192.168/16 RFC1918'],
      ['192.168.255.255', '192.168/16 boundary'],
      ['127.0.0.1', 'loopback'],
      ['127.45.10.20', '127/8 anywhere is loopback'],
      ['169.254.10.20', '169.254/16 link-local'],
      ['0.0.0.0', 'unspecified'],
      ['0.255.255.255', '0/8 reserved'],
      ['224.0.0.1', 'multicast 224+'],
      ['255.255.255.255', 'broadcast'],
    ])('classifies %s as non-public (%s)', (ip) => {
      expect(isPublicIpv4(ip)).toBe(false);
    });

    it('classifies 172.15.x.x as PUBLIC (just below the private range)', () => {
      // Boundary check: the RFC1918 second-octet range is 16-31. 15 is
      // outside it and therefore public. Easy off-by-one to introduce.
      expect(isPublicIpv4('172.15.10.20')).toBe(true);
    });

    it('classifies 172.32.x.x as PUBLIC (just above the private range)', () => {
      expect(isPublicIpv4('172.32.10.20')).toBe(true);
    });
  });

  describe('malformed inputs', () => {
    it.each([
      '',
      'not-an-ip',
      '1.2.3',
      '1.2.3.4.5',
      '1.2.3.256',
      '256.1.2.3',
      'abc.def.ghi.jkl',
      '1.2.3.',
      '.1.2.3',
      '1..2.3',
    ])('rejects %s', (input) => {
      expect(isPublicIpv4(input)).toBe(false);
    });
  });
});
