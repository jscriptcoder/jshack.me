import { describe, expect, it } from 'vitest';
import type { GameConfig } from '../gameConfig/gameConfig';
import type { Directory, FileNode } from '../filesystem/types';
import { canRead, canWrite } from '../filesystem/walker';
import { buildWorkstationBaseFs } from './workstationFs';
import { md5 } from './md5';

/**
 * Story 1: the player's own-workstation base filesystem is generated
 * deterministically from the Ed25519 identity pubkey, observable today
 * through the read path (`ls` / `cat`). These tests assert the generator's
 * behaviour through its public output (the `Directory` tree), not internals.
 */

// Two distinct valid 64-hex pubkeys — the seed source per decision 1.
const SEED_A = '1'.repeat(64);
const SEED_B = '2'.repeat(64);

const getConfig = (overrides: Partial<GameConfig> = {}): GameConfig => ({
  machineName: 'workstation',
  username: 'alice',
  rootPassword: 'hunter2',
  ...overrides,
});

/** Navigate to a directory by path segments; throws if any segment is missing
 *  or not a directory (keeps the tests readable without optional chaining). */
const dirAt = (fs: Directory, ...segments: readonly string[]): Directory => {
  let node: FileNode = fs;
  for (const segment of segments) {
    if (node.kind !== 'directory') throw new Error(`not a directory before "${segment}"`);
    const next = node.entries.get(segment);
    if (next === undefined) throw new Error(`missing entry "${segment}"`);
    node = next;
  }
  if (node.kind !== 'directory') throw new Error('target is not a directory');
  return node;
};

const readPasswd = (fs: Directory): string => {
  const passwd = dirAt(fs, 'etc').entries.get('passwd');
  if (passwd?.kind !== 'file') throw new Error('missing /etc/passwd file');
  return passwd.content;
};

const passwdRow = (fs: Directory, username: string): readonly string[] => {
  const row = readPasswd(fs)
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(':'))
    .find((fields) => fields[0] === username);
  if (row === undefined) throw new Error(`no passwd row for "${username}"`);
  return row;
};

