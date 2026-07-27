import { describe, expect, it } from 'vitest';
import type { Directory, FileNode } from '../filesystem/types';
import {
  buildDeepGatewayBaseFs,
  buildInnerGatewayBaseFs,
  buildRouterBaseFsFromIdentity,
  buildSwitchBaseFs,
  ROUTER_HOSTNAMES,
  seedDeepGatewayAdminPw,
  seedInnerGatewayAdminPw,
  seedApGatewayAdminPw,
  seedApGatewayHasSsh,
  seedApGatewayHostname,
} from './routerFs';
import { computeInnerGatewayId } from '../identity/router';
import { workstationGuestPassword } from './workstationFs';
import {
  LOCALHOST_PREINSTALLED_TOOLS,
  SYSTEM_DAEMON_NAMES,
  SYSTEM_UTILITY_NAMES,
} from './binaries';
import { md5 } from './md5';
import { readOpenPorts } from '../services/pidfile';
import { parseForwardRules } from '../network/iptablesRules';
import { parseAclDenies } from '../network/switchAcl';

// Two distinct valid 64-hex pubkeys — the owner-key seed source.
// Owner keys — still what a DEEP gateway (below the shared LAN) and a workstation
// seed from.
const SEED_A = '1'.repeat(64);
// The networks an AP gateway, an inner gateway and a switch seed from: those boxes
// stand on the access point's LAN, so they belong to the ESSID, not to a player.
const ESSID_A = 'BREW-AND-CODE';
const ESSID_B = 'NAKATOMI-PLAZA';

// A representative already-hashed router admin password (md5-shaped).
const ADMIN_HASH = 'deadbeefdeadbeefdeadbeefdeadbeef';

/**
 * Story 5.1: the router's root ("admin") password and its sshd presence are
 * seeded from the owner key ALONE, so the SERVER can recover them cross-player
 * without the owner's config (mirroring `workstationGuestPassword`). These pin
 * the seed contract through the public functions, not internals.
 */
describe('seedApGatewayAdminPw', () => {
  it('is deterministic: same owner key yields the same admin password', () => {
    expect(seedApGatewayAdminPw(ESSID_A)).toBe(seedApGatewayAdminPw(ESSID_A));
  });

  it('is owner-key specific — different identities get different admin passwords', () => {
    expect(seedApGatewayAdminPw(ESSID_A)).not.toBe(seedApGatewayAdminPw(ESSID_B));
  });

  it('returns a non-empty weak password string', () => {
    expect(seedApGatewayAdminPw(ESSID_A)).toMatch(/^\S+$/);
  });

  it('always returns a non-empty password across many networks (every pool entry is real)', () => {
    // Sweeps enough networks to land on every pool word — an emptied pool entry would
    // surface as a blank password for whichever network selects it.
    const networks = Array.from({ length: 40 }, (_unused, index) => `NET-${index}`);
    networks.forEach((essid) => expect(seedApGatewayAdminPw(essid)).toMatch(/^\S+$/));
  });

  it('draws from a DISTINCT namespace than the workstation guest password', () => {
    // Same owner key, but the router admin pw must not be coupled to the
    // workstation guest pw — they seed from separate `router-admin-` /
    // `workstation-` streams (and disjoint pools), so they never coincide.
    expect(seedApGatewayAdminPw(ESSID_A)).not.toBe(workstationGuestPassword(SEED_A));
  });
});

describe('seedApGatewayHasSsh', () => {
  it('is deterministic for a given owner key', () => {
    expect(seedApGatewayHasSsh(ESSID_A)).toBe(seedApGatewayHasSsh(ESSID_A));
  });

  it('is pinned true this story — every router runs its own sshd', () => {
    // The decision-3 boolean is pinned to 1.0 for Story 5.1: routers always
    // bear sshd:22. Sampling many keys catches any threshold below 1.0.
    const keys = Array.from({ length: 32 }, (_unused, index) =>
      index.toString(16).padStart(2, '0').repeat(32),
    );
    keys.forEach((key) => expect(seedApGatewayHasSsh(key)).toBe(true));
  });
});

