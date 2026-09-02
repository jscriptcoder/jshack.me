import { ownAgentCommunity } from '../snmp/ownAgent';
import { describe, expect, it } from 'vitest';
import type { Directory, FileNode } from '../filesystem/types';
import {
  buildApGatewayBaseFs,
  buildDeepGatewayBaseFs,
  buildDeepSwitchBaseFs,
  buildInnerGatewayBaseFs,
  buildRouterBaseFsFromIdentity,
  buildSwitchBaseFs,
  ROUTER_HOSTNAMES,
  seedDeepGatewayAdminPw,
  seedInnerGatewayAdminPw,
  seedApGatewayAdminPw,
  seedApGatewayCommunity,
  seedApGatewayHasSsh,
  seedApGatewayHostname,
} from './routerFs';
import { computeInnerGatewayId } from '../identity/router';
import { workstationGuestPassword } from './workstationFs';
import {
  LOCALHOST_PREINSTALLED_TOOLS,
  SERVICE_CONTROL_TOOLS,
  SYSTEM_DAEMON_NAMES,
  SYSTEM_UTILITY_NAMES,
} from './binaries';
import { md5 } from './md5';
import { readOpenPorts, type OpenPort } from '../services/pidfile';
import { parseForwardRules } from '../network/iptablesRules';
import { parseAclDenies } from '../network/switchAcl';
import { parseSnmpdConf, readSnmpdConf } from '../snmp/conf';
import { DEFAULT_WORDLIST } from '../wordlist/defaultWordlist';

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
const COMMUNITY_HASH = 'feedfacefeedfacefeedfacefeedface';

/**
 * Story 5.1: the router's root ("admin") password and its sshd presence are
 * seeded from the owner key ALONE, so the SERVER can recover them cross-player
 * without the owner's config (mirroring `workstationGuestPassword`). These pin
 * the seed contract through the public functions, not internals.
 */
describe('seedApGatewayCommunity', () => {
  it('gives one access point one community, however many times it is asked', () => {
    expect(seedApGatewayCommunity(ESSID_A)).toBe(seedApGatewayCommunity(ESSID_A));
  });

  it('gives two access points different ones', () => {
    expect(seedApGatewayCommunity(ESSID_A)).not.toBe(seedApGatewayCommunity(ESSID_B));
  });

  it('is nothing to do with the same gateway root password', () => {
    // The whole point of this door. A community that fell out of the admin seed would
    // make SNMP a second name for a credential the player already has, instead of an
    // independent way in: crack one, hold the other, and neither tells you about its
    // twin.
    expect(seedApGatewayCommunity(ESSID_A)).not.toBe(seedApGatewayAdminPw(ESSID_A));
  });
});

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

  it('runs sshd on every router — the reachability a forward and a pivot rest on', () => {
    // The rate lives in the role placement table, pinned at 1: a gateway you might
    // not be able to reach would make a forward a coin toss and strand whatever
    // hangs behind it. Sampling many keys catches any threshold below 1.0.
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

  it('is pinned per ESSID+octet (golden) — locks the inner-gw-admin- namespace, roll and pick', () => {
    // Captured from the seeded generator; hardcoded (not recomputed via the fn) so a
    // mutated namespace/pool/index shifts the value and fails here deterministically.
    //
    // This network's gateway drew the UNCRACKABLE half — somebody changed the
    // factory password — which is why the value does not read like a router. It
    // also pins the roll: were the crack chance mutated to always take the
    // crackable branch, this would come back a router default instead.
    expect(seedInnerGatewayAdminPw(ESSID_A, 25)).toBe('copperfield7');
  });
});

/**
 * Story 5b: the inner gateway reuses the edge router's root-only toolkit
 * (`buildRouterBaseFsFromIdentity`), but its admin hash is the octet-seeded inner
 * credential (never the edge's) and its sshd is always up — an inner gateway is a
 * reachable target by design.
 */
