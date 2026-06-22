/**
 * Seeded router generators (Story 5.1). The player's home router is a DISTINCT
 * machine from their workstation: it bears the public IP, runs its own `sshd`,
 * and owns `/etc/iptables/rules.v4`. Like the workstation's guest password, the
 * router's root ("admin") password and its sshd presence are seeded from the
 * owner key ALONE, so the SERVER can recover them when resolving a cross-player
 * scan/auth — without the owner's config ever leaving their browser.
 *
 * The `router-admin-` / `router-ssh-` seed namespaces are SEPARATE from the
 * workstation's `workstation-` stream so the two boxes' secrets never correlate.
 */

import type { Directory, FileNode, FilePermissions } from '../filesystem/types';
import { createPrng } from './prng';
import { md5 } from './md5';
import {
  createBinaryEntries,
  LOCALHOST_PREINSTALLED_TOOLS,
  SYSTEM_DAEMON_NAMES,
  SYSTEM_UTILITY_NAMES,
} from './binaries';
import { createLibraryEntries, SYSTEM_LIBRARIES } from './libraries';
import {
  bootDir,
  dir,
  file,
  generatePasswd,
  PASSWD_FILE,
  ROOT_DIR,
  SHELL,
  TMP_DIR,
  TRAVERSABLE_DIR,
} from './baseFs';
import { AUTH_LOG_PERMISSIONS } from '../logging/authLog';
import { KERN_LOG_PERMISSIONS } from '../logging/kernLog';
import { formatPidfileContent } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';

/** Weak, router-default-style admin passwords — disjoint from the workstation
 *  guest pool so a router credential can never collide with a guest one. The
 *  seeded PRNG picks one; a future cracker matches against this set. */
const ROUTER_ADMIN_PASSWORDS: readonly string[] = [
  'admin',
  'admin123',
  'root123',
  'toor',
  'default',
  'cisco',
  'linksys',
  'netgear',
];

/** The router root account's plaintext password, seeded from the owner key alone
 *  (the `router-admin-` namespace) so the server can recover it for cross-player
 *  auth. Weak by design (pool member) for the future cracker. */
export const seedRouterAdminPw = (ownerKeyHex: string): string =>
  createPrng(`router-admin-${ownerKeyHex}`).pick(ROUTER_ADMIN_PASSWORDS);

/** Router display names, ported verbatim from the legacy generator
 *  (`hostnamesByRole.router`). A router is just another machine with NAT config,
 *  so it carries a real name rather than a universal `gateway`; the cross-player
 *  scan/auth log lines (Story 6) read this name to identify the router. */
export const ROUTER_HOSTNAMES: readonly string[] = [
  'router01',
  'gw-main',
  'border-gw',
  'core-rtr',
  'firewall01',
  'edge-rtr',
  'fw-dmz',
  'switch-core',
  'vpn-gw',
  'net-gateway',
  'wan-rtr',
  'pfsense01',
  'opnsense',
  'mikrotik01',
  'dist-rtr',
];

/** The router's hostname, seeded from the owner key alone (the `router-host-`
 *  namespace — SEPARATE from `router-admin-`/`router-ssh-` so the name never
 *  correlates with the secrets). Server-recoverable from `owner_key` without an
 *  FS read, so a cross-player log line can name the router it was written on. */
export const seedRouterHostname = (ownerKeyHex: string): string =>
  createPrng(`router-host-${ownerKeyHex}`).pick(ROUTER_HOSTNAMES);

/** The inner gateway's hostname, seeded from the owner key AND its LAN octet (the
 *  `inner-gw-host-` namespace — SEPARATE from the edge router's `router-host-` so a
 *  second router on the player's LAN draws its name independently). It reuses the
 *  router name pool because an inner gateway is still a router. */
export const seedInnerGatewayHostname = (ownerKeyHex: string, octet: number): string =>
  createPrng(`inner-gw-host-${ownerKeyHex}:${octet}`).pick(ROUTER_HOSTNAMES);

/** The fraction of routers that run their own `sshd`. Pinned to 1.0 for Story
 *  5.1 — every router bears `sshd:22`. The seam stays so a later story can make
 *  sshd presence vary per router without reshaping callers. */
const ROUTER_SSH_PROBABILITY = 1;

/** Whether this owner's router runs `sshd`, seeded deterministically from the
 *  owner key (the `router-ssh-` namespace). Currently always true (knob = 1.0). */
export const seedRouterHasSsh = (ownerKeyHex: string): boolean =>
  createPrng(`router-ssh-${ownerKeyHex}`).next() < ROUTER_SSH_PROBABILITY;

