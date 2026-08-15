import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateHomeLan } from '../core/generation/generateHomeLan';
import { machineIdForLanHost } from '../core/generation/lanHostIdentity';
import { lanLeaseCacheIn } from '../core/network/lanLeaseCache';
import { contentHash } from '../core/patches/contentHash';
import { CONNECTED_ESSID_KEY } from './connectionPersistence';
import { buildRemoteHostFs } from '../core/generation/remoteHostFs';
import { formatPidfileContent, readOpenPorts } from '../core/services/pidfile';
import { SERVICE_CATALOG } from '../core/services/serviceCatalog';
import { HTTP_DEFAULT_PORT } from '../core/network/http';
import { BINARY_STUB } from '../core/generation/binaries';
import type { PublicFetchResult } from '../core/commands/types';

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
 * The patch journal is per-machine, and the player moves between machines while a
 * fetch for one of them is still in flight — a reload lands straight back on an ssh
 * hop, and every hop swaps the journal under whatever was already asked for. The
 * journal the player SEES must belong to the machine they are standing on, whatever
 * order the answers come back in.
 *
 * Getting this wrong is worse than a confusing `ls`: `nano` saves the whole buffer,
 * so an editor opened over another machine's tree writes back a file stripped of
 * every row the real one holds — silently wiping a shared box's config. Reproduced
 * live on a shared gateway before the guard existed
 * (`docs/e2e-shared-network-verification.md`).
 */
describe('patch journal across a machine change', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ESSID = 'ferro-cafe';
  const LAN = generateHomeLan(ESSID);
  const REMOTE_HOST = LAN.hosts.find((host) => host.kind === 'machine');
  if (REMOTE_HOST === undefined) throw new Error(`no ordinary host generated on ${ESSID}`);
  const REMOTE_MACHINE_ID = machineIdForLanHost(REMOTE_HOST, ESSID);

  const OWN_BOX_FILE = 'note-on-my-own-box';
  const REMOTE_FILE = 'shared-config';

  /** Let every answer already in flight land: a macrotask turn runs only once the
   *  microtask queue — where the fetch/decode/apply chain lives — has drained. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  const patchRow = (name: string) => ({
    path: `/tmp/${name}`,
    content: 'contents',
    owner: 'root',
  });

  const hopSessionRow = {
    session_id: 'ssh-hop-1',
    machine_id: REMOTE_MACHINE_ID,
    credentials: { username: 'root', userType: 'root' },
    parent_session_id: null,
    source_ip: null,
    kind: 'ssh',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  /**
   * Start the game already connected to `ESSID` and already holding an ssh session
   * on a host of that LAN — the state a reload rehydrates into. Startup asks for the
   * OWN box's journal first, then rehydrates onto the hop and asks for that one;
   * `ownJournalHeld` decides which of the two answers comes back last.
   */
  const startOnRehydratedHop = async (options: { readonly ownJournalHeld: boolean }) => {
    vi.resetModules();
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    };
    storage.setItem(CONNECTED_ESSID_KEY, ESSID);
    lanLeaseCacheIn(storage).remember(ESSID, `${LAN.subnet}.77`);
    vi.stubGlobal('localStorage', storage);

    let openOwnJournalGate = (): void => undefined;
    const ownJournalGate = options.ownJournalHeld
      ? new Promise<void>((resolve) => {
          openOwnJournalGate = resolve;
        })
      : Promise.resolve();
    let markOwnJournalAnswered = (): void => undefined;
    const ownJournalAnswered = new Promise<void>((resolve) => {
      markOwnJournalAnswered = resolve;
    });

    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const fields = JSON.parse(JSON.parse(init?.body ?? '{}').payload) as Record<string, unknown>;
        if (fields.action === 'listSessions') return json({ sessions: [hopSessionRow] });
        if (fields.action !== 'listPatches') return json({});
        if (fields.machine_id === REMOTE_MACHINE_ID) {
          return json({ patches: [patchRow(REMOTE_FILE)] });
        }
        await ownJournalGate;
        markOwnJournalAnswered();
        return json({ patches: [patchRow(OWN_BOX_FILE)] });
      }),
    );

    const state = await import('./state');
    state.startGame({ machineName: 'box', username: 'tester', rootPassword: 'pw' });
    // Let the own box answer, then wait until it actually HAS — an absence
    // assertion made before the stale answer arrives would pass for free.
    const releaseOwnJournal = async (): Promise<void> => {
      openOwnJournalGate();
      await ownJournalAnswered;
      await settle();
    };
    return { state, releaseOwnJournal };
  };

  /** What `ls /tmp` shows the player right now, on whichever box they stand. */
  const listTmp = async (state: typeof import('./state')) => {
    state.setInput('ls /tmp');
    await state.runInput();
    return state
      .scrollback()
      .map((line) => line.content)
      .join('\n');
  };

  it('shows the hopped machine’s journal once the reload lands on the hop', async () => {
    const { state, releaseOwnJournal } = await startOnRehydratedHop({ ownJournalHeld: false });
    await vi.waitFor(() => expect(state.promptHost()).toBe(REMOTE_HOST.hostname));
    await releaseOwnJournal();

    expect(await listTmp(state)).toContain(REMOTE_FILE);
  });

  it('ignores a journal answer for the machine the player has already left', async () => {
    const { state, releaseOwnJournal } = await startOnRehydratedHop({ ownJournalHeld: true });
    await vi.waitFor(() => expect(state.promptHost()).toBe(REMOTE_HOST.hostname));

    // The own box finally answers — but the player is standing somewhere else now,
    // so its files must not appear, and the hop's journal must survive intact.
    await releaseOwnJournal();

    const listing = await listTmp(state);
    expect(listing).not.toContain(OWN_BOX_FILE);
    expect(listing).toContain(REMOTE_FILE);
  });
});

