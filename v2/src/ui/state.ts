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
import type {
  FtpPublicAuthParams,
  Identity,
  LogApi,
  PatchApi,
  PublicAuthParams,
  InnerGatewayAuthParams,
  PublicAuthResult,
  PatchResult,
  ScpReadResult,
  PublicFetchParams,
  PublicFetchResult,
  PublicSweepParams,
  PublicSweepResult,
  PublicScanResolution,
  DeepScanRecordParams,
  RemoteAuthParams,
  RemoteAuthResult,
  SameLanAuthParams,
  ScanRecordParams,
  Session,
  SuElevateParams,
  HydraCrackParams,
  HydraCrackInnerGatewayParams,
  HydraCrackPublicParams,
  HydraCrackResult,
  ModeChange,
  TerminalLine,
} from '../core/commands/types';
import type { GameConfig } from '../core/gameConfig/gameConfig';
import type { Directory } from '../core/filesystem/types';
import { applyPatches, type Patch } from '../core/filesystem/applyPatches';
import { canBoot, type BootCheck } from '../core/boot/bootFiles';
import { isCrossPlayerHop, resolveActiveRoot } from './activeRoot';
import { createFsView } from '../core/filesystem/fsView';
import { resolveAbsPath } from '../core/filesystem/path';
import {
  buildColdStartConnectivity,
  connectedWlan0,
  isOnline,
  type ConnectivityState,
  type NetworkInterface,
  type WirelessInterface,
} from '../core/network/interfaces';
import { parseHttpUrl } from '../core/network/http';
import { fetchPageAcrossNetwork, fetchWebPage } from '../core/commands/webPage';
import { isPublicIp } from '../core/generation/ip';
import type { FollowOutcome } from './screens/Lynx';
import { generateWifi } from '../core/generation/generateWifi';
import type { WifiNetwork } from '../core/network/wifi';
import { commandRegistry } from '../core/commands/registry';
import { complete, type CompleteAdapter } from '../core/shell/complete';
import { runCommandLine } from '../core/shell/runLine';
import { commandEchoLine } from '../core/shell/prompt';
import { buildCommandEnv, type BuildCommandEnvArgs } from './env';
import { homeDirectory } from '../core/sessions/homeDirectory';
import { getPlayerIdentity } from './identity';
import { isOwnWorkstation, parseWorkstationId } from '../core/identity/workstation';
import {
  createPatchApi,
  fetchOwnPatches,
  postAuthLog,
  recordDeepScan,
  recordFtpTransfer,
  recordLanFetch,
  recordScan,
  type FtpTransferRecord,
  type PatchClientDeps,
} from '../adapters/patchApi';
import { createSyncChannel, type SyncChannel } from '../adapters/crossTabSync';
import {
  authCreateServerSession,
  authCreateServerSessionInnerGateway,
  authCreateServerSessionPublic,
  authCreateServerSessionSameLan,
  authElevateServerSession,
  crackCredentials,
  crackCredentialsInnerGateway,
  crackCredentialsPublic,
  createServerSession,
  endServerSession,
  listServerSessions,
  type SessionsClientDeps,
} from '../adapters/sessionsApi';
import {
  fetchPublicPage,
  sweepPublicPaths,
  joinHomeNetwork,
  leaveHomeNetwork,
  resolveCrossPlayerFs,
  resolveOccupants,
  resolveOccupiedEssids,
  resolvePublic,
  resolveInnerGateway,
  type NetworkClientDeps,
} from '../adapters/networkApi';
import type { OccupantProjection } from '../core/network/resolveOccupants';
import type { HomeNetworkAssignment } from '../core/network/homeNetwork';
import { lanLeaseCacheIn } from '../core/network/lanLeaseCache';
import { type HistoryNav, idleNav, navigateDown, navigateUp } from '../core/shell/commandHistory';
import { homePathFor, seedFs, seedSession } from './seed';
import { rehydrateSessionStack } from './sessionRehydrate';
import { runFtpLine } from '../core/commands/ftpShell';
import { persistConnection, restoreConnection } from './connectionPersistence';

// ---- Config-derived game state, assigned once by `startGame`. ----
// `let` (not top-level `const`) precisely because these can't be built at
// import time — they need the player's typed config. Reading them before
// `startGame` is a programming error the `started()` guard surfaces loudly.
let identity: Identity | undefined;
let config: GameConfig | undefined;
let patchClientDeps: PatchClientDeps | undefined;
let sessionsClientDeps: SessionsClientDeps | undefined;
// Pinned to the player's OWN workstation (set once in startGame, never re-pointed
// on an ssh hop): `join` registers the own workstation, and `resolvePublic` signs
// with the constant player identity.
let networkClientDeps: NetworkClientDeps | undefined;
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
// The SERVER-served filesystem of ANOTHER player's box, fetched for a cross-player
// ssh hop (Story 2): B can't regenerate A's box (D1), so its tree comes from the
// server already pruned to B's tier. Tagged with the machine it belongs to so
// `activeRoot` only serves it for the matching active session; null on the own box.
const [servedRoot, setServedRoot] = createSignal<{
  readonly machineId: string;
  readonly tree: Directory;
} | null>(null);

// Placeholder root for a cross-player hop whose served tree is still in flight — an
// empty, world-traversable directory. Showing this (rather than falling through to
// `resolveActiveRoot`, which would pick OUR own box) guarantees a cross-player hop
// never flashes the attacker's own filesystem.
const CROSS_PLAYER_LOADING_ROOT: Directory = {
  kind: 'directory',
  owner: 'root',
  perms: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root', 'user', 'guest'] },
  entries: new Map(),
};
// The workstation's NICs. Seeded from identity at `startGame`; offline at cold
// start (only `lo` has an address). Later arc slices mutate this via airmon/nmcli.
const [connectivity, setConnectivity] = createSignal<ConnectivityState>({
  interfaces: new Map(),
});
// The WiFi access points in range — the latest scan roll. Seeded at `startGame`,
// then refreshed by every `airdump` (a fresh roll, "relocating"); read afterwards
// by aircrack/nmcli. Empty until the game starts.
const [wifiNetworks, setWifiNetworks] = createSignal<readonly WifiNetwork[]>([]);
// The per-scan counter — the varying half of the roll seed, so consecutive scans
// differ. Bumped on every `rescanWifi`.
const [wifiScanIndex, setWifiScanIndex] = createSignal(0);

