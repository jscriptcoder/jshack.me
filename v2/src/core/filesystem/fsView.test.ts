import { describe, expect, it } from 'vitest';
import { createFsView } from './fsView';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { asAbsPath } from '../types';

/** A tree with a user-readable file, a root-only file, and a root-only dir. */
const tree = () =>
  buildDirectory({
    home: buildDirectory({
      alice: buildDirectory(
        { 'notes.txt': buildFile('hello\nworld\n', { owner: 'alice' }) },
        { owner: 'alice' },
      ),
    }),
    root: buildDirectory(
      { 'secret.txt': buildFile('classified', { owner: 'root' }) },
      { owner: 'root' },
    ),
    vault: buildDirectory(
      { 'x.txt': buildFile('y', { owner: 'root' }) },
      { owner: 'root', perms: { read: ['root'] } },
    ),
  });

const userView = () => createFsView(tree(), { userType: 'user', cwd: asAbsPath('/') });

describe('createFsView', () => {
  it('reads a file the user tier is allowed to read', () => {
    expect(userView().read(asAbsPath('/home/alice/notes.txt'))).toEqual({
      ok: true,
      content: 'hello\nworld\n',
    });
  });

  it('denies reading a file outside the user tier', () => {
    expect(userView().read(asAbsPath('/root/secret.txt'))).toEqual({
      ok: false,
      error: 'permission_denied',
    });
  });

  it('reports not_found when reading a missing path', () => {
    expect(userView().read(asAbsPath('/home/alice/nope.txt'))).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('reports not_found when a path descends through a file', () => {
    expect(userView().read(asAbsPath('/home/alice/notes.txt/deeper'))).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('denies reading a file under a non-traversable ancestor directory', () => {
    // The file itself is world-readable, but its parent dir is not executable
    // by `user`, so the walker must deny via the parent chain — not the leaf.
    const tree = buildDirectory({
      locked: buildDirectory(
        {
          'open.txt': buildFile('public', {
            owner: 'alice',
            perms: { read: ['root', 'user', 'guest'] },
          }),
        },
        { owner: 'root', perms: { execute: ['root'] } },
      ),
    });
    const fs = createFsView(tree, { userType: 'user', cwd: asAbsPath('/') });

    expect(fs.read(asAbsPath('/locked/open.txt'))).toEqual({
      ok: false,
      error: 'permission_denied',
    });
  });

  it('reports is_directory when reading a directory', () => {
    expect(userView().read(asAbsPath('/home/alice'))).toEqual({
      ok: false,
      error: 'is_directory',
    });
  });

  it('lists the entries of a directory', () => {
    expect(userView().list(asAbsPath('/home/alice'))).toEqual({
      ok: true,
      entries: ['notes.txt'],
    });
  });

  it('reports not_a_directory when listing a file', () => {
    expect(userView().list(asAbsPath('/home/alice/notes.txt'))).toEqual({
      ok: false,
      error: 'not_a_directory',
    });
  });

  it('reports not_found when listing a missing path', () => {
    expect(userView().list(asAbsPath('/nope'))).toEqual({ ok: false, error: 'not_found' });
  });

  it('denies listing a directory outside the user tier', () => {
    expect(userView().list(asAbsPath('/vault'))).toEqual({
      ok: false,
      error: 'permission_denied',
    });
  });

  it('stats an existing node and returns null for a missing one', () => {
    expect(userView().stat(asAbsPath('/home/alice/notes.txt'))?.kind).toBe('file');
    expect(userView().stat(asAbsPath('/nope'))).toBeNull();
  });

  it('permits writing into a directory the user tier owns', () => {
    expect(userView().canWrite(asAbsPath('/home/alice'))).toEqual({ allowed: true });
  });

  it('denies writing into a directory the user tier cannot write', () => {
    // /vault write defaults to root-only.
    expect(userView().canWrite(asAbsPath('/vault'))).toEqual({
      allowed: false,
      reason: 'target_unwritable',
    });
  });

  it('lets root write anywhere', () => {
    const rootView = createFsView(tree(), { userType: 'root', cwd: asAbsPath('/') });
    expect(rootView.canWrite(asAbsPath('/vault'))).toEqual({ allowed: true });
  });

  it('denies writing under a non-traversable ancestor directory', () => {
    const lockedTree = buildDirectory({
      locked: buildDirectory(
        { sub: buildDirectory({}, { owner: 'alice', perms: { write: ['root', 'user'] } }) },
        { owner: 'root', perms: { execute: ['root'] } },
      ),
    });
    const fs = createFsView(lockedTree, { userType: 'user', cwd: asAbsPath('/') });

    expect(fs.canWrite(asAbsPath('/locked/sub'))).toEqual({
      allowed: false,
      reason: 'parent_not_traversable',
    });
  });

  it('exposes the configured working directory', () => {
    const fs = createFsView(tree(), { userType: 'user', cwd: asAbsPath('/home/alice') });
    expect(fs.cwd()).toBe('/home/alice');
  });

  it('exposes the backing directory tree as root', () => {
    const backing = tree();
    expect(createFsView(backing, { userType: 'user', cwd: asAbsPath('/') }).root()).toBe(backing);
  });

  it('defaults to the user tier and root cwd when options are omitted', () => {
    const fs = createFsView(tree());
    expect(fs.cwd()).toBe('/');
    expect(fs.read(asAbsPath('/home/alice/notes.txt'))).toEqual({
      ok: true,
      content: 'hello\nworld\n',
    });
    expect(fs.read(asAbsPath('/root/secret.txt'))).toEqual({
      ok: false,
      error: 'permission_denied',
    });
  });
});
