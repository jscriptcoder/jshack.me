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
 * to a route of its own from the same six and holds nothing; the key box has no forward, and is
 * worked from a shell on the front box, its doors reached over the LAN on their own ports. A
 * two-hop contract's key box keeps the route, hashes and storage it would have had with one hop,
 * and runs decoys of its own, so a scan from the front box does not tell its route either: two
 * or three doors besides sshd, the real ones first.
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
import {
  drawPasswordHash,
  CRACK_CHANCE,
  UNCRACKABLE_HASHES,
  WHITE_HAT_HASHES,
} from '../generation/passwordPools.js';
import {
  FIRMWARE_VENDORS,
  firmwarePackageOf,
  type FirmwareVendor,
} from '../packages/packageVersions.js';
import { firmwareExploitOutcome } from '../cve/firmwareExploit.js';
import { LEAKABLE_HASHES, SHUT_HASHES } from './leakablePool.js';
import { TARGET_STEMS } from './pools.js';
import { portforwardJob, type PortforwardService } from './portforwardJob.js';
import { closeDoorJob } from './closeDoorJob.js';

/** The game day a route's hole must have published on or before: the day slice 1 ships.
 *  Fixed, never the live clock — moving it changes every existing contract's network. */
export const MISSION_ROUTE_DAY = 111;

/** Each route equally likely. Adding one re-rolls every contract's route, though never
 *  its address, key or key path. */
const ROUTES = ['hydra', 'msfconsole', 'web', 'ftp', 'mysql', 'snmp'] as const;

/** The ways a portforward job's router falls, each equally likely. */
const ROUTER_ROUTES = ['hydra', 'msfconsole'] as const;

export type MissionRoute = (typeof ROUTES)[number];

/** Where the key box keeps the key, each equally likely: a root-only file, that file
 *  encrypted with its passphrase compiled into a program beside it, or a row in the box's
 *  database. Independent of the route: any way in meets any of the three. */
const STORAGES = ['file', 'gpg', 'database'] as const;

export type MissionStorage = (typeof STORAGES)[number];

/** Where a tamper or wipe job's records box keeps them, each equally likely: a table in its
 *  database, or a root-only CSV file. */
const RECORDS_STORAGES = ['database', 'file'] as const;

export type RecordsStorage = (typeof RECORDS_STORAGES)[number];

/** Where a tamper or wipe job keeps its records. On a stream of its own, so drawing it moved no
 *  contract's topology, route, hashes, records or terms. */
export const recordsStorage = (missionNumber: number): RecordsStorage =>
  createPrng(`mission-records-storage-${missionNumber}`).pick(RECORDS_STORAGES);

/** The doors a decoy can be: every kind some route is won through, since a port that is never
 *  a way in is dismissed at a glance and blurs nothing. */
const DECOY_KINDS = ['ssh', 'web', 'ftp', 'mysql', 'snmp'] as const;

export type MissionDecoy = (typeof DECOY_KINDS)[number];

/** How many forwards a gateway has, decoys filling the gap above the real ones. A contract has
 *  one to three real forwards, so every route reaches every count and the count says nothing. */
const FORWARD_COUNTS = [3, 4] as const;

/** The doors a two-hop key box can run that lead nowhere. Never ssh: sshd runs on every box, so
 *  its door is always there and blurs nothing. */
const INSIDE_DECOY_KINDS = ['web', 'ftp', 'mysql', 'snmp'] as const;

/** How many service doors a two-hop key box runs besides sshd, decoys filling the gap above the
 *  real ones. It has none to two, so every route reaches every count its real doors allow. */
const INSIDE_DOOR_COUNTS = [2, 3] as const;

/** The share of contracts whose key box sits behind a front box. */
const TWO_HOP_SHARE = 1 / 3;

/** What a contract asks for: a key the client wants brought back, a record on the box the
 *  client wants changed, the box itself taken down for good, a file on it brought back, a
 *  listener left on it, the client's own file put on it, a port on the gateway forwarded onto
 *  it, the password of its root, a file on it destroyed, a table of its records wiped, or a
 *  listener left on the front box and the box behind it taken down, a file on it destroyed or a
 *  table of its records wiped. A tamper, sabotage,
 *  backdoor, infiltrate, credential, destroy or wipe job is proved by the box itself when the
 *  contractor mails in, a chain job by both its boxes, a portforward job by the gateway, a file
 *  job by the file the mail carries. */
