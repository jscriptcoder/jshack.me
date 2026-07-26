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

/** The AP gateway's root account plaintext password, seeded from the ESSID alone
 *  (the `ap-gw-admin-` namespace) so every occupant of the access point faces the
 *  same credential and the server can recover it for cross-player auth. Weak by
 *  design (pool member): taking the gateway is a crack, not a birthright. */
export const seedApGatewayAdminPw = (essid: string): string =>
  createPrng(`ap-gw-admin-${essid}`).pick(ROUTER_ADMIN_PASSWORDS);

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

/** The AP gateway's hostname, seeded from the ESSID alone (the `ap-gw-host-`
 *  namespace — SEPARATE from `ap-gw-admin-`/`ap-gw-ssh-` so the name never
 *  correlates with the secrets). Server-recoverable from the ESSID without an FS
 *  read, so a cross-player log line can name the gateway it was written on. */
export const seedApGatewayHostname = (essid: string): string =>
  createPrng(`ap-gw-host-${essid}`).pick(ROUTER_HOSTNAMES);

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

/** Whether this AP's gateway runs `sshd`, seeded deterministically from the ESSID
 *  (the `ap-gw-ssh-` namespace). Currently always true (knob = 1.0). */
export const seedApGatewayHasSsh = (essid: string): boolean =>
  createPrng(`ap-gw-ssh-${essid}`).next() < ROUTER_SSH_PROBABILITY;

/** `/etc/iptables/rules.v4`: root reads + edits it (`nano`), no one else. Not an
 *  executable. The router has only a root account, so root-only is the boundary.
 *  The switch's `acl.conf` shares the same root-only boundary. */
const GATEWAY_CONFIG_PERMISSIONS: FilePermissions = { read: ['root'], write: ['root'], execute: [] };

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

/** The seeded `/etc/switch/acl.conf` — a documented header plus ONE active deny.
 *  A switch is DEFAULT-ALLOW (the mirror of the router's default-deny): every line
 *  names a port to BLOCK behind the switch, so a fresh switch exposes its whole
 *  segment except the seeded port. The active `deny` gives the player a port to
 *  filter — then re-open by deleting the line. */
const ACL_CONF_SEED = [
  '# /etc/switch/acl.conf — port access-control list',
  '# Default policy: ALLOW. One rule per line to block a port behind this switch:',
  '#   deny <port>',
  '# Delete a deny line to re-open that port to the segment behind the switch.',
  'deny 8080',
].join('\n');

/**
 * Build a gateway device's base filesystem from the IDENTITY the server can
 * RECONSTRUCT cross-player: the root password ALREADY HASHED and whether it runs
 * `sshd`. A gateway is a root-ONLY box (no player/guest accounts), with a full
 * toolchain (so `nano`/`ls`/`cat`/`sshd` resolve), a `/boot` brick surface, and
 * empty `/var/log/{auth,kern}.log`. The ONLY thing that differs between device
 * TYPES is the config subtree under `/etc` — a router's NAT `iptables/rules.v4`
 * vs a switch's `switch/acl.conf` — so the caller supplies it as `configEntries`.
 */
const buildGatewayBaseFs = (
  identity: { readonly adminPwHash: string; readonly hasSsh: boolean },
  configEntries: Record<string, FileNode>,
): Directory => {
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
          ...configEntries,
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
 * Build the router's base filesystem — the shared gateway skeleton (the caller
 * supplies the root hash + sshd flag, so the builder stays a pure function of
 * (root hash, sshd-on?)) plus `/etc/iptables/rules.v4` as the single NAT source of
 * truth. The owner-key→secret derivation lives in the composing layer.
 */
export const buildRouterBaseFsFromIdentity = (identity: {
  readonly adminPwHash: string;
  readonly hasSsh: boolean;
}): Directory =>
  buildGatewayBaseFs(identity, {
    iptables: dir(
      { 'rules.v4': file(RULES_V4_SEED, GATEWAY_CONFIG_PERMISSIONS) },
      TRAVERSABLE_DIR,
    ),
  });

/**
 * Build the AP gateway's base FS from the ESSID alone — the one place the
 * ESSID→secret derivation (admin password hash + sshd presence) lives, so every
 * path that needs the gateway's tree agrees byte-for-byte: the public scan/auth
 * (`materializeApGatewayFs`), each occupant's LAN view, and the server-side L2
 * walker for a write on it. Because the seed is the ESSID and not a player key,
 * every occupant of the access point materializes the SAME box. Callers replay the
 * gateway's journal over this base separately.
 */
export const buildApGatewayBaseFs = (essid: string): Directory =>
  buildRouterBaseFsFromIdentity({
    adminPwHash: md5(seedApGatewayAdminPw(essid)),
    hasSsh: seedApGatewayHasSsh(essid),
  });

