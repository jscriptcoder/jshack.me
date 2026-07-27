import { describe, expect, it } from 'vitest';
import { buildWorkstationPortResolver } from './workstationPortResolver';
import { generateIdentity } from '../identity/identity';
import { md5 } from '../generation/md5';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';

/**
 * `buildWorkstationPortResolver` is the server-side `resolveTargetPorts` that the
 * single `scanResult` total function consumes (Story 5.1.3b). It answers, for a NAT
 * forward's `internalIp`, "what ports is the host behind that forward serving?" —
 * resolving the one workstation behind a player's router by the LAN address that
 * player LEASES, materializing it from base + journal, and reading its open ports. A forward is
 * only surfaced on the public IP while its target is actually up, so this resolver is
 * the liveness gate: a fresh workstation has an empty `/var/run`, so it advertises
 * nothing until its `sshd` pidfile is planted on the journal.
 */

const OWNER = generateIdentity();
const ESSID = 'CoffeeShopWiFi';

const target = (over: Partial<ReturnType<typeof baseTarget>> = {}) => ({
  ...baseTarget(),
  ...over,
});

const baseTarget = () => ({
  owner_key: OWNER.publicKeyHex,
  essid: ESSID,
  workstation_username: 'neo',
  workstation_root_hash: md5('toor'),
});

/** A's workstation LAN IP — the LEASED address a forward must target to reach it (the
 *  same value A's `nano` edit writes into `rules.v4`). The handler reads it from the
 *  lease and passes it in; here it stands for whatever that read returned. */
const wsLanIp = '192.168.29.84';

/** A journal row that plants the workstation's running-sshd pidfile (A started the
 *  daemon) — `/var/run/sshd.pid` = `sshd:port=22`, the byte-shape every reader parses. */
const sshdUp: OwnerPatchRow = {
  path: '/var/run/sshd.pid',
  content: 'sshd:port=22',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: OWNER.publicKeyHex,
};

/** A root `rm /boot/vmlinuz` on the workstation's journal — replayed, it deletes the
 *  kernel so the box is bricked (`canBoot` false): it can't come up, so it answers
 *  nothing behind the NAT even if a stale `sshd` pidfile lingers. */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-17T00:00:01.000Z',
  writer_key: OWNER.publicKeyHex,
};

describe('buildWorkstationPortResolver', () => {
  it("returns the workstation's open ports for its own LAN IP when its sshd is up", () => {
    const resolve = buildWorkstationPortResolver({
      target: target(),
      workstationPatches: [sshdUp],
      lanIp: wsLanIp,
    });

    expect(resolve(wsLanIp)).toEqual([{ port: 22, service: 'ssh' }]);
  });

  it('returns nothing for the LAN IP when the workstation sshd is down (empty journal)', () => {
    const resolve = buildWorkstationPortResolver({
      target: target(),
      workstationPatches: [],
      lanIp: wsLanIp,
    });

    expect(resolve(wsLanIp)).toEqual([]);
  });

  it('returns nothing for the LAN IP when the workstation is bricked, even though its sshd pidfile lingers', () => {
    const resolve = buildWorkstationPortResolver({
      target: target(),
      workstationPatches: [sshdUp, bootTombstone],
      lanIp: wsLanIp,
    });

    // A bricked box (a /boot tombstone) can't come up, so its forward goes dark — the
    // lingering pidfile must NOT keep a dead host reachable behind the NAT.
    expect(resolve(wsLanIp)).toEqual([]);
  });

  it('returns nothing for an internal IP that is not the workstation (dead forward)', () => {
    const resolve = buildWorkstationPortResolver({
      target: target(),
      workstationPatches: [sshdUp],
      lanIp: wsLanIp,
    });

    expect(resolve('192.168.0.254')).toEqual([]);
  });

  it('treats a null journal as no running services', () => {
    const resolve = buildWorkstationPortResolver({
      target: target(),
      workstationPatches: null,
      lanIp: wsLanIp,
    });

    expect(resolve(wsLanIp)).toEqual([]);
  });
});
