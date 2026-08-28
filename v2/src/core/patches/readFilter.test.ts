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
import {
  EXTERNALLY_OBSERVABLE_ALLOWLIST,
  filterTreeForRead,
  filterTreeToAllowlist,
} from './readFilter';
import { serializeTree } from '../filesystem/treeCodec';
import { buildApGatewayBaseFs } from '../generation/routerFs';
import { readRwCommunityHash } from '../snmp/rwCommunity';

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
        var: dir(
          { www: dir({ 'index.html': worldFile('<h1>A</h1>') }, TRAVERSABLE_DIR) },
          TRAVERSABLE_DIR,
        ),
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
    const tree = dir(
      { srv: dir({ ok: worldFile('x') }, TRAVERSABLE_DIR, 'deploy') },
      TRAVERSABLE_DIR,
    );

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

/**
 * `filterTreeToAllowlist` is the no-session tier (Story 2, slice 2d — tier 3): a
 * caller who resolved A's box but never authenticated sees ONLY the externally-
 * observable allowlist (files whose content leaks via simulated network protocols —
 * pidfiles → open ports, /var/www → curl, NAT rules, service-version manifest).
 * Everything else default-denies, including /etc/passwd's inline hashes, /root, and
 * home dotfiles. Path-based (not permission-based): the wire IS the threat surface,
 * so a forbidden path must never appear in the returned tree.
 */
