import { describe, expect, it } from 'vitest';
import { generateHomeLan } from './generateHomeLan';
import { assignHomeNetwork } from '../network/homeNetwork';

/**
 * `generateHomeLan` is the pure topology generator behind `nmap <subnet>`. Given
 * the player's identity + the ESSID they're connected to, it derives the LAN
 * they sit on: the gateway at `.1` and the player's own host (Slice 1 — sibling
 * hosts arrive in Slice 2). It reuses `assignHomeNetwork` so the subnet it
 * reports always matches the address the player was actually issued.
 */

const PUBKEY = 'a'.repeat(64);

describe('generateHomeLan', () => {
  it('derives the subnet from the player’s own assignment', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    const { localIp } = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');

    expect(lan.subnet).toBe(localIp.split('.').slice(0, 3).join('.'));
  });

  it('places the gateway at .1 as a router, ahead of the player host', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');

    // Gateway is first (octet .1 sorts ahead of the player's host octet >= 2).
    expect(lan.hosts[0]).toEqual({ ip: `${lan.subnet}.1`, hostname: 'gateway', kind: 'router' });
  });

  it('includes the player’s own host with its assigned hostname', () => {
    const lan = generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI');
    const { localIp, hostname } = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');

    const self = lan.hosts.find((host) => host.ip === localIp);
    expect(self).toEqual({ ip: localIp, hostname, kind: 'machine' });
  });

  it('is deterministic for the same identity + ESSID (golden)', () => {
    // Pinned to the assignHomeNetwork golden (192.168.188.154 / iphone-154).
    expect(generateHomeLan(PUBKEY, 'BEAN-THERE-WIFI')).toEqual({
      subnet: '192.168.188',
      hosts: [
        { ip: '192.168.188.1', hostname: 'gateway', kind: 'router' },
        { ip: '192.168.188.154', hostname: 'iphone-154', kind: 'machine' },
      ],
    });
  });
});
