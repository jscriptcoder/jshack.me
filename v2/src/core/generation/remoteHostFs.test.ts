import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs } from './remoteHostFs';
import { md5 } from './md5';
import { DEFAULT_WORDLIST } from '../wordlist/defaultWordlist';
import { resolveWebPath } from '../network/http';
import { createFsView } from '../filesystem/fsView';
import type { LanHost } from './generateHomeLan';
import type { Directory, FileNode } from '../filesystem/types';

/**
 * `buildRemoteHostFs` is the pure per-host filesystem generator for the LAN's
 * NPC machines. Deterministic from the ESSID + the host, it emits a full
 * operable box: `/var/run/<pidfile>` per running service, `/etc/passwd` with
 * real credentials, a web root on a host that serves one, and the log files
 * traces append to.
 *
 * Its accounts are what `hydra` attacks and `ssh` validates, so the passwords it
 * stamps decide the difficulty curve — see the population tests at the bottom.
 */

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
    const content = pidfileContent(buildRemoteHostFs(ESSID, host(octet)), 'sshd.pid');
    if (content === null) return [];
    const port = Number(content.split('=')[1]);
    return [{ octet, port }];
  });

const httpHosts = (): readonly { octet: number; port: number }[] =>
  OCTETS.flatMap((octet) => {
    const content = pidfileContent(buildRemoteHostFs(ESSID, host(octet)), 'nginx.pid');
    if (content === null) return [];
    const port = Number(content.split('=')[1]);
    return [{ octet, port }];
  });

