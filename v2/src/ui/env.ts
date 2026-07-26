/**
 * buildCommandEnv — wire a `CommandEnv` from UI state + adapters.
 *
 * This is the one factory the UI constructs (per core-contracts). It is a
 * pure function: caller passes the current identity, session, FS tree, and
 * cwd (read out of signals at call time); the command sees only `env`.
 *
 * Scope: `fs` and `patches` are wired for real (the patched FS view and the
 * server-backed PatchApi the caller injects). Streaming output and cross-player
 * APIs remain loud stubs until a command actually needs them — silent no-ops
 * would hide missing wiring.
 */

import { asEpochMs, type AbsPath } from '../core/types';
import type {
  CommandEnv,
  HomeNetworkApi,
  HopChain,
  Identity,
  LogApi,
  NetworkView,
  OutputSink,
  PatchApi,
  RemoteApi,
  ScanApi,
  Session,
  SshApi,
  SuApi,
  TerminalLine,
} from '../core/commands/types';
import type { Directory } from '../core/filesystem/types';
import type { WifiNetwork } from '../core/network/wifi';
import { createFsView } from '../core/filesystem/fsView';
import {
  isOnline,
  type ConnectivityState,
  type NetworkInterface,
} from '../core/network/interfaces';
import { abortableSleep } from './sleep';

