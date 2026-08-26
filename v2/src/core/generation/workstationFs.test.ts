import { describe, expect, it } from 'vitest';
import type { GameConfig } from '../gameConfig/gameConfig';
import type { Directory, FileEntry, FileNode } from '../filesystem/types';
import { canRead, canWrite } from '../filesystem/walker';
import { resolveWebPath, WEB_ROOT } from '../network/http';
import {
  buildWorkstationBaseFs,
  buildWorkstationBaseFsFromIdentity,
  workstationGuestPassword,
} from './workstationFs';
import {
  LOCALHOST_PREINSTALLED_TOOLS,
  SERVICE_CONTROL_TOOLS,
  RESTRICTED_EXECUTE,
  SYSTEM_DAEMON_NAMES,
  SYSTEM_UTILITY_NAMES,
} from './binaries';
import { md5 } from './md5';
import { CRACKABLE_PASSWORDS } from './passwordPools';
import { DEFAULT_WORDLIST } from '../wordlist/defaultWordlist';

/**
 * Story 1: the player's own-workstation base filesystem is generated
 * deterministically from the Ed25519 identity pubkey, observable today
 * through the read path (`ls` / `cat`). These tests assert the generator's
 * behaviour through its public output (the `Directory` tree), not internals.
 */

// Two distinct valid 64-hex pubkeys — the seed source per decision 1.
const SEED_A = '1'.repeat(64);
const SEED_B = '2'.repeat(64);

const getConfig = (overrides: Partial<GameConfig> = {}): GameConfig => ({
  machineName: 'workstation',
  username: 'alice',
  rootPassword: 'hunter2',
  ...overrides,
});

/** Navigate to a directory by path segments; throws if any segment is missing
 *  or not a directory (keeps the tests readable without optional chaining). */
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

/** The FILE at an absolute path; throws if it is missing or a directory. Lets a
 *  test address a node by the same path string the rest of the game uses. */
const fileAt = (fs: Directory, path: string): FileEntry => {
  const segments = path.split('/').filter((segment) => segment !== '');
  const name = segments[segments.length - 1];
  const parent = dirAt(fs, ...segments.slice(0, -1));
  const node = parent.entries.get(name);
  if (node?.kind !== 'file') throw new Error(`missing file "${path}"`);
  return node;
};

const readPasswd = (fs: Directory): string => {
  const passwd = dirAt(fs, 'etc').entries.get('passwd');
  if (passwd?.kind !== 'file') throw new Error('missing /etc/passwd file');
  return passwd.content;
};

const passwdRow = (fs: Directory, username: string): readonly string[] => {
  const row = readPasswd(fs)
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(':'))
    .find((fields) => fields[0] === username);
  if (row === undefined) throw new Error(`no passwd row for "${username}"`);
  return row;
};

