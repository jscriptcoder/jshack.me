import { describe, expect, it } from 'vitest';
import { buildWorkstationPortResolver } from './workstationPortResolver';
import { generateIdentity } from '../identity/identity';
import { assignHomeNetwork } from '../network/homeNetwork';
import { md5 } from '../generation/md5';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';

/**
 * `buildWorkstationPortResolver` is the server-side `resolveTargetPorts` that the
 * single `scanResult` total function consumes (Story 5.1.3b). It answers, for a NAT
 * forward's `internalIp`, "what ports is the host behind that forward serving?" —
 * resolving the one workstation behind a player's router by its deterministic LAN
 * IP, materializing it from base + journal, and reading its open ports. A forward is
 * only surfaced on the public IP while its target is actually up, so this resolver is
 * the liveness gate: a fresh workstation has an empty `/var/run`, so it advertises
 * nothing until its `sshd` pidfile is planted on the journal.
 */

const OWNER = generateIdentity();
const ESSID = 'CoffeeShopWiFi';

const registry = (over: Partial<ReturnType<typeof baseRegistry>> = {}) => ({
  ...baseRegistry(),
  ...over,
});

const baseRegistry = () => ({
  owner_key: OWNER.publicKeyHex,
  essid: ESSID,
  workstation_username: 'neo',
  workstation_root_hash: md5('toor'),
});

/** A's workstation LAN IP — the deterministic address a forward must target to
 *  reach it (the same value A's `nano` edit writes into `rules.v4`). */
const wsLanIp = assignHomeNetwork(OWNER.publicKeyHex, ESSID).localIp;

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

describe('buildWorkstationPortResolver', () => {
  it("returns the workstation's open ports for its own LAN IP when its sshd is up", () => {
    const resolve = buildWorkstationPortResolver({ registry: registry(), workstationPatches: [sshdUp] });

    expect(resolve(wsLanIp)).toEqual([{ port: 22, service: 'ssh' }]);
  });

  it('returns nothing for the LAN IP when the workstation sshd is down (empty journal)', () => {
    const resolve = buildWorkstationPortResolver({ registry: registry(), workstationPatches: [] });

    expect(resolve(wsLanIp)).toEqual([]);
  });

  it('returns nothing for an internal IP that is not the workstation (dead forward)', () => {
    const resolve = buildWorkstationPortResolver({ registry: registry(), workstationPatches: [sshdUp] });

    expect(resolve('192.168.0.254')).toEqual([]);
  });

  it('treats a null journal as no running services', () => {
    const resolve = buildWorkstationPortResolver({ registry: registry(), workstationPatches: null });

    expect(resolve(wsLanIp)).toEqual([]);
  });
});
