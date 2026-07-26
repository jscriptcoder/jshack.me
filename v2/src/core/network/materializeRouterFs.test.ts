import { describe, expect, it } from 'vitest';
import { materializeApGatewayFs } from './materializeRouterFs';
import type { OwnerPatchRow } from './materializeWorkstationFs';
import { generateIdentity } from '../identity/identity';
import { md5 } from '../generation/md5';
import { seedApGatewayAdminPw } from '../generation/routerFs';
import { readOpenPorts } from '../services/pidfile';
import { canBoot } from '../boot/bootFiles';
import type { Directory, FileNode, FilePermissions } from '../filesystem/types';

/**
 * `materializeApGatewayFs` rebuilds an access point's GATEWAY the way the
 * cross-player server paths need it: the seeded base FS (a root-only box bearing
 * its own `sshd:22`, recovered from the ESSID) with the gateway's persisted patch
 * journal replayed over it. It is the gateway counterpart of
 * `materializeWorkstationFs` — the public SCAN (`resolvePublicScan`) and the public
 * SSH gate resolve the gateway through it so they agree on what the box looks like
 * (including whether a `/boot` tombstone bricked it). Because the seed is the ESSID
 * and not a player key, every occupant materializes the same box.
 */

const OWNER = generateIdentity();
const ESSID = 'BEAN-THERE-WIFI';
const NETWORK = { essid: ESSID };

/** Read a file's content from a materialized tree by absolute path, or null when
 *  the path is missing or is a directory. */
const readFileContent = (root: Directory, path: string): string | null => {
  let current: FileNode = root;
  for (const segment of path.split('/').filter(Boolean)) {
    if (current.kind !== 'directory') return null;
    const next = current.entries.get(segment);
    if (next === undefined) return null;
    current = next;
  }
  return current.kind === 'file' ? current.content : null;
};

/** A journal row for the router, defaulted to a file write; `over` tailors it. */
const patchRow = (over: Partial<OwnerPatchRow>): OwnerPatchRow => ({
  path: '/etc/iptables/rules.v4',
  content: 'forward 2222 to 10.0.0.5:22\n',
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: OWNER.publicKeyHex,
  ...over,
});

describe('materializeApGatewayFs', () => {
  it('materializes a fresh router whose own sshd:22 is open (seeded, no journal)', () => {
    const router = materializeApGatewayFs(NETWORK, []);

    expect(readOpenPorts(router)).toEqual([{ port: 22, service: 'ssh' }]);
  });

  it('recovers the router root password from the owner key alone (server-reconstructable)', () => {
    const router = materializeApGatewayFs(NETWORK, []);

    const passwd = readFileContent(router, '/etc/passwd');
    expect(passwd).toContain(md5(seedApGatewayAdminPw(ESSID)));
  });

  it('replays the journal over the base — a written rules.v4 forward is reflected', () => {
    const router = materializeApGatewayFs(NETWORK, [
      patchRow({ content: 'forward 8080 to 10.0.0.9:80\n' }),
    ]);

    expect(readFileContent(router, '/etc/iptables/rules.v4')).toBe('forward 8080 to 10.0.0.9:80\n');
  });

  it('is bootable as a fresh router (populated /boot)', () => {
    expect(canBoot(materializeApGatewayFs(NETWORK, [])).ok).toBe(true);
  });

  it('goes unbootable when a /boot tombstone is on its journal (bricked router)', () => {
    const tombstone = patchRow({ path: '/boot/vmlinuz', content: null });

    expect(canBoot(materializeApGatewayFs(NETWORK, [tombstone])).ok).toBe(false);
  });

  it('treats a null journal as empty (fresh router still answers with sshd:22)', () => {
    expect(readOpenPorts(materializeApGatewayFs(NETWORK, null))).toEqual([
      { port: 22, service: 'ssh' },
    ]);
  });

  it("applies a journal row's node_type and permissions on replay (cross-player writes carry them)", () => {
    const customPerms: FilePermissions = { read: ['root'], write: ['root'], execute: ['root'] };
    const dirRow = patchRow({
      path: '/srv',
      content: null,
      node_type: 'directory',
      permissions: customPerms,
    });

    const srv = materializeApGatewayFs(NETWORK, [dirRow]).entries.get('srv');

    // node_type carried → a directory (not the default file); permissions carried →
    // the row's perms, not a default. Both prove `rowToPatch` keeps the optional fields.
    expect(srv?.kind).toBe('directory');
    expect(srv?.perms).toEqual(customPerms);
  });
});
