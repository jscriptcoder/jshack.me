import { describe, expect, it } from 'vitest';
import { mergeLanOccupants, withSelfHost } from './mergeLanOccupants';
import type { OccupantProjection } from './resolveOccupants';
import type { HomeLan, LanHost } from '../generation/generateHomeLan';

/**
 * `mergeLanOccupants` overlays the REAL same-LAN occupants (the server occupant read)
 * onto a viewer's GENERATED home-LAN topology, so an `nmap <subnet>` from inside the
 * LAN shows fellow players as real hosts. On an octet collision the OCCUPANT wins: a
 * generated host whose last octet a real occupant claims is dropped and the occupant
 * added in its place. The caller is already excluded server-side, so the viewer's own
 * host is not an occupant here.
 */

const SUBNET = '192.168.50';

const host = (octet: number, hostname: string, kind: LanHost['kind'] = 'machine'): LanHost => ({
  ip: `${SUBNET}.${octet}`,
  hostname,
  kind,
});

const lan = (hosts: readonly LanHost[]): HomeLan => ({ subnet: SUBNET, hosts });

const occupant = (octet: number, machineName: string, id = `ws-${octet}`): OccupantProjection => ({
  workstation_machine_id: id,
  localIp: `${SUBNET}.${octet}`,
  machineName,
});

const octetsOf = (result: HomeLan): readonly number[] =>
  result.hosts.map((entry) => Number(entry.ip.split('.')[3]));

