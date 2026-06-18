import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { BootScreen } from './boot';
import type { BootCheck } from '../../core/boot/bootFiles';

/**
 * The boot screen plays a kernel-boot animation, then — at the kernel-load step —
 * consults `resolveBoot` (the own-box FS, base + replayed journal, run through
 * `canBoot`). A bootable box finishes the sequence and hands off to the terminal
 * via `onComplete`. A box missing a `/boot` file HALTS on a GRUB/kernel-panic
 * screen and NEVER hands off — the brick is permanent and there is no terminal.
 * Driven with fake timers; the async cascade is advanced with the async variant.
 */

const bootable = (): Promise<BootCheck> => Promise.resolve({ ok: true });
const missingFile = (file: 'vmlinuz' | 'initrd.img') => (): Promise<BootCheck> =>
  Promise.resolve({ ok: false, missing: file });

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
});
