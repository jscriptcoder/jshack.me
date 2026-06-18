/**
 * Boot screen — a kernel-boot animation that doubles as the brick detector.
 *
 * It plays a fake BIOS/GRUB cascade, then at the kernel-load step consults
 * `resolveBoot` — the OWN machine's filesystem (base + replayed journal) run
 * through `canBoot`. A bootable box finishes the sequence and hands off to the
 * terminal via `onComplete`. A box missing a `/boot` kernel image HALTS on a
 * GRUB error / kernel panic and NEVER calls `onComplete`: the brick is
 * permanent (the tombstone lives on the shared journal), so there is no terminal
 * and no recovery. The decision lives in `canBoot`; this component only renders
 * the outcome.
 *
 * D2: minimal Solid — `onMount` drives an async line cascade (`wait` overlaps the
 * `resolveBoot` fetch with the animation), `onCleanup` cancels it if the
 * component unmounts early, a single signal holds revealed lines.
 */

import { createSignal, For, onCleanup, onMount } from 'solid-js';
import type { BootCheck, BootFile } from '../../core/boot/bootFiles';
import { BOOT_FAILURE } from '../../core/boot/bootMessages';

export type BootScreenProps = {
  readonly machineName: string;
  readonly username: string;
  /** Resolve whether THIS machine can boot — the own-box FS (base + replayed
   *  journal) checked by `canBoot`. Started at mount so the fetch overlaps the
   *  animation; consulted once the early sequence has played. */
  readonly resolveBoot: () => Promise<BootCheck>;
  /** Called once when the boot succeeds and hands off to the terminal. A bricked
   *  box (a missing boot file) never calls this — it halts on the panic screen. */
  readonly onComplete: () => void;
};

type BootLine = {
  readonly text: string;
  /** Milliseconds to wait after the previous line before revealing this one. */
  readonly delay: number;
  /** Optional CSS-var colour; defaults to the dim body colour. */
  readonly color?: string;
};

/** Always-played pre-kernel cascade (BIOS POST). The boot-file check happens
 *  AFTER this, at the point GRUB would hand control to the kernel. */
const EARLY_SEQUENCE: readonly BootLine[] = [
  { text: 'BIOS: Initializing system...', delay: 200 },
  { text: 'BIOS: Memory test... 4096 MB OK', delay: 150 },
  { text: '', delay: 100 },
];

/** The successful boot tail: kernel + initrd load, kernel log, systemd units,
 *  then the auto-login line. Played only when both boot files are present. */
const successTail = (machineName: string, username: string): readonly BootLine[] => [
  { text: 'Loading Linux 5.15.0-91-generic ...', delay: 300, color: 'var(--theme-text)' },
  { text: 'Loading initial ramdisk ...', delay: 250, color: 'var(--theme-text)' },
  { text: '', delay: 100 },
  { text: '[    0.000000] Linux version 5.15.0-91-generic (buildd@lcy02-amd64-045)', delay: 80 },
  { text: '[    0.000000] Command line: BOOT_IMAGE=/boot/vmlinuz-5.15.0-91-generic', delay: 60 },
  {
    text: '[    0.012345] x86/fpu: Supporting XSAVE feature: x87 floating point registers',
    delay: 40,
  },
  { text: '[    0.024680] ACPI: RSDP 0x00000000000E0000 000024 (v02 VBOX  )', delay: 40 },
  { text: '[    0.048000] Memory: 4048576K/4194304K available', delay: 60 },
  { text: '[    0.096000] CPU: Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz', delay: 60 },
  { text: '[    0.128000] PCI: Using configuration type 1 for base access', delay: 40 },
  { text: '[    0.256000] NET: Registered PF_NETLINK/PF_ROUTE protocol family', delay: 40 },
  { text: '[    0.512000] EXT4-fs (sda1): mounted filesystem with ordered data mode', delay: 80 },
  { text: '', delay: 100 },
  {
    text: `[    0.640000] systemd[1]: Set hostname to <${machineName}>.`,
    delay: 120,
    color: 'var(--theme-text)',
  },
  { text: '[  OK  ] Created slice system.slice.', delay: 80, color: 'var(--theme-text)' },
  { text: '[  OK  ] Started Journal Service.', delay: 80 },
  { text: '[  OK  ] Reached target Local File Systems.', delay: 60 },
  { text: '[  OK  ] Started Login Service.', delay: 80 },
  { text: '[  OK  ] Started Network Manager.', delay: 100 },
  { text: '[  OK  ] Started OpenSSH server.', delay: 80 },
  { text: '[  OK  ] Found device wlan0 — Wireless Network Interface.', delay: 100 },
  { text: '[  OK  ] Reached target Network.', delay: 80 },
  { text: '[  OK  ] Reached target Multi-User System.', delay: 100 },
  { text: '', delay: 150 },
  {
    text: `${machineName} login: ${username} (automatic login)`,
    delay: 300,
    color: 'var(--theme-text)',
  },
  { text: '', delay: 200 },
];

