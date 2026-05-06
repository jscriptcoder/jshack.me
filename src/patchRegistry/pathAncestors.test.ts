import { describe, it, expect } from 'vitest';
import { ancestorPaths } from './pathAncestors';

// ancestorPaths returns the chain of parent paths the permission walker
// needs for traverse (execute) checks, ordered root-to-immediate-parent
// and EXCLUDING the target itself. Order is load-bearing: it matches
// permissionWalker's PermissionInput.parentChain shape so the chain can
// be looked up in machine_filesystems and passed straight in.

describe('ancestorPaths — chain composition', () => {
  it('returns root-to-immediate-parent ordering for deeply nested paths', () => {
    expect(ancestorPaths('/home/alice/.ssh/id_rsa')).toEqual([
      '/',
      '/home',
      '/home/alice',
      '/home/alice/.ssh',
    ]);
  });

  it('returns just the root for top-level paths', () => {
    expect(ancestorPaths('/etc')).toEqual(['/']);
    expect(ancestorPaths('/tmp')).toEqual(['/']);
  });

  it('returns an empty chain for the filesystem root', () => {
    expect(ancestorPaths('/')).toEqual([]);
  });

  it('excludes the target itself from the chain', () => {
    const chain = ancestorPaths('/var/log/auth.log');
    expect(chain).not.toContain('/var/log/auth.log');
    expect(chain).toEqual(['/', '/var', '/var/log']);
  });

  it('builds the chain in strict root-to-leaf order (regression guard for reversal)', () => {
    // Walker contract: parents are walked left-to-right; root must come first.
    const chain = ancestorPaths('/a/b/c');
    expect(chain[0]).toBe('/');
    expect(chain[chain.length - 1]).toBe('/a/b');
  });
});

describe('ancestorPaths — normalisation', () => {
  it('treats trailing slash on the target equivalently to no trailing slash', () => {
    expect(ancestorPaths('/etc/')).toEqual(ancestorPaths('/etc'));
    expect(ancestorPaths('/home/alice/')).toEqual(ancestorPaths('/home/alice'));
  });

  it('collapses double slashes inside paths', () => {
    expect(ancestorPaths('/etc//foo')).toEqual(ancestorPaths('/etc/foo'));
    expect(ancestorPaths('/a///b//c')).toEqual(ancestorPaths('/a/b/c'));
  });

  it('handles paths with many segments', () => {
    expect(ancestorPaths('/a/b/c/d/e/f')).toEqual([
      '/',
      '/a',
      '/a/b',
      '/a/b/c',
      '/a/b/c/d',
      '/a/b/c/d/e',
    ]);
  });
});
