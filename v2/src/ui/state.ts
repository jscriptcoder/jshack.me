/**
 * Terminal UI state — module-level Solid signals (per decisions.md D2:
 * module-level signals over Context). The terminal is an app singleton, so
 * the scrollback + input + cwd + patch journal live here, not in a provider.
 *
 * Boot lifecycle: signal DECLARATIONS are module-level (they need no config),
 * but everything config-derived — identity, session, the patch API, cross-tab
 * sync, the real cwd, and the boot journal hydration — is deferred into
 * `startGame(config)`. This keeps importing `state.ts` side-effect-free: a new
 * player's `GameConfig` does not exist at import time (it's typed at the intro
 * screen), so building the session eagerly would crash. The boot gate
 * (`main.tsx`) calls `startGame` once config exists; both the returning-player
 * and just-submitted paths converge on it. See the intro-screen plan.
 *
 * `runInput` is the seam between the DOM and `core/`: it echoes the typed line
 * into the scrollback, materializes the current FS view by replaying the
 * fetched patch journal over the seed base FS, builds a CommandEnv, runs the
 * line through `runCommandLine`, and mirrors the resulting lines back.
 */

import { createSignal } from 'solid-js';
import { asAbsPath, type AbsPath, type UserType } from '../core/types';
import type { Identity, PatchApi, Session, TerminalLine } from '../core/commands/types';
import type { GameConfig } from '../core/gameConfig/gameConfig';
import type { Patch } from '../core/filesystem/applyPatches';
import { applyPatches } from '../core/filesystem/applyPatches';
import { createFsView } from '../core/filesystem/fsView';
import { resolveAbsPath } from '../core/filesystem/path';
import {
  buildColdStartConnectivity,
  type ConnectivityState,
  type NetworkInterface,
} from '../core/network/interfaces';
import { generateWifi } from '../core/generation/generateWifi';
import type { WifiNetwork } from '../core/network/wifi';
import { commandRegistry } from '../core/commands/registry';
import { complete, type CompleteAdapter } from '../core/shell/complete';
import { runCommandLine } from '../core/shell/runLine';
import { commandEchoLine } from '../core/shell/prompt';
import { buildCommandEnv } from './env';
import { getPlayerIdentity } from './identity';
import { createPatchApi, fetchOwnPatches, type PatchClientDeps } from '../adapters/patchApi';
import { createSyncChannel, type SyncChannel } from '../adapters/crossTabSync';
import { type HistoryNav, idleNav, navigateDown, navigateUp } from '../core/shell/commandHistory';
import { homePathFor, seedFs, seedSession } from './seed';
import { persistConnection, restoreConnection } from './connectionPersistence';

// ---- Config-derived game state, assigned once by `startGame`. ----
// `let` (not top-level `const`) precisely because these can't be built at
// import time — they need the player's typed config. Reading them before
// `startGame` is a programming error the `started()` guard surfaces loudly.
let identity: Identity | undefined;
let config: GameConfig | undefined;
let patchClientDeps: PatchClientDeps | undefined;
let patchApi: PatchApi | undefined;
let syncChannel: SyncChannel | undefined;

// The session stack: the active session is the top. `su` pushes a root session;
// `exit` pops. Reactive so the prompt (username + `$`/`#`) reflects the active
// session immediately. Empty until `startGame` seeds the user session.
const [sessionStack, setSessionStack] = createSignal<readonly Session[]>([]);

// The cwd to restore when each pushed session is popped — one entry per push
// (the base login session has none). `pushSession` captures the current cwd
// BEFORE the elevating command moves (su goes to /root), so `exit` returns the
// player to exactly where they were, matching legacy ("restores working
// directory"). Kept in lockstep with the non-base entries of `sessionStack`.
const [returnCwdStack, setReturnCwdStack] = createSignal<readonly AbsPath[]>([]);

const [scrollback, setScrollback] = createSignal<readonly TerminalLine[]>([]);
const [input, setInput] = createSignal('');
const [cwd, setCwd] = createSignal<AbsPath>(asAbsPath('/'));
const [patches, setPatches] = createSignal<readonly Patch[]>([]);
// The workstation's NICs. Seeded from identity at `startGame`; offline at cold
// start (only `lo` has an address). Later arc slices mutate this via airmon/nmcli.
const [connectivity, setConnectivity] = createSignal<ConnectivityState>({
  interfaces: new Map(),
});
// The WiFi access points in range. Seeded ONCE per identity at `startGame`
// (deterministic, like the workstation FS); read by airdump/aircrack. Empty
// until the game starts.
const [wifiNetworks, setWifiNetworks] = createSignal<readonly WifiNetwork[]>([]);

