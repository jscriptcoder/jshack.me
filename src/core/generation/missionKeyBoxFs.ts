/**
 * The base filesystem of a contract network's key box — the box the contract's key sits on —
 * and on a two-hop contract of its front box, the box the gateway forwards onto instead. Both
 * are built the same way from their own records, on streams of their own; what follows says
 * "key box", and holds for the front box but for the key and the storage it never has.
 *
 * Built deliberately, not through the NPC host generator: that generator scatters a box
 * with whatever its name's role draws — a database login, a leaked backup, a listener on
 * an open port, a role config — any of which could open a way in nobody guaranteed. A key
 * box carries exactly what the contract's shape says and nothing else: its three accounts,
 * its running services, and its pinned manifest.
 *
 * It does NOT hold the key, or on a leak route the forgotten file. Those and their paths are
 * the server's; the server lays them into this tree before the journal is replayed, the way
 * the boards' server's list is laid in. This is the box as it generates, which both the
 * client (computing the LAN on a hop) and the server (building the box to read) agree on byte
 * for byte.
 *
 * The accounts:
 *   - `root`, whose hash the shape draws — crackable on the hydra route (the way in), one a
 *     file gives away on a leak route, and uncrackable on the msfconsole route (where the
 *     service hole is the way in);
 *   - an NPC user and `guest` at the world's own odds — shells to look around in that
 *     cannot read the root-only key, which is the point of their being here.
 *
 * The services: sshd always (so the box answers a login once a route lands it, and so the
 * hydra and leak routes' forwards reach a real sshd), plus the one exposed service the shape
 * puts on the msfconsole route, on a critical release, and on a leak route, on a safe one,
 * mysqld on a safe release on a contract keeping its key in a database, and each decoy's
 * daemon on a safe release.
 *
 * A decoy is built exactly as the real door of its kind, minus what the server lays in, so
 * nothing on its surface tells the two apart. A box running vsftpd, the ftp route's or a
 * decoy's, carries what its door reads and lands in: a config letting `anonymous` in, and an
 * empty `/srv/ftp/pub`. An snmp decoy carries its agent config, generated here because it
 * holds no secret: a community somebody can guess and an ordinary contact.
 *
 * A box running a database (the database route, and a contract keeping its key in one) carries
 * a generated application behind exactly two accounts, so the sweep's one login is the only one,
 * and no config, since no door reads it. The server's copy of this datadir adds the tables
 * holding the word and the key, so the one here says neither.
 *
 * The snmp route carries the hashed read-write community a sweep attacks. Its agent config is
 * the server's alone, since that holds both the word and the community a walk can guess. An
 * snmp decoy's read-write hash is one no sweep finds.
 */

import {
  createBinaryEntries,
  LOCALHOST_PREINSTALLED_TOOLS,
  SERVICE_CONTROL_TOOLS,
  SYSTEM_DAEMON_NAMES,
  SYSTEM_UTILITY_NAMES,
} from './binaries.js';
import { createLibraryEntries, SYSTEM_LIBRARIES } from './libraries.js';
import { withPackageManifest } from '../packages/packageManifest.js';
import {
  bootDir,
  DATADIR_FILE,
  dir,
  file,
  generatePasswd,
  GUEST_HOME_DIR,
  HOME_DIR,
  PASSWD_FILE,
  ROOT_DIR,
  SERVICE_CONFIG_FILE,
  SHELL,
  TMP_DIR,
  TRAVERSABLE_DIR,
  WEB_PAGE_FILE,
} from './baseFs.js';
import {
  formatPidfileContent,
  formatProgramPidfileContent,
  PIDFILE_PERMISSIONS,
} from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { binariesForService } from '../packages/aptPackages.js';
import { ACCESS_LOG_PERMISSIONS } from '../logging/accessLog.js';
import { AUTH_LOG_PERMISSIONS } from '../logging/authLog.js';
import { KERN_LOG_PERMISSIONS } from '../logging/kernLog.js';
import { MYSQL_LOG_PERMISSIONS } from '../logging/mysqlLog.js';
import { SNMPD_LOG_PERMISSIONS } from '../logging/snmpdLog.js';
import { VSFTPD_LOG_PERMISSIONS } from '../logging/vsftpdLog.js';
import { createPrng } from './prng.js';
import { CRACK_CHANCE, drawPasswordHash } from './passwordPools.js';
import { formatSnmpdState, SNMPD_STATE_PERMISSIONS } from '../snmp/rwCommunity.js';
import { SNMPD_CONF_PERMISSIONS } from '../snmp/conf.js';
import { GUESSABLE_COMMUNITIES } from '../missions/pools.js';
import { buildApplication } from './databaseApp.js';
import { generateHomeLan } from './generateHomeLan.js';
import { MYSQL_USERNAMES } from './pools/database.js';
import { usernamePool } from './pools/usernames.js';
import { missionEssid } from '../missions/missionNetwork.js';
import {
  missionShape,
  type MissionBox,
  type MissionDatabase,
  type MissionService,
} from '../missions/missionShape.js';
import type { MysqlDatabase } from '../mysql/types.js';
import type { Directory, FileEntry, FileNode } from '../filesystem/types.js';