/**
 * The AP gateway gets a real name — one of a ported pool — seeded from the ESSID
 * ALONE (the same recoverable-from-the-ESSID contract as its admin pw), so the
 * cross-player scan/auth log lines can name the gateway without reading its FS and
 * without knowing which occupant was looking. Pinned through the public function +
 * the exported pool.
 */
describe('seedApGatewayHostname', () => {
  it('is deterministic: the same ESSID yields the same hostname', () => {
    expect(seedApGatewayHostname(ESSID_A)).toBe(seedApGatewayHostname(ESSID_A));
  });

  it('always picks a real member of the router hostname pool (no blank/out-of-pool name)', () => {
    // Sweeps enough networks to exercise many pool slots; a deleted pool entry or an
    // out-of-range index would surface as a non-member here.
    const networks = Array.from({ length: 40 }, (_unused, index) => `NET-${index}`);
    networks.forEach((essid) => expect(ROUTER_HOSTNAMES).toContain(seedApGatewayHostname(essid)));
  });

  it('spreads across the pool — different networks are not all the same gateway name', () => {
    const networks = Array.from({ length: 40 }, (_unused, index) => `NET-${index}`);
    expect(new Set(networks.map((essid) => seedApGatewayHostname(essid))).size).toBeGreaterThan(1);
  });

  it('is pinned per network (golden) — locks the ap-gw-host- namespace, the pool and the pick', () => {
    // Captured from the seeded generator. Distinct from the `ap-gw-admin-` /
    // `ap-gw-ssh-` streams: mutating the namespace string, the pool, or the pick
    // index shifts these values and fails the golden.
    expect(seedApGatewayHostname(ESSID_A)).toBe('fw-dmz');
    expect(seedApGatewayHostname(ESSID_B)).toBe('net-gateway');
  });
});

/**
 * Story 5b: an inner gateway is a SECOND router on the player's own LAN, fronting
 * a deeper layer. Its admin password is seeded from the owner key AND its LAN octet
 * (a SEPARATE `inner-gw-admin-` stream from the edge router's `router-admin-`), so
 * the two routers never share a credential by construction.
 */
describe('seedInnerGatewayAdminPw', () => {
  it('is deterministic for the same ESSID + octet', () => {
    expect(seedInnerGatewayAdminPw(ESSID_A, 25)).toBe(seedInnerGatewayAdminPw(ESSID_A, 25));
  });

  it('varies by octet, so two inner gateways on one LAN do not share a credential', () => {
    const octets = [2, 25, 70, 130, 200, 245];
    const passwords = new Set(octets.map((octet) => seedInnerGatewayAdminPw(ESSID_A, octet)));
    expect(passwords.size).toBeGreaterThan(1);
  });

  it('always returns a non-empty weak password across many networks', () => {
    const networks = Array.from({ length: 40 }, (_unused, index) => `NET-${index}`);
    networks.forEach((essid) => expect(seedInnerGatewayAdminPw(essid, 25)).toMatch(/^\S+$/));
  });

  it('is pinned per ESSID+octet (golden) — locks the inner-gw-admin- namespace, pool and pick', () => {
    // Captured from the seeded generator; hardcoded (not recomputed via the fn) so a
    // mutated namespace/pool/index shifts the value and fails here deterministically.
    expect(seedInnerGatewayAdminPw(ESSID_A, 25)).toBe('netgear');
  });
});

/**
 * Story 5b: the inner gateway reuses the edge router's root-only toolkit
 * (`buildRouterBaseFsFromIdentity`), but its admin hash is the octet-seeded inner
 * credential (never the edge's) and its sshd is always up — an inner gateway is a
 * reachable target by design.
 */
