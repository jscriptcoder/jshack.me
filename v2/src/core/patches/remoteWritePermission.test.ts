import { describe, expect, it } from 'vitest';
import {
  buildRegisteredWorkstationFs,
  enforceRemoteWriteL2,
  type RegistryWorkstation,
  type RegistryMachine,
} from './remoteWritePermission';
import { generateIdentity } from '../identity/identity';
import { computeInnerGatewayId, computeRouterId } from '../identity/router';
import { generateHomeLan } from '../generation/generateHomeLan';
import { md5 } from '../generation/md5';
import type { Directory, FileNode } from '../filesystem/types';

/**
 * `buildRegisteredWorkstationFs` rebuilds a registered FOREIGN workstation's base
 * FS from its registry identity row — from the OWNER's identity (decision D6) — so
 * the cross-player WRITE L2 walks the SAME tree the cross-player READ materializes,
 * never a caller regeneration. A wrong field mapping would check perms against the
 * wrong box, so these prove the owner's chosen username + root hash land in the
 * rebuilt home dir + /etc/passwd.
 */
const get = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

describe('buildRegisteredWorkstationFs', () => {
  it("rebuilds the owner's box from the registry identity (username + root hash in passwd)", () => {
    const owner = generateIdentity();
    const registry: RegistryWorkstation = {
      owner_key: owner.publicKeyHex,
      workstation_username: 'alice',
      workstation_root_hash: md5('hunter2'),
    };

    const tree = buildRegisteredWorkstationFs(registry);

    // The owner's chosen username has a home dir...
    expect(get(tree, 'home', 'alice')?.kind).toBe('directory');
    // ...and /etc/passwd reflects the owner's PERSISTED identity, not defaults — a
    // swapped owner_key/username/root_hash mapping would corrupt one of these.
    const passwd = get(tree, 'etc', 'passwd');
    const content = passwd?.kind === 'file' ? passwd.content : '';
    expect(content).toContain('alice');
    expect(content).toContain(md5('hunter2'));
  });
});

/**
 * The OWN-ROUTER L2 branch: A `ssh root@<subnet>.1` write to `rules.v4` is on a
 * journal-backed machine that is neither a LAN sibling nor a registered foreign
 * workstation. L2 must rebuild the ROUTER tree (from the caller's own key) and
 * walk it at the session tier. The `findRegistryByMachineId` stub here resolves
 * to NOTHING, so if the code fell through to the foreign-workstation branch the
 * base would be null and the write denied — a passing "allowed" proves the
 * own-router branch built the router tree.
 */
describe('enforceRemoteWriteL2 — own router', () => {
  const noPriorPatches = () => Promise.resolve({ data: [], error: null });
  const noRegistry = () => Promise.resolve({ data: null, error: null });

  it("allows a ROOT write to /etc/iptables/rules.v4 on the caller's own router", async () => {
    const owner = generateIdentity();

    const denial = await enforceRemoteWriteL2({
      publicKey: owner.publicKeyHex,
      machineId: computeRouterId(owner.publicKeyHex),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'root', essid: 'HOME-WIFI' },
      listMachinePatches: noPriorPatches,
      findRegistryByMachineId: noRegistry,
      findOccupantWorkstationByMachineId: noRegistry,
    });

    expect(denial).toBeNull();
  });

  it("denies a non-root tier writing the router's root-only rules.v4", async () => {
    const owner = generateIdentity();

    const denial = await enforceRemoteWriteL2({
      publicKey: owner.publicKeyHex,
      machineId: computeRouterId(owner.publicKeyHex),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'guest', essid: 'HOME-WIFI' },
      listMachinePatches: noPriorPatches,
      findRegistryByMachineId: noRegistry,
      findOccupantWorkstationByMachineId: noRegistry,
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });
});

