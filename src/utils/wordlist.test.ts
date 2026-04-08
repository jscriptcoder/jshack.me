import { describe, it, expect } from 'vitest';
import type { FileNode } from '../filesystem/types';
import { resolveWordlist } from './wordlist';

const mkFileNode = (content: string): FileNode => ({
  name: 'test.txt',
  type: 'file',
  owner: 'root',
  permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  content,
});

describe('resolveWordlist', () => {
  it('finds wordlist in cwd first and returns cwd path', () => {
    const getNode = (path: string): FileNode | null => {
      if (path === '/home/user/passwords.txt') return mkFileNode('alpha\nbeta\ngamma');
      if (path === '/usr/share/wordlists/passwords.txt') return mkFileNode('other\nlist');
      return null;
    };
    const result = resolveWordlist('passwords.txt', getNode, '/home/user');
    expect(result.lines).toEqual(['alpha', 'beta', 'gamma']);
    expect(result.resolvedPath).toBe('/home/user/passwords.txt');
  });

  it('falls back to /usr/share/wordlists/ when not in cwd', () => {
    const getNode = (path: string): FileNode | null => {
      if (path === '/usr/share/wordlists/passwords.txt') return mkFileNode('one\ntwo\nthree');
      return null;
    };
    const result = resolveWordlist('passwords.txt', getNode, '/home/user');
    expect(result.lines).toEqual(['one', 'two', 'three']);
    expect(result.resolvedPath).toBe('/usr/share/wordlists/passwords.txt');
  });

  it('throws when wordlist not found in either location', () => {
    const getNode = (): FileNode | null => null;
    expect(() => resolveWordlist('passwords.txt', getNode, '/home/user')).toThrow(
      'wordlist not found: passwords.txt',
    );
  });

  it('filters empty lines and trims whitespace', () => {
    const getNode = (path: string): FileNode | null => {
      if (path === '/usr/share/wordlists/test.txt')
        return mkFileNode('  alpha  \n\nbeta\n  \ngamma\n');
      return null;
    };
    const result = resolveWordlist('test.txt', getNode, '/tmp');
    expect(result.lines).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('handles cwd at root correctly', () => {
    const getNode = (path: string): FileNode | null => {
      if (path === '/passwords.txt') return mkFileNode('found');
      return null;
    };
    const result = resolveWordlist('passwords.txt', getNode, '/');
    expect(result.lines).toEqual(['found']);
    expect(result.resolvedPath).toBe('/passwords.txt');
  });
});
