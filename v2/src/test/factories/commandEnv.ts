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
  asAbsPath,
  asEpochMs,
  asGameTime,
  asMachineId,
  asNetworkAddress,
  asPlayerKeyHex,
  type AbsPath,
} from '../../core/types';
import type {
  CommandEnv,
  FsListResult,
  FsReadResult,
  FsView,
  Identity,
  LogApi,
  NetworkView,
  OutputSink,
  PatchApi,
  PatchResult,
  RemoteApi,
  Session,
} from '../../core/commands/types';
import { ancestorPaths, basename, dirname } from '../../core/filesystem/path';
import { canRead, canWrite } from '../../core/filesystem/walker';
import type {
  Directory,
  FileNode,
  FilePermissions,
} from '../../core/filesystem/types';
import { buildDirectory } from './filesystem';

const NOT_IMPLEMENTED = (method: string) => (): never => {
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

/** Walk a path through a Directory tree, returning the leaf + parent perms. */
const walkTree = (
  root: Directory,
  path: AbsPath,
): { readonly node: FileNode | null; readonly parents: readonly FilePermissions[] } => {
  if (path === '/') return { node: root, parents: [] };

  const segments = path.split('/').filter((segment) => segment !== '');
  const parents: FilePermissions[] = [root.perms];
  let current: FileNode = root;

  for (let i = 0; i < segments.length; i++) {
    if (current.kind !== 'directory') {
      return { node: null, parents };
    }
    const next = current.entries.get(segments[i]!);
    if (!next) return { node: null, parents };

    if (i < segments.length - 1) {
      parents.push(next.perms);
      current = next;
    } else {
      return { node: next, parents };
    }
  }

  return { node: current, parents };
};

/** Build an FsView backed by a static Directory tree, with walker-enforced perms. */
export const mockFsViewFromTree = (
  tree: Directory,
  options: {
    readonly userType?: Session['userType'];
    readonly cwd?: AbsPath;
  } = {},
): FsView => {
  const userType = options.userType ?? 'user';
  const cwd = options.cwd ?? asAbsPath('/');

  // Pre-compute parent chains by walking each ancestor.
  const parentsFor = (path: AbsPath): readonly FilePermissions[] => {
    const ancestors = ancestorPaths(path);
    // Exclude the leaf itself; parents are the ancestors up to (but not including) it.
    const onlyParents = ancestors.slice(0, -1);
    return onlyParents
      .map((ancestorPath) => walkTree(tree, ancestorPath).node?.perms)
      .filter((perms): perms is FilePermissions => perms !== undefined);
  };

  const read = (path: AbsPath): FsReadResult => {
    const { node } = walkTree(tree, path);
    if (!node) return { ok: false, error: 'not_found' };
    if (node.kind === 'directory') return { ok: false, error: 'is_directory' };

    const result = canRead(userType, node.perms, parentsFor(path));
    if (!result.allowed) return { ok: false, error: 'permission_denied' };
    return { ok: true, content: node.content };
  };

  const list = (path: AbsPath): FsListResult => {
    const { node } = walkTree(tree, path);
    if (!node) return { ok: false, error: 'not_found' };
    if (node.kind !== 'directory') return { ok: false, error: 'not_a_directory' };

    const result = canRead(userType, node.perms, parentsFor(path));
    if (!result.allowed) return { ok: false, error: 'permission_denied' };
    return { ok: true, entries: [...node.entries.keys()] };
  };

  const stat = (path: AbsPath): FileNode | null => walkTree(tree, path).node;

  return {
    cwd: () => cwd,
    read,
    list,
    stat,
    root: () => tree,
  };
};

export const mockOutputSink = (): OutputSink => ({
  text: NOT_IMPLEMENTED('output.text'),
  error: NOT_IMPLEMENTED('output.error'),
  dim: NOT_IMPLEMENTED('output.dim'),
});

export const mockPatchApi = (): PatchApi => ({
  write: NOT_IMPLEMENTED('patches.write') as () => Promise<PatchResult>,
  remove: NOT_IMPLEMENTED('patches.remove') as () => Promise<PatchResult>,
  mkdir: NOT_IMPLEMENTED('patches.mkdir') as () => Promise<PatchResult>,
});

export const mockNetworkView = (): NetworkView => ({
  currentMachine: () => asMachineId('localhost'),
  findMachineByAddress: () => null,
  resolveDns: () => null,
});

export const mockRemoteApi = (): RemoteApi => ({
  listPatches: NOT_IMPLEMENTED('remote.listPatches') as RemoteApi['listPatches'],
});

export const mockLogApi = (): LogApi => ({
  appendAuthLog: async () => undefined,
  appendAccessLog: async () => undefined,
});

// ---- The factory ----

export const mockCommandEnv = (overrides: Partial<CommandEnv> = {}): CommandEnv => ({
  identity: mockIdentity(),
  session: mockSession(),
  hopChain: [],
  gameTime: () => asGameTime(0),
  now: () => asEpochMs(0),
  fs: mockFsViewFromTree(buildDirectory({})),
  network: mockNetworkView(),
  output: mockOutputSink(),
  patches: mockPatchApi(),
  remote: mockRemoteApi(),
  log: mockLogApi(),
  signal: new AbortController().signal,
  ...overrides,
});

// Silence "exported but unused" for helpers tests may reach for later.
export { canWrite, asNetworkAddress, dirname, basename };
