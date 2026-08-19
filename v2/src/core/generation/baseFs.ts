/**
 * baseFs — the shared, NPC-agnostic toolkit for building a Linux box's base
 * filesystem: the permission boundaries every box enforces, the node
 * constructors, and the `/etc/passwd` renderer. Both box generators —
 * `buildWorkstationBaseFs` (the player's own machine) and `buildRemoteHostFs`
 * (generated NPC hosts) — compose these, so the permission model (which IS the
 * privilege boundary) lives in exactly one place and the two boxes can't drift.
 *
 * What is deliberately NOT here: the account LISTS and weak-password POOLS each
 * generator draws from. Those encode different seeded content (the player's
 * empty-hash user vs an NPC's password-protected accounts) and evolve
 * independently, so they stay local to each generator.
 */

import type { Directory, FileEntry, FileNode, FilePermissions } from '../filesystem/types';

// --- Permission boundaries ---

/** A container directory: world-readable + traversable, root-only writes — the
 *  default for skeleton dirs (`/`, `/etc`, `/home`, `/bin`, `/lib`, …). */
export const TRAVERSABLE_DIR: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};
/** `/etc/passwd`: root + user read only — passwords live inline (no /etc/shadow),
 *  so leaking passwd is a real privilege boundary; guest must not read it. */
export const PASSWD_FILE: FilePermissions = {
  read: ['root', 'user'],
  write: ['root'],
  execute: ['root'],
};
/** A user's home directory: root + the owning user. */
export const HOME_DIR: FilePermissions = {
  read: ['root', 'user'],
  write: ['root', 'user'],
  execute: ['root', 'user'],
};
/** `/root`: root-only across the board. */
export const ROOT_DIR: FilePermissions = { read: ['root'], write: ['root'], execute: ['root'] };
/** `/tmp`: world-writable scratch space. */
export const TMP_DIR: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'user', 'guest'],
  execute: ['root', 'user', 'guest'],
};
/** A page under `/var/www`: world-readable because publishing IS making it
 *  public, root-only write because starting the server is already root's job, and
 *  never executable — a served page is data, and the web surface has no CGI. Both
 *  box generators share it so publishing means the same thing on the player's box
 *  and on a generated host. */
export const WEB_PAGE_FILE: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};
/** A role's config in `/etc` (`mysql.cnf`, `device.conf`): world-readable because
 *  saying what a box is FOR is the lowest tier of recon and costs no credential,
 *  root-only write because configuring the box is root's job, and never executable —
 *  a config is data, the same reasoning `WEB_PAGE_FILE` carries. Deliberately wider
 *  than `PASSWD_FILE` beside it: passwd guards the account names and inline hashes a
 *  player is meant to earn, and this file names neither.  */
export const SERVICE_CONFIG_FILE: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};
/** `/boot/{vmlinuz,initrd.img}`: world-readable, root-only write, root-only
 *  execute. Only root can delete a boot file — and that deletion IS the brick
 *  (the box can't come up without it; see `core/boot/bootFiles.ts`). */
export const BOOT_FILE: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

// --- Node constructors ---

export const file = (content: string, perms: FilePermissions, owner = 'root'): FileEntry => ({
  kind: 'file',
  content,
  owner,
  perms,
});

export const dir = (
  entries: Readonly<Record<string, FileNode>>,
  perms: FilePermissions,
  owner = 'root',
): Directory => ({
  kind: 'directory',
  owner,
  perms,
  entries: new Map(Object.entries(entries)),
});

// --- /boot ---

/** The `/boot` directory every box ships with: the kernel (`vmlinuz`) and
 *  initial ramdisk (`initrd.img`) whose presence `canBoot` checks at boot. Built
 *  once here and composed by BOTH box generators, so the boot contract can't
 *  drift between the player's workstation and an NPC host. Root-owned and
 *  root-write, so only a root `rm` (an own self-brick, or a cross-player attacker
 *  who has `su`'d to root) can delete a file — and that deletion bricks the box. */
export const bootDir = (): Directory =>
  dir(
    {
      vmlinuz: file('bzImage, version 5.15.0-91-generic', BOOT_FILE),
      'initrd.img': file('initramfs image, version 5.15.0-91-generic', BOOT_FILE),
    },
    TRAVERSABLE_DIR,
  );

// --- /etc/passwd ---

/** The login shell every generated account uses. */
export const SHELL = '/bin/bash';

/** One `/etc/passwd` row. No player-specific assumptions — each generator builds
 *  its own `PasswdUser[]` and reuses `generatePasswd`. */
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