const pidfile = (content: string, owner: string): FileEntry =>
  file(content, PIDFILE_PERMISSIONS, owner);

/** The default page a web service serves before anyone edits it — a stock install, the
 *  same one a player's own box serves. */
const DEFAULT_PAGE = '<html><body><h1>It works!</h1></body></html>';

/** What the ftp route's daemon is configured to do. It names no `anon_root`, because the
 *  door reads only whether `anonymous` is let in. */
const ANONYMOUS_FTP_CONFIG = 'listen=YES\nlisten_port=21\nanonymous_enable=YES\nlocal_enable=YES\n';

/** An snmp decoy's agent config: a community somebody can guess, as on the snmp route, and the
 *  contact an ordinary device states where the route's states the word. */
const decoyAgentConfig = (community: string): string =>
  [
    '# /etc/snmp/snmpd.conf — SNMP agent configuration',
    `rocommunity ${community}`,
    'syscontact netops@corp.local',
    '',
  ].join('\n');

/** The database as it generates. Its application is on a stream of its own, so nothing about
 *  it can move a draw the box's accounts make. */
const boxDatabase = (
  missionNumber: number,
  octet: number,
  appSeed: string,
  drawn: MissionDatabase,
  account: string,
  applicationAccount: string,
): MysqlDatabase => {
  const essid = missionEssid(missionNumber);
  const lan = generateHomeLan(essid);
  const host = lan.hosts.find((candidate) => candidate.ip === `${lan.subnet}.${octet}`);
  if (host === undefined) throw new Error(`no box at .${octet} on contract ${missionNumber}`);
  // Staffed by the box's own account alone. The world's generator would list each neighbour's
  // NPC, a name the other contract box was never given, since a contract box draws its own.
  const application = buildApplication({
    prng: createPrng(appSeed),
    essid,
    host,
    people: [account],
  });
  return {
    ...application,
    credentials: [
      { username: 'root', passwordHash: drawn.rootHash, userType: 'root' },
      { username: applicationAccount, passwordHash: drawn.accountHash, userType: 'user' },
    ],
  };
};

/** The streams a box's own draws come off: its accounts (and the community and application
 *  account after them), and its database's application. Each box has its own, so neither box
 *  can move a draw the other makes. */
type BoxStreams = { readonly accounts: string; readonly application: string };

