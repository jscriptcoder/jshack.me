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

import { asEpochMs, asGameTime, type AbsPath } from '../core/types';
import type {
  CommandEnv,
  Identity,
  LogApi,
  NetworkView,
  OutputSink,
  PatchApi,
  RemoteApi,
  Session,
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

const logStub = (): LogApi => ({
  appendAuthLog: async () => undefined,
  appendAccessLog: async () => undefined,
});

export const buildCommandEnv = (args: BuildCommandEnvArgs): CommandEnv => ({
  identity: args.identity,
  session: args.session,
  hopChain: [],
  gameTime: () => asGameTime(0),
  now: () => asEpochMs(Date.now()),
  fs: createFsView(args.root, { userType: args.session.userType, cwd: args.cwd }),
  network: networkView(args.session, args.connectivity, args.wifiNetworks),
  output: outputStub(),
  patches: args.patches,
  remote: remoteStub(),
  log: logStub(),
  // The home-network join is local-deterministic today (seeded from identity),
  // the documented future server boundary — `Promise`-shaped so the swap to a
  // real `/api/join-home-network` round-trip is the only change here.
  homeNetwork: { join: (essid) => Promise.resolve(assignHomeNetwork(args.identity.publicKeyHex, essid)) },
  setCwd: args.onCwdChange,
  setInterface: args.onInterfaceChange,
  // The UI owns the run's signal; both the abort flag commands read and the
  // pacing sleep observe it, so Ctrl-C stops a streamed command mid-flight.
  sleep: (ms) => abortableSleep(args.signal, ms),
  signal: args.signal,
});
