import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs } from './remoteHostFs';
import { md5 } from './md5';
import type { LanHost } from './generateHomeLan';
import type { Directory, FileNode } from '../filesystem/types';

/**
 * `buildRemoteHostFs` is the pure per-host filesystem generator for the LAN's
 * NPC machines (ssh epic, Slice 2). Deterministic from the identity pubkey +
 * ESSID + the host, it plants `/var/run/<pidfile>` for the services a host
 * rolls — today only ssh, on a seeded ~40% of hosts, mostly on :22 with an
 * occasional non-standard port. Slice 2 emits ONLY `/var/run`; the rest of the
 * skeleton (passwd/home/…) lands in Slice 3.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const SUBNET = '192.168.50';

const host = (octet: number): LanHost => ({
  ip: `${SUBNET}.${octet}`,
  hostname: `host-${octet}`,
  kind: 'machine',
});

/** The `/var/run` directory of a generated host FS, or undefined if absent. */
const varRun = (fs: Directory): Directory | undefined => {
  const varDir = fs.entries.get('var');
  if (varDir === undefined || varDir.kind !== 'directory') return undefined;
  const run = varDir.entries.get('run');
  return run !== undefined && run.kind === 'directory' ? run : undefined;
};

/** The content of a host's `/var/run/<name>` pidfile, or null when absent. */
const pidfileContent = (fs: Directory, name: string): string | null => {
  const node = varRun(fs)?.entries.get(name);
  return node !== undefined && node.kind === 'file' ? node.content : null;
};

const OCTETS = Array.from({ length: 253 }, (_, index) => index + 2); // 2..254

const sshHosts = (): readonly { octet: number; port: number }[] =>
  OCTETS.flatMap((octet) => {
    const content = pidfileContent(buildRemoteHostFs(PUBKEY, ESSID, host(octet)), 'sshd.pid');
    if (content === null) return [];
    const port = Number(content.split('=')[1]);
    return [{ octet, port }];
  });

/** Navigate to a directory by path segments (readable, no optional chaining). */
const dirAt = (fs: Directory, ...segments: readonly string[]): Directory => {
  let node: FileNode = fs;
  for (const segment of segments) {
    if (node.kind !== 'directory') throw new Error(`not a directory before "${segment}"`);
    const next = node.entries.get(segment);
    if (next === undefined) throw new Error(`missing entry "${segment}"`);
    node = next;
  }
  if (node.kind !== 'directory') throw new Error('target is not a directory');
  return node;
};

/** The `/etc/passwd` rows (split into fields), non-empty lines only. */
const passwdRows = (fs: Directory): readonly (readonly string[])[] => {
  const passwd = dirAt(fs, 'etc').entries.get('passwd');
  if (passwd?.kind !== 'file') throw new Error('missing /etc/passwd');
  return passwd.content
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(':'));
};

const rowFor = (fs: Directory, username: string): readonly string[] => {
  const row = passwdRows(fs).find((fields) => fields[0] === username);
  if (row === undefined) throw new Error(`no passwd row for "${username}"`);
  return row;
};

/** The single non-root, non-guest account — the seeded NPC user. */
const npcUserRow = (fs: Directory): readonly string[] => {
  const row = passwdRows(fs).find((fields) => fields[0] !== 'root' && fields[0] !== 'guest');
  if (row === undefined) throw new Error('no NPC user row');
  return row;
};

