import { describe, it, expect } from 'vitest';
import { regenWorkstationRows } from './populateWorkstationBaseFs';
import { computeWorkstationId } from '../homeNetworks/homeNetworkHelpers';
import { md5 } from '../utils/md5';
import type { MachineFsRow } from './flattenFileNode';

const findRow = (rows: readonly MachineFsRow[], path: string): MachineFsRow | undefined =>
  rows.find((r) => r.path === path);

const baseInput = {
  playerKey: 'pubkey-A',
  workstationName: 'skylab',
  username: 'alice',
  seed: '0123456789abcdef',
  rootPassword: 'sup3r-s3cr3t',
};

describe('regenWorkstationRows', () => {
  it('keys every row by ${workstationName}-${first-8-hex(player_key)}', () => {
    const rows = regenWorkstationRows(baseInput);
    const expectedMachineId = computeWorkstationId('skylab', 'pubkey-A');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.machine_id).toBe(expectedMachineId);
    }
  });

  it('produces distinct machine_ids for distinct player keys, even with same workstationName', () => {
    const a = regenWorkstationRows(baseInput);
    const b = regenWorkstationRows({ ...baseInput, playerKey: 'pubkey-B' });
    expect(a[0]!.machine_id).not.toBe(b[0]!.machine_id);
  });

  it('includes /etc/passwd as root-owned with write restricted to root', () => {
    const rows = regenWorkstationRows(baseInput);
    const passwd = findRow(rows, '/etc/passwd');
    expect(passwd).toBeDefined();
    expect(passwd!.owner).toBe('root');
    expect(passwd!.permissions.write).toEqual(['root']);
  });

  it('includes /root with read/write/execute restricted to root', () => {
    const rows = regenWorkstationRows(baseInput);
    const rootDir = findRow(rows, '/root');
    expect(rootDir).toBeDefined();
    expect(rootDir!.owner).toBe('root');
    expect(rootDir!.permissions.read).toEqual(['root']);
    expect(rootDir!.permissions.write).toEqual(['root']);
    expect(rootDir!.permissions.execute).toEqual(['root']);
  });

  it('includes /home/<username> for the player but not for a different username', () => {
    const rows = regenWorkstationRows(baseInput);
    expect(findRow(rows, '/home/alice')).toBeDefined();
    expect(findRow(rows, '/home/bob')).toBeUndefined();
  });

  it('is deterministic — same inputs produce identical rows', () => {
    const a = regenWorkstationRows(baseInput);
    const b = regenWorkstationRows(baseInput);
    expect(a).toEqual(b);
  });

  // Locks in the contract from src/generation/generateLocalhost.test.ts:
  // FS structure (paths/owners/perms) is invariant under (seed,
  // rootPassword, hostname). Two identical (workstationName, username)
  // pairs with different player keys must produce identical rows except
  // for machine_id and the projected /etc/passwd content (which differs
  // when seed/rootPassword differ — but here we hold them equal).
  it('rows differ only in machine_id when only player_key changes', () => {
    const a = regenWorkstationRows(baseInput);
    const b = regenWorkstationRows({ ...baseInput, playerKey: 'pubkey-B' });
    expect(a.length).toBe(b.length);
    const stripMachineId = (rs: typeof a) => rs.map(({ machine_id: _id, ...rest }) => rest);
    expect(stripMachineId(a)).toEqual(stripMachineId(b));
  });

  // The whole point of PR 1: /etc/passwd content must reflect the actual
  // rootPassword the player chose, not a placeholder. Without this,
  // cross-player password validation in PR 2 has nothing to compare
  // against.
  it('embeds md5(rootPassword) in /etc/passwd content for the root user', () => {
    const rows = regenWorkstationRows({ ...baseInput, rootPassword: 'hello' });
    const passwd = findRow(rows, '/etc/passwd');
    expect(passwd?.content).toContain(md5('hello'));
  });

  it('produces different /etc/passwd content for different rootPasswords', () => {
    const a = regenWorkstationRows({ ...baseInput, rootPassword: 'pwA' });
    const b = regenWorkstationRows({ ...baseInput, rootPassword: 'pwB' });
    expect(findRow(a, '/etc/passwd')!.content).not.toBe(findRow(b, '/etc/passwd')!.content);
  });

  it('produces different /etc/passwd content for different seeds (guest-password derivation)', () => {
    const a = regenWorkstationRows({ ...baseInput, seed: 'seed-A' });
    const b = regenWorkstationRows({ ...baseInput, seed: 'seed-B' });
    expect(findRow(a, '/etc/passwd')!.content).not.toBe(findRow(b, '/etc/passwd')!.content);
  });
});