export type MissionKind =
  | 'key'
  | 'tamper'
  | 'sabotage'
  | 'file'
  | 'backdoor'
  | 'infiltrate'
  | 'portforward'
  | 'credential'
  | 'destroy'
  | 'wipe'
  | 'chain'
  | 'cleanup'
  | 'closedoor';

/** Where the one draw on a contract's kind changes, in 360360ths. Each kind takes a thirteenth.
 *  Every newer kind was carved from the edges of the ones before it, so a contract is the kind it was
 *  or has become the newer one, and none turned from one older kind into another: file jobs fill
 *  the gaps tamper, sabotage and key left as they shrank from thirds to quarters, backdoor jobs
 *  the twentieth each of the four gave up as they shrank to fifths, infiltrate jobs the thirtieth
 *  each of the five gave up at the top of one piece as they shrank to sixths, portforward jobs
 *  the forty-second each of the six gave up the same way as they shrank to sevenths, credential
 *  jobs the fifty-sixth each of the seven gave up the same way as they shrank to eighths, destroy
 *  jobs the seventy-second each of the eight gave up the same way as they shrank to ninths, wipe
 *  jobs the ninetieth each of the nine gave up the same way as they shrank to tenths, chain jobs
 *  the hundred-and-tenth each of the ten gave up the same way as they shrank to elevenths,
 *  cleanup jobs the hundred-and-thirty-second each of the eleven gave up at the top of its largest
 *  piece, the lowest on a tie (so the top of the draw stays portforward), as they shrank to
 *  twelfths, and close-the-door jobs the hundred-and-fifty-sixth each of the twelve gave up the
 *  same way as they shrank to thirteenths. 27720ths do not split into thirteenths, so the draw
 *  is in thirteen times as many. A draw past the last cut, the top forty-second, is a portforward
 *  job. */
const KIND_CUTS: readonly (readonly [below: number, kind: MissionKind])[] = [
  [27720, 'tamper'],
  [30030, 'closedoor'],
  [30450, 'cleanup'],
  [32760, 'closedoor'],
  [33306, 'chain'],
  [36036, 'cleanup'],
  [36764, 'wipe'],
  [37730, 'chain'],
  [40040, 'closedoor'],
  [41041, 'destroy'],
  [42315, 'wipe'],
  [45045, 'cleanup'],
  [47476, 'credential'],
  [49170, 'wipe'],
  [51480, 'closedoor'],
  [51779, 'portforward'],
  [55055, 'chain'],
  [56784, 'destroy'],
  [60060, 'chain'],
  [62361, 'infiltrate'],
  [65637, 'chain'],
  [68796, 'credential'],
  [72072, 'chain'],
  [75075, 'backdoor'],
  [78780, 'credential'],
  [81510, 'cleanup'],
  [83655, 'portforward'],
  [87780, 'credential'],
  [90090, 'closedoor'],
  [101400, 'file'],
  [104676, 'chain'],
  [108680, 'wipe'],
  [110955, 'destroy'],
  [113685, 'cleanup'],
  [120120, 'credential'],
  [147840, 'sabotage'],
  [150150, 'closedoor'],
  [152880, 'cleanup'],
  [156156, 'chain'],
  [160160, 'wipe'],
  [162855, 'destroy'],
  [165165, 'closedoor'],
  [171600, 'credential'],
  [176176, 'portforward'],
  [180180, 'wipe'],
  [187187, 'infiltrate'],
  [192192, 'destroy'],
  [201929, 'backdoor'],
  [205205, 'chain'],
  [210210, 'destroy'],
  [226620, 'file'],
  [228930, 'closedoor'],
  [231660, 'cleanup'],
  [237510, 'portforward'],
  [240240, 'cleanup'],
  [248248, 'infiltrate'],
  [252252, 'wipe'],
  [261226, 'backdoor'],
  [263536, 'closedoor'],
  [266266, 'cleanup'],
  [270270, 'wipe'],
  [297990, 'key'],
  [300300, 'closedoor'],
  [303030, 'cleanup'],
  [306306, 'chain'],
  [310310, 'wipe'],
  [315315, 'destroy'],
  [316745, 'credential'],
  [321750, 'destroy'],
  [328020, 'portforward'],
  [330330, 'closedoor'],
  [337302, 'infiltrate'],
  [339612, 'closedoor'],
  [342342, 'cleanup'],
  [348348, 'backdoor'],
  [351780, 'infiltrate'],
];

