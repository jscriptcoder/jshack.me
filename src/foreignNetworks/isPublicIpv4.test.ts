import { describe, it, expect } from 'vitest';
import { isPublicIpv4 } from './isPublicIpv4';

describe('isPublicIpv4', () => {
  describe('public IPv4 addresses', () => {
    it.each([
      '8.8.8.8',
      '1.0.0.1',
      '162.174.39.103',
      '212.65.111.65',
      '9.255.255.255', // boundary just below RFC1918 10/8
      '11.0.0.0', // boundary just above RFC1918 10/8
      '172.15.255.255', // boundary just below RFC1918 172.16/12
      '172.32.0.0', // boundary just above RFC1918 172.16/12
      '192.167.255.255', // boundary just below RFC1918 192.168/16
      '192.169.0.0', // boundary just above RFC1918 192.168/16
      '100.63.255.255', // boundary just below CGNAT 100.64/10
      '100.128.0.0', // boundary just above CGNAT 100.64/10
      '126.255.255.255', // boundary just below loopback 127/8
      '128.0.0.0', // boundary just above loopback 127/8
      '169.253.255.255', // boundary just below link-local 169.254/16
      '169.255.0.0', // boundary just above link-local 169.254/16
      '223.255.255.255', // boundary just below multicast 224/4
    ])('treats %s as public', (ip) => {
      expect(isPublicIpv4(ip)).toBe(true);
    });

    it('treats RFC 5737 documentation ranges as public (game uses them)', () => {
      // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 are reserved for
      // docs in the real world but the game assigns them to playground /
      // techparts.io / world networks. Keeping them "public" lets the
      // cross-LAN resolver treat them like any other public IP.
      expect(isPublicIpv4('192.0.2.42')).toBe(true);
      expect(isPublicIpv4('198.51.100.20')).toBe(true);
      expect(isPublicIpv4('203.0.113.42')).toBe(true);
    });
  });

  describe('private / reserved IPv4 ranges', () => {
    it.each([
      // RFC1918 10/8
      '10.0.0.0',
      '10.255.255.255',
      // RFC1918 172.16/12
      '172.16.0.0',
      '172.31.255.255',
      // RFC1918 192.168/16
      '192.168.0.0',
      '192.168.1.1',
      '192.168.255.255',
      // Loopback 127/8
      '127.0.0.1',
      '127.0.0.0',
      '127.255.255.255',
      // Link-local 169.254/16
      '169.254.0.0',
      '169.254.1.1',
      '169.254.255.255',
      // CGNAT 100.64/10
      '100.64.0.0',
      '100.64.0.1',
      '100.127.255.255',
      // 0/8 — "this network"
      '0.0.0.0',
      '0.255.255.255',
      // Multicast 224/4
      '224.0.0.1',
      '239.255.255.255',
      // Reserved 240/4 (includes 255.255.255.255 broadcast)
      '240.0.0.0',
      '255.255.255.255',
    ])('treats %s as NOT public', (ip) => {
      expect(isPublicIpv4(ip)).toBe(false);
    });
  });

  describe('invalid inputs', () => {
    it.each([
      '',
      'not-an-ip',
      '1.2.3', // too few octets
      '1.2.3.4.5', // too many octets
      '256.0.0.0', // octet > 255
      '300.1.1.1',
      '-1.0.0.0',
      '1.2.3.x',
      '::1', // IPv6 loopback
      '2001:db8::1', // IPv6
      '192.168.1.1/24', // CIDR suffix
      '192.168 .1.1', // embedded space
    ])('rejects %s', (ip) => {
      expect(isPublicIpv4(ip)).toBe(false);
    });
  });
});