/**
 * A refresh loses the terminal that owned an ftp session, but the server row
 * outlives it: `sessions` has no TTL, so nothing would ever close it. An active
 * row is a standing write grant on somebody else's box, and replaying it as a hop
 * would hand the player a shell they never had — so boot closes it instead.
 */
describe('an ftp session abandoned by a refresh', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ESSID = 'ferro-cafe';
  const LAN = generateHomeLan(ESSID);
  const REMOTE_HOST = LAN.hosts.find((host) => host.kind === 'machine');
  if (REMOTE_HOST === undefined) throw new Error(`no ordinary host generated on ${ESSID}`);
  const REMOTE_MACHINE_ID = machineIdForLanHost(REMOTE_HOST, ESSID);

  const sessionRow = (over: Record<string, unknown>) => ({
    session_id: 'ftp-guest-1',
    machine_id: REMOTE_MACHINE_ID,
    credentials: { username: 'guest', userType: 'guest' },
    parent_session_id: null,
    source_ip: null,
    kind: 'ftp',
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  /** Boot with `rows` already active server-side, and report every payload sent. */
  const bootWithActiveSessions = async (rows: readonly Record<string, unknown>[]) => {
    vi.resetModules();
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    };
    storage.setItem(CONNECTED_ESSID_KEY, ESSID);
    lanLeaseCacheIn(storage).remember(ESSID, `${LAN.subnet}.77`);
    vi.stubGlobal('localStorage', storage);

    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const fields = JSON.parse(JSON.parse(init?.body ?? '{}').payload) as Record<string, unknown>;
        sent.push(fields);
        if (fields.action === 'listSessions') return { ok: true, status: 200, json: async () => ({ sessions: rows }) };
        return { ok: true, status: 200, json: async () => ({ patches: [] }) };
      }),
    );

    const state = await import('./state');
    state.startGame({ machineName: 'box', username: 'tester', rootPassword: 'pw' });
    return { state, sent };
  };

  it('ends the abandoned row, saying that is why, and leaves the player on their own box', async () => {
    const { state, sent } = await bootWithActiveSessions([sessionRow({})]);

    await vi.waitFor(() =>
      expect(sent.find((payload) => payload.action === 'endSession')).toEqual(
        expect.objectContaining({ session_id: 'ftp-guest-1', reason: 'abandoned' }),
      ),
    );
    // Never stacked: the player is home, not standing on the ftp target.
    expect(state.promptHost()).toBe('box');
  });

  it('leaves an ssh hop alone — it is a real rung, and boot restores it', async () => {
    const { state, sent } = await bootWithActiveSessions([
      sessionRow({
        session_id: 'ssh-hop-1',
        kind: 'ssh',
        credentials: { username: 'root', userType: 'root' },
      }),
    ]);

    await vi.waitFor(() => expect(state.promptHost()).toBe(REMOTE_HOST.hostname));
    expect(sent.find((payload) => payload.action === 'endSession')).toBeUndefined();
  });
});

