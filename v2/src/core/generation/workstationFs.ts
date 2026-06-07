/**
 * Seeded own-workstation base filesystem generator (network-generator epic,
 * Story 1). Replaces the hand-authored static tree in `ui/seed.ts`: the same
 * Ed25519 identity pubkey always yields the same `/etc/passwd` + home dirs,
 * observable today through `ls` / `cat`.
 *
 * Layering (epic decision 7 — keep primitives NPC-agnostic):
 *   - `generatePasswd(users)` is the reusable, player-agnostic primitive: it
 *     turns a `PasswdUser[]` list into `/etc/passwd` text and knows nothing
 *     about the player. NPC machines in later epic stories reuse it.
 *   - `buildWorkstationBaseFs` is the thin player-specific composer that builds
 *     the `[root, player(empty hash), guest]` user list and assembles the tree.
 *
 * Base skeleton: `/etc/passwd`, `/home/<username>`, `/root`, `/tmp`, `/bin`
 * (system-utility binary stubs — see `binaries.ts`), `/usr/bin` (pre-installed
 * apt tools), and `/lib` (shared-library stubs that linked commands need — see
 * `libraries.ts`). Together these gate command execution. Logs and dotfiles
 * land in later slices when a command actually consumes them.
 */

import type { GameConfig } from '../gameConfig/gameConfig';
import type { Directory, FileEntry, FileNode, FilePermissions } from '../filesystem/types';
import { createPrng } from './prng';
import { createBinaryEntries, LOCALHOST_PREINSTALLED_TOOLS, SYSTEM_UTILITY_NAMES } from './binaries';
import { createLibraryEntries, SYSTEM_LIBRARIES } from './libraries';
import { md5 } from './md5';

// --- Permission boundaries (mirror the pre-generator ui/seed.ts) ---

const TRAVERSABLE_DIR: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};
/** `/etc/passwd`: root + user only — passwords live inline (no /etc/shadow),
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
/** `/var/log/auth.log` etc.: world-READABLE (the defender can `cat` the log) but
 *  only root WRITES — su's append models a setuid-root syslog write, not a
 *  player-tier write, so the file is never world-writable. */
const LOG_FILE: FilePermissions = { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] };

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

// --- NPC-agnostic /etc/passwd primitive ---

/** One `/etc/passwd` row. No player-specific assumptions — NPC machine
 *  generation (later epic stories) builds its own `PasswdUser[]` and reuses
 *  `generatePasswd`. */
export type PasswdUser = {
  readonly username: string;
  /** Already-hashed (md5) or empty for a password-less account. */
  readonly passwordHash: string;
  readonly uid: number;
  readonly gid: number;
  readonly gecos: string;
  readonly home: string;
  readonly shell: string;
};

/** Render `PasswdUser[]` as `/etc/passwd` text: one
 *  `name:hash:uid:gid:gecos:home:shell` line per user, each newline-terminated. */
export const generatePasswd = (users: readonly PasswdUser[]): string =>
  users
    .map(
      (user) =>
        `${user.username}:${user.passwordHash}:${user.uid}:${user.gid}:${user.gecos}:${user.home}:${user.shell}\n`,
    )
    .join('');

// --- Player workstation composer ---

const SHELL = '/bin/bash';

/** Weak guest passwords (cracking is a later epic — these are just data the
 *  seeded PRNG picks from, mirroring legacy `generateLocalhost`). */
const GUEST_PASSWORDS: readonly string[] = [
  'guest',
  'password',
  'letmein',
  'changeme',
  'welcome1',
  'qwerty123',
  'trustno1',
  'sunshine',
];

/**
 * Build the player's own-workstation base filesystem, seeded by their Ed25519
 * identity pubkey (decision 1: `createPrng('workstation-' + pubkey)`).
 */
export const buildWorkstationBaseFs = (seedPubkeyHex: string, config: GameConfig): Directory => {
  const prng = createPrng(`workstation-${seedPubkeyHex}`);
  const guestPassword = prng.pick(GUEST_PASSWORDS);

  const passwd = generatePasswd([
    {
      username: 'root',
      passwordHash: md5(config.rootPassword),
      uid: 0,
      gid: 0,
      gecos: 'root',
      home: '/root',
      shell: SHELL,
    },
    {
      // No password for the player's own user — they can always exit() back.
      username: config.username,
      passwordHash: '',
      uid: 1000,
      gid: 1000,
      gecos: config.username,
      home: `/home/${config.username}`,
      shell: SHELL,
    },
    {
      username: 'guest',
      passwordHash: md5(guestPassword),
      uid: 1001,
      gid: 1001,
      gecos: 'guest',
      home: '/home/guest',
      shell: SHELL,
    },
  ]);

  return dir(
    {
      bin: dir(createBinaryEntries(SYSTEM_UTILITY_NAMES), TRAVERSABLE_DIR),
      etc: dir({ passwd: file(passwd, PASSWD_FILE) }, TRAVERSABLE_DIR),
      home: dir({ [config.username]: dir({}, HOME_DIR, config.username) }, TRAVERSABLE_DIR),
      lib: dir(createLibraryEntries(SYSTEM_LIBRARIES), TRAVERSABLE_DIR),
      root: dir({}, ROOT_DIR),
      tmp: dir({}, TMP_DIR),
      usr: dir(
        { bin: dir(createBinaryEntries(LOCALHOST_PREINSTALLED_TOOLS), TRAVERSABLE_DIR) },
        TRAVERSABLE_DIR,
      ),
      // `/var/log/auth.log` exists empty from boot so `su` appends to a real
      // file (and `cat` works before the first switch). Logs land here as
      // commands consume them — this slice adds auth.log for su.
      var: dir({ log: dir({ 'auth.log': file('', LOG_FILE) }, TRAVERSABLE_DIR) }, TRAVERSABLE_DIR),
    },
    TRAVERSABLE_DIR,
  );
};
