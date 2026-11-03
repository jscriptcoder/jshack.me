/**
 * The base filesystem of a contract network's key box — the one machine behind the
 * gateway, the box the contract's key sits on.
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
 *     file gives away on the web route, and uncrackable on the msfconsole route (where the
 *     service hole is the way in);
 *   - an NPC user and `guest` at the world's own odds — shells to look around in that
 *     cannot read the root-only key, which is the point of their being here.
 *
 * The services: sshd always (so the box answers a login once a route lands it, and so the
 * hydra and web routes' forwards reach a real sshd), plus the one exposed service the shape
 * puts on the msfconsole route, on a critical release, and on the web route, on a safe one.
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
  dir,
  file,
  generatePasswd,
  GUEST_HOME_DIR,
  HOME_DIR,
  PASSWD_FILE,
  ROOT_DIR,
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
import { createPrng } from './prng.js';
import { CRACK_CHANCE, drawPasswordHash } from './passwordPools.js';
import { usernamePool } from './pools/usernames.js';
import { missionShape, type MissionService } from '../missions/missionShape.js';
import type { Directory, FileEntry, FileNode } from '../filesystem/types.js';

const pidfile = (content: string, owner: string): FileEntry =>
  file(content, PIDFILE_PERMISSIONS, owner);

/** The default page a web service serves before anyone edits it — a stock install, the
 *  same one a player's own box serves. */
const DEFAULT_PAGE = '<html><body><h1>It works!</h1></body></html>';

export const buildMissionKeyBoxFs = (missionNumber: number): Directory => {
  const shape = missionShape(missionNumber);
  const prng = createPrng(`mission-keybox-${missionNumber}`);
  const username = prng.pick(usernamePool(undefined));

  const passwd = generatePasswd([
    {
      username: 'root',
      passwordHash: shape.keyBoxRootHash,
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

  // sshd always runs; the route's exposed service runs too on the msfconsole and web routes.
  const runningServices: readonly MissionService[] = shape.keyBoxServices;
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

  const tree = dir(
    {
      bin: dir(createBinaryEntries(SYSTEM_UTILITY_NAMES), TRAVERSABLE_DIR),
      boot: bootDir(),
      etc: dir({ passwd: file(passwd, PASSWD_FILE) }, TRAVERSABLE_DIR),
      home: dir(
        {
          [username]: dir({}, HOME_DIR, username),
          guest: dir({}, GUEST_HOME_DIR, 'guest'),
        },
        TRAVERSABLE_DIR,
      ),
      lib: dir(createLibraryEntries(SYSTEM_LIBRARIES), TRAVERSABLE_DIR),
      root: dir({}, ROOT_DIR),
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
          log: dir(
            {
              'access.log': file('', ACCESS_LOG_PERMISSIONS),
              'auth.log': file('', AUTH_LOG_PERMISSIONS),
              'kern.log': file('', KERN_LOG_PERMISSIONS),
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
  return withPackageManifest(tree, { versions: shape.keyBoxVersions });
};
