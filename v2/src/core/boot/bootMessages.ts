/**
 * Boot-failure copy — the GRUB / kernel lines a machine prints when it cannot
 * come up. Shared by the two places a brick surfaces, so they stay byte-identical
 * (a box looks the same however the brick is discovered):
 *   - the boot screen (`ui/screens/boot.tsx`) on a returning player's next load;
 *   - the `reboot` command (`core/commands/reboot.ts`) on a forced cold boot.
 *
 * A missing `/boot/vmlinuz` halts GRUB before any kernel loads; a missing
 * `/boot/initrd.img` loads the kernel but panics with no root filesystem to
 * mount. Only the FAILURE copy is shared — each surface frames the surrounding
 * (loading / login / shutdown) lines for its own context.
 */
export const BOOT_FAILURE = {
  vmlinuzNotFound: "error: file '/boot/vmlinuz' not found.",
  grubNoKernel: 'GRUB error: no loaded kernel.',
  initrdNotFound: "error: file '/boot/initrd.img' not found.",
  kernelPanic: 'Kernel panic - not syncing: VFS: Unable to mount root fs',
  systemHalted: 'System halted.',
} as const;
