import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateHomeLan } from '../core/generation/generateHomeLan';
import { machineIdForLanHost } from '../core/generation/lanHostIdentity';
import { lanLeaseCacheIn } from '../core/network/lanLeaseCache';
import { contentHash } from '../core/patches/contentHash';
import { CONNECTED_ESSID_KEY } from './connectionPersistence';
import { buildRemoteHostFs } from '../core/generation/remoteHostFs';
import {
  PIDFILE_PERMISSIONS,
  daemonName,
  formatListenerContent,
  formatPidfileContent,
  readOpenPorts,
} from '../core/services/pidfile';
import { applyPatches, type Patch } from '../core/filesystem/applyPatches';
import { defaultFilePermissions } from '../core/filesystem/defaultPermissions';
import { SERVICE_CATALOG } from '../core/services/serviceCatalog';
import { HTTP_DEFAULT_PORT } from '../core/network/http';
import { BINARY_STUB } from '../core/generation/binaries';
import { serializeTree } from '../core/filesystem/treeCodec';
import { buildDirectory, buildFile } from '../test/factories/filesystem';
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
 * A transfer against ANOTHER player's box.
 *
 * The client cannot rebuild a stranger's machine — it has neither their seed nor
 * their patch rows — so the tree an `scp` read addresses has to come back from the
 * server, pre-filtered to the tier the credential bought. Getting that branch wrong
 * has one specific failure: the local resolver falls back to the player's OWN base,
 * and a transfer that reports success hands them their own file wearing somebody
 * else's name. So the file being read exists on BOTH boxes with different contents,
 * and only the far side's says where it came from.
 */