/** `/etc/iptables/rules.v4`: root reads + edits it (`nano`), no one else. Not an
 *  executable. The router has only a root account, so root-only is the boundary. */
const RULES_V4_PERMISSIONS: FilePermissions = { read: ['root'], write: ['root'], execute: [] };

/** A service pidfile under `/var/run`: world-readable (so `nmap`/`ps` see the
 *  port), root-written (the daemon runs as root). */
const PIDFILE_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

/** The seeded `/etc/iptables/rules.v4` — a documented header plus a commented
 *  example. Opt-in default: NO active forward (it parses to an empty table), so
 *  a fresh router exposes only its own `sshd` and the workstation stays dark. */
const RULES_V4_SEED = [
  '# /etc/iptables/rules.v4 — NAT port-forward table',
  '# One rule per line:  forward <public_port> to <internal_ip>:<internal_port>',
  '# Uncomment & edit to expose an internal host (nothing is forwarded by default):',
  '# forward 2222 to 10.0.0.10:22',
  '',
].join('\n');

/**
 * Build the router's base filesystem from the IDENTITY the server can
 * RECONSTRUCT cross-player: the router root password ALREADY HASHED (the caller
 * computes `md5(seedRouterAdminPw(ownerKey))`) and whether it runs `sshd` (the
 * caller computes `seedRouterHasSsh(ownerKey)`). Keeping both as inputs makes
 * the builder a pure function of (root hash, sshd-on?) — the owner-key→secret
 * derivation lives in the composing layer, and the sshd seam is directly
 * testable by toggling `hasSsh`.
 *
 * A router is a root-ONLY box (no player/guest accounts), with a full toolchain
 * (so `nano`/`ls`/`cat`/`sshd` resolve), a `/boot` brick surface, and
 * `/etc/iptables/rules.v4` as the single NAT source of truth.
 */
export const buildRouterBaseFsFromIdentity = (identity: {
  readonly adminPwHash: string;
  readonly hasSsh: boolean;
}): Directory => {
  const passwd = generatePasswd([
    {
      username: 'root',
      passwordHash: identity.adminPwHash,
      uid: 0,
      gid: 0,
      gecos: 'root',
      home: '/root',
      shell: SHELL,
    },
  ]);

  const runEntries: Record<string, FileNode> = identity.hasSsh
    ? { 'sshd.pid': file(formatPidfileContent(SERVICE_CATALOG.ssh, 22), PIDFILE_PERMISSIONS) }
    : {};

  return dir(
    {
      bin: dir(createBinaryEntries(SYSTEM_UTILITY_NAMES), TRAVERSABLE_DIR),
      boot: bootDir(),
      etc: dir(
        {
          passwd: file(passwd, PASSWD_FILE),
          iptables: dir({ 'rules.v4': file(RULES_V4_SEED, RULES_V4_PERMISSIONS) }, TRAVERSABLE_DIR),
        },
        TRAVERSABLE_DIR,
      ),
      lib: dir(createLibraryEntries(SYSTEM_LIBRARIES), TRAVERSABLE_DIR),
      root: dir({}, ROOT_DIR),
      tmp: dir({}, TMP_DIR),
      usr: dir(
        {
          bin: dir(createBinaryEntries(LOCALHOST_PREINSTALLED_TOOLS), TRAVERSABLE_DIR),
          sbin: dir(createBinaryEntries(SYSTEM_DAEMON_NAMES), TRAVERSABLE_DIR),
        },
        TRAVERSABLE_DIR,
      ),
      var: dir(
        {
          log: dir(
            {
              'auth.log': file('', AUTH_LOG_PERMISSIONS),
              'kern.log': file('', KERN_LOG_PERMISSIONS),
            },
            TRAVERSABLE_DIR,
          ),
          run: dir(runEntries, TRAVERSABLE_DIR),
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );
};

/**
 * Build the router's base FS from the OWNER KEY alone — the one place the
 * owner-key→secret derivation (admin password hash + sshd presence) lives, so
 * every path that needs a player's router tree agrees byte-for-byte: the public
 * scan/auth (`materializeRouterFs`), the client's own-router FS view, and the
 * server-side L2 walker for an own-router write. Callers replay the router's
 * journal over this base separately.
 */
export const buildRouterBaseFs = (ownerKeyHex: string): Directory =>
  buildRouterBaseFsFromIdentity({
    adminPwHash: md5(seedRouterAdminPw(ownerKeyHex)),
    hasSsh: seedRouterHasSsh(ownerKeyHex),
  });
