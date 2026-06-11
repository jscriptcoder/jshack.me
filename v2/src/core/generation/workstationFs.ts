/**
 * Seeded own-workstation base filesystem generator (network-generator epic,
 * Story 1). Replaces the hand-authored static tree in `ui/seed.ts`: the same
 * Ed25519 identity pubkey always yields the same `/etc/passwd` + home dirs,
 * observable today through `ls` / `cat`.
 *
 * Layering (epic decision 7 — keep primitives NPC-agnostic):
 *   - the shared box-FS toolkit (permission boundaries, node constructors,
 *     `generatePasswd`) lives in `baseFs.ts`, reused by every box generator.
 *   - `buildWorkstationBaseFs` is the thin player-specific composer that builds
 *     the `[root, player(empty hash), guest]` user list and assembles the tree.
 *     `buildRemoteHostFs` is the NPC-host sibling.
 *
 * Base skeleton: `/etc/passwd`, `/home/<username>`, `/root`, `/tmp`, `/bin`
 * (system-utility binary stubs — see `binaries.ts`), `/usr/bin` (pre-installed
 * apt tools), and `/lib` (shared-library stubs that linked commands need — see
 * `libraries.ts`). Together these gate command execution. Logs and dotfiles
 * land in later slices when a command actually consumes them.
 */

import type { GameConfig } from '../gameConfig/gameConfig';
import type { Directory } from '../filesystem/types';
import { createPrng } from './prng';
import {
  createBinaryEntries,
  LOCALHOST_PREINSTALLED_TOOLS,
  SYSTEM_DAEMON_NAMES,
  SYSTEM_UTILITY_NAMES,
} from './binaries';
import { createLibraryEntries, SYSTEM_LIBRARIES } from './libraries';
import {
  dir,
  file,
  generatePasswd,
  HOME_DIR,
  PASSWD_FILE,
  ROOT_DIR,
  SHELL,
  TMP_DIR,
  TRAVERSABLE_DIR,
} from './baseFs';
import { md5 } from './md5';
import { AUTH_LOG_PERMISSIONS } from '../logging/authLog';

// --- Player workstation composer ---

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
        {
          bin: dir(createBinaryEntries(LOCALHOST_PREINSTALLED_TOOLS), TRAVERSABLE_DIR),
          // Admin daemons (`sshd`) — pre-installed everywhere, like the ssh client.
          sbin: dir(createBinaryEntries(SYSTEM_DAEMON_NAMES), TRAVERSABLE_DIR),
        },
        TRAVERSABLE_DIR,
      ),
      // `/var/log/auth.log` exists empty from boot so `su` appends to a real
      // file (and `cat` works before the first switch). `/var/run` exists empty
      // so `sshd` can drop its pidfile there. Both land here as commands consume
      // them — this slice adds /var/run for sshd.
      var: dir(
        {
          log: dir({ 'auth.log': file('', AUTH_LOG_PERMISSIONS) }, TRAVERSABLE_DIR),
          run: dir({}, TRAVERSABLE_DIR),
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );
};