describe('buildRemoteHostFs', () => {
  it('is deterministic: same pubkey + ESSID + host yields a byte-identical tree', () => {
    expect(buildRemoteHostFs(PUBKEY, ESSID, host(42))).toEqual(
      buildRemoteHostFs(PUBKEY, ESSID, host(42)),
    );
  });

  it('always emits a /var/run directory', () => {
    // Even a host running no services has /var/run (just empty) — it is where a
    // pidfile would land, and nmap reads it.
    expect(OCTETS.every((octet) => varRun(buildRemoteHostFs(PUBKEY, ESSID, host(octet))) !== undefined)).toBe(
      true,
    );
  });

  it('plants a root-owned sshd.pid (sshd:port=<n>) on a host that runs ssh', () => {
    const ssh = sshHosts();
    expect(ssh.length).toBeGreaterThan(0);
    const fs = buildRemoteHostFs(PUBKEY, ESSID, host(ssh[0]!.octet));
    const node = varRun(fs)?.entries.get('sshd.pid');
    if (node === undefined || node.kind !== 'file') throw new Error('expected sshd.pid file');
    expect(node.content).toMatch(/^sshd:port=\d+$/);
    expect(node.owner).toBe('root');
  });

  it('stamps the FS permission boundaries: /var/run world-readable + root-writable, pidfile not executable', () => {
    const fs = buildRemoteHostFs(PUBKEY, ESSID, host(sshHosts()[0]!.octet));
    const run = varRun(fs);
    if (run === undefined) throw new Error('expected /var/run');
    // /var/run: every tier can traverse + read (so nmap/ps can see ports); only
    // root writes a pidfile — root-owned, like the real /var/run.
    expect(run.owner).toBe('root');
    expect(run.perms).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root', 'user', 'guest'],
    });
    const pid = run.entries.get('sshd.pid');
    if (pid?.kind !== 'file') throw new Error('expected sshd.pid file');
    // A pidfile is world-readable, root-writable, never executed.
    expect(pid.perms).toEqual({ read: ['root', 'user', 'guest'], write: ['root'], execute: [] });
  });

  it('leaves /var/run empty on a host that runs no service', () => {
    const sshOctets = new Set(sshHosts().map((entry) => entry.octet));
    const nonSshOctet = OCTETS.find((octet) => !sshOctets.has(octet));
    if (nonSshOctet === undefined) throw new Error('expected at least one non-ssh host');
    expect(varRun(buildRemoteHostFs(PUBKEY, ESSID, host(nonSshOctet)))?.entries.size).toBe(0);
  });

  it('runs ssh on roughly the placement fraction of hosts (not none, all, or inverted)', () => {
    const count = sshHosts().length;
    // This deterministic 253-host sample yields 117 ssh hosts (~46% — PRNG noise
    // around the 0.4 target). The band brackets that while excluding the mutants
    // that matter: skip-none (253), skip-all (0), and a flipped threshold
    // (keep next() ≥ placement ⇒ ~136). So `placement` and the `>=` are both
    // load-bearing.
    expect(count).toBeGreaterThan(70);
    expect(count).toBeLessThan(130);
  });

  it('puts most ssh hosts on :22, a seeded minority on a non-standard port', () => {
    const ports = sshHosts().map((entry) => entry.port);
    // Every port is the default or one of the declared alternates.
    expect(ports.every((port) => port === 22 || port === 2222 || port === 8022)).toBe(true);
    const standard = ports.filter((port) => port === 22).length;
    const alt = ports.filter((port) => port !== 22).length;
    expect(standard).toBeGreaterThan(alt); // mostly :22
    expect(alt).toBeGreaterThan(0); // but at least one non-standard
  });

  describe('base filesystem skeleton (Slice 3 — an operable remote box)', () => {
    const fs = (): Directory => buildRemoteHostFs(PUBKEY, ESSID, host(42));

    it('grows from pidfile-only to the full operable skeleton', () => {
      // Same top-level shape as the player's own workstation: a host you ssh into
      // must be a real, operable Linux box (browse + run commands on it).
      expect([...fs().entries.keys()].sort()).toEqual([
        'bin',
        'etc',
        'home',
        'lib',
        'root',
        'tmp',
        'usr',
        'var',
      ]);
    });

    it('is operable: /bin has ls + cat (world-executable) so a logged-in user can browse', () => {
      const bin = dirAt(fs(), 'bin');
      expect(bin.entries.has('ls')).toBe(true);
      expect(bin.entries.has('cat')).toBe(true);
      expect(bin.perms.execute).toEqual(['root', 'user', 'guest']);
    });

    it('ships /lib and /usr/sbin/sshd so linked commands + the daemon resolve', () => {
      expect(dirAt(fs(), 'lib').entries.has('libpcre.so')).toBe(true);
      expect(dirAt(fs(), 'usr', 'sbin').entries.has('sshd')).toBe(true);
    });

    it('plants /var/log/auth.log empty (the ssh login line appends there)', () => {
      const node = dirAt(fs(), 'var', 'log').entries.get('auth.log');
      if (node?.kind !== 'file') throw new Error('missing /var/log/auth.log');
      expect(node.content).toBe('');
    });

    it('keeps /var/run as the service pidfile dir (Slice 2 behaviour untouched)', () => {
      expect(dirAt(fs(), 'var', 'run').kind).toBe('directory');
    });

    it('/root is root-only and /tmp is world-writable (faithful boundaries)', () => {
      expect(dirAt(fs(), 'root').perms).toEqual({
        read: ['root'],
        write: ['root'],
        execute: ['root'],
      });
      expect(dirAt(fs(), 'tmp').perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root', 'user', 'guest'],
        execute: ['root', 'user', 'guest'],
      });
    });
  });

  describe('/etc/passwd (NPC accounts — every account has a real password)', () => {
    const fs = (): Directory => buildRemoteHostFs(PUBKEY, ESSID, host(42));

    it('has exactly root + one NPC user + guest, 7 colon-fields each', () => {
      const rows = passwdRows(fs());
      expect(rows).toHaveLength(3);
      rows.forEach((fields) => expect(fields).toHaveLength(7));
      const names = rows.map((fields) => fields[0]);
      expect(names).toContain('root');
      expect(names).toContain('guest');
    });

    it('is root-owned and root+user readable, never guest (inline passwords, no /etc/shadow)', () => {
      const passwd = dirAt(fs(), 'etc').entries.get('passwd');
      if (passwd?.kind !== 'file') throw new Error('missing /etc/passwd');
      expect(passwd.owner).toBe('root');
      expect(passwd.perms).toEqual({ read: ['root', 'user'], write: ['root'], execute: ['root'] });
    });

    it('gives root a seeded md5 hash at uid 0 (a real target, unlike your own box)', () => {
      const root = rowFor(fs(), 'root');
      expect(root[1]).toMatch(/^[0-9a-f]{32}$/);
      expect(root[1]).not.toBe(md5('')); // not empty / passwordless
      expect(root[2]).toBe('0');
      expect(root[3]).toBe('0');
      expect(root[4]).toBe('root'); // gecos
      expect(root[5]).toBe('/root');
      expect(root[6]).toBe('/bin/bash');
    });

    it('gives guest a seeded md5 hash at uid 1001', () => {
      const guest = rowFor(fs(), 'guest');
      expect(guest[1]).toMatch(/^[0-9a-f]{32}$/);
      expect(guest[1]).not.toBe(md5(''));
      expect(guest[2]).toBe('1001');
      expect(guest[4]).toBe('guest'); // gecos
      expect(guest[5]).toBe('/home/guest');
    });

    it('gives the NPC user a seeded md5 hash at uid 1000 with a matching home', () => {
      const userRow = npcUserRow(fs());
      expect(userRow[1]).toMatch(/^[0-9a-f]{32}$/);
      expect(userRow[1]).not.toBe(md5(''));
      expect(userRow[2]).toBe('1000');
      expect(userRow[5]).toBe(`/home/${userRow[0]}`);
    });

    it('plants the NPC user a home dir owned by them under /home', () => {
      const tree = fs();
      const username = npcUserRow(tree)[0]!;
      const home = dirAt(tree, 'home', username);
      expect(home.owner).toBe(username);
      expect(home.perms).toEqual({
        read: ['root', 'user'],
        write: ['root', 'user'],
        execute: ['root', 'user'],
      });
    });
  });

  describe('the seed drives the passwd (deterministic, coordinate-sensitive)', () => {
    it('different ESSID re-rolls the credentials (the seed includes the network)', () => {
      const hashA = rowFor(buildRemoteHostFs(PUBKEY, 'NET-ALPHA', host(42)), 'root')[1];
      const hashB = rowFor(buildRemoteHostFs(PUBKEY, 'NET-BETA', host(42)), 'root')[1];
      expect(hashA).not.toBe(hashB);
    });

    it('different host IP re-rolls the credentials (the seed includes the host)', () => {
      const hashA = rowFor(buildRemoteHostFs(PUBKEY, ESSID, host(42)), 'root')[1];
      const hashB = rowFor(buildRemoteHostFs(PUBKEY, ESSID, host(99)), 'root')[1];
      expect(hashA).not.toBe(hashB);
    });

    it('different identity re-rolls the credentials (the seed includes the pubkey)', () => {
      const hashA = rowFor(buildRemoteHostFs('a'.repeat(64), ESSID, host(42)), 'root')[1];
      const hashB = rowFor(buildRemoteHostFs('b'.repeat(64), ESSID, host(42)), 'root')[1];
      expect(hashA).not.toBe(hashB);
    });
  });
});
