/**
 * buildRemoteHostFs — the pure per-host filesystem generator for the LAN's NPC
 * machines (ssh epic). Deterministic from the identity pubkey + ESSID + the host,
 * so the same world re-rolls identically every scan, and a host you ssh into is
 * the same operable box every reload.
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
 * It deliberately mirrors `buildWorkstationBaseFs`'s skeleton (the shared
 * `generatePasswd` primitive, the same permission boundaries) — the difference is
 * who the accounts are. (The shared FS-building constants are duplicated here for
 * now; a `baseFs` extraction is the refactor once both consumers are green.)
 */

import { createPrng } from './prng';
import { SERVICE_CATALOG, type ServiceSpec } from '../services/serviceCatalog';
import { formatPidfileContent } from '../services/pidfile';
import {
  createBinaryEntries,
  LOCALHOST_PREINSTALLED_TOOLS,
  SYSTEM_DAEMON_NAMES,
  SYSTEM_UTILITY_NAMES,
} from './binaries';
import { createLibraryEntries, SYSTEM_LIBRARIES } from './libraries';
import { generatePasswd } from './workstationFs';
import { md5 } from './md5';
import { AUTH_LOG_PERMISSIONS } from '../logging/authLog';
import type { Directory, FileEntry, FileNode, FilePermissions } from '../filesystem/types';
import type { LanHost } from './generateHomeLan';

// --- Permission boundaries (mirror buildWorkstationBaseFs) ---

const TRAVERSABLE_DIR: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};
/** `/etc/passwd`: root + user read only — passwords live inline (no /etc/shadow),
 *  so leaking passwd is a real privilege boundary; guest must not read it. */
const PASSWD_FILE: FilePermissions = { read: ['root', 'user'], write: ['root'], execute: ['root'] };
const HOME_DIR: FilePermissions = {
  read: ['root', 'user'],
  write: ['root', 'user'],
  execute: ['root', 'user'],
};
const ROOT_DIR: FilePermissions = { read: ['root'], write: ['root'], execute: ['root'] };
const TMP_DIR: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'user', 'guest'],
  execute: ['root', 'user', 'guest'],
};
/** A pidfile: world-readable, root-writable, never executed. */
const PIDFILE_PERMS: FilePermissions = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

const file = (content: string, perms: FilePermissions, owner = 'root'): FileEntry => ({
  kind: 'file',
  content,
  owner,
  perms,
});

const dir = (
  entries: Readonly<Record<string, FileNode>>,
  perms: FilePermissions,
  owner = 'root',
): Directory => ({
  kind: 'directory',
  owner,
  perms,
  entries: new Map(Object.entries(entries)),
});

const pidfile = (content: string, owner: string): FileEntry => file(content, PIDFILE_PERMS, owner);

// --- NPC account content (seeded; cracking these is a later epic) ---

const SHELL = '/bin/bash';

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

/** Weak passwords the seeded PRNG picks from for each NPC account — just data,
 *  mirroring the workstation guest-password pool (a later hydra/wordlist epic is
 *  how a player would actually obtain one). */
const WEAK_PASSWORDS: readonly string[] = [
  'guest',
  'password',
  'letmein',
  'changeme',
  'welcome1',
  'qwerty123',
  'trustno1',
  'sunshine',
  'admin123',
  'root1234',
];

export type HostService = { readonly spec: ServiceSpec; readonly port: number };

/**
 * The services a host runs, with their listen ports — deterministic per
 * `(service, pubkey, ESSID, host)`. Each service rolls independently against its
 * `placement`; a running service takes `defaultPort` unless a further roll under
 * `altPortChance` picks an `altPorts` entry.
 */
export const hostServices = (
  seedPubkeyHex: string,
  essid: string,
  host: LanHost,
): readonly HostService[] =>
  Object.values(SERVICE_CATALOG).flatMap((spec) => {
    const prng = createPrng(`svc-${spec.service}-${seedPubkeyHex}-${essid}-${host.ip}`);
    if (prng.next() >= spec.placement) return [];
    const port =
      spec.altPorts.length > 0 && prng.next() < spec.altPortChance
        ? prng.pick(spec.altPorts)
        : spec.defaultPort;
    return [{ spec, port }];
  });

/**
 * The generated base filesystem for `host` — a full operable Linux box, seeded
 * deterministically from `(pubkey, essid, host.ip)`. `/var/run` holds one pidfile
 * per running service (empty when the host runs none); the rest is the skeleton
 * `ssh`'s auth (reads `/etc/passwd`) and browse (`ls`/`cat` over the tree) consume.
 */
export const buildRemoteHostFs = (
  seedPubkeyHex: string,
  essid: string,
  host: LanHost,
): Directory => {
  const prng = createPrng(`host-fs-${seedPubkeyHex}-${essid}-${host.ip}`);
  const username = prng.pick(HOST_USERNAMES);
  const passwd = generatePasswd([
    {
      username: 'root',
      passwordHash: md5(prng.pick(WEAK_PASSWORDS)),
      uid: 0,
      gid: 0,
      gecos: 'root',
      home: '/root',
      shell: SHELL,
    },
    {
      username,
      passwordHash: md5(prng.pick(WEAK_PASSWORDS)),
      uid: 1000,
      gid: 1000,
      gecos: username,
      home: `/home/${username}`,
      shell: SHELL,
    },
    {
      username: 'guest',
      passwordHash: md5(prng.pick(WEAK_PASSWORDS)),
      uid: 1001,
      gid: 1001,
      gecos: 'guest',
      home: '/home/guest',
      shell: SHELL,
    },
  ]);

  const pidfiles = Object.fromEntries(
    hostServices(seedPubkeyHex, essid, host).map(
      ({ spec, port }) =>
        [spec.pidfile, pidfile(formatPidfileContent(spec, port), spec.runUser)] as const,
    ),
  );

  return dir(
    {
      bin: dir(createBinaryEntries(SYSTEM_UTILITY_NAMES), TRAVERSABLE_DIR),
      etc: dir({ passwd: file(passwd, PASSWD_FILE) }, TRAVERSABLE_DIR),
      home: dir({ [username]: dir({}, HOME_DIR, username) }, TRAVERSABLE_DIR),
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
          log: dir({ 'auth.log': file('', AUTH_LOG_PERMISSIONS) }, TRAVERSABLE_DIR),
          run: dir(pidfiles, TRAVERSABLE_DIR),
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );
};