/** Whether a contract asks for a key, a changed record, a machine taken down, a file brought
 *  back, a listener left, a file slipped in, a port opened onto a machine, a root login, a file
 *  destroyed, a table wiped, or a listener left and a machine taken down. Drawn on a stream of its own, so a contract that keeps its kind
 *  keeps its network and its terms to the byte. */
export const missionKind = (missionNumber: number): MissionKind => {
  const draw = createPrng(`mission-kind-${missionNumber}`).next() * 360360;
  return KIND_CUTS.find(([below]) => draw < below)?.[1] ?? 'portforward';
};

/** What a chain job's last step asks of the machine inside, each equally likely: a sabotage job's
 *  outage, a destroy job's file gone, or a wipe job's records emptied. Each is the kind whose
 *  box, briefing and check the step borrows. */
const CHAIN_FINALS = ['sabotage', 'destroy', 'wipe'] as const satisfies readonly MissionKind[];

export type ChainFinal = (typeof CHAIN_FINALS)[number];

/** The last step a chain job asks for, on a stream of its own, so drawing it moved no chain job's
 *  port, pay, client or front box. */
export const chainFinal = (missionNumber: number): ChainFinal =>
  createPrng(`mission-chain-final-${missionNumber}`).pick(CHAIN_FINALS);

/** What the box in a contract's key-box slot is for: the contract's own kind, or on a chain job
 *  the kind its last step borrows, whose file or records the box holds as that kind's would. */
export const keyBoxKind = (missionNumber: number): Exclude<MissionKind, 'chain'> => {
  const kind = missionKind(missionNumber);
  return kind === 'chain' ? chainFinal(missionNumber) : kind;
};

/** Where a contract's key box keeps what its job is about, each kind on a stream of its own. */
const storageOf = (kind: MissionKind, missionNumber: number): MissionStorage | null => {
  if (
    kind === 'sabotage' ||
    kind === 'file' ||
    kind === 'backdoor' ||
    kind === 'infiltrate' ||
    kind === 'credential' ||
    kind === 'destroy'
  ) {
    return null;
  }
  if (kind === 'tamper' || kind === 'wipe') return recordsStorage(missionNumber);
  return createPrng(`mission-storage-${missionNumber}`).pick(STORAGES);
};

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
  /** The one guaranteed way to root it, or null on a box nobody breaks into: a portforward job's
   *  target, which nobody roots, the job being the router's forward onto it, and a cleanup job's
   *  boxes, whose root the client hands over. */
  readonly route: MissionRoute | null;
  /** Its `root` password hash: crackable on the hydra route, one a file can leak on a leak
   *  route, one that stays shut on the msfconsole route, and on a cleanup job's boxes one of the
   *  white-hat words its briefing hands over. */
  readonly rootHash: string;
  /** The hashes guarding its database, on the database route, on every contract that keeps
   *  its key in one, and behind a database decoy. */
  readonly database: MissionDatabase | null;
  /** The hash of the read-write community: one a sweep finds on the snmp route, and one no
   *  sweep finds behind an snmp decoy. */
  readonly communityHash: string | null;
  /** The hash of the password its cache answers to, on a portforward job's cache server, one
   *  that stays shut. Null on every box that runs no cache. */
  readonly storeHash: string | null;
  /** The services it runs: the route's service (on every route but hydra), then the database
   *  on a contract keeping its key in one, then the decoys' daemons, each already on its
   *  chosen release. */
  readonly services: readonly MissionService[];
  /** Versions to pin on it, package to version — every service it runs and every library it
   *  carries. */
  readonly versions: Readonly<Record<string, string>>;
  /** The doors on it that lead nowhere, in the order their forwards follow the real ones, or on a
   *  two-hop key box, which has no forwards, in the order their daemons follow the real ones.
   *  Each is built as the real door of its kind is, minus what the server lays in. */
  readonly decoys: readonly MissionDecoy[];
};