/** Re-roll the WiFi scan (backs `env.network.rescanWifi`): bump the scan index for
 *  a fresh draw, inject the currently-occupied ESSIDs for organic discovery, store
 *  the roll so aircrack/nmcli read what airdump just showed, and return it. */
const rescanWifi = (occupiedEssids: readonly string[]): readonly WifiNetwork[] => {
  const scanIndex = wifiScanIndex() + 1;
  setWifiScanIndex(scanIndex);
  const roll = generateWifi({
    seedPubkeyHex: requireIdentity().publicKeyHex,
    scanIndex,
    occupiedEssids,
  });
  setWifiNetworks(roll);
  return roll;
};

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

// The full-screen app currently holding the screen, or null in normal command
// mode. Set by `executeLine` on a `mode_change`; cleared when the app exits
// (nano's Ctrl-X, the browser's q). Module-level so the `Terminal` screen swaps
// to the overlay reactively.
//
// ONE signal rather than one per app: what is on screen is a single question,
// and two apps open at once is a state nothing should be able to represent. The
// `Extract` keeps it honest about which apps have a screen — a `mode_change`
// kind with no overlay yet cannot be assigned here.
type OverlayMode = Extract<ModeChange, { readonly kind: 'nano' | 'lynx' }>;

const [overlayMode, setOverlayMode] = createSignal<OverlayMode | null>(null);

// The ftp session the terminal is holding, or null. Deliberately NOT an
// `OverlayMode`: ftp has no screen. It is a SUB-SHELL over the same terminal, so
// while it is set the typed line is answered by the ftp command map instead of the
// registry, and the prompt reads `ftp>`. The shell underneath is untouched — same
// hop chain, same cwd, same tier — which is what `quit` hands straight back.
const [ftpSession, setFtpSession] = createSignal<Session | null>(null);

// Where the player is standing ON THE TARGET, and that machine's journal. Both are
// SEPARATE from `cwd`/`patches`, which keep following the shell: the ftp session is
// beside the shell rather than above it, so the two working directories move
// independently and neither box's writes leak into the other's tree.
const [ftpCwd, setFtpCwd] = createSignal<AbsPath>(asAbsPath('/'));
const [ftpPatches, setFtpPatches] = createSignal<readonly Patch[]>([]);

export { ftpSession };

/** The prompt the terminal shows: an ftp session replaces it wholesale rather than
 *  decorating it, because at `ftp>` the cwd and tier on the shell prompt would name
 *  a machine the player is no longer typing at. */
export const inFtpSession = (): boolean => ftpSession() !== null;

/** What the terminal shows while an ftp session is held. */
export const FTP_PROMPT = 'ftp> ';

/** Hold an authenticated ftp session (backs `env.ftp.enter`), landing on the target
 *  at the logged-in account's home and pulling that machine's journal so the box
 *  shows the state it is actually in, not the state it was generated in. */
const enterFtpSession = (session: Session): void => {
  setFtpSession(session);
  setFtpCwd(homeDirectory(session));
  setFtpPatches([]);
  void refetchFtpPatches(session);
};

/** Drop it and end the server row (backs `env.ftp.leave`). Fire-and-forget: the
 *  player is back at their shell either way, and a row left active is swept on the
 *  next boot. */
const leaveFtpSession = (): void => {
  const ending = ftpSession();
  setFtpSession(null);
  setFtpPatches([]);
  if (sessionsClientDeps !== undefined && ending !== null) {
    void endServerSession(sessionsClientDeps, ending.id);
  }
};

// The name of the command currently executing, or null when the shell is idle.
// Drives the busy bar that stands in for the prompt while a command runs — set
// for the WHOLE of `executeLine`, so every awaited server round-trip inside a
// command counts as busy, not just a streamed one.
const [runningCommand, setRunningCommand] = createSignal<string | null>(null);

export { cwd, input, overlayMode, runningCommand, scrollback, setInput, setOverlayMode };

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
  const parent = activeSession();
  setReturnCwdStack((previous) => [...previous, cwd()]);
  setSessionStack((previous) => [...previous, next]);
  // Persist the pushed session so it survives a refresh. Fire-and-forget alongside
  // the optimistic stack update — the adapter swallows errors, so a network hiccup
  // never breaks the switch. ONLY own-workstation sessions are created here: a
  // foreign-machine session (an `ssh` hop, or a cross-player `su` elevation) is
  // already created server-side by its OWN auth round-trip (authCreateSession /
  // suElevate), which MUST validate the credential before the row exists — creating
  // it again here would just 403 against the own-workstation gate. The base login
  // session is seeded directly in `startGame`, never through here.
  if (
    sessionsClientDeps !== undefined &&
    identity !== undefined &&
    isOwnWorkstation(next.machineId, identity.publicKeyHex)
  ) {
    void createServerSession(sessionsClientDeps, next, parent?.id ?? null);
  }
  // Re-point the patch client at the now-active machine. An ssh hop swaps the
  // journal to the remote host; an su (same machine) just re-stamps owner/tier.
  rebindPatchClient();
};

/** The player's wireless interface, or null when the box has none. Three readers
 *  ask the same narrowing question — which network they are on, which address they
 *  are reaching from, and whether a fetch was aimed at their own box — so the
 *  question is answered once here. */
const wireless = (): WirelessInterface | null => {
  const wlan0 = connectivity().interfaces.get('wlan0');
  return wlan0 !== undefined && wlan0.kind === 'wireless' ? wlan0 : null;
};

/** The ESSID of the currently-associated wlan0, or null when not on a network.
 *  Lets the FS dispatch regenerate the LAN a remote ssh session lives on. */
const currentEssid = (): string | null => wireless()?.association?.essid ?? null;

/** The player's own workstation id — the base (bottom) session's machine, stable
 *  across `su`/`ssh` hops. The FS dispatch compares the active session against it
 *  to decide own-tree vs remote-tree. */