describe('filterTreeToAllowlist', () => {
  it('keeps an allowlisted pidfile and drops a non-allowlisted sibling (default-deny)', () => {
    const tree = dir(
      {
        var: dir(
          {
            run: dir(
              { 'sshd.pid': worldFile('4131'), 'notes.txt': worldFile('scratch') },
              TRAVERSABLE_DIR,
            ),
          },
          TRAVERSABLE_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeToAllowlist(tree);

    expect(get(filtered, 'var', 'run', 'sshd.pid')?.kind).toBe('file');
    expect(get(filtered, 'var', 'run', 'notes.txt')).toBeUndefined();
  });

  it('drops /etc/passwd, /root and home dotfiles for a no-session reader', () => {
    const tree = dir(
      {
        etc: dir({ passwd: file('root:x:0:0:...:hash', PASSWD_FILE) }, TRAVERSABLE_DIR),
        root: dir({ '.wallet': worldFile('PRIVATE_KEY') }, ROOT_DIR),
        home: dir(
          { alice: dir({ '.bashrc': worldFile('export X=1') }, HOME_DIR) },
          TRAVERSABLE_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeToAllowlist(tree);

    expect(get(filtered, 'etc', 'passwd')).toBeUndefined();
    // /etc has no surviving child → the whole dir is pruned, not just the file.
    expect(get(filtered, 'etc')).toBeUndefined();
    expect(get(filtered, 'root')).toBeUndefined();
    expect(get(filtered, 'home')).toBeUndefined();
    // Belt-and-braces: no secret content anywhere in the returned tree.
    expect(JSON.stringify(serializeTree(filtered))).not.toContain('PRIVATE_KEY');
    expect(JSON.stringify(serializeTree(filtered))).not.toContain('hash');
  });

  it('shows a real device its public snmpd.conf and never its read-write community', () => {
    // Against a GENERATED device rather than a hand-built tree: what has to hold is
    // that the box this door aims players at does not hand its own secret to a reader
    // who proved nothing, and a fixture written next to the filter can agree with the
    // filter while the shipped tree disagrees with both.
    //
    // The two files share a name and differ in everything else. `/etc/snmp/snmpd.conf`
    // is world-readable and says what the device IS — allowlisted, because a walk with
    // `public` returns the same facts anyway. `/var/lib/snmp/snmpd.conf` holds the
    // community that buys port control. Listed here it would be readable with no
    // session at all, which is a rung below every tier the walk itself hands out, and
    // the sweep this door exists for would be answering a question anyone could already
    // read the answer to.
    const gateway = buildApGatewayBaseFs('ALLOWLIST-NET');
    const communityHash = readRwCommunityHash(gateway);

    const filtered = filterTreeToAllowlist(gateway);

    expect(get(filtered, 'etc', 'snmp', 'snmpd.conf')?.kind).toBe('file');
    expect(get(filtered, 'var', 'lib')).toBeUndefined();
    expect(communityHash).toBeDefined();
    expect(JSON.stringify(serializeTree(filtered))).not.toContain(communityHash);
  });

  it('treats * as segment-bound — a .pid under a deeper subdir is not observable', () => {
    const tree = dir(
      {
        var: dir(
          {
            run: dir(
              {
                'real.pid': worldFile('100'),
                sub: dir({ 'deep.pid': worldFile('200') }, TRAVERSABLE_DIR),
              },
              TRAVERSABLE_DIR,
            ),
          },
          TRAVERSABLE_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeToAllowlist(tree);

    expect(get(filtered, 'var', 'run', 'real.pid')?.kind).toBe('file');
    // `/var/run/*.pid` matches one segment only — `sub/deep.pid` is two, so the
    // subdir has no surviving child and is pruned whole.
    expect(get(filtered, 'var', 'run', 'sub')).toBeUndefined();
  });

  it('anchors each segment — superstrings of an allowlisted name are not observable', () => {
    const tree = dir(
      {
        etc: dir(
          {
            iptables: dir(
              {
                'rules.v4': worldFile('-A FORWARD'),
                'xrules.v4': worldFile('prefix attack'),
                'rules.v4.bak': worldFile('suffix attack'),
              },
              TRAVERSABLE_DIR,
            ),
          },
          TRAVERSABLE_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeToAllowlist(tree);

    expect(get(filtered, 'etc', 'iptables', 'rules.v4')?.kind).toBe('file');
    expect(get(filtered, 'etc', 'iptables', 'xrules.v4')).toBeUndefined();
    expect(get(filtered, 'etc', 'iptables', 'rules.v4.bak')).toBeUndefined();
  });

  it('does not observe a path nested BELOW an exact allowlist entry', () => {
    // `/var/lib/dpkg/status` is an exact (non-glob) entry — a file one level deeper
    // (status treated as a dir) must NOT inherit observability. Pins exact-length
    // matching: an exact pattern matches its own depth only, never a longer path.
    const tree = dir(
      {
        var: dir(
          {
            lib: dir(
              {
                dpkg: dir(
                  { status: dir({ leak: worldFile('SECRET') }, TRAVERSABLE_DIR) },
                  TRAVERSABLE_DIR,
                ),
              },
              TRAVERSABLE_DIR,
            ),
          },
          TRAVERSABLE_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeToAllowlist(tree);

    expect(get(filtered, 'var', 'lib', 'dpkg', 'status', 'leak')).toBeUndefined();
    // The whole branch is pruned — no surviving child anywhere under /var/lib.
    expect(get(filtered, 'var')).toBeUndefined();
  });

  it('treats ** as recursive — /var/www content at any depth is observable', () => {
    const tree = dir(
      {
        var: dir(
          {
            www: dir(
              {
                'index.html': worldFile('<h1>A</h1>'),
                assets: dir({ 'app.js': worldFile('console.log(1)') }, TRAVERSABLE_DIR),
              },
              TRAVERSABLE_DIR,
            ),
          },
          TRAVERSABLE_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeToAllowlist(tree);

    expect(get(filtered, 'var', 'www', 'index.html')?.kind).toBe('file');
    expect(get(filtered, 'var', 'www', 'assets', 'app.js')?.kind).toBe('file');
  });

  it('keeps directory shells only on the path to a surviving file; prunes empty dirs', () => {
    const tree = dir(
      {
        var: dir(
          {
            run: dir({ 'sshd.pid': worldFile('1') }, TRAVERSABLE_DIR),
            log: dir({ syslog: worldFile('boot') }, TRAVERSABLE_DIR),
          },
          TRAVERSABLE_DIR,
        ),
        tmp: dir({}, TMP_DIR),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeToAllowlist(tree);

    // /var survives because /var/run/sshd.pid does; /var/log has no observable
    // child and is pruned; the empty /tmp is pruned.
    expect(get(filtered, 'var')?.kind).toBe('directory');
    expect(get(filtered, 'var', 'run', 'sshd.pid')?.kind).toBe('file');
    expect(get(filtered, 'var', 'log')).toBeUndefined();
    expect(get(filtered, 'tmp')).toBeUndefined();
  });

  it('observes every allowlist member (one representative file per pattern survives)', () => {
    const tree = dir(
      {
        var: dir(
          {
            run: dir({ 'sshd.pid': worldFile('1') }, TRAVERSABLE_DIR),
            www: dir({ 'index.html': worldFile('page') }, TRAVERSABLE_DIR),
            lib: dir(
              { dpkg: dir({ status: worldFile('Package: nginx') }, TRAVERSABLE_DIR) },
              TRAVERSABLE_DIR,
            ),
          },
          TRAVERSABLE_DIR,
        ),
        etc: dir(
          {
            iptables: dir({ 'rules.v4': worldFile('rules') }, TRAVERSABLE_DIR),
            snmp: dir({ 'snmpd.conf': worldFile('community') }, TRAVERSABLE_DIR),
            switch: dir({ 'acl.conf': worldFile('deny') }, TRAVERSABLE_DIR),
          },
          TRAVERSABLE_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeToAllowlist(tree);

    expect(get(filtered, 'var', 'run', 'sshd.pid')?.kind).toBe('file');
    expect(get(filtered, 'var', 'www', 'index.html')?.kind).toBe('file');
    expect(get(filtered, 'var', 'lib', 'dpkg', 'status')?.kind).toBe('file');
    expect(get(filtered, 'etc', 'iptables', 'rules.v4')?.kind).toBe('file');
    expect(get(filtered, 'etc', 'snmp', 'snmpd.conf')?.kind).toBe('file');
    expect(get(filtered, 'etc', 'switch', 'acl.conf')?.kind).toBe('file');
  });

  it('pins the externally-observable allowlist exactly (security tripwire)', () => {
    // TRIPWIRE: adding a path here widens what an UNAUTHENTICATED reader can see.
    // /var/lib/dpkg/status leaks the full package list (fine while CVEs are
    // port-bound); narrow it to running-service entries if off-port CVEs land.
    expect(EXTERNALLY_OBSERVABLE_ALLOWLIST).toEqual([
      '/var/run/*.pid',
      '/etc/iptables/rules.v4',
      '/etc/snmp/snmpd.conf',
      '/etc/switch/acl.conf',
      '/var/www/**',
      '/var/lib/dpkg/status',
    ]);
  });

  it('does not mutate the input tree', () => {
    const tree = dir(
      { etc: dir({ passwd: file('hash', PASSWD_FILE) }, TRAVERSABLE_DIR) },
      TRAVERSABLE_DIR,
    );

    filterTreeToAllowlist(tree);

    expect(get(tree, 'etc', 'passwd')?.kind).toBe('file');
  });
});
