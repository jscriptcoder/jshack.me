/**
 * A contract network's shape, a pure function of its number — the one place that decides,
 * for the gateway and the key box, their names, the one guaranteed way in, the versions
 * every package sits on, and the gateway's forwards. It ships in the bundle: none of it is
 * secret (the key and its path are the server's, not here), and a player holding the
 * address can work the same shape out, which is what lets every hop command compute the
 * LAN locally the way it does for any network.
 *
 * Six ways in, drawn one per contract:
 *  - `hydra`: the key box's `root` has a crackable password, its sshd reached through the
 *    gateway's forward. No release hole is the way in, so sshd sits on a safe release like
 *    everything else.
 *  - `msfconsole`: one exposed service on the key box sits on a release whose hole is
 *    `critical` and published on or before `MISSION_ROUTE_DAY`, reached through the
 *    forward. The hole is the way in.
 *  - `web`: the key box's document root holds a forgotten file with `root`'s password in it,
 *    which the server lays in. A sweep through the forward to `:80` finds it, and the word
 *    logs in through the forward to `:2222`. The web server cannot log anybody in, so this
 *    route needs both, and it sits on a safe release: the file is the way in.
 *  - `ftp`: the key box's `vsftpd` lets `anonymous` in, and `/srv/ftp/pub` holds a forgotten
 *    file with `root`'s password in it, which the server lays in. The word logs in through
 *    the forward to `:2222`, and the daemon sits on a safe release: the file is the way in.
 *  - `mysql`: the key box's database has a crackable application account and a `settings`
 *    table with `root`'s password in it, which the server lays in. Database root stays shut,
 *    so the account has to be swept for. The word logs in through the forward to `:2222`, and
 *    the daemon sits on a safe release: the table is the way in.
 *  - `snmp`: the key box's agent answers to a read-only community somebody can guess and a
 *    read-write one a sweep finds, and its config, which the server lays in, gives `root`'s
 *    password as the device's contact. The word logs in through the forward to `:2222`, and
 *    the agent sits on a safe release: the config is the way in.
 *
 * Where the key is kept is drawn beside the route. On `database` the key box runs mysqld on
 * every route, behind a `:3306` forward and an application account a sweep finds, so the key
 * is reached from outside as a database user. The route still roots the box, a second way to
 * the same row.
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
import { LEAKABLE_HASHES, SHUT_HASHES } from './leakablePool.js';
import { TARGET_STEMS } from './pools.js';

/** The game day a route's hole must have published on or before: the day slice 1 ships.
 *  Fixed, never the live clock — moving it changes every existing contract's network. */
export const MISSION_ROUTE_DAY = 111;

/** Each route equally likely. Adding one re-rolls every contract's route, though never
 *  its address, key or key path. */
const ROUTES = ['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp'] as const;

export type MissionRoute = (typeof ROUTES)[number];

/** Where the key box keeps the key, each equally likely: a root-only file, that file
 *  encrypted with its passphrase compiled into a program beside it, or a row in the box's
 *  database. Independent of the route: any way in meets any of the three. */
const STORAGES = ['file', 'gpg', 'database'] as const;

export type MissionStorage = (typeof STORAGES)[number];

/** One forward on the gateway: the public port it answers on, and the port it reaches on
 *  the key box. */
export type MissionForward = {
  readonly publicPort: number;
  readonly internalPort: number;
};

/** One service the key box runs: what it is, the program behind it, the port it listens
 *  on, and the release it sits on. */
export type MissionService = {
  readonly service: string;
  readonly package: string;
  readonly program: string;
  readonly port: number;
  readonly version: string;
};

/** The accounts a key box's database answers to: an application account a sweep finds, and a
 *  database root no sweep does and no leaked word opens. */
export type MissionDatabase = {
  readonly accountHash: string;
  readonly rootHash: string;
};

export type MissionShape = {
  readonly missionNumber: number;
  readonly stem: string;
  readonly keyBoxOctet: number;
  readonly route: MissionRoute;
  readonly storage: MissionStorage;
  /** The key box's `root` password hash: crackable on the hydra route, one a file can
   *  leak on a leak route, and one that stays shut on the msfconsole route. */
  readonly keyBoxRootHash: string;
  /** The hashes guarding the key box's database, on the database route and on every contract
   *  that keeps its key in one. */
  readonly keyBoxDatabase: MissionDatabase | null;
  /** The hash of the read-write community a sweep finds, on the one route running an agent. */
  readonly keyBoxCommunityHash: string | null;
  /** The gateway's `root` ("admin") password hash — always uncrackable and never one a
   *  file can leak, so the gateway is a box the route passes through rather than one to
   *  break into. */
  readonly gatewayAdminHash: string;
  /** Versions to pin on the gateway, package to version. Every firmware vendor is pinned
   *  safe, so whichever the gateway builder draws sits on a guest-at-most release. */
  readonly gatewayVersions: Readonly<Record<string, string>>;
  /** The services the key box runs: the route's service (on every route but hydra), then the
   *  database on a contract keeping its key in one, each already on its chosen release. */
  readonly keyBoxServices: readonly MissionService[];
  /** Versions to pin on the key box, package to version — every service it runs and every
   *  library it carries. */
  readonly keyBoxVersions: Readonly<Record<string, string>>;
  /** The gateway's forwards onto the key box: one on a route with one door, and on a leak
   *  route the door holding the file followed by `:2222`. A contract keeping its key in a
   *  database adds `:3306` after them, unless the route's door already is. */
  readonly forwards: readonly MissionForward[];
};

