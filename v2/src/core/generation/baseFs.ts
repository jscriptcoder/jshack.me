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
