import { describe, it, expect } from 'vitest';
import { overlayProjectedContent } from './baseFsOverlay';
import type { FileNode } from './types';

// PR 6 of plans/cross-player-base-fs-replication.md — overlayProjected-
// Content takes a regenerated FileNode tree (where /etc/passwd holds a
// PLACEHOLDER_ROOT hash because the workstations table doesn't store
// rootPassword) and substitutes content for any path that has a row in
// machine_filesystems' projected-content storage. The result is a tree
// whose projected-path content matches what the server's auth path uses
// — closing the "A sees a fake hash for B's root" gap.

const FILE = (name: string, content: string, owner: 'root' | 'user' = 'root'): FileNode => ({
  name,
  type: 'file',
  owner,
  permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
  content,
});

const DIR = (name: string, children: Readonly<Record<string, FileNode>>): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: { read: ['root', 'user'], write: ['root'], execute: ['root', 'user'] },
  children,
});

describe('overlayProjectedContent', () => {
  it('substitutes content for a single matched path', () => {
    const tree = DIR('/', {
      etc: DIR('etc', {
        passwd: FILE('passwd', 'PLACEHOLDER:x:0:0:root:/root:/bin/bash'),
      }),
    });
    const overlay = new Map<string, string>([
      ['/etc/passwd', 'root:REAL_HASH:0:0:root:/root:/bin/bash'],
    ]);
    const result = overlayProjectedContent(tree, overlay);
    expect(result.children?.etc.children?.passwd.content).toBe(
      'root:REAL_HASH:0:0:root:/root:/bin/bash',
    );
  });

  it('overlays multiple projected paths independently', () => {
    const tree = DIR('/', {
      etc: DIR('etc', {
        passwd: FILE('passwd', 'old-passwd'),
        redis: DIR('redis', {
          'redis.conf': FILE('redis.conf', 'old-conf'),
        }),
      }),
    });
    const overlay = new Map<string, string>([
      ['/etc/passwd', 'new-passwd'],
      ['/etc/redis/redis.conf', 'new-conf'],
    ]);
    const result = overlayProjectedContent(tree, overlay);
    expect(result.children?.etc.children?.passwd.content).toBe('new-passwd');
    expect(result.children?.etc.children?.redis.children?.['redis.conf'].content).toBe('new-conf');
  });

  it('leaves nodes unchanged when their path is not in the overlay map', () => {
    const tree = DIR('/', {
      home: DIR('home', {
        alice: DIR('alice', {
          'README.txt': FILE('README.txt', 'untouched content', 'user'),
        }),
      }),
    });
    const result = overlayProjectedContent(tree, new Map([['/etc/passwd', 'new']]));
    expect(result.children?.home.children?.alice.children?.['README.txt'].content).toBe(
      'untouched content',
    );
  });

  it('silently ignores overlay entries whose path is missing from the tree', () => {
    const tree = DIR('/', { etc: DIR('etc', {}) });
    const overlay = new Map<string, string>([
      ['/etc/passwd', 'never-applied'],
      ['/var/lib/mysql/data.json', 'also-never-applied'],
    ]);
    // Should not throw, should not insert new nodes — only OVERLAYS, not ADDS.
    const result = overlayProjectedContent(tree, overlay);
    expect(result.children?.etc.children?.passwd).toBeUndefined();
    expect(result.children?.var).toBeUndefined();
  });

  it('returns the tree unchanged when the overlay map is empty', () => {
    const tree = DIR('/', { etc: DIR('etc', { passwd: FILE('passwd', 'x') }) });
    const result = overlayProjectedContent(tree, new Map());
    // Same shape; deep-equal is sufficient (referential equality is allowed
    // but not required — tighter implementations may take advantage).
    expect(result).toEqual(tree);
  });

  it('preserves owner and permissions on overlaid file nodes', () => {
    const tree = DIR('/', {
      etc: DIR('etc', {
        passwd: {
          name: 'passwd',
          type: 'file',
          owner: 'root',
          permissions: { read: ['root'], write: ['root'], execute: ['root'] },
          content: 'old',
        },
      }),
    });
    const result = overlayProjectedContent(tree, new Map([['/etc/passwd', 'new']]));
    const passwd = result.children?.etc.children?.passwd;
    expect(passwd?.content).toBe('new');
    expect(passwd?.owner).toBe('root');
    expect(passwd?.permissions).toEqual({
      read: ['root'],
      write: ['root'],
      execute: ['root'],
    });
  });

  it('does not overlay directory nodes (overlay applies to files only)', () => {
    const tree = DIR('/', {
      etc: DIR('etc', { passwd: FILE('passwd', 'x') }),
    });
    // /etc is a directory; even if a sneaky overlay map keys it, it should
    // not gain a `content` field.
    const result = overlayProjectedContent(tree, new Map([['/etc', 'should-be-ignored']]));
    expect(result.children?.etc.type).toBe('directory');
    expect(result.children?.etc.content).toBeUndefined();
  });

  it('handles deeply-nested projected paths', () => {
    const tree = DIR('/', {
      var: DIR('var', {
        run: DIR('run', {
          'sshd.pid': FILE('sshd.pid', 'old'),
          'nc-4444.pid': FILE('nc-4444.pid', 'old-nc'),
        }),
      }),
    });
    const result = overlayProjectedContent(
      tree,
      new Map([
        ['/var/run/sshd.pid', 'sshd:port=22'],
        ['/var/run/nc-4444.pid', 'nc:port=4444,user=alice,userType=user,home=/home/alice'],
      ]),
    );
    expect(result.children?.var.children?.run.children?.['sshd.pid'].content).toBe('sshd:port=22');
    expect(result.children?.var.children?.run.children?.['nc-4444.pid'].content).toContain(
      'nc:port=4444',
    );
  });

  it('preserves siblings of overlaid files', () => {
    const tree = DIR('/', {
      etc: DIR('etc', {
        passwd: FILE('passwd', 'old'),
        hostname: FILE('hostname', 'omen-aabbccdd\n'),
        motd: FILE('motd', 'Welcome\n'),
      }),
    });
    const result = overlayProjectedContent(tree, new Map([['/etc/passwd', 'new']]));
    expect(result.children?.etc.children?.hostname.content).toBe('omen-aabbccdd\n');
    expect(result.children?.etc.children?.motd.content).toBe('Welcome\n');
  });
});