describe('a transfer across the network', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ESSID = 'ferro-cafe';
  const LAN = generateHomeLan(ESSID);
  const THEIR_PUBLIC_IP = '203.0.113.7';
  const THEIR_BOX = 'workstation-a1b2c3d4';
  const FORWARDED_PORT = 2222;
  /** A word that appears nowhere on the player's own generated box, so reading it
   *  back proves the bytes crossed the network. */
  const THEIR_PASSWD = 'root:x:0:0::/root:/bin/bash\nnebuchadnezzar:x:1000:1000::/home/neb:/bin/sh\n';

  const theirTree = () =>
    buildDirectory({
      etc: buildDirectory({ passwd: buildFile(THEIR_PASSWD, { owner: 'root' }) }),
      root: buildDirectory({}, { owner: 'root' }),
    });

  const bootOnline = async () => {
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
        if (fields.action === 'resolvePublicScan') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ found: true, ports: [{ port: FORWARDED_PORT, service: 'ssh' }] }),
          };
        }
        if (fields.action === 'authCreateSessionPublic') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, userType: 'root', machine_id: THEIR_BOX }),
          };
        }
        // The stranger's box, materialized by the only party that can: the server.
        if (fields.action === 'resolveCrossPlayerFs') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, tree: serializeTree(theirTree()) }),
          };
        }
        if (fields.action === 'upsertPatch' || fields.action === 'endSession') {
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => ({ patches: [] }) };
      }),
    );

    const state = await import('./state');
    state.startGame({ machineName: 'box', username: 'tester', rootPassword: 'pw' });
    await vi.waitFor(() => expect(state.promptHost()).toBe('box'));
    return { state, sent };
  };

  /** Type the transfer and answer the one prompt it asks, the way the player does. */
  const typeTransfer = async (
    state: typeof import('./state'),
    line: string,
  ): Promise<void> => {
    state.setInput(line);
    const run = state.runInput();
    await vi.waitFor(() => expect(state.pendingPrompt()).toBeDefined());
    state.setInput('hunter2');
    state.submitPrompt();
    await run;
  };

  const writeOf = (sent: readonly Record<string, unknown>[], machineId: string) =>
    sent.find((payload) => payload.action === 'upsertPatch' && payload.machine_id === machineId);

  it('takes the file off the box behind the forward, not the player own copy of it', async () => {
    const { state, sent } = await bootOnline();

    await typeTransfer(
      state,
      `scp -p ${FORWARDED_PORT} root@${THEIR_PUBLIC_IP}:/etc/passwd ./`,
    );

    const own = sent.find((payload) => payload.action === 'authCreateSessionPublic')?.[
      'caller_machine_id'
    ];
    const landed = writeOf(sent, String(own === undefined ? '' : own));
    // The bytes land on the box the player is standing on — their own write, exactly
    // as if they had typed it — and they are the FAR side's.
    expect(landed).toBeDefined();
    expect(landed?.content).toBe(THEIR_PASSWD);
    expect(String(landed?.path)).toMatch(/\/passwd$/);
    // The tell: the player's own generated passwd names the account they booted as.
    expect(String(landed?.content)).not.toContain('tester');
  });

  it('carries a file onto the box behind the forward, naming where it was run from', async () => {
    const { state, sent } = await bootOnline();

    await typeTransfer(
      state,
      `scp -p ${FORWARDED_PORT} /etc/passwd root@${THEIR_PUBLIC_IP}:/root/carried.txt`,
    );

    const login = sent.find((payload) => payload.action === 'authCreateSessionPublic');
    expect(login).toMatchObject({
      kind: 'scp',
      target: THEIR_PUBLIC_IP,
      port: FORWARDED_PORT,
      username: 'root',
    });
    // The vantage: without it the server can only derive the address the player
    // OWNS, which stops being true the moment the transfer runs from a box they took.
    expect(login?.caller_machine_id).toBeDefined();
    // The write is aimed at the machine the SERVER named behind the forward.
    expect(writeOf(sent, THEIR_BOX)).toMatchObject({ path: '/root/carried.txt' });
    // And the row it opened is closed behind it, on somebody else's box.
    expect(sent.some((payload) => payload.action === 'endSession')).toBe(true);
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
  const FTP_HOSTS = LAN.hosts.filter(
    (host) =>
      host.kind === 'machine' &&
      readOpenPorts(buildRemoteHostFs(ESSID, host)).some((open) => open.service === 'ftp'),
  );
  // Two doors, because one target can never show that a journal landed on the
  // WRONG box — only a second one can.
  const [FTP_HOST, OTHER_FTP_HOST] = FTP_HOSTS;
  if (FTP_HOST === undefined || OTHER_FTP_HOST === undefined) {
    throw new Error(`need two ftp-serving hosts on ${ESSID}`);
  }
  const FTP_MACHINE_ID = machineIdForLanHost(FTP_HOST, ESSID);
  const OTHER_MACHINE_ID = machineIdForLanHost(OTHER_FTP_HOST, ESSID);
  const TARGET_IDS = new Set([FTP_MACHINE_ID, OTHER_MACHINE_ID]);
  // Somebody else's address, and the port they published their ftp door on.
  const THEIR_PUBLIC_IP = '203.0.113.7';
  const FORWARDED_PORT = 2121;

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /** A file that exists only on the named box, so a listing holding it names the
   *  machine it came from. */
  const dropFile = (name: string) => [
    {
      path: `/etc/${name}`,
      content: 'left behind\n',
      owner: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    },
  ];

  type RemoteJournal = (machineId: string) => Promise<readonly Record<string, unknown>[]>;

  const journalPerTarget: RemoteJournal = async (machineId) =>
    machineId === FTP_MACHINE_ID ? dropFile('remote-drop.txt') : dropFile('other-drop.txt');

  /** Boot online with the ftp client already installed. `remoteJournal` answers a
   *  journal read for either TARGET; the player's own box always gets the client. */
  const bootOnline = async (remoteJournal: RemoteJournal = journalPerTarget) => {
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
    const landedOnTarget = new Map<string, Record<string, unknown>[]>();
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
        // A stranger's address answers only from the server: the forward table lives on
        // THEIR gateway, so nothing about it is derivable on this box.
        if (fields.action === 'resolvePublicScan') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ found: true, ports: [{ port: FORWARDED_PORT, service: 'ftp' }] }),
          };
        }
        if (fields.action === 'authCreateSessionPublic') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, userType: 'guest', machine_id: FTP_MACHINE_ID }),
          };
        }
        // A write aimed at a TARGET is kept, the way the server keeps it: a journal
        // read after it must answer with it, or nothing here could tell a client that
        // re-pulls from one that reports a transfer and shows the box unchanged.
        if (fields.action === 'upsertPatch' && TARGET_IDS.has(String(fields.machine_id))) {
          const machineId = String(fields.machine_id);
          landedOnTarget.set(machineId, [...(landedOnTarget.get(machineId) ?? []), fields]);
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        // A TARGET's journal is a different machine's, so a listing proving it came
        // back cannot have been computed from the box the player is standing on.
        if (TARGET_IDS.has(String(fields.machine_id))) {
          const machineId = String(fields.machine_id);
          const patches = [
            ...(await remoteJournal(machineId)),
            ...(landedOnTarget.get(machineId) ?? []),
          ];
          return { ok: true, status: 200, json: async () => ({ patches }) };
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
      // Any line, not the last one: `/usr/bin` holds other tools that sort after
      // `ftp`, and which entry lands last is not what this is waiting for.
      expect(state.scrollback().some((line) => line.content.includes('ftp'))).toBe(true);
    });

    return { state, sent };
  };

  /** Log into a host by actually typing the command and answering both prompts —
   *  the shipped path, not a poked signal. */
  const typeFtpLogin = async (
    state: typeof import('./state'),
    ip: string,
  ): Promise<void> => {
    state.setInput(`ftp ${ip}`);
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
  };

  const loginOverFtp = async () => {
    const booted = await bootOnline();
    await typeFtpLogin(booted.state, FTP_HOST.ip);
    return booted;
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

    state.setInput('cat /etc/passwd');
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

  it('scrolls an ftp command back under the ftp prompt, not the shell one', async () => {
    const { state } = await loginOverFtp();

    const before = state.scrollback().length;
    state.setInput('pwd');
    await state.runInput();

    // Whole line, not just its text: `kind` is what renders it as a prompt rather
    // than as ordinary output, so a sub-shell echo has to arrive looking like one.
    expect(state.scrollback()[before]).toEqual({
      kind: 'prompt',
      content: `${state.FTP_PROMPT}pwd`,
    });
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

  it('shows the target box to ls and the player’s own to lls, from the one prompt', async () => {
    const { state } = await loginOverFtp();

    state.setInput('ls /etc');
    await state.runInput();
    const remoteEtc = state.scrollback().map((line) => line.content);
    state.setInput('lls /etc');
    await state.runInput();
    const originEtc = state.scrollback().map((line) => line.content).slice(remoteEtc.length);

    // The drop file lives ONLY in the target's journal, so a listing holding it
    // was fetched from the target — not computed from the box the player is on.
    expect(remoteEtc).toContain('remote-drop.txt');
    expect(originEtc).not.toContain('remote-drop.txt');
  });

  it('reads a box on your own LAN without asking the server again', async () => {
    // A host this client can generate is rebuilt here, so a listing costs nothing. Only
    // a box that cannot be rebuilt is worth a round trip — and a change that sent EVERY
    // ftp read to the server would alter no output at all, which is why this prices the
    // line instead of reading it.
    const { state, sent } = await loginOverFtp();

    const spentBefore = sent.length;
    state.setInput('ls /etc');
    await state.runInput();
    await settle();

    expect(sent.slice(spentBefore)).toEqual([]);
  });

  it('starts the remote at the account’s home while the shell keeps its own directory', async () => {
    const { state } = await loginOverFtp();

    state.setInput('pwd');
    await state.runInput();
    expect(lastLine(state)).toContain('/home/guest');

    state.setInput('lpwd');
    await state.runInput();
    expect(lastLine(state)).toContain('/home/tester');

    // Moving on the remote leaves the shell where it stands — `quit` proves it by
    // handing back a cwd the ftp session never touched.
    state.setInput('cd /etc');
    await state.runInput();
    state.setInput('pwd');
    await state.runInput();
    expect(lastLine(state)).toContain('/etc');

    state.setInput('quit');
    await state.runInput();
    state.setInput('pwd');
    await state.runInput();

    expect(lastLine(state)).toBe('/home/tester');
  });

  it('takes a file off the target onto the player’s own box, and tells the target it went', async () => {
    const { state, sent } = await loginOverFtp();

    state.setInput('get /etc/remote-drop.txt');
    await state.runInput();
    await settle();

    expect(lastLine(state)).toContain('12 bytes received.');
    // The file lands on the box the player is STANDING on, at the directory their
    // shell is in — through the same write seam a `>` redirect uses.
    expect(sent.find((payload) => payload.action === 'upsertPatch')).toMatchObject({
      path: '/home/tester/remote-drop.txt',
      content: 'left behind\n',
    });
    // And the target hears what left it. Which box, and from what address, are
    // supplied HERE — the `ftp>` command names only the file, so this is the only
    // place the wiring can be proved.
    expect(sent.find((payload) => payload.action === 'recordFtpTransfer')).toMatchObject({
      direction: 'download',
      machine_id: FTP_MACHINE_ID,
      path: '/etc/remote-drop.txt',
      bytes: 12,
      source_ip: `${LAN.subnet}.77`,
    });
  });

  it('leaves a file on the target, addressed to the TARGET rather than the box it came from', async () => {
    const { state, sent } = await loginOverFtp();

    // A defacement: the player's own page, written over the one the target serves.
    state.setInput('put /var/www/html/index.html /var/www/html/index.html');
    await state.runInput();
    await settle();

    expect(lastLine(state)).toContain('bytes sent.');
    // The one thing only this layer can prove: the write is aimed at the TARGET's
    // machine id and stamped with the account the credential bought, not the player's
    // own. Same action, same endpoint, same gate an `ssh` session's write reaches —
    // the door is not a parameter of it.
    const upload = sent.find(
      (payload) => payload.action === 'upsertPatch' && payload.path === '/var/www/html/index.html',
    );
    expect(upload).toMatchObject({ machine_id: FTP_MACHINE_ID, owner: 'guest' });
    expect(sent.find((payload) => payload.action === 'recordFtpTransfer')).toMatchObject({
      direction: 'upload',
      machine_id: FTP_MACHINE_ID,
      path: '/var/www/html/index.html',
      source_ip: `${LAN.subnet}.77`,
    });
  });

  /** The same door on somebody else's address: the player names the forwarded port and
   *  the account, so only the password is asked for. */
  const typeCrossNetworkLogin = async (state: typeof import('./state')): Promise<void> => {
    state.setInput(`ftp -p ${FORWARDED_PORT} ${THEIR_PUBLIC_IP} guest`);
    const run = state.runInput();
    await vi.waitFor(() => expect(state.pendingPrompt()).toBeDefined());
    state.setInput('hunter2');
    state.submitPrompt();
    await run;
    await settle();
  };

  /** The machine id of the box the player is standing on, taken from a journal read
   *  that is not aimed at either target — the id the client actually uses for itself. */
  const ownBoxIn = (sent: readonly Record<string, unknown>[]): unknown =>
    sent.find(
      (payload) =>
        typeof payload.machine_id === 'string' && !TARGET_IDS.has(String(payload.machine_id)),
    )?.machine_id;

  it('reaches a stranger door across the network and holds the session on the box behind the forward', async () => {
    const { state, sent } = await bootOnline();

    await typeCrossNetworkLogin(state);

    expect(state.inFtpSession()).toBe(true);
    const login = sent.find((payload) => payload.action === 'authCreateSessionPublic');
    expect(login).toMatchObject({
      kind: 'ftp',
      target: THEIR_PUBLIC_IP,
      port: FORWARDED_PORT,
      username: 'guest',
      // The vantage. Without it the server can only derive the address the player
      // OWNS, which stops being true the moment they attack from somebody else's box.
      caller_machine_id: ownBoxIn(sent),
    });
    // The session is held on the machine the SERVER named behind the forward, and the
    // shell underneath never moved — the same parallel session the LAN door opens.
    expect(state.promptHost()).toBe('box');
  });

  it('names the box a cross-network transfer was run from, alongside the box it moved on', async () => {
    const { state, sent } = await bootOnline();
    await typeCrossNetworkLogin(state);

    state.setInput('get /etc/remote-drop.txt');
    await state.runInput();
    await settle();

    expect(lastLine(state)).toContain('12 bytes received.');
    // Two machines named in one record: whose log it lands in, and where the visitor
    // was standing. The second is what the defender's line is addressed FROM, and the
    // command layer cannot supply it — only here.
    expect(sent.find((payload) => payload.action === 'recordFtpTransfer')).toMatchObject({
      direction: 'download',
      machine_id: FTP_MACHINE_ID,
      caller_machine_id: ownBoxIn(sent),
    });
  });

  it('shows the file it just left, without the player having to leave and come back', async () => {
    const { state } = await loginOverFtp();

    state.setInput('ls /tmp');
    await state.runInput();
    expect(lastLine(state)).not.toContain('dropped.html');

    state.setInput('put /var/www/html/index.html /tmp/dropped.html');
    await state.runInput();
    await settle();

    state.setInput('ls /tmp');
    await state.runInput();

    // The TARGET's journal is re-pulled after a landed write, not the shell's — the
    // two machines keep separate journals, and a `put` changes the far one. Without
    // the re-pull the player is told the bytes went and shown a box that never
    // received them.
    expect(lastLine(state)).toContain('dropped.html');
  });

  it('never lets a slow answer for a box already left land on the box now open', async () => {
    // The first target's journal is held mid-flight while the player quits and opens
    // a second door. When it finally answers it belongs to nobody — and it must not
    // be shown as the second box's contents, which is a stranger's files under
    // another stranger's name.
    let releaseFirst: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const { state } = await bootOnline(async (machineId) => {
      if (machineId === FTP_MACHINE_ID) {
        await held;
        return dropFile('remote-drop.txt');
      }
      return dropFile('other-drop.txt');
    });

    await typeFtpLogin(state, FTP_HOST.ip);
    state.setInput('quit');
    await state.runInput();
    await typeFtpLogin(state, OTHER_FTP_HOST.ip);

    releaseFirst?.();
    await settle();

    state.setInput('ls /etc');
    await state.runInput();
    const listing = state.scrollback().map((line) => line.content);

    expect(listing).toContain('other-drop.txt');
    expect(listing).not.toContain('remote-drop.txt');
  });

  it('takes a journal arriving after the player has gone as nothing to do', async () => {
    // Same held answer, but nobody has opened another door when it lands: there is
    // no session to compare it against. Quietly dropping it is the whole job — the
    // fetch is fire-and-forget, so anything thrown here surfaces as an unhandled
    // rejection nobody is left to catch.
    let releaseFirst: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const { state } = await bootOnline(async (machineId) => {
      if (machineId === FTP_MACHINE_ID) {
        await held;
        return dropFile('remote-drop.txt');
      }
      return dropFile('other-drop.txt');
    });

    await typeFtpLogin(state, FTP_HOST.ip);
    state.setInput('quit');
    await state.runInput();

    releaseFirst?.();
    await settle();

    // The shell the player was handed back is still theirs, and still works.
    state.setInput('pwd');
    await state.runInput();
    expect(lastLine(state)).toBe('/home/tester');
  });
});

/**
 * The same door, on a box that is NOT on the player's own LAN. `ftpRoot` decides which
 * filesystem the `ftp>` prompt reads, and off-LAN there is nothing local to rebuild the
 * target from — so that tree has to come from the server, exactly as an off-LAN shell's
 * does. Getting it wrong has one failure and it is not cosmetic: the local resolver falls
 * back to the intruder's OWN base, so `ls` lists the box they are standing on while `get`
 * hands back their own bytes and the target's log records a file as having left.
 *
 * The sub-shell suite above cannot see this. Its targets are generated on the essid the
 * player is CONNECTED to and merely reached at a public address — foreign address, local
 * machine — so the local resolver succeeds and the fallback never fires. Here the box
 * belongs to another network entirely, which is the only arrangement that asks the
 * question.
 */
describe('an ftp session on a box across the network', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The intruder's own LAN, and the OTHER network whose public address they reach.
  const ESSID = 'ferro-cafe';
  const LAN = generateHomeLan(ESSID);
  const THEIR_ESSID = 'ground-zero-coffee';
  const THEIR_PUBLIC_IP = '203.0.113.41';
  const FORWARDED_PORT = 2121;

  /** A box on that other network running an ftp door. Its own `vsftpd.pid` is the
   *  discriminator: no journal put it there and the intruder's box has nothing like it,
   *  so "whose filesystem is this" becomes a question with an answer. */
  const THEIR_HOST = generateHomeLan(THEIR_ESSID).hosts.find(
    (host) =>
      host.kind === 'machine' &&
      readOpenPorts(buildRemoteHostFs(THEIR_ESSID, host)).some((open) => open.service === 'ftp'),
  );
  if (THEIR_HOST === undefined) throw new Error(`no ftp-serving host generated on ${THEIR_ESSID}`);
  const THEIR_BOX = machineIdForLanHost(THEIR_HOST, THEIR_ESSID);

  /** A door on the player's OWN LAN — a box this client rebuilds locally, so nothing
   *  about it is served. What it is for: giving a late answer about the foreign box
   *  somewhere wrong to land. */
  const HOME_HOST = LAN.hosts.find(
    (host) =>
      host.kind === 'machine' &&
      readOpenPorts(buildRemoteHostFs(ESSID, host)).some((open) => open.service === 'ftp'),
  );
  if (HOME_HOST === undefined) throw new Error(`no ftp-serving host generated on ${ESSID}`);

  /** Something only the target's journal holds, so a listing carrying it was fetched
   *  rather than computed from the box the player is standing on. */
  const theirDrop: Patch = {
    path: '/etc/remote-drop.txt',
    content: 'left behind\n',
    owner: 'root',
    permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  };

  /** ftp on the player's own box, stamped the way `apt install` leaves it. */
  const ownFtpClient = {
    path: '/usr/bin/ftp',
    content: BINARY_STUB,
    owner: 'root',
    permissions: {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root', 'user', 'guest'],
    },
  };

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /** Boot associated with one LAN, then log into an ftp door published on ANOTHER
   *  network's public address — the reach the cross-player wire-check proves. Whatever
   *  the session writes to the target is kept and answered back, from the journal AND
   *  from the served tree, because the server composes the one from the other. */
  const loginAcrossTheNetwork = async ({ holdTheTree = false, refuseWrites = false } = {}) => {
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
    const landedOnTarget: Patch[] = [];
    const theirJournal = (): readonly Patch[] => [theirDrop, ...landedOnTarget];
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    // A tree the test releases by hand, so the moment before the server answers can be
    // held open — and, once released, arrive LATE.
    const held: ((body: unknown) => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const fields = JSON.parse(JSON.parse(init?.body ?? '{}').payload) as Record<string, unknown>;
        sent.push(fields);
        if (fields.action === 'listSessions') return json({ sessions: [] });
        // A stranger's forward table lives on THEIR gateway: nothing about it is
        // derivable on this box, so only the server can answer what the port serves.
        if (fields.action === 'resolvePublicScan') {
          return json({ found: true, ports: [{ port: FORWARDED_PORT, service: 'ftp' }] });
        }
        // The LAN door: this client already knows which box it is talking to, so the
        // server only says whether the credential opened it.
        if (fields.action === 'authCreateSession') return json({ ok: true, userType: 'guest' });
        if (fields.action === 'authCreateSessionPublic') {
          return json({ ok: true, username: 'guest', userType: 'guest', machine_id: THEIR_BOX });
        }
        // The stranger's box, materialized by the only party that can: seeded base with
        // the journal replayed over it, which is what the endpoint actually returns.
        if (fields.action === 'resolveCrossPlayerFs') {
          // A tree that never lands is what the player sees for the first moment of
          // every cross-player login, so it is a state the prompt has to have an answer
          // for — not an error case.
          if (holdTheTree) {
            return new Promise((resolve) => {
              held.push((body) => resolve(json(body)));
            });
          }
          return json({
            ok: true,
            tree: serializeTree(
              applyPatches(buildRemoteHostFs(THEIR_ESSID, THEIR_HOST), theirJournal()),
            ),
          });
        }
        if (fields.action === 'upsertPatch') {
          // A door the defender has since shut: the row the write rode on is gone, so
          // the box is unchanged and the client is told so.
          if (refuseWrites) {
            return { ok: false, status: 403, json: async () => ({ error: 'no_session' }) };
          }
          // Kept the way the server keeps it, so a read after a write can answer with
          // it: stamped with the tier the credential bought, which is what a new file
          // written through this door is owned by.
          if (fields.machine_id === THEIR_BOX) {
            landedOnTarget.push({
              path: String(fields.path),
              content: String(fields.content),
              owner: 'guest',
              permissions: defaultFilePermissions('guest'),
            });
          }
          return json({ ok: true });
        }
        if (fields.action !== 'listPatches') return json({});
        return json({ patches: fields.machine_id === THEIR_BOX ? theirJournal() : [ownFtpClient] });
      }),
    );

    const state = await import('./state');
    state.startGame({ machineName: 'box', username: 'tester', rootPassword: 'pw' });
    await vi.waitFor(() => expect(state.promptHost()).toBe('box'));
    // The boot journal fetch is in flight; the ftp client only exists once it lands.
    await vi.waitFor(async () => {
      state.setInput('ls /usr/bin');
      await state.runInput();
      expect(state.scrollback().some((line) => line.content.includes('ftp'))).toBe(true);
    });
    // The player names the forwarded port and the account, so only the password is asked.
    state.setInput(`ftp -p ${FORWARDED_PORT} ${THEIR_PUBLIC_IP} guest`);
    const run = state.runInput();
    await vi.waitFor(() => expect(state.pendingPrompt()).toBeDefined());
    state.setInput('hunter2');
    state.submitPrompt();
    await run;
    await settle();
    return {
      state,
      sent,
      /** Let a held answer arrive — whenever the test says, which may be long after the
       *  session that asked for it is gone. */
      releaseTheTree: async () => {
        held.forEach((resolve) =>
          resolve({
            ok: true,
            tree: serializeTree(
              applyPatches(buildRemoteHostFs(THEIR_ESSID, THEIR_HOST), theirJournal()),
            ),
          }),
        );
        await settle();
      },
      /** Log into a door on the player's OWN LAN, from the same boot. */
      loginAtHome: async () => {
        state.setInput(`ftp ${HOME_HOST.ip}`);
        const homeRun = state.runInput();
        await vi.waitFor(() => expect(state.pendingPrompt()).toBeDefined());
        state.setInput('guest');
        state.submitPrompt();
        await vi.waitFor(() => expect(state.pendingPrompt()).toBeDefined());
        state.setInput('hunter2');
        state.submitPrompt();
        await homeRun;
        await settle();
      },
    };
  };

  /** Type one line and hand back only what it printed. */
  const typeLine = async (state: typeof import('./state'), line: string): Promise<string> => {
    const before = state.scrollback().length;
    state.setInput(line);
    await state.runInput();
    await settle();
    return state
      .scrollback()
      .slice(before)
      .map((entry) => entry.content)
      .join('\n');
  };

  it('lists the box the login opened, not the intruder own filesystem', async () => {
    const { state } = await loginAcrossTheNetwork();

    expect(state.inFtpSession()).toBe(true);
    // The target's own daemon pidfile — seeded, journal-free, and absent from the box
    // the player is standing on. The drop file alone would prove nothing: it rides the
    // target's journal, which replays over ANY base.
    expect(await typeLine(state, 'ls /var/run')).toContain(SERVICE_CATALOG.ftp.pidfile);
    expect(await typeLine(state, 'ls /etc')).toContain('remote-drop.txt');
    // And the account only the intruder's own box has is not on the box they logged into.
    expect(await typeLine(state, 'ls /home')).not.toContain('tester');
  });

  it('leaves the shell underneath reading the player own box', async () => {
    // Two machines at once. A fix that pointed the SHELL's served tree at the ftp
    // target would pass the listing test above and quietly move the box the player is
    // standing on out from under them.
    const { state } = await loginAcrossTheNetwork();

    expect(await typeLine(state, 'lls /home')).toContain('tester');

    await typeLine(state, 'quit');
    expect(state.inFtpSession()).toBe(false);
    expect(state.promptHost()).toBe('box');
    expect(await typeLine(state, 'ls /home')).toContain('tester');
  });

  it('hands over the target bytes, off a path the intruder own box does not have', async () => {
    // `get` reads through the same tree the listing does, so a wrong tree does not just
    // mislead — it hands the player a copy of their own file while the target's log
    // records that one left. The pidfile is proof of origin: no journal put it there and
    // the intruder's box has no such file to confuse it with.
    const { state, sent } = await loginAcrossTheNetwork();

    const taken = await typeLine(state, `get /var/run/${SERVICE_CATALOG.ftp.pidfile}`);

    expect(taken).toContain('bytes received');
    const landed = sent.find(
      (payload) =>
        payload.action === 'upsertPatch' &&
        payload.path === `/home/tester/${SERVICE_CATALOG.ftp.pidfile}`,
    );
    expect(landed?.content).toContain(`${daemonName(SERVICE_CATALOG.ftp)}:port=`);
  });

  it('shows nothing while the target tree is in flight, never the intruder own box', async () => {
    // The moment before the server answers. Falling through to the local resolver here
    // would flash the intruder's own filesystem at the `ftp>` prompt — briefly, and
    // indistinguishably from the real thing.
    const { state } = await loginAcrossTheNetwork({ holdTheTree: true });

    expect(await typeLine(state, 'ls /home')).not.toContain('tester');
  });

  it('does not re-read the box when the write was refused', async () => {
    // A read costs a round trip on a foreign box, so it is worth only a write that
    // LANDED. Charging for a refused one changes nothing on screen — which is why this
    // prices the line rather than reading it.
    const { state, sent } = await loginAcrossTheNetwork({ refuseWrites: true });

    const spentBefore = sent.length;
    await typeLine(state, 'put /var/www/html/index.html /tmp/dropped.html');

    expect(sent.slice(spentBefore).map((payload) => payload.action)).not.toContain(
      'resolveCrossPlayerFs',
    );
  });

  it('drops an answer about a box the player has already left', async () => {
    // The tree is held UNTAGGED — one ftp session at a time, and entering one clears
    // it — so this guard is the whole of what stops a slow answer about the foreign box
    // from painting over a door opened since. Landing it on a box on the player's OWN
    // LAN is the case with somewhere wrong to go.
    const { state, releaseTheTree, loginAtHome } = await loginAcrossTheNetwork({
      holdTheTree: true,
    });

    await typeLine(state, 'quit');
    await loginAtHome();
    await releaseTheTree();

    expect(state.inFtpSession()).toBe(true);
    expect(await typeLine(state, 'ls /etc')).not.toContain('remote-drop.txt');
  });

  it('drops a late answer when the player has left the prompt entirely', async () => {
    // The same guard with nothing standing behind it: the player quit, so there is no
    // session for the answer to belong to. Asking one for its id is what breaks here.
    const { state, releaseTheTree } = await loginAcrossTheNetwork({ holdTheTree: true });

    await typeLine(state, 'quit');
    await releaseTheTree();

    expect(state.inFtpSession()).toBe(false);
    expect(await typeLine(state, 'ls /home')).toContain('tester');
  });

  it('shows a landed put to the next listing, across the network as on the LAN', async () => {
    // The half slice 8 had to be told about by a test: once the prompt reads a SERVED
    // tree, re-pulling the target's JOURNAL after a write refreshes a source the tree is
    // no longer built from, and the file that just arrived never appears.
    const { state } = await loginAcrossTheNetwork();

    await typeLine(state, 'put /var/www/html/index.html /tmp/dropped.html');

    expect(await typeLine(state, 'ls /tmp')).toContain('dropped.html');
  });
});