const ftpHosts = (): readonly { octet: number; port: number }[] =>
  OCTETS.flatMap((octet) => {
    const content = pidfileContent(buildRemoteHostFs(ESSID, host(octet)), 'vsftpd.pid');
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

/** The raw `/etc/passwd` content — every account at once, for assertions that would
 *  be flaky against a single seeded field drawn from a small pool. */
const passwdOf = (fs: Directory): string => {
  const passwd = dirAt(fs, 'etc').entries.get('passwd');
  if (passwd?.kind !== 'file') throw new Error('missing /etc/passwd');
  return passwd.content;
};

/** The `/etc/passwd` rows (split into fields), non-empty lines only. */
const passwdRows = (fs: Directory): readonly (readonly string[])[] =>
  passwdOf(fs)
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(':'));

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
    expect(buildRemoteHostFs(ESSID, host(42))).toEqual(
      buildRemoteHostFs(ESSID, host(42)),
    );
  });

  it('always emits a /var/run directory', () => {
    // Even a host running no services has /var/run (just empty) — it is where a
    // pidfile would land, and nmap reads it.
    expect(
      OCTETS.every((octet) => varRun(buildRemoteHostFs(ESSID, host(octet))) !== undefined),
    ).toBe(true);
  });

  it('plants a root-owned sshd.pid (sshd:port=<n>) on a host that runs ssh', () => {
    const ssh = sshHosts();
    expect(ssh.length).toBeGreaterThan(0);
    const fs = buildRemoteHostFs(ESSID, host(ssh[0]!.octet));
    const node = varRun(fs)?.entries.get('sshd.pid');
    if (node === undefined || node.kind !== 'file') throw new Error('expected sshd.pid file');
    expect(node.content).toMatch(/^sshd:port=\d+$/);
    expect(node.owner).toBe('root');
  });

  it('stamps the FS permission boundaries: /var/run world-readable + root-writable, pidfile not executable', () => {
    const fs = buildRemoteHostFs(ESSID, host(sshHosts()[0]!.octet));
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
    expect(varRun(buildRemoteHostFs(ESSID, host(nonSshOctet)))?.entries.size).toBe(0);
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

  describe('the web surface (a host running a web server has a page to serve)', () => {
    /** The served page of a host, or null when it has no web root. */
    const servedPage = (fs: Directory): string | null => {
      const varDir = fs.entries.get('var');
      if (varDir === undefined || varDir.kind !== 'directory') return null;
      const www = varDir.entries.get('www');
      if (www === undefined || www.kind !== 'directory') return null;
      const html = www.entries.get('html');
      if (html === undefined || html.kind !== 'directory') return null;
      const index = html.entries.get('index.html');
      return index !== undefined && index.kind === 'file' ? index.content : null;
    };

    /** A host's page with its own name substituted back out, so two hosts drawing
     *  the SAME template compare equal — the interpolated hostname would otherwise
     *  make every page look unique and hide a pool that never varies. */
    const servedTemplate = (octet: number): string | null => {
      const page = servedPage(buildRemoteHostFs(ESSID, host(octet)));
      return page === null ? null : page.replace(new RegExp(`host-${octet}`, 'g'), '{{hostname}}');
    };

    it('plants a root-owned nginx.pid and a page at /var/www/html/index.html', () => {
      // A web server is the one door that needs no credential, so the page IS the
      // reachable content: the pidfile opens the port, the web root holds what a
      // reader gets back.
      const web = httpHosts();
      expect(web.length).toBeGreaterThan(0);
      const fs = buildRemoteHostFs(ESSID, host(web[0]!.octet));

      const pid = varRun(fs)?.entries.get('nginx.pid');
      if (pid === undefined || pid.kind !== 'file') throw new Error('expected nginx.pid file');
      expect(pid.content).toMatch(/^nginx:port=\d+$/);
      expect(pid.owner).toBe('root');

      const index = dirAt(fs, 'var', 'www', 'html').entries.get('index.html');
      if (index?.kind !== 'file') throw new Error('missing /var/www/html/index.html');
      expect(index.content.length).toBeGreaterThan(0);
    });

    it('serves a page that names the host serving it', () => {
      const octet = httpHosts()[0]!.octet;
      const page = servedPage(buildRemoteHostFs(ESSID, host(octet)));
      expect(page).toContain(`host-${octet}`);
      expect(page).not.toContain('{{hostname}}'); // every placeholder substituted
    });

    it('draws pages from a pool, so the LAN does not serve one page everywhere', () => {
      // Every page in the pool is reachable across this deterministic 253-host
      // sample. Asserting the exact width excludes both a draw that never varies
      // (1 template) and a pool that silently loses an entry.
      const templates = new Set(httpHosts().map(({ octet }) => servedTemplate(octet)));
      expect(templates.size).toBe(4);
    });

    /** The url paths a page invites a reader to try, in the order written. */
    const linkedPaths = (page: string): readonly string[] =>
      Array.from(page.matchAll(/<a\s[^>]*href="([^"]*)"/g)).map((match) => match[1]!);

    /** The linked paths a host does NOT serve — read through the same view and the
     *  same document-root confinement a real fetch goes through, so "serves" means
     *  what it means to `curl`, not what a tree walk happens to find. */
    const unservedLinks = (fs: Directory, page: string): readonly string[] =>
      linkedPaths(page).filter((requestPath) => {
        const filePath = resolveWebPath(requestPath);
        return filePath === null || !createFsView(fs, { userType: 'root' }).read(filePath).ok;
      });

    it('never invites a reader to a path the host does not serve', () => {
      // A page that links what it cannot serve tells the player the server lies,
      // and a browser makes that the headline interaction rather than a shrug.
      const sampled = httpHosts();
      // Guard: the property is worthless if the sample never reached the page that
      // breaks it, so require the sample to span the whole pool.
      expect(new Set(sampled.map(({ octet }) => servedTemplate(octet))).size).toBe(4);

      const offenders = sampled.flatMap(({ octet }) => {
        const fs = buildRemoteHostFs(ESSID, host(octet));
        const page = servedPage(fs);
        return page === null
          ? []
          : unservedLinks(fs, page).map((requestPath) => `host-${octet} → ${requestPath}`);
      });
      expect(offenders).toEqual([]);
    });

    it('still leaks the recon that promises nothing — a version and a careless comment', () => {
      // Pruning the links must not take the reason to read the page with it: what
      // is left is the recon that costs nothing to honour, because it points at no
      // path. The comment matters twice over — it is what `curl` shows and a
      // browser will not, which is why both commands stay worth running.
      const templates = [
        ...new Set(
          httpHosts().flatMap(({ octet }) => {
            const page = servedTemplate(octet);
            return page === null ? [] : [page];
          }),
        ),
      ];
      expect(templates).toHaveLength(4);
      expect(templates.filter((page) => /<!--[\s\S]*-->/.test(page))).toHaveLength(4);

      const everyPage = templates.join('\n');
      for (const version of [
        'Build 4.2.1',
        'v3.1.0',
        'nginx/1.24.0',
        'Node.js v18.17.0',
        'Express 4.18.2',
      ]) {
        expect(everyPage).toContain(version);
      }
    });

    it('recognises an unserved link when there is one', () => {
      // The property above passes vacuously once the pages link nothing, so this
      // pins that it is checking rather than merely finding nothing to check.
      const fs = buildRemoteHostFs(ESSID, host(httpHosts()[0]!.octet));
      expect(unservedLinks(fs, '<a href="/admin/">Admin</a>')).toEqual(['/admin/']);
      expect(unservedLinks(fs, '<a href="/index.html">Home</a>')).toEqual([]);
    });

    it('plants no /var/www on a host that runs another service but serves no web', () => {
      // Absence is the protection: `/var/www/**` is externally readable, so a host
      // with no web server must have no web root rather than an empty one. Checked
      // against a host that DOES run something (ssh) as well as one running nothing —
      // the web root has to follow the http service specifically, not the mere
      // presence of a daemon.
      const webOctets = new Set(httpHosts().map(({ octet }) => octet));
      const hasNoWebRoot = (octet: number): boolean => {
        const varDir = buildRemoteHostFs(ESSID, host(octet)).entries.get('var');
        if (varDir === undefined || varDir.kind !== 'directory') throw new Error('expected /var');
        return !varDir.entries.has('www');
      };

      const sshOnly = sshHosts().find(({ octet }) => !webOctets.has(octet));
      if (sshOnly === undefined) throw new Error('expected an ssh-but-not-web host');
      expect(hasNoWebRoot(sshOnly.octet)).toBe(true);

      const sshOctets = new Set(sshHosts().map(({ octet }) => octet));
      const serviceless = OCTETS.find((octet) => !webOctets.has(octet) && !sshOctets.has(octet));
      if (serviceless === undefined) throw new Error('expected a serviceless host');
      expect(hasNoWebRoot(serviceless)).toBe(true);
    });

    it('plants /var/log/access.log empty on a serving host (the fetch line appends there)', () => {
      const fs = buildRemoteHostFs(ESSID, host(httpHosts()[0]!.octet));
      const node = dirAt(fs, 'var', 'log').entries.get('access.log');
      if (node?.kind !== 'file') throw new Error('missing /var/log/access.log');
      expect(node.content).toBe('');
      expect(node.owner).toBe('root');
      // Readable by anyone who gets ON the box, writable only by the daemon's account:
      // a visitor must never be able to edit away the record of their own visit.
      expect(node.perms.read).toEqual(['root', 'user', 'guest']);
      expect(node.perms.write).toEqual(['root']);
    });

    it('plants no access.log on a host that serves no web', () => {
      // It follows the http service, exactly as the web root above does: a box nothing
      // can fetch can never have a line written, so an empty file there is furniture —
      // and furniture that tells a visitor the box once served something it does not.
      const webOctets = new Set(httpHosts().map(({ octet }) => octet));
      const hasNoAccessLog = (octet: number): boolean =>
        !dirAt(buildRemoteHostFs(ESSID, host(octet)), 'var', 'log').entries.has('access.log');

      const sshOnly = sshHosts().find(({ octet }) => !webOctets.has(octet));
      if (sshOnly === undefined) throw new Error('expected an ssh-but-not-web host');
      expect(hasNoAccessLog(sshOnly.octet)).toBe(true);

      const sshOctets = new Set(sshHosts().map(({ octet }) => octet));
      const serviceless = OCTETS.find((octet) => !webOctets.has(octet) && !sshOctets.has(octet));
      if (serviceless === undefined) throw new Error('expected a serviceless host');
      expect(hasNoAccessLog(serviceless)).toBe(true);
    });

    it('publishes the page: world-readable, root-write-only, never executable', () => {
      const fs = buildRemoteHostFs(ESSID, host(httpHosts()[0]!.octet));
      const html = dirAt(fs, 'var', 'www', 'html');
      expect(html.perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      });
      const index = html.entries.get('index.html');
      if (index?.kind !== 'file') throw new Error('missing index.html');
      expect(index.owner).toBe('root');
      expect(index.perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: [],
      });
    });

    it('serves the web from fewer hosts than it offers ssh (publishing is rarer than being reachable)', () => {
      const web = httpHosts().length;
      // 96 of 253 here (~38% — PRNG noise around the 0.3 target) against ssh's 117.
      // The band brackets that while excluding the mutants that matter: skip-none
      // (253), skip-all (0), and a flipped threshold (~157). The comparison against
      // ssh pins the ordering, so raising `placement` to ssh's 0.4 fails too.
      expect(web).toBeLessThan(sshHosts().length);
      expect(web).toBeGreaterThan(50);
      expect(web).toBeLessThan(130);
    });

    it('puts most web hosts on :80, a seeded minority on a non-standard port', () => {
      const ports = httpHosts().map((entry) => entry.port);
      expect(ports.every((port) => port === 80 || port === 8080 || port === 8000)).toBe(true);
      const standard = ports.filter((port) => port === 80).length;
      const alt = ports.filter((port) => port !== 80).length;
      expect(standard).toBeGreaterThan(alt); // mostly :80
      expect(alt).toBeGreaterThan(0); // but at least one non-standard
    });
  });

  describe('base filesystem skeleton (an operable remote box)', () => {
    const fs = (): Directory => buildRemoteHostFs(ESSID, host(42));

    it('grows from pidfile-only to the full operable skeleton', () => {
      // Same top-level shape as the player's own workstation: a host you ssh into
      // must be a real, operable Linux box (browse + run commands on it).
      expect([...fs().entries.keys()].sort()).toEqual([
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
    });

    it('ships /boot/{vmlinuz,initrd.img} root-owned and root-write-only (a brickable box like any other)', () => {
      const boot = dirAt(fs(), 'boot');
      expect([...boot.entries.keys()].sort()).toEqual(['initrd.img', 'vmlinuz']);
      const vmlinuz = boot.entries.get('vmlinuz');
      if (vmlinuz?.kind !== 'file') throw new Error('missing /boot/vmlinuz');
      expect(vmlinuz.owner).toBe('root');
      expect(vmlinuz.content.length).toBeGreaterThan(0);
      expect(vmlinuz.perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root'],
      });
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

    it('plants /var/log/kern.log empty, root-owned and world-readable (the scan line appends there)', () => {
      const node = dirAt(fs(), 'var', 'log').entries.get('kern.log');
      if (node?.kind !== 'file') throw new Error('missing /var/log/kern.log');
      expect(node.content).toBe('');
      expect(node.owner).toBe('root');
      expect(node.perms.read).toEqual(['root', 'user', 'guest']);
      expect(node.perms.write).toEqual(['root']);
    });

    it('keeps /var/run as the service pidfile dir, which nmap reads', () => {
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
    const fs = (): Directory => buildRemoteHostFs(ESSID, host(42));

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

  describe('the difficulty curve (not every account falls to the starting wordlist)', () => {
    /**
     * Whether an account is crackable is decided at GENERATION, by a per-account
     * roll between a pool the starter wordlist covers and one it does not. That
     * makes it a property of the WORLD rather than of any one box — so "rare" is
     * only observable across a population, and a single host proves nothing.
     *
     * Eight networks x 253 octets. The whole sample regenerates in well under a
     * second, and it is deterministic: these counts are fixed, not sampled.
     */
    const POPULATION_ESSIDS: readonly string[] = [
      'BEAN-THERE-WIFI',
      'SHINRA-5G',
      'ACME-CORP',
      'WEYLAND-NET',
      'CRACK-ME-WIFI',
      'HYDRA-CRACK-WIFI',
      'FETCH-LOG-WIFI',
      'TYRELL-NET',
    ];

    /** Every password the shipped wordlist holds, by hash — exactly the test
     *  `hydra` applies to an account. An account "falls" when its hash is here. */
    const wordlistHashes = new Set(DEFAULT_WORDLIST.map(md5));

    /** How many accounts of each role, across the whole population, hold a password
     *  the player's STARTING wordlist would recover.
     *
     *  Computed ONCE for the whole suite. Regenerating the population per test is
     *  fast in a normal run but slow enough under mutation instrumentation to race
     *  Stryker's timeout — which silently turns a surviving mutant into a "killed
     *  by timeout" and makes the score depend on machine speed rather than on the
     *  tests. Deterministic and read-only, so sharing it couples nothing. */
    const curve = ((): {
      readonly root: number;
      readonly user: number;
      readonly guest: number;
      readonly hostsPerRole: number;
    } => {
      const counts = { root: 0, user: 0, guest: 0 };
      let hostsPerRole = 0;
      for (const essid of POPULATION_ESSIDS) {
        for (const octet of OCTETS) {
          hostsPerRole++;
          for (const fields of passwdRows(buildRemoteHostFs(essid, host(octet)))) {
            if (!wordlistHashes.has(fields[1] ?? '')) continue;
            const name = fields[0];
            if (name === 'root') counts.root++;
            else if (name === 'guest') counts.guest++;
            else counts.user++;
          }
        }
      }
      return { ...counts, hostsPerRole };
    })();

    it('leaves most NPC root accounts holding — day-one rooting happens, but is a find', () => {
      // This deterministic 2024-host sample yields 240 crackable roots (11.9%,
      // against a 12% knob) — about one per 8-host LAN. The band brackets that
      // while excluding the mutants that matter: every root crackable (2024 — the
      // state before this behaviour existed), none (0), a flipped roll comparison
      // (~1781), and the root/user knobs wired to each other's accounts (1422).
      const { root, hostsPerRole } = curve;

      expect(root).toBeGreaterThan(Math.round(hostsPerRole * 0.09));
      expect(root).toBeLessThan(Math.round(hostsPerRole * 0.15));
    });

    it('lets most NPC user accounts fall — a swept LAN yields footholds', () => {
      // The same sample yields 1422 crackable user accounts (70.3%, against a 70%
      // knob). The band excludes all-crackable (2024), none (0), a flipped roll
      // comparison (~602), and the swapped knobs (240).
      const { user, hostsPerRole } = curve;

      expect(user).toBeGreaterThan(Math.round(hostsPerRole * 0.63));
      expect(user).toBeLessThan(Math.round(hostsPerRole * 0.77));
    });

    it('leaves EVERY guest account crackable — no tolerance, it is the always-open door', () => {
      // Not a probability. A defender's chosen root password is safe until the CVE
      // phase, so guest is the only way into a player's box and the whole
      // cross-player loop rests on it. This is a conserved property, not new
      // behaviour: it holds today and must survive the pools being split.
      const { guest, hostsPerRole } = curve;

      expect(guest).toBe(hostsPerRole);
    });

    it('orders the curve guest > user > root, so the roles are not interchangeable', () => {
      // The single assertion that catches the knobs being wired to the wrong
      // accounts. Each individual band would still pass if root and user swapped
      // knobs AND the bands were read independently — this one would not.
      const { root, user, guest } = curve;

      expect(guest).toBeGreaterThan(user);
      expect(user).toBeGreaterThan(root);
    });
  });

  describe('the seed drives the passwd (deterministic, coordinate-sensitive)', () => {
    it('different ESSID re-rolls the credentials (the seed includes the network)', () => {
      // Compared over the WHOLE passwd, not one account's hash: the password pool is
      // ten words wide, so two networks draw the same root password often enough that
      // a single-hash assertion fails on an unlucky pair of ESSIDs.
      expect(passwdOf(buildRemoteHostFs('NET-ALPHA', host(42)))).not.toBe(
        passwdOf(buildRemoteHostFs('NET-BETA', host(42))),
      );
    });

    it('different host IP re-rolls the credentials (the seed includes the host)', () => {
      const hashA = rowFor(buildRemoteHostFs(ESSID, host(42)), 'root')[1];
      const hashB = rowFor(buildRemoteHostFs(ESSID, host(99)), 'root')[1];
      expect(hashA).not.toBe(hashB);
    });

    it('is the SAME box no matter who generates it — the seed carries no identity', () => {
      // The box belongs to the network. Seeding its accounts per viewer gave two
      // occupants of one AP different credentials on one address, so a journal written
      // by one replayed onto a machine the other did not have.
      expect(buildRemoteHostFs(ESSID, host(42))).toEqual(buildRemoteHostFs(ESSID, host(42)));
    });
  });
  describe('the ftp door (a second way onto a box, and one hydra can sweep)', () => {
    it('plants a root-owned vsftpd.pid (vsftpd:port=<n>) on a host that runs ftp', () => {
      const ftp = ftpHosts();
      expect(ftp.length).toBeGreaterThan(0);
      const fs = buildRemoteHostFs(ESSID, host(ftp[0]!.octet));
      const node = varRun(fs)?.entries.get('vsftpd.pid');
      if (node === undefined || node.kind !== 'file') throw new Error('expected vsftpd.pid file');
      expect(node.content).toMatch(/^vsftpd:port=\d+$/);
      expect(node.owner).toBe('root');
    });

    it('listens on 21, or occasionally on the alternate 2121', () => {
      const ports = new Set(ftpHosts().map(({ port }) => port));
      expect([...ports].sort((left, right) => left - right)).toEqual([21, 2121]);
    });

    it('reaches boxes ssh does not — the door that makes a second door worth having', () => {
      // If every ftp host also ran ssh, the row would add a protocol and no new
      // target. What justifies it is the box hydra's ssh sweep cannot open at all.
      const sshOctets = new Set(sshHosts().map(({ octet }) => octet));
      const ftpOnly = ftpHosts().filter(({ octet }) => !sshOctets.has(octet));
      expect(ftpOnly.length).toBeGreaterThan(0);
    });

    it('plants /var/log/vsftpd.log empty on a host running ftp', () => {
      const fs = buildRemoteHostFs(ESSID, host(ftpHosts()[0]!.octet));
      const node = dirAt(fs, 'var', 'log').entries.get('vsftpd.log');
      if (node?.kind !== 'file') throw new Error('missing /var/log/vsftpd.log');
      expect(node.content).toBe('');
      expect(node.owner).toBe('root');
      // Readable by anyone who gets ON the box, writable only by the daemon's
      // account: an attacker must never be able to edit away the record of the
      // files they took.
      expect(node.perms.read).toEqual(['root', 'user', 'guest']);
      expect(node.perms.write).toEqual(['root']);
    });

    it('plants no vsftpd.log on a host that runs no ftp', () => {
      // It follows the ftp service exactly as access.log follows http: a box no
      // client can reach never has a line written, so an empty file there is
      // furniture that claims the box once ran a daemon it never did.
      const ftpOctets = new Set(ftpHosts().map(({ octet }) => octet));
      const sshOnly = sshHosts().find(({ octet }) => !ftpOctets.has(octet));
      if (sshOnly === undefined) throw new Error('expected an ssh-but-not-ftp host');
      expect(
        dirAt(buildRemoteHostFs(ESSID, host(sshOnly.octet)), 'var', 'log').entries.has(
          'vsftpd.log',
        ),
      ).toBe(false);
    });

    it('ships the vsftpd binary in /usr/sbin, so a rooted box can bring the door up', () => {
      // The DAEMON is present everywhere (as sshd is); the ftp CLIENT is apt-gated.
      // That asymmetry is real: scp comes with openssh, ftp does not.
      const sbin = dirAt(buildRemoteHostFs(ESSID, host(7)), 'usr', 'sbin');
      expect(sbin.entries.has('vsftpd')).toBe(true);
    });

    it('leaves every ssh and http roll exactly where it was before ftp existed', () => {
      // Each service seeds its OWN prng (`svc-<service>-<essid>-<ip>`), so adding a
      // row must not disturb the world already generated. These numbers were captured
      // from the tree BEFORE the ftp row was added; a re-roll moves them.
      expect(sshHosts().length).toBe(106);
      expect(sshHosts().slice(0, 3)).toEqual([
        { octet: 3, port: 2222 },
        { octet: 5, port: 22 },
        { octet: 9, port: 2222 },
      ]);
      expect(sshHosts().at(-1)).toEqual({ octet: 254, port: 22 });

      expect(httpHosts().length).toBe(96);
      expect(httpHosts().slice(0, 3)).toEqual([
        { octet: 4, port: 8000 },
        { octet: 5, port: 80 },
        { octet: 12, port: 80 },
      ]);
      expect(httpHosts().at(-1)).toEqual({ octet: 254, port: 80 });
    });
  });
});