/** Replace one interface in the connectivity signal (read-modify-write of a
 *  single Map entry). Backs `env.setInterface`, which airmon/nmcli call. A
 *  `wlan0` change also mirrors its association to localStorage so an nmcli
 *  connect/disconnect is durable across reloads (see `connectionPersistence`). */
const setInterface = (name: string, iface: NetworkInterface): void => {
  setConnectivity((previous) => ({
    interfaces: new Map(previous.interfaces).set(name, iface),
  }));
  if (name === 'wlan0') persistConnection(localStorage, iface);
};

// Shell history: in-memory only (resets on reload, per legacy parity). The
// nav cursor tracks where ArrowUp/Down recall sits plus the draft to restore.
const [commandHistory, setCommandHistory] = createSignal<readonly string[]>([]);
const [historyNav, setHistoryNav] = createSignal<HistoryNav>(idleNav());

export { cwd, input, scrollback, setInput };

/** The active session (top of stack), or undefined before `startGame`. */
const activeSession = (): Session | undefined => sessionStack().at(-1);

/** The active session, or a clear error if the game hasn't been started.
 *  Internal accessor so the rest of the module reads a defined value. */
const requireSession = (): Session => {
  const active = activeSession();
  if (active === undefined) throw new Error('startGame must be called before using the terminal');
  return active;
};

/** Push a new active session (backs `env.pushSession`). `su` pushes root; the
 *  prompt + tier reflect it on the next command because the stack is reactive.
 *  Captures the current cwd first so the matching `exit` can restore it. */
const pushSession = (next: Session): void => {
  setReturnCwdStack((previous) => [...previous, cwd()]);
  setSessionStack((previous) => [...previous, next]);
};

/** Pop the active session (backs `env.popSession`), returning to the one
 *  beneath it and restoring the cwd captured at push time. A no-op at the base
 *  session (nothing pushed) — `exit` already guards on `hopChain`, but the
 *  guard here keeps the stacks consistent if ever called directly. */
const popSession = (): void => {
  if (returnCwdStack().length === 0) return;
  setSessionStack((previous) => previous.slice(0, -1));
  setReturnCwdStack((previous) => {
    const restore = previous.at(-1);
    if (restore !== undefined) setCwd(restore);
    return previous.slice(0, -1);
  });
};

// A pending interactive prompt (su's masked password; later ssh/ftp/…). While
// set, the terminal masks input as needed and routes the next submitted line to
// `resolve` instead of running a command; Ctrl-C `reject`s it.
type PendingPrompt = {
  readonly message: string;
  readonly masked: boolean;
  readonly resolve: (value: string) => void;
  readonly reject: (reason?: unknown) => void;
};
const [pendingPrompt, setPendingPrompt] = createSignal<PendingPrompt | undefined>();

export { pendingPrompt };

/** Backs `env.prompt`: returns a promise resolved when the player submits the
 *  next line (or rejected on Ctrl-C). */
const requestPrompt = (opts: { readonly message: string; readonly masked: boolean }): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    setPendingPrompt({ message: opts.message, masked: opts.masked, resolve, reject });
  });

/** Submit the pending prompt with the current input line (Enter while a prompt
 *  is active). Echoes the prompt label (never the masked value) to scrollback. */
export const submitPrompt = (): void => {
  const pending = pendingPrompt();
  if (pending === undefined) return;
  const value = input();
  setInput('');
  setPendingPrompt(undefined);
  setScrollback((previous) => [...previous, { kind: 'prompt', content: pending.message }]);
  pending.resolve(value);
};

/** Cancel the pending prompt (Ctrl-C) — rejects so the awaiting command unwinds. */
export const cancelPrompt = (): void => {
  const pending = pendingPrompt();
  if (pending === undefined) return;
  setInput('');
  setPendingPrompt(undefined);
  pending.reject(new DOMException('prompt cancelled', 'AbortError'));
};

/** Reactive prompt host (machine name) + username for the UI. Read the typed
 *  config; fall through to placeholders only before `startGame` (the boot gate
 *  ensures that never happens in practice). */
export const promptHost = (): string => config?.machineName ?? 'workstation';
export const promptUsername = (): string =>
  activeSession()?.username ?? config?.username ?? 'user';
/** Active tier — drives the prompt symbol (`#` for root after `su`, else `$`). */
export const promptTier = (): UserType => activeSession()?.userType ?? 'user';

