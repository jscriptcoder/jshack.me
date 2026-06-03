import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortableSleep } from './sleep';

/**
 * `abortableSleep` is the real (UI-side) implementation behind `env.sleep` — the
 * abort-aware pacing seam streamed commands (airdump, later aircrack/hydra/nmap)
 * use to drama-pace output. Its whole reason to exist over a bare setTimeout is
 * that it REJECTS when the command's AbortSignal fires, so Ctrl-C can stop a
 * crack mid-flight. Tests use fake timers so they're instant and deterministic.
 */
describe('abortableSleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the requested delay elapses', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const sleeping = abortableSleep(controller.signal, 250);

    let settled = false;
    void sleeping.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sleeping;
    expect(settled).toBe(true);
  });

  it('rejects with the signal reason when already aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();

    await expect(abortableSleep(controller.signal, 250)).rejects.toBe(controller.signal.reason);
  });

  it('rejects with the signal reason when aborted before the delay elapses', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    // Attach the catch immediately (no unhandled rejection), assert after abort
    // when the signal's reason is populated.
    const caught = abortableSleep(controller.signal, 250).catch((reason: unknown) => reason);

    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect(await caught).toBe(controller.signal.reason);
  });
});
