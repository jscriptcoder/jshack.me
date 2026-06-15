import { describe, expect, it } from 'vitest';
import { buildRegisteredWorkstationFs, type RegistryWorkstation } from './remoteWritePermission';
import { generateIdentity } from '../identity/identity';
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