/**
 * The `mysql>` prompt is the same shape as `ftp>` and arrives for a different
 * reason. An ftp session holds a server row; this holds only the credential,
 * because the door mints no row at all — so the sub-shell is the whole of what a
 * connection IS, and the refusal it owes is sharper: at `mysql>` an outer `cat`
 * would read the box the player is standing on, and this connection reaches no
 * filesystem whatsoever.
 */
describe('the mysql sub-shell', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Not the ftp block's LAN: roughly one box in twelve runs a database, so the
  // network has to be chosen for having one rather than reused for convenience.
  const ESSID = 'BEAN-THERE-WIFI';
  const LAN = generateHomeLan(ESSID);
  const DATABASE_HOST = LAN.hosts.find(
    (host) =>
      host.kind === 'machine' &&
      readOpenPorts(buildRemoteHostFs(ESSID, host)).some(
        (open) => open.service === SERVICE_CATALOG.mysql.service,
      ),
  );
  if (DATABASE_HOST === undefined) throw new Error(`need a database host on ${ESSID}`);

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /** Boot online with a LAN lease and the client already installed. `mysql` is
   *  apt-gated like the ftp client, so the box has to already carry it — the player
   *  would have run `apt install mysql` before ever reaching this door. */
  const bootOnline = async ({ opened = true, statementsFail = false } = {}) => {
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
        if (fields.action === 'mysqlConnect') {
          // A 200 names the box the client greets with; a 401 names the address the
          // daemon saw, which is what the client renders the refusal from.
          return opened
            ? { ok: true, status: 200, json: async () => ({ ok: true, hostname: DATABASE_HOST.hostname }) }
            : {
                ok: false,
                status: 401,
                json: async () => ({ error: 'invalid_credentials', from: '192.168.1.50' }),
              };
        }
        // The statement door answers with RENDERED TEXT and nothing else -- the same
        // shape the real handler returns, so what the terminal prints here is what a
        // player would see rather than a fixture's idea of it.
        if (fields.action === 'mysqlStatement') {
          // Every non-200 is one condition to the prompt: the connection it stands
          // for is no longer there.
          if (statementsFail) return { ok: false, status: 404, json: async () => ({}) };
          const sql = String(fields['statement']);
          const answer = /^\s*SHOW\s+TABLES/i.test(sql)
            ? { output: ['+--------------+', '| Tables_in_db |', '+--------------+'], failed: false }
            : {
                output: [
                  'ERROR: Unsupported SQL syntax. This MySQL instance supports basic queries only.',
                ],
                failed: true,
              };
          return { ok: true, status: 200, json: async () => answer };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            patches: [
              {
                path: '/usr/bin/mysql',
                content: BINARY_STUB,
                owner: 'root',
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
    // The boot journal fetch is in flight; the client only exists once it lands.
    await vi.waitFor(async () => {
      state.setInput('ls /usr/bin');
      await state.runInput();
      expect(state.scrollback().some((entry) => entry.content.includes('mysql'))).toBe(true);
    });
    return { state, sent };
  };

  /** Open a connection by actually typing the command and answering both prompts —
   *  the shipped path, not a poked signal. */
  /** The account typed at the prompt. Named because every statement re-sends it,
   *  and that is the claim rather than an implementation detail. */
  const MYSQL_USER = 'readonly';
  const MYSQL_PASSWORD = 'hunter2';

  const typeMysqlLogin = async (state: typeof import('./state')): Promise<void> => {
    state.setInput(`mysql ${DATABASE_HOST.ip}`);
    const run = state.runInput();
    await vi.waitFor(() => expect(state.pendingPrompt()).toBeDefined());
    state.setInput(MYSQL_USER);
    state.submitPrompt();
    await vi.waitFor(() => expect(state.pendingPrompt()).toBeDefined());
    state.setInput(MYSQL_PASSWORD);
    state.submitPrompt();
    await run;
    await settle();
  };

  const typeLine = async (state: typeof import('./state'), line: string): Promise<string> => {
    const before = state.scrollback().length;
    state.setInput(line);
    await state.runInput();
    return state
      .scrollback()
      .slice(before)
      .map((entry) => entry.content)
      .join('\n');
  };

  it('greets and lands at mysql> on a credential the database accepts', async () => {
    const { state, sent } = await bootOnline();

    await typeMysqlLogin(state);

    expect(state.inMysqlSession()).toBe(true);
    const printed = state
      .scrollback()
      .slice(-2)
      .map((entry) => entry.content);
    expect(printed).toEqual([
      `Connected to ${DATABASE_HOST.hostname}.`,
      'Welcome to the MySQL monitor. Type help for commands.',
    ]);
    // No row was asked for, at any tier. The other doors open one here; this one has
    // nothing to open, which is what leaves it with no filesystem access to leak.
    expect(sent.some((payload) => payload.action === 'authCreateSession')).toBe(false);
  });

  it('leaves the player at the shell when the database refuses', async () => {
    const { state } = await bootOnline({ opened: false });

    await typeMysqlLogin(state);

    expect(state.inMysqlSession()).toBe(false);
    expect(state.scrollback().at(-1)?.content).toContain('ERROR 1045 (28000)');
  });

  it('sends an outer shell command to the database instead of running it', async () => {
    const { state, sent } = await bootOnline();
    await typeMysqlLogin(state);

    const output = await typeLine(state, 'cat /etc/passwd');

    // The security boundary of the sub-shell: falling through to the registry would
    // read the machine the player is STANDING on while they believe they are
    // addressing the database. `alice` is in that file and must not appear.
    expect(output).not.toContain('tester:');
    expect(output).toContain('Unsupported SQL syntax');
    // And it went to the DATABASE, carrying the held credential -- the refusal is the
    // server's answer rather than a guess this client made on its behalf.
    const asked = sent.filter((payload) => payload.action === 'mysqlStatement');
    expect(asked.map((payload) => payload['statement'])).toEqual(['cat /etc/passwd']);
    expect(state.inMysqlSession()).toBe(true);
  });

  it('scrolls a statement back under the database prompt, not the shell one', async () => {
    const { state } = await bootOnline();
    await typeMysqlLogin(state);

    const before = state.scrollback().length;
    state.setInput('SHOW TABLES;');
    await state.runInput();

    // The live prompt already reads `mysql> `, so an echo carrying user@host:cwd
    // leaves the scrollback claiming the player typed at a box this connection
    // cannot reach at all — the two have to name the same place.
    expect(state.scrollback()[before]).toEqual({
      kind: 'prompt',
      content: `${state.MYSQL_PROMPT}SHOW TABLES;`,
    });
  });

  it('carries the held credential with every statement, having no session to name', async () => {
    const { state, sent } = await bootOnline();
    await typeMysqlLogin(state);

    await typeLine(state, 'SHOW TABLES');
    await typeLine(state, 'SELECT 1');

    // Decision 8's mechanism, visible: each statement re-sends the whole credential,
    // and no session row was ever minted to send instead.
    const asked = sent.filter((payload) => payload.action === 'mysqlStatement');
    expect(asked).toHaveLength(2);
    for (const payload of asked) {
      expect(payload['username']).toBe(MYSQL_USER);
      expect(payload['password']).toBe(MYSQL_PASSWORD);
    }
    expect(sent.some((payload) => payload.action === 'authCreateSession')).toBe(false);
  });

  it('closes the prompt when the box stops answering, and does not say Bye', async () => {
    const { state } = await bootOnline({ statementsFail: true });
    await typeMysqlLogin(state);

    const output = await typeLine(state, 'SHOW TABLES');

    // There is no session row to invalidate and no push channel, so the drop can only
    // be discovered by the next statement. An eviction is not a quit.
    expect(output).toContain('ERROR 2013 (HY000): Lost connection to MySQL server during query');
    expect(output).not.toContain('Bye');
    expect(state.inMysqlSession()).toBe(false);
  });

  it('hands back the same shell it never left', async () => {
    const { state } = await bootOnline();
    const before = { host: state.promptHost(), user: state.promptUsername(), cwd: state.cwd() };

    await typeMysqlLogin(state);

    // The connection is BESIDE the shell, not above it — an `ssh` login would have
    // moved all three, and the prompt reading `mysql>` is a swap, not a hop.
    expect(state.promptHost()).toBe(before.host);
    expect(state.promptUsername()).toBe(before.user);
    expect(state.cwd()).toBe(before.cwd);

    const output = await typeLine(state, 'quit');

    expect(output).toContain('Bye');
    expect(state.inMysqlSession()).toBe(false);
    expect(await typeLine(state, 'pwd')).toContain(before.cwd);
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

/**
 * A backdoor is the one door that can be taken away while somebody is standing in
 * it: netcat is a single process that both listens and serves, so killing it takes
 * the socket with it. The intruder, though, is a client holding the journal it
 * fetched when it walked in, and the kill lands on a machine it is not watching.
 * Unless the next line they type re-reads the target's journal first, the box they
 * see stays the box as it was when they arrived, and the eviction is real only in
 * a unit test.
 */
describe('a listener killed while an intruder is standing inside it', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ESSID = 'ferro-cafe';
  const LAN = generateHomeLan(ESSID);
  const TARGET = LAN.hosts.find((host) => host.kind === 'machine');
  if (TARGET === undefined) throw new Error(`no ordinary host generated on ${ESSID}`);
  const TARGET_MACHINE_ID = machineIdForLanHost(TARGET, ESSID);
  const PORT = 4444;
  const CLOSED = 'nc: connection closed by foreign host';

  const listenerPatch = {
    path: `/var/run/nc-${PORT}.pid`,
    content: formatListenerContent({ port: PORT, user: 'mallory', userType: 'root' }),
    owner: 'root',
  };

  /** netcat on the player's own box, stamped the way `apt install` leaves it. */
  const ownNetcat = {
    path: '/usr/bin/nc',
    content: BINARY_STUB,
    owner: 'root',
    permissions: {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root', 'user', 'guest'],
    },
  };

  /** Boot already associated with the LAN, then walk in through the backdoor —
   *  the real client path: the gate opens the door, the hop swaps the journal to
   *  the target's, and the player is left standing on it. `killTheListener` is the
   *  defender's `kill` seen from here: the pidfile leaves the target's journal,
   *  which is the only place this client could ever learn it from. */
  const enterTheBackdoor = async () => {
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

    let targetJournal: readonly unknown[] = [listenerPatch];
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const fields = JSON.parse(JSON.parse(init?.body ?? '{}').payload) as Record<string, unknown>;
        if (fields.action === 'listSessions') return json({ sessions: [] });
        // The box answers for itself: the pidfile names who it admits, so the gate
        // needs no credential to have been sent.
        if (fields.action === 'authCreateSession') {
          return json({ ok: true, username: 'mallory', userType: 'root' });
        }
        if (fields.action !== 'listPatches') return json({});
        if (fields.machine_id === TARGET_MACHINE_ID) return json({ patches: targetJournal });
        // netcat is the tool an intruder brings with them, so the player's own box
        // only has it because they ran `apt install netcat` first.
        return json({ patches: [ownNetcat] });
      }),
    );

    const state = await import('./state');
    state.startGame({ machineName: 'box', username: 'tester', rootPassword: 'pw' });
    await vi.waitFor(() => expect(state.promptHost()).toBe('box'));
    // The boot journal fetch is in flight; netcat only exists once it lands.
    await vi.waitFor(async () => {
      state.setInput('ls /usr/bin');
      await state.runInput();
      expect(state.scrollback().some((line) => line.content.includes('nc'))).toBe(true);
    });
    state.setInput(`nc ${TARGET.ip} ${PORT}`);
    await state.runInput();
    return {
      state,
      killTheListener: () => {
        targetJournal = [];
      },
    };
  };

  const scrollbackOf = (state: typeof import('./state')): string =>
    state
      .scrollback()
      .map((line) => line.content)
      .join('\n');

  it('closes the connection on the intruder’s next command and hands them back their own shell', async () => {
    const { state, killTheListener } = await enterTheBackdoor();
    expect(state.promptHost()).toBe(TARGET.hostname);

    killTheListener();
    state.setInput('ls');
    await state.runInput();

    expect(scrollbackOf(state)).toContain(CLOSED);
    expect(state.promptHost()).not.toBe(TARGET.hostname);
  });

  it('leaves the intruder where they are while the listener is still running', async () => {
    const { state } = await enterTheBackdoor();

    state.setInput('ls');
    await state.runInput();

    expect(scrollbackOf(state)).not.toContain(CLOSED);
    expect(state.promptHost()).toBe(TARGET.hostname);
  });
});

describe('a backdoor on a box across the network', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The intruder's own LAN, and the OTHER network whose public IP they reach across.
  const ESSID = 'ferro-cafe';
  const LAN = generateHomeLan(ESSID);
  const THEIR_ESSID = 'nakatomi-plaza';
  const THEIR_PUBLIC_IP = '198.51.100.23';
  const PORT = 31337;
  const CLOSED = 'nc: connection closed by foreign host';

  /** A box on that other network which runs sshd. Its own pidfile is the thing no
   *  journal put there and no other box has, which is what makes "whose filesystem
   *  am I looking at" a question with an answer. */
  const THEIR_HOST = generateHomeLan(THEIR_ESSID).hosts.find(
    (host) =>
      host.kind === 'machine' &&
      readOpenPorts(buildRemoteHostFs(THEIR_ESSID, host)).some((open) => open.service === 'ssh'),
  );
  if (THEIR_HOST === undefined) throw new Error(`no ssh-serving host generated on ${THEIR_ESSID}`);
  const THEIR_BOX = machineIdForLanHost(THEIR_HOST, THEIR_ESSID);

  const listenerPatch = {
    path: `/var/run/nc-${PORT}.pid`,
    content: formatListenerContent({ port: PORT, user: 'mallory', userType: 'root' }),
    owner: 'root',
    permissions: PIDFILE_PERMISSIONS,
  };

  /** The target as the SERVER materializes it: the box's own seeded tree with its
   *  journal replayed over it. The listener leaves the tree and the journal together
   *  when a defender kills it, because the server builds the one from the other. */
  const theirTree = (listening: boolean) =>
    applyPatches(buildRemoteHostFs(THEIR_ESSID, THEIR_HOST), listening ? [listenerPatch] : []);

  /** netcat on the player's own box, stamped the way `apt install` leaves it. */
  const ownNetcat = {
    path: '/usr/bin/nc',
    content: BINARY_STUB,
    owner: 'root',
    permissions: {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root', 'user', 'guest'],
    },
  };

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /** Boot associated with one LAN, then knock on a backdoor published on ANOTHER
   *  network's public IP — the reach slice 7 proved on the wire. `killTheListener`
   *  is the defender's `kill` seen from here: the pidfile leaves the target's
   *  journal, and so leaves the tree the server materializes from it. */
  const enterTheBackdoor = async () => {
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

    let listening = true;
    const actions: string[] = [];
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const fields = JSON.parse(JSON.parse(init?.body ?? '{}').payload) as Record<string, unknown>;
        actions.push(String(fields.action));
        if (fields.action === 'listSessions') return json({ sessions: [] });
        // The address answers, but nothing the catalog can name is on that port — so
        // netcat knocks instead of grabbing a banner.
        if (fields.action === 'resolvePublicScan') return json({ found: true, ports: [] });
        if (fields.action === 'authCreateSessionPublic') {
          return json({ ok: true, username: 'mallory', userType: 'root', machine_id: THEIR_BOX });
        }
        // The stranger's box, materialized by the only party that can.
        if (fields.action === 'resolveCrossPlayerFs') {
          return json({ ok: true, tree: serializeTree(theirTree(listening)) });
        }
        if (fields.action !== 'listPatches') return json({});
        if (fields.machine_id === THEIR_BOX) {
          return json({ patches: listening ? [listenerPatch] : [] });
        }
        return json({ patches: [ownNetcat] });
      }),
    );

    const state = await import('./state');
    state.startGame({ machineName: 'box', username: 'tester', rootPassword: 'pw' });
    await vi.waitFor(() => expect(state.promptHost()).toBe('box'));
    // The boot journal fetch is in flight; netcat only exists once it lands.
    await vi.waitFor(async () => {
      state.setInput('ls /usr/bin');
      await state.runInput();
      expect(state.scrollback().some((line) => line.content.includes('nc'))).toBe(true);
    });
    state.setInput(`nc ${THEIR_PUBLIC_IP} ${PORT}`);
    await state.runInput();
    await settle();
    return {
      state,
      actions,
      killTheListener: () => {
        listening = false;
      },
    };
  };

  /** Type one line and hand back only what it printed. */
  const typeLine = async (state: typeof import('./state'), line: string): Promise<string> => {
    const before = state.scrollback().length;
    state.setInput(line);
    await state.runInput();
    return state
      .scrollback()
      .slice(before)
      .map((entry) => entry.content)
      .join('\n');
  };

  it('shows the box that was broken into, not the intruder own filesystem', async () => {
    const { state } = await enterTheBackdoor();

    // Act 14's exact pair. The planted listener alone would prove nothing — it rides
    // the target's journal, which replays over ANY base — so the claim is the box's
    // OWN seeded sshd, and the absence of the account only the intruder's box has.
    expect(await typeLine(state, 'ls /var/run')).toContain(SERVICE_CATALOG.ssh.pidfile);
    expect(await typeLine(state, 'cat /etc/passwd')).not.toContain('tester');
  });

  it('pays the re-pull only while standing in a backdoor, not on every line', async () => {
    // The other half of "pull, not a push": a door that can be taken away has to
    // re-ask the box before each line, and nothing else does. Charging every session
    // for that would make the whole game re-fetch on every keystroke — invisible in a
    // test that only reads output, which is why this one prices the line instead.
    const { state, actions } = await enterTheBackdoor();

    await typeLine(state, 'exit');
    const spentBefore = actions.length;
    await typeLine(state, 'ls');

    expect(actions.slice(spentBefore)).toEqual([]);
  });

  it('still closes on the intruder when the defender kills the listener from off-LAN', async () => {
    // Slice 5's eviction, held across the network. The tree an off-LAN backdoor reads
    // is SERVED, so re-pulling only the journal before each line would leave the shell
    // asking a stale copy whether its own door is still open — and told yes forever.
    const { state, killTheListener } = await enterTheBackdoor();

    killTheListener();

    expect(await typeLine(state, 'ls')).toContain(CLOSED);
  });
});

