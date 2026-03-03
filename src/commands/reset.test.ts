import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AsyncOutput } from '../components/Terminal/types';
import { createResetCommand } from './reset';

// --- Helper Functions ---

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

// --- Mocks ---

const mockClearAllData = vi.fn().mockResolvedValue(undefined);

vi.mock('../utils/storage', () => ({
  clearAllData: (...args: unknown[]) => mockClearAllData(...args),
}));

// --- Tests ---

describe('reset command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mock window.location.reload
    Object.defineProperty(window, 'location', {
      value: { reload: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockClearAllData.mockReset().mockResolvedValue(undefined);
  });

  describe('without "confirm" argument', () => {
    it('should return warning string with no arguments', () => {
      const reset = createResetCommand({ getDatabase: () => null });
      const result = reset.fn();

      expect(typeof result).toBe('string');
      expect(result).toContain('reset("confirm")');
    });

    it('should return warning string with wrong argument', () => {
      const reset = createResetCommand({ getDatabase: () => null });
      const result = reset.fn('yes');

      expect(typeof result).toBe('string');
      expect(result).toContain('reset("confirm")');
    });

    it('should return warning string with non-string argument', () => {
      const reset = createResetCommand({ getDatabase: () => null });
      const result = reset.fn(true);

      expect(typeof result).toBe('string');
      expect(result).toContain('reset("confirm")');
    });
  });

  describe('with "confirm" argument', () => {
    it('should return AsyncOutput', () => {
      const reset = createResetCommand({ getDatabase: () => null });
      const result = reset.fn('confirm');

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should clear database and reload page', async () => {
      const mockDb = {} as IDBDatabase;
      const reset = createResetCommand({ getDatabase: () => mockDb });
      const result = reset.fn('confirm');

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

      // Let clearAllData promise resolve
      await vi.advanceTimersByTimeAsync(0);

      expect(mockClearAllData).toHaveBeenCalledWith(mockDb);
      expect(lines).toContain('Game reset. Reloading...');

      // Advance past reload delay
      await vi.advanceTimersByTimeAsync(500);

      expect(completed).toBe(true);
      expect(window.location.reload).toHaveBeenCalled();
    });

    it('should reload even without database connection', async () => {
      const reset = createResetCommand({ getDatabase: () => null });
      const result = reset.fn('confirm');

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

      expect(lines).toContain('No database connection. Reloading...');

      await vi.advanceTimersByTimeAsync(500);

      expect(completed).toBe(true);
      expect(window.location.reload).toHaveBeenCalled();
    });

    it('should reload even if clearAllData fails', async () => {
      const mockDb = {} as IDBDatabase;
      mockClearAllData.mockRejectedValueOnce(new Error('DB error'));
      const reset = createResetCommand({ getDatabase: () => mockDb });
      const result = reset.fn('confirm');

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

      // Let rejected promise settle
      await vi.advanceTimersByTimeAsync(0);

      expect(lines).toContain('Game reset. Reloading...');

      await vi.advanceTimersByTimeAsync(500);

      expect(completed).toBe(true);
      expect(window.location.reload).toHaveBeenCalled();
    });
  });
});
