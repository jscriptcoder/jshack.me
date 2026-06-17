import { describe, expect, it } from 'vitest';
import {
  buildRegisteredWorkstationFs,
  enforceRemoteWriteL2,
  type RegistryWorkstation,
} from './remoteWritePermission';
import { generateIdentity } from '../identity/identity';
import { computeRouterId } from '../identity/router';
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
    });

    expect(denial).toEqual({ status: 403, error: 'permission_denied' });
  });
});