/**
 * The `redis> ` prompt — the third rung `subShellPrompt()` was consolidated to accept,
 * and the first reuse of the echo fix that made a bare prompt safe to have.
 *
 * It arrives holding less than either of the other two. `ftp>` holds a server row and
 * `mysql>` holds a credential; this holds an address and a port, because the door has
 * no credential to hold. So the sub-shell IS the connection here in a stronger sense
 * than one door along — and the refusal it owes is the same one: a line typed at
 * `redis> ` must reach the store, never the box the player is standing on.
 */
describe('the redis sub-shell', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ESSID = 'BEAN-THERE-WIFI';
  const LAN = generateHomeLan(ESSID);
  const STORE_HOST = LAN.hosts.find(
    (host) =>
      host.kind === 'machine' &&
      readOpenPorts(buildRemoteHostFs(ESSID, host)).some(
        (open) => open.service === SERVICE_CATALOG.redis.service,
      ),
  );
  if (STORE_HOST === undefined) throw new Error(`need a store host on ${ESSID}`);

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  const bootOnline = async ({ opened = true, statementsFail = false } = {}) => {
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
        if (fields.action === 'redisConnect') {
          return opened
            ? {
                ok: true,
                status: 200,
                json: async () => ({ ok: true, hostname: STORE_HOST.hostname }),
              }
            : { ok: false, status: 404, json: async () => ({ error: 'service_not_running' }) };
        }
        if (fields.action === 'redisStatement') {
          // Every non-200 is one condition to the prompt: the connection it stands for
          // is no longer there.
          if (statementsFail) return { ok: false, status: 404, json: async () => ({}) };
          const line = String(fields['statement']);
          const word = line.trim().split(/\s+/)[0] ?? '';
          const answer = /^\s*KEYS/i.test(line)
            ? { output: ['1) "sess:0a1b2c3d"', '2) "stats:requests"'], failed: false }
            : /^\s*AUTH\s/i.test(line)
              ? { output: ['OK'], failed: false }
              : { output: [`(error) ERR unknown command '${word}'`], failed: true };
          return { ok: true, status: 200, json: async () => answer };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            patches: [
              {
                path: '/usr/bin/redis-cli',
                content: BINARY_STUB,
                owner: 'root',
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
    await vi.waitFor(async () => {
      state.setInput('ls /usr/bin');
      await state.runInput();
      expect(state.scrollback().some((entry) => entry.content.includes('redis-cli'))).toBe(true);
    });
    return { state, sent };
  };

  /** Open the store by actually typing the command — the shipped path, not a poked
   *  signal. There is nothing to answer along the way, which is the door. */
  const typeConnect = async (state: typeof import('./state')): Promise<void> => {
    state.setInput(`redis-cli ${STORE_HOST.ip}`);
    await state.runInput();
    await settle();
  };

  const typeLine = async (state: typeof import('./state'), line: string): Promise<string> => {
    const before = state.scrollback().length;
    state.setInput(line);
    await state.runInput();
    return state
      .scrollback()
      .slice(before)
      .map((entry) => entry.content)
      .join('\n');
  };

  it('carries a password the store accepted on every statement after it', async () => {
    const { state, sent } = await bootOnline();
    await typeConnect(state);

    expect(await typeLine(state, 'AUTH sunshine')).toContain('OK');
    await typeLine(state, 'KEYS *');

    // The AUTH carried nothing, because there was nothing to carry yet; every line
    // after it carries what the store accepted. Nothing on either side of the wire
    // remembers it instead — which is why a store whose secret changes evicts on the
    // very next line.
    const statements = sent.filter((payload) => payload['action'] === 'redisStatement');
    expect(statements.map((payload) => payload['password'])).toEqual([undefined, 'sunshine']);
  });

  it('greets and lands at redis> without asking the player anything', async () => {
    const { state, sent } = await bootOnline();

    await typeConnect(state);

    expect(state.subShellPrompt()).toBe('redis> ');
    expect(
      state
        .scrollback()
        .slice(-2)
        .map((entry) => entry.content),
    ).toEqual([
      `Connecting to ${STORE_HOST.ip}:6379...`,
      `Connected to Redis ${STORE_HOST.hostname}.`,
    ]);
    // No row was asked for, at any tier. A connection that proved nothing must not buy
    // a row that would authorize everything.
    expect(sent.some((payload) => payload.action === 'authCreateSession')).toBe(false);
  });

  it('leaves the player at the shell when nothing is serving', async () => {
    const { state } = await bootOnline({ opened: false });

    await typeConnect(state);

    expect(state.subShellPrompt()).toBe(null);
    expect(state.scrollback().at(-1)?.content).toContain('Connection refused');
  });

  it('sends an outer shell command to the store instead of running it', async () => {
    const { state, sent } = await bootOnline();
    await typeConnect(state);

    const printed = await typeLine(state, 'ls /etc');

    // The security boundary of the sub-shell. Falling through would run the OUTER
    // shell's `ls` against the box the player is standing on while they believe they
    // are addressing the store — and this connection reaches no filesystem at all.
    expect(printed).toContain("(error) ERR unknown command 'ls'");
    expect(printed).not.toContain('passwd');
    expect(sent.filter((payload) => payload.action === 'redisStatement')).toHaveLength(1);
  });

  it('scrolls every statement back under the prompt it was typed at', async () => {
    const { state } = await bootOnline();
    await typeConnect(state);

    const printed = await typeLine(state, 'KEYS *');

    // The live prompt already reads `redis> `, so an echo carrying user@host:cwd would
    // name the one machine this connection reaches no filesystem on.
    expect(printed).toContain('redis> KEYS *');
    expect(printed).toContain('1) "sess:0a1b2c3d"');
  });

  it('hands the shell back on quit, with the cwd and host it never left', async () => {
    const { state, sent } = await bootOnline();
    const before = state.cwd();
    await typeConnect(state);

    await typeLine(state, 'quit');

    expect(state.subShellPrompt()).toBe(null);
    expect(state.cwd()).toBe(before);
    expect(state.promptHost()).toBe('box');
    // The way out belongs to the client: a player whose box has gone dark must still
    // be able to get back to their shell.
    expect(sent.some((payload) => payload.statement === 'quit')).toBe(false);
  });

  it('drops the prompt on the next statement once the daemon has stopped', async () => {
    const { state } = await bootOnline({ statementsFail: true });
    await typeConnect(state);

    const printed = await typeLine(state, 'KEYS *');

    expect(printed).toContain('Error: Server closed the connection');
    expect(state.subShellPrompt()).toBe(null);
  });
});
