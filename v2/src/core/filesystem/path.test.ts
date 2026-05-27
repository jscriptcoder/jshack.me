import { describe, expect, it } from 'vitest';
import { ancestorPaths, basename, dirname, normalize, resolveAbsPath } from './path';
import { asAbsPath } from '../types';

describe('normalize', () => {
  it('collapses consecutive slashes', () => {
    expect(normalize('//etc//passwd')).toBe('/etc/passwd');
  });

  it('drops "." segments', () => {
    expect(normalize('/etc/./passwd')).toBe('/etc/passwd');
  });

  it('pops the previous segment for ".."', () => {
    expect(normalize('/home/alice/../bob')).toBe('/home/bob');
  });

  it('resolves a chain of ".." segments', () => {
    expect(normalize('/a/b/c/../../d')).toBe('/a/d');
  });

  it('clamps ".." at the root rather than escaping above it', () => {
    expect(normalize('/../..')).toBe('/');
  });

  it('normalizes the empty string and bare root to "/"', () => {
    expect(normalize('')).toBe('/');
    expect(normalize('/')).toBe('/');
  });
});

describe('resolveAbsPath', () => {
  it('resolves a relative input against cwd', () => {
    expect(resolveAbsPath(asAbsPath('/home/alice'), 'notes.txt')).toBe('/home/alice/notes.txt');
  });

  it('ignores cwd when the input is already absolute', () => {
    expect(resolveAbsPath(asAbsPath('/home/alice'), '/etc/passwd')).toBe('/etc/passwd');
  });

  it('normalizes ".." relative to cwd', () => {
    expect(resolveAbsPath(asAbsPath('/home/alice'), '../bob/notes.txt')).toBe(
      '/home/bob/notes.txt',
    );
  });
});

describe('ancestorPaths', () => {
  it('returns root-first chain including the leaf', () => {
    expect(ancestorPaths(asAbsPath('/etc/passwd'))).toEqual(['/', '/etc', '/etc/passwd']);
  });

  it('returns just root for the root path', () => {
    expect(ancestorPaths(asAbsPath('/'))).toEqual(['/']);
  });
});

describe('dirname', () => {
  it('returns the parent directory', () => {
    expect(dirname(asAbsPath('/etc/passwd'))).toBe('/etc');
  });

  it('returns root for a top-level path', () => {
    expect(dirname(asAbsPath('/etc'))).toBe('/');
  });

  it('returns root for root', () => {
    expect(dirname(asAbsPath('/'))).toBe('/');
  });
});

describe('basename', () => {
  it('returns the final path segment', () => {
    expect(basename(asAbsPath('/etc/passwd'))).toBe('passwd');
    expect(basename(asAbsPath('/etc'))).toBe('etc');
  });

  it('returns the empty string for root', () => {
    expect(basename(asAbsPath('/'))).toBe('');
  });
});
