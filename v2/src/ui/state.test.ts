import { describe, expect, it, vi } from 'vitest';

/**
 * Regression guard for the module-top-level init bug (see intro-screen plan).
 *
 * Before `startGame`, `state.ts` built the terminal session/cwd at module load
 * from hardcoded constants — so merely importing it ran identity + session
 * construction as an import side effect. Once those derive from post-intro
 * config (which does not exist at import time for a new player), import-time
 * init is a crash waiting to happen. These tests pin the property that import
 * is side-effect-free: nothing config-derived runs until `startGame(config)`.
 */

describe('state.ts module import', () => {
  it('does not throw when imported with no game started', async () => {
    // A fresh import of the module must not eagerly build a session/cwd.
    await expect(import('./state')).resolves.toBeDefined();
  });

  it('does not read game config from storage at import time', async () => {
    vi.resetModules();
    const getItem = vi.fn(() => null);
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn() });

    await import('./state');

    // Importing must not touch storage for game config — that happens in the
    // boot gate / startGame, not as an import side effect.
    expect(getItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

/**
 * A shell runs ONE command at a time. The terminal must not start a second
 * command while one is still in flight (including its async server refresh) —
 * otherwise the second command snapshots a stale FS view mid-refresh (e.g. a
 * just-written file looks missing, a just-deleted one still shows). This
 * surfaced in a real-browser cross-player test where the refresh is several
 * sequential round-trips. Interactive prompts (su/ssh password) route through
 * `submitPrompt`, not `runInput`, so they must stay unaffected.
 */
describe('runInput command serialization', () => {
  const startTestGame = async () => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    // startGame fire-and-forgets a journal/session refetch; keep it benign.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ patches: [], sessions: [] }) })),
    );
    const state = await import('./state');
    state.startGame({ machineName: 'box', username: 'tester', rootPassword: 'pw' });
    return state;
  };

  it('runs a second command only after the first completes (serial, no interleave)', async () => {
    const state = await startTestGame();

    state.setInput('echo AAA');
    const first = state.runInput();
    // No `await` between the two calls: the second is submitted while the first
    // is still in flight. It must QUEUE behind it, not run concurrently.
    state.setInput('echo BBB');
    const second = state.runInput();
    await Promise.all([first, second]);

    const lines = state.scrollback().map((line) => line.content);
    const firstOutput = lines.findIndex((line) => line === 'AAA');
    const secondEcho = lines.findIndex((line) => line.includes('echo BBB'));
    // Both ran (nothing dropped)...
    expect(firstOutput).toBeGreaterThanOrEqual(0);
    expect(secondEcho).toBeGreaterThanOrEqual(0);
    // ...and serially: the second command's echo lands AFTER the first's OUTPUT.
    // Concurrent execution would echo both commands first, interleaving them
    // ahead of the first command's output.
    expect(secondEcho).toBeGreaterThan(firstOutput);

    vi.unstubAllGlobals();
  });

  it('still runs commands submitted one after another', async () => {
    const state = await startTestGame();

    state.setInput('echo first');
    await state.runInput();
    state.setInput('echo second');
    await state.runInput();

    const text = state.scrollback().map((line) => line.content).join('\n');
    expect(text).toContain('first');
    expect(text).toContain('second');

    vi.unstubAllGlobals();
  });
});
