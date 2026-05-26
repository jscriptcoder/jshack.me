import { describe, expect, it } from 'vitest';
import { canRead, canWrite, ownerTier } from './walker';
import type { FilePermissions } from './types';

const perms = (owner: string, mode: number, group = owner): FilePermissions => ({
  owner,
  group,
  mode,
});

describe('ownerTier', () => {
  it('maps root → root', () => {
    expect(ownerTier('root')).toBe('root');
  });

  it('maps nobody → guest', () => {
    expect(ownerTier('nobody')).toBe('guest');
  });

  it('maps www-data → guest', () => {
    expect(ownerTier('www-data')).toBe('guest');
  });

  it('maps any other owner → user', () => {
    expect(ownerTier('alice')).toBe('user');
    expect(ownerTier('admin')).toBe('user');
  });
});

describe('canRead', () => {
  it('root reads everything', () => {
    expect(canRead('root', perms('root', 0o000), []).allowed).toBe(true);
    expect(canRead('root', perms('alice', 0o000), [perms('root', 0o000)]).allowed).toBe(true);
  });

  it('leaf-only fallback: null target permits', () => {
    expect(canRead('guest', null, []).allowed).toBe(true);
  });

  it('user reads own files via owner bits', () => {
    const result = canRead('user', perms('alice', 0o600), []);
    expect(result.allowed).toBe(true);
  });

  it('user cannot read root files without world-read bit', () => {
    const result = canRead('user', perms('root', 0o600), []);
    expect(result).toEqual({ allowed: false, reason: 'target_unreadable' });
  });

  it('user can read root files with world-read bit set', () => {
    expect(canRead('user', perms('root', 0o644), []).allowed).toBe(true);
  });

  it('guest cannot read user files without world-read', () => {
    expect(canRead('guest', perms('alice', 0o600), []).allowed).toBe(false);
  });

  it('guest can read world-readable files', () => {
    expect(canRead('guest', perms('root', 0o644), []).allowed).toBe(true);
  });

  it('denies when a parent directory is not traversable', () => {
    // Parent has no execute bits for user → cannot enter
    const parentChain = [perms('root', 0o600)];
    const target = perms('root', 0o644);
    const result = canRead('user', target, parentChain);
    expect(result).toEqual({ allowed: false, reason: 'parent_not_traversable' });
  });

  it('allows when all parents are traversable', () => {
    const parentChain = [perms('root', 0o755), perms('root', 0o755)];
    const target = perms('root', 0o644);
    expect(canRead('user', target, parentChain).allowed).toBe(true);
  });
});

describe('canWrite', () => {
  it('root writes everything', () => {
    expect(canWrite('root', perms('alice', 0o000), []).allowed).toBe(true);
  });

  it('owner can write own file', () => {
    expect(canWrite('user', perms('alice', 0o600), []).allowed).toBe(true);
  });

  it('non-owner cannot write without world-write bit', () => {
    expect(canWrite('user', perms('root', 0o644), []).allowed).toBe(false);
  });

  it('non-owner can write with world-write bit set', () => {
    expect(canWrite('user', perms('root', 0o646), []).allowed).toBe(true);
  });

  it('denies when parent is not traversable', () => {
    const result = canWrite('user', perms('alice', 0o600), [perms('root', 0o600)]);
    expect(result).toEqual({ allowed: false, reason: 'parent_not_traversable' });
  });
});
