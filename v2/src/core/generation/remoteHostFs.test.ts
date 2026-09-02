import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices } from './remoteHostFs';
import { md5 } from './md5';
import { DEFAULT_WORDLIST } from '../wordlist/defaultWordlist';
import { resolveWebPath } from '../network/http';
import { createFsView } from '../filesystem/fsView';
import {
  formatListenerContent,
  PIDFILE_PERMISSIONS,
  readRunningProcesses,
  type Listener,
} from '../services/pidfile';
import { BACKDOOR_PORTS } from './remoteHostFs';
import { parseMysqlDatabase, type MysqlDatabase, type MysqlRow } from '../mysql/types';
import { parseRedisStore, type RedisStore } from '../redis/types';
import { DB_NAME_PREFIXES, DB_NAME_SUFFIXES, MYSQL_USERNAMES } from './pools/database';
import { filterTreeToAllowlist } from '../patches/readFilter';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import type { LanHost } from './generateHomeLan';
import type { Directory, FileEntry, FileNode } from '../filesystem/types';

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

/** A host as a generated LAN would name it: the prefix carries what the box is for,
 *  which is the only thing about the role that travels with the host. `host` above
 *  wears a name no role claims, which is what makes it the fallback's witness. */
const namedHost = (prefix: string, octet: number): LanHost => ({
  ip: `${SUBNET}.${octet}`,
  hostname: `${prefix}-${octet}`,
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

/**
 * Eight networks x 253 octets — the sample every generation-time PROBABILITY is
 * measured over. A per-host roll is a property of the WORLD rather than of any one
 * box, so a rate is only observable across a population and a single host proves
 * nothing. The whole sample regenerates in well under a second, and it is
 * deterministic: the counts below are fixed, not sampled.
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

/** A file at a path, or undefined when any segment on the way is missing. The
 *  forgiving twin of `dirAt`: what a box does NOT have is half of what these tests
 *  claim, and a throw would say "broken" where the answer is "absent". */
const fileAt = (fs: Directory, ...segments: readonly string[]): FileEntry | undefined => {
  let node: FileNode = fs;
  for (const segment of segments) {
    if (node.kind !== 'directory') return undefined;
    const next = node.entries.get(segment);
    if (next === undefined) return undefined;
    node = next;
  }
  return node.kind === 'file' ? node : undefined;
};

/** Whether a directory exists at a path — an empty one is still a promise the box
 *  makes, so its presence is a claim of its own. */
const dirExistsAt = (fs: Directory, ...segments: readonly string[]): boolean => {
  let node: FileNode = fs;
  for (const segment of segments) {
    if (node.kind !== 'directory') return false;
    const next = node.entries.get(segment);
    if (next === undefined) return false;
    node = next;
  }
  return node.kind === 'directory';
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
/**
 * Compute once, but on FIRST USE rather than while the describe body is being built.
 *
 * A population sweep is too slow under mutation instrumentation to run per assertion —
 * but computing it in the block body means a mutant that makes generation throw takes
 * the whole SUITE down before any test runs, and Vitest then reports no test failures at
 * all. Stryker reads that as SURVIVED, so a mutant the tests really do catch is scored
 * as one they miss. Deferring the first call into a test turns the throw back into a
 * test failure, which is a kill.
 */
const lazily = <T>(compute: () => T): (() => T) => {
  const cache = new Map<number, T>();
  return () => {
    const computed = cache.get(0);
    if (computed !== undefined) return computed;
    const value = compute();
    cache.set(0, value);
    return value;
  };
};

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

    /** The template a NAMED box serves — its own name substituted back out, exactly
     *  as `servedTemplate` does for the role-less hosts. */
    const servedTemplateFor = (prefix: string, octet: number): string | null => {
      const page = servedPage(buildRemoteHostFs(ESSID, namedHost(prefix, octet)));
      return page === null
        ? null
        : page.replace(new RegExp(`${prefix}-${octet}`, 'g'), '{{hostname}}');
    };

    /** Every distinct page a role serves across a LAN's worth of addresses. One host
     *  reads one entry of a bucket, so anything claimed about what a role serves has
     *  to be claimed over the population — or an entry a player can meet is one no
     *  test has read. */
    const servedBy = (prefix: string): readonly string[] => [
      ...new Set(
        OCTETS.flatMap((octet) => {
          const template = servedTemplateFor(prefix, octet);
          return template === null ? [] : [template];
        }),
      ),
    ];

    it('serves a camera something a camera would serve, and a laptop its owner something of theirs', () => {
      // What makes the page recon rather than wallpaper is that it fits the box the
      // scan already named. A `cam-31` answering with an internal corporate portal
      // tells the player the world is furniture; these vocabularies are what "reads
      // as its kind" means, and the general pages use none of them.
      const camera = servedBy('cam');
      const laptop = servedBy('laptop');
      // Every entry of a bucket is reached across this sample, the same width the
      // general pool is pinned to above: a page a player can meet that no test has
      // read is a page that can be blanked with nothing noticing.
      expect(camera).toHaveLength(4);
      expect(laptop).toHaveLength(4);

      camera.forEach((page) => expect(page).toMatch(/stream|camera|firmware|snapshot/i));
      laptop.forEach((page) => expect(page).toMatch(/dev server|localhost|it works|notes/i));
    });

    it('never serves a camera or a laptop what a web server serves', () => {
      // The disjointness is the claim a marker alone cannot make: not merely that a
      // camera page says "stream", but that the corporate portal never lands on one.
      const general = new Set(servedBy('www'));
      expect(general.size).toBeGreaterThan(0);

      expect(servedBy('cam').filter((page) => general.has(page))).toEqual([]);
      expect(servedBy('laptop').filter((page) => general.has(page))).toEqual([]);
      expect(servedBy('cam').filter((page) => new Set(servedBy('laptop')).has(page))).toEqual([]);
    });

    it('leaves every other role serving exactly what it served before, host for host', () => {
      // `pick` consumes one `next()` whatever the pool's length, so keying the pool by
      // role moves no draw: a box with no bucket of its own must land on the very page
      // it lands on today, byte for byte. Asserted against the role-LESS host at the
      // same address, which is the page this test was written to protect.
      const compared = (prefix: string): readonly number[] =>
        OCTETS.filter(
          (octet) => servedTemplateFor(prefix, octet) !== null && servedTemplate(octet) !== null,
        );
      const moved = (prefix: string): readonly string[] =>
        compared(prefix)
          .filter((octet) => servedTemplateFor(prefix, octet) !== servedTemplate(octet))
          .map((octet) => `${prefix}-${octet}`);

      ['www', 'db', 'mail', 'nas', 'dns'].forEach((prefix) => {
        // WHICH hosts serve is the placement table's business and differs by role —
        // a webserver publishes at 0.95 where a nameless box rolls 0.3 — so the
        // comparison is over the addresses where both have a page at all.
        expect(compared(prefix).length).toBeGreaterThan(50);
        expect(moved(prefix)).toEqual([]);
      });
    });

    it('keeps the general pages themselves untouched', () => {
      // The test above proves nothing moved BETWEEN pools; this proves the pool the
      // rest fall back to is still the same four pages. Captured before the buckets
      // existed, so it blesses nothing that this slice did.
      const templates = [
        ...new Set(
          OCTETS.flatMap((octet) => {
            const template = servedTemplate(octet);
            return template === null ? [] : [template];
          }),
        ),
      ];

      expect(templates).toHaveLength(4);
      expect(md5(templates.sort().join('\n'))).toBe('e2ffd35907ba2dce11ad487d6f1286c4');
    });

    it('holds every bucket to what the general pages already promise', () => {
      // A new pool is not exempt from the properties the old one earned: name the host
      // (or the page is wallpaper), link nothing you cannot serve (or the server lies),
      // and leave a comment `curl` shows that a browser will not (or there is no reason
      // to run both).
      ['cam', 'laptop', 'www'].forEach((prefix) => {
        const octets = OCTETS.filter((octet) => servedTemplateFor(prefix, octet) !== null);
        expect(octets.length).toBeGreaterThan(0);

        octets.forEach((octet) => {
          const fs = buildRemoteHostFs(ESSID, namedHost(prefix, octet));
          const page = servedPage(fs);
          if (page === null) throw new Error(`no page on ${prefix}-${octet}`);

          expect(page).toContain(`${prefix}-${octet}`);
          expect(page).toMatch(/<!--[\s\S]*-->/);
          expect(unservedLinks(fs, page)).toEqual([]);
        });
      });
    });
  });

  describe('the database surface (a box that runs one has one)', () => {
    /** What one generated box says about the database door, read off the box while it
     *  is being built so the box itself can be discarded. */
    type DatabaseBox = {
      readonly prefix: string;
      readonly octet: number;
      readonly runsMysqld: boolean;
      readonly pidfile: FileEntry | undefined;
      readonly account: string;
      readonly database: MysqlDatabase | null;
      readonly datadirFile: FileEntry | undefined;
      readonly hasDatadirDir: boolean;
      readonly mysqlLog: FileEntry | undefined;
      readonly configDatadir: string | undefined;
    };

    const inspect = (prefix: string, octet: number): DatabaseBox => {
      const fs = buildRemoteHostFs(ESSID, namedHost(prefix, octet));
      const pidfile = fileAt(fs, 'var', 'run', 'mysqld.pid');
      const datadirFile = fileAt(fs, 'var', 'lib', 'mysql', 'data.json');
      const config = fileAt(fs, 'etc', 'mysql.cnf');

      return {
        prefix,
        octet,
        runsMysqld: pidfile !== undefined,
        pidfile,
        account: npcUserRow(fs)[0],
        database: datadirFile === undefined ? null : parseMysqlDatabase(datadirFile.content),
        datadirFile,
        hasDatadirDir: dirExistsAt(fs, 'var', 'lib', 'mysql'),
        mysqlLog: fileAt(fs, 'var', 'log', 'mysql.log'),
        configDatadir:
          config === undefined
            ? undefined
            : config.content.split('\n').find((line) => line.startsWith('datadir=')),
      };
    };

    /**
     * Five kinds of box over a LAN's worth of addresses, generated ONCE for the whole
     * block.
     *
     * Both things this block claims need a population rather than a host. A placement
     * rate is a property of the WORLD — one box proves nothing either way. And what a
     * database HOLDS is the same claim seen from the other side: the tables past
     * `users` are drawn two-to-four from seven, so a value a player can meet is a
     * value a two-host sample never reads, and a value no test reads is one that can
     * be blanked without anything failing.
     *
     * Computed once for the reason the account block below records: regenerating this
     * per test is quick in an ordinary run but slow enough under mutation
     * instrumentation to race Stryker's timeout — which scores a surviving mutant as
     * killed and makes the number a measure of the machine rather than of the tests.
     */
    const POPULATION: readonly DatabaseBox[] = ['db', 'www', 'host', 'desktop', 'cam'].flatMap(
      (prefix) => OCTETS.map((octet) => inspect(prefix, octet)),
    );

    const boxesOn = (prefix: string): readonly DatabaseBox[] =>
      POPULATION.filter((box) => box.prefix === prefix);

    const runsMysqlOn = (prefix: string): readonly DatabaseBox[] =>
      boxesOn(prefix).filter((box) => box.runsMysqld);

    /** Every database this sample of the world contains, whatever kind of box keeps
     *  it — the sample every claim about CONTENT is made over. */
    const DATABASES: readonly { readonly box: DatabaseBox; readonly database: MysqlDatabase }[] =
      POPULATION.flatMap((box) => (box.database === null ? [] : [{ box, database: box.database }]));

    /** Every row of one named table, across every database that drew it. */
    const rowsOf = (table: string): readonly MysqlRow[] =>
      DATABASES.flatMap(({ database }) => database.tables[table]?.rows ?? []);

    /** The distinct values one column takes across the whole world — a pool's real
     *  width as a player would experience it, rather than as the source declares it. */
    const valuesIn = (table: string, column: string): readonly unknown[] => [
      ...new Set(rowsOf(table).map((row) => row[column])),
    ];

    /** Where a complaint came from: a box's name, never the box. */
    const where = (box: DatabaseBox): string => `${box.prefix}-${box.octet}`;

    /**
     * A sweep's verdict, kept small however wrong the world turns out to be.
     *
     * A population of a thousand boxes can raise a thousand complaints, and an
     * assertion that renders them all takes longer to FAIL than the whole file takes
     * to run — a diff over a thousand generated databases is megabytes of text. Under
     * mutation instrumentation that is reported as a timeout rather than as a kill,
     * which hands the score back to the machine. A count and three examples fail just
     * as loudly, in constant time, and read better when the failure is real.
     */
    const noneOf = (
      offenders: readonly string[],
    ): { readonly count: number; readonly sample: readonly string[] } => ({
      count: offenders.length,
      sample: offenders.slice(0, 3),
    });

    const NONE = { count: 0, sample: [] };

    it('plants a mysqld.pid owned by the account its own config says it runs as', () => {
      // The `/etc/mysql.cnf` a database box has carried since the roles landed says
      // `user=mysql`, and `ps` prints a pidfile's runUser: an owner of `root` here
      // would put the box's own config and the box's own process table in
      // disagreement about who is running the daemon.
      const { pidfile } = runsMysqlOn('db')[0];

      expect(pidfile?.content).toBe('mysqld:port=3306');
      expect(pidfile?.owner).toBe('mysql');
    });

    it('runs a database on the boxes named for one, seldom elsewhere, and never on a camera', () => {
      // The whole point of naming a box `db-11`. A flat world rate applied to every
      // role would put more databases on phones and televisions than on the boxes
      // the name promises — which makes the name a lie rather than a lead. The hard
      // zero is the load-bearing one: an appliance runs an appliance.
      const onDatabases = runsMysqlOn('db').length;
      const onWebservers = runsMysqlOn('www').length;
      const onUnclaimed = runsMysqlOn('host').length;
      const onWorkstations = runsMysqlOn('desktop').length;

      expect(noneOf(runsMysqlOn('cam').map(where))).toEqual(NONE);
      expect(onDatabases).toBeGreaterThan(onWebservers);
      expect(onWebservers).toBeGreaterThan(onUnclaimed);
      expect(onUnclaimed).toBeGreaterThan(onWorkstations);
      expect(onWorkstations).toBeGreaterThan(0);
    });

    it('runs it on nearly every database box, so the name is worth reading', () => {
      // A rate low enough to make `db-` a coin flip would leave the player scanning
      // names that mean nothing. Held against the population rather than a band, so
      // the claim is the one the table makes: almost all of them.
      expect(runsMysqlOn('db').length).toBeGreaterThan(OCTETS.length * 0.8);
    });

    it('keeps a real database on the box that runs one', () => {
      // A daemon with nothing behind it is a protocol demo. The tables are what make
      // the door worth opening, so they arrive with it rather than after it.
      const { database } = runsMysqlOn('db')[0];

      expect(database?.name).toMatch(/^[a-z_]+$/);
      expect(Object.keys(database?.tables ?? {})).toContain('users');
      expect(Object.keys(database?.tables ?? {}).length).toBeGreaterThanOrEqual(3);
      expect(database?.credentials.map((credential) => credential.userType)).toContain('root');
    });

    it('plants the datadir on exactly the boxes running the daemon, and nowhere else', () => {
      // The rule /var/www already follows: a directory nobody is listening on is a
      // promise the box cannot keep, and `ls /var/lib` is recon a player acts on.
      // Held over the population, because the box that would leak one is by
      // definition a box no single-host test picked.
      const stray = POPULATION.filter((box) => box.hasDatadirDir !== box.runsMysqld).map(where);
      const empty = POPULATION.filter(
        (box) => box.runsMysqld && box.datadirFile === undefined,
      ).map(where);

      expect(noneOf(stray)).toEqual(NONE);
      expect(noneOf(empty)).toEqual(NONE);
    });

    it('keeps every datadir it writes readable as the database it claims to be', () => {
      // The file is JSON on disk and a schema on the way back in, so a generator that
      // emitted one malformed table would ship a box whose door opens onto nothing.
      // Only a sweep can say this: the tables past `users` are drawn, not given.
      const unreadable = POPULATION.filter(
        (box) => box.datadirFile !== undefined && box.database === null,
      ).map(where);

      expect(noneOf(unreadable)).toEqual(NONE);
      expect(DATABASES.length).toBeGreaterThan(200);
    });

    it('guards the database from every tier but root, even on the box itself', () => {
      // The door's whole point is that its credential is not the box's own. A guest
      // who could `cat` the datadir would hold every table without ever cracking the
      // database — and the account hashes in it, which are what slice 2 attacks.
      const wronglyGuarded = DATABASES.filter(
        ({ box }) =>
          box.datadirFile?.perms.read.join(',') !== 'root' ||
          box.datadirFile.perms.write.join(',') !== 'root' ||
          box.datadirFile.perms.execute.length !== 0,
      ).map(({ box }) => where(box));

      expect(noneOf(wronglyGuarded)).toEqual(NONE);
    });

    it('holds the account the box really carries among the people in its users table', () => {
      // What makes it THIS box's database rather than a database. The box's own user
      // has a home directory a visitor can see, so finding their row here is the
      // thing that ties the two halves of the machine together — and it has to hold
      // on every box, since the account is drawn per box and the table is not.
      const orphaned = DATABASES.flatMap(({ box, database }) => {
        const usernames = (database.tables['users']?.rows ?? []).map((row) => row['username']);
        return usernames.includes(box.account) && usernames.length > 1 ? [] : [where(box)];
      });

      expect(noneOf(orphaned)).toEqual(NONE);
    });

    it('calls the site by the name the box answers to, on every box that keeps a config', () => {
      // The page a serving box publishes is titled with its hostname, so a config row
      // naming some other company would be the one seam a player who opens both doors
      // on one box is guaranteed to find. The config table is DRAWN rather than
      // guaranteed, so this is asserted over the population: a box a player can meet
      // whose row no test has read is a row that can be blanked unnoticed.
      const rows = DATABASES.flatMap(({ box, database }) => {
        const row = (database.tables['config']?.rows ?? []).find(
          (candidate) => candidate['key'] === 'site_name',
        );
        return row === undefined ? [] : [{ box, value: row['value'] }];
      });
      const misnamed = rows
        .filter(({ box, value }) => value !== where(box))
        .map(({ box, value }) => `${where(box)}: ${String(value)}`);

      expect(rows.length).toBeGreaterThan(20);
      expect(noneOf(misnamed)).toEqual(NONE);
    });

    it('shows a stranger with no session nothing of the database at all', () => {
      // File permissions guard the box's own tiers; the tier-3 allowlist guards
      // everyone with no session on it, and they are different mechanisms. A datadir
      // that leaked here would hand the account hashes to anyone who could reach the
      // host — no credential, no sweep, no line in any log.
      const { prefix, octet } = runsMysqlOn('db')[0];
      const external = filterTreeToAllowlist(buildRemoteHostFs(ESSID, namedHost(prefix, octet)));
      const varDir = external.entries.get('var');
      const lib = varDir?.kind === 'directory' ? varDir.entries.get('lib') : undefined;

      expect(lib).toBeUndefined();
    });

    it('plants /var/log/mysql.log empty where the daemon runs, and nowhere else', () => {
      // Follows its daemon, like access.log and vsftpd.log: a log on a box that never
      // ran one claims something happened.
      const stray = POPULATION.filter(
        (box) => (box.mysqlLog !== undefined) !== box.runsMysqld,
      ).map(where);
      const prewritten = POPULATION.flatMap((box) =>
        box.mysqlLog === undefined || box.mysqlLog.content === '' ? [] : [where(box)],
      );

      expect(noneOf(stray)).toEqual(NONE);
      expect(noneOf(prewritten)).toEqual(NONE);
    });

    it('keeps its config pointing at the directory the database is really in', () => {
      // The `/etc/mysql.cnf` a database box carries has named a datadir since before
      // any database existed to sit in one. Now that one does, a template naming a
      // different path sends a player who read the config to an empty directory —
      // which is the config lying about its own box, over the whole pool.
      const configured = boxesOn('db').filter((box) => box.configDatadir !== undefined);
      const elsewhere = configured
        .filter((box) => box.configDatadir !== 'datadir=/var/lib/mysql')
        .map((box) => `${where(box)}: ${String(box.configDatadir)}`);

      expect(configured.length).toBeGreaterThan(0);
      expect(noneOf(elsewhere)).toEqual(NONE);
    });

    it('puts every row under the columns its own table declares', () => {
      // A row carrying a key its table never declared, or missing one it did, is a
      // table that cannot be printed: `SELECT *` renders the COLUMNS and reads each
      // row by them, so the two drifting apart is a blank column or a lost cell.
      const mismatched = DATABASES.flatMap(({ box, database }) =>
        Object.entries(database.tables).flatMap(([table, { columns, rows }]) => {
          const declared = columns.map((column) => column.name).join(',');
          return rows
            .filter((row) => Object.keys(row).join(',') !== declared)
            .map((row) => `${where(box)} ${table}: ${Object.keys(row).join(',')} vs ${declared}`);
        }),
      );

      expect(noneOf(mismatched)).toEqual(NONE);
    });

    it('never leaves a blank where a value belongs, on any box in the world', () => {
      // An empty cell reads as a bug rather than as a quiet database, and this is
      // what makes every string in the content pool load-bearing: blank any one of
      // them and some box in the world shows the gap.
      const blanks = DATABASES.flatMap(({ box, database }) => [
        ...(database.name === '' ? [`${where(box)}: database name`] : []),
        ...Object.entries(database.tables).flatMap(([table, { columns, rows }]) => [
          ...(table === '' ? [`${where(box)}: unnamed table`] : []),
          ...columns.filter((column) => column.name === '').map(() => `${where(box)}: ${table} column`),
          ...rows.flatMap((row) =>
            Object.entries(row)
              .filter(([, value]) => value === '')
              .map(([column]) => `${where(box)}: ${table}.${column}`),
          ),
        ]),
        ...database.credentials.flatMap((credential) => [
          ...(credential.username === '' ? [`${where(box)}: nameless account`] : []),
          ...(credential.passwordHash === '' ? [`${where(box)}: unhashed account`] : []),
        ]),
      ]);

      expect(noneOf(blanks)).toEqual(NONE);
    });

    it('draws every entry of every pool a table can show, so none of it ships unreachable', () => {
      // The lesson the role work left behind, and the one this door is most exposed
      // to: the tables past `users` are drawn two-to-four from seven, so an entry no
      // database ever draws is content that can be blanked without a test noticing.
      // Held as WIDTHS: the claim is that the pool is wide enough for two boxes to
      // read differently, and that none of it is dead.
      const widths: readonly (readonly [string, string, number])[] = [
        ['users', 'role', 2],
        ['audit_log', 'action', 5],
        ['orders', 'customer', 5],
        ['orders', 'product', 5],
        ['orders', 'status', 4],
        ['employees', 'name', 6],
        ['employees', 'department', 6],
        ['employees', 'clearance', 4],
        ['inventory', 'sku', 6],
        ['inventory', 'warehouse', 3],
        ['config', 'key', 5],
      ];
      const observed = widths.map(
        ([table, column]) => [table, column, valuesIn(table, column).length] as const,
      );
      const domains = new Set(rowsOf('users').map((row) => String(row['email']).split('@')[1]));
      const uploadLimits = new Set(
        rowsOf('config')
          .filter((row) => row['key'] === 'max_upload_mb')
          .map((row) => row['value']),
      );

      expect(observed).toEqual(widths);
      expect(domains.size).toBe(3);
      expect(uploadLimits.size).toBe(4);
    });

    it('names its database and its application account from the pools those names live in', () => {
      // A name a generator can produce that no test has read is a name that can be
      // deleted from the pool unnoticed — and these three are the names a player sees
      // first, at the prompt and in the credential hydra hands back.
      const appAccounts = new Set(
        DATABASES.flatMap(({ database }) =>
          database.credentials
            .filter((credential) => credential.userType === 'user')
            .map((credential) => credential.username),
        ),
      );
      const prefixes = new Set(DATABASES.map(({ database }) => database.name.split('_')[0]));
      const suffixes = new Set(DATABASES.map(({ database }) => database.name.split('_')[1]));

      expect([...appAccounts].sort()).toEqual([...MYSQL_USERNAMES].sort());
      expect([...prefixes].sort()).toEqual([...DB_NAME_PREFIXES].sort());
      expect([...suffixes].sort()).toEqual([...DB_NAME_SUFFIXES].sort());
    });

    it('numbers its rows the way a table a player has seen before is numbered', () => {
      // Ascending from the table's own first number, one at a time, no repeats. The
      // orders table starts at 1000 because a shop whose first order is #1 reads as a
      // fresh install rather than as a business someone runs.
      const misnumbered = DATABASES.flatMap(({ box, database }) =>
        Object.entries(database.tables).flatMap(([table, { rows }]) => {
          const first = table === 'orders' ? 1000 : 1;
          const expected = rows.map((_row, index) => first + index).join(',');
          const actual = rows.map((row) => row['id']).join(',');
          return actual === expected ? [] : [`${where(box)} ${table}: ${actual}`];
        }),
      );

      expect(noneOf(misnumbered)).toEqual(NONE);
    });

    it('fills each drawn table with as many rows as that table promises', () => {
      // A table of one row reads as a fixture. The bands are the shape of the
      // content decision, and they are only visible across the population.
      const bands: readonly (readonly [string, number, number])[] = [
        ['audit_log', 3, 8],
        ['orders', 3, 7],
        ['employees', 3, 6],
        ['inventory', 3, 6],
        ['config', 5, 5],
      ];
      const observed = bands.map(([table]) => {
        const counts = DATABASES.flatMap(({ database }) => {
          const drawn = database.tables[table];
          return drawn === undefined ? [] : [drawn.rows.length];
        });
        return [table, Math.min(...counts), Math.max(...counts)] as const;
      });

      expect(observed).toEqual(bands);
    });

    it('prices what it sells the way a price list does, and never below nothing', () => {
      // Amounts and prices end in .99 — the arithmetic that builds them is the
      // difference between a catalogue and a column of round numbers.
      const money = [
        ...rowsOf('orders').map((row) => row['amount']),
        ...rowsOf('inventory').map((row) => row['price']),
      ];
      const oddlyPriced = money
        .filter((value) => !String(value).endsWith('.99') || Number(value) <= 0)
        .map((value) => String(value));

      expect(money.length).toBeGreaterThan(100);
      expect(noneOf(oddlyPriced)).toEqual(NONE);
    });

    it('puts the one cleared employee at the top of the table and leaves the rest mixed', () => {
      // The row worth reading is the first one. If the condition that places it moved,
      // either nobody is cleared or everybody is, and the table stops rewarding a read.
      const leading = new Set(
        DATABASES.flatMap(({ database }) => {
          const rows = database.tables['employees']?.rows ?? [];
          return rows.length === 0 ? [] : [rows[0]?.['clearance']];
        }),
      );

      expect([...leading]).toEqual(['top-secret']);
      expect(valuesIn('employees', 'clearance').length).toBe(4);
    });

    it('leaves most accounts and keys active, but not all of them', () => {
      // A flag that is always the same value is a column with nothing to say. Both
      // values have to appear, and the majority has to be the plausible one.
      const employees = rowsOf('employees').map((row) => row['active']);
      const keys = rowsOf('api_keys').map((row) => row['active']);
      const activeShare = (flags: readonly unknown[]): number =>
        flags.filter((flag) => flag === 1).length / flags.length;

      expect([...new Set(employees)].sort()).toEqual([0, 1]);
      expect([...new Set(keys)].sort()).toEqual([0, 1]);
      expect(activeShare(employees)).toBeGreaterThan(activeShare(keys));
      expect(activeShare(keys)).toBeGreaterThan(0.5);
    });

    it('lists no item twice in one inventory', () => {
      // The SKU column is declared UNIQUE, so a table repeating one contradicts its
      // own schema in front of a player who ran DESCRIBE.
      const repeated = DATABASES.flatMap(({ box, database }) => {
        const skus = (database.tables['inventory']?.rows ?? []).map((row) => row['sku']);
        return new Set(skus).size === skus.length ? [] : [where(box)];
      });

      expect(noneOf(repeated)).toEqual(NONE);
    });

    it('writes every generated string in the shape its column promises', () => {
      // A token that is not hex, a timestamp that lost its leading zeroes, an address
      // with no domain after the @ — each still reads as a VALUE, so a sweep looking
      // for blanks walks straight past them. Shape is the only thing that catches a
      // string that is present and wrong, and these are the strings a player sees
      // most: `SELECT * FROM sessions` is a wall of them.
      const shapes: readonly (readonly [string, string, RegExp])[] = [
        ['users', 'created_at', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/],
        ['users', 'email', /^[a-z0-9._-]+@[a-z]+\.[a-z]+$/],
        ['orders', 'created_at', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/],
        ['audit_log', 'timestamp', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/],
        ['sessions', 'expires_at', /^\d{4}-\d{2}-\d{2} 23:59:59$/],
        ['sessions', 'token', /^[0-9a-f]{32}$/],
        ['api_keys', 'key_value', /^ak_[0-9a-f]{24}$/],
      ];
      const unread = shapes.filter(([table]) => rowsOf(table).length === 0).map(([table]) => table);
      const malformed = shapes.flatMap(([table, column, shape]) =>
        rowsOf(table)
          .filter((row) => !shape.test(String(row[column])))
          .map((row) => `${table}.${column}: ${String(row[column])}`),
      );

      expect(noneOf(unread)).toEqual(NONE);
      expect(noneOf(malformed)).toEqual(NONE);
    });

    it('names the database from two pool words, with both halves really there', () => {
      // A blanked entry in either name pool still produces a name — `_prod`, `app_` —
      // and a name that is not empty passes every check that asks whether a value is
      // missing. Comparing the drawn names against the pool cannot catch it either:
      // the test reads the same pool the generator does, so both sides move together.
      const malformed = DATABASES.filter(
        ({ database }) => !/^[a-z]+_[a-z]+$/.test(database.name),
      ).map(({ box, database }) => `${where(box)}: ${database.name}`);

      expect(noneOf(malformed)).toEqual(NONE);
    });

    it('makes the first person in the users table the admin and the rest ordinary', () => {
      // The box's own account leads the table, so the admin row is the account a
      // player has already met on the machine — which is what makes reading the
      // users table tell them something they can act on.
      const misranked = DATABASES.flatMap(({ box, database }) =>
        (database.tables['users']?.rows ?? []).flatMap((row, index) =>
          row['role'] === (index === 0 ? 'admin' : 'user')
            ? []
            : [`${where(box)} row ${index}: ${String(row['role'])}`],
        ),
      );

      expect(noneOf(misranked)).toEqual(NONE);
    });

    it('points every session and every key at a user the same database really holds', () => {
      // A foreign key to nobody is the one kind of wrong a player can PROVE with a
      // second SELECT. Both tables number their rows from the same sequence the users
      // table is numbered by, so every one has to land on a row that exists.
      const dangling = DATABASES.flatMap(({ box, database }) => {
        const userIds = new Set((database.tables['users']?.rows ?? []).map((row) => row['id']));
        return ['sessions', 'api_keys'].flatMap((table) =>
          (database.tables[table]?.rows ?? [])
            .filter((row) => !userIds.has(row['user_id']))
            .map((row) => `${where(box)} ${table}: user_id ${String(row['user_id'])}`),
        );
      });

      expect(noneOf(dangling)).toEqual(NONE);
    });

    it('leaves some people without a live session or a key of their own', () => {
      // Both tables are a SLICE of the people a box knows, never all of them: a world
      // where every account always holds a live session and an API key is a world
      // with nothing to notice. One box could legitimately be full, so the claim is
      // only sayable across the population — somewhere, the slice has to be short.
      const rowCounts = (table: string): readonly number[] =>
        DATABASES.flatMap(({ database }) => {
          const drawn = database.tables[table];
          return drawn === undefined ? [] : [drawn.rows.length];
        });

      expect(Math.min(...rowCounts('sessions'))).toBe(1);
      expect(Math.min(...rowCounts('api_keys'))).toBe(1);
    });

    it('pays its employees a salary a person could live on', () => {
      // The arithmetic that scales the draw is the difference between a salary and a
      // rounding error: a column reading 0.045 is a bug a player would screenshot.
      const salaries = rowsOf('employees').map((row) => Number(row['salary']));
      const implausible = salaries
        .filter((salary) => salary < 45000 || salary > 150000 || salary % 1000 !== 0)
        .map((salary) => String(salary));

      expect(salaries.length).toBeGreaterThan(100);
      expect(noneOf(implausible)).toEqual(NONE);
    });

    it('gives every database a root and an application account, and a read-only one about half the time', () => {
      // The ladder a player meets: the read-only account nearly always falls, the
      // application account usually, root about one database in eight. The shape of
      // the credential list is what makes the rarity of root meaningful.
      const ladders = DATABASES.map(({ database }) =>
        database.credentials.map((credential) => credential.userType).join(','),
      );
      const withReadonly = ladders.filter((ladder) => ladder.endsWith('guest')).length;
      const unhashed = DATABASES.flatMap(({ box, database }) =>
        database.credentials
          .filter((credential) => !/^[0-9a-f]{32}$/.test(credential.passwordHash))
          .map((credential) => `${where(box)}: ${credential.username}`),
      );

      expect([...new Set(ladders)].sort()).toEqual(['root,user', 'root,user,guest'].sort());
      expect(withReadonly / ladders.length).toBeGreaterThan(0.4);
      expect(withReadonly / ladders.length).toBeLessThan(0.6);
      expect(noneOf(unhashed)).toEqual(NONE);
    });
  });


  describe('the key-value store surface (a box that runs one has one)', () => {
    /** What one generated box says about the key-value door, read off the box while it
     *  is being built so the box itself can be discarded. */
    type StoreBox = {
      readonly prefix: string;
      readonly octet: number;
      readonly runsRedis: boolean;
      readonly runsMysqld: boolean;
      readonly pidfile: FileEntry | undefined;
      readonly accounts: readonly string[];
      readonly store: RedisStore | null;
      readonly storeFile: FileEntry | undefined;
      readonly hasStoreDir: boolean;
      readonly hasDatabaseDir: boolean;
      readonly redisLog: FileEntry | undefined;
      readonly conf: FileEntry | undefined;
    };

    const inspect = (prefix: string, octet: number): StoreBox => {
      const fs = buildRemoteHostFs(ESSID, namedHost(prefix, octet));
      const pidfile = fileAt(fs, 'var', 'run', 'redis-server.pid');
      const storeFile = fileAt(fs, 'var', 'lib', 'redis', 'data.json');

      return {
        prefix,
        octet,
        runsRedis: pidfile !== undefined,
        runsMysqld: fileAt(fs, 'var', 'run', 'mysqld.pid') !== undefined,
        pidfile,
        accounts: [passwdRows(fs)[0]?.[0] ?? 'root', npcUserRow(fs)[0]],
        store: storeFile === undefined ? null : parseRedisStore(storeFile.content),
        storeFile,
        hasStoreDir: dirExistsAt(fs, 'var', 'lib', 'redis'),
        hasDatabaseDir: dirExistsAt(fs, 'var', 'lib', 'mysql'),
        redisLog: fileAt(fs, 'var', 'log', 'redis.log'),
        conf: fileAt(fs, 'etc', 'redis', 'redis.conf'),
      };
    };

    /**
     * Five kinds of box over a LAN's worth of addresses, generated ONCE for the whole
     * block — the shape the database block beside this one records, and for the same
     * two reasons. A placement rate is a property of the WORLD, so one box proves
     * nothing about it; and a store draws 8-15 keys from a weighted pool, so a value a
     * player can meet is a value a two-host sample never reads, and a value no test
     * reads can be blanked without anything failing.
     *
     * Computed once because regenerating it per test is quick in an ordinary run but
     * slow enough under mutation instrumentation to race Stryker's timeout — which
     * scores a surviving mutant as killed and makes the number a measure of the machine
     * rather than of the tests.
     */
    const population = lazily(() =>
      ['www', 'db', 'host', 'desktop', 'cam'].flatMap((prefix) =>
        OCTETS.map((octet) => inspect(prefix, octet)),
      ),
    );

    const boxesOn = (prefix: string): readonly StoreBox[] =>
      population().filter((box) => box.prefix === prefix);

    const redisRateOn = (prefix: string): number =>
      boxesOn(prefix).filter((box) => box.runsRedis).length / boxesOn(prefix).length;

    /** Every store this sample of the world contains, whatever kind of box keeps it. */
    const stores = lazily(() =>
      population().flatMap((box) => (box.store === null ? [] : [{ box, store: box.store }])),
    );

    /** Where a complaint came from: a box's name, never the box. A population of a
     *  thousand boxes can raise a thousand complaints, and an assertion that renders
     *  them all takes longer to FAIL than the file takes to run — reported as a timeout
     *  rather than a kill, which hands the score back to the machine. */
    const where = (box: StoreBox): string => `${box.prefix}-${box.octet}`;

    const noneOf = (
      offenders: readonly string[],
    ): { readonly count: number; readonly sample: readonly string[] } => ({
      count: offenders.length,
      sample: offenders.slice(0, 3),
    });

    const NONE = { count: 0, sample: [] };

    /**
     * Whether each store in the world is locked, sampled across EIGHT networks rather
     * than one.
     *
     * One network yields about two hundred stores, and these seeds differ only in a
     * trailing octet — close enough that the generator's first draws correlate, and a
     * single network's lock rate swings by a fifth either way on sampling alone. That is
     * a property of the sample, not of the world: over the eight networks the house
     * measures every other probability across, the rate lands where it was set. The
     * ordering claims above need no such width, because an ordering survives the swing.
     *
     * Only the webserver prefix, which is where a store is likeliest — enough stores to
     * measure, at a fraction of the cost of sweeping every prefix eight times over.
     */
    const locksAcrossTheWorld = lazily(() =>
      POPULATION_ESSIDS.flatMap((essid) =>
        OCTETS.flatMap((octet) => {
          const storeFile = fileAt(
            buildRemoteHostFs(essid, namedHost('www', octet)),
            'var',
            'lib',
            'redis',
            'data.json',
          );
          return storeFile === undefined ? [] : [parseRedisStore(storeFile.content)];
        }),
      ),
    );

    /** The names a value hands out ATTACHED to a secret: the user half of a URL that
     *  carries a password, and the username a config object states beside one.
     *
     *  The NAME is what matters, not the presence of its letters somewhere in the text.
     *  A database box can have a unix account called `mysql`, and every connection URL
     *  in the world begins `mysql://` — a substring test would call that a leak and be
     *  wrong about the one thing this claim is for. */
    const namesPairedWithSecret = (value: string): readonly string[] => {
      const fromUrl = [...value.matchAll(/\/\/([^:@/\s"]+):[^@/\s"]+@/g)].map((match) => match[1]);
      const besideAPassword = /"(?:password|bind_password|secret|secret_key)"\s*:/.test(value)
        ? [...value.matchAll(/"(?:username|user|bind_dn)"\s*:\s*"([^"]+)"/g)].map(
            (match) => match[1],
          )
        : [];
      return [...fromUrl, ...besideAPassword].filter((name) => name !== undefined);
    };

    it('plants a redis-server.pid naming the port the store answers on', () => {
      const running = population().filter((box) => box.runsRedis)[0];

      expect(running?.pidfile?.content).toBe('redis-server:port=6379');
      expect(running?.pidfile?.owner).toBe('redis');
    });

    it('runs a store most often on the boxes serving the pages behind it, and never on a camera', () => {
      // Legacy placed redis on database boxes only, which contradicts the data legacy
      // itself generates: the keys are sessions, user caches and permissions — web
      // application state. The webserver is the correction, which is what gives the web
      // door a second follow-on: read the page, then read the sessions behind it.
      expect(redisRateOn('www')).toBeGreaterThan(redisRateOn('db'));
      expect(redisRateOn('db')).toBeGreaterThan(redisRateOn('host'));
      expect(redisRateOn('cam')).toBe(0);
    });

    it('leaves an ordinary box at the flat rate the world already sets', () => {
      // A laptop is what the flat rate was tuned against, so it takes that rate rather
      // than a cell restating it.
      expect(redisRateOn('desktop')).toBeCloseTo(redisRateOn('host'), 1);
      expect(redisRateOn('host')).toBeGreaterThan(0);
      expect(redisRateOn('host')).toBeLessThan(0.12);
    });

    it('keeps a real store on the box that runs one', () => {
      const unreadable = population().filter((box) => box.runsRedis && box.store === null).map(where);
      const wrongSize = stores().filter(({ store }) => {
        const count = Object.keys(store.keys).length;
        return count < 8 || count > 15;
      }).map(({ box }) => where(box));

      expect(stores().length).toBeGreaterThan(0);
      expect(noneOf(unreadable)).toEqual(NONE);
      expect(noneOf(wrongSize)).toEqual(NONE);
    });

    it('plants the store on exactly the boxes running the daemon, and nowhere else', () => {
      // An empty /var/lib/redis on every box would promise a store that is not there,
      // and listing /var/lib is recon a player acts on.
      const disagreeing = population().filter((box) => box.hasStoreDir !== box.runsRedis).map(where);

      expect(population().filter((box) => box.runsRedis).length).toBeGreaterThan(0);
      expect(noneOf(disagreeing)).toEqual(NONE);
    });

    it('lets a box run a store and a database without either erasing the other', () => {
      // Both datadirs live under /var/lib, and a box that runs both daemons is common
      // rather than exotic. Composed as two independent entries, the second would
      // replace the first and a quarter of the database boxes in the world would lose
      // the database they were holding, with nothing failing to say so.
      const both = population().filter((box) => box.runsRedis && box.runsMysqld);
      const missing = both.filter((box) => !(box.hasStoreDir && box.hasDatabaseDir)).map(where);

      expect(both.length).toBeGreaterThan(0);
      expect(noneOf(missing)).toEqual(NONE);
    });

    it('guards the store from every tier but root, even on the box itself', () => {
      // It holds the hash a sweep has to work for. A tier that could read it would be
      // handed the answer key.
      const wronglyGuarded = stores().filter(
        ({ box }) =>
          box.storeFile?.perms.read.join(',') !== 'root' ||
          box.storeFile.perms.write.join(',') !== 'root' ||
          box.storeFile.perms.execute.length !== 0,
      ).map(({ box }) => where(box));

      expect(noneOf(wronglyGuarded)).toEqual(NONE);
    });

    it('shows a stranger with no session nothing of the store at all', () => {
      const box = stores()[0]?.box;
      const whole = buildRemoteHostFs(ESSID, namedHost(box?.prefix ?? 'www', box?.octet ?? 2));
      const pruned = filterTreeToAllowlist(whole);

      expect(dirExistsAt(whole, 'var', 'lib', 'redis')).toBe(true);
      expect(dirExistsAt(pruned, 'var', 'lib', 'redis')).toBe(false);
      expect(dirExistsAt(pruned, 'etc', 'redis')).toBe(false);
    });

    it('publishes a conf on every box running a store, whatever else the box is for', () => {
      // The /etc slot a box's ROLE claims is already spoken for on a webserver, which is
      // where a store is most likely to be. A conf keyed by role would leave most stores
      // undescribed — and the box would contradict itself about where its own data is.
      const disagreeing = population().filter(
        (box) => (box.conf !== undefined) !== box.runsRedis,
      ).map(where);
      const webBoxes = boxesOn('www').filter((box) => box.runsRedis);

      expect(webBoxes.length).toBeGreaterThan(0);
      expect(noneOf(disagreeing)).toEqual(NONE);
    });

    it('names the host it sits on, and the paths the rest of the box really uses', () => {
      const box = stores()[0]?.box;
      const content = box?.conf?.content ?? '';

      expect(content).toContain(`${box?.prefix}-${box?.octet}`);
      expect(content).toContain('port 6379');
      expect(content).toContain('dir /var/lib/redis');
      expect(content).toContain('logfile /var/log/redis.log');
      expect(content).toContain('pidfile /var/run/redis-server.pid');
    });

    it('draws every shape of key a store can hold, so none of the pool ships unreachable', () => {
      // A generator no store in the world ever runs is a shape a player can never meet,
      // and one that can be deleted with the whole suite green. The weights decide how
      // OFTEN each appears; this is the claim that each appears at all.
      const everyKey = stores().flatMap(({ store }) => Object.keys(store.keys));
      const missing = [
        'sess:jwt:',
        'sess:',
        'cache:user:',
        'perms:',
        'api:key:',
        'app:config',
        'config:smtp',
        'config:s3',
        'config:ldap',
        'token:reset:',
        'lock:',
        'ratelimit:',
        'stats:',
        'queue:',
        'cron:last_run:',
        'webhook:',
      ].filter((shape) => !everyKey.some((key) => key.startsWith(shape)));

      expect(noneOf(missing)).toEqual(NONE);
    });

    it('writes the conf as lines, each stating one thing about the daemon', () => {
      // Joined with nothing instead of newlines the file still CONTAINS every directive
      // it should, and every `toContain` above still passes — while `cat` shows one
      // run-on line that no redis would accept.
      const lines = stores()[0]?.box.conf?.content.split('\n') ?? [];

      expect(lines.length).toBe(7);
      expect(lines).toContain('bind 0.0.0.0');
      expect(lines).toContain('daemonize yes');
      expect(lines[0]?.startsWith('# ')).toBe(true);
    });

    it('lets a guest read the conf, because it names no secret to guard', () => {
      expect(stores()[0]?.box.conf?.perms.read).toEqual(['root', 'user', 'guest']);
    });

    it('never writes the password into the file a guest can read, on any box in the world', () => {
      // The rung this file sits on admits a guest, and says why it may: it names neither
      // an account nor a hash. A requirepass line makes that false and hands out for free
      // the loot the cracking curve exists to make a player earn.
      const leaking = population().filter((box) => box.conf?.content.includes('requirepass')).map(
        where,
      );

      expect(population().filter((box) => box.conf !== undefined).length).toBeGreaterThan(0);
      expect(noneOf(leaking)).toEqual(NONE);
    });

    it('locks about six stores in ten and leaves the rest open', () => {
      // The crack is the main way in; the open find stays a real but secondary outcome.
      const hashes = locksAcrossTheWorld().map((store) => store?.requirepassHash ?? null);
      const locked = hashes.filter((hash) => hash !== null);
      const unhashed = locked.filter((hash) => !/^[0-9a-f]{32}$/.test(hash));

      expect(hashes.length).toBeGreaterThan(500);
      expect(locked.length / hashes.length).toBeGreaterThan(0.55);
      expect(locked.length / hashes.length).toBeLessThan(0.65);
      expect(unhashed.length).toBe(0);
    });

    it('plants /var/log/redis.log empty where the daemon runs, and nowhere else', () => {
      // A log claims something happened. On a box that never ran the daemon it is
      // furniture that lies about the box's past.
      const disagreeing = population().filter(
        (box) => (box.redisLog !== undefined) !== box.runsRedis,
      ).map(where);

      expect(stores()[0]?.box.redisLog?.content).toBe('');
      expect(noneOf(disagreeing)).toEqual(NONE);
    });

    it('names the people the box really carries in its keys, and never the guest', () => {
      // Those keys name real users, and /etc/passwd is guest-unreadable — so an open
      // store hands out with no credential the names a whole permission rung protects.
      // Kept on purpose: it is the real-world exposed-store problem, and it gives the
      // open find a job beyond flavour.
      const anonymous = stores().filter(
        ({ box, store }) =>
          !box.accounts.some((account) =>
            Object.values(store.keys).some((value) => value.includes(account)),
          ),
      ).map(({ box }) => where(box));
      const naming = stores().filter(({ store }) =>
        Object.values(store.keys).some((value) => value.includes('guest')),
      ).map(({ box }) => where(box));

      expect(stores().length).toBeGreaterThan(0);
      expect(noneOf(anonymous)).toEqual(NONE);
      expect(noneOf(naming)).toEqual(NONE);
    });

    it('never pairs a name the box really carries with a secret', () => {
      // The database beside this one draws the same line: the box's real account leads
      // the users table as CONTENT, while every secret-bearing row comes from a separate
      // namespace. A real name attached to a password is a credential that reads as
      // working right up until a player spends the attempt.
      const paired = stores().filter(({ box, store }) =>
        Object.values(store.keys).some((value) =>
          namesPairedWithSecret(value).some((name) => box.accounts.includes(name)),
        ),
      ).map(({ box }) => where(box));

      expect(
        stores().some(({ store }) =>
          Object.values(store.keys).some((value) => namesPairedWithSecret(value).length > 0),
        ),
      ).toBe(true);
      expect(noneOf(paired)).toEqual(NONE);
    });

    it('leaves every box the accounts, services and database it had before the store arrived', () => {
      // The store draws on its OWN stream. Continuing the host filesystem's sequence
      // would move every value picked after it — including the octets the lease
      // allocator excludes when it issues an occupant an address, which would put a
      // player on top of an NPC. These are the values the generator produced before the
      // store existed.
      const readBox = (hostname: string, octet: number) => {
        const fs = buildRemoteHostFs(ESSID, { ip: `${SUBNET}.${octet}`, hostname, kind: 'machine' });
        const datadir = fileAt(fs, 'var', 'lib', 'mysql', 'data.json');
        return {
          passwd: passwdRows(fs)
            .filter((fields) => fields.length > 1)
            .map((fields) => fields.slice(0, 3).join(':')),
          pidfiles: [...(varRun(fs)?.entries.keys() ?? [])]
            .filter((name) => name !== 'redis-server.pid')
            .sort(),
          dbName: datadir === undefined ? null : parseMysqlDatabase(datadir.content)?.name,
        };
      };

      expect(readBox('db-11', 11)).toEqual({
        passwd: [
          'root:d002d4825c449e44003e0d7c876057e3:0',
          'sqladmin:0c4c43c0a94fc3d2210fa58dca6e09da:1000',
          'guest:4cb9c8a8048fd02294477fcb1a41191a:1001',
        ],
        pidfiles: ['mysqld.pid', 'sshd.pid', 'vsftpd.pid'],
        dbName: 'main_store',
      });
      expect(readBox('www-7', 7)).toEqual({
        passwd: [
          'root:d09ab9985607dc6b20edbb25c0d57f31:0',
          'devops:ff9830c42660c1dd1942844f8069b74a:1000',
          'guest:aabb2100033f0352fe7458e412495148:1001',
        ],
        pidfiles: ['nginx.pid', 'vsftpd.pid'],
        dbName: null,
      });
      expect(readBox('host-42', 42)).toEqual({
        passwd: [
          'root:36cf655efe569f20c40c42f8673004c8:0',
          'support:f4de0e02cf21722f17c09be7ba42b3ec:1000',
          'guest:c21f969b5f03d33d43e04f8f136e7682:1001',
        ],
        pidfiles: [],
        dbName: null,
      });
      expect(readBox('cam-31', 31)).toEqual({
        passwd: [
          'root:37065afef085c96205cbbe76e37832b2:0',
          'telemetry:0c4c43c0a94fc3d2210fa58dca6e09da:1000',
          'guest:0d107d09f5bbe40cade3de5c71e9e9b7:1001',
        ],
        pidfiles: ['nginx.pid'],
        dbName: null,
      });
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

    it('ships /bin/clear and /bin/whoami, so the terminal tools work on a box you hop to', () => {
      const bin = dirAt(fs(), 'bin');
      expect(bin.entries.has('clear')).toBe(true);
      expect(bin.entries.has('whoami')).toBe(true);
    });

    it('ships /lib and /usr/sbin/sshd so linked commands + the daemon resolve', () => {
      expect(dirAt(fs(), 'lib').entries.has('libpcre.so')).toBe(true);
      expect(dirAt(fs(), 'usr', 'sbin').entries.has('sshd')).toBe(true);
    });

    it('ships /usr/bin/systemctl, so a rooted NPC box can be told to stop serving', () => {
      // The whole point of the door is closing someone ELSE's port once you hold
      // their box — which is impossible if the tool only exists on the player's
      // own machine.
      expect(dirAt(fs(), 'usr', 'bin').entries.has('systemctl')).toBe(true);
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

  describe('the toolchain a box carries (what it runs decides what it holds)', () => {
    /** The first octet on this ESSID whose box RUNS `service`. Read off
     *  `hostServices` rather than off the pidfiles, because what a box HOLDS is meant
     *  to follow what it runs rather than what it happens to have written down — and
     *  a test that read the same file the generator wrote could not tell the two
     *  apart. Throws rather than skipping: a sample with no such box would make every
     *  claim below vacuously true. */
    const servingOctet = (service: string): number => {
      const octet = OCTETS.find((candidate) =>
        hostServices(ESSID, host(candidate)).some(({ spec }) => spec.service === service),
      );
      if (octet === undefined) throw new Error(`no host on ${ESSID} serves ${service}`);
      return octet;
    };

    /** The first octet whose box does NOT run `service` — the other half of every
     *  claim, since a rule that planted a binary everywhere would pass all of them. */
    const idleOctet = (service: string): number => {
      const octet = OCTETS.find(
        (candidate) =>
          !hostServices(ESSID, host(candidate)).some(({ spec }) => spec.service === service),
      );
      if (octet === undefined) throw new Error(`every host on ${ESSID} serves ${service}`);
      return octet;
    };

    const fsServing = (service: string): Directory =>
      buildRemoteHostFs(ESSID, host(servingOctet(service)));

    const fsIdle = (service: string): Directory =>
      buildRemoteHostFs(ESSID, host(idleOctet(service)));

    it('gives a box that serves the web the daemon its own port answers on', () => {
      // The name is not a choice this makes: `ps` prints it in COMMAND, `nmap` reports
      // it as the port's owner and `systemctl` carries it as the unit's name, all
      // three off the one pidfile. A box whose process table says nginx must hold
      // nginx, or the only way to shut its door is missing from it.
      const fs = fsServing(SERVICE_CATALOG.http.service);
      expect(fileAt(fs, 'usr', 'sbin', 'nginx')).toBeDefined();
      // In `/usr/sbin` and NOWHERE else. Where a binary sits is the whole of what
      // separates a daemon from a tool here, and a box that scattered both through
      // both directories would teach the player an exception that is not real.
      expect(fileAt(fs, 'usr', 'bin', 'nginx')).toBeUndefined();
    });

    it('leaves the web daemon off a box that serves no web', () => {
      expect(fileAt(fsIdle(SERVICE_CATALOG.http.service), 'usr', 'sbin', 'nginx')).toBeUndefined();
    });

    it('gives a database box both halves of the package it runs', () => {
      // The daemon alone would leave a database nobody standing on the box could
      // query. apt ships the client and the daemon together and puts them in
      // different places; a box the world is running one on holds both, in the
      // destinations apt itself would have used.
      const fs = fsServing(SERVICE_CATALOG.mysql.service);
      expect(fileAt(fs, 'usr', 'sbin', 'mysqld')).toBeDefined();
      expect(fileAt(fs, 'usr', 'bin', 'mysql')).toBeDefined();
      // And each in ITS OWN place. This is the one package that ships both halves, so
      // it is the only box in the world that can prove the split is real rather than
      // an accident of every other package having a single binary.
      expect(fileAt(fs, 'usr', 'bin', 'mysqld')).toBeUndefined();
      expect(fileAt(fs, 'usr', 'sbin', 'mysql')).toBeUndefined();
    });

    it('leaves both halves off a box that runs no database', () => {
      const fs = fsIdle(SERVICE_CATALOG.mysql.service);
      expect(fileAt(fs, 'usr', 'sbin', 'mysqld')).toBeUndefined();
      expect(fileAt(fs, 'usr', 'bin', 'mysql')).toBeUndefined();
    });

    it('gives a box that serves files the client its service is named for', () => {
      // vsftpd is on every box already, so what an ftp box GAINS is the client — and
      // with it a rooted fileserver can reach out as well as be reached.
      const fs = fsServing(SERVICE_CATALOG.ftp.service);
      expect(fileAt(fs, 'usr', 'bin', 'ftp')).toBeDefined();
      // A tool, so `/usr/bin` — the daemon's directory holds vsftpd, which is a
      // different program the player brings nothing to.
      expect(fileAt(fs, 'usr', 'sbin', 'ftp')).toBeUndefined();
    });

    it('leaves the ftp client off a box that serves no files', () => {
      expect(fileAt(fsIdle(SERVICE_CATALOG.ftp.service), 'usr', 'bin', 'ftp')).toBeUndefined();
    });

    it('keeps the base image on every box, whether it serves anything or not', () => {
      // The rule ADDS and never takes away. A binary present with no pidfile is a
      // service installed and stopped — the ordinary state of a real machine, and the
      // one `systemctl status` prints a hollow marker for. Shrinking the base set to
      // what each box happens to run would erase that state from the world.
      const missing = OCTETS.filter((octet) => {
        const sbin = dirAt(buildRemoteHostFs(ESSID, host(octet)), 'usr', 'sbin');
        return !sbin.entries.has('sshd') || !sbin.entries.has('vsftpd');
      });
      expect(missing).toEqual([]);
    });

    it('plants apache2 on no generated box', () => {
      // The web service has ONE identity and its pidfile names nginx. apache2 stays
      // the player's second front door onto that same port — something they install
      // on their own machine, never something the world is found running.
      const carrying = OCTETS.filter((octet) =>
        dirAt(buildRemoteHostFs(ESSID, host(octet)), 'usr', 'sbin').entries.has('apache2'),
      );
      expect(carrying).toEqual([]);
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

  describe('the account a box carries (who lives on it says what it is)', () => {
    /** One prefix per role, plus the name no role claims. The prefixes are the ones
     *  a generated LAN actually hands out, so the account read here is the account a
     *  player meets. */
    const ACCOUNT_PREFIXES: readonly string[] = [
      'desktop',
      'cam',
      'www',
      'nas',
      'db',
      'mail',
      'dns',
      'host',
    ];

    /**
     * Every distinct uid-1000 account name the boxes of one kind carry across a
     * LAN's worth of addresses. A box carries ONE account, so anything claimed about
     * what a kind of box carries has to be claimed over the population — a name a
     * player can meet that no test has read is a name that can be blanked unnoticed.
     *
     * Computed ONCE for the whole block. Eight prefixes over 253 addresses is the
     * sample the difficulty curve below already pays for, and regenerating it per
     * test is fast in a normal run but slow enough under mutation instrumentation to
     * race Stryker's timeout — which turns a surviving mutant into a "killed by
     * timeout" and makes the score depend on machine speed rather than on the tests.
     */
    const accountsByPrefix: ReadonlyMap<string, readonly string[]> = new Map(
      ACCOUNT_PREFIXES.map((prefix) => [
        prefix,
        [
          ...new Set(
            OCTETS.map((octet) => npcUserRow(buildRemoteHostFs(ESSID, namedHost(prefix, octet)))[0]),
          ),
        ].sort(),
      ]),
    );

    const accountsOn = (prefix: string): readonly string[] => {
      const names = accountsByPrefix.get(prefix);
      if (names === undefined) throw new Error(`no account sample for "${prefix}"`);
      return names;
    };

    it('gives a camera an account a camera would carry, not a build server one', () => {
      // The whole point of naming the boxes was that a player could read a scan. An
      // account is the last thing on a generated box that still reads the same
      // everywhere, and it is the one `hydra` hands back — so `deploy` on a doorbell
      // undoes at the login prompt what the hostname said at the scan.
      expect(accountsOn('cam')).toEqual(
        [
          'device',
          'iotuser',
          'sensor',
          'mqtt',
          'telemetry',
          'gateway',
          'controller',
          'monitor',
          'zigbee',
          'modbus',
          'plcuser',
          'firmware',
          'otauser',
          'camadmin',
          'rtsp',
        ].sort(),
      );
    });

    it('gives a mail server an account a mail server would carry', () => {
      // A second role asserted whole, so "it fits the box" cannot be satisfied by one
      // special-cased pool with everything else still falling back.
      expect(accountsOn('mail')).toEqual(
        [
          'postmaster',
          'mailadm',
          'dovecot',
          'smtp-svc',
          'mailops',
          'listadm',
          'relay',
          'quarantine',
          'mxops',
          'imapuser',
          'spamfilter',
          'mailarch',
          'dkim',
          'fetchmail',
          'popuser',
        ].sort(),
      );
    });

    it('never lets two kinds of box share an account name', () => {
      // What makes the account evidence rather than flavour: a name a player reads
      // has to point at one kind of box. It is also what stops a swapped pool from
      // surviving on an overlap — with the sets disjoint, a camera drawing a mail
      // server's names is visible, where a shared `admin` would have hidden it.
      const named = ACCOUNT_PREFIXES.flatMap((prefix) =>
        accountsOn(prefix).map((name) => ({ prefix, name })),
      );
      const shared = named.filter((entry) =>
        named.some((other) => other.name === entry.name && other.prefix !== entry.prefix),
      );

      expect(shared).toEqual([]);
    });

    it('draws every kind from a pool wide enough that one LAN does not repeat itself', () => {
      // A LAN holds a handful of boxes of any one kind, so a pool this wide keeps two
      // cameras on one network from reading as the same camera. Every entry is proved
      // reachable by being counted here, and every entry has to read as an account
      // name — a blanked pool entry is a passwd row with no name in it.
      ACCOUNT_PREFIXES.filter((prefix) => prefix !== 'host').forEach((prefix) =>
        expect(accountsOn(prefix)).toHaveLength(15),
      );

      ACCOUNT_PREFIXES.forEach((prefix) =>
        accountsOn(prefix).forEach((name) => expect(name).toMatch(/^[a-z][a-z0-9-]*$/)),
      );
    });

    it('leaves a box whose name claims no role carrying exactly what it always did', () => {
      // The fallback is not a gap to be filled later: a deep NPC named from a
      // gateway's stream can wear a name no role claims, and a generic service
      // account is the right answer for it. These eight are what such a box carried
      // before any pool was keyed, unchanged.
      expect(accountsOn('host')).toEqual(
        ['admin', 'ubuntu', 'pi', 'deploy', 'dev', 'operator', 'support', 'backup'].sort(),
      );
    });

    it('moves the name over the door and not one password behind it', () => {
      // `pick` consumes one `next()` whatever the pool's width, and the host-fs seed
      // is the ADDRESS rather than the name — so a `cam-7` and a nameless box at the
      // same address draw the same stream. Every hash must land where it landed
      // before: which accounts fall to the shipped wordlist is the difficulty curve,
      // and naming the accounts is not entitled to move it.
      const moved = OCTETS.filter((octet) => {
        const named = buildRemoteHostFs(ESSID, namedHost('cam', octet));
        const nameless = buildRemoteHostFs(ESSID, host(octet));
        return (
          rowFor(named, 'root')[1] !== rowFor(nameless, 'root')[1] ||
          rowFor(named, 'guest')[1] !== rowFor(nameless, 'guest')[1] ||
          npcUserRow(named)[1] !== npcUserRow(nameless)[1]
        );
      });

      expect(moved).toEqual([]);
    });

    it('plants the account a home of its own, whatever the box turned out to be', () => {
      // The passwd row and the tree have to agree about who lives here, or `ssh` lands
      // an account in a directory that is not theirs.
      const tree = buildRemoteHostFs(ESSID, namedHost('mail', 42));
      const userRow = npcUserRow(tree);
      const username = userRow[0] ?? '';

      expect(userRow[2]).toBe('1000');
      expect(userRow[5]).toBe(`/home/${username}`);
      expect(dirAt(tree, 'home', username).owner).toBe(username);
    });
  });
  describe('the difficulty curve (not every account falls to the starting wordlist)', () => {
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
      // The DAEMON is present everywhere, as sshd is, whether the box serves ftp or
      // not. The CLIENT is not: it follows the service, so only a box actually
      // serving files carries one.
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

  describe('what a box is called decides what it runs', () => {
    /** How many of the 8 x 253 population run `service` when every host wears
     *  `prefix`. A service seeds on `(service, essid, ip)` and never on the name, so
     *  the DRAW is identical whatever the box is called and only the threshold it is
     *  compared against moves — which is what makes two prefixes' counts directly
     *  comparable rather than two independent samples. */
    const runningCount = (prefix: string, service: string): number =>
      POPULATION_ESSIDS.reduce(
        (total, essid) =>
          total +
          OCTETS.filter((octet) =>
            hostServices(essid, namedHost(prefix, octet)).some(
              ({ spec }) => spec.service === service,
            ),
          ).length,
        0,
      );

    it('publishes from nearly every webserver, and from few of the phones', () => {
      // 1916 of the 2024 wear :80 as a webserver against 629 as a phone. The band
      // excludes every mutant that matters: the override ignored (629, the flat
      // rate), skip-none (2024), skip-all (0), and a flipped threshold (108 — the
      // complement). The ratio is the part a player feels: reading `www-` off a scan
      // has to beat guessing.
      const webserver = runningCount('www', 'http');
      const workstation = runningCount('desktop', 'http');

      expect(webserver).toBeGreaterThan(1800);
      expect(webserver).toBeLessThan(2000);
      expect(workstation).toBeLessThan(750);
      expect(webserver).toBeGreaterThan(2 * workstation);
    });

    it('hands you no shell on a camera — an iot box is not a box you log into', () => {
      // 216 of 2024, against the flat 823 an unclaimed name still gets. Low enough
      // that a camera you CAN log into is a find; not zero, because a shell that
      // never exists is a role the sweep may as well skip.
      const iot = runningCount('cam', 'ssh');

      expect(iot).toBeGreaterThan(130);
      expect(iot).toBeLessThan(290);
      expect(iot).toBeLessThan(runningCount('desktop', 'ssh'));
    });

    it('opens ftp on nearly every fileserver, and on a fair share of database boxes', () => {
      // The door a dump leaves by. A fileserver exists to hand files over, so it is
      // nearly always up. A database box now has a door of its own, so its ftp cell
      // no longer has to carry the role's whole signature — it came down when mysqld
      // shipped and sits just above the flat rate, because a dump still has to leave
      // somehow. 1806 and 776 of 2024, against a flat 556.
      const fileserver = runningCount('nas', 'ftp');
      const database = runningCount('db', 'ftp');

      expect(fileserver).toBeGreaterThan(1700);
      expect(fileserver).toBeLessThan(1950);
      expect(database).toBeGreaterThan(700);
      expect(database).toBeLessThan(900);
      // Still elevated, not retired: a database box hands files over more readily
      // than a box the table says nothing about.
      expect(database).toBeGreaterThan(runningCount('host', 'ftp'));
      // Both are marked boxes, but a fileserver is the one that exists to hand files
      // over. Swapping the two cells keeps both bands' shape and fails here.
      expect(fileserver).toBeGreaterThan(database);
    });

    it('runs the agent on no host at all, whatever the box is called', () => {
      // The door that separates a network device from a host. Its flat rate is zero and
      // no drawn role has a cell, so every name here falls through to zero — and a name
      // CANNOT reach the router or switch cells that do carry it, because a role is read
      // back off the hostname and those two are never among the seven a machine draws.
      // A flat rate above zero would repeat the correction the database row already got
      // once: more SNMP boxes in the world would be laptops and cameras than routers.
      const named = ['www', 'db', 'nas', 'cam', 'desktop', 'mail', 'ns', 'host'];

      expect(named.map((prefix) => runningCount(prefix, 'snmp'))).toEqual(named.map(() => 0));
    });

    it('leaves a pairing the table says nothing about generating at exactly the flat rate', () => {
      // The overrides are sparse by design: a role with nothing to say about a
      // service must fall through to the catalog's own placement, unchanged to the
      // host. A name no role claims falls through the same way.
      expect(runningCount('desktop', 'ssh')).toBe(runningCount('host', 'ssh'));
      expect(runningCount('mail', 'ssh')).toBe(runningCount('host', 'ssh'));
      expect(runningCount('www', 'ftp')).toBe(runningCount('host', 'ftp'));
    });
  });

  describe('the backdoors the world already left behind', () => {
    /** The listeners a generated host is carrying, read through the parser `nmap`
     *  and `ps` use rather than by looking for a filename — so a pidfile this suite
     *  counts is one the rest of the game also calls a running listener, and not
     *  merely a file somebody dropped in `/var/run`. */
    const listenersOf = (fs: Directory): readonly Listener[] =>
      readRunningProcesses(fs).flatMap((running) =>
        running.kind === 'listener' ? [running] : [],
      );

    /** The account a generated box gives uid 1000 — its own human user, the one
     *  account between root and guest. */
    const humanUserOf = (fs: Directory): string => {
      const row = passwdRows(fs).find((fields) => fields[2] === '1000');
      if (row === undefined) throw new Error('expected a uid-1000 account');
      return row[0]!;
    };

    const POPULATION_HOSTS = POPULATION_ESSIDS.length * OCTETS.length;

    /**
     * Every generated listener in the population, with the box that carries it.
     *
     * Computed ONCE for the whole suite, for the reason the difficulty curve is:
     * regenerating 2024 hosts per test is fast in a normal run but slow enough
     * under mutation instrumentation to race Stryker's timeout, which turns a
     * surviving mutant into a "killed by timeout" and makes the score depend on
     * machine speed rather than on the tests.
     */
    const planted: readonly {
      readonly essid: string;
      readonly octet: number;
      readonly fs: Directory;
      readonly listener: Listener;
    }[] = POPULATION_ESSIDS.flatMap((essid) =>
      OCTETS.flatMap((octet) => {
        const fs = buildRemoteHostFs(essid, host(octet));
        return listenersOf(fs).map((listener) => ({ essid, octet, fs, listener }));
      }),
    );

    it('leaves one on roughly a tenth of NPC hosts — a strange LAN has a door in it', () => {
      // The rate is a property of the world, so a single box proves nothing. This
      // deterministic 2024-host sample yields 194 listeners (9.6%, against a 0.10
      // knob) — about one per 10-host LAN. The band brackets that while excluding
      // the mutants that matter: plant-on-none (0), plant-on-every-host (2024), and
      // a flipped roll comparison (keep next() >= chance ⇒ ~1830).
      expect(planted.length).toBeGreaterThan(Math.round(POPULATION_HOSTS * 0.06));
      expect(planted.length).toBeLessThan(Math.round(POPULATION_HOSTS * 0.15));
    });

    it('runs as the box own uid-1000 account at user tier — a foothold, never root', () => {
      // A generated door hands out the tier its pidfile records, so root here would
      // give away on every tenth NPC box what the CVE phase exists to earn. It is
      // also why the account has to be one the box really has: a listener naming
      // nobody in `/etc/passwd` is a login as a user the box cannot describe.
      const wrongTier = planted
        .filter(
          ({ fs, listener }) =>
            listener.userType !== 'user' || listener.user !== humanUserOf(fs),
        )
        .map(({ essid, octet, listener }) => ({ essid, octet, listener }));

      expect(wrongTier).toEqual([]);
      expect(planted.length).toBeGreaterThan(0);
    });

    it('draws the port from the backdoor pool, and spreads across the whole of it', () => {
      // Both halves matter. Every port used is one the pool declares, so no listener
      // lands on a port a service would answer on; and every port the pool declares
      // gets used, so the pool is a draw rather than a constant with spare entries.
      const used = [...new Set(planted.map(({ listener }) => listener.port))];

      expect(used.sort((left, right) => left - right)).toEqual(
        [...BACKDOOR_PORTS].sort((left, right) => left - right),
      );
    });

    it('is the same door on every build — which box, which port, which account', () => {
      // Two occupants scanning one LAN must find the same open port, and the box a
      // player walks away from must be the box they come back to.
      const carrier = planted[0]!;

      expect(listenersOf(buildRemoteHostFs(carrier.essid, host(carrier.octet)))).toEqual([
        carrier.listener,
      ]);
    });

    it('writes the pidfile a player own `nc -l` writes — same name, shape and permissions', () => {
      // A door the world left behind and a door a player planted must be
      // indistinguishable to whoever finds one. Anything else tells an intruder
      // which listeners have an owner watching them.
      const { fs, listener } = planted[0]!;
      const node = varRun(fs)?.entries.get(`nc-${listener.port}.pid`);

      if (node === undefined || node.kind !== 'file') {
        throw new Error(`expected /var/run/nc-${listener.port}.pid`);
      }
      expect(node.content).toBe(formatListenerContent(listener));
      expect(node.perms).toEqual(PIDFILE_PERMISSIONS);
      expect(node.owner).toBe('root');
    });

    it('leaves the accounts of the world already generated exactly where they were', () => {
      // The roll seeds its OWN stream. Drawing from the host filesystem prng would
      // shift every draw after it and silently re-roll every NPC username and
      // password on every network. These rows were captured before the roll existed.
      expect(rowFor(buildRemoteHostFs(ESSID, host(42)), 'root')[1]).toBe(
        '36cf655efe569f20c40c42f8673004c8',
      );
      expect(humanUserOf(buildRemoteHostFs(ESSID, host(42)))).toBe('support');
      expect(humanUserOf(buildRemoteHostFs(ESSID, host(7)))).toBe('pi');
    });
  });

  describe('the config a box keeps in /etc (what it is built to be)', () => {
    /** Every role's prefix paired with the file that role keeps. The names are
     *  legacy's, adopted rather than coined, so a `mysql.cnf` means in v2 what it
     *  meant in the app this one replaces. */
    const ROLE_FILES: readonly { readonly prefix: string; readonly filename: string }[] = [
      { prefix: 'desktop', filename: 'ssh_config' },
      { prefix: 'cam', filename: 'device.conf' },
      { prefix: 'www', filename: 'httpd.conf' },
      { prefix: 'nas', filename: 'vsftpd.conf' },
      { prefix: 'db', filename: 'mysql.cnf' },
      { prefix: 'mail', filename: 'postfix.conf' },
      { prefix: 'dns', filename: 'named.conf' },
    ];

    /** The one file in `/etc` that is not `passwd`, or null where the box keeps
     *  none. It names the file as well as reading it, so a config under the wrong
     *  name fails as loudly as a missing one — and a second config throws rather
     *  than being silently picked between. */
    const roleConfigOf = (
      fs: Directory,
    ): { readonly name: string; readonly file: FileEntry } | null => {
      // Files only: the role config is the one FILE a box keeps for what it is, and
      // /etc now also holds a directory for a config that follows a SERVICE instead.
      const found = [...dirAt(fs, 'etc').entries].filter(
        ([name, node]) => name !== 'passwd' && node.kind === 'file',
      );
      if (found.length > 1) {
        throw new Error(`expected one config in /etc, found ${found.length}`);
      }
      const entry = found[0];
      if (entry === undefined) return null;
      const [name, node] = entry;
      if (node.kind !== 'file') throw new Error(`/etc/${name} is not a file`);
      return { name, file: node };
    };

    const configOn = (
      prefix: string,
      octet: number,
    ): { readonly name: string; readonly file: FileEntry } => {
      const config = roleConfigOf(buildRemoteHostFs(ESSID, namedHost(prefix, octet)));
      if (config === null) throw new Error(`no /etc config on ${prefix}-${octet}`);
      return config;
    };

    /** The port `service` answers on for a named box, or null when nothing is
     *  listening for it there. */
    const portOf = (prefix: string, octet: number, service: string): number | null => {
      const running = hostServices(ESSID, namedHost(prefix, octet)).find(
        ({ spec }) => spec.service === service,
      );
      return running === undefined ? null : running.port;
    };

    it('names the file for the daemon the box is built around', () => {
      ROLE_FILES.forEach(({ prefix, filename }) => {
        expect(configOn(prefix, 40).name).toBe(filename);
      });
    });

    it('lets a guest read it, while /etc/passwd stays out of reach', () => {
      // The point of the file is that a player at the LOWEST tier can tell what a
      // box is for. That is only a wider door if it opens onto what passwd holds —
      // the account names and inline hashes the cracking curve exists to make you
      // earn — so both halves are asserted together, on the whole permission value
      // rather than on one list. Never executable: a config is data, like a page.
      const tree = buildRemoteHostFs(ESSID, namedHost('db', 11));
      const config = roleConfigOf(tree);
      if (config === null) throw new Error('no /etc config on db-11');

      expect(config.file.owner).toBe('root');
      expect(config.file.perms).toEqual({
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: [],
      });
      const passwd = dirAt(tree, 'etc').entries.get('passwd');
      if (passwd?.kind !== 'file') throw new Error('missing /etc/passwd');
      expect(passwd.perms.read).not.toContain('guest');
    });

    /** What a role keeps across a LAN's worth of addresses. The file is drawn per
     *  box, so one host reads one entry of the pool: anything asserted about a role's
     *  config has to be asserted over the population, or a pool entry a player can
     *  meet is one no test has ever read. */
    const configsAcross = (
      prefix: string,
    ): readonly { readonly hostname: string; readonly content: string }[] =>
      OCTETS.map((octet) => ({
        hostname: `${prefix}-${octet}`,
        content: configOn(prefix, octet).file.content,
      }));

    it('writes it about THIS box, and finishes writing it, on every box of every role', () => {
      // Two claims that share a sweep. Naming the host is what makes the file recon
      // rather than a label — the hostname is already on the scan, so a file that
      // reads the same everywhere taught the player nothing. And a field the fill
      // does not know about renders as a literal brace pair, which reads as broken
      // furniture; that is also what holds the deliberate omission of the box's
      // account name, since there is no fill for it and adding one to a template
      // surfaces here rather than quietly leaking what /etc/passwd guards.
      ROLE_FILES.forEach(({ prefix }) => {
        configsAcross(prefix).forEach(({ hostname, content }) => {
          expect(content).toContain(hostname);
          expect(content).not.toMatch(/\{\{[a-z]+\}\}/);
        });
      });
    });

    it('does not hand every box of a role the same file', () => {
      // The draw is seeded per box. Seeded by anything the box does not vary, every
      // camera in the world keeps a byte-identical config and the pool is decoration
      // — so compare the files with each host's own name taken back out of them.
      ROLE_FILES.forEach(({ prefix }) => {
        const shapes = new Set(
          configsAcross(prefix).map(({ hostname, content }) => content.split(hostname).join('')),
        );

        expect(shapes.size).toBeGreaterThan(1);
      });
    });

    it('states the port the box really publishes on, so the file cannot contradict a scan', () => {
      // A webserver answering on 8080 must not keep a config claiming :80. The
      // alt-port hosts are what prove the port is read off the box rather than baked
      // into the template.
      const alt = OCTETS.map((octet) => ({ octet, port: portOf('www', octet, 'http') })).find(
        ({ port }) => port !== null && port !== 80,
      );
      if (alt === undefined || alt.port === null) throw new Error('no alt-port webserver in sample');

      expect(configOn('www', alt.octet).file.content).toContain(String(alt.port));
    });

    it('carries the config for what the box IS, not for what it happens to run', () => {
      // Unlike /var/log/vsftpd.log, which follows its daemon: a log on a box that
      // never ran one claims something happened. A config claims only what the box
      // is set up to be — which is the whole reason a `db-` box can carry one before
      // any mysqld exists in the world to run.
      const silent = OCTETS.find((octet) => portOf('www', octet, 'http') === null);
      if (silent === undefined) throw new Error('no non-publishing webserver in sample');

      expect(configOn('www', silent).name).toBe('httpd.conf');
      expect(configOn('www', silent).file.content).toContain('80');
      expect(configOn('db', 11).name).toBe('mysql.cnf');
    });

    it('states the box in the words of the server that box actually runs', () => {
      // The file, the COMMAND column and `/usr/sbin` have to name ONE program. A
      // generated webserver runs nginx — its pidfile says so, which is what `ps`
      // prints and what `systemctl` resolves a unit by — so its config is written
      // the way nginx writes one: `server_name <host>;`, not apache's bare
      // `ServerName <host>`. Asserted across the population because the template is
      // drawn per box, so a pool entry no host in the sample happened to draw is one
      // no test has ever read.
      configsAcross('www').forEach(({ hostname, content }) => {
        expect(content).toContain(`server_name ${hostname};`);
      });
    });

    it('never names a web server the box does not carry', () => {
      // `apache2` is real in this world — it is the second front door a PLAYER can
      // apt-install on their own box — which is exactly why a generated box must not
      // claim it. A player who cats the config, runs `ps` and lists `/usr/sbin` gets
      // one answer or three, and the config was the odd one out.
      const apacheTells = ['apache2', 'ServerRoot', 'VirtualHost', 'DocumentRoot'];

      configsAcross('www').forEach(({ hostname, content }) => {
        apacheTells.forEach((tell) => {
          expect({ hostname, names: content.includes(tell) }).toEqual({ hostname, names: false });
        });
      });
    });

    it('leaves a host whose name claims nothing without one', () => {
      // `host-42` matches no role, the same fallback placement takes. It is also
      // what every test above this block stands on: their boxes are named that way,
      // so an unconditional config file would have moved all of them.
      expect(roleConfigOf(buildRemoteHostFs(ESSID, host(42)))).toBeNull();
    });
  });
});