const ownWorkstationId = (): string => {
  const base = sessionStack()[0];
  if (base === undefined)
    throw new Error('ownWorkstationId read before startGame seeded the stack');
  return base.machineId;
};

/** The filesystem tree the ACTIVE session operates on: own workstation, or the
 *  generated tree of the remote host an ssh hop landed on — in both cases with
 *  the active machine's journal (`patches()`, which follows the active session)
 *  replayed over the base, so own AND remote writes are visible. */
const activeRoot = (): Directory => {
  const session = requireSession();
  const served = servedRoot();
  if (served !== null && served.machineId === session.machineId) return served.tree;
  // A cross-player hop is SERVER-served; until its tree arrives show an empty root,
  // never our own box (which is what `resolveActiveRoot` would otherwise fall to).
  if (isCrossPlayerHop(session, currentEssid(), requireIdentity().publicKeyHex)) {
    return CROSS_PLAYER_LOADING_ROOT;
  }
  return resolveActiveRoot({
    session,
    ownWorkstationId: ownWorkstationId(),
    publicKeyHex: requireIdentity().publicKeyHex,
    essid: currentEssid(),
    ownBaseFs: seedFs(requireConfig(), requireIdentity()),
    patches: patches(),
  });
};

/** The tree an ftp session addresses: the TARGET's, with the TARGET's journal
 *  replayed over it, so the box shows the state it is actually in rather than the
 *  state it was generated in. Held apart from `activeRoot` on purpose — the shell
 *  and the ftp session are two machines at once, and one `root()` could only ever
 *  be one of them. */
const ftpRoot = (session: Session): Directory =>
  resolveActiveRoot({
    session,
    ownWorkstationId: ownWorkstationId(),
    publicKeyHex: requireIdentity().publicKeyHex,
    essid: currentEssid(),
    ownBaseFs: seedFs(requireConfig(), requireIdentity()),
    patches: ftpPatches(),
  });

/** The address the player is reaching the remote box FROM — their own leased LAN
 *  address. Null off-network, which the server renders as `unknown` rather than
 *  inventing a client. */
const localAddress = (): string | null => wireless()?.ipv4 ?? null;

/** The remote half of the env, present only while a session is held: without one
 *  there is nothing to bind, and `buildCommandEnv` supplies the empty tree that
 *  says so. */
const ftpBinding = (): Pick<
  BuildCommandEnvArgs,
  'ftpFs' | 'onFtpCwdChange' | 'onFtpWrite' | 'onFtpTransfer'
> => {
  const session = ftpSession();
  if (session === null) return {};
  return {
    ftpFs: createFsView(ftpRoot(session), { userType: session.userType, cwd: ftpCwd }),
    onFtpCwdChange: setFtpCwd,
    // The SHIPPED patch client, pointed at the target and stamped with the account
    // the credential bought — which is the whole of what `put` needed: the endpoint
    // that already refuses an ssh session writing above its tier refuses this one on
    // the same evidence, having never been told a door was involved.
    onFtpWrite: (path, content, options) => writeToFtpTarget(session, path, content, options),
    // The command names the file and the direction; WHICH box and from WHERE are
    // added here, off the session it could not have opened by itself. The box the
    // shell is standing on rides along too: on another player's machine the reported
    // address is not evidence, and that is what the server derives one from.
    onFtpTransfer: ({ direction, path, bytes }) =>
      void recordFtpTransferFn({
        machineId: session.machineId,
        direction,
        path,
        bytes,
        sourceIp: localAddress(),
        callerMachineId: requireSession().machineId,
      }),
  };
};

/** Authenticate an ssh login server-side (backs `env.ssh.authenticate`). Degrades
 *  to a network error before `startGame` wires the sessions client. */
const sshAuthenticate = (params: RemoteAuthParams): Promise<RemoteAuthResult> =>
  sessionsClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : authCreateServerSession(sessionsClientDeps, params);

/** Authenticate an ftp login server-side (backs `env.ftp.authenticate`) — the same
 *  endpoint `ssh` uses, asked for an `ftp`-kind row. Degrades to a network error
 *  before `startGame` wires the sessions client. */
const ftpAuthenticate = (params: RemoteAuthParams): Promise<RemoteAuthResult> =>
  sessionsClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : authCreateServerSession(sessionsClientDeps, params, 'ftp');

/** Authenticate a CROSS-PLAYER ssh login server-side (backs `env.ssh.authenticatePublic`).
 *  Degrades to a network error before `startGame` wires the sessions client. */
const sshAuthenticatePublic = (params: PublicAuthParams): Promise<PublicAuthResult> =>
  sessionsClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : authCreateServerSessionPublic(sessionsClientDeps, params);

/** Authenticate a CROSS-PLAYER ftp login server-side (backs `env.ftp.authenticatePublic`)
 *  — the same endpoint `ssh` reaches, asked for an `ftp`-kind row against whatever the
 *  named port forwards to. Degrades to a network error before `startGame` wires the
 *  sessions client. */
const ftpAuthenticatePublic = (params: FtpPublicAuthParams): Promise<PublicAuthResult> =>
  sessionsClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : authCreateServerSessionPublic(sessionsClientDeps, params, 'ftp');

/** Authenticate a SAME-WiFi LAN ssh login server-side (backs `env.ssh.authenticateSameLan`).
 *  Degrades to a network error before `startGame` wires the sessions client. */
const sshAuthenticateSameLan = (params: SameLanAuthParams): Promise<PublicAuthResult> =>
  sessionsClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : authCreateServerSessionSameLan(sessionsClientDeps, params);

/** Authenticate an ssh login through a NAT forward on the player's own inner gateway
 *  (backs `env.ssh.authenticateInnerGateway`). Degrades to a network error before
 *  `startGame` wires the sessions client. */
const sshAuthenticateInnerGateway = (params: InnerGatewayAuthParams): Promise<PublicAuthResult> =>
  sessionsClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : authCreateServerSessionInnerGateway(sessionsClientDeps, params);

/** Elevate a session on another player's box to root server-side (backs
 *  `env.su.elevate`). Degrades to a network error before `startGame` wires the
 *  sessions client. */
