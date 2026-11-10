/**
 * A contract network's shape, a pure function of its number — the one place that decides,
 * for the gateway and the boxes behind it, their names, each box's guaranteed way in, the versions
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
 * Decoys come last, so the port list stops telling the route: the gateway forwards three or four
 * ports, and the gap above the real ones is filled with doors of the kinds some route is won
 * through, each built as the real door is but holding nothing (a database a sweep opens onto no
 * word, an agent whose read-write community stays shut). Every route reaches every count.
 *
 * One contract in three has two hops. The gateway forwards only onto a front box, which falls
 * to a route of its own from the same six and holds nothing; the key box has no forward and no
 * decoys, and is worked from a shell on the front box, its doors reached over the LAN on their
 * own ports. A two-hop contract's key box keeps the route, hashes and storage it would have had
 * with one hop.
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

/** The doors a decoy can be: every kind some route is won through, since a port that is never
 *  a way in is dismissed at a glance and blurs nothing. */
const DECOY_KINDS = ['ssh', 'web', 'ftp', 'mysql', 'snmp'] as const;

export type MissionDecoy = (typeof DECOY_KINDS)[number];

/** How many forwards a gateway has, decoys filling the gap above the real ones. A contract has
 *  one to three real forwards, so every route reaches every count and the count says nothing. */
const FORWARD_COUNTS = [3, 4] as const;

/** The share of contracts whose key box sits behind a front box. */
const TWO_HOP_SHARE = 1 / 3;

/** One forward on the gateway: the public port it answers on, the box behind the gateway it
 *  reaches (by its last octet), and the port it reaches there. */