describe('buildWorkstationBaseFs', () => {
  it('is deterministic: the same pubkey + config yields a byte-identical tree', () => {
    const config = getConfig();
    expect(buildWorkstationBaseFs(SEED_A, config)).toEqual(buildWorkstationBaseFs(SEED_A, config));
  });

  it('derives the guest hash reproducibly from the seed (pins the whole seed→passwd pipeline)', () => {
    // Golden values lock the deterministic derivation end to end: the
    // `workstation-` seed namespace, the PRNG, the crackable-pool order, and
    // md5. SEED_A selects 'linksys', SEED_B selects 'letmein' — two distinct
    // words, so a pool that collapsed to a single entry would fail here.
    expect(passwdRow(buildWorkstationBaseFs(SEED_A, getConfig()), 'guest')[1]).toBe(
      '0c4c43c0a94fc3d2210fa58dca6e09da',
    );
    expect(passwdRow(buildWorkstationBaseFs(SEED_B, getConfig()), 'guest')[1]).toBe(
      '0d107d09f5bbe40cade3de5c71e9e9b7',
    );
  });

  it('lets the seed drive output: different pubkeys produce different guest hashes', () => {
    const config = getConfig();
    const guestHashA = passwdRow(buildWorkstationBaseFs(SEED_A, config), 'guest')[1];
    const guestHashB = passwdRow(buildWorkstationBaseFs(SEED_B, config), 'guest')[1];
    expect(guestHashA).not.toBe(guestHashB);
  });

  it('contains exactly the base skeleton and nothing else', () => {
    const fs = buildWorkstationBaseFs(SEED_A, getConfig());
    // Allow-list, deliberately explicit: `/bin` (system utils), `/usr`
    // (pre-installed apt tools under /usr/bin), and `/lib` (shared libraries).
    expect([...fs.entries.keys()].sort()).toEqual([
      'bin',
      'boot',
      'etc',
      'home',
      'lib',
      'root',
      'tmp',
      'usr',
      'var',
    ]);
    expect([...dirAt(fs, 'boot').entries.keys()].sort()).toEqual(['initrd.img', 'vmlinuz']);
    expect([...dirAt(fs, 'etc').entries.keys()]).toEqual(['passwd']);
    expect([...dirAt(fs, 'home').entries.keys()]).toEqual(['alice']);
    expect(dirAt(fs, 'home', 'alice').entries.size).toBe(0);
    expect(dirAt(fs, 'root').entries.size).toBe(0);
    expect(dirAt(fs, 'tmp').entries.size).toBe(0);
    expect([...dirAt(fs, 'var').entries.keys()].sort()).toEqual(['log', 'run', 'www']);
    expect([...dirAt(fs, 'var', 'www').entries.keys()]).toEqual(['html']);
    expect([...dirAt(fs, 'var', 'log').entries.keys()].sort()).toEqual([
      'access.log',
      'auth.log',
      'kern.log',
    ]);
    expect(dirAt(fs, 'var', 'run').entries.size).toBe(0);
  });

  describe('/var/log/auth.log', () => {
    const authLog = (): FileNode => {
      const node = dirAt(buildWorkstationBaseFs(SEED_A, getConfig()), 'var', 'log').entries.get(
        'auth.log',
      );
      if (node?.kind !== 'file') throw new Error('missing /var/log/auth.log file');
      return node;
    };

    it('starts empty (no entries until a command logs)', () => {
      const node = authLog();
      if (node.kind !== 'file') throw new Error('expected file');
      expect(node.content).toBe('');
    });

    it('is root-owned, world-readable, and NOT world-writable (a real privilege boundary)', () => {
      const node = authLog();
      if (node.kind !== 'file') throw new Error('expected file');
      // World-readable so the defender can `cat` it; only root writes it (su's
      // system-tier append models a setuid-root syslog write).
      expect(node.owner).toBe('root');
      expect(node.perms.read).toEqual(['root', 'user', 'guest']);
      expect(node.perms.write).toEqual(['root']);
    });
  });

  describe('/var/log/access.log', () => {
    const accessLog = (): FileEntry => {
      const node = dirAt(buildWorkstationBaseFs(SEED_A, getConfig()), 'var', 'log').entries.get(
        'access.log',
      );
      if (node?.kind !== 'file') throw new Error('missing /var/log/access.log file');
      return node;
    };

    it('starts empty (no entries until someone fetches a page)', () => {
      expect(accessLog().content).toBe('');
    });

    it('is root-owned and world-readable, but never player-writable', () => {
      // Readable by anyone who is ON the box — getting on the box is the gate. Written
      // by root alone: a visitor who could edit it would erase the record of their visit.
      const node = accessLog();
      expect(node.owner).toBe('root');
      expect(node.perms.read).toEqual(['root', 'user', 'guest']);
      expect(node.perms.write).toEqual(['root']);
    });
  });

  describe('/var/log/kern.log', () => {
    const kernLog = (): FileEntry => {
      const node = dirAt(buildWorkstationBaseFs(SEED_A, getConfig()), 'var', 'log').entries.get(
        'kern.log',
      );
      if (node?.kind !== 'file') throw new Error('missing /var/log/kern.log file');
      return node;
    };

    it('starts empty (no entries until a scan logs)', () => {
      expect(kernLog().content).toBe('');
    });

    it('is root-owned, world-readable, and NOT world-writable (iptables LOG is a kernel write)', () => {
      const node = kernLog();
      expect(node.owner).toBe('root');
      expect(node.perms.read).toEqual(['root', 'user', 'guest']);
      expect(node.perms.write).toEqual(['root']);
    });
  });

  describe('/bin system-utility binaries', () => {
    const baseFs = (): Directory => buildWorkstationBaseFs(SEED_A, getConfig());

    it('populates /bin with exactly the system-utility set', () => {
      expect([...dirAt(baseFs(), 'bin').entries.keys()].sort()).toEqual(
        [...SYSTEM_UTILITY_NAMES].sort(),
      );
    });

    it('includes the binaries every currently-gated v2 command needs', () => {
      // The gated v2 commands (cat/grep/ls/man/mkdir/rm/touch) plus the
      // connectivity tools the arc depends on (ifconfig/nmcli) and apt itself.
      const binKeys = [...dirAt(baseFs(), 'bin').entries.keys()];
      const required = [
        'cat',
        'grep',
        'ls',
        'man',
        'mkdir',
        'rm',
        'touch',
        'ifconfig',
        'nmcli',
        'apt',
      ];
      required.forEach((name) => expect(binKeys).toContain(name));
    });

    it('makes binaries root-owned and world-executable by default', () => {
      const lsBin = dirAt(baseFs(), 'bin').entries.get('ls');
      if (lsBin?.kind !== 'file') throw new Error('missing /bin/ls');
      expect(lsBin.owner).toBe('root');
      // A system binary is a real (non-empty) stub file — `ls -l /bin` shows a
      // non-zero size, `cat`/`strings` show ELF-ish bytes.
      expect(lsBin.content.length).toBeGreaterThan(0);
      expect(lsBin.perms.execute).toEqual(['root', 'user', 'guest']);
      // World-readable, root-only writable (you can't tamper with a system binary).
      expect(lsBin.perms.read).toEqual(['root', 'user', 'guest']);
      expect(lsBin.perms.write).toEqual(['root']);
    });

    it('restricts execute on RESTRICTED_EXECUTE binaries (reboot is root-only)', () => {
      const rebootBin = dirAt(baseFs(), 'bin').entries.get('reboot');
      if (rebootBin?.kind !== 'file') throw new Error('missing /bin/reboot');
      expect(rebootBin.perms.execute).toEqual(RESTRICTED_EXECUTE.reboot);
      expect(rebootBin.perms.execute).toEqual(['root']);
    });

    it('makes /bin world-traversable but root-write-only', () => {
      const bin = dirAt(baseFs(), 'bin');
      expect(bin.perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      });
    });
  });

  describe('/usr/bin pre-installed apt tools', () => {
    const baseFs = (): Directory => buildWorkstationBaseFs(SEED_A, getConfig());

    it('populates /usr/bin with exactly the pre-installed apt and service tools', () => {
      expect([...dirAt(baseFs(), 'usr', 'bin').entries.keys()].sort()).toEqual(
        [...LOCALHOST_PREINSTALLED_TOOLS, ...SERVICE_CONTROL_TOOLS].sort(),
      );
    });

    it('pre-installs systemctl, so a box can always be told to stop serving', () => {
      // Named literally rather than through the constant: spelling it as
      // `SERVICE_CONTROL_TOOLS` on both sides would still pass if the list were
      // emptied, which is exactly the regression worth catching.
      expect(dirAt(baseFs(), 'usr', 'bin').entries.has('systemctl')).toBe(true);
    });

    it('pre-installs the wifi-cracking tools airmon-ng/airodump-ng/aircrack-ng', () => {
      const keys = [...dirAt(baseFs(), 'usr', 'bin').entries.keys()];
      ['airmon-ng', 'airodump-ng', 'aircrack-ng'].forEach((name) => expect(keys).toContain(name));
    });

    it('does NOT pre-install node or gpg (apt-installable, not bundled on a fresh box)', () => {
      const keys = [...dirAt(baseFs(), 'usr', 'bin').entries.keys()];
      expect(keys).not.toContain('node');
      expect(keys).not.toContain('gpg');
    });

    it('makes /usr/bin binaries root-owned, non-empty and world-executable', () => {
      const aircrackNg = dirAt(baseFs(), 'usr', 'bin').entries.get('aircrack-ng');
      if (aircrackNg?.kind !== 'file') throw new Error('missing /usr/bin/aircrack-ng');
      expect(aircrackNg.owner).toBe('root');
      expect(aircrackNg.content.length).toBeGreaterThan(0);
      expect(aircrackNg.perms.execute).toEqual(['root', 'user', 'guest']);
    });

    it('places the apt tools under /usr/bin, alongside the /usr/sbin daemons', () => {
      expect([...dirAt(baseFs(), 'usr').entries.keys()].sort()).toEqual(['bin', 'sbin']);
    });
  });

  describe('/usr/sbin admin daemons', () => {
    const baseFs = (): Directory => buildWorkstationBaseFs(SEED_A, getConfig());

    it('pre-installs exactly the system-daemon set (sshd) in /usr/sbin', () => {
      expect([...dirAt(baseFs(), 'usr', 'sbin').entries.keys()].sort()).toEqual(
        [...SYSTEM_DAEMON_NAMES].sort(),
      );
    });

    it('ships sshd so `sshd` is runnable from a fresh box (no apt install needed)', () => {
      expect(dirAt(baseFs(), 'usr', 'sbin').entries.has('sshd')).toBe(true);
    });

    it('makes sshd root-owned, non-empty and world-executable (anyone may run it; it self-gates root)', () => {
      const sshdBin = dirAt(baseFs(), 'usr', 'sbin').entries.get('sshd');
      if (sshdBin?.kind !== 'file') throw new Error('missing /usr/sbin/sshd');
      expect(sshdBin.owner).toBe('root');
      expect(sshdBin.content.length).toBeGreaterThan(0);
      expect(sshdBin.perms.execute).toEqual(['root', 'user', 'guest']);
    });
  });

  describe('/var/run service pidfile directory', () => {
    it('exists empty so sshd can drop its pidfile, world-readable and root-writable', () => {
      const run = dirAt(buildWorkstationBaseFs(SEED_A, getConfig()), 'var', 'run');
      // Empty at boot (no service running yet); root writes the pidfile (sshd
      // runs as root), every tier can read/traverse so nmap/ps can see the port.
      //
      // Empty also means no LISTENER. The world plants those on NPC boxes as the
      // door a player sweeping a strange LAN is meant to find; nobody opts into
      // one on the machine they defend, and a listener here would be a free
      // user-tier shell on it.
      expect(run.entries.size).toBe(0);
      expect(run.perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      });
    });
  });

  describe('/var/www/html web root (what a running web server publishes)', () => {
    const baseFs = (): Directory => buildWorkstationBaseFs(SEED_A, getConfig());

    it('ships a default page at exactly the path an HTTP request for / resolves to', () => {
      // Generation and serving must agree on WHERE the page lives, so the path is
      // taken from the HTTP layer rather than spelled out again here: put the file
      // one directory off and this fails.
      const requested = resolveWebPath('/');
      if (requested === null) throw new Error('/ must resolve inside the web root');

      const page = fileAt(baseFs(), requested);

      expect(page.owner).toBe('root');
      expect(page.content.length).toBeGreaterThan(0);
    });

    it('tells the player which file to edit to publish something of their own', () => {
      // The default page is the player's first sight of their own web surface; a
      // page that says nothing leaves them with no way to find the file.
      const page = fileAt(baseFs(), `${WEB_ROOT}/index.html`);

      expect(page.content).toContain(`${WEB_ROOT}/index.html`);
    });

    it('ships the default page as multi-line HTML that closes its tags', () => {
      // `curl` emits one terminal line per source line, so a page collapsed onto a
      // single line renders as one wrapped blob — and an unclosed document is
      // simply broken HTML for the player to inherit.
      const lines = fileAt(baseFs(), `${WEB_ROOT}/index.html`).content.split('\n');

      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]).toBe('<html>');
      expect(lines[lines.length - 1]).toBe('</html>');
    });

    it('makes the page world-readable, root-write-only and not executable', () => {
      // World-readable because a published page is public by definition, and the
      // same posture a generated NPC host uses — one web permission model, so an
      // own box and an NPC box cannot disagree about what publishing means.
      expect(fileAt(baseFs(), `${WEB_ROOT}/index.html`).perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: [],
      });
    });

    it('lets only root edit the page — the same privilege that starts the server', () => {
      const fs = baseFs();
      const chain = [fs.perms, dirAt(fs, 'var').perms, dirAt(fs, 'var', 'www').perms];
      const page = fileAt(fs, `${WEB_ROOT}/index.html`);

      // You must `su` to publish, exactly as you must `su` to start nginx — one
      // privilege for the whole capability rather than two half-permissions.
      expect(canWrite('root', page.perms, [...chain, dirAt(fs, 'var', 'www', 'html').perms]).allowed).toBe(
        true,
      );
      expect(canWrite('user', page.perms, [...chain, dirAt(fs, 'var', 'www', 'html').perms]).allowed).toBe(
        false,
      );
      expect(
        canWrite('guest', page.perms, [...chain, dirAt(fs, 'var', 'www', 'html').perms]).allowed,
      ).toBe(false);
    });

    it('makes /var/www and /var/www/html world-traversable so a reader can reach the page', () => {
      const traversable = {
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      };

      expect(dirAt(baseFs(), 'var', 'www').perms).toEqual(traversable);
      expect(dirAt(baseFs(), 'var', 'www', 'html').perms).toEqual(traversable);
    });
  });

  describe('/boot kernel images (the brick surface)', () => {
    const baseFs = (): Directory => buildWorkstationBaseFs(SEED_A, getConfig());

    it('ships both /boot/vmlinuz and /boot/initrd.img as non-empty, root-owned files', () => {
      const boot = dirAt(baseFs(), 'boot');
      ['vmlinuz', 'initrd.img'].forEach((name) => {
        const node = boot.entries.get(name);
        if (node?.kind !== 'file') throw new Error(`missing /boot/${name}`);
        expect(node.owner).toBe('root');
        expect(node.content.length).toBeGreaterThan(0);
      });
    });

    it('makes the boot files world-readable but root-write-only, so only root can delete them', () => {
      const vmlinuz = dirAt(baseFs(), 'boot').entries.get('vmlinuz');
      if (vmlinuz?.kind !== 'file') throw new Error('missing /boot/vmlinuz');
      expect(vmlinuz.perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root'],
      });
    });

    it('makes /boot world-traversable but root-write-only', () => {
      expect(dirAt(baseFs(), 'boot').perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      });
    });

    it('lets only root remove a boot file — guest/user are denied (the brick needs root)', () => {
      const fs = baseFs();
      const chain = [fs.perms, dirAt(fs, 'boot').perms];
      const vmlinuz = dirAt(fs, 'boot').entries.get('vmlinuz');
      if (vmlinuz?.kind !== 'file') throw new Error('missing /boot/vmlinuz');

      expect(canWrite('root', vmlinuz.perms, chain).allowed).toBe(true);
      expect(canWrite('user', vmlinuz.perms, chain).allowed).toBe(false);
      expect(canWrite('guest', vmlinuz.perms, chain).allowed).toBe(false);
    });
  });

  describe('/lib shared libraries', () => {
    const baseFs = (): Directory => buildWorkstationBaseFs(SEED_A, getConfig());

    it('populates /lib with exactly the 8 system-library .so files', () => {
      // Hard-coded (NOT derived from SYSTEM_LIBRARIES) so a dropped, renamed, or
      // typo'd library name is caught — a mangled .so would silently break the
      // future commands that link it (ssh→libssl, apt→libz/libxml2, su→libpam).
      expect([...dirAt(baseFs(), 'lib').entries.keys()].sort()).toEqual([
        'libcrypt.so',
        'libpam.so',
        'libpcre.so',
        'libreadline.so',
        'libssl.so',
        'libsystemd.so',
        'libxml2.so',
        'libz.so',
      ]);
    });

    it('includes libpcre.so — the library ls/cat/grep/rm link against', () => {
      expect(dirAt(baseFs(), 'lib').entries.has('libpcre.so')).toBe(true);
    });

    it('makes libraries root-owned, non-empty, world-readable and NOT executable as files', () => {
      const libpcre = dirAt(baseFs(), 'lib').entries.get('libpcre.so');
      if (libpcre?.kind !== 'file') throw new Error('missing /lib/libpcre.so');
      expect(libpcre.owner).toBe('root');
      expect(libpcre.content.length).toBeGreaterThan(0);
      expect(libpcre.perms.read).toEqual(['root', 'user', 'guest']);
      expect(libpcre.perms.write).toEqual(['root']);
      // A .so is linked, never executed as a file — empty execute allowlist.
      expect(libpcre.perms.execute).toEqual([]);
    });

    it('makes /lib world-traversable but root-write-only', () => {
      expect(dirAt(baseFs(), 'lib').perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      });
    });
  });

  it('generates a well-formed /etc/passwd: 3 users, 7 colon-delimited fields each', () => {
    const content = readPasswd(buildWorkstationBaseFs(SEED_A, getConfig()));
    const rows = content.split('\n').filter((line) => line.length > 0);
    expect(rows).toHaveLength(3);
    rows.forEach((line) => expect(line.split(':')).toHaveLength(7));
  });

  it('hashes the root password with md5 at uid 0', () => {
    const root = passwdRow(
      buildWorkstationBaseFs(SEED_A, getConfig({ rootPassword: 'hunter2' })),
      'root',
    );
    // name:hash:uid:gid:gecos:home:shell
    expect(root[0]).toBe('root');
    expect(root[1]).toBe('2ab96390c7dbe3439de74d0c9b0b1767'); // md5('hunter2')
    expect(root[2]).toBe('0');
    expect(root[3]).toBe('0');
    expect(root[4]).toBe('root'); // gecos
    expect(root[5]).toBe('/root');
    expect(root[6]).toBe('/bin/bash');
  });

  it('gives the player user an empty hash at uid 1000 (always exit()-able)', () => {
    const player = passwdRow(buildWorkstationBaseFs(SEED_A, getConfig()), 'alice');
    expect(player[1]).toBe('');
    expect(player[2]).toBe('1000');
    expect(player[3]).toBe('1000');
    expect(player[5]).toBe('/home/alice');
  });

  it('gives guest a real seeded md5 hash at uid 1001', () => {
    const guest = passwdRow(buildWorkstationBaseFs(SEED_A, getConfig()), 'guest');
    expect(guest[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(guest[1]).not.toBe(md5('')); // not an empty/stub hash
    expect(guest[2]).toBe('1001');
    expect(guest[3]).toBe('1001');
    expect(guest[4]).toBe('guest'); // gecos
    expect(guest[5]).toBe('/home/guest');
  });

  it('names the home directory and player row from the config username', () => {
    const fs = buildWorkstationBaseFs(SEED_A, getConfig({ username: 'neo' }));
    expect([...dirAt(fs, 'home').entries.keys()]).toEqual(['neo']);
    expect(passwdRow(fs, 'neo')[5]).toBe('/home/neo');
  });

  describe('permission boundaries (asserted through the shared walker)', () => {
    it('/etc/passwd is readable by root and user but not guest (no /etc/shadow)', () => {
      const fs = buildWorkstationBaseFs(SEED_A, getConfig());
      const chain = [fs.perms, dirAt(fs, 'etc').perms];
      const passwd = dirAt(fs, 'etc').entries.get('passwd');
      if (passwd?.kind !== 'file') throw new Error('missing /etc/passwd');

      expect(canRead('root', passwd.perms, chain).allowed).toBe(true);
      expect(canRead('user', passwd.perms, chain).allowed).toBe(true);
      expect(canRead('guest', passwd.perms, chain)).toEqual({
        allowed: false,
        reason: 'target_unreadable',
      });
    });

    it('/root is readable only by root', () => {
      const fs = buildWorkstationBaseFs(SEED_A, getConfig());
      const rootDir = dirAt(fs, 'root');
      expect(canRead('root', rootDir.perms, [fs.perms]).allowed).toBe(true);
      expect(canRead('user', rootDir.perms, [fs.perms]).allowed).toBe(false);
      expect(canRead('guest', rootDir.perms, [fs.perms]).allowed).toBe(false);
    });

    it('/home/<username> is readable by root and user but not guest', () => {
      const fs = buildWorkstationBaseFs(SEED_A, getConfig());
      const home = dirAt(fs, 'home', 'alice');
      const chain = [fs.perms, dirAt(fs, 'home').perms];
      expect(canRead('user', home.perms, chain).allowed).toBe(true);
      expect(canRead('guest', home.perms, chain).allowed).toBe(false);
    });

    it('/tmp is world-writable', () => {
      const fs = buildWorkstationBaseFs(SEED_A, getConfig());
      const tmp = dirAt(fs, 'tmp');
      expect(canWrite('guest', tmp.perms, [fs.perms]).allowed).toBe(true);
    });

    it('emits the intended tier vectors for each node', () => {
      // The walker tests above prove these tiers produce the right allow/deny;
      // this locks the exact vectors the generator emits (the AC's "permissions
      // match the boundaries"), so a dropped/added tier can't slip through.
      const fs = buildWorkstationBaseFs(SEED_A, getConfig());
      const passwd = dirAt(fs, 'etc').entries.get('passwd');
      if (passwd?.kind !== 'file') throw new Error('missing /etc/passwd');

      // Container dirs (/, /etc, /home): world-traversable, root-only writes.
      expect(fs.perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      });
      // /etc/passwd: root+user read, root-only write/execute (inline passwords).
      expect(passwd.perms).toEqual({ read: ['root', 'user'], write: ['root'], execute: ['root'] });
      // /root: root-only across the board.
      expect(dirAt(fs, 'root').perms).toEqual({
        read: ['root'],
        write: ['root'],
        execute: ['root'],
      });
      // /home/<user>: root + the owning user.
      expect(dirAt(fs, 'home', 'alice').perms).toEqual({
        read: ['root', 'user'],
        write: ['root', 'user'],
        execute: ['root', 'user'],
      });
      // /tmp: world-writable scratch space.
      expect(dirAt(fs, 'tmp').perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root', 'user', 'guest'],
        execute: ['root', 'user', 'guest'],
      });
    });
  });
});