/** A device's port table minus the SNMP agent — everything it bears BY DESIGN rather
 *  than by roll. The agent is placed per device at its kind's rate, so pinning it into
 *  a fixture's expected table would turn these sshd claims into statements about one
 *  device's roll; the rate itself is measured across a population further down. */
const portsByDesign = (fs: Directory): readonly OpenPort[] =>
  readOpenPorts(fs).filter((openPort) => openPort.service !== 'snmp');

describe('buildInnerGatewayBaseFs', () => {
  it('is a root-only FS whose admin hash is the octet-seeded inner-gateway pw', () => {
    const rows = passwdRows(buildInnerGatewayBaseFs(ESSID_A, 25));
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('root');
    expect(rows[0]![1]).toBe(md5(seedInnerGatewayAdminPw(ESSID_A, 25)));
  });

  it('runs sshd:22 — an inner gateway is a reachable target by design', () => {
    expect(portsByDesign(buildInnerGatewayBaseFs(ESSID_A, 25))).toEqual([
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
    expect(portsByDesign(buildSwitchBaseFs(ESSID_A, 80))).toEqual([{ port: 22, service: 'ssh' }]);
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
 * A DEEP gateway hangs off a deeper layer, behind an inner gateway. Its admin password
 * is seeded from its PARENT gateway's machine_id AND its octet, so two deep gateways at
 * the same octet behind different parents never share a credential — the chain (and
 * later, branches) stay independent. One password per door rather than per player: the
 * chain descends from a gateway the access point owns, so two occupants cracking the
 * same door are cracking the same box.
 */
const PARENT_GW = computeInnerGatewayId(ESSID_A, 25);
const OTHER_PARENT_GW = computeInnerGatewayId(ESSID_A, 70);

describe('seedDeepGatewayAdminPw', () => {
  it('is deterministic for the same parent + octet', () => {
    expect(seedDeepGatewayAdminPw(PARENT_GW, 50)).toBe(seedDeepGatewayAdminPw(PARENT_GW, 50));
  });

  it('varies by PARENT, so two deep gateways behind different parents differ', () => {
    const parents = [PARENT_GW, OTHER_PARENT_GW, computeInnerGatewayId(ESSID_B, 25)];
    const passwords = new Set(parents.map((parent) => seedDeepGatewayAdminPw(parent, 50)));
    expect(passwords.size).toBeGreaterThan(1);
  });

  it('varies by octet behind the same parent', () => {
    const octets = [2, 50, 120, 200, 245];
    const passwords = new Set(octets.map((octet) => seedDeepGatewayAdminPw(PARENT_GW, octet)));
    expect(passwords.size).toBeGreaterThan(1);
  });

  it('always returns a non-empty password across many doors (every pool entry is real)', () => {
    const octets = Array.from({ length: 40 }, (_unused, index) => index + 2);
    octets.forEach((octet) => expect(seedDeepGatewayAdminPw(PARENT_GW, octet)).toMatch(/^\S+$/));
  });
});

describe('the gateway difficulty curve (a gateway is the best root target in the game)', () => {
  /**
   * A gateway's root password is the pre-vulnerability route to root: an NPC's
   * root account almost always holds, so the door a player is meant to hunt is
   * the router. That intent is a RATE, and a rate is only observable across a
   * population — one gateway proves nothing.
   *
   * The rate must also be DELIBERATE. Before this behaviour existed a gateway
   * cracked about a quarter of the time purely because two words of the router
   * pool happened to ship in the starter wordlist — a number nobody chose, and
   * one that would drift with any unrelated edit to either list.
   *
   * 2000 doors per gateway kind, deterministic: these counts are fixed, not
   * sampled. All three kinds are measured because they are three separate call
   * sites, and a knob applied to only one of them is exactly the defect a single
   * population test would miss.
   *
   * The size is not arbitrary. These seeds differ by a few characters, so their
   * FNV-1a hashes are correlated and the observed rate converges far slower than
   * an independent sample would: at 400 doors the three kinds spread 35.8% /
   * 43.5% / 37.0% around a 40% knob, at 2000 they sit 37.0% / 38.9% / 38.7%, and
   * only by 20000 do they reach 39.4-40.0%. The knob is honest — a fresh
   * stream's first draw is uniform to within 0.3pp when the seeds are unrelated.
   * A smaller population here would be measuring the seed strings, not the knob.
   */
  const NETWORKS: readonly string[] = Array.from(
    { length: 2000 },
    (_unused, index) => `NET-${index}`,
  );

  /** Pubkey-SHAPED seeds rather than `NET-n` strings: a player's own agent is keyed
   *  by the owner's 64-hex public key, and measuring the knob against seeds of a
   *  different shape would be measuring the wrong population. */
  const OWNER_KEYS: readonly string[] = Array.from({ length: 2000 }, (_unused, index) =>
    index.toString(16).padStart(64, '0'),
  );

  /** Spread the doors across the addressable range rather than clustering them
   *  on one octet, so a per-octet artefact cannot masquerade as the rate. */
  const octetFor = (index: number): number => 2 + (index % 253);

  /** Exactly the test `hydra` applies: a password falls when the player's
   *  starting wordlist holds it. */
  const covered = new Set(DEFAULT_WORDLIST);

  /** Computed ONCE for the whole block. Regenerating per test is fast normally
   *  but slow enough under mutation instrumentation to race Stryker's timeout,
   *  which silently converts a survivor into a "killed by timeout" and makes the
   *  score depend on machine speed. Deterministic and read-only. */
  const crackable = ((): {
    readonly ap: number;
    readonly inner: number;
    readonly deep: number;
    readonly community: number;
    readonly ownAgent: number;
  } => {
    const rate = (passwords: readonly string[]): number =>
      passwords.filter((password) => covered.has(password)).length;
    return {
      ap: rate(NETWORKS.map(seedApGatewayAdminPw)),
      inner: rate(NETWORKS.map((essid, index) => seedInnerGatewayAdminPw(essid, octetFor(index)))),
      deep: rate(
        NETWORKS.map((_unused, index) => seedDeepGatewayAdminPw(`gw-${index}`, octetFor(index))),
      ),
      community: rate(NETWORKS.map(seedApGatewayCommunity)),
      ownAgent: rate(OWNER_KEYS.map(ownAgentCommunity)),
    };
  })();

  const DOORS = 2000;
  // Observed: 740 / 778 / 774 (37.0%, 38.9%, 38.7%) against a 40% knob. The band
  // brackets those with room for the correlated-seed drift described above, and
  // still excludes every mutant that matters: a roll that always takes the
  // crackable branch (2000), one that never does (0), the accidental pool-overlap
  // rate this behaviour replaces (~500), and any other knob in the table wired
  // here by mistake — npcRoot (~240), npcUser (~1400), guest (2000).
  const FLOOR = Math.round(DOORS * 0.35);
  const CEILING = Math.round(DOORS * 0.45);
  // The community's own band, against a 0.6 knob. Observed 1171 (58.6%), beside the
  // gateway's 741 in the same run — the same wordlist-coverage discount the three bands
  // above absorb. Wide enough to survive that drift, narrow enough to exclude every
  // neighbouring knob: gateway (~740), npcRoot (~240), npcUser (~1400), guest (2000),
  // and a roll stuck on either branch.
  const COMMUNITY_FLOOR = Math.round(DOORS * 0.5);
  const COMMUNITY_CEILING = Math.round(DOORS * 0.62);

  it('hands over the AP gateway at a rate somebody CHOSE, not one the wordlists collided into', () => {
    expect(crackable.ap).toBeGreaterThan(FLOOR);
    expect(crackable.ap).toBeLessThan(CEILING);
  });

  it('hands over a community more readily than a root password, because it buys less', () => {
    // Softer than the gateway's root for two reasons that agree: a community string is
    // the weakest secret on a real network, left at its default far more often than a
    // root password, and this one buys PORT CONTROL and nothing else — no file, no
    // command. At or below root's rate the door would be pointless, since root already
    // grants `nano` on the very file a set rewrites.
    expect(crackable.community).toBeGreaterThan(COMMUNITY_FLOOR);
    expect(crackable.community).toBeLessThan(COMMUNITY_CEILING);
    expect(crackable.community).toBeGreaterThan(crackable.ap);
  });

  it("opens a player's own agent on the same odds as a device the world drew", () => {
    // The whole argument for drawing this community through the same primitive. An
    // agent a player installed is a door like any other: harder to open than a
    // generated one and the filter it guards would defend against nothing anybody
    // could get past, easier and a player who ran one would be handing their port
    // table to the first neighbour with the shipped wordlist.
    expect(crackable.ownAgent).toBeGreaterThan(COMMUNITY_FLOOR);
    expect(crackable.ownAgent).toBeLessThan(COMMUNITY_CEILING);
  });

  it('applies the same odds to an inner gateway — depth changes the route, not the lock', () => {
    expect(crackable.inner).toBeGreaterThan(FLOOR);
    expect(crackable.inner).toBeLessThan(CEILING);
  });

  it('applies the same odds to a deep gateway, so a chain does not get harder as it descends', () => {
    expect(crackable.deep).toBeGreaterThan(FLOOR);
    expect(crackable.deep).toBeLessThan(CEILING);
  });
});

describe('the agent a network device runs', () => {
  /**
   * SNMP is the first door that distinguishes a network device from a host, so unlike
   * every rate before it this one is not a property of boxes at large — it is what
   * separates the two populations. A switch nearly always answers, a router usually
   * does, and a laptop never does.
   *
   * A switch is the higher of the two on purpose. It is the device with the least
   * else to offer: it forwards frames, hangs no layer, and until now ran literally
   * nothing, so a player who found one could scan it and never touch it. The agent is
   * what gives that role a door at all, which is worth more there than on a router
   * that already bears sshd.
   *
   * 2000 devices per kind, deterministic — these counts are fixed, not sampled, and
   * the size is the one the gateway credential curve already established: seeds
   * differing by a few characters have correlated FNV-1a hashes, so a smaller
   * population measures the seed strings rather than the knob.
   */
  const NETWORKS: readonly string[] = Array.from(
    { length: 2000 },
    (_unused, index) => `SNMP-NET-${index}`,
  );

  /** Spread the devices across the addressable range rather than clustering them on
   *  one octet, so a per-octet artefact cannot masquerade as the rate. */
  const octetFor = (index: number): number => 2 + (index % 253);

  /** Read through the SAME reader `nmap` and `ps` use, rather than by looking for a
   *  filename — so a device this suite counts as running an agent is one the rest of
   *  the game also calls a running agent. */
  const runsAgent = (fs: Directory): boolean =>
    readOpenPorts(fs).some((openPort) => openPort.service === 'snmp' && openPort.port === 161);

  /** Computed ONCE for the whole block: fast normally, but slow enough under mutation
   *  instrumentation to race Stryker's timeout, which silently converts a survivor
   *  into a "killed by timeout" and makes the score depend on machine speed. */
  const answering = ((): Readonly<Record<string, number>> => {
    const count = (predicate: (essid: string, index: number) => boolean): number =>
      NETWORKS.filter(predicate).length;
    return {
      ap: count((essid) => runsAgent(buildApGatewayBaseFs(essid))),
      inner: count((essid, index) => runsAgent(buildInnerGatewayBaseFs(essid, octetFor(index)))),
      deepRouter: count((_unused, index) =>
        runsAgent(buildDeepGatewayBaseFs(`gw-${index}`, octetFor(index))),
      ),
      innerSwitch: count((essid, index) => runsAgent(buildSwitchBaseFs(essid, octetFor(index)))),
      deepSwitch: count((_unused, index) =>
        runsAgent(buildDeepSwitchBaseFs(`gw-${index}`, octetFor(index))),
      ),
    };
  })();

  const DEVICES = 2000;

  it('answers on every access-point gateway, so the door is there for every player', () => {
    // The one PINNED rate in the table, and the reason it cannot be expressed as a
    // placement cell: generated routers roll, and this one may not. Left to the roll
    // it would be missing from 40% of players' own networks — the box the whole door
    // aims at, absent for two players in five, decided by their ESSID.
    expect(answering.ap).toBe(DEVICES);
  });

  it('answers on most routers, but not on all of them', () => {
    // Observed 1199 of 2000 (60.0%) against a 0.6 knob. The band excludes every mutant
    // that matters: the roll always taken (2000), never taken (0), the threshold
    // inverted (~801), the flat catalog rate (0), ssh's pinned 1 (2000), and the switch
    // cell wired here by mistake (~1820).
    expect(answering.inner).toBeGreaterThan(Math.round(DEVICES * 0.55));
    expect(answering.inner).toBeLessThan(Math.round(DEVICES * 0.65));
    // Both directions asserted, because the absent case is where a mistake hides: a
    // condition inverted or ignored still lands inside a one-sided band.
    expect(answering.inner).toBeLessThan(DEVICES);
  });

  it('answers on nearly every switch — the role that until now ran nothing at all', () => {
    // Observed 1820 of 2000 (91.0%) against a 0.9 knob. The band excludes the same set:
    // always (2000), never (0), inverted (~180), flat (0), and the router cell wired
    // here by mistake (~1199).
    expect(answering.innerSwitch).toBeGreaterThan(Math.round(DEVICES * 0.85));
    expect(answering.innerSwitch).toBeLessThan(Math.round(DEVICES * 0.95));
    expect(answering.innerSwitch).toBeLessThan(DEVICES);
  });

  it('gives a device the rate of what it IS, not of how deep it sits', () => {
    // Four separate call sites, and a knob applied to only some of them is exactly the
    // defect one population test would miss. Descending a chain changes the route to a
    // device, not what the device is.
    // Observed 1207 and 1815 — within a percentage point of the shallow pair above,
    // which is what "depth changes the route, not the device" has to mean numerically.
    expect(answering.deepRouter).toBeGreaterThan(Math.round(DEVICES * 0.55));
    expect(answering.deepRouter).toBeLessThan(Math.round(DEVICES * 0.65));
    expect(answering.deepSwitch).toBeGreaterThan(Math.round(DEVICES * 0.85));
    expect(answering.deepSwitch).toBeLessThan(Math.round(DEVICES * 0.95));
  });

  it('runs the agent more readily on a switch than on a router, at both depths', () => {
    // Named rather than counted: the two cells swapped keeps both bands' SHAPE and
    // every number in this block plausible, so the ordering has to be claimed of the
    // kinds by name for the swap to fail.
    expect(answering.innerSwitch).toBeGreaterThan(answering.inner);
    expect(answering.deepSwitch).toBeGreaterThan(answering.deepRouter);
  });

  it('plants the pidfile only where the agent is, so its absence means something', () => {
    // A log or a pidfile seeded unconditionally would say a daemon is there that never
    // was — the reason `snmpd.pid` is conditional where `auth.log` beside it is not.
    const silent = NETWORKS.map((essid, index) =>
      buildInnerGatewayBaseFs(essid, octetFor(index)),
    ).find((fs) => !runsAgent(fs));
    if (silent === undefined) throw new Error('no agent-free router in the sample');

    expect(readOpenPorts(silent).map((openPort) => openPort.service)).not.toContain('snmp');
  });
});

describe('buildDeepGatewayBaseFs', () => {
  it('is a root-only FS whose admin hash is the deep-gateway pw seeded off parent + octet', () => {
    const rows = passwdRows(buildDeepGatewayBaseFs(PARENT_GW, 50));
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('root');
    expect(rows[0]![1]).toBe(md5(seedDeepGatewayAdminPw(PARENT_GW, 50)));
  });

  it('runs sshd:22 — a deep gateway is a reachable target by design', () => {
    expect(portsByDesign(buildDeepGatewayBaseFs(PARENT_GW, 50))).toEqual([
      { port: 22, service: 'ssh' },
    ]);
  });

  it('seeds rules.v4 with no active forward (a router that forwards to its own deeper layer)', () => {
    const rules = fileAt(buildDeepGatewayBaseFs(PARENT_GW, 50), ['etc', 'iptables'], 'rules.v4');
    expect(parseForwardRules(rules)).toEqual([]);
  });

  it('is deterministic: same parent+octet yields a byte-identical tree', () => {
    expect(buildDeepGatewayBaseFs(PARENT_GW, 50)).toEqual(buildDeepGatewayBaseFs(PARENT_GW, 50));
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
describe('buildDeepSwitchBaseFs', () => {
  const PARENT = 'gw-deadbeef';

  it('owns an acl.conf like its shallow counterpart — a deep switch still filters', () => {
    // Nothing asserted this before, and an empty file is not an inert one: `acl.conf`
    // is default-ALLOW, so a deep switch that lost its seeded deny would silently open
    // the port it was meant to filter rather than fail visibly. The snmp write path
    // arrives at this exact file, which is what makes the gap worth closing now.
    const acl = fileAt(buildDeepSwitchBaseFs(PARENT, 42), ['etc', 'switch'], 'acl.conf');

    expect(acl.startsWith('#')).toBe(true);
    expect(parseAclDenies(acl)).toEqual([8080]);
  });

  it('forwards nothing — no rules.v4 at all, so its segment is dark from upstream', () => {
    // The whole difference between the two deep device kinds. A switch caps the chain
    // by construction rather than by an empty forward table it could be given.
    expect(dirAt(buildDeepSwitchBaseFs(PARENT, 42), 'etc').entries.has('iptables')).toBe(false);
  });
});

describe('buildRouterBaseFsFromIdentity', () => {
  const routerFs = (
    overrides: Partial<{
      adminPwHash: string;
      hasSsh: boolean;
      hasSnmp: boolean;
      snmpCommunityHash: string;
    }> = {},
  ): Directory =>
    buildRouterBaseFsFromIdentity({
      adminPwHash: ADMIN_HASH,
      snmpCommunityHash: COMMUNITY_HASH,
      hasSsh: true,
      hasSnmp: false,
      ...overrides,
    });

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
    ['nano', 'ls', 'cat', 'clear', 'whoami'].forEach((name) =>
      expect(dirAt(fs, 'bin').entries.has(name)).toBe(true),
    );
    expect([...dirAt(fs, 'usr', 'bin').entries.keys()].sort()).toEqual(
      [...LOCALHOST_PREINSTALLED_TOOLS, ...SERVICE_CONTROL_TOOLS].sort(),
    );
    expect([...dirAt(fs, 'usr', 'sbin').entries.keys()].sort()).toEqual(
      [...SYSTEM_DAEMON_NAMES].sort(),
    );
    expect(dirAt(fs, 'lib').entries.has('libpcre.so')).toBe(true); // ls/cat/nano link it
    // Named literally, not through the constant: spelled as
    // `SERVICE_CONTROL_TOOLS` on both sides, the assertion above still passes if
    // the list is emptied. A router you have rooted must be controllable.
    expect(dirAt(fs, 'usr', 'bin').entries.has('systemctl')).toBe(true);
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

  it('ships empty /var/log/{access,auth,kern}.log for web-hit, ssh-auth and scan logging', () => {
    const log = dirAt(routerFs(), 'var', 'log');
    ['access.log', 'auth.log', 'kern.log'].forEach((name) => {
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

  it('runs snmpd:161 when hasSnmp — with its own config, log and binary', () => {
    const fs = routerFs({ hasSnmp: true });

    expect(fileAt(fs, ['var', 'run'], 'snmpd.pid')).toBe('snmpd:port=161');
    expect(readOpenPorts(fs)).toEqual([
      { port: 22, service: 'ssh' },
      { port: 161, service: 'snmp' },
    ]);
    // A device advertising a port whose program it does not have could not be stopped
    // by the `systemctl` sitting next to it.
    expect(dirAt(fs, 'usr', 'sbin').entries.has('snmpd')).toBe(true);
    expect(fileAt(fs, ['var', 'log'], 'snmpd.log')).toBe('');
    // Parsed rather than compared as text: what has to be true is that the device
    // ANSWERS to the community a walk will offer it, and a seed that stopped parsing
    // would leave a listening agent nobody can query.
    expect(parseSnmpdConf(readSnmpdConf(fs))).toEqual({
      roCommunity: 'public',
      sysContact: 'netops@corp.local',
    });
  });

  it('leaves its snmpd.conf readable by anyone on the box, writable only by root', () => {
    // The read-only community is public knowledge by design, so hiding the file would
    // model the protocol wrongly to protect nothing. Repointing the agent at a string
    // of your own is an administrative act, so a visitor cannot do it.
    const conf = dirAt(routerFs({ hasSnmp: true }), 'etc', 'snmp').entries.get('snmpd.conf');

    expect(conf?.kind === 'file' ? conf.perms : null).toEqual({
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: [],
    });
  });

  it('keeps its read-write community as a hash in a file only root can read', () => {
    // The read-only community is public knowledge and sits in world-readable
    // `/etc/snmp/snmpd.conf`; this one is the secret that buys port control, so it
    // lives where `/var/lib/mysql/data.json` lives and answers to the same rule. Left
    // where a guest could read it, a sweep of this door would be handed its own answer
    // key, and every tier the walk hands out is below root.
    const state = dirAt(routerFs({ hasSnmp: true }), 'var', 'lib', 'snmp').entries.get(
      'snmpd.conf',
    );

    expect(state?.kind === 'file' ? state.perms : null).toEqual({
      read: ['root'],
      write: ['root'],
      execute: [],
    });
  });

  it('answers a read-write walk to the community it was seeded with, never in the clear', () => {
    // Hashed exactly as an account's password is, so a sweep of this door obeys the one
    // wordlist rule every other door obeys. A plaintext string here would be a secret
    // that root could read without cracking anything, on the one door whose whole
    // premise is that the community had to be earned.
    const state = fileAt(
      routerFs({ hasSnmp: true, snmpCommunityHash: COMMUNITY_HASH }),
      ['var', 'lib', 'snmp'],
      'snmpd.conf',
    );

    expect(state).toContain(COMMUNITY_HASH);
    expect(state).not.toContain('corpnet');
  });

  it('leaves no agent trace at all when hasSnmp is false — config, pidfile, log, binary', () => {
    // All four together, because the absent case is where a mistake hides: a config, a
    // log or a binary seeded unconditionally would say a daemon was there that never
    // was, and a conf on a device with no agent invites a player to walk one that
    // cannot answer.
    const fs = routerFs({ hasSnmp: false });

    expect(dirAt(fs, 'var', 'run').entries.has('snmpd.pid')).toBe(false);
    expect(dirAt(fs, 'var', 'log').entries.has('snmpd.log')).toBe(false);
    expect(dirAt(fs, 'usr', 'sbin').entries.has('snmpd')).toBe(false);
    expect(readSnmpdConf(fs)).toBe('');
    expect(dirAt(fs, 'var').entries.has('lib')).toBe(false);
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
