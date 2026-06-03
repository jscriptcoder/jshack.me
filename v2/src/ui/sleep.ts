/**
 * abortableSleep — the real (UI-side) `env.sleep`.
 *
 * A setTimeout-backed delay that also REJECTS when the given AbortSignal fires,
 * so a streamed command paused mid-output (airdump's scan, aircrack's crack)
 * stops the instant the player hits Ctrl-C rather than running its timer out.
 * `core/` only sees the injected `(ms) => Promise<void>` seam; this real timer
 * is a UI concern, kept out of the framework-agnostic core. Tests inject an
 * instant sleep instead of using this.
 *
 * The rejection value is `signal.reason` — the spec guarantees an aborted
 * signal carries a reason (an `AbortError` DOMException by default), so no
 * hand-rolled fallback is needed.
 */

export const abortableSleep = (signal: AbortSignal, ms: number): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });
