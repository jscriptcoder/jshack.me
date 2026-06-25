import { describe, expect, it } from 'vitest';
import { assignHomeNetwork } from './homeNetwork';

/**
 * `assignHomeNetwork` is the local-deterministic stand-in for the future
 * server-authoritative home-network join (grill-me decision 6). Given the
 * player's identity pubkey and the ESSID they connected to, it derives a stable
 * LAN address + hostname. It is the only seam `nmcli` awaits, so its determinism
 * is what makes a reconnect survive a reload (the same identity + ESSID always
 * re-derives the same IP). The exact values are golden-locked so a mutation to
 * the derivation (octet ranges, seed string, draw order) changes the output.
 */

const PUBKEY = 'a'.repeat(64);

describe('assignHomeNetwork', () => {
  it('derives a stable assignment for a given identity + ESSID', () => {
    const first = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');
    const second = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');

    // Determinism is the load-bearing property: rehydration re-derives this.
    expect(second).toEqual(first);
    // Golden lock — pins the seed strings, the octet ranges, and the draw order.
    // The /24 (third octet, 29) is seeded by the ESSID alone; the host octet (188)
    // and device by identity+ESSID.
    expect(first).toEqual({
      localIp: '192.168.29.188',
      hostname: 'iphone-188',
    });
  });

  it('places the host on a 192.168.0.0/16 private network', () => {
    const { localIp } = assignHomeNetwork(PUBKEY, 'GRAD-STUDENT-WIFI');
    const match = /^192\.168\.(\d{1,3})\.(\d{1,3})$/.exec(localIp);
    if (match === null) throw new Error(`unexpected localIp shape: ${localIp}`);

    const subnet = Number(match[1]);
    const host = Number(match[2]);
    // Subnet octet spans the full byte; the host octet avoids .0/.1 (network +
    // gateway) and .255 (broadcast), so it is always a usable host address.
    expect(subnet).toBeGreaterThanOrEqual(0);
    expect(subnet).toBeLessThanOrEqual(255);
    expect(host).toBeGreaterThanOrEqual(2);
    expect(host).toBeLessThanOrEqual(254);
  });

  it('derives a different assignment per ESSID under the same identity', () => {
    const bean = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');
    const grad = assignHomeNetwork(PUBKEY, 'GRAD-STUDENT-WIFI');

    expect(grad).not.toEqual(bean);
  });

  it('derives a different assignment per identity for the same ESSID', () => {
    const alice = assignHomeNetwork('a'.repeat(64), 'BEAN-THERE-WIFI');
    const bob = assignHomeNetwork('b'.repeat(64), 'BEAN-THERE-WIFI');

    expect(bob).not.toEqual(alice);
  });

  it('places different identities on the same /24 for the same ESSID', () => {
    const alice = assignHomeNetwork('a'.repeat(64), 'BEAN-THERE-WIFI');
    const bob = assignHomeNetwork('b'.repeat(64), 'BEAN-THERE-WIFI');

    const slashTwentyFour = (ip: string): string => ip.split('.').slice(0, 3).join('.');
    const hostOctet = (ip: string): string => ip.split('.')[3]!;

    // The /24 belongs to the AP, not the player: every occupant of the same ESSID
    // shares the subnet (seeded by ESSID alone). This is the addressing precondition
    // the shared-LAN occupancy model stands on — two identities on one ESSID must be
    // reachable on one LAN.
    expect(slashTwentyFour(bob.localIp)).toBe(slashTwentyFour(alice.localIp));
    // ...while their host octets still differ (per-(identity, ESSID) draw), so
    // they are distinct hosts on that shared subnet.
    expect(hostOctet(bob.localIp)).not.toBe(hostOctet(alice.localIp));
  });

  it('places a given identity on a different /24 per ESSID', () => {
    const bean = assignHomeNetwork(PUBKEY, 'BEAN-THERE-WIFI');
    const grad = assignHomeNetwork(PUBKEY, 'GRAD-STUDENT-WIFI');

    const slashTwentyFour = (ip: string): string => ip.split('.').slice(0, 3).join('.');

    // Different networks are different LANs: the subnet must track the ESSID, not
    // be a constant — this is what fails if the ESSID drops out of the subnet seed.
    expect(slashTwentyFour(grad.localIp)).not.toBe(slashTwentyFour(bean.localIp));
  });

  it('names the hostname after the assigned host octet', () => {
    const { localIp, hostname } = assignHomeNetwork(PUBKEY, 'GRAD-STUDENT-WIFI');
    const hostOctet = localIp.split('.')[3];

    // The hostname carries the host octet, so it tracks the IP it was issued
    // with — the future occupant flow keys on this pairing.
    expect(hostname.endsWith(`-${hostOctet}`)).toBe(true);
  });
});
