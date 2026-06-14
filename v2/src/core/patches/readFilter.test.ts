import { describe, expect, it } from 'vitest';
import type { Directory, FileNode } from '../filesystem/types';
import {
  dir,
  file,
  HOME_DIR,
  PASSWD_FILE,
  ROOT_DIR,
  TMP_DIR,
  TRAVERSABLE_DIR,
} from '../generation/baseFs';
import { filterTreeForRead } from './readFilter';

/**
 * The cross-player READ filter (Story 2, slice 2c — tier 2). Given a fully
 * materialized box tree and the CALLER's server-derived tier, it returns a tree
 * pruned to exactly the nodes that tier may read: every dropped node would
 * otherwise leak over the wire (the wire IS the threat surface), so these tests
 * assert the pruned tree's shape, not any UI rendering.
 *
 * Pruning is the shared permission walker (`canRead`) applied per node: a node
 * survives iff every ancestor is traversable for the tier AND the node itself is
 * readable. A dropped directory takes its whole subtree with it.
 */

/** A world-readable file (every tier may read) — content distinct so tests can
 *  prove the real node, not a placeholder, survives. */
const worldFile = (content: string): FileNode =>
  file(content, { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] });

const get = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

describe('filterTreeForRead', () => {
  it('keeps a file the tier may read and drops one it may not', () => {
    const tree = dir(
      {
        public: worldFile('open secret'),
        private: file('hash:roots', PASSWD_FILE),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeForRead(tree, 'guest');

    const kept = get(filtered, 'public');
    expect(kept?.kind === 'file' ? kept.content : null).toBe('open secret');
    expect(get(filtered, 'private')).toBeUndefined();
  });

  it('drops a non-traversable directory and everything beneath it', () => {
    const tree = dir(
      {
        home: dir({ alice: dir({ notes: worldFile('diary') }, HOME_DIR) }, TRAVERSABLE_DIR),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeForRead(tree, 'guest');

    // /home survives (world-traversable) but its user subdir (root+user only) is
    // pruned whole — even the world-readable file inside it must not leak.
    expect(get(filtered, 'home')?.kind).toBe('directory');
    expect(get(filtered, 'home', 'alice')).toBeUndefined();
  });

  it('drops /etc/passwd for guest but keeps it for user (read = root+user)', () => {
    const etc = () => dir({ passwd: file('root:x:0', PASSWD_FILE) }, TRAVERSABLE_DIR);
    const guestView = filterTreeForRead(dir({ etc: etc() }, TRAVERSABLE_DIR), 'guest');
    const userView = filterTreeForRead(dir({ etc: etc() }, TRAVERSABLE_DIR), 'user');

    expect(get(guestView, 'etc')?.kind).toBe('directory');
    expect(get(guestView, 'etc', 'passwd')).toBeUndefined();
    expect(get(userView, 'etc', 'passwd')?.kind).toBe('file');
  });

  it('keeps a deeply nested readable file through traversable parents', () => {
    const tree = dir(
      {
        var: dir({ www: dir({ 'index.html': worldFile('<h1>A</h1>') }, TRAVERSABLE_DIR) }, TRAVERSABLE_DIR),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeForRead(tree, 'guest');

    const page = get(filtered, 'var', 'www', 'index.html');
    expect(page?.kind === 'file' ? page.content : null).toBe('<h1>A</h1>');
  });

  it('drops a world-readable file whose ancestor directory is not traversable', () => {
    // /priv is root+user only; even a world-readable file inside is unreachable
    // for guest because the parent cannot be traversed (kills the parent-chain check).
    const tree = dir(
      {
        priv: dir({ leak: worldFile('should not escape') }, ROOT_DIR),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeForRead(tree, 'guest');

    expect(get(filtered, 'priv')).toBeUndefined();
  });

  it('drops a child when an ancestor is readable but not traversable for the tier', () => {
    // `vault` is guest-readable (survives on its own read bit) yet guest-only
    // un-traversable (no execute) — so a world-readable file inside it must still
    // be pruned, because reaching it requires traversing `vault`. This isolates
    // the parent-chain traversal check from the node's own read bit.
    const readableNotTraversable = {
      read: ['root', 'user', 'guest'] as const,
      write: ['root'] as const,
      execute: ['root', 'user'] as const,
    };
    const tree = dir(
      { vault: dir({ note: worldFile('peek') }, readableNotTraversable) },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeForRead(tree, 'guest');

    expect(get(filtered, 'vault')?.kind).toBe('directory');
    expect(get(filtered, 'vault', 'note')).toBeUndefined();
  });

  it('returns the whole tree unchanged for root', () => {
    const tree = dir(
      {
        etc: dir({ passwd: file('root:x:0', PASSWD_FILE) }, TRAVERSABLE_DIR),
        root: dir({ '.notes': worldFile('top secret') }, ROOT_DIR),
        tmp: dir({}, TMP_DIR),
      },
      TRAVERSABLE_DIR,
    );

    expect(filterTreeForRead(tree, 'root')).toEqual(tree);
  });

  it('preserves a kept directory’s perms and owner', () => {
    const tree = dir({ srv: dir({ ok: worldFile('x') }, TRAVERSABLE_DIR, 'deploy') }, TRAVERSABLE_DIR);

    const srv = get(filterTreeForRead(tree, 'guest'), 'srv');

    expect(srv?.kind === 'directory' ? srv.owner : null).toBe('deploy');
    expect(srv?.kind === 'directory' ? srv.perms : null).toEqual(TRAVERSABLE_DIR);
  });

  it('does not mutate the input tree', () => {
    const tree = dir({ secret: file('hash', PASSWD_FILE) }, TRAVERSABLE_DIR);

    filterTreeForRead(tree, 'guest');

    expect(tree.entries.get('secret')?.kind).toBe('file');
  });
});