const suElevate = (params: SuElevateParams): Promise<RemoteAuthResult> =>
  sessionsClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : authElevateServerSession(sessionsClientDeps, params);

/** Crack credentials on an own-LAN host server-side (backs `env.hydra.crack`).
 *  Degrades to a network error before `startGame` wires the sessions client. */
const hydraCrack = (params: HydraCrackParams): Promise<HydraCrackResult> =>
  sessionsClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : crackCredentials(sessionsClientDeps, params);

/** Crack credentials behind a stranger's PUBLIC IP server-side (backs
 *  `env.hydra.crackPublic`). Degrades the same way before the client is wired. */
const hydraCrackPublic = (params: HydraCrackPublicParams): Promise<HydraCrackResult> =>
  sessionsClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : crackCredentialsPublic(sessionsClientDeps, params);

/** Crack credentials on a box behind a forward on the player's own inner gateway
 *  (backs `env.hydra.crackInnerGateway`). Degrades the same way before the client is
 *  wired. */
const hydraCrackInnerGateway = (
  params: HydraCrackInnerGatewayParams,
): Promise<HydraCrackResult> =>
  sessionsClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : crackCredentialsInnerGateway(sessionsClientDeps, params);

/** Record an nmap scan server-side (backs `env.scan.record`). Best-effort and a
 *  no-op until `startGame` wires the patch client; the scan stands regardless. */
const recordScanFn = (params: ScanRecordParams): Promise<void> =>
  patchClientDeps === undefined ? Promise.resolve() : recordScan(patchClientDeps, params);

/** Itemise a completed ftp transfer on the target's own `vsftpd.log` (backs
 *  `env.ftp.recordTransfer`). Best-effort and a no-op until `startGame` wires the
 *  patch client; the bytes have moved regardless. */
const recordFtpTransferFn = (transfer: FtpTransferRecord): Promise<void> =>
  patchClientDeps === undefined
    ? Promise.resolve()
    : recordFtpTransfer(patchClientDeps, transfer);

/** Write to the machine an ftp session is held on (backs `env.ftp.write`). The
 *  SHIPPED patch client, aimed at the target and stamped with the session's account
 *  and tier — the server gate is reached with no idea a second door exists, which is
 *  the claim the whole door rests on. A landed write re-pulls the TARGET's journal,
 *  not the shell's, so the next `ls` at the prompt shows the file that just arrived.
 *  Refuses as a network error until `startGame` wires the client: a `put` that
 *  reported success while nothing left would be worse than one that failed. */
const writeToFtpTarget = async (
  session: Session,
  ...args: Parameters<PatchApi['write']>
): Promise<PatchResult> => {
  if (identity === undefined) return { ok: false, error: 'network_error' };
  const written = await createPatchApi({
    identity,
    machineId: session.machineId,
    owner: session.username,
    tier: session.userType,
  }).write(...args);
  if (written.ok) void refetchFtpPatches(session);
  return written;
};

/** Authenticate a transfer server-side (backs `env.scp.authenticate`) — the same
 *  endpoint `ssh` and `ftp` reach, asked for an `scp`-kind row. The row is stored
 *  under its own kind while the target's log records an ordinary ssh login, which is
 *  the whole of this door's bargain. */
const scpAuthenticate = (params: RemoteAuthParams): Promise<RemoteAuthResult> =>
  sessionsClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : authCreateServerSession(sessionsClientDeps, params, 'scp');

/** Write to the machine a transfer opened a session on (backs `env.scp.write`). The
 *  SHIPPED patch client, aimed at the target and stamped with the account the
 *  credential bought — the same gate an ssh session's write goes through, reached
 *  with no idea a transfer was involved.
 *
 *  Unlike the ftp write there is no journal to re-pull: nothing is being LOOKED at
 *  afterwards. The session is retired on the next line, and the shell the player is
 *  standing in never moved. */
const writeToScpTarget = async (
  session: Session,
  ...args: Parameters<PatchApi['write']>
): Promise<PatchResult> => {
  if (identity === undefined) return { ok: false, error: 'network_error' };
  return createPatchApi({
    identity,
    machineId: session.machineId,
    owner: session.username,
    tier: session.userType,
  }).write(...args);
};

/** Read one file off the machine a transfer opened a session on (backs
 *  `env.scp.read`) — the target's journal pulled and replayed over its generated
 *  base, viewed at the tier the credential bought.
 *
 *  The same composition the ftp session's tree is built from, held for ONE call
 *  instead of for a session: a transfer looks once and is gone, so there is no
 *  signal, nothing to refetch, and nothing for a later write to invalidate. */
const readFromScpTarget = async (session: Session, path: AbsPath): Promise<ScpReadResult> => {
  if (identity === undefined) return { ok: false, error: 'network_error' };
  const journal = await fetchOwnPatches({
    identity,
    machineId: session.machineId,
    owner: session.username,
    tier: session.userType,
  });
  const tree = resolveActiveRoot({
    session,
    ownWorkstationId: ownWorkstationId(),
    publicKeyHex: requireIdentity().publicKeyHex,
    essid: currentEssid(),
    ownBaseFs: seedFs(requireConfig(), requireIdentity()),
    patches: journal,
  });
  return createFsView(tree, { userType: session.userType, cwd: asAbsPath('/') }).read(path);
};

/** Close the row a transfer opened (backs `env.scp.end`). Fire-and-forget: the bytes
 *  have already moved or already failed, and the command has nothing left to say. */
const endScpSession = (sessionId: string): void => {
  if (sessionsClientDeps === undefined) return;
  void endServerSession(sessionsClientDeps, sessionId);
};

/** Record a deep PIVOT scan server-side (backs `env.scan.recordDeep`). Best-effort
 *  and a no-op until `startGame` wires the patch client; the scan stands regardless. */
const recordDeepScanFn = (params: DeepScanRecordParams): Promise<void> =>
  patchClientDeps === undefined ? Promise.resolve() : recordDeepScan(patchClientDeps, params);

/** Resolve an `nmap <public IP>` cross-player (backs `env.scan.resolvePublic`).
 *  Host-down until `startGame` wires the network client — degrade rather than crash. */
