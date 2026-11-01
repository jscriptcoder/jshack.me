/**
 * A contract network's shape, a pure function of its number — the one place that decides,
 * for the gateway and the key box, their names, the one guaranteed way in, the versions
 * every package sits on, and the gateway's forward. It ships in the bundle: none of it is
 * secret (the key and its path are the server's, not here), and a player holding the
 * address can work the same shape out, which is what lets every hop command compute the
 * LAN locally the way it does for any network.
 *
 * Two ways in, drawn one per contract:
 *  - `hydra`: the key box's `root` has a crackable password, its sshd reached through the
 *    gateway's forward. No release hole is the way in, so sshd sits on a safe release like
 *    everything else.
 *  - `msfconsole`: one exposed service on the key box sits on a release whose hole is
 *    `critical` and published on or before `MISSION_ROUTE_DAY`, reached through the
 *    forward. The hole is the way in.
 *
 * Everything that is NOT the way in sits on a release whose hole grants a guest shell at
 * most (`low` or `medium`): the gateway's firmware (so the gateway is passed through, not
 * broken), every library (a `high` or `critical` library hole would hand a local root),
 * and every other service. So the key box is rooted only by the contract's own route, and
 * the gateway not at all.
 *
 * The generator never reads the clock: `MISSION_ROUTE_DAY` is fixed, so the same number is
 * the same network today and on any later day. A route's hole, published on or before that
 * day, is therefore already live whenever the contract is played.
 */

import { createPrng, type Prng } from '../generation/prng.js';
import { packageTimeline } from '../cve/packageTimeline.js';
import { SYSTEM_LIBRARIES } from '../generation/libraries.js';
import { drawPasswordHash, CRACK_CHANCE, UNCRACKABLE_HASHES } from '../generation/passwordPools.js';
import { FIRMWARE_VENDORS, firmwarePackageOf } from '../packages/packageVersions.js';
import { TARGET_STEMS } from './pools.js';

/** The game day a route's hole must have published on or before: the day slice 1 ships.
 *  Fixed, never the live clock — moving it changes every existing contract's network. */
export const MISSION_ROUTE_DAY = 111;

export type MissionRoute = 'hydra' | 'msfconsole';

/** One service the key box runs: what it is, the program behind it, the port it listens
 *  on, and the release it sits on. */
export type MissionService = {
  readonly service: string;
  readonly package: string;
  readonly program: string;
  readonly port: number;
  readonly version: string;
};

export type MissionShape = {
  readonly missionNumber: number;
  readonly stem: string;
  readonly keyBoxOctet: number;
  readonly route: MissionRoute;
  /** The key box's `root` password hash: crackable on the hydra route, uncrackable
   *  otherwise. */
  readonly keyBoxRootHash: string;
  /** The gateway's `root` ("admin") password hash — always uncrackable, so the gateway is
   *  a box the route passes through rather than one to break into. */
  readonly gatewayAdminHash: string;
  /** Versions to pin on the gateway, package to version. Every firmware vendor is pinned
   *  safe, so whichever the gateway builder draws sits on a guest-at-most release. */
  readonly gatewayVersions: Readonly<Record<string, string>>;
  /** The services the key box runs: the route's service (on the msfconsole route) and any
   *  decoys, each already on its chosen release. */
  readonly keyBoxServices: readonly MissionService[];
  /** Versions to pin on the key box, package to version — every service it runs and every
   *  library it carries. */
  readonly keyBoxVersions: Readonly<Record<string, string>>;
  /** The gateway's one forward: the public port it answers on, and the port it reaches on
   *  the key box. */
  readonly forward: { readonly publicPort: number; readonly internalPort: number };
};

/** A service that can be the msfconsole route: an exposed daemon with a `critical` release
 *  published on or before the cutoff. Kept small on purpose; the catalog grows later. */
type RouteCandidate = {
  readonly service: string;
  readonly package: string;
  readonly program: string;
  readonly port: number;
};

const MSFCONSOLE_ROUTE_CANDIDATES: readonly RouteCandidate[] = [
  { service: 'http', package: 'nginx', program: 'nginx', port: 80 },
  { service: 'ftp', package: 'vsftpd', program: 'vsftpd', port: 21 },
];

/** The versions of `key`'s releases whose hole grants a guest shell at most. */
const safeVersions = (key: string): readonly string[] =>
  packageTimeline(key, MISSION_ROUTE_DAY)
    .filter((release) => release.severity === 'low' || release.severity === 'medium')
    .map((release) => release.version);

/** The version of `key`'s newest release whose hole is `critical` and published on or
 *  before the cutoff — the msfconsole route's release — or undefined when it has none. */
const criticalRouteVersion = (key: string): string | undefined => {
  const critical = packageTimeline(key, MISSION_ROUTE_DAY).filter(
    (release) => release.severity === 'critical' && release.publishedAt <= MISSION_ROUTE_DAY,
  );
  return critical[critical.length - 1]?.version;
};

/** A safe release version of `key`, drawn deterministically. Throws when a package the
 *  generator means to carry has no safe release — a build-time invariant, caught by the
 *  shape test rather than reaching a player. */
const safeVersionOf = (key: string, prng: Prng): string => {
  const releases = safeVersions(key);
  const chosen = releases.length === 0 ? undefined : prng.pick(releases);
  if (chosen === undefined) throw new Error(`no safe release for ${key}`);
  return chosen;
};

/** A crackable password hash, drawn at the gateway odds and retried until it is one the
 *  world's word list can crack — the hydra route's `root`. Always terminates: the
 *  crackable pool is non-empty, so each draw has a real chance of landing in it. */
const crackableHash = (prng: Prng): string => {
  let hash = drawPasswordHash(prng, CRACK_CHANCE.gateway);
  while (UNCRACKABLE_HASHES.includes(hash)) {
    hash = drawPasswordHash(prng, CRACK_CHANCE.gateway);
  }
  return hash;
};

/** Every library and the two daemons every box ships, each pinned to a safe release. */
const safeBaseVersions = (prng: Prng): Record<string, string> => {
  const base: Record<string, string> = {};
  for (const key of [...SYSTEM_LIBRARIES, 'openssh-server', 'vsftpd']) {
    base[key] = safeVersionOf(key, prng);
  }
  return base;
};

/** Every firmware vendor pinned to a safe release. The gateway builder draws its own
 *  vendor, so pinning them all means whichever it lands on sits on a guest-at-most
 *  release and the gateway is not rootable by a firmware hole. */
const safeFirmwareVersions = (prng: Prng): Record<string, string> => {
  const firmware: Record<string, string> = {};
  for (const vendor of FIRMWARE_VENDORS) {
    firmware[firmwarePackageOf(vendor)] = safeVersionOf(firmwarePackageOf(vendor), prng);
  }
  return firmware;
};

export const missionShape = (missionNumber: number): MissionShape => {
  // The first two draws are the topology's (stem, then key-box octet); generateHomeLan
  // reads them, so their order is fixed here and nowhere else.
  const prng = createPrng(`mission-shape-${missionNumber}`);
  const stem = prng.pick(TARGET_STEMS);
  const keyBoxOctet = prng.nextInt(2, 254);
  const route: MissionRoute = prng.next() < 0.5 ? 'hydra' : 'msfconsole';

  // Versions and decoys on their own streams, so adding either never shifts the topology.
  const versionPrng = createPrng(`mission-versions-${missionNumber}`);
  const keyBoxVersions = safeBaseVersions(versionPrng);

  const gatewayVersions: Record<string, string> = {
    ...safeBaseVersions(versionPrng),
    ...safeFirmwareVersions(versionPrng),
  };

  const keyBoxServices: MissionService[] = [];
  let forward: { publicPort: number; internalPort: number };

  if (route === 'msfconsole') {
    const candidate = versionPrng.pick(MSFCONSOLE_ROUTE_CANDIDATES);
    const version = criticalRouteVersion(candidate.package);
    if (version === undefined) throw new Error(`no route release for ${candidate.package}`);
    keyBoxServices.push({ ...candidate, version });
    keyBoxVersions[candidate.package] = version;
    forward = { publicPort: candidate.port, internalPort: candidate.port };
  } else {
    // The hydra route reaches the key box's own sshd through the forward.
    forward = { publicPort: 2222, internalPort: 22 };
  }

  // The hydra route insists on a crackable root; the msfconsole route wants one that
  // stays shut, so the only way onto the box is the service hole.
  const keyBoxRootHash =
    route === 'hydra' ? crackableHash(versionPrng) : versionPrng.pick(UNCRACKABLE_HASHES);
  const gatewayAdminHash = versionPrng.pick(UNCRACKABLE_HASHES);

  return {
    missionNumber,
    stem,
    keyBoxOctet,
    route,
    keyBoxRootHash,
    gatewayAdminHash,
    gatewayVersions,
    keyBoxServices,
    keyBoxVersions,
    forward,
  };
};
