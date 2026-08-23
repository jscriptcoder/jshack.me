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

import { asEpochMs, asMachineId, asNetworkAddress, asPlayerKeyHex } from '../../core/types';
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
  FtpApi,
  MysqlApi,
  ScpApi,
  SshApi,
  NcApi,
  SuApi,
  HydraApi,
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

export const mockPatchApi = (overrides: Partial<PatchApi> = {}): PatchApi => ({
  write: NOT_IMPLEMENTED('patches.write'),
  remove: NOT_IMPLEMENTED('patches.remove'),
  mkdir: NOT_IMPLEMENTED('patches.mkdir'),
  ...overrides,
});

export const mockNetworkView = (overrides: Partial<NetworkView> = {}): NetworkView => ({
  currentMachine: () => asMachineId('localhost'),
  findMachineByAddress: () => null,
  resolveDns: () => null,
  interfaces: () => [],
  isOnline: () => false,
  wifiNetworks: () => [],
  rescanWifi: () => [],
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
  // Load-bearing (its result IS the fetched page), so it throws until a test stubs the
  // resolution — an own-LAN fetch must never reach it.
  fetchPublic: NOT_IMPLEMENTED('remote.fetchPublic'),
  // Load-bearing for the same reason: the far side's answer IS the sweep, so an
  // own-LAN sweep reaching here is a bug a test must see rather than absorb.
  sweepPublic: NOT_IMPLEMENTED('remote.sweepPublic'),
});

export const mockLogApi = (): LogApi => ({
  appendAuthLog: async () => undefined,
  appendAccessLog: async () => undefined,
});

/** A home-network seam whose `join` resolves to a fixed assignment and whose
 *  `leave` is a no-op. Command tests override either to capture the requested ESSID
 *  or vary the address. */
export const mockHomeNetwork = (overrides: Partial<HomeNetworkApi> = {}): HomeNetworkApi => ({
  join: async () => ({ localIp: '192.168.0.2', hostname: 'test-host' }),
  leave: () => undefined,
  ...overrides,
});

/** A remote-login seam whose `authenticate` throws unless a test overrides it —
 *  `ssh` tests inject a stub returning a controlled `RemoteAuthResult`. */
export const mockSshApi = (overrides: Partial<SshApi> = {}): SshApi => ({
  authenticate: NOT_IMPLEMENTED('ssh.authenticate'),
  authenticatePublic: NOT_IMPLEMENTED('ssh.authenticatePublic'),
  authenticateSameLan: NOT_IMPLEMENTED('ssh.authenticateSameLan'),
  authenticateInnerGateway: NOT_IMPLEMENTED('ssh.authenticateInnerGateway'),
  ...overrides,
});

/** The backdoor seam. Loud when unstubbed for the same reason ssh's is: a connect
 *  that silently refused would read as "no listener there", which is a different
 *  fact about the world than "this test forgot to wire the door". */
export const mockNcApi = (overrides: Partial<NcApi> = {}): NcApi => ({
  connect: NOT_IMPLEMENTED('nc.connect'),
  connectPublic: NOT_IMPLEMENTED('nc.connectPublic'),
  connectSameLan: NOT_IMPLEMENTED('nc.connectSameLan'),
  connectInnerGateway: NOT_IMPLEMENTED('nc.connectInnerGateway'),
  ...overrides,
});

/** The ftp door seam. `authenticate` throws unless a test stubs it — an unstubbed
 *  login must be loud rather than silently refusing, which reads as a bad password.
 *  `enter`/`leave` default to no-ops: most tests care what the command DID, not that
 *  a UI signal moved, and the ones that care pass spies. */
export const mockFtpApi = (overrides: Partial<FtpApi> = {}): FtpApi => ({
  authenticate: NOT_IMPLEMENTED('ftp.authenticate'),
  // Load-bearing for the same reason as `authenticate`: an unstubbed cross-network
  // login must be loud, not silently refuse — which reads as a bad password.
  authenticatePublic: NOT_IMPLEMENTED('ftp.authenticatePublic'),
  enter: () => undefined,
  leave: () => undefined,
  // An empty remote by default — the same thing production shows when no session
  // is held, so a test that browses without building a remote sees nothing rather
  // than the origin's tree wearing the remote's name.
  fs: mockFsViewFromTree(buildDirectory({})),
  setCwd: () => undefined,
  // Load-bearing like `authenticate`: a `put` whose write silently succeeded would
  // report a transfer no box received, so an unstubbed write must be loud.
  write: NOT_IMPLEMENTED('ftp.write'),
  // Fire-and-forget in production, so a no-op default keeps every test that does
  // not care about the defender's log unaffected; the ones that care pass a spy.
  recordTransfer: () => undefined,
  ...overrides,
});

/** The database door seam. Loud when unstubbed for the same reason ssh's and ftp's
 *  are: a connect that silently refused would read as a rejected credential, which is
 *  a different fact about the world than a test that forgot to wire the door. */
