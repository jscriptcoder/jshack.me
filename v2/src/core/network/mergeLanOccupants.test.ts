import { describe, expect, it } from 'vitest';
import { mergeLanOccupants } from './mergeLanOccupants';
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
});