export type MissionForward = {
  readonly publicPort: number;
  readonly boxOctet: number;
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

/** One machine behind a contract's gateway, and everything drawn for it. */
export type MissionBox = {
  /** Its last octet on the contract's subnet. */
  readonly octet: number;
  /** The one guaranteed way to root it. */
  readonly route: MissionRoute;
  /** Its `root` password hash: crackable on the hydra route, one a file can leak on a leak
   *  route, and one that stays shut on the msfconsole route. */
  readonly rootHash: string;
  /** The hashes guarding its database, on the database route, on every contract that keeps
   *  its key in one, and behind a database decoy. */
  readonly database: MissionDatabase | null;
  /** The hash of the read-write community: one a sweep finds on the snmp route, and one no
   *  sweep finds behind an snmp decoy. */
  readonly communityHash: string | null;
  /** The services it runs: the route's service (on every route but hydra), then the database
   *  on a contract keeping its key in one, then the decoys' daemons, each already on its
   *  chosen release. */
  readonly services: readonly MissionService[];
  /** Versions to pin on it, package to version — every service it runs and every library it
   *  carries. */
  readonly versions: Readonly<Record<string, string>>;
  /** The doors on it that lead nowhere, in the order their forwards follow the real ones. Each
   *  is built as the real door of its kind is, minus what the server lays in. */
  readonly decoys: readonly MissionDecoy[];
};

/** Which of a contract's boxes: the one holding the key, or a two-hop contract's front box. */
export type MissionBoxRole = 'key' | 'front';

/** One box of one contract, as the server names it from the machine a door reached. */
export type MissionBoxRef = { readonly missionNumber: number; readonly role: MissionBoxRole };

export type MissionShape = {
  readonly missionNumber: number;
  readonly stem: string;
  readonly storage: MissionStorage;
  /** The box holding the key. */
  readonly keyBox: MissionBox;
  /** On a two-hop contract, the box the gateway forwards onto instead of the key box: it falls
   *  to a route of its own and holds nothing, and the key box is worked from a shell on it.
   *  Null on a single-hop contract. */
  readonly frontBox: MissionBox | null;
  /** The gateway's `root` ("admin") password hash — always uncrackable and never one a
   *  file can leak, so the gateway is a box the route passes through rather than one to
   *  break into. */
  readonly gatewayAdminHash: string;
  /** Versions to pin on the gateway, package to version. Every firmware vendor is pinned
   *  safe, so whichever the gateway builder draws sits on a guest-at-most release. */
  readonly gatewayVersions: Readonly<Record<string, string>>;
  /** The gateway's forwards, all onto one box: the front box on a two-hop contract, else the
   *  key box. One on a route with one door, and on a leak route the door holding the file
   *  followed by `:2222`. A single-hop contract keeping its key in a database adds `:3306`
   *  after them, unless the route's door already is. The decoys' forwards follow, bringing the
   *  count to three or four. */
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

/** A forward before it is pointed at a box: the public port and the port it reaches. */
type PortPair = Omit<MissionForward, 'boxOctet'>;

/** The forward a word logs in through: the public :2222 onto the key box's own sshd. */
const SSH_FORWARD: PortPair = { publicPort: 2222, internalPort: 22 };

/** The daemon behind each decoy, or none for `ssh`, whose forward reaches the sshd every key
 *  box runs. */
const DECOY_SERVICES: Readonly<Record<MissionDecoy, RouteCandidate | null>> = {
  ssh: null,
  web: WEB_SERVER,
  ftp: FTP_SERVER,
  mysql: DATABASE_SERVER,
  snmp: SNMP_AGENT,
};

const decoyForward = (decoy: MissionDecoy): PortPair => {
  const service = DECOY_SERVICES[decoy];
  return service === null ? SSH_FORWARD : { publicPort: service.port, internalPort: service.port };
};

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

/** What a route draws onto the box it roots: the door it runs (none on hydra), the versions
 *  that door pins, the forwards that reach it, and the hashes guarding it. */
type RouteDraw = {
  readonly services: readonly MissionService[];
  readonly versions: Readonly<Record<string, string>>;
  readonly forwards: readonly PortPair[];
  readonly rootHash: string;
  readonly database: MissionDatabase | null;
  readonly communityHash: string | null;
};

const drawRoute = (route: MissionRoute, prng: Prng): RouteDraw => {
  if (route === 'msfconsole') {
    const candidate = prng.pick(MSFCONSOLE_ROUTE_CANDIDATES);
    const version = criticalRouteVersion(candidate.package);
    if (version === undefined) throw new Error(`no route release for ${candidate.package}`);
    return {
      services: [{ ...candidate, version }],
      versions: { [candidate.package]: version },
      forwards: [{ publicPort: candidate.port, internalPort: candidate.port }],
      rootHash: prng.pick(SHUT_HASHES),
      database: null,
      communityHash: null,
    };
  }
  if (route === 'hydra') {
    return {
      services: [],
      versions: {},
      forwards: [SSH_FORWARD],
      rootHash: crackableHash(prng),
      database: null,
      communityHash: null,
    };
  }
  const door = LEAK_ROUTE_DOORS[route];
  const version = safeVersionOf(door.package, prng);
  const rootHash = prng.pick(LEAKABLE_HASHES);
  return {
    services: [{ ...door, version }],
    versions: { [door.package]: version },
    forwards: [{ publicPort: door.port, internalPort: door.port }, SSH_FORWARD],
    rootHash,
    database: route === 'mysql' ? databaseAccounts(prng) : null,
    communityHash: route === 'snmp' ? crackableHash(prng) : null,
  };
};

/** A box before its decoys. */
type BareBox = Omit<MissionBox, 'decoys'>;

/** The box the gateway forwards onto, with its decoys: doors filling its forwards to three or
 *  four, each running the real door's daemon. Drawn last on a stream of its own, so decoys
 *  moved nothing a contract already had. */
const withDecoys = (
  box: BareBox,
  forwards: readonly PortPair[],
  missionNumber: number,
): { readonly box: MissionBox; readonly forwards: readonly PortPair[] } => {
  const decoyPrng = createPrng(`mission-decoys-${missionNumber}`);
  const forwardCount = decoyPrng.pick(FORWARD_COUNTS);
  const unforwarded = DECOY_KINDS.filter(
    (decoy) => !forwards.some(({ publicPort }) => publicPort === decoyForward(decoy).publicPort),
  );
  const decoys = decoyPrng.pickN(unforwarded, forwardCount - forwards.length);
  const services = [...box.services];
  const versions = { ...box.versions };
  for (const decoy of decoys) {
    const service = DECOY_SERVICES[decoy];
    if (service === null) continue;
    const version = safeVersionOf(service.package, decoyPrng);
    services.push({ ...service, version });
    versions[service.package] = version;
  }
  return {
    box: {
      ...box,
      services,
      versions,
      // The door lets a sweep in as far as the real one would, onto a database holding nothing.
      database: decoys.includes('mysql') ? databaseAccounts(decoyPrng) : box.database,
      // A read-write community shuts the box's ports without root, so a decoy's never falls.
      communityHash: decoys.includes('snmp') ? decoyPrng.pick(SHUT_HASHES) : box.communityHash,
      decoys,
    },
    forwards: [...forwards, ...decoys.map(decoyForward)],
  };
};

/** Every host octet on a contract's subnet: the gateway holds `.1`. */
const HOST_OCTETS = Array.from({ length: 253 }, (_unused, index) => index + 2);

/** Where a contract's boxes stand: the stem they are named on, the key box's octet, and the
 *  front box's on a two-hop contract (null on a single-hop one). */
export type MissionTopology = {
  readonly stem: string;
  readonly keyBoxOctet: number;
  readonly frontBoxOctet: number | null;
};

/** The topology's draws, and the streams left where they stopped for the shape to go on
 *  drawing from: the shape's own, and on a two-hop contract the front box's beside its octet. */
const drawTopology = (
  missionNumber: number,
): {
  readonly stem: string;
  readonly keyBoxOctet: number;
  readonly shapePrng: Prng;
  readonly front: { readonly prng: Prng; readonly octet: number } | null;
} => {
  const shapePrng = createPrng(`mission-shape-${missionNumber}`);
  const stem = shapePrng.pick(TARGET_STEMS);
  const keyBoxOctet = shapePrng.nextInt(2, 254);
  // On a stream of its own, so a contract that stays single-hop keeps its network to the byte.
  const twoHop = createPrng(`mission-template-${missionNumber}`).next() < TWO_HOP_SHARE;
  if (!twoHop) return { stem, keyBoxOctet, shapePrng, front: null };
  const prng = createPrng(`mission-front-${missionNumber}`);
  const octet = prng.pick(HOST_OCTETS.filter((candidate) => candidate !== keyBoxOctet));
  return { stem, keyBoxOctet, shapePrng, front: { prng, octet } };
};

/** Where a contract's boxes stand, drawn the way the shape draws it. The LAN reads this on
 *  every hop command, and the whole shape takes milliseconds to draw, so this draws nothing
 *  past the addresses. */
export const missionTopology = (missionNumber: number): MissionTopology => {
  const { stem, keyBoxOctet, front } = drawTopology(missionNumber);
  return { stem, keyBoxOctet, frontBoxOctet: front?.octet ?? null };
};

/** A two-hop contract's front box, on a stream of its own so drawing it moved nothing the key
 *  box had: a route from the six, and its own safe base under that route's draw. */
const drawFrontBox = (
  prng: Prng,
  octet: number,
): { readonly box: BareBox; readonly forwards: readonly PortPair[] } => {
  const route = prng.pick(ROUTES);
  const baseVersions = safeBaseVersions(prng);
  const drawn = drawRoute(route, prng);
  return {
    box: {
      octet,
      route,
      rootHash: drawn.rootHash,
      database: drawn.database,
      communityHash: drawn.communityHash,
      services: drawn.services,
      versions: { ...baseVersions, ...drawn.versions },
    },
    forwards: drawn.forwards,
  };
};

/** Forwards pointed at the box they reach. */
const pointedAt = (forwards: readonly PortPair[], boxOctet: number): readonly MissionForward[] =>
  forwards.map(({ publicPort, internalPort }) => ({ publicPort, boxOctet, internalPort }));

export const missionShape = (missionNumber: number): MissionShape => {
  const { stem, keyBoxOctet, shapePrng, front: frontDraw } = drawTopology(missionNumber);
  const route = shapePrng.pick(ROUTES);

  // Versions and decoys on their own streams, so adding either never shifts the topology.
  const versionPrng = createPrng(`mission-versions-${missionNumber}`);
  const keyBoxBase = safeBaseVersions(versionPrng);

  const gatewayVersions: Record<string, string> = {
    ...safeBaseVersions(versionPrng),
    ...safeFirmwareVersions(versionPrng),
  };

  const drawn = drawRoute(route, versionPrng);
  const gatewayAdminHash = versionPrng.pick(SHUT_HASHES);

  // On a stream of its own, so adding it moved no contract's topology, route or hashes.
  const storage = createPrng(`mission-storage-${missionNumber}`).pick(STORAGES);

  // A key in the database is reached as a database user, so off the database route the key
  // box gains one. Drawn after everything above, so a contract's way in reads the same
  // whatever its storage.
  const keptInDatabase = storage === 'database' && drawn.database === null;
  const databaseVersion = keptInDatabase
    ? safeVersionOf(DATABASE_SERVER.package, versionPrng)
    : null;
  const keyBox: BareBox = {
    octet: keyBoxOctet,
    route,
    rootHash: drawn.rootHash,
    database: keptInDatabase ? databaseAccounts(versionPrng) : drawn.database,
    communityHash: drawn.communityHash,
    services:
      databaseVersion === null
        ? drawn.services
        : [...drawn.services, { ...DATABASE_SERVER, version: databaseVersion }],
    versions: {
      ...keyBoxBase,
      ...drawn.versions,
      ...(databaseVersion === null ? {} : { [DATABASE_SERVER.package]: databaseVersion }),
    },
  };

  if (frontDraw !== null) {
    // The gateway forwards only onto the front box. The key box's doors, a database keeping
    // the key among them, are reached from inside.
    const front = drawFrontBox(frontDraw.prng, frontDraw.octet);
    const entry = withDecoys(front.box, front.forwards, missionNumber);
    return {
      missionNumber,
      stem,
      storage,
      keyBox: { ...keyBox, decoys: [] },
      frontBox: entry.box,
      gatewayAdminHash,
      gatewayVersions,
      forwards: pointedAt(entry.forwards, entry.box.octet),
    };
  }

  // A key in the database is reached from outside, behind a forward of its own.
  const realForwards: readonly PortPair[] = keptInDatabase
    ? [...drawn.forwards, { publicPort: DATABASE_SERVER.port, internalPort: DATABASE_SERVER.port }]
    : drawn.forwards;
  const entry = withDecoys(keyBox, realForwards, missionNumber);
  return {
    missionNumber,
    stem,
    storage,
    keyBox: entry.box,
    frontBox: null,
    gatewayAdminHash,
    gatewayVersions,
    forwards: pointedAt(entry.forwards, keyBoxOctet),
  };
};