/**
 * Cross-player reconstruction (Story 2): a DIFFERENT identity's server-side read
 * of A's box rebuilds it from the occupancy-persisted identity (owner_key +
 * username + md5(rootPassword)) — A's plaintext config never leaves A's browser.
 * The reconstructed box must be byte-identical to the one A sees, or a cross-player
 * read would diverge from reality.
 */
describe('buildWorkstationBaseFsFromIdentity (server reconstruction)', () => {
  it('reconstructs the byte-identical box the owner sees, from owner_key + username + root-hash', () => {
    const config = getConfig({ username: 'neo', rootPassword: 'matrix1999' });
    const reconstructed = buildWorkstationBaseFsFromIdentity({
      ownerKeyHex: SEED_A,
      username: config.username,
      rootPasswordHash: md5(config.rootPassword),
    });

    expect(reconstructed).toEqual(buildWorkstationBaseFs(SEED_A, config));
  });

  it('uses the given root-hash verbatim — the server stores md5(rootPassword) and never re-hashes', () => {
    const fs = buildWorkstationBaseFsFromIdentity({
      ownerKeyHex: SEED_A,
      username: 'neo',
      rootPasswordHash: 'deadbeefdeadbeefdeadbeefdeadbeef',
    });

    expect(passwdRow(fs, 'root')[1]).toBe('deadbeefdeadbeefdeadbeefdeadbeef');
  });

  it('seeds the guest hash from owner_key alone (recoverable server-side, no config needed)', () => {
    const fs = buildWorkstationBaseFsFromIdentity({
      ownerKeyHex: SEED_B,
      username: 'neo',
      rootPasswordHash: md5('whatever'),
    });

    expect(passwdRow(fs, 'guest')[1]).toBe(
      passwdRow(buildWorkstationBaseFs(SEED_B, getConfig()), 'guest')[1],
    );
  });
});