describe('buildWorkstationBaseFs', () => {
  it('is deterministic: the same pubkey + config yields a byte-identical tree', () => {
    const config = getConfig();
    expect(buildWorkstationBaseFs(SEED_A, config)).toEqual(buildWorkstationBaseFs(SEED_A, config));
  });

  it('derives the guest hash reproducibly from the seed (pins the whole seed→passwd pipeline)', () => {
    // Golden values lock the deterministic derivation end to end: the
    // `workstation-` seed namespace (decision 1/6), the PRNG, the guest-password
    // pool order, and md5. SEED_A selects 'password' → md5('password').
    expect(passwdRow(buildWorkstationBaseFs(SEED_A, getConfig()), 'guest')[1]).toBe(
      '5f4dcc3b5aa765d61d8327deb882cf99',
    );
    expect(passwdRow(buildWorkstationBaseFs(SEED_B, getConfig()), 'guest')[1]).toBe(
      '3fc0a7acf087f549ac2b266baf94b8b1',
    );
  });

  it('lets the seed drive output: different pubkeys produce different guest hashes', () => {
    const config = getConfig();
    const guestHashA = passwdRow(buildWorkstationBaseFs(SEED_A, config), 'guest')[1];
    const guestHashB = passwdRow(buildWorkstationBaseFs(SEED_B, config), 'guest')[1];
    expect(guestHashA).not.toBe(guestHashB);
  });

  it('contains exactly the minimal skeleton and nothing else', () => {
    const fs = buildWorkstationBaseFs(SEED_A, getConfig());
    expect([...fs.entries.keys()].sort()).toEqual(['etc', 'home', 'root', 'tmp']);
    expect([...dirAt(fs, 'etc').entries.keys()]).toEqual(['passwd']);
    expect([...dirAt(fs, 'home').entries.keys()]).toEqual(['alice']);
    expect(dirAt(fs, 'home', 'alice').entries.size).toBe(0);
    expect(dirAt(fs, 'root').entries.size).toBe(0);
    expect(dirAt(fs, 'tmp').entries.size).toBe(0);
  });

  it('generates a well-formed /etc/passwd: 3 users, 7 colon-delimited fields each', () => {
    const content = readPasswd(buildWorkstationBaseFs(SEED_A, getConfig()));
    const rows = content.split('\n').filter((line) => line.length > 0);
    expect(rows).toHaveLength(3);
    rows.forEach((line) => expect(line.split(':')).toHaveLength(7));
  });

  it('hashes the root password with md5 at uid 0', () => {
    const root = passwdRow(buildWorkstationBaseFs(SEED_A, getConfig({ rootPassword: 'hunter2' })), 'root');
    // name:hash:uid:gid:gecos:home:shell
    expect(root[0]).toBe('root');
    expect(root[1]).toBe('2ab96390c7dbe3439de74d0c9b0b1767'); // md5('hunter2')
    expect(root[2]).toBe('0');
    expect(root[3]).toBe('0');
    expect(root[4]).toBe('root'); // gecos
    expect(root[5]).toBe('/root');
    expect(root[6]).toBe('/bin/bash');
  });

  it('gives the player user an empty hash at uid 1000 (always exit()-able)', () => {
    const player = passwdRow(buildWorkstationBaseFs(SEED_A, getConfig()), 'alice');
    expect(player[1]).toBe('');
    expect(player[2]).toBe('1000');
    expect(player[3]).toBe('1000');
    expect(player[5]).toBe('/home/alice');
  });

  it('gives guest a real seeded md5 hash at uid 1001', () => {
    const guest = passwdRow(buildWorkstationBaseFs(SEED_A, getConfig()), 'guest');
    expect(guest[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(guest[1]).not.toBe(md5('')); // not an empty/stub hash
    expect(guest[2]).toBe('1001');
    expect(guest[3]).toBe('1001');
    expect(guest[4]).toBe('guest'); // gecos
    expect(guest[5]).toBe('/home/guest');
  });

  it('names the home directory and player row from the config username', () => {
    const fs = buildWorkstationBaseFs(SEED_A, getConfig({ username: 'neo' }));
    expect([...dirAt(fs, 'home').entries.keys()]).toEqual(['neo']);
    expect(passwdRow(fs, 'neo')[5]).toBe('/home/neo');
  });

  describe('permission boundaries (asserted through the shared walker)', () => {
    it('/etc/passwd is readable by root and user but not guest (no /etc/shadow)', () => {
      const fs = buildWorkstationBaseFs(SEED_A, getConfig());
      const chain = [fs.perms, dirAt(fs, 'etc').perms];
      const passwd = dirAt(fs, 'etc').entries.get('passwd');
      if (passwd?.kind !== 'file') throw new Error('missing /etc/passwd');

      expect(canRead('root', passwd.perms, chain).allowed).toBe(true);
      expect(canRead('user', passwd.perms, chain).allowed).toBe(true);
      expect(canRead('guest', passwd.perms, chain)).toEqual({
        allowed: false,
        reason: 'target_unreadable',
      });
    });

    it('/root is readable only by root', () => {
      const fs = buildWorkstationBaseFs(SEED_A, getConfig());
      const rootDir = dirAt(fs, 'root');
      expect(canRead('root', rootDir.perms, [fs.perms]).allowed).toBe(true);
      expect(canRead('user', rootDir.perms, [fs.perms]).allowed).toBe(false);
      expect(canRead('guest', rootDir.perms, [fs.perms]).allowed).toBe(false);
    });

    it('/home/<username> is readable by root and user but not guest', () => {
      const fs = buildWorkstationBaseFs(SEED_A, getConfig());
      const home = dirAt(fs, 'home', 'alice');
      const chain = [fs.perms, dirAt(fs, 'home').perms];
      expect(canRead('user', home.perms, chain).allowed).toBe(true);
      expect(canRead('guest', home.perms, chain).allowed).toBe(false);
    });

    it('/tmp is world-writable', () => {
      const fs = buildWorkstationBaseFs(SEED_A, getConfig());
      const tmp = dirAt(fs, 'tmp');
      expect(canWrite('guest', tmp.perms, [fs.perms]).allowed).toBe(true);
    });

    it('emits the intended tier vectors for each node', () => {
      // The walker tests above prove these tiers produce the right allow/deny;
      // this locks the exact vectors the generator emits (the AC's "permissions
      // match the boundaries"), so a dropped/added tier can't slip through.
      const fs = buildWorkstationBaseFs(SEED_A, getConfig());
      const passwd = dirAt(fs, 'etc').entries.get('passwd');
      if (passwd?.kind !== 'file') throw new Error('missing /etc/passwd');

      // Container dirs (/, /etc, /home): world-traversable, root-only writes.
      expect(fs.perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      });
      // /etc/passwd: root+user read, root-only write/execute (inline passwords).
      expect(passwd.perms).toEqual({ read: ['root', 'user'], write: ['root'], execute: ['root'] });
      // /root: root-only across the board.
      expect(dirAt(fs, 'root').perms).toEqual({
        read: ['root'],
        write: ['root'],
        execute: ['root'],
      });
      // /home/<user>: root + the owning user.
      expect(dirAt(fs, 'home', 'alice').perms).toEqual({
        read: ['root', 'user'],
        write: ['root', 'user'],
        execute: ['root', 'user'],
      });
      // /tmp: world-writable scratch space.
      expect(dirAt(fs, 'tmp').perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root', 'user', 'guest'],
        execute: ['root', 'user', 'guest'],
      });
    });
  });
});
