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

import type { Directory, FileNode } from '../filesystem/types';
import { createPrng } from './prng';
import { md5 } from './md5';
import { CRACK_CHANCE, drawPassword } from './passwordPools';
import {
  createBinaryEntries,
  LOCALHOST_PREINSTALLED_TOOLS,
  SERVICE_CONTROL_TOOLS,
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
import { ACCESS_LOG_PERMISSIONS } from '../logging/accessLog';
import { AUTH_LOG_PERMISSIONS } from '../logging/authLog';
import { KERN_LOG_PERMISSIONS } from '../logging/kernLog';
import { SNMPD_LOG_PERMISSIONS } from '../logging/snmpdLog';
import { RULES_V4_PERMISSIONS } from '../network/iptablesRules';
import { ACL_CONF_PERMISSIONS } from '../network/switchAcl';
import { SNMPD_CONF_PERMISSIONS, SNMPD_CONF_SEED } from '../snmp/conf';
import { formatSnmpdState, SNMPD_STATE_PERMISSIONS } from '../snmp/rwCommunity';
import { placementOf } from './rolePlacement';
import { daemonName, formatPidfileContent, PIDFILE_PERMISSIONS } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';

/** The AP gateway's root account plaintext password, seeded from the ESSID alone
 *  (the `ap-gw-admin-` namespace) so every occupant of the access point faces the
 *  same credential and the server can recover it for cross-player auth.
 *
 *  Crackable at the gateway rate — the best root odds in the game, and a rate
 *  somebody chose: before this the answer was whatever fraction of the router
 *  pool happened to also ship in the starter wordlist. */
export const seedApGatewayAdminPw = (essid: string): string =>
  drawPassword(createPrng(`ap-gw-admin-${essid}`), CRACK_CHANCE.gateway);

/** A device's read-write community, seeded in a namespace of its own.
 *
 *  SEPARATE from the `*-admin-` namespaces on purpose, and separate from the `*-snmp-`
 *  namespace that decides whether the agent runs at all. Sharing either would couple
 *  two rolls that must not agree: a community drawn from the admin seed would make SNMP
 *  a second name for a credential the player already holds, and one drawn from the
 *  placement seed would make every device that runs an agent hold a crackable community
 *  and every device that does not hold an uncrackable one — the same `next()` deciding
 *  both.
 *
 *  Drawn from the two EXISTING pools, so the shipped `passwords.txt` cracks these and
 *  no second wordlist or second progression has to be tuned. A community then reads
 *  like a password rather than like `private`, which is the accepted cost: real
 *  communities are arbitrary strings anyway. */
export const seedSnmpCommunity = (namespace: string): string =>
  drawPassword(createPrng(namespace), CRACK_CHANCE.community);

/** The AP gateway's read-write community, from the ESSID alone — every occupant of one
 *  access point faces the same string, the way they face the same admin password, and
 *  the server can recover it for a cross-player walk. */
export const seedApGatewayCommunity = (essid: string): string =>
  seedSnmpCommunity(`ap-gw-community-${essid}`);

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

/** The inner gateway's hostname, seeded from the ESSID AND its LAN octet (the
 *  `inner-gw-host-` namespace — SEPARATE from the edge router's `router-host-` so a
 *  second router on the LAN draws its name independently). It reuses the router name
 *  pool because an inner gateway is still a router. ESSID-keyed like everything else
 *  about the box: an inner gateway stands on the access point's LAN, so every
 *  occupant meets the same router under the same name. */
export const seedInnerGatewayHostname = (essid: string, octet: number): string =>
  createPrng(`inner-gw-host-${essid}:${octet}`).pick(ROUTER_HOSTNAMES);

/** Whether this AP's gateway runs `sshd`, seeded deterministically from the ESSID
 *  (the `ap-gw-ssh-` namespace). The rate is the router row's, read from the same
 *  table every other box's placement comes from — currently 1, so every gateway
 *  bears sshd:22. */
export const seedApGatewayHasSsh = (essid: string): boolean =>
  createPrng(`ap-gw-ssh-${essid}`).next() < placementOf('router', SERVICE_CATALOG.ssh);

/**
 * Whether a generated network device runs the SNMP agent, seeded deterministically per
 * device in its OWN namespace so no existing draw sequence moves — the same discipline
 * `ap-gw-ssh-` follows, and the reason adding this door leaves every octet the lease
 * allocator excludes exactly where it was.
 *
 * The rate is the DEVICE KIND's, read from the same table every other box's placement
 * comes from: a router usually answers, a switch nearly always does.
 *
 * The access point's own gateway takes NO draw and is not routed through here — see
 * `buildApGatewayBaseFs`.
 *
 * `<` rather than `<=` is not killable by any test: `next()` returns a float in [0, 1), so
 * telling the two apart needs a seed landing on exactly the rate. `seedApGatewayHasSsh`
 * above carries the same comparison and the same permanently surviving mutant — expect it
 * in every mutation report and do not chase it.
 */
const seedHasSnmp = (namespace: string, kind: 'router' | 'switch'): boolean =>
  createPrng(namespace).next() < placementOf(kind, SERVICE_CATALOG.snmp);


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
  identity: {
    readonly adminPwHash: string;
    readonly hasSsh: boolean;
    readonly hasSnmp: boolean;
    readonly snmpCommunityHash: string;
  },
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

  const runEntries: Record<string, FileNode> = {
    ...(identity.hasSsh
      ? { 'sshd.pid': file(formatPidfileContent(SERVICE_CATALOG.ssh, 22), PIDFILE_PERMISSIONS) }
      : {}),
    ...(identity.hasSnmp
      ? { 'snmpd.pid': file(formatPidfileContent(SERVICE_CATALOG.snmp, 161), PIDFILE_PERMISSIONS) }
      : {}),
  };

  // The agent's log and the agent's binary follow the agent, unlike the three logs
  // below which every gateway carries. A log seeded where no daemon runs would say a
  // daemon was there and left nothing, and a device advertising a port whose program
  // it does not have could not be stopped by the `systemctl` on it.
  const snmpLogEntries: Record<string, FileNode> = identity.hasSnmp
    ? { 'snmpd.log': file('', SNMPD_LOG_PERMISSIONS) }
    : {};
  // The agent's config follows the agent for the same reason, and one more: a conf on a
  // device with no agent invites a player to walk something that cannot answer.
  const snmpConfigEntries: Record<string, FileNode> = identity.hasSnmp
    ? {
        snmp: dir(
          { 'snmpd.conf': file(SNMPD_CONF_SEED, SNMPD_CONF_PERMISSIONS) },
          TRAVERSABLE_DIR,
        ),
      }
    : {};
  // The agent's SECRET follows the agent for the same reason its config and log do, and
  // one more: a read-write community seeded on a device with no agent is a string that
  // opens a door which is not there, sitting in a file only root can read — so nothing
  // in the world could ever tell you it was pointless.
  const snmpStateEntries: Record<string, FileNode> = identity.hasSnmp
    ? {
        snmp: dir(
          {
            'snmpd.conf': file(
              formatSnmpdState(identity.snmpCommunityHash),
              SNMPD_STATE_PERMISSIONS,
            ),
          },
          TRAVERSABLE_DIR,
        ),
      }
    : {};
  const daemonBinaries = identity.hasSnmp
    ? [...SYSTEM_DAEMON_NAMES, daemonName(SERVICE_CATALOG.snmp)]
    : [...SYSTEM_DAEMON_NAMES];

  return dir(
    {
      bin: dir(createBinaryEntries(SYSTEM_UTILITY_NAMES), TRAVERSABLE_DIR),
      boot: bootDir(),
      etc: dir(
        {
          passwd: file(passwd, PASSWD_FILE),
          ...snmpConfigEntries,
          ...configEntries,
        },
        TRAVERSABLE_DIR,
      ),
      lib: dir(createLibraryEntries(SYSTEM_LIBRARIES), TRAVERSABLE_DIR),
      root: dir({}, ROOT_DIR),
      tmp: dir({}, TMP_DIR),
      usr: dir(
        {
          bin: dir(createBinaryEntries([...LOCALHOST_PREINSTALLED_TOOLS, ...SERVICE_CONTROL_TOOLS]), TRAVERSABLE_DIR),
          sbin: dir(createBinaryEntries(daemonBinaries), TRAVERSABLE_DIR),
        },
        TRAVERSABLE_DIR,
      ),
      var: dir(
        {
          log: dir(
            {
              'access.log': file('', ACCESS_LOG_PERMISSIONS),
              'auth.log': file('', AUTH_LOG_PERMISSIONS),
              'kern.log': file('', KERN_LOG_PERMISSIONS),
              ...snmpLogEntries,
            },
            TRAVERSABLE_DIR,
          ),
          ...(Object.keys(snmpStateEntries).length === 0
            ? {}
            : { lib: dir(snmpStateEntries, TRAVERSABLE_DIR) }),
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
  readonly hasSnmp: boolean;
  readonly snmpCommunityHash: string;
}): Directory =>
  buildGatewayBaseFs(identity, {
    iptables: dir(
      { 'rules.v4': file(RULES_V4_SEED, RULES_V4_PERMISSIONS) },
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
    snmpCommunityHash: md5(seedApGatewayCommunity(essid)),
    hasSsh: seedApGatewayHasSsh(essid),
    // PINNED, and deliberately not read from the placement table. `ssh` can be pinned
    // there because `router: { ssh: 1 }` makes every gateway's roll succeed; the agent
    // cannot, because generated routers must roll at the router rate WHILE this one is
    // always on, and a single cell cannot say both. Routed through `placementOf` it
    // would go missing from 40% of players' own networks — the box this whole door aims
    // them at, absent for two players in five, decided by their ESSID.
    hasSnmp: true,
  });

/** The inner gateway root ("admin") password, seeded from the ESSID AND the gateway's
 *  LAN octet (the `inner-gw-admin-` namespace — SEPARATE from the edge router's
 *  `router-admin-`, so the two routers never share a credential). Crackable at the same
 *  gateway rate as the edge — descending a chain changes the route to a door, not the
 *  lock on it; the server recovers it from the ESSID, which fixes the octet. The
 *  credential is keyed to the BOX, not to whoever cracked it: one shared machine cannot
 *  have a different root password per occupant looking at it. */
export const seedInnerGatewayAdminPw = (essid: string, octet: number): string =>
  drawPassword(createPrng(`inner-gw-admin-${essid}:${octet}`), CRACK_CHANCE.gateway);

/** Build an inner gateway's base FS — the same root-only router toolkit as the edge
 *  (`buildRouterBaseFsFromIdentity`), but the admin password is the octet-seeded
 *  inner credential (never the edge's) and `sshd` is always up: an inner gateway is
 *  a reachable target by design. */
export const buildInnerGatewayBaseFs = (essid: string, octet: number): Directory =>
  buildRouterBaseFsFromIdentity({
    adminPwHash: md5(seedInnerGatewayAdminPw(essid, octet)),
    snmpCommunityHash: md5(seedSnmpCommunity(`inner-gw-community-${essid}:${octet}`)),
    hasSsh: true,
    hasSnmp: seedHasSnmp(`inner-gw-snmp-${essid}:${octet}`, 'router'),
  });

/** A DEEP gateway's root ("admin") password, seeded from its PARENT gateway's machine_id
 *  AND its octet (the `deep-gw-admin-` namespace — SEPARATE from the inner gateway's
 *  `inner-gw-admin-`). Keying on the parent keeps two deep gateways at the same octet
 *  behind different parents from ever sharing a credential; the server recovers it by
 *  walking the chain, which fixes the parent + octet. One password per door, not per
 *  player: two occupants cracking the same chain door are cracking the same box.
 *  Crackable at the same gateway rate as every other depth. */
export const seedDeepGatewayAdminPw = (parentMachineId: string, octet: number): string =>
  drawPassword(createPrng(`deep-gw-admin-${parentMachineId}:${octet}`), CRACK_CHANCE.gateway);

/** Build a deep gateway's base FS — the same root-only router toolkit as an inner
 *  gateway (NAT `rules.v4`, `sshd` always up: it forwards to its OWN deeper layer and
 *  is a reachable target by design), but the admin password is seeded off the unique
 *  deep discriminator (parent machine_id + octet), so it never aliases an inner
 *  gateway's credential even at a colliding octet. */
export const buildDeepGatewayBaseFs = (parentMachineId: string, octet: number): Directory =>
  buildRouterBaseFsFromIdentity({
    adminPwHash: md5(seedDeepGatewayAdminPw(parentMachineId, octet)),
    snmpCommunityHash: md5(seedSnmpCommunity(`deep-gw-community-${parentMachineId}:${octet}`)),
    hasSsh: true,
    hasSnmp: seedHasSnmp(`deep-gw-snmp-${parentMachineId}:${octet}`, 'router'),
  });

/** Build a DEEP switch's base FS — a deep gateway seeded as a switch rather than a
 *  router. It is the deep counterpart of `buildSwitchBaseFs` (an `acl.conf` box, no NAT
 *  `rules.v4`, so it forwards nothing and caps the chain) but its admin password is the
 *  deep discriminator (parent machine_id + octet), REUSING `seedDeepGatewayAdminPw` — a
 *  given slot is one kind, so the deep namespace is unambiguous, the same way the inner
 *  switch reuses `inner-gw-admin-`. */
export const buildDeepSwitchBaseFs = (parentMachineId: string, octet: number): Directory =>
  buildGatewayBaseFs(
    {
      adminPwHash: md5(seedDeepGatewayAdminPw(parentMachineId, octet)),
      snmpCommunityHash: md5(seedSnmpCommunity(`deep-sw-community-${parentMachineId}:${octet}`)),
      hasSsh: true,
      hasSnmp: seedHasSnmp(`deep-sw-snmp-${parentMachineId}:${octet}`, 'switch'),
    },
    { switch: dir({ 'acl.conf': file(ACL_CONF_SEED, ACL_CONF_PERMISSIONS) }, TRAVERSABLE_DIR) },
  );

/** Build a switch's base FS — the same root-only gateway toolkit as an inner
 *  gateway, with the octet-seeded inner credential (never the edge router's) and
 *  `sshd` always up, but instead of a NAT `rules.v4` it owns an `/etc/switch/acl.conf`
 *  access-control list. A switch forwards nothing, so the segment behind it is dark
 *  from upstream by construction (no forward table at all). */
export const buildSwitchBaseFs = (essid: string, octet: number): Directory =>
  buildGatewayBaseFs(
    {
      adminPwHash: md5(seedInnerGatewayAdminPw(essid, octet)),
      snmpCommunityHash: md5(seedSnmpCommunity(`inner-sw-community-${essid}:${octet}`)),
      hasSsh: true,
      hasSnmp: seedHasSnmp(`inner-sw-snmp-${essid}:${octet}`, 'switch'),
    },
    { switch: dir({ 'acl.conf': file(ACL_CONF_SEED, ACL_CONF_PERMISSIONS) }, TRAVERSABLE_DIR) },
  );