/** Which of a contract's boxes: the one holding the key, or a two-hop contract's front box. */
export type MissionBoxRole = 'key' | 'front';

/** One box of one contract, as the server names it from the machine a door reached. */
export type MissionBoxRef = { readonly missionNumber: number; readonly role: MissionBoxRole };

export type MissionShape = {
  readonly missionNumber: number;
  readonly kind: MissionKind;
  readonly stem: string;
  /** Where the key box keeps what the job is about: the key, or on a tamper job the records,
   *  which sit in its database or in a file. A sabotage job's target keeps nothing: the job is
   *  the box itself. Nor does a file job's: its one file is laid by the server, from the secret. */
  readonly storage: MissionStorage | null;
  /** The box holding the key, or on a tamper job the records. */
  readonly keyBox: MissionBox;
  /** On a two-hop contract, the box the gateway forwards onto instead of the key box: it falls
   *  to a route of its own and holds nothing, and the key box is worked from a shell on it.
   *  Null on a single-hop contract. */
  readonly frontBox: MissionBox | null;
  /** The gateway's `root` ("admin") password hash — uncrackable and never one a file can leak,
   *  so the gateway is a box the route passes through rather than one to break into, except on
   *  a portforward job, where it is crackable: the router is the job. */
  readonly gatewayAdminHash: string;
  /** How the gateway falls on a portforward job, half and half: `hydra`, its admin swept on
   *  its own `:22`, or `msfconsole`, its firmware's hole fired at that port. Null on every
   *  other kind, whose gateway does not fall. */
  readonly routerRoute: 'hydra' | 'msfconsole' | null;
  /** The vendor a gateway on the msfconsole route runs, one with a firmware release whose hole
   *  lands a root shell. Null on every other gateway, which runs whatever its builder draws. */
  readonly routerVendor: FirmwareVendor | null;
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

const CACHE_SERVER: RouteCandidate = {
  service: 'redis',
  package: 'redis',
  program: 'redis-server',
  port: 6379,
};

/** The daemon a portforward job's target runs for the service the client wants reached, or none
 *  for ssh, whose sshd runs on every box. */
const PORTFORWARD_SERVICES: Readonly<Record<PortforwardService, RouteCandidate | null>> = {
  mysql: DATABASE_SERVER,
  redis: CACHE_SERVER,
  web: WEB_SERVER,
  ssh: null,
};

/** The decoy whose forward would already reach the service a portforward job wants reached, and
 *  so is never drawn on its target. None for redis, which no decoy is. */
const EXPOSING_DECOYS: Readonly<Record<PortforwardService, MissionDecoy | null>> = {
  mysql: 'mysql',
  redis: null,
  web: 'web',
  ssh: 'ssh',
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

/** The vendors with a firmware release, published by the cutoff, whose hole is `critical` or
 *  `high` and lands a full shell: on a router, which holds only root, a root shell. */
const ROOT_SHELL_VENDORS: readonly FirmwareVendor[] = ['cisco', 'openwrt', 'pfsense', 'ubiquiti'];

/** The version of `vendor`'s newest firmware release whose hole is `critical` or `high` and,
 *  live by the cutoff, lands a full shell — the msfconsole router's release. A hole not yet
 *  published by then has no outcome, so the timeline's one release past the cutoff never
 *  qualifies. Throws when there is none: a build-time invariant, caught by the timeline test. */
const rootShellFirmwareVersion = (vendor: FirmwareVendor): string => {
  const key = firmwarePackageOf(vendor);
  const rootShells = packageTimeline(key, MISSION_ROUTE_DAY).filter(
    (release) =>
      (release.severity === 'critical' || release.severity === 'high') &&
      firmwareExploitOutcome(new Map([[key, release.version]]), MISSION_ROUTE_DAY)?.effect ===
        'shell_full',
  );
  const newest = rootShells[rootShells.length - 1];
  if (newest === undefined) throw new Error(`no root-shell firmware for ${vendor}`);
  return newest.version;
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

/** `box` running `decoys`, each the real door's daemon on a safe release, drawn on `prng`. */
const withDecoyDaemons = (
  box: BareBox,
  decoys: readonly MissionDecoy[],
  prng: Prng,
): MissionBox => {
  const services = [...box.services];
  const versions = { ...box.versions };
  for (const decoy of decoys) {
    const service = DECOY_SERVICES[decoy];
    if (service === null) continue;
    const version = safeVersionOf(service.package, prng);
    services.push({ ...service, version });
    versions[service.package] = version;
  }
  return {
    ...box,
    services,
    versions,
    // The door lets a sweep in as far as the real one would, onto a database holding nothing.
    database: decoys.includes('mysql') ? databaseAccounts(prng) : box.database,
    // A read-write community shuts the box's ports without root, so a decoy's never falls.
    communityHash: decoys.includes('snmp') ? prng.pick(SHUT_HASHES) : box.communityHash,
    decoys,
  };
};

/** A two-hop key box with its inside decoys: doors filling the services it runs besides sshd to
 *  two or three, so a scan from the front box does not tell its route. Drawn last on a stream of
 *  its own, so they moved nothing a contract already had. */
const withInsideDecoys = (box: BareBox, missionNumber: number): MissionBox => {
  const decoyPrng = createPrng(`mission-inside-decoys-${missionNumber}`);
  const doorCount = decoyPrng.pick(INSIDE_DOOR_COUNTS);
  const unrun = INSIDE_DECOY_KINDS.filter(
    (decoy) => !box.services.some(({ port }) => port === decoyForward(decoy).internalPort),
  );
  const decoys = decoyPrng.pickN(unrun, doorCount - box.services.length);
  return withDecoyDaemons(box, decoys, decoyPrng);
};

/** The box the gateway forwards onto, with its decoys: doors filling its forwards to three or
 *  four, each running the real door's daemon, and never `barred`. Drawn last on a stream of its
 *  own, so decoys moved nothing a contract already had. */
const withDecoys = (
  box: BareBox,
  forwards: readonly PortPair[],
  missionNumber: number,
  barred: MissionDecoy | null = null,
): { readonly box: MissionBox; readonly forwards: readonly PortPair[] } => {
  const decoyPrng = createPrng(`mission-decoys-${missionNumber}`);
  const forwardCount = decoyPrng.pick(FORWARD_COUNTS);
  const unforwarded = DECOY_KINDS.filter(
    (decoy) =>
      decoy !== barred &&
      !forwards.some(({ publicPort }) => publicPort === decoyForward(decoy).publicPort),
  );
  const decoys = decoyPrng.pickN(unforwarded, forwardCount - forwards.length);
  return {
    box: withDecoyDaemons(box, decoys, decoyPrng),
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
  // On a stream of its own, so a contract that stays single-hop keeps its network to the byte. A
  // portforward or close-the-door job is never two-hop: the router is the job, and the target sits
  // right behind it. A chain job always is: its first step is on the front box and its last on the
  // machine behind.
  const kind = missionKind(missionNumber);
  const twoHop =
    kind === 'chain' ||
    (createPrng(`mission-template-${missionNumber}`).next() < TWO_HOP_SHARE &&
      kind !== 'portforward' &&
      kind !== 'closedoor');
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
      storeHash: null,
      services: drawn.services,
      versions: { ...baseVersions, ...drawn.versions },
    },
    forwards: drawn.forwards,
  };
};

/** Forwards pointed at the box they reach. */
const pointedAt = (forwards: readonly PortPair[], boxOctet: number): readonly MissionForward[] =>
  forwards.map(({ publicPort, internalPort }) => ({ publicPort, boxOctet, internalPort }));

/** A portforward job's network: the router, which falls to its own route, and right behind it
 *  the machine the client wants reached, sealed. The machine runs the one service the job names
 *  on a safe release behind a shut login, keeps nothing and has no route, and the router
 *  forwards only decoys onto it, none of the kind that would already reach that service. The
 *  router falls half the time to a crackable admin (`hydra`) and half the time, its admin shut,
 *  to a firmware release whose hole lands a root shell (`msfconsole`), on a vendor that has one.
 *  The machine and the router's way in are each drawn on a stream of their own. */
/** A machine a client wants reached from outside, or shut off from it, which nobody roots: no
 *  route, root and every store behind it shut, and its one service on a safe release. */
const sealedTarget = ({
  service,
  octet,
  base,
  prng,
}: {
  readonly service: PortforwardService;
  readonly octet: number;
  readonly base: Readonly<Record<string, string>>;
  readonly prng: Prng;
}): BareBox => {
  const daemon = PORTFORWARD_SERVICES[service];
  const running =
    daemon === null ? [] : [{ ...daemon, version: safeVersionOf(daemon.package, prng) }];
  return {
    octet,
    route: null,
    rootHash: prng.pick(SHUT_HASHES),
    database:
      service === 'mysql'
        ? { accountHash: prng.pick(SHUT_HASHES), rootHash: prng.pick(SHUT_HASHES) }
        : null,
    communityHash: null,
    storeHash: service === 'redis' ? prng.pick(SHUT_HASHES) : null,
    services: running,
    versions: {
      ...base,
      ...Object.fromEntries(running.map((daemonRun) => [daemonRun.package, daemonRun.version])),
    },
  };
};

const portforwardShape = ({
  missionNumber,
  stem,
  keyBoxOctet,
  keyBoxBase,
  gatewayVersions,
}: {
  readonly missionNumber: number;
  readonly stem: string;
  readonly keyBoxOctet: number;
  readonly keyBoxBase: Readonly<Record<string, string>>;
  readonly gatewayVersions: Readonly<Record<string, string>>;
}): MissionShape => {
  const { service } = portforwardJob(missionNumber).machine;
  const target = sealedTarget({
    service,
    octet: keyBoxOctet,
    base: keyBoxBase,
    prng: createPrng(`mission-portforward-target-${missionNumber}`),
  });
  const entry = withDecoys(target, [], missionNumber, EXPOSING_DECOYS[service]);
  const routerPrng = createPrng(`mission-router-${missionNumber}`);
  const routerRoute = routerPrng.pick(ROUTER_ROUTES);
  const routerVendor = routerRoute === 'msfconsole' ? routerPrng.pick(ROOT_SHELL_VENDORS) : null;
  return {
    missionNumber,
    kind: 'portforward',
    stem,
    storage: null,
    keyBox: entry.box,
    frontBox: null,
    gatewayAdminHash:
      routerRoute === 'hydra' ? crackableHash(routerPrng) : routerPrng.pick(SHUT_HASHES),
    routerRoute,
    routerVendor,
    gatewayVersions:
      routerVendor === null
        ? gatewayVersions
        : {
            ...gatewayVersions,
            [firmwarePackageOf(routerVendor)]: rootShellFirmwareVersion(routerVendor),
          },
    forwards: pointedAt(entry.forwards, keyBoxOctet),
  };
};

/** A cleanup job's network: the client lets the contractor in, so no box is broken into. Every
 *  box's root is one of the white-hat words the briefing hands over, which no other door holds,
 *  and every box runs nothing but sshd, on safe releases, besides its decoys. The gateway forwards
 *  the public `:2222` onto the sshd of the box the first login is for: the target, or on two hops
 *  the front box, from which the target is reached on its own `:22`. The logins are drawn on a
 *  stream of their own, and the front box's base on its own as every two-hop contract's is. */
const cleanupShape = ({
  missionNumber,
  stem,
  keyBoxOctet,
  keyBoxBase,
  gatewayVersions,
  frontDraw,
}: {
  readonly missionNumber: number;
  readonly stem: string;
  readonly keyBoxOctet: number;
  readonly keyBoxBase: Readonly<Record<string, string>>;
  readonly gatewayVersions: Readonly<Record<string, string>>;
  readonly frontDraw: { readonly prng: Prng; readonly octet: number } | null;
}): MissionShape => {
  const loginPrng = createPrng(`mission-cleanup-login-${missionNumber}`);
  const handedOver = (octet: number, versions: Readonly<Record<string, string>>): BareBox => ({
    octet,
    route: null,
    rootHash: loginPrng.pick(WHITE_HAT_HASHES),
    database: null,
    communityHash: null,
    storeHash: null,
    services: [],
    versions,
  });
  const target = handedOver(keyBoxOctet, keyBoxBase);
  const common = {
    missionNumber,
    kind: 'cleanup',
    stem,
    storage: null,
    gatewayAdminHash: loginPrng.pick(SHUT_HASHES),
    routerRoute: null,
    routerVendor: null,
    gatewayVersions,
  } as const;
  if (frontDraw === null) {
    const entry = withDecoys(target, [SSH_FORWARD], missionNumber);
    return {
      ...common,
      keyBox: entry.box,
      frontBox: null,
      forwards: pointedAt(entry.forwards, keyBoxOctet),
    };
  }
  const front = handedOver(frontDraw.octet, safeBaseVersions(frontDraw.prng));
  const entry = withDecoys(front, [SSH_FORWARD], missionNumber);
  return {
    ...common,
    keyBox: withInsideDecoys(target, missionNumber),
    frontBox: entry.box,
    forwards: pointedAt(entry.forwards, entry.box.octet),
  };
};

/** A close-the-door job's network: someone forwarded a public port onto the machine's service,
 *  and the client hands over the router to shut it. The target is sealed as a portforward job's
 *  is; the router's root is one of the white-hat words the briefing hands over, with no route
 *  and its firmware on safe releases. The rogue forward stands at a drawn place among the decoys'
 *  forwards, so its line in the router's rules says nothing. Single-hop always: the door is on
 *  the router, so a front box would add nothing. */
const closeDoorShape = ({
  missionNumber,
  stem,
  keyBoxOctet,
  keyBoxBase,
  gatewayVersions,
}: {
  readonly missionNumber: number;
  readonly stem: string;
  readonly keyBoxOctet: number;
  readonly keyBoxBase: Readonly<Record<string, string>>;
  readonly gatewayVersions: Readonly<Record<string, string>>;
}): MissionShape => {
  const { machine, publicPort } = closeDoorJob(missionNumber);
  const target = sealedTarget({
    service: machine.service,
    octet: keyBoxOctet,
    base: keyBoxBase,
    prng: createPrng(`mission-closedoor-target-${missionNumber}`),
  });
  const rogue: PortPair = { publicPort, internalPort: machine.insidePort };
  const entry = withDecoys(target, [rogue], missionNumber, EXPOSING_DECOYS[machine.service]);
  const decoyForwards = entry.forwards.slice(1);
  const place = createPrng(`mission-closedoor-place-${missionNumber}`).nextInt(
    0,
    decoyForwards.length,
  );
  return {
    missionNumber,
    kind: 'closedoor',
    stem,
    storage: null,
    keyBox: entry.box,
    frontBox: null,
    gatewayAdminHash: createPrng(`mission-closedoor-login-${missionNumber}`).pick(WHITE_HAT_HASHES),
    routerRoute: null,
    routerVendor: null,
    gatewayVersions,
    forwards: pointedAt(
      [...decoyForwards.slice(0, place), rogue, ...decoyForwards.slice(place)],
      keyBoxOctet,
    ),
  };
};

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

  if (missionKind(missionNumber) === 'portforward') {
    return portforwardShape({ missionNumber, stem, keyBoxOctet, keyBoxBase, gatewayVersions });
  }
  if (missionKind(missionNumber) === 'closedoor') {
    return closeDoorShape({ missionNumber, stem, keyBoxOctet, keyBoxBase, gatewayVersions });
  }
  if (missionKind(missionNumber) === 'cleanup') {
    return cleanupShape({
      missionNumber,
      stem,
      keyBoxOctet,
      keyBoxBase,
      gatewayVersions,
      frontDraw,
    });
  }

  const drawn = drawRoute(route, versionPrng);
  const gatewayAdminHash = versionPrng.pick(SHUT_HASHES);

  // On a stream of its own, so adding it moved no contract's topology, route or hashes. A tamper
  // job's records in the box's database are then reached as a key kept in one is; in a file, by
  // the route's root.
  const kind = missionKind(missionNumber);
  const storage = storageOf(keyBoxKind(missionNumber), missionNumber);

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
    storeHash: null,
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
      kind,
      stem,
      storage,
      keyBox: withInsideDecoys(keyBox, missionNumber),
      frontBox: entry.box,
      gatewayAdminHash,
      routerRoute: null,
      routerVendor: null,
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
    kind,
    stem,
    storage,
    keyBox: entry.box,
    frontBox: null,
    gatewayAdminHash,
    routerRoute: null,
    routerVendor: null,
    gatewayVersions,
    forwards: pointedAt(entry.forwards, keyBoxOctet),
  };
};
