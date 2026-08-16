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
import { ACCESS_LOG_PERMISSIONS } from '../logging/accessLog';
import { AUTH_LOG_PERMISSIONS } from '../logging/authLog';
import { KERN_LOG_PERMISSIONS } from '../logging/kernLog';

// --- Player workstation composer ---

/**
 * The page a player's box serves before they have written one of their own.
 *
 * FIXED, not drawn from the NPC page pool: those pages leak invented versions and
 * paths as recon material, which would be a lie about the player's own box and
 * would hand their attackers hints the box does not actually have. A stock
 * default is also what a real freshly-installed server ships.
 *
 * It names its own path because that is the one thing the player needs to know to
 * replace it, and nothing else in the game would tell them.
 */
const DEFAULT_PAGE = [
  '<html>',
  '<head><title>It works!</title></head>',
  '<body>',
  '<h1>It works!</h1>',
  '<p>This is the default page served from /var/www/html/index.html.</p>',
  '<p>Edit that file to publish something of your own.</p>',
  '</body>',
  '</html>',
].join('\n');

/** The guest account's plaintext password — seeded from the owner's pubkey ALONE
 *  (the `workstation-` namespace), so the SERVER can recover it for a cross-player
 *  auth without the owner's config.
 *
 *  Always drawn from the CRACKABLE pool, through the same knob every other guest
 *  account uses. That is the one account a defender cannot harden before the CVE
 *  phase, and it is deliberately so: their chosen root password stays safe, and
 *  guest is the door that makes cross-player play exist at all. */
export const workstationGuestPassword = (ownerKeyHex: string): string =>
  drawPassword(createPrng(`workstation-${ownerKeyHex}`), CRACK_CHANCE.guest);

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
          bin: dir(createBinaryEntries([...LOCALHOST_PREINSTALLED_TOOLS, ...SERVICE_CONTROL_TOOLS]), TRAVERSABLE_DIR),
          // Admin daemons (`sshd`) — pre-installed everywhere, like the ssh client.
          sbin: dir(createBinaryEntries(SYSTEM_DAEMON_NAMES), TRAVERSABLE_DIR),
        },
        TRAVERSABLE_DIR,
      ),
      // `/var/log/auth.log` exists empty from boot so `su` appends to a real
      // file (and `cat` works before the first switch); `/var/log/kern.log` the
      // same for an inbound scan's iptables line, and `/var/log/access.log` for
      // an inbound web hit. `/var/run` exists empty so `sshd` can drop its
      // pidfile there. `/var/www/html/index.html` exists from boot for the same
      // reason: a freshly started web server must have something to serve, and
      // the player needs a real file to edit rather than having to guess the
      // path and create it.
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
          run: dir({}, TRAVERSABLE_DIR),
          www: dir(
            { html: dir({ 'index.html': file(DEFAULT_PAGE, WEB_PAGE_FILE) }, TRAVERSABLE_DIR) },
            TRAVERSABLE_DIR,
          ),
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