const resolvePublicFn = (target: string): Promise<PublicScanResolution> =>
  networkClientDeps === undefined
    ? Promise.resolve({ found: false, ports: [] })
    : resolvePublic(networkClientDeps, target);

/** Fetch a page from behind another player's public IP (backs `env.remote.fetchPublic`).
 *  Before `startGame` wires the network client there is nothing to ask, so the failure is
 *  ours — `network_error`, not a claim that the target is dark. */
const fetchPublicPageFn = (params: PublicFetchParams): Promise<PublicFetchResult> =>
  networkClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : fetchPublicPage(networkClientDeps, params);

/** Sweep a path list against a machine behind another player's public IP (backs
 *  `env.remote.sweepPublic`). Same degradation as the fetch: with no network client
 *  there is nobody to ask, so the failure is ours rather than the target's. */
const sweepPublicPathsFn = (params: PublicSweepParams): Promise<PublicSweepResult> =>
  networkClientDeps === undefined
    ? Promise.resolve({ ok: false, error: 'network_error' })
    : sweepPublicPaths(networkClientDeps, params);

/** Resolve an own-LAN `nmap <inner gateway IP>` server-side (backs
 *  `env.scan.resolveInnerGateway`). Host-down until `startGame` wires the network
 *  client — degrade rather than crash, like the public-IP scan. */
const resolveInnerGatewayFn = (essid: string, target: string): Promise<PublicScanResolution> =>
  networkClientDeps === undefined
    ? Promise.resolve({ found: false, ports: [] })
    : resolveInnerGateway(networkClientDeps, essid, target);

/** Resolve the current ESSID's other occupants (backs `env.scan.resolveOccupants`).
 *  Additive — an empty list (here, before the network client is wired) just means an
 *  own-LAN scan with no fellow players, never a failure. */
const resolveOccupantsFn = (essid: string): Promise<readonly OccupantProjection[]> =>
  networkClientDeps === undefined
    ? Promise.resolve([])
    : resolveOccupants(networkClientDeps, essid);

/** Fetch the ESSID names anyone currently occupies (backs `env.scan.resolveOccupiedEssids`).
 *  Additive — an empty list (before the network client is wired, or the server is down)
 *  just means a scan with nothing to discover, never a failure. */
const resolveOccupiedEssidsFn = (): Promise<readonly string[]> =>
  networkClientDeps === undefined ? Promise.resolve([]) : resolveOccupiedEssids(networkClientDeps);

/** Join a home network (backs `env.homeNetwork.join`): register it server-side, which
 *  is what ISSUES the player's address on that LAN. Before the network client is wired
 *  there is nobody to issue one, so the join yields null and the connect reports it —
 *  the client never allocates its own address. */
const joinHomeNetworkFn = (essid: string): Promise<HomeNetworkAssignment | null> =>
  networkClientDeps === undefined
    ? Promise.resolve(null)
    : joinHomeNetwork(networkClientDeps, essid);

/** Leave a home network (backs `env.homeNetwork.leave`, fired by `nmcli disconnect`):
 *  fire-and-forget removal of our occupancy row. A no-op before the network client is
 *  wired (no server to clean up against). */
const leaveHomeNetworkFn = (essid: string): void => {
  if (networkClientDeps !== undefined) leaveHomeNetwork(networkClientDeps, essid);
};

/** Pop the active session (backs `env.popSession`), returning to the one
 *  beneath it and restoring the cwd captured at push time. A no-op at the base
 *  session (nothing pushed) — `exit` already guards on `hopChain`, but the
 *  guard here keeps the stacks consistent if ever called directly. */