export const mockMysqlApi = (overrides: Partial<MysqlApi> = {}): MysqlApi => ({
  connect: NOT_IMPLEMENTED('mysql.connect'),
  run: NOT_IMPLEMENTED('mysql.run'),
  // No-ops by default, as ftp's are: holding and dropping the prompt is UI state,
  // and a test that does not care which terminal mode it left behind should not
  // have to stub one.
  enter: () => undefined,
  leave: () => undefined,
  ...overrides,
});

/** The transfer door seam. `authenticate` and `write` throw unless a test stubs
 *  them, for the same reason ftp's do: a transfer that silently reported success
 *  while nothing left the machine is the one failure this command must never fake.
 *  `end` defaults to a no-op — most tests care that the file moved, and the ones
 *  that care the row was closed pass a spy. */
export const mockScpApi = (overrides: Partial<ScpApi> = {}): ScpApi => ({
  authenticate: NOT_IMPLEMENTED('scp.authenticate'),
  // Load-bearing for the same reason as the own-LAN login: an unstubbed cross-network
  // login must be loud, not silently refuse — which reads as a bad password.
  authenticatePublic: NOT_IMPLEMENTED('scp.authenticatePublic'),
  write: NOT_IMPLEMENTED('scp.write'),
  // Load-bearing like the other two: its result IS the file, so an unstubbed read
  // must be loud rather than handing back an empty one that reads as a real file.
  read: NOT_IMPLEMENTED('scp.read'),
  end: () => undefined,
  ...overrides,
});

/** A su-elevation seam whose `elevate` throws unless a test overrides it — `su`'s
 *  cross-player tests inject a stub returning a controlled `RemoteAuthResult`. Local
 *  `su` (own box / NPC hop) never touches it, so a throwing default keeps an
 *  accidental dependency loud. */
export const mockSuApi = (overrides: Partial<SuApi> = {}): SuApi => ({
  elevate: NOT_IMPLEMENTED('su.elevate'),
  ...overrides,
});

/** The crack seam. Load-bearing — `hydra` has no answer of its own to fall back
 *  on, so an unstubbed call must be loud rather than silently reporting nothing
 *  cracked, which is indistinguishable from a strong password. */
export const mockHydraApi = (overrides: Partial<HydraApi> = {}): HydraApi => ({
  crack: NOT_IMPLEMENTED('hydra.crack'),
  crackPublic: NOT_IMPLEMENTED('hydra.crackPublic'),
  crackInnerGateway: NOT_IMPLEMENTED('hydra.crackInnerGateway'),
  ...overrides,
});

/** A scan seam whose `record` no-ops by default (logging is best-effort and
 *  fire-and-forget, so it must not throw the way a load-bearing seam does) and
 *  whose `resolvePublic` throws unless overridden (it is load-bearing — its result
 *  drives scan output). `nmap` tests override `record` to capture a recorded scan,
 *  or `resolvePublic` to stub a cross-player resolution. */
export const mockScanApi = (overrides: Partial<ScanApi> = {}): ScanApi => ({
  record: async () => undefined,
  // Fire-and-forget like `record`: a deep pivot resolves client-side, so this no-ops
  // by default; pivot tests override it to capture the recorded deep scan.
  recordDeep: async () => undefined,
  resolvePublic: NOT_IMPLEMENTED('scan.resolvePublic'),
  // Load-bearing like `resolvePublic`: an inner-gateway scan drives its own output, so
  // it throws unless a test stubs the resolution.
  resolveInnerGateway: NOT_IMPLEMENTED('scan.resolveInnerGateway'),
  // Additive read: defaults to no fellow occupants so own-LAN nmap tests are unaffected;
  // occupant-merge tests override it to merge a real occupant.
  resolveOccupants: async () => [],
  // Additive read: defaults to no occupied ESSIDs so a plain scan injects nothing.
  resolveOccupiedEssids: async () => [],
  ...overrides,
});

// ---- The factory ----

export const mockCommandEnv = (overrides: Partial<CommandEnv> = {}): CommandEnv => ({
  identity: mockIdentity(),
  session: mockSession(),
  hopChain: [],
  hostname: 'workstation',
  workstationName: 'workstation',
  now: () => asEpochMs(0),
  fs: mockFsViewFromTree(buildDirectory({})),
  network: mockNetworkView(),
  output: mockOutputSink(),
  patches: mockPatchApi(),
  remote: mockRemoteApi(),
  log: mockLogApi(),
  homeNetwork: mockHomeNetwork(),
  ssh: mockSshApi(),
  nc: mockNcApi(),
  ftp: mockFtpApi(),
  mysql: mockMysqlApi(),
  scp: mockScpApi(),
  su: mockSuApi(),
  hydra: mockHydraApi(),
  scan: mockScanApi(),
  setCwd: () => undefined,
  setInterface: () => undefined,
  prompt: NOT_IMPLEMENTED('prompt'),
  pushSession: () => undefined,
  popSession: () => undefined,
  resetGame: () => undefined,
  sleep: () => Promise.resolve(),
  signal: new AbortController().signal,
  ...overrides,
});

// Silence "exported but unused" for helpers tests may reach for later.
export { canWrite, asNetworkAddress, dirname, basename };
