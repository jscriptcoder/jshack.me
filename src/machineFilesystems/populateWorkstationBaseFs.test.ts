import { describe, it, expect } from 'vitest';
import { regenWorkstationRows } from './populateWorkstationBaseFs';
import { deriveHostnameSuffix } from '../homeNetworks/homeNetworkHelpers';

const findRow = (rows: readonly { readonly path: string }[], path: string) =>
  rows.find((r) => r.path === path);

describe('regenWorkstationRows', () => {
  it('keys every row by ${workstationName}-${first-8-hex(player_key)}', () => {
    const rows = regenWorkstationRows({
      playerKey: 'pubkey-A',
      workstationName: 'skylab',
      username: 'alice',
    });
    const expectedMachineId = `skylab-${deriveHostnameSuffix('pubkey-A')}`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.machine_id).toBe(expectedMachineId);
    }
  });

  it('produces distinct machine_ids for distinct player keys, even with same workstationName', () => {
    const a = regenWorkstationRows({
      playerKey: 'pubkey-A',
      workstationName: 'skylab',
      username: 'alice',
    });
    const b = regenWorkstationRows({
      playerKey: 'pubkey-B',
      workstationName: 'skylab',
      username: 'alice',
    });
    expect(a[0]!.machine_id).not.toBe(b[0]!.machine_id);
  });

  it('includes /etc/passwd as root-owned with write restricted to root', () => {
    const rows = regenWorkstationRows({
      playerKey: 'pubkey-A',
      workstationName: 'skylab',
      username: 'alice',
    });
    const passwd = findRow(rows, '/etc/passwd');
    expect(passwd).toBeDefined();
    expect(passwd!.owner).toBe('root');
    expect(passwd!.permissions.write).toEqual(['root']);
  });

  it('includes /root with read/write/execute restricted to root', () => {
    const rows = regenWorkstationRows({
      playerKey: 'pubkey-A',
      workstationName: 'skylab',
      username: 'alice',
    });
    const rootDir = findRow(rows, '/root');
    expect(rootDir).toBeDefined();
    expect(rootDir!.owner).toBe('root');
    expect(rootDir!.permissions.read).toEqual(['root']);
    expect(rootDir!.permissions.write).toEqual(['root']);
    expect(rootDir!.permissions.execute).toEqual(['root']);
  });

  it('includes /home/<username> for the player but not for a different username', () => {
    const rows = regenWorkstationRows({
      playerKey: 'pubkey-A',
      workstationName: 'skylab',
      username: 'alice',
    });
    expect(findRow(rows, '/home/alice')).toBeDefined();
    expect(findRow(rows, '/home/bob')).toBeUndefined();
  });

  it('is deterministic — same inputs produce identical rows', () => {
    const a = regenWorkstationRows({
      playerKey: 'pubkey-A',
      workstationName: 'skylab',
      username: 'alice',
    });
    const b = regenWorkstationRows({
      playerKey: 'pubkey-A',
      workstationName: 'skylab',
      username: 'alice',
    });
    expect(a).toEqual(b);
  });

  // Locks in the contract from src/generation/generateLocalhost.test.ts:
  // FS structure (paths/owners/perms) is invariant under (seed,
  // rootPassword, hostname). Two identical (workstationName, username)
  // pairs with different player keys must produce identical rows except
  // for machine_id.
  it('rows differ only in machine_id when only player_key changes', () => {
    const a = regenWorkstationRows({
      playerKey: 'pubkey-A',
      workstationName: 'skylab',
      username: 'alice',
    });
    const b = regenWorkstationRows({
      playerKey: 'pubkey-B',
      workstationName: 'skylab',
      username: 'alice',
    });
    expect(a.length).toBe(b.length);
    const stripMachineId = (rs: typeof a) => rs.map(({ machine_id: _id, ...rest }) => rest);
    expect(stripMachineId(a)).toEqual(stripMachineId(b));
  });
});