/** The inner gateway root ("admin") password, seeded from the owner key AND the
 *  gateway's LAN octet (the `inner-gw-admin-` namespace — SEPARATE from the edge
 *  router's `router-admin-`, so the two routers never share a credential). Weak by
 *  design (pool member) for the future cracker; the server recovers it by
 *  regenerating the owner's LAN, which fixes the octet. */
export const seedInnerGatewayAdminPw = (ownerKeyHex: string, octet: number): string =>
  createPrng(`inner-gw-admin-${ownerKeyHex}:${octet}`).pick(ROUTER_ADMIN_PASSWORDS);

/** Build an inner gateway's base FS — the same root-only router toolkit as the edge
 *  (`buildRouterBaseFsFromIdentity`), but the admin password is the octet-seeded
 *  inner credential (never the edge's) and `sshd` is always up: an inner gateway is
 *  a reachable target by design. */
export const buildInnerGatewayBaseFs = (ownerKeyHex: string, octet: number): Directory =>
  buildRouterBaseFsFromIdentity({
    adminPwHash: md5(seedInnerGatewayAdminPw(ownerKeyHex, octet)),
    hasSsh: true,
  });

/** A DEEP gateway's root ("admin") password, seeded from the owner key, its PARENT
 *  gateway's machine_id, AND its octet (the `deep-gw-admin-` namespace — SEPARATE
 *  from the inner gateway's `inner-gw-admin-`). Keying on the parent keeps two deep
 *  gateways at the same octet behind different parents from ever sharing a
 *  credential; the server recovers it by walking the owner's chain, which fixes the
 *  parent + octet. Weak by design (pool member) for the future cracker. */
export const seedDeepGatewayAdminPw = (
  ownerKeyHex: string,
  parentMachineId: string,
  octet: number,
): string =>
  createPrng(`deep-gw-admin-${ownerKeyHex}:${parentMachineId}:${octet}`).pick(ROUTER_ADMIN_PASSWORDS);

/** Build a deep gateway's base FS — the same root-only router toolkit as an inner
 *  gateway (NAT `rules.v4`, `sshd` always up: it forwards to its OWN deeper layer and
 *  is a reachable target by design), but the admin password is seeded off the unique
 *  deep discriminator (owner key + parent machine_id + octet), so it never aliases an
 *  inner gateway's credential even at a colliding octet. */
export const buildDeepGatewayBaseFs = (
  ownerKeyHex: string,
  parentMachineId: string,
  octet: number,
): Directory =>
  buildRouterBaseFsFromIdentity({
    adminPwHash: md5(seedDeepGatewayAdminPw(ownerKeyHex, parentMachineId, octet)),
    hasSsh: true,
  });

/** Build a DEEP switch's base FS — a deep gateway seeded as a switch rather than a
 *  router. It is the deep counterpart of `buildSwitchBaseFs` (an `acl.conf` box, no NAT
 *  `rules.v4`, so it forwards nothing and caps the chain) but its admin password is the
 *  deep discriminator (owner key + parent machine_id + octet), REUSING
 *  `seedDeepGatewayAdminPw` — a given slot is one kind, so the deep namespace is
 *  unambiguous, the same way the inner switch reuses `inner-gw-admin-`. */
export const buildDeepSwitchBaseFs = (
  ownerKeyHex: string,
  parentMachineId: string,
  octet: number,
): Directory =>
  buildGatewayBaseFs(
    { adminPwHash: md5(seedDeepGatewayAdminPw(ownerKeyHex, parentMachineId, octet)), hasSsh: true },
    { switch: dir({ 'acl.conf': file(ACL_CONF_SEED, GATEWAY_CONFIG_PERMISSIONS) }, TRAVERSABLE_DIR) },
  );

/** Build a switch's base FS — the same root-only gateway toolkit as an inner
 *  gateway, with the octet-seeded inner credential (never the edge router's) and
 *  `sshd` always up, but instead of a NAT `rules.v4` it owns an `/etc/switch/acl.conf`
 *  access-control list. A switch forwards nothing, so the segment behind it is dark
 *  from upstream by construction (no forward table at all). */
export const buildSwitchBaseFs = (ownerKeyHex: string, octet: number): Directory =>
  buildGatewayBaseFs(
    { adminPwHash: md5(seedInnerGatewayAdminPw(ownerKeyHex, octet)), hasSsh: true },
    { switch: dir({ 'acl.conf': file(ACL_CONF_SEED, GATEWAY_CONFIG_PERMISSIONS) }, TRAVERSABLE_DIR) },
  );
