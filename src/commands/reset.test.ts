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

    describe('server-side patch wipe (clearOwnedPatches)', () => {
      it('invokes clearOwnedPatches on confirmed reset (with DB)', async () => {
        const mockDb = {} as IDBDatabase;
        const clearOwnedPatches = vi.fn().mockResolvedValue(undefined);
        const reset = createResetCommand({ getDatabase: () => mockDb, clearOwnedPatches });
        const result = reset.fn('confirm');

        if (isAsyncOutput(result)) {
          result.start(
            () => {},
            () => {},
          );
        }
        await vi.advanceTimersByTimeAsync(0);

        expect(clearOwnedPatches).toHaveBeenCalledTimes(1);
      });

      it('invokes clearOwnedPatches even when no DB connection', async () => {
        const clearOwnedPatches = vi.fn().mockResolvedValue(undefined);
        const reset = createResetCommand({ getDatabase: () => null, clearOwnedPatches });
        const result = reset.fn('confirm');

        if (isAsyncOutput(result)) {
          result.start(
            () => {},
            () => {},
          );
        }
        await vi.advanceTimersByTimeAsync(0);

        expect(clearOwnedPatches).toHaveBeenCalledTimes(1);
      });

      it('reload still completes when clearOwnedPatches rejects', async () => {
        const mockDb = {} as IDBDatabase;
        const clearOwnedPatches = vi.fn().mockRejectedValue(new Error('server down'));
        const reset = createResetCommand({ getDatabase: () => mockDb, clearOwnedPatches });
        const result = reset.fn('confirm');

        let completed = false;
        if (isAsyncOutput(result)) {
          result.start(
            () => {},
            () => {
              completed = true;
            },
          );
        }
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(500);

        expect(completed).toBe(true);
        expect(window.location.reload).toHaveBeenCalled();
      });

      it('does not invoke clearOwnedPatches without "confirm" argument', () => {
        const clearOwnedPatches = vi.fn().mockResolvedValue(undefined);
        const reset = createResetCommand({ getDatabase: () => null, clearOwnedPatches });

        reset.fn();
        reset.fn('yes');

        expect(clearOwnedPatches).not.toHaveBeenCalled();
      });

      it('reset still works when clearOwnedPatches is omitted from context (back-compat)', async () => {
        const mockDb = {} as IDBDatabase;
        const reset = createResetCommand({ getDatabase: () => mockDb });
        const result = reset.fn('confirm');

        let completed = false;
        if (isAsyncOutput(result)) {
          result.start(
            () => {},
            () => {
              completed = true;
            },
          );
        }
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(500);

        expect(completed).toBe(true);
        expect(window.location.reload).toHaveBeenCalled();
      });

      it('does not reload until clearOwnedPatches has settled (regression for the abort-during-reload race)', async () => {
        // Defer clearOwnedPatches resolution so we can observe the gating.
        // If this test ever fails, somebody re-introduced the original bug
        // where window.location.reload aborted the in-flight DELETE.
        let resolveClear!: () => void;
        const clearOwnedPatches = vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveClear = resolve;
            }),
        );
        const mockDb = {} as IDBDatabase;
        const reset = createResetCommand({ getDatabase: () => mockDb, clearOwnedPatches });
        const result = reset.fn('confirm');

        if (isAsyncOutput(result)) {
          result.start(
            () => {},
            () => {},
          );
        }

        // Local clearAllData resolves; clearOwnedPatches is still pending.
        await vi.advanceTimersByTimeAsync(0);
        // Even after the would-be reload-delay window, reload must NOT
        // have fired — Promise.all is still waiting on the server side.
        await vi.advanceTimersByTimeAsync(500);
        expect(window.location.reload).not.toHaveBeenCalled();

        // Now resolve the server side; reload should follow after the
        // delay timer fires.
        resolveClear();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(500);
        expect(window.location.reload).toHaveBeenCalled();
      });
    });
  });
});
