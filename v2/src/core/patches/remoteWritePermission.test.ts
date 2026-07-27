import { describe, expect, it } from 'vitest';
import {
  buildOccupantWorkstationFs,
  enforceRemoteWriteL2,
  type OccupantWorkstation,
} from './remoteWritePermission';
import { generateIdentity } from '../identity/identity';
import { computeDeepGatewayId, computeInnerGatewayId, computeApGatewayId } from '../identity/router';
import { generateHomeLan } from '../generation/generateHomeLan';
import { crackableEssidPool } from '../generation/generateWifi';
import { generateDeepLayer, seedNetworkDepth } from '../generation/generateDeepLayer';
import { md5 } from '../generation/md5';
import type { Directory, FileNode } from '../filesystem/types';

/**
 * `buildOccupantWorkstationFs` rebuilds a registered FOREIGN workstation's base
 * FS from its occupancy row — from the OWNER's identity (decision D6) — so
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

describe('buildOccupantWorkstationFs', () => {
  it("rebuilds the owner's box from the occupant's identity (username + root hash in passwd)", () => {
    const owner = generateIdentity();
    const occupant: OccupantWorkstation = {
      owner_key: owner.publicKeyHex,
      workstation_username: 'alice',
      workstation_root_hash: md5('hunter2'),
    };

    const tree = buildOccupantWorkstationFs(occupant);

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
 * The AP GATEWAY L2 branch: a `ssh root@<subnet>.1` write to `rules.v4` lands on a
 * journal-backed machine that is neither a LAN sibling (the LAN walker skips the `.1`
 * octet on purpose — the gateway belongs to the access point, not to its LAN) nor
 * anybody's workstation. L2 rebuilds the gateway tree from the ESSID its session names
 * and walks it at the session tier. The occupancy stub here resolves to NOTHING, so if
 * the code fell through to the foreign-workstation branch the base would be null and
 * the write denied — a passing "allowed" proves the gateway branch built the tree.
 */