describe('buildInnerGatewayBaseFs', () => {
  it('is a root-only FS whose admin hash is the octet-seeded inner-gateway pw', () => {
    const rows = passwdRows(buildInnerGatewayBaseFs(ESSID_A, 25));
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('root');
    expect(rows[0]![1]).toBe(md5(seedInnerGatewayAdminPw(ESSID_A, 25)));
  });

  it('runs sshd:22 — an inner gateway is a reachable target by design', () => {
    expect(readOpenPorts(buildInnerGatewayBaseFs(ESSID_A, 25))).toEqual([
      { port: 22, service: 'ssh' },
    ]);
  });

  it('seeds rules.v4 with no active forward (opt-in default, same as the edge router)', () => {
    const rules = fileAt(buildInnerGatewayBaseFs(ESSID_A, 25), ['etc', 'iptables'], 'rules.v4');
    expect(parseForwardRules(rules)).toEqual([]);
  });

  it('is deterministic: same key+octet yields a byte-identical tree', () => {
    expect(buildInnerGatewayBaseFs(ESSID_A, 25)).toEqual(buildInnerGatewayBaseFs(ESSID_A, 25));
  });
});

/**
 * Story 5b: a switch is the SECOND inner-gateway device type — the router's
 * mechanical opposite. It reuses the inner-gateway root-only toolkit and its
 * octet-seeded admin credential, but instead of a NAT `rules.v4` it owns an
 * `/etc/switch/acl.conf` access-control list. A switch forwards nothing, so the
 * segment behind it is dark from upstream by construction (no forward table at all).
 */
describe('buildSwitchBaseFs', () => {
  it('is a root-only FS whose admin hash is the octet-seeded inner-gateway pw', () => {
    const rows = passwdRows(buildSwitchBaseFs(ESSID_A, 80));
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('root');
    expect(rows[0]![1]).toBe(md5(seedInnerGatewayAdminPw(ESSID_A, 80)));
  });

  it('runs sshd:22 — a switch is a reachable target by design', () => {
    expect(readOpenPorts(buildSwitchBaseFs(ESSID_A, 80))).toEqual([{ port: 22, service: 'ssh' }]);
  });

  it('seeds /etc/switch/acl.conf with a documented default-allow policy and one active deny', () => {
    const acl = fileAt(buildSwitchBaseFs(ESSID_A, 80), ['etc', 'switch'], 'acl.conf');
    expect(acl.startsWith('#')).toBe(true); // documented for the player
    expect(parseAclDenies(acl)).toEqual([8080]); // one seeded deny to filter then open later
  });

  it('makes acl.conf root-only readable/writable and not executable (the owner edits it as root)', () => {
    const node = dirAt(buildSwitchBaseFs(ESSID_A, 80), 'etc', 'switch').entries.get('acl.conf');
    if (node?.kind !== 'file') throw new Error('missing acl.conf');
    expect(node.owner).toBe('root');
    expect(node.perms).toEqual({ read: ['root'], write: ['root'], execute: [] });
  });

  it('forwards nothing — has NO /etc/iptables/rules.v4 (dark from upstream by construction)', () => {
    expect(dirAt(buildSwitchBaseFs(ESSID_A, 80), 'etc').entries.has('iptables')).toBe(false);
  });

  it('is deterministic: same key+octet yields a byte-identical tree', () => {
    expect(buildSwitchBaseFs(ESSID_A, 80)).toEqual(buildSwitchBaseFs(ESSID_A, 80));
  });
});

/**
 * A DEEP gateway hangs off a deeper layer, behind an inner gateway. Its admin
 * password is seeded from the owner key, its PARENT gateway's machine_id, AND its
 * octet, so two deep gateways at the same octet behind different parents never
 * share a credential — the chain (and later, branches) stay independent.
 */
const PARENT_GW = computeInnerGatewayId(ESSID_A, 25);
const OTHER_PARENT_GW = computeInnerGatewayId(ESSID_A, 70);

