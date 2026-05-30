/**
 * Boot screen — a fake kernel-boot animation shown once, right after the intro
 * form is submitted, before the terminal appears. Pure cosmetic flavour (ported
 * from the legacy BootScreen): BIOS + Linux log lines cascade in on timers, then
 * `onComplete` hands off to the terminal.
 *
 * D2: minimal Solid — `onMount` schedules the cascade, `onCleanup` clears the
 * timers if the component unmounts early, a single signal holds revealed lines.
 */

import { createSignal, For, onCleanup, onMount } from 'solid-js';

export type BootScreenProps = {
  readonly machineName: string;
  readonly username: string;
  readonly onComplete: () => void;
};

type BootLine = {
  readonly text: string;
  /** Milliseconds to wait after the previous line before revealing this one. */
  readonly delay: number;
  /** Optional CSS-var colour; defaults to the dim body colour. */
  readonly color?: string;
};

const buildBootSequence = (machineName: string, username: string): readonly BootLine[] => [
  { text: 'BIOS: Initializing system...', delay: 200 },
  { text: 'BIOS: Memory test... 4096 MB OK', delay: 150 },
  { text: '', delay: 100 },
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

/** Pause after the final line before handing off, so the login line lingers. */
const HANDOFF_DELAY_MS = 400;

export const BootScreen = (props: BootScreenProps) => {
  const [lines, setLines] = createSignal<readonly BootLine[]>([]);
  let container: HTMLDivElement | undefined;

  onMount(() => {
    const sequence = buildBootSequence(props.machineName, props.username);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;

    sequence.forEach((line, index) => {
      elapsed += line.delay;
      timers.push(
        setTimeout(() => {
          setLines((previous) => [...previous, line]);
          if (container) container.scrollTop = container.scrollHeight;
        }, elapsed),
      );
      if (index === sequence.length - 1) {
        timers.push(setTimeout(() => props.onComplete(), elapsed + HANDOFF_DELAY_MS));
      }
    });

    onCleanup(() => timers.forEach((timer) => clearTimeout(timer)));
  });

  return (
    <div
      ref={container}
      class="h-full overflow-y-auto p-4 font-mono text-xs leading-relaxed text-[var(--theme-text-dim)] sm:text-sm"
    >
      <For each={lines()}>
        {(line) => (
          <div style={line.color ? { color: line.color } : undefined}>{line.text || ' '}</div>
        )}
      </For>
    </div>
  );
};
