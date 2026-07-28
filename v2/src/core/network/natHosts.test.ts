import { describe, expect, it } from 'vitest';
import { bootableOccupantFs, natPortResolver } from './natHosts';
import { generateIdentity } from '../identity/identity';
import { md5 } from '../generation/md5';
import { readOpenPorts } from '../services/pidfile';
import type { Directory } from '../filesystem/types';
import type { OwnerPatchRow } from './materializeWorkstationFs';

/**
 * The two pure pieces every NAT forward on a shared AP is resolved through: rebuilding
 * the occupant's REAL box behind a forward (base + journal, refusing one that cannot
 * boot), and answering `scanResult`'s "what is serving at this internal address?" over
 * however many occupants published a forward.
 *
 * The liveness gate lives here: a forward is only ever surfaced while the box behind it
 * is up, so a fresh workstation (empty `/var/run`) advertises nothing until its `sshd`
 * pidfile lands on the journal.
 */

const ALICE = generateIdentity();
const BOB = generateIdentity();

const occupant = (identity: ReturnType<typeof generateIdentity>, username: string) => ({
  owner_key: identity.publicKeyHex,
  workstation_username: username,
  workstation_root_hash: md5('toor'),
});

const ALICE_LAN_IP = '192.168.29.84';
const BOB_LAN_IP = '192.168.29.112';

/** A journal row planting a running-sshd pidfile — `/var/run/sshd.pid` =
 *  `sshd:port=22`, the byte-shape every port reader parses. */
const sshdUp: OwnerPatchRow = {
  path: '/var/run/sshd.pid',
  content: 'sshd:port=22',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: ALICE.publicKeyHex,
};

/** A root `rm /boot/vmlinuz` — replayed, it deletes the kernel, so the box is bricked
 *  and cannot come up however many pidfiles linger in `/var/run`. */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-17T00:00:01.000Z',
  writer_key: ALICE.publicKeyHex,
};

const treeOf = (fs: Directory | null): Directory => {
  if (fs === null) throw new Error('expected a bootable tree');
  return fs;
};

describe('bootableOccupantFs', () => {
  it("rebuilds the occupant's box with its journal replayed over the seeded base", () => {
    const fs = bootableOccupantFs(occupant(ALICE, 'neo'), [sshdUp]);

    // The daemon the owner started is running on the box a forward would reach — the
    // journal row landed on the rebuilt tree, not just the generated baseline.
    expect(readOpenPorts(treeOf(fs))).toEqual([{ port: 22, service: 'ssh' }]);
  });

  it('refuses a bricked box, even though its sshd pidfile lingers', () => {
    expect(bootableOccupantFs(occupant(ALICE, 'neo'), [sshdUp, bootTombstone])).toBeNull();
  });

  it('rebuilds a box with nothing written to it as up, but serving nothing', () => {
    expect(readOpenPorts(treeOf(bootableOccupantFs(occupant(ALICE, 'neo'), null)))).toEqual([]);
  });
});

describe('natPortResolver', () => {
  it("answers with the occupant's open ports at the address its forward names", () => {
    const aliceFs = treeOf(bootableOccupantFs(occupant(ALICE, 'neo'), [sshdUp]));
    const resolve = natPortResolver(new Map([[ALICE_LAN_IP, aliceFs]]));

    expect(resolve(ALICE_LAN_IP)).toEqual([{ port: 22, service: 'ssh' }]);
  });

  it('answers for EVERY occupant behind the AP, each at its own leased address', () => {
    const aliceFs = treeOf(bootableOccupantFs(occupant(ALICE, 'neo'), [sshdUp]));
    const bobFs = treeOf(bootableOccupantFs(occupant(BOB, 'trinity'), [sshdUp]));
    const resolve = natPortResolver(
      new Map([
        [ALICE_LAN_IP, aliceFs],
        [BOB_LAN_IP, bobFs],
      ]),
    );

    // One shared AP forwards to many boxes; each address answers for its own.
    expect(resolve(ALICE_LAN_IP)).toEqual([{ port: 22, service: 'ssh' }]);
    expect(resolve(BOB_LAN_IP)).toEqual([{ port: 22, service: 'ssh' }]);
  });

  it('answers with nothing at an address no occupant is behind (a dead forward)', () => {
    const aliceFs = treeOf(bootableOccupantFs(occupant(ALICE, 'neo'), [sshdUp]));
    const resolve = natPortResolver(new Map([[ALICE_LAN_IP, aliceFs]]));

    expect(resolve('192.168.29.254')).toEqual([]);
  });

  it('answers with nothing when the box at that address is serving nothing', () => {
    const idleFs = treeOf(bootableOccupantFs(occupant(ALICE, 'neo'), []));
    const resolve = natPortResolver(new Map([[ALICE_LAN_IP, idleFs]]));

    expect(resolve(ALICE_LAN_IP)).toEqual([]);
  });
});