describe('seedDeepGatewayAdminPw', () => {
  it('is deterministic for the same owner key + parent + octet', () => {
    expect(seedDeepGatewayAdminPw(SEED_A, PARENT_GW, 50)).toBe(
      seedDeepGatewayAdminPw(SEED_A, PARENT_GW, 50),
    );
  });

  it('varies by PARENT, so two deep gateways behind different parents differ', () => {
    const parents = [PARENT_GW, OTHER_PARENT_GW, computeInnerGatewayId(ESSID_B, 25)];
    const passwords = new Set(parents.map((parent) => seedDeepGatewayAdminPw(SEED_A, parent, 50)));
    expect(passwords.size).toBeGreaterThan(1);
  });

  it('varies by octet behind the same parent', () => {
    const octets = [2, 50, 120, 200, 245];
    const passwords = new Set(octets.map((octet) => seedDeepGatewayAdminPw(SEED_A, PARENT_GW, octet)));
    expect(passwords.size).toBeGreaterThan(1);
  });

  it('always returns a non-empty password across many identities (every pool entry is real)', () => {
    const keys = Array.from({ length: 40 }, (_unused, index) =>
      (index + 1).toString(16).padStart(2, '0').repeat(32),
    );
    keys.forEach((key) => expect(seedDeepGatewayAdminPw(key, PARENT_GW, 50)).toMatch(/^\S+$/));
  });
});

describe('buildDeepGatewayBaseFs', () => {
  it('is a root-only FS whose admin hash is the deep-gateway pw seeded off parent + octet', () => {
    const rows = passwdRows(buildDeepGatewayBaseFs(SEED_A, PARENT_GW, 50));
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('root');
    expect(rows[0]![1]).toBe(md5(seedDeepGatewayAdminPw(SEED_A, PARENT_GW, 50)));
  });

  it('runs sshd:22 — a deep gateway is a reachable target by design', () => {
    expect(readOpenPorts(buildDeepGatewayBaseFs(SEED_A, PARENT_GW, 50))).toEqual([
      { port: 22, service: 'ssh' },
    ]);
  });

  it('seeds rules.v4 with no active forward (a router that forwards to its own deeper layer)', () => {
    const rules = fileAt(buildDeepGatewayBaseFs(SEED_A, PARENT_GW, 50), ['etc', 'iptables'], 'rules.v4');
    expect(parseForwardRules(rules)).toEqual([]);
  });

  it('is deterministic: same key+parent+octet yields a byte-identical tree', () => {
    expect(buildDeepGatewayBaseFs(SEED_A, PARENT_GW, 50)).toEqual(
      buildDeepGatewayBaseFs(SEED_A, PARENT_GW, 50),
    );
  });
});

/** Navigate to a directory by path segments; throws if any segment is missing
 *  or not a directory. */
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

const fileAt = (fs: Directory, dirSegments: readonly string[], name: string): string => {
  const node = dirAt(fs, ...dirSegments).entries.get(name);
  if (node?.kind !== 'file') throw new Error(`missing file ${[...dirSegments, name].join('/')}`);
  return node.content;
};

const passwdRows = (fs: Directory): readonly (readonly string[])[] =>
  fileAt(fs, ['etc'], 'passwd')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(':'));

/**
 * Story 5.1: the router is a DISTINCT machine bearing the public IP. Its base FS
 * is a root-only Linux box (no player/guest), a full toolchain so `nano`/`ls`/
 * `cat` resolve, a `/boot` brick surface, and `/etc/iptables/rules.v4` as the
 * single NAT source of truth — seeded with NO active forward (opt-in default).
 * sshd is present iff the caller says so (the seam decision-3 owns).
 */
