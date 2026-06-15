/**
 * reboot — cold-boot the machine the active session is on (your own box, or a
 * box you've ssh'd into). It animates a shutdown + BIOS, then consults
 * `canBoot(env.fs.root())` — the CURRENT machine's filesystem — to decide the
 * outcome and renders the matching kernel sequence:
 *   - both /boot kernel images present → a clean boot, "System rebooted successfully.";
 *   - /boot/vmlinuz gone              → GRUB can't load a kernel — halt;
 *   - /boot/initrd.img gone           → the kernel loads but can't mount root — panic.
 *
 * The boot files live in the SHARED journalled filesystem, so a root `rm` of one
 * (the brick) leaves a tombstone that the replayed tree no longer carries: the
 * reboot then shows the permanent halt/panic. On a cross-player hop `env.fs` is
 * A's server-served tree (the read path already materialised it), so the same
 * `canBoot(env.fs.root())` decides A's fate without any extra round-trip. The
 * panic copy is byte-identical to the boot screen's, so a bricked box looks the
 * same however the brick surfaces.
 *
 * Root-only is enforced by the binary gate: `/bin/reboot` is `execute:['root']`
 * (see `binaries.ts` `RESTRICTED_EXECUTE`), and `wrapWithBinaryCheck` denies any
 * non-root caller before `execute` runs — so, like legacy `reboot`, there is no
 * internal tier check here (it would be unreachable in production).
 *
 * On completion the player is DISCONNECTED from the rebooted machine: every
 * session sitting on it is popped (the box went down), but never the base login
 * — rebooting a remote box drops you back to wherever you ssh'd from. A Ctrl-C
 * mid-animation aborts before the disconnect, leaving you connected.
 */

import { canBoot, type BootCheck, type BootFile } from '../boot/bootFiles';
import type { Command, CommandEnv, TerminalLine } from './types';

const text = (content: string): TerminalLine => ({ kind: 'text', content });

/** Pacing between the shutdown, BIOS, and boot-result phases. Cosmetic — paced
 *  through the abort-aware `env.sleep` so Ctrl-C stops the reboot mid-flight. */
const SHUTDOWN_PAUSE_MS = 600;
const BIOS_PAUSE_MS = 500;
const BOOT_PAUSE_MS = 600;

/** The kernel sequence for a successful boot. */
const SUCCESS_TAIL: readonly string[] = [
  'Loading vmlinuz...',
  'Loading initrd.img...',
  '',
  'System rebooted successfully.',
];

/** A missing kernel image halts the box. `vmlinuz` gone → GRUB can't load a
 *  kernel at all; `initrd.img` gone → the kernel loads but can't mount the root
 *  filesystem. Copy is verbatim from legacy `reboot` / the boot screen, so the
 *  two brick renderings can never drift. */
const panicTail = (missing: BootFile): readonly string[] =>
  missing === 'vmlinuz'
    ? ['', "error: file '/boot/vmlinuz' not found.", 'GRUB error: no loaded kernel.', '', 'System halted.']
    : [
        'Loading vmlinuz...',
        "error: file '/boot/initrd.img' not found.",
        'Kernel panic - not syncing: VFS: Unable to mount root fs',
        '',
        'System halted.',
      ];

/** Disconnect the player from the machine just rebooted: pop every session that
 *  sits on it (the box went down), counting from the top of the hop chain but
 *  NEVER the base login (the player's own box is always reachable). On the own
 *  base box there is nothing above the base, so nothing is popped. */
const disconnect = (env: CommandEnv): void => {
  const rebooted = env.session.machineId;
  // The stack from the top (active) down, minus the base login at the bottom.
  const aboveBase = [env.session, ...[...env.hopChain].reverse()].slice(0, -1);
  let pops = 0;
  for (const session of aboveBase) {
    if (session.machineId !== rebooted) break;
    pops += 1;
  }
  for (let popped = 0; popped < pops; popped += 1) env.popSession();
};

async function* rebootSequence(env: CommandEnv, bootCheck: BootCheck): AsyncIterable<TerminalLine> {
  yield text(`Broadcast message from root@${env.hostname}:`);
  yield text('The system is going down for reboot NOW!');
  await env.sleep(SHUTDOWN_PAUSE_MS);
  yield text('[ OK ] Stopping system logging...');
  yield text('[ OK ] Reached target Shutdown.');
  yield text('');
  await env.sleep(BIOS_PAUSE_MS);

  yield text('BIOS POST... OK');
  yield text('Booting from disk...');
  await env.sleep(BOOT_PAUSE_MS);

  const tail = bootCheck.ok ? SUCCESS_TAIL : panicTail(bootCheck.missing);
  for (const line of tail) yield text(line);

  // The box has come up (or halted) — drop off it. Reached only when the stream
  // runs to completion; a Ctrl-C abort stops before here, leaving the hop intact.
  disconnect(env);
}

const execute: Command['execute'] = async (env) => ({
  kind: 'async',
  lines: rebootSequence(env, canBoot(env.fs.root())),
  exitCode: async () => 0,
});

export const reboot: Command = {
  name: 'reboot',
  description: 'Reboot the current machine',
  category: 'filesystem',
  tier: 'root',
  availability: { kind: 'any-machine' },
  manual: {
    synopsis: 'reboot',
    description:
      'Reboot the current machine. Requires root privileges. If a critical boot file ' +
      '(/boot/vmlinuz, /boot/initrd.img) is missing, the machine fails to come back up and ' +
      'is permanently unreachable.',
    examples: [{ command: 'reboot', description: 'Reboot the current machine' }],
  },
  execute,
};
