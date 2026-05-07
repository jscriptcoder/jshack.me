import { describe, it, expect } from 'vitest';
import { flattenFileNode, flattenFileSystemsToRows } from './flattenFileNode';
import type { FileNode } from '../filesystem/types';

const allOpen = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'user', 'guest'],
  execute: ['root', 'user', 'guest'],
} as const;

const rootOnly = {
  read: ['root'],
  write: ['root'],
  execute: ['root'],
} as const;

const file = (
  name: string,
  content: string,
  owner: 'root' | 'user' | 'guest' = 'root',
): FileNode => ({
  name,
  type: 'file',
  owner,
  permissions: rootOnly,
  content,
});

const dir = (
  name: string,
  children: Readonly<Record<string, FileNode>>,
  owner: 'root' | 'user' | 'guest' = 'root',
): FileNode => ({
  name,
  type: 'directory',
  owner,
  permissions: allOpen,
  children,
});

describe('flattenFileNode', () => {
  it('emits a single row for a leaf file (content null for non-projected paths)', () => {
    const rows = flattenFileNode('m1', file('foo.txt', 'hello'), '/foo.txt');
    expect(rows).toEqual([
      {
        machine_id: 'm1',
        path: '/foo.txt',
        owner: 'root',
        permissions: rootOnly,
        content: null,
      },
    ]);
  });

  it('projects content for /etc/passwd (in the projection allowlist)', () => {
    const passwdContent = 'root:x:0:0\nbob:y:1001:1001\n';
    const rows = flattenFileNode('m1', file('passwd', passwdContent), '/etc/passwd');
    expect(rows).toEqual([
      {
        machine_id: 'm1',
        path: '/etc/passwd',
        owner: 'root',
        permissions: rootOnly,
        content: passwdContent,
      },
    ]);
  });

  it('does not project content for files at other paths in the same tree', () => {
    const tree = dir('root', {
      etc: dir('etc', {
        passwd: file('passwd', 'root:x:0:0'),
        hostname: file('hostname', 'host'),
      }),
    });
    const rows = flattenFileNode('m1', tree);
    const passwdRow = rows.find((r) => r.path === '/etc/passwd');
    const hostnameRow = rows.find((r) => r.path === '/etc/hostname');
    expect(passwdRow?.content).toBe('root:x:0:0');
    expect(hostnameRow?.content).toBeNull();
  });

  it('emits one row for an empty directory', () => {
    const rows = flattenFileNode('m1', dir('empty', {}), '/empty');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      machine_id: 'm1',
      path: '/empty',
    });
  });

  it('emits one row per node in a deep tree, root-first', () => {
    const tree = dir('root', {
      etc: dir('etc', { passwd: file('passwd', 'root:x:0:0\n') }),
      tmp: dir('tmp', {}),
    });
    const rows = flattenFileNode('m1', tree);
    const paths = rows.map((r) => r.path).sort();
    expect(paths).toEqual(['/', '/etc', '/etc/passwd', '/tmp']);
  });

  it("uses '/' as default base path for the top-level node", () => {
    const rows = flattenFileNode('m1', dir('root', { foo: file('foo', 'x') }));
    expect(rows[0]?.path).toBe('/');
    expect(rows[1]?.path).toBe('/foo');
  });

  it('joins paths without doubling slashes when basePath is "/"', () => {
    const rows = flattenFileNode(
      'm1',
      dir('root', { etc: dir('etc', { hosts: file('hosts', 'h') }) }),
    );
    const paths = rows.map((r) => r.path);
    expect(paths).toContain('/etc');
    expect(paths).toContain('/etc/hosts');
    expect(paths).not.toContain('//etc');
  });

  it('preserves owner and permissions verbatim per node', () => {
    const tree = dir(
      'root',
      {
        etc: dir('etc', { shadow: file('shadow', 'secret', 'root') }, 'root'),
        home: dir('home', {}, 'user'),
      },
      'root',
    );
    const rows = flattenFileNode('m1', tree);
    const shadowRow = rows.find((r) => r.path === '/etc/shadow');
    const homeRow = rows.find((r) => r.path === '/home');
    expect(shadowRow?.owner).toBe('root');
    expect(shadowRow?.permissions).toEqual(rootOnly);
    expect(homeRow?.owner).toBe('user');
    expect(homeRow?.permissions).toEqual(allOpen);
  });

  it('forwards the supplied machine_id to every emitted row', () => {
    const tree = dir('root', { a: dir('a', { b: file('b', 'x') }) });
    const rows = flattenFileNode('mission-router-42', tree);
    expect(rows.every((r) => r.machine_id === 'mission-router-42')).toBe(true);
  });
});

describe('flattenFileSystemsToRows', () => {
  it('flattens a Record<machine_id, FileNode> into one rows array per machine', () => {
    const fileSystems = {
      m1: dir('root', { a: file('a', 'A') }),
      m2: dir('root', { b: file('b', 'B') }),
    };
    const rows = flattenFileSystemsToRows(fileSystems);
    const m1Rows = rows.filter((r) => r.machine_id === 'm1');
    const m2Rows = rows.filter((r) => r.machine_id === 'm2');
    expect(m1Rows.map((r) => r.path).sort()).toEqual(['/', '/a']);
    expect(m2Rows.map((r) => r.path).sort()).toEqual(['/', '/b']);
  });

  it('returns an empty array when given an empty record', () => {
    expect(flattenFileSystemsToRows({})).toEqual([]);
  });
});