describe('mergeLanOccupants', () => {
  it('leaves the generated LAN unchanged when there are no occupants', () => {
    const generated = lan([host(1, 'router-x', 'router'), host(50, 'self-box'), host(120, 'tv-120')]);

    expect(mergeLanOccupants(generated, [])).toEqual(generated);
  });

  it('adds an occupant as a machine host at its LAN IP carrying its real machine name', () => {
    const generated = lan([host(1, 'router-x', 'router'), host(50, 'self-box')]);

    const merged = mergeLanOccupants(generated, [occupant(88, 'alice-rig')]);

    expect(merged.hosts).toContainEqual({ ip: `${SUBNET}.88`, hostname: 'alice-rig', kind: 'machine' });
    // The viewer's own host and the gateway both survive the merge.
    expect(merged.hosts).toContainEqual(host(1, 'router-x', 'router'));
    expect(merged.hosts).toContainEqual(host(50, 'self-box'));
  });

  it('keeps the merged hosts in ascending octet order', () => {
    const generated = lan([host(1, 'router-x', 'router'), host(120, 'tv-120'), host(50, 'self-box')]);

    const merged = mergeLanOccupants(generated, [occupant(88, 'alice-rig'), occupant(20, 'bob-rig')]);

    expect(octetsOf(merged)).toEqual([1, 20, 50, 88, 120]);
  });

  it('drops a generated NPC on an octet collision — the real occupant wins', () => {
    const generated = lan([host(1, 'router-x', 'router'), host(70, 'desktop-70'), host(50, 'self-box')]);

    const merged = mergeLanOccupants(generated, [occupant(70, 'alice-rig')]);

    // Exactly one host sits on .70, and it is the occupant — the NPC is gone.
    const onSeventy = merged.hosts.filter((entry) => entry.ip === `${SUBNET}.70`);
    expect(onSeventy).toEqual([{ ip: `${SUBNET}.70`, hostname: 'alice-rig', kind: 'machine' }]);
    expect(merged.hosts).not.toContainEqual(host(70, 'desktop-70'));
  });

  it('merges multiple occupants alongside the surviving generated hosts', () => {
    const generated = lan([host(1, 'router-x', 'router'), host(50, 'self-box'), host(70, 'desktop-70')]);

    const merged = mergeLanOccupants(generated, [occupant(70, 'alice-rig'), occupant(200, 'bob-rig')]);

    expect(octetsOf(merged)).toEqual([1, 50, 70, 200]);
    expect(merged.hosts.find((entry) => entry.ip === `${SUBNET}.70`)?.hostname).toBe('alice-rig');
    expect(merged.hosts.find((entry) => entry.ip === `${SUBNET}.200`)?.hostname).toBe('bob-rig');
  });

  it('lets an occupant win over the inner gateway — no occupant is hidden', () => {
    // The gateway used to hold its octet and drop the occupant, protecting the viewer's
    // own depth entry. That only made sense while the population was private to the
    // viewer and no allocator could see it. The octet is now excluded at lease time,
    // so this collision does not arise from allocation — and a player answering at an
    // address must not be invisible to a scan of that address.
    const generated = lan([host(1, 'router-x', 'router'), host(25, 'inner-gw', 'router'), host(50, 'self-box')]);

    const merged = mergeLanOccupants(generated, [occupant(25, 'alice-rig')]);

    const onTwentyFive = merged.hosts.filter((entry) => entry.ip === `${SUBNET}.25`);
    expect(onTwentyFive).toEqual([{ ip: `${SUBNET}.25`, hostname: 'alice-rig', kind: 'machine' }]);
  });

  it('lets an occupant win over the inner switch — the second gateway kind is no different', () => {
    const generated = lan([host(1, 'router-x', 'router'), host(80, 'sw-80', 'switch'), host(50, 'self-box')]);

    const merged = mergeLanOccupants(generated, [occupant(80, 'alice-rig')]);

    const onEighty = merged.hosts.filter((entry) => entry.ip === `${SUBNET}.80`);
    expect(onEighty).toEqual([{ ip: `${SUBNET}.80`, hostname: 'alice-rig', kind: 'machine' }]);
  });

  it('resolves every collision the same way, whatever kind the generated host is', () => {
    const generated = lan([
      host(1, 'router-x', 'router'),
      host(25, 'inner-gw', 'router'),
      host(70, 'desktop-70'),
      host(80, 'sw-80', 'switch'),
      host(50, 'self-box'),
    ]);

    const merged = mergeLanOccupants(generated, [
      occupant(25, 'gw-crasher'), // collides with a router → occupant wins
      occupant(70, 'alice-rig'), // collides with a machine → occupant wins
      occupant(200, 'bob-rig'), // free octet → added
    ]);

    for (const [octet, name] of [
      [25, 'gw-crasher'],
      [70, 'alice-rig'],
      [200, 'bob-rig'],
    ] as const) {
      expect(merged.hosts.find((entry) => entry.ip === `${SUBNET}.${octet}`)).toEqual({
        ip: `${SUBNET}.${octet}`,
        hostname: name,
        kind: 'machine',
      });
    }
    expect(merged.hosts).not.toContainEqual(host(25, 'inner-gw', 'router'));
    expect(merged.hosts).not.toContainEqual(host(70, 'desktop-70'));
    // The uncontested switch and gateway keep their slots.
    expect(merged.hosts.find((entry) => entry.ip === `${SUBNET}.80`)).toEqual(host(80, 'sw-80', 'switch'));
    expect(octetsOf(merged)).toEqual([1, 25, 50, 70, 80, 200]);
  });
});

describe('withSelfHost', () => {
  it('keeps the hosts in ascending octet order with the player spliced into place', () => {
    const generated = lan([host(1, 'gw', 'router'), host(20, 'tablet-20'), host(90, 'laptop-90')]);

    const placed = withSelfHost(generated, `${SUBNET}.40`, 'iphone-40');

    // `HomeLan` promises ascending-octet order, so the player belongs at its position
    // rather than appended after hosts it sorts before.
    expect(placed.hosts.map((entry) => entry.ip)).toEqual([
      `${SUBNET}.1`,
      `${SUBNET}.20`,
      `${SUBNET}.40`,
      `${SUBNET}.90`,
    ]);
  });

  it('takes over its leased octet from a generated host', () => {
    const generated = lan([host(1, 'gw', 'router'), host(40, 'tablet-40')]);

    const placed = withSelfHost(generated, `${SUBNET}.40`, 'iphone-40');

    // The lease is the authority on who answers at an address â€” unlike a fellow
    // occupant, the viewer cannot be omitted from its own LAN.
    expect(placed.hosts).toEqual([
      host(1, 'gw', 'router'),
      { ip: `${SUBNET}.40`, hostname: 'iphone-40', kind: 'machine' },
    ]);
  });
});
