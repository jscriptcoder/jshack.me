import { afterEach, describe, expect, it, vi } from 'vitest';

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
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ patches: [], sessions: [] }),
      })),
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

    const text = state
      .scrollback()
      .map((line) => line.content)
      .join('\n');
    expect(text).toContain('first');
    expect(text).toContain('second');

    vi.unstubAllGlobals();
  });
});

/**
 * The boot screen asks `resolveBootCheck` whether the player's OWN box can come
 * up. It must resolve the own-workstation FS — base seed + the replayed shared
 * journal (which carries every writer's patches, including a cross-player
 * attacker's `/boot` tombstone) — and run it through `canBoot`. This is the seam
 * that turns a journalled `rm /boot/vmlinuz` into a permanent brick on next load.
 */
describe('resolveBootCheck', () => {
  afterEach(() => vi.unstubAllGlobals());

  const startWithJournal = async (patches: readonly unknown[]) => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    // Every signed call (listPatches / listSessions) gets the same journal back;
    // no `sessions`, so the hop chain stays at the base own-box session.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ patches, sessions: [] }) })),
    );
    const state = await import('./state');
    state.startGame({ machineName: 'box', username: 'tester', rootPassword: 'pw' });
    return state;
  };

  it('reports the box bootable when the journal has no boot-file tombstone', async () => {
    const state = await startWithJournal([]);

    await expect(state.resolveBootCheck()).resolves.toEqual({ ok: true });
  });

  it('reports the box bricked when the shared journal tombstones /boot/vmlinuz', async () => {
    const state = await startWithJournal([{ path: '/boot/vmlinuz', content: null, owner: 'root' }]);

    await expect(state.resolveBootCheck()).resolves.toEqual({ ok: false, missing: 'vmlinuz' });
  });

  it('degrades to bootable before the game has started (no session/identity/config yet)', async () => {
    // Defensive: the boot gate always calls startGame first, but if the check
    // ever runs cold it must not crash (no own box to fetch) — it boots.
    vi.resetModules();
    const state = await import('./state');

    await expect(state.resolveBootCheck()).resolves.toEqual({ ok: true });
  });
});

/**
 * `nano <file>` returns a `mode_change`, which the terminal must turn into an
 * open editor (the `editorMode` signal) — `executeLine` previously DROPPED
 * `mode_change` results entirely. `saveEditor` then persists the buffer through
 * the same patch-write seam the `>` redirect uses, resolving `isNew` from the
 * live FS view (an absent target is a brand-new file). The full save→`cat`
 * round-trip needs the real server, so it lives in the agent-browser E2E; here
 * we stub `fetch` and assert the WRITE the save issues (path/content/is_new).
 */
describe('nano editor mode', () => {
  afterEach(() => vi.unstubAllGlobals());

  const startEditorGame = async () => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    const requestBodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        if (init?.body !== undefined) requestBodies.push(init.body);
        return { ok: true, status: 200, json: async () => ({ patches: [], sessions: [] }) };
      }),
    );
    const state = await import('./state');
    state.startGame({ machineName: 'box', username: 'tester', rootPassword: 'pw' });
    // The last `upsertPatch` write the save issued, decoded from the signed
    // envelope (`{ payload: JSON.stringify({...fields, action, ...}) }`).
    const lastWrite = (): Record<string, unknown> | undefined =>
      requestBodies
        .map((body) => JSON.parse(JSON.parse(body).payload) as Record<string, unknown>)
        .filter((fields) => fields.action === 'upsertPatch')
        .at(-1);
    return { state, lastWrite };
  };

  it('opens the editor when `nano <file>` runs, carrying the file path + content', async () => {
    const { state } = await startEditorGame();
    expect(state.editorMode()).toBeNull();

    state.setInput('nano /etc/passwd');
    await state.runInput();

    const mode = state.editorMode();
    expect(mode?.path).toBe('/etc/passwd');
    // The buffer is the file's real content (the seed passwd has a root row).
    expect(mode?.content).toContain('root:');
  });

  it('leaves the editor closed for a non-editor command', async () => {
    const { state } = await startEditorGame();

    state.setInput('pwd');
    await state.runInput();

    expect(state.editorMode()).toBeNull();
  });

  it('saveEditor overwrites an existing file with isNew unset (preserves the row flag)', async () => {
    const { state, lastWrite } = await startEditorGame();
    state.setInput('nano /etc/passwd');
    await state.runInput();

    await state.saveEditor('root:x:0:0::/root:/bin/sh\n');

    const write = lastWrite();
    expect(write?.path).toBe('/etc/passwd');
    expect(write?.content).toBe('root:x:0:0::/root:/bin/sh\n');
    expect('is_new' in (write ?? {})).toBe(false);
  });

  it('saveEditor creates a not-yet-existing file with is_new=true', async () => {
    const { state, lastWrite } = await startEditorGame();
    state.setInput('nano /tmp/fresh.txt');
    await state.runInput();

    await state.saveEditor('hello world');

    const write = lastWrite();
    expect(write?.path).toBe('/tmp/fresh.txt');
    expect(write?.content).toBe('hello world');
    expect(write?.is_new).toBe(true);
  });
});
