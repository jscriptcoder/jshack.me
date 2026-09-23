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
/** `/var/lib/mysql/data.json`: root ONLY, and narrower than `PASSWD_FILE` beside it.
 *  Two reasons. It holds the database's own account hashes, which are what a sweep has
 *  to work for — a tier that could read them would be handed the answer key. And the
 *  door it belongs to grants no filesystem access at all, so the file must not be
 *  reachable by the tiers that door hands out; the only way to read it directly is to
 *  already own the box, which is a different achievement from cracking its database.
 *  Never executable: it is data. */
export const DATADIR_FILE: FilePermissions = {
  read: ['root'],
  write: ['root'],
  execute: [],
};
/** A user's home directory: root + the owning user. */
export const HOME_DIR: FilePermissions = {
  read: ['root', 'user'],
  write: ['root', 'user'],
  execute: ['root', 'user'],
};
/** A file in a user's home: the owner and root read and write it, guest cannot, and
 *  nothing in it is a program. */
export const HOME_FILE: FilePermissions = {
  read: ['root', 'user'],
  write: ['root', 'user'],
  execute: [],
};
/** `/home/guest`: the guest account's own home. Debian makes a home readable by
 *  everyone on the box and writable by its owner, and a guest session lands here, so
 *  guest must be able to list it and add to it. */
export const GUEST_HOME_DIR: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'guest'],
  execute: ['root', 'user', 'guest'],
};
/** A file in `/home/guest`: readable by everyone, as its directory is, and the guest's
 *  own to change. */
export const GUEST_HOME_FILE: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'guest'],
  execute: [],
};
/** `/root`: root-only across the board. */
export const ROOT_DIR: FilePermissions = { read: ['root'], write: ['root'], execute: ['root'] };
/** A file in `/root`: root's alone, and never a program. The directory already keeps
 *  every other tier out; the file says the same, so a copy moved elsewhere stays private. */
export const ROOT_FILE: FilePermissions = { read: ['root'], write: ['root'], execute: [] };
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
/** `/var/mail/<user>`: the same rung as a file in that person's home, because it holds
 *  the same thing — what somebody wrote to them. Debian gives a mailbox to its owner and
 *  keeps everyone else out; three tiers cannot name an owner, so it is the box's user who
 *  reads it, and a guest who does not. Never executable: it is a file of letters. */
export const MAIL_FILE: FilePermissions = {
  read: ['root', 'user'],
  write: ['root', 'user'],
  execute: [],
};
/** `/var/mail` on the machine that carries a network's mail, and every mailbox in it:
 *  root's alone, directory included — listing the spool names every account on the
 *  network, which is recon in itself. This is the whole organisation's correspondence
 *  rather than one person's, so it sits where the escalation is: a box's own user reads
 *  their own mail, not everybody's. */
export const MAIL_SPOOL_DIR: FilePermissions = {
  read: ['root'],
  write: ['root'],
  execute: ['root'],
};
export const MAIL_SPOOL_FILE: FilePermissions = { read: ['root'], write: ['root'], execute: [] };
/** `/etc/aliases`: the same tier as `/etc/passwd` beside it, and for the same reason.
 *  Every line of it is an account name — the spool's own roster, written out in `/etc` —
 *  and account names are what the cracking curve exists to make a player earn. It holds
 *  no hash, so it is not kept as narrowly as the spool it describes: a user who already
 *  reached the box may read who it answers for, and only root may edit it. */
export const ALIASES_FILE: FilePermissions = {
  read: ['root', 'user'],
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
