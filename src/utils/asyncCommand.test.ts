import { describe, it, expect, vi } from 'vitest';
import { collectAsyncOutput } from './asyncCommand';
import type { AsyncOutput } from '../components/Terminal/types';

// --- Factory ---

const createMockAsyncOutput = (
  lines: readonly string[],
  delayMs = 0,
): AsyncOutput => ({
  __type: 'async',
  start: (onLine, onComplete) => {
    lines.forEach((line, i) => {
      if (delayMs > 0) {
        setTimeout(() => onLine(line), delayMs * (i + 1));
      } else {
        onLine(line);
      }
    });
    if (delayMs > 0) {
      setTimeout(() => onComplete(), delayMs * (lines.length + 1));
    } else {
      onComplete();
    }
  },
});

// --- Tests ---

describe('collectAsyncOutput', () => {
  it('resolves with all lines emitted by the async output', async () => {
    const asyncOutput = createMockAsyncOutput(['line 1', 'line 2', 'line 3']);

    const result = await collectAsyncOutput(asyncOutput);

    expect(result).toEqual(['line 1', 'line 2', 'line 3']);
  });

  it('forwards each line to the onLine callback', async () => {
    const onLine = vi.fn();
    const asyncOutput = createMockAsyncOutput(['alpha', 'bravo']);

    await collectAsyncOutput(asyncOutput, onLine);

    expect(onLine).toHaveBeenCalledTimes(2);
    expect(onLine).toHaveBeenCalledWith('alpha');
    expect(onLine).toHaveBeenCalledWith('bravo');
  });

  it('resolves to empty array when no lines are emitted', async () => {
    const asyncOutput = createMockAsyncOutput([]);

    const result = await collectAsyncOutput(asyncOutput);

    expect(result).toEqual([]);
  });

  it('works with delayed async output', async () => {
    vi.useFakeTimers();
    const onLine = vi.fn();
    const asyncOutput = createMockAsyncOutput(['slow 1', 'slow 2'], 100);

    const promise = collectAsyncOutput(asyncOutput, onLine);

    // Lines haven't arrived yet
    expect(onLine).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(onLine).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toEqual(['slow 1', 'slow 2']);
    vi.useRealTimers();
  });

  it('does not require an onLine callback', async () => {
    const asyncOutput = createMockAsyncOutput(['silent']);

    const result = await collectAsyncOutput(asyncOutput);

    expect(result).toEqual(['silent']);
  });
});