/** A service that can be the msfconsole route: an exposed daemon with a `critical` release
 *  published on or before the cutoff. Kept small on purpose; the catalog grows later. */
type RouteCandidate = {
  readonly service: string;
  readonly package: string;
  readonly program: string;
  readonly port: number;
};

const WEB_SERVER: RouteCandidate = {
  service: 'http',
  package: 'nginx',
  program: 'nginx',
  port: 80,
};

const FTP_SERVER: RouteCandidate = {
  service: 'ftp',
  package: 'vsftpd',
  program: 'vsftpd',
  port: 21,
};

const DATABASE_SERVER: RouteCandidate = {
  service: 'mysql',
  package: 'mysql',
  program: 'mysqld',
  port: 3306,
};

const SNMP_AGENT: RouteCandidate = {
  service: 'snmp',
  package: 'snmp',
  program: 'snmpd',
  port: 161,
};

/** Only a service whose route release's hole lands a root shell: the gateway forwards just
 *  that one port, so a hole that lists or reads files leaves the key out of reach. The ftp
 *  server cannot be one, since no vsftpd hole grants a shell at all. */
const MSFCONSOLE_ROUTE_CANDIDATES: readonly RouteCandidate[] = [WEB_SERVER];

/** The door holding the file, on each route where a file gives `root`'s word away. */
const LEAK_ROUTE_DOORS: Readonly<
  Record<Exclude<MissionRoute, 'hydra' | 'msfconsole'>, RouteCandidate>
> = { web: WEB_SERVER, ftp: FTP_SERVER, mysql: DATABASE_SERVER, snmp: SNMP_AGENT };

/** The forward a word logs in through: the public :2222 onto the key box's own sshd. */
const SSH_FORWARD: MissionForward = { publicPort: 2222, internalPort: 22 };

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

/** A key box database's accounts: the application's crackable, so a sweep finds the way in,
 *  and the database root shut, so no sweep or leaked word walks around it. */
const databaseAccounts = (prng: Prng): MissionDatabase => ({
  accountHash: crackableHash(prng),
  rootHash: prng.pick(SHUT_HASHES),
});

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
  const route = prng.pick(ROUTES);

  // Versions and decoys on their own streams, so adding either never shifts the topology.
  const versionPrng = createPrng(`mission-versions-${missionNumber}`);
  const keyBoxVersions = safeBaseVersions(versionPrng);

  const gatewayVersions: Record<string, string> = {
    ...safeBaseVersions(versionPrng),
    ...safeFirmwareVersions(versionPrng),
  };

  const keyBoxServices: MissionService[] = [];
  let forwards: readonly MissionForward[];
  let keyBoxRootHash: string;
  let keyBoxDatabase: MissionDatabase | null = null;
  let keyBoxCommunityHash: string | null = null;

  if (route === 'msfconsole') {
    const candidate = versionPrng.pick(MSFCONSOLE_ROUTE_CANDIDATES);
    const version = criticalRouteVersion(candidate.package);
    if (version === undefined) throw new Error(`no route release for ${candidate.package}`);
    keyBoxServices.push({ ...candidate, version });
    keyBoxVersions[candidate.package] = version;
    forwards = [{ publicPort: candidate.port, internalPort: candidate.port }];
    keyBoxRootHash = versionPrng.pick(SHUT_HASHES);
  } else if (route === 'hydra') {
    forwards = [SSH_FORWARD];
    keyBoxRootHash = crackableHash(versionPrng);
  } else {
    const door = LEAK_ROUTE_DOORS[route];
    const version = safeVersionOf(door.package, versionPrng);
    keyBoxServices.push({ ...door, version });
    keyBoxVersions[door.package] = version;
    forwards = [{ publicPort: door.port, internalPort: door.port }, SSH_FORWARD];
    keyBoxRootHash = versionPrng.pick(LEAKABLE_HASHES);
    if (route === 'mysql') keyBoxDatabase = databaseAccounts(versionPrng);
    if (route === 'snmp') keyBoxCommunityHash = crackableHash(versionPrng);
  }

  const gatewayAdminHash = versionPrng.pick(SHUT_HASHES);

  // On a stream of its own, so adding it moved no contract's topology, route or hashes.
  const storage = createPrng(`mission-storage-${missionNumber}`).pick(STORAGES);

  // A key in the database is reached from outside as a database user, so off the database
  // route the box gains one, behind a forward of its own. Drawn after everything above, so a
  // contract's way in reads the same whatever its storage.
  if (storage === 'database' && keyBoxDatabase === null) {
    const version = safeVersionOf(DATABASE_SERVER.package, versionPrng);
    keyBoxServices.push({ ...DATABASE_SERVER, version });
    keyBoxVersions[DATABASE_SERVER.package] = version;
    forwards = [
      ...forwards,
      { publicPort: DATABASE_SERVER.port, internalPort: DATABASE_SERVER.port },
    ];
    keyBoxDatabase = databaseAccounts(versionPrng);
  }

  return {
    missionNumber,
    stem,
    keyBoxOctet,
    route,
    storage,
    keyBoxRootHash,
    keyBoxDatabase,
    keyBoxCommunityHash,
    gatewayAdminHash,
    gatewayVersions,
    keyBoxServices,
    keyBoxVersions,
    forwards,
  };
};
