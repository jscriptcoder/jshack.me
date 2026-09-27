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
 * — rebooting a remote box drops you back to wherever you ssh'd from.
 *
 * The SERVER-side eviction is a separate, earlier act: it fires at the shutdown
 * beat, which is when a real machine drops its sessions, and it is therefore not
 * abortable. A Ctrl-C after that point stops the animation and leaves the player
 * looking at a shell on a box that has already ended their rows — which resolves
 * itself the moment they type again. Its failure is reported rather than
 * swallowed: a defensive command that silently no-ops is worse than one that
 * refuses, because the player walks away believing the box came up empty.
 */

import { canBoot, type BootCheck, type BootFile } from '../boot/bootFiles';
import { BOOT_FAILURE } from '../boot/bootMessages';
import type { Command, CommandEnv, TerminalLine } from './types';

const text = (content: string): TerminalLine => ({ kind: 'text', content });

/** Pacing between the shutdown, BIOS, and boot-result phases. Cosmetic — paced
 *  through the abort-aware `env.sleep` so Ctrl-C stops the reboot mid-flight. */
const SHUTDOWN_PAUSE_MS = 600;
const BIOS_PAUSE_MS = 500;
const BOOT_PAUSE_MS = 600;

/** What the player is told when the box came back but its sessions did not end.
 *  Named as the command's own failure (`reboot:`) rather than dressed as kernel
 *  output, because it is not something the machine reported — it is this command
 *  saying the one thing it was run to do did not happen. */
const EVICTION_FAILED =
  'reboot: could not end active sessions — anyone connected may still be on this machine';

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
    ? ['', BOOT_FAILURE.vmlinuzNotFound, BOOT_FAILURE.grubNoKernel, '', BOOT_FAILURE.systemHalted]
    : [
        'Loading vmlinuz...',
        BOOT_FAILURE.initrdNotFound,
        BOOT_FAILURE.kernelPanic,
        '',
        BOOT_FAILURE.systemHalted,
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

/** Whether the eviction took, written by the stream and read by `exitCode` after
 *  it drains. The two are handed to the shell separately, so the outcome has to
 *  outlive the generator that learned it. */
type EvictionOutcome = { failed: boolean };

async function* rebootSequence(
  env: CommandEnv,
  bootCheck: BootCheck,
  eviction: EvictionOutcome,
): AsyncIterable<TerminalLine> {
  yield text(`Broadcast message from root@${env.hostname}:`);
  yield text('The system is going down for reboot NOW!');
  await env.sleep(SHUTDOWN_PAUSE_MS);
  yield text('[ OK ] Stopping system logging...');

  // The box drops its sessions HERE — the moment a real one does, and before it
  // has said it is down. Not gated on `env.network.isOnline()`: that flag is the
  // in-game "am I joined to a WiFi", and rebooting hardware is local. A defender
  // who runs `nmcli disconnect` and then `reboot` is executing the panic sequence
  // correctly, and it has to work.
  const evicted = await env.reboot.evict(env.session.machineId);
  eviction.failed = !evicted.ok;

  yield text('[ OK ] Reached target Shutdown.');
  yield text('');
  await env.sleep(BIOS_PAUSE_MS);

  yield text('BIOS POST... OK');
  yield text('Booting from disk...');
  await env.sleep(BOOT_PAUSE_MS);

  const tail = bootCheck.ok ? SUCCESS_TAIL : panicTail(bootCheck.missing);
  for (const line of tail) yield text(line);

  // After the boot result, because the boot really did happen — what did not
  // happen is the part the player cannot see for themselves.
  if (eviction.failed) yield text(EVICTION_FAILED);

  // The box has come up (or halted) — drop off it. Reached only when the stream
  // runs to completion; a Ctrl-C abort stops before here, leaving the hop intact.
  disconnect(env);
}

const execute: Command['execute'] = async (env) => {
  const eviction: EvictionOutcome = { failed: false };
  return {
    kind: 'async',
    lines: rebootSequence(env, canBoot(env.fs.root()), eviction),
    exitCode: async () => (eviction.failed ? 1 : 0),
  };
};

export const reboot: Command = {
  name: 'reboot',
  description: 'Reboot the current machine',
  category: 'filesystem',
  tier: 'root',
  availability: { kind: 'any-machine' },
  // Takes the box out from under the script that is running on it.
  withoutScript: 'reboot: cannot be run from a script',
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