describe('workstationGuestPassword', () => {
  it('recovers the guest plaintext that md5-hashes to the box guest line (the cross-player auth credential)', () => {
    const fs = buildWorkstationBaseFs(SEED_A, getConfig());
    expect(md5(workstationGuestPassword(SEED_A))).toBe(passwdRow(fs, 'guest')[1]);
  });

  it('is owner-key specific — different identities get different guest passwords', () => {
    expect(workstationGuestPassword(SEED_A)).not.toBe(workstationGuestPassword(SEED_B));
  });

  it('draws from the crackable pool, reaching every word in it', () => {
    // A workstation guest is the only way into a player's box before the CVE
    // phase, so it draws from the SAME crackable pool every other guest account
    // does — not a private near-copy of it. A second list that merely overlaps
    // is a curve nobody chose: it drifts silently the moment one is edited.
    const drawn = new Set(
      Array.from({ length: 400 }, (_, index) =>
        workstationGuestPassword(index.toString(16).padStart(64, '0')),
      ),
    );

    expect([...drawn].sort()).toEqual([...CRACKABLE_PASSWORDS].sort());
  });

  it('is always covered by the wordlist a player starts with', () => {
    // The end-to-end version of the promise, stated where the generator lives:
    // whatever a workstation stamps on guest, a default `apt install hydra`
    // must be able to recover. This is what makes cross-player play possible.
    const uncovered = Array.from({ length: 400 }, (_, index) =>
      workstationGuestPassword(index.toString(16).padStart(64, '0')),
    ).filter((password) => !DEFAULT_WORDLIST.includes(password));

    expect(uncovered).toEqual([]);
  });
});