const popSession = (): void => {
  if (returnCwdStack().length === 0) return;
  const ending = activeSession();
  setSessionStack((previous) => previous.slice(0, -1));
  setReturnCwdStack((previous) => {
    const restore = previous.at(-1);
    if (restore !== undefined) setCwd(restore);
    return previous.slice(0, -1);
  });
  // End the popped session server-side so the de-elevation survives a refresh.
  // Fire-and-forget alongside the optimistic pop; the base login session is
  // guarded out above (empty returnCwdStack) and has no server row anyway.
  if (sessionsClientDeps !== undefined && ending !== undefined) {
    void endServerSession(sessionsClientDeps, ending.id);
  }
  // Re-point the patch client at the machine we dropped back to (swaps the
  // journal back to the own box when leaving a remote ssh host).
  rebindPatchClient();
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
const requestPrompt = (opts: {
  readonly message: string;
  readonly masked: boolean;
}): Promise<string> =>
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

/** The deferred-reload delay (ms) for `reset`: long enough that the command's
 *  `Resetting game...` line renders before the page tears down. */
const RESET_RELOAD_MS = 400;

/** Backs `env.resetGame` (the `reset` command). Wipe ALL client-persisted state
 *  — identity, game config, and the saved connection all live in `localStorage`,
 *  the whole origin is the game — so the next boot regenerates a fresh Ed25519
 *  identity and shows the intro screen. The reload is deferred a beat so the
 *  command's `Resetting game...` line paints first. */
const resetGame = (): void => {
  localStorage.clear();
  setTimeout(() => window.location.reload(), RESET_RELOAD_MS);
};

/** Reactive prompt host (machine name) + username for the UI. The host reflects
 *  the ACTIVE session's machine: your own box for the base/`su` sessions, the
 *  remote host's name after an `ssh` hop — both recovered from the session's
 *  `machine_id` (`name-suffix`). Falls back to the typed config before
 *  `startGame` (the boot gate ensures that never happens in practice). */
export const promptHost = (): string =>
  parseWorkstationId(activeSession()?.machineId ?? '')?.name ??
  config?.machineName ??
  'workstation';
export const promptUsername = (): string => activeSession()?.username ?? config?.username ?? 'user';
/** Active tier — drives the prompt symbol (`#` for root after `su`, else `$`). */
export const promptTier = (): UserType => activeSession()?.userType ?? 'user';

/** Re-pull the ACTIVE machine's journal and replace the local view. A late result
 *  is dropped if the player has since hopped to another machine — a journal belongs
 *  to exactly one box, so the answer for the box we left must never paint over the
 *  one we now stand on (`refreshServedRoot` guards its own fetch the same way).
 *  Without this, a hop's two back-to-back refetches can land out of order and leave
 *  a foreign tree in `patches()` — which `nano`, saving the WHOLE buffer, would then
 *  write back over the real file. */
const refetchPatches = async (): Promise<void> => {
  const deps = patchClientDeps;
  if (deps === undefined) return;
  const journal = await fetchOwnPatches(deps);
  if (patchClientDeps?.machineId !== deps.machineId) return;
  setPatches(journal);
};

/** Pull the TARGET's journal for an ftp session — a SECOND journal, held beside the
 *  shell's, because the two machines are addressed at once and `patches()` follows
 *  the shell. A late answer for a session the player has since quit is dropped: it
 *  belongs to a binding that no longer exists. */
const refetchFtpPatches = async (session: Session): Promise<void> => {
  if (identity === undefined) return;
  const journal = await fetchOwnPatches({
    identity,
    machineId: session.machineId,
    owner: session.username,
    tier: session.userType,
  });
  if (ftpSession()?.id !== session.id) return;
  setFtpPatches(journal);
};

/** Rebuild the hop chain from the server's active sessions so a `su` elevation
 *  survives a refresh. Replays the persisted (pushed) sessions onto the base
 *  login `seed`. A no-rows result leaves the synchronous defaults (`[seed]`,
 *  home cwd) untouched, so the common cold-boot path costs nothing extra. */
const rehydrateSessions = async (seed: Session): Promise<void> => {
  const deps = sessionsClientDeps;
  if (deps === undefined) return;
  const rows = await listServerSessions(deps);
  if (rows.length === 0) return;
  const rebuilt = rehydrateSessionStack(seed, rows);
  // A parallel session (ftp) belongs to the terminal that opened it, and this
  // boot is proof that terminal is gone. Close it: sessions have no TTL, so an
  // abandoned row would otherwise stay a write grant on someone else's box
  // forever. Fire-and-forget — a boot must not block on the sweep.
  rebuilt.abandoned.forEach((session) => void endServerSession(deps, session.id, 'abandoned'));
  setSessionStack(rebuilt.sessionStack);
  setReturnCwdStack(rebuilt.returnCwdStack);
  setCwd(rebuilt.activeCwd);
  // The rebuilt stack may land on a remote ssh hop — re-point the patch client at
  // it so the remote host's journal (and writable tree) come back on refresh.
  rebindPatchClient();
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
        // A cross-player hop renders from the SERVER-served tree, not the local
        // journal, so re-pull it after a successful write or the writer wouldn't see
        // its own change until a hop/reload. Self-guards: a no-op clear (no network)
        // on the own box / a local-LAN hop where the journal already drives the view.
        await refreshServedRoot();
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

/** Re-point the patch client at the ACTIVE session's machine, so writes/reads
 *  target wherever the player currently stands (own box, or a remote ssh host),
 *  and stamp new nodes with the active session's owner + tier. When the active
 *  MACHINE changes (an ssh hop, or the `exit` back), swap the journal: clear it
 *  and re-pull the new machine's patches so `patches()` — and thus `activeRoot`
 *  — reflects the host you're on. A same-machine change (`su` flips the tier but
 *  not the machine) keeps the journal in place, so it costs no refetch/flicker. */
const rebindPatchClient = (): void => {
  if (identity === undefined) return;
  const active = activeSession();
  if (active === undefined) return;
  const machineChanged = patchClientDeps?.machineId !== active.machineId;
  patchClientDeps = {
    identity,
    machineId: active.machineId,
    owner: active.username,
    tier: active.userType,
  };
  patchApi = wrapWithRefetch(createPatchApi(patchClientDeps));
  if (machineChanged) {
    setPatches([]);
    void refetchPatches();
  }
  // Fetch (or clear) the cross-player served tree for whatever machine we now stand
  // on — a no-op fetch for the own box / a local-LAN hop (self-guarded).
  void refreshServedRoot();
};

/** Fetch — or clear — the SERVER-served filesystem for the active session. For a
 *  cross-player ssh hop, B can't rebuild A's box locally, so the server returns it
 *  pre-filtered to B's tier (D1); for the own box or a local-LAN hop there's nothing
 *  to serve, so it clears to null. Fire-and-forget from `rebindPatchClient`; any
 *  failure clears to null and `activeRoot` shows an empty root, never B's own files.
 *  A late result is dropped if the player has since hopped to another machine. */
const refreshServedRoot = async (): Promise<void> => {
  const active = activeSession();
  const deps = networkClientDeps;
  const id = identity;
  if (
    active === undefined ||
    deps === undefined ||
    id === undefined ||
    !isCrossPlayerHop(active, currentEssid(), id.publicKeyHex)
  ) {
    setServedRoot(null);
    return;
  }
  const tree = await resolveCrossPlayerFs(deps, active.machineId);
  if (activeSession()?.machineId !== active.machineId) return;
  setServedRoot(tree === null ? null : { machineId: active.machineId, tree });
};

/** Backs `env.log.appendAuthLog`: posts the `su` event to the server (which
 *  stamps the UTC timestamp + formats the syslog line — the client never
 *  dictates game time), then reconciles the local journal and hints other tabs,
 *  exactly like `wrapWithRefetch` does for a write, so an immediate
 *  `cat /var/log/auth.log` reflects the new entry. */
const log: LogApi = {
  appendAuthLog: async (event) => {
    if (patchClientDeps === undefined) return;
    const result = await postAuthLog(patchClientDeps, event);
    if (!result.ok) return;
    await refetchPatches();
    syncChannel?.broadcast({ type: 'patches-changed', machineId: patchClientDeps.machineId });
  },
  // The line lands on the box that SERVED the fetch, so only fetching the player's OWN
  // address touches their journal — reconcile just that case, or an immediate
  // `cat /var/log/access.log` would not show the visit they just paid themselves.
  // Refetching after every fetch of a neighbour would re-pull an unchanged journal.
  appendAccessLog: async (fetched) => {
    const deps = patchClientDeps;
    if (deps === undefined) return;
    await recordLanFetch(deps, fetched);
    if (localAddress() !== fetched.target) return;
    await refetchPatches();
    syncChannel?.broadcast({ type: 'patches-changed', machineId: deps.machineId });
  },
};

/** Persist the editor buffer to the file currently open in `nano`. Resolves
 *  `isNew` from the live FS view (an absent target is a brand-new file, exactly
 *  like the `>` redirect path) and writes through the ACTIVE machine's patch API
 *  (wrapped with refetch, so an immediate `cat` reflects the save). Returns the
 *  `PatchResult` so the editor can surface a denied/failed save. A null editor or
 *  un-started game degrades to a `no_session` result rather than throwing. */
export const saveEditor = async (
  content: string,
  options?: { readonly overwriteUnseen?: boolean },
): Promise<PatchResult> => {
  const mode = overlayMode();
  const activePatchApi = patchApi;
  // Saving belongs to the editor: any other app on screen (or none) has no open
  // file to write, which is the same nothing-to-save answer as no session.
  if (mode === null || mode.kind !== 'nano' || activePatchApi === undefined) {
    return { ok: false, error: 'no_session' };
  }
  const fsView = createFsView(activeRoot(), { userType: requireSession().userType, cwd });
  const isNew = fsView.stat(mode.path) === null;
  const result = await activePatchApi.write(mode.path, content, {
    isNew,
    // Forcing the overwrite names NO base rather than a different one: an absent
    // base is the unconditional write `>` and `touch` already use, whereas any
    // base at all — including '' — would be compared and could be refused again.
    ...(options?.overwriteUnseen === true ? {} : { baseContent: mode.content }),
  });
  // Ctrl-O keeps the editor open, so what was just written becomes the base the
  // NEXT write-out is judged against — otherwise a second save would still claim
  // the pre-save content and be refused against the row this one just created.
  if (result.ok) setOverlayMode({ kind: 'nano', path: mode.path, content });
  return result;
};

/** What a server sends when it was asked for something it does not have. The
 *  browser is already open by the time a link is followed, so a 404 is a page to
 *  render rather than a reason to close — and the box logged the miss, exactly as
 *  it logged the hits either side of it. */
const NOT_FOUND_PAGE =
  '<h1>404 Not Found</h1><p>The requested URL was not found on this server.</p>';

/**
 * Follow a link from the page open in the browser, to the absolute `url` the
 * screen resolved it to.
 *
 * Goes through the SAME fetch the `lynx` command does, so a followed link reads the
 * tree a typed address would have reached and leaves the same one line behind on the
 * box that answered. A page and a 404 both move the reader (both were answers); a
 * host that never answered leaves them where they are with the reason, because
 * nothing was logged and nowhere was visited.
 *
 * Only the browser navigates the browser: with any other app on screen, or none,
 * there is no page to move on from and this opens nothing.
 */
export const followLink = async (url: string): Promise<FollowOutcome> => {
  const mode = overlayMode();
  if (mode === null || mode.kind !== 'lynx') {
    return { ok: false, alert: 'lynx: no page is open' };
  }
  const target = parseHttpUrl(url);
  if (target === null) {
    return { ok: false, alert: `lynx: (3) URL rejected: ${url}` };
  }
  // The command builds its whole environment to run; a follow needs the three
  // readers the fetch actually uses, all of which are already to hand here.
  const wlan0 = connectedWlan0({
    isOnline: () => isOnline(connectivity()),
    interfaces: () => [...connectivity().interfaces.values()],
  });
  if (wlan0 === null) {
    return { ok: false, alert: 'lynx: (7) Failed to connect — network is unreachable' };
  }

  // A link off another player's page points at their public address, not into this
  // player's LAN — so it goes back out the way the page itself came in. Resolving it
  // locally would answer with a 404 off the wrong box entirely.
  const page = isPublicIp(target.host)
    ? await fetchPageAcrossNetwork({
        program: 'lynx',
        url: target,
        fetchPublic: fetchPublicPageFn,
      })
    : fetchWebPage({
        root: activeRoot(),
        program: 'lynx',
        url: target,
        wlan0,
        appendAccessLog: (fetched) => log.appendAccessLog(fetched),
      });
  if (page.kind === 'unreachable') {
    return { ok: false, alert: page.failure.lines.map((line) => line.content).join(' ') };
  }

  setOverlayMode({
    kind: 'lynx',
    url,
    content: page.kind === 'page' ? page.content : NOT_FOUND_PAGE,
  });
  return { ok: true };
};

/** Whether the player's OWN workstation can boot — the brick check the boot
 *  screen runs on every entry. Resolves the own-box FS independent of any
 *  rehydrated hop session: the base seed with the OWN machine's shared journal
 *  (every writer's patches, including a cross-player attacker's `/boot`
 *  tombstone) replayed over it, then `canBoot`. Pinned to the base (own-box)
 *  session — "the box you're sitting at is always your workstation", never the
 *  remote you may be ssh'd into. Degrades to bootable before `startGame` wires
 *  identity/config (the boot gate guarantees that never happens in practice) and
 *  on any fetch failure (`fetchOwnPatches` returns []), so a transient error
 *  never bricks a healthy box — only a real tombstone in the journal does. */
export const resolveBootCheck = async (): Promise<BootCheck> => {
  const base = sessionStack()[0];
  if (base === undefined || identity === undefined || config === undefined) return { ok: true };
  const ownPatches = await fetchOwnPatches({
    identity,
    machineId: base.machineId,
    owner: base.username,
    tier: base.userType,
  });
  return canBoot(applyPatches(seedFs(config, identity), ownPatches));
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
  const wifi = generateWifi({ seedPubkeyHex: identity.publicKeyHex });
  setWifiNetworks(wifi);
  setConnectivity(restoreConnection(localStorage, cold));

  patchClientDeps = {
    identity,
    machineId: seed.machineId,
    owner: seed.username,
    tier: seed.userType,
  };
  sessionsClientDeps = { identity, machineId: seed.machineId };
  networkClientDeps = {
    identity,
    machineId: seed.machineId,
    gameConfig,
    leaseCache: lanLeaseCacheIn(localStorage),
  };
  patchApi = wrapWithRefetch(createPatchApi(patchClientDeps));

  setCwd(homePathFor(gameConfig.username));
  setScrollback([]);
  setPatches([]);
  setCommandHistory([]);
  setHistoryNav(idleNav());
  // A new game comes up at a live prompt: unwind any prompt the previous one was
  // blocked on (rejecting it, so the orphaned command doesn't hang) and drop the
  // busy bar, or the fresh terminal would open masked or spinning.
  cancelPrompt();
  setRunningCommand(null);

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

  // Rebuild the hop chain so a `su` elevation survives a refresh.
  void rehydrateSessions(seed);
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
  const fsView = createFsView(activeRoot(), {
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

/** Serializes command execution: a shell runs ONE command at a time. Each
 *  submission chains after the previous so a fast-typed (or programmatic) second
 *  command runs only AFTER the first fully completes — including its async server
 *  refresh — instead of snapshotting a stale FS view mid-refresh (the
 *  `root: activeRoot()` env is a point-in-time snapshot). Errors are isolated so
 *  one failed command can't poison the chain. Interactive prompts (su/ssh
 *  password) resolve through `submitPrompt`, never here, so they stay responsive
 *  while a command runs. */
let commandChain: Promise<void> = Promise.resolve();

export const runInput = (): Promise<void> => {
  // Capture + clear the input at SUBMIT time so the box frees up immediately and
  // a typed-ahead line is queued (not lost); the echo + run happen in chain order.
  const line = input();
  if (line.trim()) setCommandHistory((previous) => [...previous, line]);
  setHistoryNav(idleNav());
  setInput('');
  const run = commandChain.then(() => executeLine(line));
  // The sequencing chain swallows errors so the NEXT queued command still runs;
  // the returned promise still reflects THIS command's outcome for callers.
  commandChain = run.catch(() => undefined);
  return run;
};

/** The command name to label the busy bar with — the first word of the line, or
 *  null for a blank submission (nothing ran, so nothing is busy). */
const commandNameOf = (line: string): string | null => {
  const name = line.trim().split(/\s+/)[0];
  return name === undefined || name === '' ? null : name;
};

const executeLine = async (line: string): Promise<void> => {
  // Session + patch client are read at EXECUTION time (chain order), so a queued
  // command sees the state left by the one before it (e.g. an `ssh` hop's session).
  const currentSession = requireSession();
  const activePatchApi = patchApi;
  if (activePatchApi === undefined) throw new Error('startGame must be called before runInput');

  setScrollback((previous) => [
    ...previous,
    inFtpSession()
      ? { kind: 'prompt', content: `${FTP_PROMPT}${line}` }
      : commandEchoLine(
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
  setRunningCommand(commandNameOf(line));

  const env = buildCommandEnv({
    identity: requireIdentity(),
    session: currentSession,
    hostname: promptHost(),
    root: activeRoot(),
    cwd,
    onCwdChange: setCwd,
    patches: activePatchApi,
    log,
    connectivity,
    onInterfaceChange: setInterface,
    wifiNetworks,
    rescanWifi,
    signal: controller.signal,
    prompt: requestPrompt,
    onPushSession: pushSession,
    onSshAuthenticate: sshAuthenticate,
    onFtpAuthenticate: ftpAuthenticate,
    onFtpAuthenticatePublic: ftpAuthenticatePublic,
    onFtpEnter: enterFtpSession,
    onFtpLeave: leaveFtpSession,
    ...ftpBinding(),
    onScpAuthenticate: scpAuthenticate,
    onScpWrite: writeToScpTarget,
    onScpRead: readFromScpTarget,
    onScpEnd: endScpSession,
    onSshAuthenticatePublic: sshAuthenticatePublic,
    onSshAuthenticateSameLan: sshAuthenticateSameLan,
    onSshAuthenticateInnerGateway: sshAuthenticateInnerGateway,
    onSuElevate: suElevate,
    onHydraCrack: hydraCrack,
    onHydraCrackPublic: hydraCrackPublic,
    onHydraCrackInnerGateway: hydraCrackInnerGateway,
    onScanRecord: recordScanFn,
    onScanRecordDeep: recordDeepScanFn,
    onScanResolvePublic: resolvePublicFn,
    onScanResolveInnerGateway: resolveInnerGatewayFn,
    onScanResolveOccupants: resolveOccupantsFn,
    onScanResolveOccupiedEssids: resolveOccupiedEssidsFn,
    onHttpFetchPublic: fetchPublicPageFn,
    onHttpSweepPublic: sweepPublicPathsFn,
    onHomeNetworkJoin: joinHomeNetworkFn,
    onHomeNetworkLeave: leaveHomeNetworkFn,
    // The sessions below the active one — what `exit` consults to decide
    // whether there's somewhere to drop back to (empty at the base shell).
    hopChain: sessionStack().slice(0, -1),
    onPopSession: popSession,
    onResetGame: resetGame,
    // `reset` prints its danger warning mid-command via `env.output`, before the
    // confirm prompt — append it straight to scrollback.
    onOutputLine: (line) => setScrollback((previous) => [...previous, line]),
  });

  try {
    // While an ftp session is held the line is answered by the ftp command map, NOT
    // the registry. This refusal is the security boundary of the sub-shell: falling
    // through would run the OUTER shell's `ls`/`cat`/`rm` against the machine the
    // player is standing on while they believe they are addressing the remote.
    const result = inFtpSession()
      ? await runFtpLine(env, line)
      : await runCommandLine(env, line, commandRegistry);
    if (result.kind === 'sync') {
      setScrollback((previous) => [...previous, ...result.lines]);
      return;
    }
    if (result.kind === 'mode_change') {
      // Only the apps with a screen open one; the rest (nc/ftp/mysql/redis) stay
      // no-ops until theirs land. The narrow is load-bearing — it is what types
      // the mode as an `OverlayMode` — so widening it before a screen exists
      // fails to compile rather than opening a blank overlay.
      const { mode } = result;
      if (mode.kind === 'nano' || mode.kind === 'lynx') setOverlayMode(mode);
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
    setRunningCommand(null);
  }
};

const requireIdentity = (): Identity => {
  if (identity === undefined) throw new Error('startGame must be called before using the terminal');
  return identity;
};
