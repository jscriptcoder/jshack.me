import { describe, expect, it } from 'vitest';
import { applyPatches, type Patch } from './applyPatches';
import { createFsView } from './fsView';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { defaultDirectoryPermissions, defaultFilePermissions } from './defaultPermissions';
import { asAbsPath } from '../types';
import type { Directory, FilePermissions } from './types';

const rootView = (tree: Directory) => createFsView(tree, { userType: 'root' });

const dirPatch = (path: string, owner: string, permissions?: FilePermissions): Patch => ({
  path,
  content: null,
  owner,
  nodeType: 'directory',
  ...(permissions ? { permissions } : {}),
});

const filePatch = (
  path: string,
  content: string,
  owner: string,
  permissions?: FilePermissions,
): Patch => ({ path, content, owner, ...(permissions ? { permissions } : {}) });

describe('applyPatches', () => {
  it('creates a directory over the base tree', () => {
    const base = buildDirectory({ home: buildDirectory({ alice: buildDirectory({}) }) });

    const result = applyPatches(base, [dirPatch('/home/alice/proj', 'alice')]);

    expect(rootView(result).list(asAbsPath('/home/alice'))).toEqual({
      ok: true,
      entries: ['proj'],
    });
    expect(rootView(result).stat(asAbsPath('/home/alice/proj'))?.kind).toBe('directory');
  });

  it('stamps the patch owner and explicit permissions on the new directory', () => {
    const base = buildDirectory({ home: buildDirectory({ alice: buildDirectory({}) }) });
    const perms = defaultDirectoryPermissions('user');

    const result = applyPatches(base, [dirPatch('/home/alice/proj', 'alice', perms)]);

    const node = rootView(result).stat(asAbsPath('/home/alice/proj'));
    expect(node?.owner).toBe('alice');
    expect(node?.perms).toEqual(perms);
  });

  it('is a no-op when the directory already exists (replaying mkdir never clobbers children)', () => {
    const base = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory({
          proj: buildDirectory({ 'keep.txt': buildFile('still here', { owner: 'alice' }) }),
        }),
      }),
    });

    const result = applyPatches(base, [dirPatch('/home/alice/proj', 'alice')]);

    expect(rootView(result).read(asAbsPath('/home/alice/proj/keep.txt'))).toEqual({
      ok: true,
      content: 'still here',
    });
  });

  it('creates a new file with content, owner and explicit permissions', () => {
    const base = buildDirectory({ home: buildDirectory({ alice: buildDirectory({}) }) });
    const perms = defaultFilePermissions('user');

    const result = applyPatches(base, [filePatch('/home/alice/notes.txt', 'hi', 'alice', perms)]);

    const view = rootView(result);
    expect(view.read(asAbsPath('/home/alice/notes.txt'))).toEqual({ ok: true, content: 'hi' });
    const node = view.stat(asAbsPath('/home/alice/notes.txt'));
    expect(node?.kind).toBe('file');
    expect(node?.owner).toBe('alice');
    expect(node?.perms).toEqual(perms);
  });

  it('applies patches in order — last write wins for the same path', () => {
    const base = buildDirectory({ home: buildDirectory({ alice: buildDirectory({}) }) });

    const result = applyPatches(base, [
      filePatch('/home/alice/notes.txt', 'first', 'alice'),
      filePatch('/home/alice/notes.txt', 'second', 'alice'),
    ]);

    expect(rootView(result).read(asAbsPath('/home/alice/notes.txt'))).toEqual({
      ok: true,
      content: 'second',
    });
  });

  it('preserves the existing owner and permissions when a content patch omits permissions', () => {
    const base = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory({
          'notes.txt': buildFile('old', { owner: 'alice', perms: { read: ['root', 'user'] } }),
        }),
      }),
    });
    const before = rootView(base).stat(asAbsPath('/home/alice/notes.txt'));

    const result = applyPatches(base, [filePatch('/home/alice/notes.txt', 'new', 'someoneelse')]);

    const after = rootView(result).stat(asAbsPath('/home/alice/notes.txt'));
    expect(after?.kind === 'file' && after.content).toBe('new');
    expect(after?.owner).toBe('alice');
    expect(after?.perms).toEqual(before?.perms);
  });

  it('removes a node for a deletion marker (content null on a file)', () => {
    const base = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory({ 'notes.txt': buildFile('bye', { owner: 'alice' }) }),
      }),
    });

    const result = applyPatches(base, [
      { path: '/home/alice/notes.txt', content: null, owner: 'alice' },
    ]);

    expect(rootView(result).read(asAbsPath('/home/alice/notes.txt'))).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('creates missing intermediate directories when inserting a deep file', () => {
    const base = buildDirectory({ home: buildDirectory({ alice: buildDirectory({}) }) });

    const result = applyPatches(base, [filePatch('/home/alice/a/b/c.txt', 'deep', 'alice')]);

    const view = rootView(result);
    expect(view.stat(asAbsPath('/home/alice/a'))?.kind).toBe('directory');
    expect(view.stat(asAbsPath('/home/alice/a/b'))?.kind).toBe('directory');
    expect(view.read(asAbsPath('/home/alice/a/b/c.txt'))).toEqual({ ok: true, content: 'deep' });
  });

  it('falls back to user-tier defaults when a created file patch omits permissions', () => {
    const base = buildDirectory({ home: buildDirectory({ alice: buildDirectory({}) }) });

    const result = applyPatches(base, [filePatch('/home/alice/notes.txt', 'hi', 'alice')]);

    expect(rootView(result).stat(asAbsPath('/home/alice/notes.txt'))?.perms).toEqual(
      defaultFilePermissions('user'),
    );
  });

  it('scaffolds a user-traversable, root-owned intermediate and preserves existing siblings', () => {
    const base = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          { 'keep.txt': buildFile('do not lose me', { owner: 'alice' }) },
          { owner: 'alice' },
        ),
      }),
    });

    const result = applyPatches(base, [filePatch('/home/alice/sub/deep.txt', 'x', 'alice')]);

    const userView = createFsView(result, { userType: 'user', cwd: asAbsPath('/') });
    // Sibling under the reused (not clobbered) parent survives.
    expect(userView.read(asAbsPath('/home/alice/keep.txt'))).toEqual({
      ok: true,
      content: 'do not lose me',
    });
    // The scaffolded intermediate is world-traversable + readable (a user can list it).
    expect(userView.list(asAbsPath('/home/alice/sub'))).toEqual({
      ok: true,
      entries: ['deep.txt'],
    });
    // ...and owned by root, not the patch owner.
    expect(rootView(result).stat(asAbsPath('/home/alice/sub'))?.owner).toBe('root');
    expect(userView.read(asAbsPath('/home/alice/sub/deep.txt'))).toEqual({
      ok: true,
      content: 'x',
    });
  });

  it('falls back to user-tier directory defaults when a directory patch omits permissions', () => {
    const base = buildDirectory({ home: buildDirectory({ alice: buildDirectory({}) }) });

    const result = applyPatches(base, [dirPatch('/home/alice/proj', 'alice')]);

    expect(rootView(result).stat(asAbsPath('/home/alice/proj'))?.perms).toEqual(
      defaultDirectoryPermissions('user'),
    );
  });

  it('overrides the existing file permissions when a content patch supplies them', () => {
    const base = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory({
          'notes.txt': buildFile('old', { owner: 'alice', perms: { read: ['root', 'user'] } }),
        }),
      }),
    });
    const newPerms = {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root'],
    } as const;

    const result = applyPatches(base, [
      filePatch('/home/alice/notes.txt', 'new', 'alice', newPerms),
    ]);

    expect(rootView(result).stat(asAbsPath('/home/alice/notes.txt'))?.perms).toEqual(newPerms);
  });

  it('removes only the targeted entry, leaving siblings and the parent directory intact', () => {
    const base = buildDirectory({
      home: buildDirectory({
        alice: buildDirectory(
          {
            'a.txt': buildFile('aaa', { owner: 'alice' }),
            'b.txt': buildFile('bbb', { owner: 'alice' }),
          },
          { owner: 'alice' },
        ),
      }),
    });

    const result = applyPatches(base, [
      { path: '/home/alice/a.txt', content: null, owner: 'alice' },
    ]);

    const view = rootView(result);
    expect(view.list(asAbsPath('/home/alice'))).toEqual({ ok: true, entries: ['b.txt'] });
    expect(view.read(asAbsPath('/home/alice/b.txt'))).toEqual({ ok: true, content: 'bbb' });
  });

  it('does not mutate the base tree', () => {
    const base = buildDirectory({ home: buildDirectory({ alice: buildDirectory({}) }) });

    applyPatches(base, [dirPatch('/home/alice/proj', 'alice')]);

    expect(rootView(base).stat(asAbsPath('/home/alice/proj'))).toBeNull();
  });

  it('returns the base tree unchanged for an empty patch list', () => {
    const base = buildDirectory({ home: buildDirectory({ alice: buildDirectory({}) }) });

    expect(applyPatches(base, [])).toBe(base);
  });
});