export type BuildCommandEnvArgs = {
  readonly identity: Identity;
  readonly session: Session;
  /** The machine's short hostname (the player's `GameConfig.machineName`).
   *  Optional here for terse test setups — defaults to `workstation` (the seed
   *  config's name); the UI always passes the real `promptHost()`. */
  readonly hostname?: string;
  readonly root: Directory;
  /** Reader function — called every time `fs.cwd()` runs. Lets the UI's cwd
   *  signal flow through without rebuilding the env per command. */
  readonly cwd: () => AbsPath;
  /** Writer — `cd` calls this to mutate the UI's cwd signal. The UI defines
   *  the storage; `core/` only knows there's a setter. */
  readonly onCwdChange: (path: AbsPath) => void;
  /** The server-backed mutation API (write/remove/mkdir). Injected by the UI
   *  so `env.ts` stays free of the adapter + network concerns. */
  readonly patches: PatchApi;
  /** The server-backed log API (auth.log append). Injected like `patches` — the
   *  UI owns the signed post + journal refetch; `env.ts` stays adapter-free. */
  readonly log: LogApi;
  /** Reader for the current machine's connectivity state — called whenever
   *  `network.interfaces()`/`isOnline()` run, so the UI's connectivity signal
   *  flows through without rebuilding the env per command. */
  readonly connectivity: () => ConnectivityState;
  /** Writer — `airmon`/`nmcli` call this (via `env.setInterface`) to replace
   *  one interface. The UI owns the connectivity signal; `core/` only knows
   *  there's a setter. */
  readonly onInterfaceChange: (name: string, iface: NetworkInterface) => void;
  /** Reader for the WiFi access points in range — the latest scan roll held in
   *  `ui/state`, read by `aircrack`/`nmcli` after `airdump` refreshes it. */
  readonly wifiNetworks: () => readonly WifiNetwork[];
  /** Re-roll the scan, injecting the given occupied ESSIDs — backs
   *  `network.rescanWifi`. The UI owns the per-scan counter + the wifi signal:
   *  it re-draws, stores the roll (so `wifiNetworks` reflects it), and returns it. */
  readonly rescanWifi: (occupiedEssids: readonly string[]) => readonly WifiNetwork[];
  /** The run's abort signal, owned by the UI (`runInput` makes one per command
   *  so Ctrl-C can abort it). Backs both `env.signal` and the abort-aware
   *  `env.sleep`, so aborting stops a streamed command mid-flight. */
  readonly signal: AbortSignal;
  /** The general interactive-input primitive — backs `env.prompt`. The UI shows
   *  a (optionally masked) prompt and resolves with the submitted line, or
   *  rejects on Ctrl-C. Reused by `su` now; ssh/scp/ftp/… later. */
  readonly prompt: (opts: {
    readonly message: string;
    readonly masked: boolean;
  }) => Promise<string>;
  /** Writer — `su` (and later ssh/nc) call this (via `env.pushSession`) to push
   *  a new active session onto the stack. The UI owns the session signal. */
  readonly onPushSession: (session: Session) => void;
  /** The sessions BELOW the active one — the return stack `exit` consults to
   *  decide whether there's somewhere to drop back to. Empty at the base login
   *  session. Read out of the session-stack signal at call time. */
  readonly hopChain: HopChain;
  /** Writer — `exit` calls this (via `env.popSession`) to drop the active
   *  session and return to the one beneath it. The UI restores the previous
   *  tier/prompt and working directory. */
  readonly onPopSession: () => void;
  /** The remote-login seam — backs `env.ssh.authenticate`. The UI wires it to the
   *  `authCreateServerSession` adapter (signed `authCreateSession` round-trip).
   *  Optional here for terse test setups; the UI always passes the real one. */
  readonly onSshAuthenticate?: SshApi['authenticate'];
  /** The cross-player remote-login seam — backs `env.ssh.authenticatePublic`. The UI
   *  wires it to the `authCreateServerSessionPublic` adapter (signed
   *  `authCreateSessionPublic` round-trip). Optional here for terse test setups. */
  readonly onSshAuthenticatePublic?: SshApi['authenticatePublic'];
  /** The same-LAN remote-login seam — backs `env.ssh.authenticateSameLan`. The UI wires
   *  it to the `authCreateServerSessionSameLan` adapter (signed `authCreateSessionSameLan`
   *  round-trip). Optional here for terse test setups; the UI always passes the real one. */
  readonly onSshAuthenticateSameLan?: SshApi['authenticateSameLan'];
  /** The inner-gateway forward-login seam — backs `env.ssh.authenticateInnerGateway`. The
   *  UI wires it to the `authCreateServerSessionInnerGateway` adapter (signed
   *  `authCreateSessionInnerGateway` round-trip). Optional here for terse test setups. */
  readonly onSshAuthenticateInnerGateway?: SshApi['authenticateInnerGateway'];
  /** The cross-player `su`-elevation seam — backs `env.su.elevate`. The UI wires it
   *  to the `authElevateServerSession` adapter (signed `suElevate` round-trip).
   *  Optional here: only a cross-player hop's `su` calls it, so own-box/test setups
   *  leave it unwired (a foreign-box `su` without it surfaces the missing wiring). */
  readonly onSuElevate?: SuApi['elevate'];
  /** The scan-logging seam — backs `env.scan.record`. The UI wires it to the
   *  `recordScan` adapter (signed `nmapScan` round-trip). Optional here for terse
   *  test setups; the UI always passes the real one. */
  readonly onScanRecord?: ScanApi['record'];
  /** The deep-pivot scan-logging seam — backs `env.scan.recordDeep`. The UI wires it
   *  to the `recordDeepScan` adapter (signed `nmapScanDeep` round-trip). Optional here
   *  for terse test setups; the UI always passes the real one. */
  readonly onScanRecordDeep?: ScanApi['recordDeep'];
  /** The cross-player public-IP resolution seam — backs `env.scan.resolvePublic`.
   *  The UI wires it to the `resolvePublicScan` adapter (signed round-trip).
   *  Optional here for terse test setups; the UI always passes the real one. */
  readonly onScanResolvePublic?: ScanApi['resolvePublic'];
  /** The inner-gateway own-LAN resolution seam — backs `env.scan.resolveInnerGateway`.
   *  The UI wires it to the `resolveInnerGateway` adapter (signed round-trip). Optional
   *  here for terse test setups; the UI always passes the real one. */
  readonly onScanResolveInnerGateway?: ScanApi['resolveInnerGateway'];
  /** The same-LAN occupant-read seam — backs `env.scan.resolveOccupants`. The UI wires
   *  it to the `resolveOccupants` adapter (signed round-trip). Optional here: when
   *  absent it defaults to an empty list, since the read is ADDITIVE (an own-LAN scan
   *  still works, it just shows no fellow players) — like `homeNetwork.join`'s fallback. */
  readonly onScanResolveOccupants?: ScanApi['resolveOccupants'];
  /** The organic-discovery occupied-ESSID-names seam — backs
   *  `env.scan.resolveOccupiedEssids`. The UI wires it to the `resolveOccupiedEssids`
   *  adapter (signed round-trip). Optional here: absent, it defaults to an empty list,
   *  since injection is ADDITIVE (a scan still works, it just discovers nothing). */
  readonly onScanResolveOccupiedEssids?: ScanApi['resolveOccupiedEssids'];
  /** The home-network join seam — backs `env.homeNetwork.join`. The UI wires it to
   *  the `joinHomeNetwork` adapter, which registers the network server-side and carries
   *  back the address the server leased. Optional here: when absent nothing can ISSUE an
   *  address, so the join yields null and the connect reports it. */
  readonly onHomeNetworkJoin?: HomeNetworkApi['join'];
  /** The home-network leave seam — backs `env.homeNetwork.leave`. The UI wires it to
   *  the `leaveHomeNetwork` adapter (fire-and-forget occupancy delete). Optional here:
   *  when absent, leave is a no-op (terse test setups + pre-server callers). */
  readonly onHomeNetworkLeave?: HomeNetworkApi['leave'];
  /** A line emitted mid-command via `env.output` — the UI appends it to scrollback.
   *  `reset` is the first consumer (its danger warning prints before the prompt).
   *  Optional: terse test setups that don't drive `env.output` leave it unwired,
   *  so any accidental `env.output` use surfaces as the loud stub. */
  readonly onOutputLine?: (line: TerminalLine) => void;
  /** The game-reset seam — backs `env.resetGame`. The UI wires it to wipe all
   *  client-persisted state and reload to the intro screen. Optional: only `reset`
   *  fires it, so other setups leave it unwired (a stray call hits the loud stub). */
  readonly onResetGame?: () => void;
};