/**
 * The OWN INNER-GATEWAY L2 branch: a SECOND own-LAN router (a non-`.1` gateway) is
 * journal-backed exactly like the edge. A root `rules.v4` write there must rebuild
 * the inner gateway's seeded tree (from the caller's own key + octet) and walk it at
 * the session tier. The registry stub resolves to NOTHING, so an "allowed" proves the
 * own-LAN resolver built the inner gateway tree rather than failing closed.
 */
describe('enforceRemoteWriteL2 — own inner gateway', () => {
  const noPriorPatches = () => Promise.resolve({ data: [], error: null });
  const noRegistry = () => Promise.resolve({ data: null, error: null });
  const ESSID = 'HOME-WIFI';

  const innerGatewayOctet = (pubkey: string): number => {
    const inner = generateHomeLan(pubkey, ESSID).hosts.find(
      (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
    );
    if (inner === undefined) throw new Error('no inner gateway on LAN');
    return Number(inner.ip.split('.')[3]);
  };

  it("allows a ROOT write to /etc/iptables/rules.v4 on the caller's own inner gateway", async () => {
    const owner = generateIdentity();
    const octet = innerGatewayOctet(owner.publicKeyHex);

    const denial = await enforceRemoteWriteL2({
      publicKey: owner.publicKeyHex,
      machineId: computeInnerGatewayId(owner.publicKeyHex, octet),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'root', essid: ESSID },
      listMachinePatches: noPriorPatches,
      findRegistryByMachineId: noRegistry,
      findOccupantWorkstationByMachineId: noRegistry,
    });

    expect(denial).toBeNull();
  });

  it("denies a non-root tier writing the inner gateway's root-only rules.v4", async () => {
    const owner = generateIdentity();
    const octet = innerGatewayOctet(owner.publicKeyHex);

    const denial = await enforceRemoteWriteL2({
      publicKey: owner.publicKeyHex,
      machineId: computeInnerGatewayId(owner.publicKeyHex, octet),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'guest', essid: ESSID },
      listMachinePatches: noPriorPatches,
      findRegistryByMachineId: noRegistry,
      findOccupantWorkstationByMachineId: noRegistry,
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });
});

/**
 * The FOREIGN-ROUTER L2 branch (Story 5.2): B (a DIFFERENT identity) `ssh root`'d
 * into A's router and writes A's `rules.v4`. The target is neither B's own router
 * (`isOwnRouter` is A's, not B's) nor a LAN sibling — it's a registered foreign
 * ROUTER, so L2 must rebuild A's ROUTER tree (from the registry's `owner_key`) and
 * walk it at the session tier. If the code resolved a workstation instead, the
 * router-only `/etc/iptables` dir would be absent → creating `rules.v4` would have
 * no container → denied, so a passing "allowed" proves the router tree was built.
 */
describe('enforceRemoteWriteL2 — foreign router (cross-player)', () => {
  const noPriorPatches = () => Promise.resolve({ data: [], error: null });

  it("allows B's ROOT write to /etc/iptables/rules.v4 on A's registered router", async () => {
    const attacker = generateIdentity();
    const owner = generateIdentity();
    // The registry resolves A's router machine_id → a router-kind row carrying A's
    // owner_key (the seed the router tree is rebuilt from).
    const findRegistryByMachineId = (): Promise<{ data: RegistryMachine | null; error: unknown }> =>
      Promise.resolve({ data: { kind: 'router', owner_key: owner.publicKeyHex }, error: null });

    const denial = await enforceRemoteWriteL2({
      publicKey: attacker.publicKeyHex,
      machineId: computeRouterId(owner.publicKeyHex),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'root', essid: 'B-WIFI' },
      listMachinePatches: noPriorPatches,
      findRegistryByMachineId,
      findOccupantWorkstationByMachineId: () => Promise.resolve({ data: null, error: null }),
    });

    expect(denial).toBeNull();
  });

  it("denies B's non-root write to A's router root-only rules.v4", async () => {
    const attacker = generateIdentity();
    const owner = generateIdentity();
    const findRegistryByMachineId = (): Promise<{ data: RegistryMachine | null; error: unknown }> =>
      Promise.resolve({ data: { kind: 'router', owner_key: owner.publicKeyHex }, error: null });

    const denial = await enforceRemoteWriteL2({
      publicKey: attacker.publicKeyHex,
      machineId: computeRouterId(owner.publicKeyHex),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'guest', essid: 'B-WIFI' },
      listMachinePatches: noPriorPatches,
      findRegistryByMachineId,
      findOccupantWorkstationByMachineId: () => Promise.resolve({ data: null, error: null }),
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });
});

/**
 * The SAME-LAN occupant fallback (cross-player): B and A occupy one ESSID, so A's row
 * was evicted from network_registry (PK = the shared public_ip, last-writer-wins) when
 * B joined after A. The occupancy table (PK (essid, owner_key)) still has A, so L2 must
 * rebuild A's WORKSTATION from the occupant row and walk its real perms — otherwise B's
 * root-tier write to A (e.g. deleting /boot) would falsely 403, breaking the same-LAN
 * brick the session + su already permit.
 */
describe('enforceRemoteWriteL2 — same-LAN occupant fallback (cross-player)', () => {
  const noPriorPatches = () => Promise.resolve({ data: [], error: null });
  const noRegistry = () => Promise.resolve({ data: null, error: null });
  const occupantRow = (owner: ReturnType<typeof generateIdentity>) => () =>
    Promise.resolve({
      data: {
        owner_key: owner.publicKeyHex,
        workstation_username: 'alice',
        workstation_root_hash: md5('hunter2'),
      } as RegistryWorkstation,
      error: null,
    });

  it("rebuilds A's box from the occupancy fallback when the registry misses, allowing B's root write to /boot", async () => {
    const attacker = generateIdentity();
    const owner = generateIdentity();

    const denial = await enforceRemoteWriteL2({
      publicKey: attacker.publicKeyHex,
      machineId: 'skylab-deadbeef',
      path: '/boot/vmlinuz',
      session: { userType: 'root', essid: 'SHARED-WIFI' },
      listMachinePatches: noPriorPatches,
      findRegistryByMachineId: noRegistry,
      findOccupantWorkstationByMachineId: occupantRow(owner),
    });

    expect(denial).toBeNull();
  });

  it("still denies a guest write to A's root-only /boot when resolved via the fallback", async () => {
    const attacker = generateIdentity();
    const owner = generateIdentity();

    const denial = await enforceRemoteWriteL2({
      publicKey: attacker.publicKeyHex,
      machineId: 'skylab-deadbeef',
      path: '/boot/vmlinuz',
      session: { userType: 'guest', essid: 'SHARED-WIFI' },
      listMachinePatches: noPriorPatches,
      findRegistryByMachineId: noRegistry,
      findOccupantWorkstationByMachineId: occupantRow(owner),
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });

  it('fails closed (403) when BOTH the registry and the occupancy fallback miss', async () => {
    const attacker = generateIdentity();

    const denial = await enforceRemoteWriteL2({
      publicKey: attacker.publicKeyHex,
      machineId: 'unknown-machine',
      path: '/boot/vmlinuz',
      session: { userType: 'root', essid: 'SHARED-WIFI' },
      listMachinePatches: noPriorPatches,
      findRegistryByMachineId: noRegistry,
      findOccupantWorkstationByMachineId: noRegistry,
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });

  it('500s (no false deny) when the occupancy fallback lookup errors', async () => {
    const attacker = generateIdentity();

    const denial = await enforceRemoteWriteL2({
      publicKey: attacker.publicKeyHex,
      machineId: 'skylab-deadbeef',
      path: '/boot/vmlinuz',
      session: { userType: 'root', essid: 'SHARED-WIFI' },
      listMachinePatches: noPriorPatches,
      findRegistryByMachineId: noRegistry,
      findOccupantWorkstationByMachineId: () =>
        Promise.resolve({ data: null, error: new Error('db down') }),
    });

    expect(denial).toEqual({ status: 500, error: 'permission_check_failed' });
  });
});