/** Re-pull the own-workstation journal and replace the local view. */
const refetchPatches = async (): Promise<void> => {
  if (patchClientDeps === undefined) return;
  setPatches(await fetchOwnPatches(patchClientDeps));
};

/** The real PatchApi, wrapped so a successful mutation reconciles the local
 *  journal with server truth before the call resolves. The command awaits the
 *  mutation, so the refetched patches are in place before the next line runs. */
const wrapWithRefetch = (inner: PatchApi): PatchApi => {
  const afterWrite =
    <Args extends readonly unknown[]>(method: (...args: Args) => ReturnType<PatchApi['mkdir']>) =>
    async (...args: Args) => {
      const result = await method(...args);
      if (result.ok) {
        await refetchPatches();
        // Tell other tabs to re-pull — only after our own journal reflects the
        // server-persisted write, so a receiver's refetch sees the new truth.
        // The workstation id is constant, so read it from the (non-reactive)
        // client deps rather than the reactive session.
        const machineId = patchClientDeps?.machineId;
        if (machineId !== undefined) {
          syncChannel?.broadcast({ type: 'patches-changed', machineId });
        }
      }
      return result;
    };
  return {
    write: afterWrite(inner.write),
    remove: afterWrite(inner.remove),
    mkdir: afterWrite(inner.mkdir),
  };
};

/** Start (or restart) the game for a given config. Builds identity, session,
 *  the patch API, and cross-tab sync; sets the cwd to the player's home; and
 *  hydrates the patch journal so reload-durable writes show up immediately.
 *  Idempotent enough for tests: a second call rebuilds cleanly. */
export const startGame = (gameConfig: GameConfig): void => {
  config = gameConfig;
  identity = getPlayerIdentity();
  const seed = seedSession(identity, gameConfig);
  setSessionStack([seed]);
  setReturnCwdStack([]);
  // Seed WiFi + connectivity, then rehydrate any persisted connection: a stored
  // ESSID (from a prior nmcli connect) re-derives its address through the join
  // seam so the player comes back online on reload without re-cracking.
  const cold = buildColdStartConnectivity(identity.publicKeyHex);
  const wifi = generateWifi(identity.publicKeyHex);
  setWifiNetworks(wifi);
  setConnectivity(restoreConnection(localStorage, cold, wifi, identity.publicKeyHex));

  patchClientDeps = {
    identity,
    machineId: seed.machineId,
    owner: seed.username,
    tier: seed.userType,
  };
  patchApi = wrapWithRefetch(createPatchApi(patchClientDeps));

  setCwd(homePathFor(gameConfig.username));
  setScrollback([]);
  setPatches([]);
  setCommandHistory([]);
  setHistoryNav(idleNav());

  // Cross-tab sync: a write in another tab of this browser (same identity, same
  // workstation) hints us to re-pull the journal, so our next command reflects
  // it without a reload. The BroadcastChannel spec never echoes our own writes
  // back to us, so this can't self-trigger. (Cross-browser via Realtime later.)
  syncChannel?.close();
  syncChannel = createSyncChannel();
  syncChannel.onMessage((message) => {
    // The workstation id is constant (su changes tier, not machine), so compare
    // against the seed session's id — no reactive read needed in this handler.
    if (message.type === 'patches-changed' && message.machineId === seed.machineId) {
      void refetchPatches();
    }
  });

  // Hydrate the journal so reload-durable writes show up immediately.
  void refetchPatches();
};

/** ArrowUp recall — recall an older command, capturing the live draft first. */
export const historyUp = (): void => {
  const step = navigateUp(commandHistory(), historyNav(), input());
  setHistoryNav(step.nav);
  setInput(step.value);
};

/** ArrowDown recall — move toward newer commands, restoring the draft at the end. */
export const historyDown = (): void => {
  const step = navigateDown(commandHistory(), historyNav(), input());
  setHistoryNav(step.nav);
  setInput(step.value);
};

/** Clear the terminal. Doubles as the backing for a future `clear` command. */
export const resetTerminal = (): void => {
  setScrollback([]);
  setInput('');
  setCwd(config === undefined ? asAbsPath('/') : homePathFor(config.username));
  setCommandHistory([]);
  setHistoryNav(idleNav());
};

/** Build a completion adapter over the current FS view + command registry.
 *  Materializes the patched tree exactly as `runInput` does, so completion
 *  reflects mkdir'd dirs and tier permissions. The `AbsPath` brand is applied
 *  here — the pure completer stays string-typed. */