const notWired = (method: string) => (): never => {
  throw new Error(`buildCommandEnv: ${method} is not wired in the terminal slice`);
};

const networkView = (
  session: Session,
  connectivity: () => ConnectivityState,
  wifiNetworks: () => readonly WifiNetwork[],
  rescanWifi: (occupiedEssids: readonly string[]) => readonly WifiNetwork[],
): NetworkView => ({
  currentMachine: () => session.machineId,
  findMachineByAddress: () => null,
  resolveDns: () => null,
  interfaces: () => [...connectivity().interfaces.values()],
  isOnline: () => isOnline(connectivity()),
  wifiNetworks,
  rescanWifi,
});

const outputStub = (): OutputSink => ({
  text: notWired('output.text'),
  error: notWired('output.error'),
  dim: notWired('output.dim'),
});

/** A live `OutputSink` that forwards each line (tagged with its kind) to the UI's
 *  scrollback appender. Used when the UI wires `onOutputLine` (the real terminal);
 *  absent it, callers get `outputStub` so missing wiring stays loud. */
const outputSinkFrom = (emit: (line: TerminalLine) => void): OutputSink => ({
  text: (content) => emit({ kind: 'text', content }),
  error: (content) => emit({ kind: 'error', content }),
  dim: (content) => emit({ kind: 'dim', content }),
});

const remoteStub = (): RemoteApi => ({ listPatches: notWired('remote.listPatches') });

export const buildCommandEnv = (args: BuildCommandEnvArgs): CommandEnv => ({
  identity: args.identity,
  session: args.session,
  hopChain: args.hopChain,
  hostname: args.hostname ?? 'workstation',
  now: () => asEpochMs(Date.now()),
  fs: createFsView(args.root, { userType: args.session.userType, cwd: args.cwd }),
  network: networkView(args.session, args.connectivity, args.wifiNetworks, args.rescanWifi),
  output: args.onOutputLine ? outputSinkFrom(args.onOutputLine) : outputStub(),
  patches: args.patches,
  remote: remoteStub(),
  log: args.log,
  // The home-network join: the UI wires `onHomeNetworkJoin` to the `joinHomeNetwork`
  // adapter, which registers the network server-side AND carries back the address the
  // server leased this player. Absent that seam nothing can issue an address, so the
  // join yields null and `nmcli connect` reports the failure — a client that made one
  // up would be the second allocator the lease exists to eliminate.
  homeNetwork: {
    join: args.onHomeNetworkJoin ?? (() => Promise.resolve(null)),
    // Leave is fire-and-forget occupancy cleanup; absent the server seam it's a no-op
    // (the local disconnect still clears `wlan0`).
    leave: args.onHomeNetworkLeave ?? (() => undefined),
  },
  ssh: {
    authenticate: args.onSshAuthenticate ?? notWired('ssh.authenticate'),
    authenticatePublic: args.onSshAuthenticatePublic ?? notWired('ssh.authenticatePublic'),
    authenticateSameLan: args.onSshAuthenticateSameLan ?? notWired('ssh.authenticateSameLan'),
    authenticateInnerGateway:
      args.onSshAuthenticateInnerGateway ?? notWired('ssh.authenticateInnerGateway'),
  },
  su: {
    elevate: args.onSuElevate ?? notWired('su.elevate'),
  },
  scan: {
    record: args.onScanRecord ?? notWired('scan.record'),
    recordDeep: args.onScanRecordDeep ?? notWired('scan.recordDeep'),
    resolvePublic: args.onScanResolvePublic ?? notWired('scan.resolvePublic'),
    resolveInnerGateway: args.onScanResolveInnerGateway ?? notWired('scan.resolveInnerGateway'),
    // Additive read: absent the seam, the scan still runs with no fellow occupants.
    resolveOccupants: args.onScanResolveOccupants ?? (() => Promise.resolve([])),
    // Additive read: absent the seam, the scan discovers no occupied networks.
    resolveOccupiedEssids: args.onScanResolveOccupiedEssids ?? (() => Promise.resolve([])),
  },
  setCwd: args.onCwdChange,
  setInterface: args.onInterfaceChange,
  prompt: args.prompt,
  pushSession: args.onPushSession,
  popSession: args.onPopSession,
  resetGame: args.onResetGame ?? notWired('resetGame'),
  // The UI owns the run's signal; both the abort flag commands read and the
  // pacing sleep observe it, so Ctrl-C stops a streamed command mid-flight.
  sleep: (ms) => abortableSleep(args.signal, ms),
  signal: args.signal,
});