describe('enforceRemoteWriteL2 — AP gateway', () => {
  const noPriorPatches = () => Promise.resolve({ data: [], error: null });
  const noOccupant = () => Promise.resolve({ data: null, error: null });

  it("allows a root tier writing the gateway's rules.v4 on the network its session names", async () => {
    const denial = await enforceRemoteWriteL2({
      machineId: computeApGatewayId('HOME-WIFI'),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'root', essid: 'HOME-WIFI' },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toBeNull();
  });

  it("denies a non-root tier writing the router's root-only rules.v4", async () => {
    const denial = await enforceRemoteWriteL2({
      machineId: computeApGatewayId('HOME-WIFI'),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'guest', essid: 'HOME-WIFI' },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });
});

/**
 * The OWN INNER-GATEWAY L2 branch: a SECOND own-LAN router (a non-`.1` gateway) is
 * journal-backed exactly like the edge. A root `rules.v4` write there must rebuild
 * the inner gateway's seeded tree (from the caller's own key + octet) and walk it at
 * the session tier. The occupancy stub resolves to NOTHING, so an "allowed" proves the
 * own-LAN resolver built the inner gateway tree rather than failing closed.
 */
describe('enforceRemoteWriteL2 — own inner gateway', () => {
  const noPriorPatches = () => Promise.resolve({ data: [], error: null });
  const noOccupant = () => Promise.resolve({ data: null, error: null });
  const ESSID = 'HOME-WIFI';

  const innerGatewayOctet = (): number => {
    const inner = generateHomeLan(ESSID).hosts.find(
      (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
    );
    if (inner === undefined) throw new Error('no inner gateway on LAN');
    return Number(inner.ip.split('.')[3]);
  };

  it("allows a ROOT write to /etc/iptables/rules.v4 on the caller's own inner gateway", async () => {
    const octet = innerGatewayOctet();

    const denial = await enforceRemoteWriteL2({
      machineId: computeInnerGatewayId(ESSID, octet),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'root', essid: ESSID },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toBeNull();
  });

  it("denies a non-root tier writing the inner gateway's root-only rules.v4", async () => {
    const octet = innerGatewayOctet();

    const denial = await enforceRemoteWriteL2({
      machineId: computeInnerGatewayId(ESSID, octet),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'guest', essid: ESSID },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });
});

/**
 * The OWN SWITCH L2 branch: a switch is the second inner-gateway device type, also
 * journal-backed and reachable on its own machine id. A root `acl.conf` write there
 * must rebuild the switch's seeded tree (its root-only `/etc/switch/acl.conf`) and
 * walk it at the session tier. The occupancy stub resolves to NOTHING, so an "allowed"
 * proves the own-LAN resolver built the SWITCH tree (not a router/workstation).
 */
describe('enforceRemoteWriteL2 — own switch', () => {
  const noPriorPatches = () => Promise.resolve({ data: [], error: null });
  const noOccupant = () => Promise.resolve({ data: null, error: null });
  const ESSID = 'HOME-WIFI';

  const switchOctet = (): number => {
    const device = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'switch');
    if (device === undefined) throw new Error('no switch on LAN');
    return Number(device.ip.split('.')[3]);
  };

  it("allows a ROOT write to /etc/switch/acl.conf on the caller's own switch", async () => {
    const octet = switchOctet();

    const denial = await enforceRemoteWriteL2({
      machineId: computeInnerGatewayId(ESSID, octet),
      path: '/etc/switch/acl.conf',
      session: { userType: 'root', essid: ESSID },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toBeNull();
  });

  it("denies a non-root tier writing the switch's root-only acl.conf", async () => {
    const octet = switchOctet();

    const denial = await enforceRemoteWriteL2({
      machineId: computeInnerGatewayId(ESSID, octet),
      path: '/etc/switch/acl.conf',
      session: { userType: 'guest', essid: ESSID },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });
});

/**
 * The DEEP-GATEWAY L2 branch: a chain door BELOW the home LAN (an L2+ gateway reached
 * through a forward on the inner gateway and rooted). It is not a `generateHomeLan` host,
 * so it resolves via the deep-chain walk from the ESSID. Configuring its forwards
 * (`nano rules.v4`) is how a player chains deeper, so a root write there must be allowed;
 * the occupancy stub resolves to NOTHING, so an "allowed" proves the deep-chain resolver
 * built the gateway tree rather than falling through to a foreign lookup.
 */
describe('enforceRemoteWriteL2 — a deep chain gateway', () => {
  const noPriorPatches = () => Promise.resolve({ data: [], error: null });
  const noOccupant = () => Promise.resolve({ data: null, error: null });

  // Depth is a per-network roll AND the inner router's deep child is a seeded
  // router-OR-switch; pick a NETWORK whose inner gateway hangs a child of the kind the test
  // configures — a router exposes a NAT `rules.v4`, a switch an `acl.conf`.
  const chainDoorOfKind = (kind: 'router' | 'switch'): { essid: string; machineId: string } => {
    for (const essid of crackableEssidPool) {
      if (seedNetworkDepth(essid) < 2) continue;
      const inner = generateHomeLan(essid).hosts.find(
        (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
      );
      if (inner === undefined) continue;
      const innerId = computeInnerGatewayId(essid, Number(inner.ip.split('.')[3]));
      const child = generateDeepLayer(
        essid,
        { machineId: innerId, kind: 'router' },
        { hangsChild: true },
      ).childGateway;
      if (child !== null && child.kind === kind) {
        return { essid, machineId: computeDeepGatewayId(innerId, Number(child.ip.split('.')[3])) };
      }
    }
    throw new Error(`no network seeds an inner ${kind} child gateway`);
  };

  it('allows a ROOT write to /etc/iptables/rules.v4 on a deep chain ROUTER gateway', async () => {
    const door = chainDoorOfKind('router');

    const denial = await enforceRemoteWriteL2({
      machineId: door.machineId,
      path: '/etc/iptables/rules.v4',
      session: { userType: 'root', essid: door.essid },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toBeNull();
  });

  it("denies a non-root tier writing the deep ROUTER gateway's root-only rules.v4", async () => {
    const door = chainDoorOfKind('router');

    const denial = await enforceRemoteWriteL2({
      machineId: door.machineId,
      path: '/etc/iptables/rules.v4',
      session: { userType: 'guest', essid: door.essid },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });

  it("allows a ROOT write to /etc/switch/acl.conf on the caller's own deep chain SWITCH gateway", async () => {
    // A deep gateway seeded as a SWITCH owns an `acl.conf`, not a `rules.v4`. An "allowed"
    // proves the chain resolver built a SWITCH tree from the ESSID (the occupancy
    // stub resolves to nothing) — so a player can `nano` a rooted deep switch's ACL.
    const door = chainDoorOfKind('switch');

    const denial = await enforceRemoteWriteL2({
      machineId: door.machineId,
      path: '/etc/switch/acl.conf',
      session: { userType: 'root', essid: door.essid },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toBeNull();
  });

  it("denies a non-root tier writing the deep SWITCH gateway's root-only acl.conf", async () => {
    const door = chainDoorOfKind('switch');

    const denial = await enforceRemoteWriteL2({
      machineId: door.machineId,
      path: '/etc/switch/acl.conf',
      session: { userType: 'guest', essid: door.essid },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });
});

/**
 * The FOREIGN-ROUTER L2 branch (Story 5.2): B (a DIFFERENT identity) `ssh root`'d
 * into A's router and writes A's `rules.v4`. The target is neither B's own router
 * (`isOwnRouter` is A's, not B's) nor a LAN sibling — it's a registered foreign
 * ROUTER, so L2 must rebuild A's ROUTER tree (from the resolved `owner_key`) and
 * walk it at the session tier. If the code resolved a workstation instead, the
 * router-only `/etc/iptables` dir would be absent → creating `rules.v4` would have
 * no container → denied, so a passing "allowed" proves the router tree was built.
 */
describe('enforceRemoteWriteL2 — foreign router (cross-player)', () => {
  const noPriorPatches = () => Promise.resolve({ data: [], error: null });

  const noOccupant = () => Promise.resolve({ data: null, error: null });

  it("allows B's ROOT write to /etc/iptables/rules.v4 on a foreign AP's gateway", async () => {
    // Standing on a gateway means having logged INTO it, and that login records the
    // gateway's own network on the session — so the ESSID that rebuilds its tree is
    // right there, with no lookup and nothing owning the box.
    const denial = await enforceRemoteWriteL2({
      machineId: computeApGatewayId('HOME-WIFI'),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'root', essid: 'HOME-WIFI' },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toBeNull();
  });

  it("denies a non-root write to the AP gateway's root-only rules.v4", async () => {
    const denial = await enforceRemoteWriteL2({
      machineId: computeApGatewayId('HOME-WIFI'),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'guest', essid: 'HOME-WIFI' },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });

  it("denies a write to a gateway that is not the session's own network", async () => {
    // The gateway id is a pure function of the ESSID, so a machine_id that is not this
    // session's gateway resolves to nothing — a caller cannot reach across to another
    // AP's gateway by claiming its id on a session opened somewhere else.
    const denial = await enforceRemoteWriteL2({
      machineId: computeApGatewayId('HOME-WIFI'),
      path: '/etc/iptables/rules.v4',
      session: { userType: 'root', essid: 'B-WIFI' },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });
});

/**
 * Writing to a FELLOW OCCUPANT of the same ESSID. B and A are both on one AP, so L2
 * rebuilds A's WORKSTATION from A's occupancy row — the only record of who A is — and
 * walks its real perms. Occupancy is keyed (essid, owner_key), so every occupant of a
 * shared AP has a row and none evicts another; without this resolution B's root-tier
 * write to A (e.g. deleting /boot) would falsely 403, breaking the same-LAN brick the
 * session + su already permit.
 */
describe('enforceRemoteWriteL2 — writing to a fellow occupant (cross-player)', () => {
  const noPriorPatches = () => Promise.resolve({ data: [], error: null });
  const noOccupant = () => Promise.resolve({ data: null, error: null });
  const occupantRow = (owner: ReturnType<typeof generateIdentity>) => () =>
    Promise.resolve({
      data: {
        owner_key: owner.publicKeyHex,
        workstation_username: 'alice',
        workstation_root_hash: md5('hunter2'),
      } as OccupantWorkstation,
      error: null,
    });

  it("rebuilds A's box from A's occupancy row, allowing B's root write to /boot", async () => {
    const owner = generateIdentity();
    const denial = await enforceRemoteWriteL2({
      machineId: 'skylab-deadbeef',
      path: '/boot/vmlinuz',
      session: { userType: 'root', essid: 'SHARED-WIFI' },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: occupantRow(owner),
    });

    expect(denial).toBeNull();
  });

  it("still denies a guest write to A's root-only /boot, resolved the same way", async () => {
    const owner = generateIdentity();
    const denial = await enforceRemoteWriteL2({
      machineId: 'skylab-deadbeef',
      path: '/boot/vmlinuz',
      session: { userType: 'guest', essid: 'SHARED-WIFI' },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: occupantRow(owner),
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });

  it('fails closed (403) when the machine occupies no network at all', async () => {

    const denial = await enforceRemoteWriteL2({
      machineId: 'unknown-machine',
      path: '/boot/vmlinuz',
      session: { userType: 'root', essid: 'SHARED-WIFI' },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: noOccupant,
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });

  it('500s (no false deny) when the occupancy lookup errors', async () => {

    const denial = await enforceRemoteWriteL2({
      machineId: 'skylab-deadbeef',
      path: '/boot/vmlinuz',
      session: { userType: 'root', essid: 'SHARED-WIFI' },
      listMachinePatches: noPriorPatches,
      findOccupantWorkstationByMachineId: () =>
        Promise.resolve({ data: null, error: new Error('db down') }),
    });

    expect(denial).toEqual({ status: 500, error: 'permission_check_failed' });
  });
});