const buildCompleteAdapter = (): CompleteAdapter => {
  const activeSession = requireSession();
  const fsView = createFsView(applyPatches(seedFs(requireConfig(), requireIdentity()), patches()), {
    userType: activeSession.userType,
    cwd,
  });
  return {
    commandNames: [...commandRegistry.keys()],
    getCommand: (name) => commandRegistry.get(name),
    listPath: (abs) => {
      const result = fsView.list(asAbsPath(abs));
      return result.ok ? result.entries : null;
    },
    isDirectory: (abs) => fsView.stat(asAbsPath(abs))?.kind === 'directory',
    resolvePath: (path) => resolveAbsPath(cwd(), path),
  };
};

const requireConfig = (): GameConfig => {
  if (config === undefined) throw new Error('startGame must be called before using the terminal');
  return config;
};

/** Tab-complete the token at `cursorPos`. Applies the replacement to the input
 *  signal and, when more than one candidate matches, prints the candidate list
 *  to the scrollback. Returns the new caret index when the line changed (so the
 *  UI can reposition the DOM caret), or null when nothing moved. */
export const tabComplete = (cursorPos: number): number | null => {
  const line = input();
  const outcome = complete(line, cursorPos, buildCompleteAdapter());
  if (outcome.matches.length === 0) return null;

  const changed = outcome.replacement !== line;
  if (changed) setInput(outcome.replacement);
  if (outcome.matches.length > 1) {
    setScrollback((previous) => [...previous, { kind: 'text', content: outcome.displayText }]);
  }
  return changed ? outcome.newCursorPosition : null;
};

// The in-flight command's abort controller, while a (typically streamed)
// command is running. Ctrl-C aborts it via `abortRunning`; cleared when the
// run finishes. Only one command runs at a time (the prompt blocks on it).
let activeRun: AbortController | undefined;

/** Abort the running command (Ctrl-C). Returns whether anything was aborted, so
 *  the UI only swallows the keystroke when there was a command to interrupt
 *  (otherwise Ctrl-C stays a normal copy). */
export const abortRunning = (): boolean => {
  if (activeRun === undefined) return false;
  activeRun.abort();
  return true;
};

export const runInput = async (): Promise<void> => {
  const currentSession = requireSession();
  const activePatchApi = patchApi;
  if (activePatchApi === undefined) throw new Error('startGame must be called before runInput');

  const line = input();
  // Record real commands for ArrowUp/Down recall and snap the cursor back to
  // the live prompt; blank/whitespace lines never enter the recallable list.
  if (line.trim()) setCommandHistory((previous) => [...previous, line]);
  setHistoryNav(idleNav());
  setInput('');

  setScrollback((previous) => [
    ...previous,
    commandEchoLine(
      {
        username: currentSession.username,
        host: promptHost(),
        cwd: cwd(),
        userType: currentSession.userType,
      },
      line,
    ),
  ]);

  // Fresh abort controller per run — Ctrl-C aborts it, which rejects the
  // command's `env.sleep` and unwinds a streamed command mid-flight.
  const controller = new AbortController();
  activeRun = controller;

  const env = buildCommandEnv({
    identity: requireIdentity(),
    session: currentSession,
    hostname: promptHost(),
    root: applyPatches(seedFs(requireConfig(), requireIdentity()), patches()),
    cwd,
    onCwdChange: setCwd,
    patches: activePatchApi,
    connectivity,
    onInterfaceChange: setInterface,
    wifiNetworks,
    signal: controller.signal,
    prompt: requestPrompt,
    onPushSession: pushSession,
    // The sessions below the active one — what `exit` consults to decide
    // whether there's somewhere to drop back to (empty at the base shell).
    hopChain: sessionStack().slice(0, -1),
    onPopSession: popSession,
  });

  try {
    const result = await runCommandLine(env, line, commandRegistry);
    if (result.kind === 'sync') {
      setScrollback((previous) => [...previous, ...result.lines]);
      return;
    }
    // Streamed commands (airdump, aircrack) append each line as it arrives, so
    // the terminal fills live rather than all at once. A Ctrl-C abort rejects
    // the in-flight `env.sleep`, which surfaces here — print a `^C` marker and
    // stop, leaving the partial output. Any other error is a real fault.
    if (result.kind === 'async') {
      try {
        for await (const streamed of result.lines) {
          setScrollback((previous) => [...previous, streamed]);
        }
        await result.exitCode();
      } catch (streamError) {
        if (!controller.signal.aborted) throw streamError;
        setScrollback((previous) => [...previous, { kind: 'text', content: '^C' }]);
      }
    }
  } finally {
    activeRun = undefined;
  }
};

const requireIdentity = (): Identity => {
  if (identity === undefined) throw new Error('startGame must be called before using the terminal');
  return identity;
};
