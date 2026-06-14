/**
 * mockCommandEnv — the test-side `CommandEnv` factory.
 *
 * Returns a complete CommandEnv with sensible defaults. Tests override only
 * the fields they care about:
 *
 *     const env = mockCommandEnv({ fs: mockFsViewFromTree(myTree) });
 *
 * Unused sub-API methods throw "not implemented in spike mock" if invoked,
 * making accidental dependencies loud rather than silent.
 */

import {
  asEpochMs,
  asMachineId,
  asNetworkAddress,
  asPlayerKeyHex,
} from '../../core/types';
import type {
  CommandEnv,
  HomeNetworkApi,
  Identity,
  LogApi,
  NetworkView,
  OutputSink,
  PatchApi,
  RemoteApi,
  ScanApi,
  Session,
  SshApi,
} from '../../core/commands/types';
import { basename, dirname } from '../../core/filesystem/path';
import { canWrite } from '../../core/filesystem/walker';
import { createFsView } from '../../core/filesystem/fsView';
import { isOnline, type ConnectivityState } from '../../core/network/interfaces';
import { buildDirectory } from './filesystem';

const NOT_IMPLEMENTED =
  (method: string) =>
  <T>(): T => {
    throw new Error(`mockCommandEnv: ${method} not implemented in spike mock`);
  };

// ---- Default factories for each sub-API ----

export const mockIdentity = (overrides: Partial<Identity> = {}): Identity => ({
  publicKeyHex: asPlayerKeyHex('a'.repeat(64)),
  privateKeyHex: 'b'.repeat(64),
  ...overrides,
});

export const mockSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-mock-0001',
  playerKey: asPlayerKeyHex('a'.repeat(64)),
  machineId: asMachineId('localhost'),
  username: 'alice',
  userType: 'user',
  kind: 'su',
  createdAt: asEpochMs(0),
  ...overrides,
});

/** Build an FsView backed by a static Directory tree, with walker-enforced
 *  perms. Aliased to the production builder so tests and the UI share one
 *  implementation — no drift between what tests prove and what ships. */
export const mockFsViewFromTree = createFsView;

export const mockOutputSink = (): OutputSink => ({
  text: NOT_IMPLEMENTED('output.text'),
  error: NOT_IMPLEMENTED('output.error'),
  dim: NOT_IMPLEMENTED('output.dim'),
});

export const mockPatchApi = (): PatchApi => ({
  write: NOT_IMPLEMENTED('patches.write'),
  remove: NOT_IMPLEMENTED('patches.remove'),
  mkdir: NOT_IMPLEMENTED('patches.mkdir'),
});

export const mockNetworkView = (overrides: Partial<NetworkView> = {}): NetworkView => ({
  currentMachine: () => asMachineId('localhost'),
  findMachineByAddress: () => null,
  resolveDns: () => null,
  interfaces: () => [],
  isOnline: () => false,
  wifiNetworks: () => [],
  ...overrides,
});

/** A NetworkView whose `interfaces()`/`isOnline()` reflect a real
 *  `ConnectivityState` — so command tests drive the production read path. */
export const mockNetworkViewFromConnectivity = (state: ConnectivityState): NetworkView =>
  mockNetworkView({
    interfaces: () => [...state.interfaces.values()],
    isOnline: () => isOnline(state),
  });

export const mockRemoteApi = (): RemoteApi => ({
  listPatches: NOT_IMPLEMENTED('remote.listPatches'),
});

export const mockLogApi = (): LogApi => ({
  appendAuthLog: async () => undefined,
  appendAccessLog: async () => undefined,
});

/** A home-network join that resolves to a fixed assignment. Command tests
 *  override `join` to capture the requested ESSID or vary the address. */
export const mockHomeNetwork = (overrides: Partial<HomeNetworkApi> = {}): HomeNetworkApi => ({
  join: async () => ({ localIp: '192.168.0.2', publicIp: '203.0.113.7', hostname: 'test-host' }),
  ...overrides,
});

/** A remote-login seam whose `authenticate` throws unless a test overrides it —
 *  `ssh` tests inject a stub returning a controlled `RemoteAuthResult`. */
export const mockSshApi = (overrides: Partial<SshApi> = {}): SshApi => ({
  authenticate: NOT_IMPLEMENTED('ssh.authenticate'),
  authenticatePublic: NOT_IMPLEMENTED('ssh.authenticatePublic'),
  ...overrides,
});

/** A scan seam whose `record` no-ops by default (logging is best-effort and
 *  fire-and-forget, so it must not throw the way a load-bearing seam does) and
 *  whose `resolvePublic` throws unless overridden (it is load-bearing — its result
 *  drives scan output). `nmap` tests override `record` to capture a recorded scan,
 *  or `resolvePublic` to stub a cross-player resolution. */
export const mockScanApi = (overrides: Partial<ScanApi> = {}): ScanApi => ({
  record: async () => undefined,
  resolvePublic: NOT_IMPLEMENTED('scan.resolvePublic'),
  ...overrides,
});

// ---- The factory ----

export const mockCommandEnv = (overrides: Partial<CommandEnv> = {}): CommandEnv => ({
  identity: mockIdentity(),
  session: mockSession(),
  hopChain: [],
  hostname: 'workstation',
  now: () => asEpochMs(0),
  fs: mockFsViewFromTree(buildDirectory({})),
  network: mockNetworkView(),
  output: mockOutputSink(),
  patches: mockPatchApi(),
  remote: mockRemoteApi(),
  log: mockLogApi(),
  homeNetwork: mockHomeNetwork(),
  ssh: mockSshApi(),
  scan: mockScanApi(),
  setCwd: () => undefined,
  setInterface: () => undefined,
  prompt: NOT_IMPLEMENTED('prompt'),
  pushSession: () => undefined,
  popSession: () => undefined,
  sleep: () => Promise.resolve(),
  signal: new AbortController().signal,
  ...overrides,
});

// Silence "exported but unused" for helpers tests may reach for later.
export { canWrite, asNetworkAddress, dirname, basename };