/** The brick tail: a missing kernel image halts the box. `vmlinuz` gone → GRUB
 *  can't load a kernel at all; `initrd.img` gone → the kernel loads but can't
 *  mount the root fs. Copy ported verbatim from the legacy `reboot` command. */
const panicTail = (missing: BootFile): readonly BootLine[] =>
  missing === 'vmlinuz'
    ? [
        { text: '', delay: 200 },
        { text: BOOT_FAILURE.vmlinuzNotFound, delay: 200 },
        { text: BOOT_FAILURE.grubNoKernel, delay: 150 },
        { text: '', delay: 100 },
        { text: BOOT_FAILURE.systemHalted, delay: 150 },
      ]
    : [
        { text: 'Loading Linux 5.15.0-91-generic ...', delay: 300, color: 'var(--theme-text)' },
        { text: '', delay: 200 },
        { text: BOOT_FAILURE.initrdNotFound, delay: 200 },
        { text: BOOT_FAILURE.kernelPanic, delay: 150 },
        { text: '', delay: 100 },
        { text: BOOT_FAILURE.systemHalted, delay: 150 },
      ];

/** Pause after the final line before handing off, so the login line lingers. */
const HANDOFF_DELAY_MS = 400;

export const BootScreen = (props: BootScreenProps) => {
  const [lines, setLines] = createSignal<readonly BootLine[]>([]);
  let container: HTMLDivElement | undefined;

  onMount(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const wait = (ms: number): Promise<void> =>
      new Promise((resolve) => timers.push(setTimeout(resolve, ms)));

    const reveal = (line: BootLine): void => {
      setLines((previous) => [...previous, line]);
      if (container) container.scrollTop = container.scrollHeight;
    };

    /** Reveal a sequence line-by-line. Returns false if cancelled mid-play. */
    const play = async (sequence: readonly BootLine[]): Promise<boolean> => {
      for (const line of sequence) {
        await wait(line.delay);
        if (cancelled) return false;
        reveal(line);
      }
      return true;
    };

    const run = async (): Promise<void> => {
      // Kick off the boot-file resolution immediately so it overlaps the BIOS
      // cascade, then await it at the kernel-load step.
      const checking = props.resolveBoot();
      if (!(await play(EARLY_SEQUENCE))) return;

      const result = await checking;
      if (cancelled) return;

      if (!result.ok) {
        await play(panicTail(result.missing));
        return; // bricked — halt, never hand off to the terminal.
      }

      if (!(await play(successTail(props.machineName, props.username)))) return;
      await wait(HANDOFF_DELAY_MS);
      if (cancelled) return;
      props.onComplete();
    };

    void run();

    onCleanup(() => {
      cancelled = true;
      timers.forEach((timer) => clearTimeout(timer));
    });
  });

  return (
    <div
      ref={container}
      class="h-full overflow-y-auto p-4 font-mono text-xs leading-relaxed text-[var(--theme-text-dim)] sm:text-sm"
    >
      <For each={lines()}>
        {(line) => (
          <div style={line.color ? { color: line.color } : undefined}>{line.text || ' '}</div>
        )}
      </For>
    </div>
  );
};