/**
 * The `ftp>` prompt is a SUB-SHELL over the same terminal, not a screen. While it
 * is held, a typed line is answered by the ftp command map instead of the registry
 * — and that refusal is the point: the outer shell's `ls`/`cat`/`rm` would act on
 * the machine the player is standing on while they believe they are addressing the
 * remote. The shell underneath never moves, so `quit` hands it straight back.
 */
describe('the ftp sub-shell', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ESSID = 'ferro-cafe';
  const LAN = generateHomeLan(ESSID);
  const FTP_HOST = LAN.hosts.find(
    (host) =>
      host.kind === 'machine' &&
      readOpenPorts(buildRemoteHostFs(ESSID, host)).some((open) => open.service === 'ftp'),
  );
  if (FTP_HOST === undefined) throw new Error(`no ftp-serving host on ${ESSID}`);

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /** Boot online, then log into the ftp host by actually typing the command and
   *  answering both prompts — the shipped path, not a poked signal. */
  const loginOverFtp = async () => {
    vi.resetModules();
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    };
    storage.setItem(CONNECTED_ESSID_KEY, ESSID);
    lanLeaseCacheIn(storage).remember(ESSID, `${LAN.subnet}.77`);
    vi.stubGlobal('localStorage', storage);

    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const fields = JSON.parse(JSON.parse(init?.body ?? '{}').payload) as Record<string, unknown>;
        sent.push(fields);
        if (fields.action === 'listSessions') {
          return { ok: true, status: 200, json: async () => ({ sessions: [] }) };
        }
        if (fields.action === 'authCreateSession') {
          return { ok: true, status: 200, json: async () => ({ ok: true, userType: 'guest' }) };
        }
        // The ftp CLIENT is apt-gated, so the box has to already carry it — the
        // player would have run `apt install ftp` before ever reaching this door.
        return {
          ok: true,
          status: 200,
          json: async () => ({
            patches: [
              {
                path: '/usr/bin/ftp',
                content: BINARY_STUB,
                owner: 'root',
                // World-executable, the way `apt install` stamps a tool: a binary only
                // root could run would be no use to the player who installed it.
                permissions: {
                  read: ['root', 'user', 'guest'],
                  write: ['root'],
                  execute: ['root', 'user', 'guest'],
                },
              },
            ],
          }),
        };
      }),
    );

    const state = await import('./state');
    state.startGame({ machineName: 'box', username: 'tester', rootPassword: 'pw' });
    await vi.waitFor(() => expect(state.promptHost()).toBe('box'));
    // The boot journal fetch is in flight; the ftp client only exists once it lands.
    await vi.waitFor(async () => {
      state.setInput('ls /usr/bin');
      await state.runInput();
      expect(state.scrollback().at(-1)?.content ?? '').toContain('ftp');
    });

    state.setInput(`ftp ${FTP_HOST.ip}`);
    const run = state.runInput();
    // Name, then password — answered the way the player answers them.
    await vi.waitFor(() => expect(state.pendingPrompt()).toBeDefined());
    state.setInput('guest');
    state.submitPrompt();
    await vi.waitFor(() => expect(state.pendingPrompt()).toBeDefined());
    state.setInput('hunter2');
    state.submitPrompt();
    await run;
    await settle();

    return { state, sent };
  };

  const lastLine = (state: typeof import('./state')): string =>
    state.scrollback().at(-1)?.content ?? '';

  it('lands at ftp> on a good credential, refuses shell commands there, and quits back', async () => {
    const { state, sent } = await loginOverFtp();

    expect(state.inFtpSession()).toBe(true);
    // The server was asked for an ftp-kind row, not a hop.
    expect(sent.find((payload) => payload.action === 'authCreateSession')).toMatchObject({
      kind: 'ftp',
      username: 'guest',
    });

    state.setInput('ls /');
    await state.runInput();
    expect(lastLine(state)).toContain('?Invalid command');

    state.setInput('quit');
    await state.runInput();

    expect(lastLine(state)).toContain('221 Goodbye');
    expect(state.inFtpSession()).toBe(false);
    // The player closed it themselves, so the row is an exit — not an abandonment.
    await vi.waitFor(() =>
      expect(sent.find((payload) => payload.action === 'endSession')).toEqual(
        expect.objectContaining({ reason: 'user_exit' }),
      ),
    );
  });

  it('leaves the shell exactly where it was — the ftp session is beside it, not above it', async () => {
    const { state } = await loginOverFtp();

    // Even while the ftp session is HELD, the shell underneath is the player's own
    // box at their own tier — an `ssh` login would have moved all three.
    expect(state.promptHost()).toBe('box');
    expect(state.promptUsername()).toBe('tester');
    expect(state.cwd()).toBe('/home/tester');

    state.setInput('quit');
    await state.runInput();
    state.setInput('pwd');
    await state.runInput();

    expect(state.promptHost()).toBe('box');
    expect(lastLine(state)).toBe('/home/tester');
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

  const startEditorGame = async (options: { readonly refuseWrites?: boolean } = {}) => {
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
        // Only the WRITE is refused: the journal and session reads the editor
        // rides on still have to answer, or the game never reaches a buffer.
        const isWrite =
          init?.body !== undefined &&
          (JSON.parse(JSON.parse(init.body).payload) as { action?: string }).action ===
            'upsertPatch';
        if (options.refuseWrites === true && isWrite) {
          return { ok: false, status: 409, json: async () => ({ error: 'modified_since_open' }) };
        }
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
    expect(state.overlayMode()).toBeNull();

    state.setInput('nano /etc/passwd');
    await state.runInput();

    // The EDITOR opened, not merely some overlay — the terminal has more than one
    // full-screen app to hand the screen to.
    expect(state.overlayMode()).toMatchObject({ kind: 'nano', path: '/etc/passwd' });
    // The buffer is the file's real content (the seed passwd has a root row).
    expect(state.overlayMode()?.content).toContain('root:');
  });

  it('leaves the editor closed for a non-editor command', async () => {
    const { state } = await startEditorGame();

    state.setInput('pwd');
    await state.runInput();

    expect(state.overlayMode()).toBeNull();
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

  it('saveEditor names the content the editor opened with, so an unseen write can be refused', async () => {
    const { state, lastWrite } = await startEditorGame();
    state.setInput('nano /etc/passwd');
    await state.runInput();
    const opened = state.overlayMode()?.content ?? '';

    await state.saveEditor('root:x:0:0::/root:/bin/sh\n');

    // The base is what was OPENED, never the buffer being written — the server
    // compares it against what the machine holds to decide whether this save
    // would destroy somebody else's edit.
    expect(lastWrite()?.base_hash).toBe(contentHash(opened));
    expect(opened).not.toBe('root:x:0:0::/root:/bin/sh\n');
  });

  it('advances the base once a save lands, so a second write-out is not refused as stale', async () => {
    // Ctrl-O keeps the editor open. Without this, the second save would still
    // claim the pre-save content as its base and the server would reject it
    // against the row the first save had just written.
    const { state, lastWrite } = await startEditorGame();
    state.setInput('nano /etc/passwd');
    await state.runInput();

    await state.saveEditor('first pass\n');
    await state.saveEditor('second pass\n');

    expect(lastWrite()?.base_hash).toBe(contentHash('first pass\n'));
  });

  it('leaves the base alone when a save is refused, since nothing was written', async () => {
    // A refused save changed nothing on the machine, so the next attempt must
    // still be judged against what the player was actually shown — advancing to
    // an unwritten buffer would claim a version the machine never held.
    const { state, lastWrite } = await startEditorGame({ refuseWrites: true });
    state.setInput('nano /etc/passwd');
    await state.runInput();
    const opened = state.overlayMode()?.content ?? '';

    await state.saveEditor('first attempt\n');
    await state.saveEditor('second attempt\n');

    expect(lastWrite()?.base_hash).toBe(contentHash(opened));
  });

  it('refuses a save when no editor is open, rather than throwing', async () => {
    // `saveEditor` is exported, so it is reachable with no buffer behind it — a
    // stale keystroke arriving after the editor closed, say. It reports a lost
    // session and writes nothing.
    const { state, lastWrite } = await startEditorGame();

    const result = await state.saveEditor('content with nowhere to go\n');

    expect(result).toEqual({ ok: false, error: 'no_session' });
    expect(lastWrite()).toBeUndefined();
  });

  it('sends no base at all when the player forces the overwrite', async () => {
    // Forcing is not "name a different base" — it is naming NONE, which is the
    // unconditional write the server already accepts for `>` and `touch`. A
    // base of '' would be a base like any other, compared and refused.
    const { state, lastWrite } = await startEditorGame({ refuseWrites: true });
    state.setInput('nano /etc/passwd');
    await state.runInput();

    await state.saveEditor('clobbered\n', { overwriteUnseen: true });

    expect('base_hash' in (lastWrite() ?? {})).toBe(false);
    expect(lastWrite()?.content).toBe('clobbered\n');
  });
});

/**
 * A command can ask the terminal to hand the screen to a full-screen app. `nano`
 * was the first; the browser is the second, and it proves the terminal opens the
 * app the command NAMED rather than the only one it used to know about.
 */
describe('full-screen apps a command opens', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ESSID = 'BEAN-THERE-WIFI';

  /** An installed binary, delivered the way apt really delivers one: as a patch
   *  on the player's own journal. */
  const INSTALLED_LYNX = {
    path: '/usr/bin/lynx',
    content: '',
    owner: 'root',
    permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root', 'user'] },
  };

  /** A generated host on the player's own LAN that serves the web, and the port
   *  it listens on — a real target rather than an assumed one. */
  const webHostOnLan = () => {
    for (const host of generateHomeLan(ESSID).hosts) {
      if (host.kind !== 'machine') continue;
      const web = readOpenPorts(buildRemoteHostFs(ESSID, host)).find(
        (entry) => entry.service === 'http',
      );
      if (web !== undefined) return { host, port: web.port };
    }
    throw new Error('expected a generated web host on the LAN');
  };

  /** An address on the player's own subnet that no generated host occupies. */
  const unoccupiedIp = (): string => {
    const lan = generateHomeLan(ESSID);
    const taken = new Set(lan.hosts.map((host) => host.ip));
    const free = Array.from({ length: 253 }, (_unused, index) => `${lan.subnet}.${index + 2}`).find(
      (ip) => !taken.has(ip),
    );
    if (free === undefined) throw new Error('expected a free address on the subnet');
    return free;
  };

  /** An online player with `lynx` installed — online by the persisted-connection
   *  route, so the test costs a rehydrate rather than a full crack journey.
   *  Coming back online needs BOTH halves the game persists: the ESSID, and the
   *  address that network leased. */
  const startBrowsingGame = async (options?: {
    readonly published?: readonly object[];
    /** What another player's public IP answers when this one asks it for a page.
     *  Absent means nothing out there answers at all. */
    readonly across?: () => PublicFetchResult;
  }) => {
    vi.resetModules();
    const store = new Map<string, string>([[CONNECTED_ESSID_KEY, ESSID]]);
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    };
    lanLeaseCacheIn(storage).remember(ESSID, unoccupiedIp());
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_endpoint: unknown, init?: { readonly body?: string }) => {
        // The action rides inside the signed envelope's payload, which is itself a
        // JSON string — so its quotes are escaped and only the bare name survives a
        // substring match. No other action shares it.
        if ((init?.body ?? '').includes('resolveHttpFetch')) {
          const answered = options?.across?.() ?? { ok: false as const, error: 'host_unreachable' as const };
          return answered.ok
            ? { ok: true, status: 200, json: async () => ({ ok: true, content: answered.content }) }
            : { ok: false, status: 502, json: async () => ({ error: answered.error }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            patches: [INSTALLED_LYNX, ...(options?.published ?? [])],
            sessions: [],
          }),
        };
      }),
    );
    const state = await import('./state');
    state.startGame({ machineName: 'box', username: 'tester', rootPassword: 'pw' });
    // The installed binary arrives with the journal, which `startGame` fetches in
    // the background — so the tool is genuinely absent for the first few ticks.
    // One macrotask boundary lands after the WHOLE fetch chain here (every promise
    // in it is already resolved, and nothing waits on a timer or real I/O), which
    // is why this is an ordering guarantee rather than a sleep.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return state;
  };

  it('opens the browser on the page `lynx <url>` fetched', async () => {
    const state = await startBrowsingGame();
    const { host, port } = webHostOnLan();
    const url = `http://${host.ip}:${port}/index.html`;

    state.setInput(`lynx ${url}`);
    await state.runInput();

    const overlay = state.overlayMode();
    expect(overlay?.kind).toBe('lynx');
    expect(overlay).toMatchObject({ url });
  });

  it('leaves the screen alone when the page never came back', async () => {
    const state = await startBrowsingGame();
    const { host, port } = webHostOnLan();

    state.setInput(`lynx http://${host.ip}:${port}/nothing-here`);
    await state.runInput();

    // A browser that opened on a 404 would have nothing to show, so the refusal
    // belongs in the terminal — where the scrollback now carries it.
    expect(state.overlayMode()).toBeNull();
  });

  /** A player's own box, publishing a two-page site. Generated hosts render
   *  linkless by design, so a site with a link in it is one the player wrote. */
  const OWN_SITE = [
    {
      path: '/var/run/nginx.pid',
      content: formatPidfileContent(SERVICE_CATALOG.http, HTTP_DEFAULT_PORT),
      owner: 'root',
    },
    {
      path: '/var/www/html/index.html',
      content: '<h1>mine</h1><p><a href="/notes.html">the notes</a></p>',
      owner: 'root',
    },
    { path: '/var/www/html/notes.html', content: '<h1>notes</h1>', owner: 'root' },
  ];

  const openBrowserOnOwnSite = async () => {
    const state = await startBrowsingGame({ published: OWN_SITE });
    state.setInput('lynx http://localhost/');
    await state.runInput();
    expect(state.overlayMode()).toMatchObject({ kind: 'lynx', url: 'http://localhost/' });
    return state;
  };

  it('follows a link to the next page the box publishes', async () => {
    const state = await openBrowserOnOwnSite();

    const outcome = await state.followLink('http://localhost/notes.html');

    expect(outcome).toEqual({ ok: true });
    expect(state.overlayMode()).toMatchObject({
      kind: 'lynx',
      url: 'http://localhost/notes.html',
      content: '<h1>notes</h1>',
    });
  });

  // The browser is already open by the time a link is followed, so a path the box
  // does not publish is a page to render rather than a reason to close.
  it('shows a link to a path the box does not publish as a page, not as a dead end', async () => {
    const state = await openBrowserOnOwnSite();

    const outcome = await state.followLink('http://localhost/missing.html');

    expect(outcome).toEqual({ ok: true });
    expect(state.overlayMode()).toMatchObject({ url: 'http://localhost/missing.html' });
    expect(state.overlayMode()?.content).toContain('404');
  });

  /** A free address that is NOT the player's own: `unoccupiedIp` is the one this
   *  game leases them, so reaching for it again would target the box they are
   *  browsing rather than an empty stretch of the subnet. */
  const unleasedIp = (): string => {
    const lan = generateHomeLan(ESSID);
    const taken = new Set([...lan.hosts.map((host) => host.ip), unoccupiedIp()]);
    const free = Array.from({ length: 253 }, (_unused, index) => `${lan.subnet}.${index + 2}`).find(
      (ip) => !taken.has(ip),
    );
    if (free === undefined) throw new Error('expected a second free address on the subnet');
    return free;
  };

  it('stays on the page when the link led somewhere nothing answered', async () => {
    const state = await openBrowserOnOwnSite();
    const dark = unleasedIp();

    const outcome = await state.followLink(`http://${dark}/index.html`);

    // Nothing holds that address at all, so there is no host to resolve — a closed
    // port would be a different sentence. Named in full, program included: the tool a
    // failure came from is its own literal, and a message asserted from the middle
    // would not notice losing it.
    expect(outcome).toMatchObject({
      ok: false,
      alert: expect.stringContaining(`lynx: (6) Could not resolve host: ${dark}`),
    });
    expect(state.overlayMode()).toMatchObject({ url: 'http://localhost/' });
  });

  it('rejects a link written to an address it cannot even read as one', async () => {
    const state = await openBrowserOnOwnSite();

    const outcome = await state.followLink('not-a-url');

    expect(outcome).toMatchObject({ ok: false });
    expect(state.overlayMode()).toMatchObject({ url: 'http://localhost/' });
  });

  // Only the browser navigates the browser: nothing else on screen has a page to
  // move on from, and a stray follow must not conjure one.
  it('opens nothing when no browser is on screen to follow a link', async () => {
    const state = await startBrowsingGame({ published: OWN_SITE });

    const outcome = await state.followLink('http://localhost/notes.html');

    expect(outcome).toMatchObject({ ok: false });
    expect(state.overlayMode()).toBeNull();
  });

  const THEIR_PUBLIC_IP = '203.0.113.7';
  /** Another player's page — and nothing on this player's own box is named like it,
   *  so reading these words proves the request left the LAN. */
  const THEIR_PAGE =
    '<h1>nebuchadnezzar</h1><p>Also <a href="/deeper.html">deeper in</a>.</p>';

  it('opens the browser on a page from behind another player public IP', async () => {
    const state = await startBrowsingGame({
      across: () => ({ ok: true, content: THEIR_PAGE }),
    });

    state.setInput(`lynx http://${THEIR_PUBLIC_IP}/`);
    await state.runInput();

    // The address the browser holds is the PUBLIC one, which is what makes every
    // later move from this page — a link, or a step back to it — go out again.
    expect(state.overlayMode()).toMatchObject({
      kind: 'lynx',
      url: `http://${THEIR_PUBLIC_IP}/`,
    });
  });

  it('follows a link on another player page across the network, not into the local tree', async () => {
    const across = vi.fn((): PublicFetchResult => ({ ok: true, content: THEIR_PAGE }));
    const state = await startBrowsingGame({ published: OWN_SITE, across });
    state.setInput(`lynx http://${THEIR_PUBLIC_IP}/`);
    await state.runInput();

    // A relative href on a page that is not local resolves against THAT host — the
    // player's own box publishes no such path, so a fallback would render a 404.
    const outcome = await state.followLink(`http://${THEIR_PUBLIC_IP}/deeper.html`);

    expect(outcome).toEqual({ ok: true });
    expect(across).toHaveBeenCalledTimes(2);
    expect(state.overlayMode()).toMatchObject({
      url: `http://${THEIR_PUBLIC_IP}/deeper.html`,
      content: THEIR_PAGE,
    });
  });

  it('leaves the reader where they are when the target refused the followed link', async () => {
    let answered = 0;
    const state = await startBrowsingGame({
      across: (): PublicFetchResult => {
        answered += 1;
        return answered === 1
          ? { ok: true, content: THEIR_PAGE }
          : { ok: false, error: 'host_unreachable' };
      },
    });
    state.setInput(`lynx http://${THEIR_PUBLIC_IP}/`);
    await state.runInput();

    const outcome = await state.followLink(`http://${THEIR_PUBLIC_IP}/deeper.html`);

    expect(outcome).toMatchObject({
      ok: false,
      alert: expect.stringContaining(`lynx: (7) Failed to connect to ${THEIR_PUBLIC_IP} port 80`),
    });
    expect(state.overlayMode()).toMatchObject({ url: `http://${THEIR_PUBLIC_IP}/` });
  });
});
