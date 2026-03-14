import type { AsyncOutput } from '../components/Terminal/types';

type CancellationToken = {
  readonly isCancelled: () => boolean;
  readonly schedule: (fn: () => void, delay: number) => void;
  readonly cancel: () => void;
};

// Cancellation token for async commands (ping, nmap, ssh, airdump, aircrack).
// Tracks all scheduled timeouts so cancel() can clear them all at once,
// preventing dangling async output after the user interrupts a command.
const createCancellationToken = (): CancellationToken => {
  let cancelled = false;
  const timeoutIds: ReturnType<typeof setTimeout>[] = [];

  return {
    isCancelled: () => cancelled,
    schedule: (fn: () => void, delay: number) => {
      timeoutIds.push(setTimeout(fn, delay));
    },
    cancel: () => {
      cancelled = true;
      timeoutIds.forEach((id) => clearTimeout(id));
    },
  };
};

// Adds ±25% random variance to a base delay for realistic timing.
// Each call produces a different value, so staggered schedules drift naturally.
const JITTER_VARIANCE = 0.25;

const jitter = (baseMs: number): number =>
  Math.round(baseMs * (1 - JITTER_VARIANCE + Math.random() * JITTER_VARIANCE * 2));

// Bridges AsyncOutput into a Promise: starts the async command, collects all
// emitted lines, and optionally forwards each line to an onLine callback.
// Used by node scripts so `await hydra(...)` returns the collected output.
const collectAsyncOutput = (
  asyncOutput: AsyncOutput,
  onLine?: (line: string) => void,
): Promise<readonly string[]> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    asyncOutput.start(
      (line: string) => {
        lines[lines.length] = line;
        onLine?.(line);
      },
      () => resolve(lines),
    );
  });

export { createCancellationToken, jitter, collectAsyncOutput, type CancellationToken };
