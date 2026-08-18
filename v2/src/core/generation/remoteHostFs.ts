/**
 * buildRemoteHostFs — the pure per-host filesystem generator for the LAN's NPC
 * machines (ssh epic). Deterministic from the ESSID + the host, so the same world
 * re-rolls identically every scan, and a host you ssh into is the same operable box
 * every reload — for every occupant of the network, not just for you.
 *
 * Keyed by the ESSID rather than by a viewer because a machine_id alone does not make
 * two occupants agree on a box: the shared journal replays OVER this tree, so if the
 * accounts, credentials, and running services were still drawn per viewer, one
 * occupant's write would land on a machine the other does not have. Who the box is
 * belongs to the box.
 *
 * Two layers ride on the same deterministic seed:
 *   - `/var/run/<pidfile>` for the services a host runs (Slice 2) — the SAME
 *     byte-shape the `sshd` command writes (via `formatPidfileContent`), so every
 *     reader (`nmap`; later `ssh`/`ps`) parses one format. Which services, on what
 *     port, is the service catalog's generation knobs (`placement`/`altPorts`/
 *     `altPortChance`).
 *   - the full base skeleton (Slice 3) — a real, operable Linux box: `/etc/passwd`
 *     (root + a seeded NPC user + guest, EVERY account password-protected, unlike
 *     your own box where your user has none), `/home/<user>`, `/root`, `/tmp`, plus
 *     `/bin`+`/usr/bin`+`/usr/sbin`+`/lib` so the commands the player runs after
 *     `ssh` actually resolve, and an empty `/var/log/auth.log` for the login line.
 *
 * It deliberately mirrors `buildWorkstationBaseFs`'s skeleton — both compose the
 * shared box-FS toolkit in `baseFs.ts` (permission boundaries, node constructors,
 * `generatePasswd`), so the privilege model can't drift between the two boxes. The
 * only difference is who the accounts are.
 */

import { createPrng } from './prng';
import { SERVICE_CATALOG, type ServiceSpec } from '../services/serviceCatalog';
import {
  formatListenerContent,
  formatPidfileContent,
  listenerPidfileName,
  PIDFILE_PERMISSIONS,
  type Listener,
} from '../services/pidfile';
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
  HOME_DIR,
  PASSWD_FILE,
  ROOT_DIR,
  SHELL,
  TMP_DIR,
  TRAVERSABLE_DIR,
  WEB_PAGE_FILE,
} from './baseFs';
import { md5 } from './md5';
import { CRACK_CHANCE, drawPassword } from './passwordPools';
import { pickWebPage } from './pools/webPages';
import { ACCESS_LOG_PERMISSIONS } from '../logging/accessLog';
import { VSFTPD_LOG_PERMISSIONS } from '../logging/vsftpdLog';
import { AUTH_LOG_PERMISSIONS } from '../logging/authLog';
import { KERN_LOG_PERMISSIONS } from '../logging/kernLog';
import type { Directory, FileEntry } from '../filesystem/types';
import type { LanHost } from './generateHomeLan';

const pidfile = (content: string, owner: string): FileEntry =>
  file(content, PIDFILE_PERMISSIONS, owner);


// --- NPC account content (seeded; cracking these is a later epic) ---

/** Common service-account names an NPC box's non-root user is drawn from. */
const HOST_USERNAMES: readonly string[] = [
  'admin',
  'ubuntu',
  'pi',
  'deploy',
  'dev',
  'operator',
  'support',
  'backup',
];

export type HostService = { readonly spec: ServiceSpec; readonly port: number };

/**
 * The ports a listener the world left behind is drawn from — legacy's pool, carried
 * over unchanged so a v2 network reads like the one players already know. Every
 * entry sits outside the service catalog's ports, so a generated backdoor can never
 * land on a port a daemon would have answered on.
 */
export const BACKDOOR_PORTS: readonly number[] = [
  4444, 31337, 8888, 1337, 9999, 5555, 6666, 1234,
];

/** The fraction of NPC hosts carrying a listener nobody who lives on the box put
 *  there. Rare enough that finding one is a find, common enough that sweeping a
 *  strange LAN is worth doing — the discovery loop connect mode exists for. */
const BACKDOOR_PLACEMENT = 0.1;

/**
 * The listener a host is carrying, or null when it carries none — deterministic per
 * `(ESSID, host)`, exactly as the services are, because two occupants scanning one
 * box must find the same open port.
 *
 * Seeded on its OWN stream rather than drawn from the host filesystem's, so adding
 * it leaves every account and password already generated where they were.
 *
 * It runs as the box's own uid-1000 account at USER tier. The account, because a
 * door opening onto a user the box cannot describe is a login as nobody; the tier,
 * because a root shell on every tenth NPC box would hand out for free what the
 * whole cracking curve exists to make you earn.
 */
const hostBackdoor = (essid: string, host: LanHost, username: string): Listener | null => {
  const prng = createPrng(`backdoor-${essid}-${host.ip}`);
  if (prng.next() >= BACKDOOR_PLACEMENT) return null;
  return { port: prng.pick(BACKDOOR_PORTS), user: username, userType: 'user' };
};

/**
 * The services a host runs, with their listen ports — deterministic per
 * `(service, ESSID, host)`. Each service rolls independently against its
 * `placement`; a running service takes `defaultPort` unless a further roll under
 * `altPortChance` picks an `altPorts` entry. Two occupants scanning one box must
 * report the same open ports, so the roll cannot depend on who is scanning.
 */
export const hostServices = (essid: string, host: LanHost): readonly HostService[] =>
  Object.values(SERVICE_CATALOG).flatMap((spec) => {
    const prng = createPrng(`svc-${spec.service}-${essid}-${host.ip}`);
    if (prng.next() >= spec.placement) return [];
    const port =
      spec.altPorts.length > 0 && prng.next() < spec.altPortChance
        ? prng.pick(spec.altPorts)
        : spec.defaultPort;
    return [{ spec, port }];
  });

/**
 * The generated base filesystem for `host` — a full operable Linux box, seeded
 * deterministically from `(essid, host.ip)`. `/var/run` holds one pidfile per running
 * service (empty when the host runs none); `/var/www/html` appears only on a host
 * that serves the web, holding the page a reader gets back; the rest is the skeleton
 * `ssh`'s auth (reads `/etc/passwd`) and browse (`ls`/`cat` over the tree) consume.
 */
export const buildRemoteHostFs = (essid: string, host: LanHost): Directory => {
  const prng = createPrng(`host-fs-${essid}-${host.ip}`);
  const username = prng.pick(HOST_USERNAMES);
  const passwd = generatePasswd([
    {
      username: 'root',
      passwordHash: md5(drawPassword(prng, CRACK_CHANCE.npcRoot)),
      uid: 0,
      gid: 0,
      gecos: 'root',
      home: '/root',
      shell: SHELL,
    },
    {
      username,
      passwordHash: md5(drawPassword(prng, CRACK_CHANCE.npcUser)),
      uid: 1000,
      gid: 1000,
      gecos: username,
      home: `/home/${username}`,
      shell: SHELL,
    },
    {
      username: 'guest',
      passwordHash: md5(drawPassword(prng, CRACK_CHANCE.guest)),
      uid: 1001,
      gid: 1001,
      gecos: 'guest',
      home: '/home/guest',
      shell: SHELL,
    },
  ]);

  const services = hostServices(essid, host);
  const backdoor = hostBackdoor(essid, host, username);
  // A door the world left behind and a door a player planted are the same file, and
  // root owns both: the listener RUNS as the account its line names, but the pidfile
  // is root's to write, exactly as `nc -l` leaves it.
  const pidfiles = {
    ...Object.fromEntries(
      services.map(
        ({ spec, port }) =>
          [spec.pidfile, pidfile(formatPidfileContent(spec, port), spec.runUser)] as const,
      ),
    ),
    ...(backdoor === null
      ? {}
      : { [listenerPidfileName(backdoor.port)]: pidfile(formatListenerContent(backdoor), 'root') }),
  };

  const serves = services.some(({ spec }) => spec === SERVICE_CATALOG.http);
  const servesFtp = services.some(({ spec }) => spec === SERVICE_CATALOG.ftp);

  // A web root exists only where something serves it. Stamping an empty `/var/www`
  // on every box would publish a directory nobody is listening on — and the
  // externally-readable allowlist covers `/var/www/**`, so absence here is what
  // keeps a non-serving host from exposing anything at all.
  const webRoot = serves
    ? {
        www: dir(
          {
            html: dir(
              {
                'index.html': file(
                  pickWebPage({ seed: `web-page-${essid}-${host.ip}`, hostname: host.hostname }),
                  WEB_PAGE_FILE,
                ),
              },
              TRAVERSABLE_DIR,
            ),
          },
          TRAVERSABLE_DIR,
        ),
      }
    : {};

  return dir(
    {
      bin: dir(createBinaryEntries(SYSTEM_UTILITY_NAMES), TRAVERSABLE_DIR),
      boot: bootDir(),
      etc: dir({ passwd: file(passwd, PASSWD_FILE) }, TRAVERSABLE_DIR),
      home: dir({ [username]: dir({}, HOME_DIR, username) }, TRAVERSABLE_DIR),
      lib: dir(createLibraryEntries(SYSTEM_LIBRARIES), TRAVERSABLE_DIR),
      root: dir({}, ROOT_DIR),
      tmp: dir({}, TMP_DIR),
      usr: dir(
        {
          bin: dir(createBinaryEntries([...LOCALHOST_PREINSTALLED_TOOLS, ...SERVICE_CONTROL_TOOLS]), TRAVERSABLE_DIR),
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
              // The access log follows the http service, like the web root: a box
              // nothing can fetch never has a line written, so an empty file would
              // be furniture — and furniture that claims the box once served.
              ...(serves ? { 'access.log': file('', ACCESS_LOG_PERMISSIONS) } : {}),
              // Follows the ftp service for the same reason access.log follows http:
              // a box no client can reach never has a line written, so an empty file
              // there is furniture claiming the box once ran a daemon it never did.
              ...(servesFtp ? { 'vsftpd.log': file('', VSFTPD_LOG_PERMISSIONS) } : {}),
            },
            TRAVERSABLE_DIR,
          ),
          run: dir(pidfiles, TRAVERSABLE_DIR),
          ...webRoot,
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );
};
