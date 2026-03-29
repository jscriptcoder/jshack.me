import { describe, it, expect } from 'vitest';
import { fillTemplate, findLeafDir, buildNestedDirs, mkFile, mkDir } from './helpers';

describe('fillTemplate', () => {
  it('replaces a single placeholder', () => {
    expect(fillTemplate('hello {{name}}', { name: 'world' })).toBe('hello world');
  });

  it('replaces multiple different placeholders', () => {
    const result = fillTemplate('{{user}}:{{pass}}', { user: 'admin', pass: 'secret' });
    expect(result).toBe('admin:secret');
  });

  it('replaces repeated occurrences of the same placeholder', () => {
    expect(fillTemplate('{{x}} and {{x}}', { x: 'ok' })).toBe('ok and ok');
  });

  it('leaves unmatched placeholders intact', () => {
    expect(fillTemplate('{{a}} {{b}}', { a: 'yes' })).toBe('yes {{b}}');
  });

  it('returns the template unchanged when vars is empty', () => {
    expect(fillTemplate('no vars here', {})).toBe('no vars here');
  });
});

describe('findLeafDir', () => {
  it('returns undefined for a file node', () => {
    expect(findLeafDir(mkFile('f', 'content'))).toBeUndefined();
  });

  it('returns the node itself when it has no child directories', () => {
    const dir = mkDir('d', { 'f.txt': mkFile('f.txt', '') });
    expect(findLeafDir(dir)).toBe(dir);
  });

  it('returns the node itself when it has only file children', () => {
    const dir = mkDir('d', {
      a: mkFile('a', ''),
      b: mkFile('b', ''),
    });
    expect(findLeafDir(dir)).toBe(dir);
  });

  it('returns the deepest nested directory', () => {
    const leaf = mkDir('leaf', { 'f.txt': mkFile('f.txt', '') });
    const mid = mkDir('mid', { leaf });
    const root = mkDir('root', { mid });
    expect(findLeafDir(root)).toBe(leaf);
  });

  it('returns an empty directory as the leaf', () => {
    const empty = mkDir('empty', {});
    const parent = mkDir('parent', { empty });
    expect(findLeafDir(parent)).toBe(empty);
  });
});

describe('buildNestedDirs', () => {
  const file = mkFile('data.csv', 'a,b,c');

  it('returns the file directly for a single segment', () => {
    expect(buildNestedDirs(['data.csv'], file)).toBe(file);
  });

  it('wraps the file in one directory for two segments', () => {
    const result = buildNestedDirs(['srv', 'data.csv'], file);
    expect(result.type).toBe('directory');
    expect(result.name).toBe('srv');
    expect(result.children?.['data.csv']).toBe(file);
  });

  it('builds a deeply nested tree for three segments', () => {
    const result = buildNestedDirs(['srv', 'records', 'data.csv'], file);
    expect(result.name).toBe('srv');
    const mid = result.children?.['records'];
    expect(mid?.type).toBe('directory');
    expect(mid?.name).toBe('records');
    expect(mid?.children?.['data.csv']).toBe(file);
  });

  it('makes intermediate directories world-readable', () => {
    const result = buildNestedDirs(['opt', 'app', 'config.txt'], file);
    expect(result.permissions.read).toContain('guest');
    expect(result.permissions.execute).toContain('guest');
    const inner = result.children?.['app'];
    expect(inner?.permissions.read).toContain('guest');
    expect(inner?.permissions.execute).toContain('guest');
  });
});
