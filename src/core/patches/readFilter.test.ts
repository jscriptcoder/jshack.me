import { describe, expect, it } from 'vitest';
import type { Directory, FileNode, FilePermissions } from '../filesystem/types.js';
import {
  dir,
  file,
  HOME_DIR,
  PASSWD_FILE,
  ROOT_DIR,
  ROOT_FILE,
  TMP_DIR,
  TRAVERSABLE_DIR,
} from '../generation/baseFs.js';
import {
  EXTERNALLY_OBSERVABLE_ALLOWLIST,
  filterTreeForRead,
  filterTreeForSession,
  filterTreeToAllowlist,
} from './readFilter.js';
import { serializeTree } from '../filesystem/treeCodec.js';
import { buildApGatewayBaseFs } from '../generation/routerFs.js';
import { readRwCommunityHash } from '../snmp/rwCommunity.js';
import { asEpochMs } from '../types.js';

/**
 * The cross-player READ filter (Story 2, slice 2c — tier 2). Given a fully
 * materialized box tree and the CALLER's server-derived tier, it returns a tree
 * pruned to exactly the nodes that tier may read: every dropped node would
 * otherwise leak over the wire (the wire IS the threat surface), so these tests
 * assert the pruned tree's shape, not any UI rendering.
 *
 * Pruning is the shared permission walker (`canRead`) applied per node, as a real
 * `ls` sees a box: a name is served iff the tier can list the directory it sits in.
 * The bytes of a file, or the entries of a directory, are served iff the tier can
 * read that node too; otherwise it travels by name, owner and permissions alone.
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
  it('keeps a file the tier may read whole, and of one it may not only the name', () => {
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
    // A real `ls` lists a file it cannot open. The shell refuses to print it off the
    // permissions the node keeps, and the bytes never leave the server.
    const withheld = get(filtered, 'private');
    expect(withheld?.kind === 'file' ? withheld.content : null).toBe('');
    expect(withheld?.perms).toEqual(PASSWD_FILE);
    expect(JSON.stringify(serializeTree(filtered))).not.toContain('hash:roots');
  });

  it('keeps the name of a directory the tier may not enter, and nothing beneath it', () => {
    const tree = dir(
      {
        home: dir({ alice: dir({ notes: worldFile('diary') }, HOME_DIR) }, TRAVERSABLE_DIR),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeForRead(tree, 'guest');

    // /home survives (world-traversable). Its user subdir (root+user only) is listed
    // but served empty — even the world-readable file inside it must not leak.
    const alice = get(filtered, 'home', 'alice');
    expect(alice?.kind === 'directory' ? alice.entries.size : null).toBe(0);
    expect(alice?.perms).toEqual(HOME_DIR);
    expect(JSON.stringify(serializeTree(filtered))).not.toContain('diary');
  });

  it('withholds /etc/passwd from guest but hands it to user (read = root+user)', () => {
    const etc = () => dir({ passwd: file('root:x:0', PASSWD_FILE) }, TRAVERSABLE_DIR);
    const guestView = filterTreeForRead(dir({ etc: etc() }, TRAVERSABLE_DIR), 'guest');
    const userView = filterTreeForRead(dir({ etc: etc() }, TRAVERSABLE_DIR), 'user');

    const guestPasswd = get(guestView, 'etc', 'passwd');
    expect(guestPasswd?.kind === 'file' ? guestPasswd.content : null).toBe('');
    const userPasswd = get(userView, 'etc', 'passwd');
    expect(userPasswd?.kind === 'file' ? userPasswd.content : null).toBe('root:x:0');
  });

  it('keeps what a withheld file is besides its bytes: its owner and metadata', () => {
    const render: FileNode = {
      ...file('JFIF render', ROOT_FILE, 'designer'),
      metadata: { mtime: asEpochMs(1234), isExecutable: false },
    };
    const tree = dir({ design: render }, TRAVERSABLE_DIR);

    const design = get(filterTreeForRead(tree, 'user'), 'design');

    expect(design?.owner).toBe('designer');
    expect(design?.kind === 'file' ? design.metadata : null).toEqual({
      mtime: asEpochMs(1234),
      isExecutable: false,
    });
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

    expect(get(filtered, 'priv', 'leak')).toBeUndefined();
  });

  it('drops the name of a file deeper than a directory the tier may not enter', () => {
    // Inside a shut directory the tier may not even learn what sits there: a real
    // `ls` of it is refused, so neither file nor subdirectory names may leave.
    const tree = dir(
      {
        root: dir({ vault: dir({ 'keys.txt': file('KEYS', ROOT_FILE) }, ROOT_DIR) }, ROOT_DIR),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeForRead(tree, 'user');

    expect(get(filtered, 'root', 'vault')).toBeUndefined();
    expect(JSON.stringify(serializeTree(filtered))).not.toContain('vault');
    expect(JSON.stringify(serializeTree(filtered))).not.toContain('keys.txt');
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
    // `/var/lib` survives, carrying the allowlisted package manifest. The agent's
    // state directory beside it must not — that is where the community lives.
    expect(get(filtered, 'var', 'lib', 'snmp')).toBeUndefined();
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
            run: dir(
              { 'sshd.pid': worldFile('1'), 'boot-id': worldFile('boot-9f2') },
              TRAVERSABLE_DIR,
            ),
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
    expect(get(filtered, 'var', 'run', 'boot-id')?.kind).toBe('file');
    expect(get(filtered, 'var', 'www', 'index.html')?.kind).toBe('file');
    expect(get(filtered, 'var', 'lib', 'dpkg', 'status')?.kind).toBe('file');
    expect(get(filtered, 'etc', 'iptables', 'rules.v4')?.kind).toBe('file');
    expect(get(filtered, 'etc', 'snmp', 'snmpd.conf')?.kind).toBe('file');
    expect(get(filtered, 'etc', 'switch', 'acl.conf')?.kind).toBe('file');
  });

  /**
   * The moment a reboot closes a player's rows they hold no session, so the next
   * tree they pull is this tier — and a marker pruned out of it reads to their
   * client exactly like a box that has never rebooted at all. That is only ever
   * wrong ONCE per box, on its first reboot, which is precisely the kind of hole
   * that survives a test suite and reads afterwards as an unreproducible bug.
   */
  it('observes the boot id, so a box’s FIRST reboot reaches the session it just evicted', () => {
    const tree = dir(
      {
        var: dir(
          { run: dir({ 'boot-id': worldFile('boot-9f2') }, TRAVERSABLE_DIR) },
          TRAVERSABLE_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeToAllowlist(tree);

    const marker = get(filtered, 'var', 'run', 'boot-id');
    expect(marker?.kind === 'file' ? marker.content : null).toBe('boot-9f2');
  });

  // What the marker discloses is strictly smaller than the pidfiles beside it: that
  // the box went down, and an opaque id. WHO took it down lives in the kernel log,
  // which an unauthenticated reader still cannot see.
  it('does not observe who rebooted the box', () => {
    const tree = dir(
      {
        var: dir(
          {
            run: dir({ 'boot-id': worldFile('boot-9f2') }, TRAVERSABLE_DIR),
            log: dir({ 'kern.log': worldFile('reboot by 10.0.0.9') }, TRAVERSABLE_DIR),
          },
          TRAVERSABLE_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const filtered = filterTreeToAllowlist(tree);

    expect(get(filtered, 'var', 'run', 'boot-id')?.kind).toBe('file');
    expect(get(filtered, 'var', 'log')).toBeUndefined();
  });

  it('pins the externally-observable allowlist exactly (security tripwire)', () => {
    // TRIPWIRE: adding a path here widens what an UNAUTHENTICATED reader can see.
    // /var/lib/dpkg/status leaks the full package list (fine while CVEs are
    // port-bound); narrow it to running-service entries if off-port CVEs land.
    expect(EXTERNALLY_OBSERVABLE_ALLOWLIST).toEqual([
      '/var/run/*.pid',
      '/var/run/boot-id',
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

/**
 * `filterTreeForSession` is what a caller holding a session is served: everything
 * the session's tier reads, together with the externally-observable allowlist. A
 * caller with no session is already shown the allowlist, so a session that showed
 * less would leave the machinery a lower-tier shell runs (a scan of the layer behind
 * a switch, a fetch of the box's own web server) reading a file that is not there.
 */
describe('filterTreeForSession', () => {
  /** A box with one file of every kind that matters here: read by every tier, read
   *  by `user` but not `guest`, on the list but root's, and neither. */
  const box = (): Directory =>
    dir(
      {
        etc: dir(
          {
            hostname: worldFile('edge'),
            iptables: dir({ 'rules.v4': file('forward 80 to 10.0.0.5:80', ROOT_FILE) }, ROOT_DIR),
            passwd: file('root:hash', PASSWD_FILE),
          },
          TRAVERSABLE_DIR,
        ),
        root: dir({ 'notes.txt': worldFile('ROOT_NOTES') }, ROOT_DIR),
        var: dir({ run: dir({ 'sshd.pid': worldFile('4131') }, TRAVERSABLE_DIR) }, TRAVERSABLE_DIR),
      },
      TRAVERSABLE_DIR,
    );

  it('serves a listed file the tier cannot read, beside everything the tier can', () => {
    const served = filterTreeForSession(box(), 'guest');

    const rules = get(served, 'etc', 'iptables', 'rules.v4');
    expect(rules?.kind === 'file' ? rules.content : null).toBe('forward 80 to 10.0.0.5:80');
    expect(get(served, 'etc', 'hostname')?.kind).toBe('file');
    expect(get(served, 'var', 'run', 'sshd.pid')?.kind).toBe('file');
  });

  it('keeps a listed file’s own permissions, and those of the directory it sits in', () => {
    const served = filterTreeForSession(box(), 'guest');

    // The shell reads permissions off the node it is handed. Served as readable, a
    // lower tier could print the gateway's forwards.
    expect(get(served, 'etc', 'iptables', 'rules.v4')?.perms).toEqual(ROOT_FILE);
    expect(get(served, 'etc', 'iptables')?.perms).toEqual(ROOT_DIR);
  });

  it('serves no bytes that are neither readable by the tier nor on the list', () => {
    const served = filterTreeForSession(box(), 'guest');

    const passwd = get(served, 'etc', 'passwd');
    expect(passwd?.kind === 'file' ? passwd.content : null).toBe('');
    const root = get(served, 'root');
    expect(root?.kind === 'directory' ? root.entries.size : null).toBe(0);
    expect(JSON.stringify(serializeTree(served))).not.toContain('ROOT_NOTES');
    expect(JSON.stringify(serializeTree(served))).not.toContain('root:hash');
  });

  it('serves only the listed files of a directory the tier cannot enter', () => {
    // Somebody shut the web root to everybody but root. The server still hands its
    // pages to anyone who asks from outside. A backup beside the web root is on no
    // list, so it stays where it is.
    const tree = dir(
      {
        var: dir(
          {
            www: dir({ html: dir({ 'index.html': worldFile('<h1>hi</h1>') }, ROOT_DIR) }, ROOT_DIR),
            backups: dir({ 'site.tar': worldFile('BACKUP') }, ROOT_DIR),
          },
          TRAVERSABLE_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const served = filterTreeForSession(tree, 'guest');

    expect(get(served, 'var', 'www', 'html', 'index.html')?.kind).toBe('file');
    expect(get(served, 'var', 'www')?.perms).toEqual(ROOT_DIR);
    const backups = get(served, 'var', 'backups');
    expect(backups?.kind === 'directory' ? backups.entries.size : null).toBe(0);
    expect(JSON.stringify(serializeTree(served))).not.toContain('site.tar');
  });

  it('does not open a directory the tier may pass through but not list', () => {
    // A world-readable file under a directory the tier can traverse and cannot read
    // is beneath the tier's view. Being on no list either, it is not served.
    const passThrough: FilePermissions = {
      read: ['root'],
      write: ['root'],
      execute: ['root', 'user', 'guest'],
    };
    const tree = dir(
      {
        srv: dir({ 'drop.txt': worldFile('DROP') }, passThrough),
        var: dir({ run: dir({ 'sshd.pid': worldFile('4131') }, passThrough) }, TRAVERSABLE_DIR),
      },
      TRAVERSABLE_DIR,
    );

    const served = filterTreeForSession(tree, 'guest');

    const srv = get(served, 'srv');
    expect(srv?.kind === 'directory' ? srv.entries.size : null).toBe(0);
    // The same kind of directory holding a listed file is served for that file.
    expect(get(served, 'var', 'run', 'sshd.pid')?.kind).toBe('file');
  });

  it('serves nothing beneath a shut directory by name, not even an empty directory', () => {
    const tree = dir(
      { root: dir({ vault: dir({ deeper: dir({}, ROOT_DIR) }, ROOT_DIR) }, ROOT_DIR) },
      TRAVERSABLE_DIR,
    );

    const served = filterTreeForSession(tree, 'user');

    expect(get(served, 'root', 'vault')).toBeUndefined();
    expect(JSON.stringify(serializeTree(served))).not.toContain('vault');
  });

  it('serves only the listed files of a directory the tier cannot even see', () => {
    // `/var` is shut, so the tier's view stops at its name. The list alone reaches
    // `/var/run`, and of what sits there it serves the pidfiles and nothing else.
    const tree = dir(
      {
        var: dir(
          {
            run: dir(
              {
                'sshd.pid': worldFile('4131'),
                utmp: worldFile('WHO_IS_ON'),
                lock: dir({ 'subsys.lock': worldFile('LOCKED') }, TRAVERSABLE_DIR),
              },
              TRAVERSABLE_DIR,
            ),
          },
          ROOT_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const served = filterTreeForSession(tree, 'guest');

    expect(get(served, 'var', 'run', 'sshd.pid')?.kind).toBe('file');
    expect(get(served, 'var', 'run', 'utmp')).toBeUndefined();
    expect(get(served, 'var', 'run', 'lock')).toBeUndefined();
    expect(JSON.stringify(serializeTree(served))).not.toContain('WHO_IS_ON');
  });

  it('keeps an empty directory the tier can read', () => {
    const tree = dir({ tmp: dir({}, TMP_DIR) }, TRAVERSABLE_DIR);

    expect(get(filterTreeForSession(tree, 'guest'), 'tmp')?.kind).toBe('directory');
  });

  it('keeps every entry in the place the box holds it', () => {
    // `find` and `grep -r` walk entries in the order the tree holds them, so a file
    // moved to the end of its directory would read differently from the same box
    // seen whole.
    const served = filterTreeForSession(box(), 'guest');

    expect([...served.entries.keys()]).toEqual(['etc', 'root', 'var']);
    const etc = get(served, 'etc');
    expect(etc?.kind === 'directory' ? [...etc.entries.keys()] : null).toEqual([
      'hostname',
      'iptables',
      'passwd',
    ]);
  });

  it('serves a user session what a user reads, plus the list', () => {
    const served = filterTreeForSession(box(), 'user');

    const passwd = get(served, 'etc', 'passwd');
    expect(passwd?.kind === 'file' ? passwd.content : null).toBe('root:hash');
    expect(get(served, 'etc', 'iptables', 'rules.v4')?.kind).toBe('file');
    const root = get(served, 'root');
    expect(root?.kind === 'directory' ? root.entries.size : null).toBe(0);
  });

  it('withholds a file the tier cannot read from a directory the list also reaches', () => {
    // The list serves a router's NAT table whole. A root-only file beside it is on no
    // list, so it is served by name alone, however the directory came to be served.
    const tree = dir(
      {
        etc: dir(
          {
            iptables: dir(
              {
                'rules.v4': file('forward 80 to 10.0.0.5:80', ROOT_FILE),
                'rules.v4.bak': file('OLD FORWARDS', ROOT_FILE),
              },
              TRAVERSABLE_DIR,
            ),
          },
          TRAVERSABLE_DIR,
        ),
      },
      TRAVERSABLE_DIR,
    );

    const served = filterTreeForSession(tree, 'guest');

    const rules = get(served, 'etc', 'iptables', 'rules.v4');
    expect(rules?.kind === 'file' ? rules.content : null).toBe('forward 80 to 10.0.0.5:80');
    const backup = get(served, 'etc', 'iptables', 'rules.v4.bak');
    expect(backup?.kind === 'file' ? backup.content : null).toBe('');
    expect(JSON.stringify(serializeTree(served))).not.toContain('OLD FORWARDS');
  });

  it('hands root the whole tree back', () => {
    const tree = box();

    expect(filterTreeForSession(tree, 'root')).toEqual(tree);
  });

  it('never shows a session less than a caller with none, on a generated gateway', () => {
    // Against a GENERATED device: a hand-built tree can agree with the filter while
    // the box that ships disagrees with both.
    const gateway = buildApGatewayBaseFs('SESSION-VIEW-NET');

    const served = filterTreeForSession(gateway, 'guest');

    expect(serializeTree(filterTreeToAllowlist(served))).toEqual(
      serializeTree(filterTreeToAllowlist(gateway)),
    );
    expect(serializeTree(filterTreeForRead(served, 'guest'))).toEqual(
      serializeTree(filterTreeForRead(gateway, 'guest')),
    );
  });

  it('does not mutate the input tree', () => {
    const tree = box();

    filterTreeForSession(tree, 'guest');

    expect(get(tree, 'etc', 'passwd')?.kind).toBe('file');
    expect(get(tree, 'root', 'notes.txt')?.kind).toBe('file');
  });
});
