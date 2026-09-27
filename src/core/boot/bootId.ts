/**
 * The box's boot id — the marker a reboot leaves behind on the machine's own
 * tree, and the only thing that can tell a shell ALREADY standing on the box
 * that it went down.
 *
 * The closed session row is the authority; this is only how a terminal finds
 * out. That split is what makes the marker cheap: a tampered client that ignores
 * it gains nothing, because its rows are ended, so the served tree it gets back
 * is the tier-3 allowlist and the active-session gate refuses its writes. What it
 * buys by not looking is not being told.
 *
 * It is an opaque id compared by EQUALITY, never a timestamp compared by
 * ordering. A live session's `createdAt` is the client's clock and a rehydrated
 * one's is the server's, so two sessions on one box already disagree about what
 * time it is, and two players never shared a clock at all: a `createdAt < lastBoot`
 * test would evict a player whose clock runs slow from a box that rebooted before
 * they arrived, and keep one whose clock runs fast on a box that threw them off.
 * Equality against a value only the server mints has no clock on either side.
 *
 * The path is world-readable and root-written, the posture the pidfiles beside it
 * already take, and it is on the tier-3 allowlist for a reason worth keeping in
 * one place: the moment a reboot closes a player's rows they hold no session, so
 * the very next tree they pull is that tier. A marker pruned out of it reads to
 * their client exactly like a box that has never rebooted — wrong once per box,
 * on its FIRST reboot, which is the kind of hole that survives a test suite and
 * reads afterwards as an unreproducible bug.
 */

import type { Directory, FilePermissions } from '../filesystem/types';
import { asAbsPath, type AbsPath } from '../types';

/** `/var/run` is where this box keeps what is true only while it is up, and the
 *  real-world analogue of this file (`/proc/sys/kernel/random/boot_id`) says the
 *  same thing about the same event. */
export const BOOT_ID_PATH: AbsPath = asAbsPath('/var/run/boot-id');

/** Readable by anyone who can reach the box, writable only by root — the same
 *  permissions every pidfile in this directory carries, and for the same reason:
 *  a reader pruned out of it cannot be told the box went down, and a writer who
 *  is not root could forge the box having rebooted when it had not. */
export const BOOT_ID_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: [],
};

/** The marker belongs to the system, not to whoever's reboot minted it. */
export const BOOT_ID_OWNER = 'root';

/** The id this box is currently carrying, or `null` when it has never rebooted.
 *
 *  `null` rather than `undefined` deliberately: a box with no marker is a FACT
 *  that was read, and the sessions standing on it record it as one. The absence
 *  of a reading is a third state, and keeping the two apart is what makes the
 *  first reboot of a box evict anybody at all. */
export const readBootId = (root: Directory): string | null => {
  const varDir = root.entries.get('var');
  if (varDir?.kind !== 'directory') return null;
  const run = varDir.entries.get('run');
  if (run?.kind !== 'directory') return null;
  const marker = run.entries.get('boot-id');
  if (marker?.kind !== 'file') return null;
  // Trimmed because the file on the box ends in a newline, like every other line
  // this world writes, and the comparison is against a bare id.
  const content = marker.content.trim();
  return content.length > 0 ? content : null;
};
