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

  it('keeps the inner gateway and OMITS an occupant that collides with it', () => {
    // The inner gateway is the player's private depth entry — a busy AP must not eat it.
    const generated = lan([host(1, 'router-x', 'router'), host(25, 'inner-gw', 'router'), host(50, 'self-box')]);

    const merged = mergeLanOccupants(generated, [occupant(25, 'alice-rig')]);

    // The gateway holds its octet; the colliding occupant is not drawn on this LAN.
    const onTwentyFive = merged.hosts.filter((entry) => entry.ip === `${SUBNET}.25`);
    expect(onTwentyFive).toEqual([host(25, 'inner-gw', 'router')]);
    expect(merged.hosts).not.toContainEqual({ ip: `${SUBNET}.25`, hostname: 'alice-rig', kind: 'machine' });
  });

  it('keeps the inner switch and OMITS an occupant that collides with it', () => {
    const generated = lan([host(1, 'router-x', 'router'), host(80, 'sw-80', 'switch'), host(50, 'self-box')]);

    const merged = mergeLanOccupants(generated, [occupant(80, 'alice-rig')]);

    const onEighty = merged.hosts.filter((entry) => entry.ip === `${SUBNET}.80`);
    expect(onEighty).toEqual([host(80, 'sw-80', 'switch')]);
    expect(merged.hosts).not.toContainEqual({ ip: `${SUBNET}.80`, hostname: 'alice-rig', kind: 'machine' });
  });

  it('reserves gateway/switch octets yet still lets occupants win over generated machines', () => {
    const generated = lan([
      host(1, 'router-x', 'router'),
      host(25, 'inner-gw', 'router'),
      host(70, 'desktop-70'),
      host(80, 'sw-80', 'switch'),
      host(50, 'self-box'),
    ]);

    const merged = mergeLanOccupants(generated, [
      occupant(25, 'gw-crasher'), // collides with the gateway → omitted
      occupant(70, 'alice-rig'), // collides with a generated machine → occupant wins
      occupant(200, 'bob-rig'), // free octet → added
    ]);

    // Gateway and switch survive on their own octets.
    expect(merged.hosts.find((entry) => entry.ip === `${SUBNET}.25`)).toEqual(host(25, 'inner-gw', 'router'));
    expect(merged.hosts.find((entry) => entry.ip === `${SUBNET}.80`)).toEqual(host(80, 'sw-80', 'switch'));
    expect(merged.hosts).not.toContainEqual({ ip: `${SUBNET}.25`, hostname: 'gw-crasher', kind: 'machine' });
    // The machine-colliding occupant still wins; the NPC is dropped.
    expect(merged.hosts.find((entry) => entry.ip === `${SUBNET}.70`)).toEqual({
      ip: `${SUBNET}.70`,
      hostname: 'alice-rig',
      kind: 'machine',
    });
    expect(merged.hosts).not.toContainEqual(host(70, 'desktop-70'));
    // The free-octet occupant is added.
    expect(merged.hosts.find((entry) => entry.ip === `${SUBNET}.200`)?.hostname).toBe('bob-rig');
    expect(octetsOf(merged)).toEqual([1, 25, 50, 70, 80, 200]);
  });
});

/**
 * `withSelfHost` places the VIEWER's own host on the generated filler at the address
 * wlan0 holds — its lease. The generator does not place the player (it is a pure
 * identity+ESSID derivation with no view of the lease store), and the two disagree
 * for a player the server relocated off a contested octet.
 */
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

    // The lease is the authority on who answers at an address — unlike a fellow
    // occupant, the viewer cannot be omitted from its own LAN.
    expect(placed.hosts).toEqual([
      host(1, 'gw', 'router'),
      { ip: `${SUBNET}.40`, hostname: 'iphone-40', kind: 'machine' },
    ]);
  });
});
