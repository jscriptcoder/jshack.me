import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AsyncOutput } from '../components/Terminal/types';
import { createResolveCommand } from './resolve';

// --- Helper Functions ---

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

const collectAsyncOutput = (asyncOutput: AsyncOutput): Promise<readonly string[]> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    asyncOutput.start(
      (line) => lines.push(line),
      () => resolve(lines),
    );
  });

// --- Tests ---

describe('resolve command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('non-Promise values', () => {
    it('should display string value directly', async () => {
      const resolve = createResolveCommand();
      const result = resolve.fn('hello world');

      expect(isAsyncOutput(result)).toBe(true);
      if (isAsyncOutput(result)) {
        const lines = await collectAsyncOutput(result);
        expect(lines).toEqual(['hello world']);
      }
    });

    it('should display number value', async () => {
      const resolve = createResolveCommand();
      const result = resolve.fn(42);

      if (isAsyncOutput(result)) {
        const lines = await collectAsyncOutput(result);
        expect(lines).toEqual(['42']);
      }
    });

    it('should display object as JSON', async () => {
      const resolve = createResolveCommand();
      const result = resolve.fn({ key: 'value' });

      if (isAsyncOutput(result)) {
        const lines = await collectAsyncOutput(result);
        expect(lines[0]).toContain('"key"');
        expect(lines[0]).toContain('"value"');
      }
    });

    it('should display null', async () => {
      const resolve = createResolveCommand();
      const result = resolve.fn(null);

      if (isAsyncOutput(result)) {
        const lines = await collectAsyncOutput(result);
        expect(lines).toEqual(['null']);
      }
    });

    it('should display undefined', async () => {
      const resolve = createResolveCommand();
      const result = resolve.fn(undefined);

      if (isAsyncOutput(result)) {
        const lines = await collectAsyncOutput(result);
        expect(lines).toEqual(['undefined']);
      }
    });
  });

  describe('Promise resolution', () => {
    it('should show Resolving... message first', () => {
      const resolve = createResolveCommand();
      const promise = new Promise(() => {}); // Never resolves

      const result = resolve.fn(promise);

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines[0]).toBe('Resolving...');
    });

    it('should display resolved value', async () => {
      const resolve = createResolveCommand();
      const promise = Promise.resolve('resolved value');

      const result = resolve.fn(promise);

      const lines: string[] = [];
      let completed = false;

      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {
            completed = true;
          },
        );
      }

      // Advance past the delay
      await vi.advanceTimersByTimeAsync(200);

      expect(completed).toBe(true);
      expect(lines).toContain('resolved value');
    });

    it('should display error on rejection', async () => {
      const resolve = createResolveCommand();
      // Attach a catch handler to prevent unhandled rejection
      const promise = Promise.reject(new Error('Something went wrong'));
      promise.catch(() => {}); // Prevent unhandled rejection warning

      const result = resolve.fn(promise);

      const lines: string[] = [];
      let completed = false;

      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {
            completed = true;
          },
        );
      }

      await vi.advanceTimersByTimeAsync(200);

      expect(completed).toBe(true);
      expect(lines.some((line) => line.includes('Error: Something went wrong'))).toBe(true);
    });

    it('should handle non-Error rejection', async () => {
      const resolve = createResolveCommand();
      // Attach a catch handler to prevent unhandled rejection
      const promise = Promise.reject('string error');
      promise.catch(() => {}); // Prevent unhandled rejection warning

      const result = resolve.fn(promise);

      const lines: string[] = [];

      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      await vi.advanceTimersByTimeAsync(200);

      expect(lines.some((line) => line.includes('Error: string error'))).toBe(true);
    });
  });

  describe('cancellation', () => {
    it('should have cancel function', () => {
      const resolve = createResolveCommand();
      const result = resolve.fn(Promise.resolve('value'));

      expect(isAsyncOutput(result)).toBe(true);
      if (isAsyncOutput(result)) {
        expect(typeof result.cancel).toBe('function');
      }
    });

    it('should not complete after cancellation', async () => {
      const resolve = createResolveCommand();
      const promise = Promise.resolve('value');

      const result = resolve.fn(promise);

      let completed = false;

      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          () => {
            completed = true;
          },
        );
        result.cancel?.();
      }

      await vi.advanceTimersByTimeAsync(200);

      expect(completed).toBe(false);
    });
  });
});
