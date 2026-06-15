/**
 * bootFiles — the single pure authority for "can this machine come up?".
 *
 * A box boots only when both kernel images live in `/boot`: the kernel
 * (`vmlinuz`) and the initial ramdisk (`initrd.img`). The brick mechanic is
 * exactly the absence of one of them: a root `rm /boot/vmlinuz` records a
 * tombstone on the shared journal, so the patch-replayed tree no longer carries
 * the file and `canBoot` reports it gone — permanently, since the journal is
 * append-only and cross-player.
 *
 * Ordering is load-bearing: GRUB loads the kernel before the initrd, so when
 * BOTH files are gone the failure must name `vmlinuz` — the first thing the
 * bootloader looks for (matches the legacy `reboot` panic copy).
 *
 * Pure over an already-resolved `Directory` (base FS + replayed patches). The
 * boot screen renders the outcome; this module decides it, so client and server
 * agree on what "bricked" means.
 */

import type { Directory } from '../filesystem/types';

/** A required boot file, in GRUB load order (kernel first, then initrd). */
export type BootFile = 'vmlinuz' | 'initrd.img';

export type BootCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: BootFile };

/** The files `/boot` must contain to boot, in the order the bootloader needs
 *  them — so a "both gone" check reports the kernel first. */
const REQUIRED_BOOT_FILES: readonly BootFile[] = ['vmlinuz', 'initrd.img'];

const bootFilePresent = (root: Directory, name: BootFile): boolean => {
  const boot = root.entries.get('boot');
  return boot !== undefined && boot.kind === 'directory' && boot.entries.has(name);
};

/** Whether `root` (a base FS with its journal already replayed) can boot. */
export const canBoot = (root: Directory): BootCheck => {
  const missing = REQUIRED_BOOT_FILES.find((name) => !bootFilePresent(root, name));
  return missing === undefined ? { ok: true } : { ok: false, missing };
};