const buildMissionBoxFs = (
  missionNumber: number,
  box: MissionBox,
  streams: BoxStreams,
): Directory => {
  const prng = createPrng(streams.accounts);
  const username = prng.pick(usernamePool(undefined));

  const passwd = generatePasswd([
    {
      username: 'root',
      passwordHash: box.rootHash,
      uid: 0,
      gid: 0,
      gecos: 'root',
      home: '/root',
      shell: SHELL,
    },
    {
      username,
      passwordHash: drawPasswordHash(prng, CRACK_CHANCE.npcUser),
      uid: 1000,
      gid: 1000,
      gecos: username,
      home: `/home/${username}`,
      shell: SHELL,
    },
    {
      username: 'guest',
      passwordHash: drawPasswordHash(prng, CRACK_CHANCE.guest),
      uid: 1001,
      gid: 1001,
      gecos: 'guest',
      home: '/home/guest',
      shell: SHELL,
    },
  ]);

  // sshd always runs; the route's exposed service runs too on every route but hydra.
  const runningServices: readonly MissionService[] = box.services;
  const toolchain = runningServices.flatMap(({ service, program }) =>
    binariesForService({ service, daemon: program }),
  );
  const serviceDaemons = toolchain.filter((entry) => entry.isDaemon).map((entry) => entry.binary);
  const serviceTools = toolchain.filter((entry) => !entry.isDaemon).map((entry) => entry.binary);

  const runEntries: Record<string, FileNode> = {
    'sshd.pid': pidfile(formatPidfileContent(SERVICE_CATALOG.ssh, 22), 'root'),
    ...Object.fromEntries(
      runningServices.map((routeService) => [
        `${routeService.program}.pid`,
        pidfile(formatProgramPidfileContent(routeService.program, routeService.port), 'root'),
      ]),
    ),
  };

  const servesWeb = runningServices.some(({ service }) => service === 'http');
  const servesFtp = runningServices.some(({ service }) => service === 'ftp');
  const servesDatabase = runningServices.some(({ service }) => service === 'mysql');
  const runsAgent = runningServices.some(({ service }) => service === 'snmp');
  const lettingAnonymousIn = servesFtp;
  const database =
    box.database === null
      ? null
      : boxDatabase(
          missionNumber,
          box.octet,
          streams.application,
          box.database,
          username,
          prng.pick(MYSQL_USERNAMES),
        );
  // Drawn after every other draw on this stream, so it moved nothing a box already had.
  const decoyAgent = box.decoys.includes('snmp')
    ? decoyAgentConfig(prng.pick(GUESSABLE_COMMUNITIES))
    : null;
  const varLibEntries: Record<string, FileNode> = {
    ...(database === null
      ? {}
      : {
          mysql: dir({ 'data.json': file(JSON.stringify(database), DATADIR_FILE) }, TRAVERSABLE_DIR),
        }),
    ...(box.communityHash === null
      ? {}
      : {
          snmp: dir(
            {
              'snmpd.conf': file(
                formatSnmpdState(box.communityHash),
                SNMPD_STATE_PERMISSIONS,
              ),
            },
            TRAVERSABLE_DIR,
          ),
        }),
  };

  const tree = dir(
    {
      bin: dir(createBinaryEntries(SYSTEM_UTILITY_NAMES), TRAVERSABLE_DIR),
      boot: bootDir(),
      etc: dir(
        {
          passwd: file(passwd, PASSWD_FILE),
          ...(lettingAnonymousIn
            ? { 'vsftpd.conf': file(ANONYMOUS_FTP_CONFIG, SERVICE_CONFIG_FILE) }
            : {}),
          ...(decoyAgent === null
            ? {}
            : {
                snmp: dir(
                  { 'snmpd.conf': file(decoyAgent, SNMPD_CONF_PERMISSIONS) },
                  TRAVERSABLE_DIR,
                ),
              }),
        },
        TRAVERSABLE_DIR,
      ),
      home: dir(
        {
          [username]: dir({}, HOME_DIR, username),
          guest: dir({}, GUEST_HOME_DIR, 'guest'),
        },
        TRAVERSABLE_DIR,
      ),
      lib: dir(createLibraryEntries(SYSTEM_LIBRARIES), TRAVERSABLE_DIR),
      root: dir({}, ROOT_DIR),
      ...(lettingAnonymousIn
        ? {
            srv: dir(
              { ftp: dir({ pub: dir({}, TRAVERSABLE_DIR) }, TRAVERSABLE_DIR) },
              TRAVERSABLE_DIR,
            ),
          }
        : {}),
      tmp: dir({}, TMP_DIR),
      usr: dir(
        {
          bin: dir(
            createBinaryEntries([
              ...LOCALHOST_PREINSTALLED_TOOLS,
              ...SERVICE_CONTROL_TOOLS,
              ...serviceTools,
            ]),
            TRAVERSABLE_DIR,
          ),
          sbin: dir(
            createBinaryEntries([...SYSTEM_DAEMON_NAMES, ...serviceDaemons]),
            TRAVERSABLE_DIR,
          ),
        },
        TRAVERSABLE_DIR,
      ),
      var: dir(
        {
          lib: dir(varLibEntries, TRAVERSABLE_DIR),
          log: dir(
            {
              'access.log': file('', ACCESS_LOG_PERMISSIONS),
              'auth.log': file('', AUTH_LOG_PERMISSIONS),
              'kern.log': file('', KERN_LOG_PERMISSIONS),
              ...(servesFtp ? { 'vsftpd.log': file('', VSFTPD_LOG_PERMISSIONS) } : {}),
              ...(servesDatabase ? { 'mysql.log': file('', MYSQL_LOG_PERMISSIONS) } : {}),
              ...(runsAgent ? { 'snmpd.log': file('', SNMPD_LOG_PERMISSIONS) } : {}),
            },
            TRAVERSABLE_DIR,
          ),
          run: dir(runEntries, TRAVERSABLE_DIR),
          ...(servesWeb
            ? {
                www: dir(
                  { html: dir({ 'index.html': file(DEFAULT_PAGE, WEB_PAGE_FILE) }, TRAVERSABLE_DIR) },
                  TRAVERSABLE_DIR,
                ),
              }
            : {}),
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );
  return withPackageManifest(tree, { versions: box.versions });
};

export const buildMissionKeyBoxFs = (missionNumber: number): Directory =>
  buildMissionBoxFs(missionNumber, missionShape(missionNumber).keyBox, {
    accounts: `mission-keybox-${missionNumber}`,
    application: `mission-database-${missionNumber}`,
  });

/** A two-hop contract's front box: built as the key box is, from its own record and on its own
 *  streams. It holds no key and no storage, since the server lays nothing on it but its own
 *  route's file. */
export const buildMissionFrontBoxFs = (missionNumber: number): Directory => {
  const { frontBox } = missionShape(missionNumber);
  if (frontBox === null) throw new Error(`contract ${missionNumber} has no front box`);
  return buildMissionBoxFs(missionNumber, frontBox, {
    accounts: `mission-frontbox-${missionNumber}`,
    application: `mission-front-database-${missionNumber}`,
  });
};
