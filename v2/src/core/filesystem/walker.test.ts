import { describe, expect, it } from 'vitest';
import { canRead, canWrite } from './walker';
import type { FilePermissions } from './types';
import type { UserType } from '../types';

const perms = (
  read: readonly UserType[],
  write: readonly UserType[],
  execute: readonly UserType[],
): FilePermissions => ({ read, write, execute });

const rootOnly = perms(['root'], ['root'], ['root']);
const ownerRW = perms(['root', 'user'], ['root', 'user'], ['root']);
const worldReadable = perms(['root', 'user', 'guest'], ['root'], ['root', 'user', 'guest']);
const worldTraversable = perms(['root', 'user', 'guest'], ['root'], ['root', 'user', 'guest']);

describe('canRead', () => {
  it('root reads everything', () => {
    expect(canRead('root', rootOnly, []).allowed).toBe(true);
    expect(canRead('root', rootOnly, [rootOnly]).allowed).toBe(true);
  });

  it('root reads a file even when root is absent from the read array', () => {
    const denyAll = perms([], [], []);
    expect(canRead('root', denyAll, []).allowed).toBe(true);
  });

  it('leaf-only fallback: null target permits', () => {
    expect(canRead('guest', null, []).allowed).toBe(true);
  });

  it('user reads files where user is in the read array', () => {
    expect(canRead('user', ownerRW, []).allowed).toBe(true);
  });

  it('user cannot read root-only files', () => {
    const result = canRead('user', rootOnly, []);
    expect(result).toEqual({ allowed: false, reason: 'target_unreadable' });
  });

  it('guest cannot read user-readable files', () => {
    expect(canRead('guest', ownerRW, []).allowed).toBe(false);
  });

  it('guest can read world-readable files', () => {
    expect(canRead('guest', worldReadable, []).allowed).toBe(true);
  });

  it('denies when a parent directory is not traversable', () => {
    const parents = [perms(['root'], ['root'], ['root'])]; // user has no execute
    const result = canRead('user', ownerRW, parents);
    expect(result).toEqual({ allowed: false, reason: 'parent_not_traversable' });
  });

  it('allows when all parents are traversable', () => {
    expect(canRead('user', ownerRW, [worldTraversable, worldTraversable]).allowed).toBe(true);
  });
});

describe('canWrite', () => {
  it('root writes everything', () => {
    expect(canWrite('root', rootOnly, []).allowed).toBe(true);
  });

  it('user can write where user is in the write array', () => {
    expect(canWrite('user', ownerRW, []).allowed).toBe(true);
  });

  it('user cannot write root-only files', () => {
    const result = canWrite('user', rootOnly, []);
    expect(result).toEqual({ allowed: false, reason: 'target_unwritable' });
  });

  it('user can write world-writable files', () => {
    const worldWritable = perms(['root', 'user', 'guest'], ['root', 'user', 'guest'], ['root']);
    expect(canWrite('user', worldWritable, []).allowed).toBe(true);
  });

  it('denies when parent is not traversable', () => {
    const parents = [rootOnly];
    expect(canWrite('user', ownerRW, parents)).toEqual({
      allowed: false,
      reason: 'parent_not_traversable',
    });
  });

  it('root writes a file even when root is absent from the write array', () => {
    const denyAll = perms([], [], []);
    expect(canWrite('root', denyAll, []).allowed).toBe(true);
  });

  it('allows when all parents are traversable', () => {
    expect(canWrite('user', ownerRW, [worldTraversable, worldTraversable]).allowed).toBe(true);
  });

  it('leaf-only fallback: null target permits', () => {
    expect(canWrite('user', null, []).allowed).toBe(true);
  });
});
