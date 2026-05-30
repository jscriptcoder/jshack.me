import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { BootScreen } from './boot';

/**
 * The boot screen plays a fake kernel-boot animation: lines appear over time,
 * then it calls `onComplete` to hand off to the terminal. Driven with fake
 * timers — tests advance the clock and assert lines reveal + the handoff fires.
 */

describe('BootScreen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reveals boot lines as time advances, including the typed machine name', () => {
    render(() => <BootScreen machineName="skylab" username="neo" onComplete={vi.fn()} />);

    // Nothing (or almost nothing) shown immediately…
    expect(screen.queryByText(/Set hostname to <skylab>/)).not.toBeInTheDocument();

    // …then the full sequence plays out.
    vi.advanceTimersByTime(10_000);

    expect(screen.getByText(/Set hostname to <skylab>/)).toBeInTheDocument();
    expect(screen.getByText(/skylab login: neo/)).toBeInTheDocument();
  });

  it('calls onComplete once after the sequence finishes', () => {
    const onComplete = vi.fn();
    render(() => <BootScreen machineName="skylab" username="neo" onComplete={onComplete} />);

    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not call onComplete before the sequence has finished', () => {
    const onComplete = vi.fn();
    render(() => <BootScreen machineName="skylab" username="neo" onComplete={onComplete} />);

    // Part-way through the boot, the handoff must not have fired yet.
    vi.advanceTimersByTime(200);

    expect(onComplete).not.toHaveBeenCalled();
  });
});