describe('applyPatches — a directory whose permissions changed', () => {
  it('replaces the permissions of a directory that is already there', () => {
    const locked: FilePermissions = { read: ['root'], write: ['root'], execute: ['root'] };
    const base = buildDirectory({
      root: buildDirectory({ 'notes.private': buildFile('mine\n', { owner: 'root' }) }, {
        owner: 'root',
        perms: locked,
      }),
    });
    const opened: FilePermissions = {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root', 'user', 'guest'],
    };

    const result = applyPatches(base, [dirPatch('/root', 'root', opened)]);

    // Without this, a directory chmod is a row the server stores, the journal
    // keeps, and every reader ignores — a change that looks applied at the
    // prompt and is gone on the next materialisation.
    expect(rootView(result).stat(asAbsPath('/root'))?.perms).toEqual(opened);
  });

  it('keeps the entries and the owner of the directory it re-permissions', () => {
    const base = buildDirectory({
      root: buildDirectory({ 'notes.private': buildFile('mine\n', { owner: 'root' }) }, {
        owner: 'root',
        perms: { read: ['root'], write: ['root'], execute: ['root'] },
      }),
    });

    const result = applyPatches(base, [
      dirPatch('/root', 'intruder', {
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      }),
    ]);

    // A permission change is not a re-creation: emptying the directory or
    // handing it to whoever sent the patch would lose a whole subtree to a
    // command that only ever moves one bit.
    expect(rootView(result).list(asAbsPath('/root'))).toEqual({
      ok: true,
      entries: ['notes.private'],
    });
    expect(rootView(result).stat(asAbsPath('/root'))?.owner).toBe('root');
  });

  it('leaves an existing directory untouched when the patch names no permissions', () => {
    const locked: FilePermissions = { read: ['root'], write: ['root'], execute: ['root'] };
    const base = buildDirectory({
      root: buildDirectory({}, { owner: 'root', perms: locked }),
    });

    const result = applyPatches(base, [dirPatch('/root', 'alice')]);

    // A bare directory row is a `mkdir` that lost its race, and mkdir refuses a
    // directory that exists. Nothing about it should reshape what is there.
    expect(rootView(result).stat(asAbsPath('/root'))?.perms).toEqual(locked);
    expect(rootView(result).stat(asAbsPath('/root'))?.owner).toBe('root');
  });
});
