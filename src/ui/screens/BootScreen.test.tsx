import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { BootScreen } from './BootScreen.js';
import type { BootReport } from '../../core/boot/bootFiles.js';

/**
 * The boot screen plays a kernel-boot animation, then — at the kernel-load step —
 * consults `resolveBoot` (the own-box FS, base + replayed journal, run through
 * `canBoot`). A bootable box finishes the sequence and hands off to the terminal
 * via `onComplete`. A box missing a `/boot` file HALTS on a GRUB/kernel-panic
 * screen and NEVER hands off — the brick is permanent and there is no terminal.
 * Driven with fake timers; the async cascade is advanced with the async variant.
 */

const bootable = (): Promise<BootReport> => Promise.resolve({ ok: true, started: [] });
const missingFile = (file: 'vmlinuz' | 'initrd.img') => (): Promise<BootReport> =>
  Promise.resolve({ ok: false, missing: file, started: [] });
const running =
  (...started: string[]) =>
  (): Promise<BootReport> =>
    Promise.resolve({ ok: true, started });

/** Every line the screen has revealed, in order. */
const revealedLines = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('div > div')].map((line) => line.textContent ?? '');

/** The lines systemd prints between bringing the network manager up and finding the
 *  wireless card, which is where a real boot starts the box's services. */
const serviceLines = (container: HTMLElement): string[] => {
  const lines = revealedLines(container);
  const after = lines.indexOf('[  OK  ] Started Network Manager.');
  const before = lines.findIndex((line) => line.startsWith('[  OK  ] Found device wlan0'));
  return lines.slice(after + 1, before);
};

describe('BootScreen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reveals the boot sequence and hands off to the terminal when the box can boot', async () => {
    const onComplete = vi.fn();
    render(() => (
      <BootScreen
        machineName="skylab"
        username="neo"
        resolveBoot={bootable}
        onComplete={onComplete}
      />
    ));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(screen.getByText(/Set hostname to <skylab>/)).toBeInTheDocument();
    expect(screen.getByText(/skylab login: neo/)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not hand off before the sequence has finished', async () => {
    const onComplete = vi.fn();
    render(() => (
      <BootScreen
        machineName="skylab"
        username="neo"
        resolveBoot={bootable}
        onComplete={onComplete}
      />
    ));

    await vi.advanceTimersByTimeAsync(200);

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('halts on a GRUB error and never hands off when /boot/vmlinuz is gone', async () => {
    const onComplete = vi.fn();
    render(() => (
      <BootScreen
        machineName="skylab"
        username="neo"
        resolveBoot={missingFile('vmlinuz')}
        onComplete={onComplete}
      />
    ));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(screen.getByText(/GRUB error: no loaded kernel\./)).toBeInTheDocument();
    expect(screen.getByText(/System halted\./)).toBeInTheDocument();
    // The terminal handoff never fires, and the success login line never shows.
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByText(/skylab login:/)).not.toBeInTheDocument();
  });

  it('panics on a failed root-fs mount and never hands off when /boot/initrd.img is gone', async () => {
    const onComplete = vi.fn();
    render(() => (
      <BootScreen
        machineName="skylab"
        username="neo"
        resolveBoot={missingFile('initrd.img')}
        onComplete={onComplete}
      />
    ));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(screen.getByText(/Kernel panic - not syncing/)).toBeInTheDocument();
    expect(screen.getByText(/System halted\./)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByText(/skylab login:/)).not.toBeInTheDocument();
  });

  it('starts each service the box runs, and no service it does not', async () => {
    const { container } = render(() => (
      <BootScreen
        machineName="skylab"
        username="neo"
        resolveBoot={running('mysql', 'http')}
        onComplete={vi.fn()}
      />
    ));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(serviceLines(container)).toEqual([
      '[  OK  ] Started A high performance web server and a reverse proxy server.',
      '[  OK  ] Started MySQL Community Server.',
    ]);
    expect(screen.queryByText(/Secure Shell|OpenSSH/)).not.toBeInTheDocument();
  });

  it('starts the services in the same order however the box lists them', async () => {
    const { container } = render(() => (
      <BootScreen
        machineName="skylab"
        username="neo"
        resolveBoot={running('domain', 'redis', 'http', 'snmp', 'ssh', 'mysql', 'ftp')}
        onComplete={vi.fn()}
      />
    ));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(serviceLines(container)).toEqual([
      '[  OK  ] Started OpenBSD Secure Shell server.',
      '[  OK  ] Started vsftpd FTP server.',
      '[  OK  ] Started A high performance web server and a reverse proxy server.',
      '[  OK  ] Started MySQL Community Server.',
      '[  OK  ] Started Advanced key-value store.',
      '[  OK  ] Started Simple Network Management Protocol (SNMP) Daemon.',
      '[  OK  ] Started BIND Domain Name Server.',
    ]);
  });

  it('starts no service on a box that runs none, and still hands off', async () => {
    const onComplete = vi.fn();
    const { container } = render(() => (
      <BootScreen
        machineName="skylab"
        username="neo"
        resolveBoot={bootable}
        onComplete={onComplete}
      />
    ));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(serviceLines(container)).toEqual([]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
