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
} from './baseFs';
import { md5 } from './md5';
import { AUTH_LOG_PERMISSIONS } from '../logging/authLog';
import { KERN_LOG_PERMISSIONS } from '../logging/kernLog';

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

/** The guest account's plaintext password — seeded from the owner's pubkey ALONE
 *  (the `workstation-` namespace). Owner-key-only so the SERVER can recover it for
 *  a cross-player auth (Story 2) without the owner's config, and a future cracker
 *  can match it against GUEST_PASSWORDS. */
export const workstationGuestPassword = (ownerKeyHex: string): string =>
  createPrng(`workstation-${ownerKeyHex}`).pick(GUEST_PASSWORDS);

/**
 * Build the player's own-workstation base filesystem from the IDENTITY the server
 * can RECONSTRUCT cross-player: the owner's pubkey (guest-password + world seed),
 * the chosen `username`, and the root password ALREADY HASHED
 * (`md5(rootPassword)`). Both the client (own box — hashes its own plaintext) and
 * the server (cross-player read — holds the stored hash) build through this one
 * function, so A's box can't drift between what A sees and what an attacker reads.
 */
export const buildWorkstationBaseFsFromIdentity = (identity: {
  readonly ownerKeyHex: string;
  readonly username: string;
  readonly rootPasswordHash: string;
}): Directory => {
  const passwd = generatePasswd([
    {
      username: 'root',
      passwordHash: identity.rootPasswordHash,
      uid: 0,
      gid: 0,
      gecos: 'root',
      home: '/root',
      shell: SHELL,
    },
    {
      // No password for the player's own user — they can always exit() back. An
      // empty hash is also unauthenticatable cross-player (md5(x) is never '').
      username: identity.username,
      passwordHash: '',
      uid: 1000,
      gid: 1000,
      gecos: identity.username,
      home: `/home/${identity.username}`,
      shell: SHELL,
    },
    {
      username: 'guest',
      passwordHash: md5(workstationGuestPassword(identity.ownerKeyHex)),
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
      boot: bootDir(),
      etc: dir({ passwd: file(passwd, PASSWD_FILE) }, TRAVERSABLE_DIR),
      home: dir({ [identity.username]: dir({}, HOME_DIR, identity.username) }, TRAVERSABLE_DIR),
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
      // file (and `cat` works before the first switch); `/var/log/kern.log` the
      // same for an inbound scan's iptables line. `/var/run` exists empty so
      // `sshd` can drop its pidfile there.
      var: dir(
        {
          log: dir(
            {
              'auth.log': file('', AUTH_LOG_PERMISSIONS),
              'kern.log': file('', KERN_LOG_PERMISSIONS),
            },
            TRAVERSABLE_DIR,
          ),
          run: dir({}, TRAVERSABLE_DIR),
        },
        TRAVERSABLE_DIR,
      ),
    },
    TRAVERSABLE_DIR,
  );
};

/**
 * Build the player's own-workstation base filesystem, seeded by their Ed25519
 * identity pubkey (decision 1: `createPrng('workstation-' + pubkey)`). Thin
 * wrapper that hashes the config's plaintext root password and delegates to
 * `buildWorkstationBaseFsFromIdentity` — the shared generator.
 */
export const buildWorkstationBaseFs = (seedPubkeyHex: string, config: GameConfig): Directory =>
  buildWorkstationBaseFsFromIdentity({
    ownerKeyHex: seedPubkeyHex,
    username: config.username,
    rootPasswordHash: md5(config.rootPassword),
  });
