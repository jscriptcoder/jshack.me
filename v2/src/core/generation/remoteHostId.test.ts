import { describe, expect, it } from 'vitest';
import { hostForMachineId, hostMachineId } from './remoteHostId';
import { generateHomeLan } from './generateHomeLan';
import { deriveHostnameSuffix } from '../identity/workstation';
import type { LanHost } from './generateHomeLan';

/**
 * A generated NPC host's `machine_id` is derived from its network COORDINATES
 * (`essid` + `ip`), in a namespace distinct from a player's `'ed25519:'`
 * workstation id — so `isOwnWorkstation` never mistakes it for the player's box,
 * and the same host keeps the same id across reloads (forward-compatible with
 * shared LANs). `hostForMachineId` is the reverse: regenerate the current LAN and
 * find the host whose coordinate id matches (the client recovers the IP that the
 * one-way suffix can't be inverted to).
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';

const host = (ip: string, hostname: string): LanHost => ({ ip, hostname, kind: 'machine' });

describe('hostMachineId', () => {
  it('is `${hostname}-${suffix}` where suffix = sha256("host:"+essid+":"+ip)[0..8]', () => {
    const target = host('192.168.50.108', 'laptop-108');
    expect(hostMachineId(target, ESSID)).toBe(
      `laptop-108-${deriveHostnameSuffix(`host:${ESSID}:192.168.50.108`)}`,
    );
  });

  it('is deterministic', () => {
    const target = host('192.168.50.108', 'laptop-108');
    expect(hostMachineId(target, ESSID)).toBe(hostMachineId(target, ESSID));
  });

  it('uses a DIFFERENT namespace from a workstation id (not the "ed25519:" suffix)', () => {
    const target = host('192.168.50.108', 'laptop-108');
    const suffix = hostMachineId(target, ESSID).split('-').at(-1);
    expect(suffix).not.toBe(deriveHostnameSuffix(`ed25519:${PUBKEY}`));
  });

  it('re-rolls the suffix when the ESSID or the IP changes', () => {
    const a = hostMachineId(host('192.168.50.108', 'laptop-108'), 'NET-A');
    const essidChanged = hostMachineId(host('192.168.50.108', 'laptop-108'), 'NET-B');
    const ipChanged = hostMachineId(host('192.168.50.109', 'laptop-108'), 'NET-A');
    expect(a).not.toBe(essidChanged);
    expect(a).not.toBe(ipChanged);
  });
});

describe('hostForMachineId (reverse resolver)', () => {
  it('round-trips: an id minted from a LAN host resolves back to that exact host', () => {
    const lan = generateHomeLan(ESSID);
    const target = lan.hosts.at(-1)!; // any host on the regenerated LAN
    const id = hostMachineId(target, ESSID);
    expect(hostForMachineId(ESSID, id)).toEqual(target);
  });

  it('returns null for an id that matches no host on the current LAN', () => {
    expect(hostForMachineId(ESSID, 'ghost-00000000')).toBeNull();
  });

  it('returns null when the id is resolved against a different network’s LAN', () => {
    const id = hostMachineId(generateHomeLan(ESSID).hosts.at(-1)!, ESSID);
    // Another access point's LAN sits on a different subnet with its own population,
    // so that coordinate id is absent — the resolver must not hallucinate a match.
    expect(hostForMachineId('NAKATOMI-PLAZA', id)).toBeNull();
  });

  it('resolves an id to the same host for every occupant of the network', () => {
    // The reverse lookup used to regenerate the LOOKER's private LAN, so one occupant's
    // id landed on a different machine — or on nothing — for anybody else. Two NPCs at
    // one octet could even mint the SAME id from a 6-name pool, quietly sharing a
    // journal between two boxes that were not the same box.
    const target = generateHomeLan(ESSID).hosts.at(-1)!;

    expect(hostForMachineId(ESSID, hostMachineId(target, ESSID))).toEqual(target);
  });
});
