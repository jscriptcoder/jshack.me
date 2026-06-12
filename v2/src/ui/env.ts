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
} from '../core/commands/types';
import type { Directory } from '../core/filesystem/types';
import type { WifiNetwork } from '../core/network/wifi';
import { createFsView } from '../core/filesystem/fsView';
import { isOnline, type ConnectivityState, type NetworkInterface } from '../core/network/interfaces';
import { assignHomeNetwork } from '../core/network/homeNetwork';
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
  /** Reader for the seeded WiFi access points in range — called whenever
   *  `network.wifiNetworks()` runs (airdump/aircrack). Memoized once per
   *  identity in `ui/state`. */
  readonly wifiNetworks: () => readonly WifiNetwork[];
  /** The run's abort signal, owned by the UI (`runInput` makes one per command
   *  so Ctrl-C can abort it). Backs both `env.signal` and the abort-aware
   *  `env.sleep`, so aborting stops a streamed command mid-flight. */
  readonly signal: AbortSignal;
  /** The general interactive-input primitive — backs `env.prompt`. The UI shows
   *  a (optionally masked) prompt and resolves with the submitted line, or
   *  rejects on Ctrl-C. Reused by `su` now; ssh/scp/ftp/… later. */
  readonly prompt: (opts: { readonly message: string; readonly masked: boolean }) => Promise<string>;
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
  /** The scan-logging seam — backs `env.scan.record`. The UI wires it to the
   *  `recordScan` adapter (signed `nmapScan` round-trip). Optional here for terse
   *  test setups; the UI always passes the real one. */
  readonly onScanRecord?: ScanApi['record'];
};

const notWired = (method: string) => (): never => {
  throw new Error(`buildCommandEnv: ${method} is not wired in the terminal slice`);
};

const networkView = (
  session: Session,
  connectivity: () => ConnectivityState,
  wifiNetworks: () => readonly WifiNetwork[],
): NetworkView => ({
  currentMachine: () => session.machineId,
  findMachineByAddress: () => null,
  resolveDns: () => null,
  interfaces: () => [...connectivity().interfaces.values()],
  isOnline: () => isOnline(connectivity()),
  wifiNetworks,
});

const outputStub = (): OutputSink => ({
  text: notWired('output.text'),
  error: notWired('output.error'),
  dim: notWired('output.dim'),
});

const remoteStub = (): RemoteApi => ({ listPatches: notWired('remote.listPatches') });

export const buildCommandEnv = (args: BuildCommandEnvArgs): CommandEnv => ({
  identity: args.identity,
  session: args.session,
  hopChain: args.hopChain,
  hostname: args.hostname ?? 'workstation',
  now: () => asEpochMs(Date.now()),
  fs: createFsView(args.root, { userType: args.session.userType, cwd: args.cwd }),
  network: networkView(args.session, args.connectivity, args.wifiNetworks),
  output: outputStub(),
  patches: args.patches,
  remote: remoteStub(),
  log: args.log,
  // The home-network join is local-deterministic today (seeded from identity),
  // the documented future server boundary — `Promise`-shaped so the swap to a
  // real `/api/join-home-network` round-trip is the only change here.
  homeNetwork: { join: (essid) => Promise.resolve(assignHomeNetwork(args.identity.publicKeyHex, essid)) },
  ssh: { authenticate: args.onSshAuthenticate ?? notWired('ssh.authenticate') },
  scan: { record: args.onScanRecord ?? notWired('scan.record') },
  setCwd: args.onCwdChange,
  setInterface: args.onInterfaceChange,
  prompt: args.prompt,
  pushSession: args.onPushSession,
  popSession: args.onPopSession,
  // The UI owns the run's signal; both the abort flag commands read and the
  // pacing sleep observe it, so Ctrl-C stops a streamed command mid-flight.
  sleep: (ms) => abortableSleep(args.signal, ms),
  signal: args.signal,
});