describe('buildRouterBaseFsFromIdentity', () => {
  const routerFs = (overrides: Partial<{ adminPwHash: string; hasSsh: boolean }> = {}): Directory =>
    buildRouterBaseFsFromIdentity({ adminPwHash: ADMIN_HASH, hasSsh: true, ...overrides });

  it('has a root-ONLY /etc/passwd (no player, no guest) using the given admin hash', () => {
    const rows = passwdRows(routerFs());
    expect(rows).toHaveLength(1);
    const root = rows[0]!;
    expect(root[0]).toBe('root');
    expect(root[1]).toBe(ADMIN_HASH);
    expect(root[2]).toBe('0'); // uid
    expect(root[3]).toBe('0'); // gid
    expect(root[4]).toBe('root'); // gecos
    expect(root[5]).toBe('/root');
    expect(root[6]).toBe('/bin/bash');
  });

  it('contains the router skeleton and NO /home (no logged-in users)', () => {
    expect([...routerFs().entries.keys()].sort()).toEqual([
      'bin',
      'boot',
      'etc',
      'lib',
      'root',
      'tmp',
      'usr',
      'var',
    ]);
  });

  it('ships the full toolchain so nano/ls/cat and sshd resolve', () => {
    const fs = routerFs();
    expect([...dirAt(fs, 'bin').entries.keys()].sort()).toEqual([...SYSTEM_UTILITY_NAMES].sort());
    ['nano', 'ls', 'cat'].forEach((name) => expect(dirAt(fs, 'bin').entries.has(name)).toBe(true));
    expect([...dirAt(fs, 'usr', 'bin').entries.keys()].sort()).toEqual(
      [...LOCALHOST_PREINSTALLED_TOOLS].sort(),
    );
    expect([...dirAt(fs, 'usr', 'sbin').entries.keys()].sort()).toEqual(
      [...SYSTEM_DAEMON_NAMES].sort(),
    );
    expect(dirAt(fs, 'lib').entries.has('libpcre.so')).toBe(true); // ls/cat/nano link it
  });

  it('ships the /boot brick surface (vmlinuz + initrd.img)', () => {
    expect([...dirAt(routerFs(), 'boot').entries.keys()].sort()).toEqual(['initrd.img', 'vmlinuz']);
  });

  it('seeds /etc/iptables/rules.v4 with a comment header and NO active forward', () => {
    const fs = routerFs();
    const rules = fileAt(fs, ['etc', 'iptables'], 'rules.v4');
    expect(rules.startsWith('#')).toBe(true); // documented for the player
    expect(parseForwardRules(rules)).toEqual([]); // opt-in default: nothing exposed
  });

  it('makes rules.v4 root-only readable/writable and not executable (the owner edits it as root)', () => {
    const node = dirAt(routerFs(), 'etc', 'iptables').entries.get('rules.v4');
    if (node?.kind !== 'file') throw new Error('missing rules.v4');
    expect(node.owner).toBe('root');
    // Only root exists on the router; a config file is never executable.
    expect(node.perms).toEqual({ read: ['root'], write: ['root'], execute: [] });
  });

  it('ships empty /var/log/{auth,kern}.log for ssh-auth and scan logging', () => {
    const log = dirAt(routerFs(), 'var', 'log');
    ['auth.log', 'kern.log'].forEach((name) => {
      const node = log.entries.get(name);
      if (node?.kind !== 'file') throw new Error(`missing /var/log/${name}`);
      expect(node.content).toBe('');
    });
  });

  it('runs sshd:22 when hasSsh — readOpenPorts reports the ssh port', () => {
    const fs = routerFs({ hasSsh: true });
    expect(fileAt(fs, ['var', 'run'], 'sshd.pid')).toBe('sshd:port=22');
    expect(readOpenPorts(fs)).toEqual([{ port: 22, service: 'ssh' }]);
    const pidfile = dirAt(fs, 'var', 'run').entries.get('sshd.pid');
    if (pidfile?.kind !== 'file') throw new Error('missing sshd.pid');
    // World-readable so nmap/ps see the port; root writes it (the daemon is root).
    expect(pidfile.perms).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: [],
    });
  });

  it('has NO open ports when hasSsh is false (the seam toggles the pidfile off)', () => {
    const fs = routerFs({ hasSsh: false });
    expect(dirAt(fs, 'var', 'run').entries.size).toBe(0);
    expect(readOpenPorts(fs)).toEqual([]);
  });

  it('is deterministic: same inputs yield a byte-identical tree', () => {
    expect(routerFs()).toEqual(routerFs());
  });
});
