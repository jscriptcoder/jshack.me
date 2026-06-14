import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveCrossPlayerFs,
  type ActiveSession,
  type RegistryWorkstation,
  type ResolveCrossPlayerFsDeps,
  type OwnerPatchRow,
} from './resolveCrossPlayerFs';
import { deserializeTree } from '../filesystem/treeCodec';
import type { Directory, FileNode } from '../filesystem/types';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolveCrossPlayerFs` is the cross-player READ (Story 2, slice 2c, tier 2):
 * one identity (B) holding an active session on ANOTHER identity's (A's) workstation
 * fetches A's filesystem SERVER-side. The server rebuilds A's box from the persisted
 * identity, replays A's OWN patch journal over it, and prunes the tree to B's
 * server-derived tier BEFORE it leaves — the wire is the threat surface, so a
 * forbidden path must never appear in the response. Tier 1 (owner) + tier 3
 * (no-session allowlist) land in slice 2d.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const MACHINE_ID = 'skylab-deadbeef';
const OWNER_KEY = 'a'.repeat(64);
const REGISTERED: RegistryWorkstation = {
  owner_key: OWNER_KEY,
  workstation_username: 'alice',
  workstation_root_hash: '5f4dcc3b5aa765d61d8327deb882cf99',
};

// A guest-readable file A created (a real persisted patch) and a user-only one —
// the tier filter must keep the first for a guest reader and drop the second.
const worldReadable = { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] } as const;
const userOnly = { read: ['root', 'user'], write: ['root'], execute: ['root'] } as const;
const OWNER_PATCHES: readonly OwnerPatchRow[] = [
  { path: '/srv/loot.txt', content: 'OWNED_BY_A', owner: 'root', permissions: worldReadable, node_type: 'file' },
  { path: '/srv/secret.txt', content: 'TOP_SECRET', owner: 'root', permissions: userOnly, node_type: 'file' },
];

type RegistryResult = { data: RegistryWorkstation | null; error: unknown };
type SessionResult = { data: ActiveSession | null; error: unknown };
type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

const makeDeps = (over: {
  registry?: () => Promise<RegistryResult>;
  session?: () => Promise<SessionResult>;
  patches?: () => Promise<PatchesResult>;
} = {}) => {
  const findRegistryByMachineId = vi.fn<(machineId: string) => Promise<RegistryResult>>(
    over.registry ?? (async () => ({ data: REGISTERED, error: null })),
  );
  const findActiveSession = vi.fn<
    (query: { player_key: string; machine_id: string }) => Promise<SessionResult>
  >(over.session ?? (async () => ({ data: { userType: 'guest' }, error: null })));
  const findPatches = vi.fn<
    (query: { player_key: string; machine_id: string }) => Promise<PatchesResult>
  >(over.patches ?? (async () => ({ data: OWNER_PATCHES, error: null })));
  const deps: ResolveCrossPlayerFsDeps = {
    nonceStore: freshStore,
    findRegistryByMachineId,
    findActiveSession,
    findPatches,
  };
  return { deps, findRegistryByMachineId, findActiveSession, findPatches };
};

const envelope = (
  id: ReturnType<typeof generateIdentity>,
  machineId: string = MACHINE_ID,
  over: Record<string, unknown> = {},
) => signRequest(id, 'resolveCrossPlayerFs', { machine_id: machineId, ...over });

const treeOf = (result: { body: Record<string, unknown> }): Directory =>
  deserializeTree(result.body.tree as Parameters<typeof deserializeTree>[0]);

const get = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

describe('handleResolveCrossPlayerFs', () => {
  it('returns A’s real file to a guest session, with content from A’s patch', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps();

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    const loot = get(treeOf(result), 'srv', 'loot.txt');
    expect(loot?.kind === 'file' ? loot.content : null).toBe('OWNED_BY_A');
  });

  it('prunes paths the guest tier cannot read — no passwd hashes, no /root, no user-only files', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps();

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);
    const tree = treeOf(result);

    expect(get(tree, 'etc', 'passwd')).toBeUndefined();
    expect(get(tree, 'root')).toBeUndefined();
    expect(get(tree, 'srv', 'secret.txt')).toBeUndefined();
    // Belt-and-braces: the secret must not appear ANYWHERE in the wire body.
    expect(JSON.stringify(result.body)).not.toContain('TOP_SECRET');
    expect(JSON.stringify(result.body)).not.toContain(REGISTERED.workstation_root_hash);
  });

  it('filters at the SESSION’s tier, not a hardcoded guest — a user session sees passwd + user files', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({ session: async () => ({ data: { userType: 'user' }, error: null }) });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);
    const tree = treeOf(result);

    const passwd = get(tree, 'etc', 'passwd');
    expect(passwd?.kind).toBe('file');
    // The passwd reflects A's PERSISTED identity (username + root hash), proving the
    // box is rebuilt from the registry row, not from empty/defaulted fields.
    expect(passwd?.kind === 'file' ? passwd.content : '').toContain('alice');
    expect(passwd?.kind === 'file' ? passwd.content : '').toContain(REGISTERED.workstation_root_hash);
    expect(get(tree, 'srv', 'secret.txt')?.kind).toBe('file');
  });

  it('honors an owner directory patch (node_type), materializing it as a directory', async () => {
    const id = generateIdentity();
    const worldDir = {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root', 'user', 'guest'],
    } as const;
    const { deps } = makeDeps({
      patches: async () => ({
        data: [{ path: '/srv/loot', content: null, owner: 'root', permissions: worldDir, node_type: 'directory' }],
        error: null,
      }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    // Dropping node_type would turn this content:null row into a deletion marker —
    // the directory would never appear.
    expect(get(treeOf(result), 'srv', 'loot')?.kind).toBe('directory');
  });

  it('reads the OWNER’s patch rows, scoped to owner_key + machine_id (never the caller’s)', async () => {
    const id = generateIdentity();
    const { deps, findPatches } = makeDeps();

    await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(findPatches).toHaveBeenCalledWith({ player_key: OWNER_KEY, machine_id: MACHINE_ID });
  });

  it('looks the caller’s session up under the VERIFIED pubkey + target machine', async () => {
    const id = generateIdentity();
    const { deps, findActiveSession } = makeDeps();

    await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(findActiveSession).toHaveBeenCalledWith({
      player_key: id.publicKeyHex,
      machine_id: MACHINE_ID,
    });
  });

  it('denies a caller with no active session on the target (tier 2 gate), without reading patches', async () => {
    const id = generateIdentity();
    const { deps, findPatches } = makeDeps({ session: async () => ({ data: null, error: null }) });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('reports an unregistered machine as unreachable, without checking the session', async () => {
    const id = generateIdentity();
    const { deps, findActiveSession } = makeDeps({ registry: async () => ({ data: null, error: null }) });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findActiveSession).not.toHaveBeenCalled();
  });

  it('serves the regenerated baseline when the owner has no patches yet', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({ patches: async () => ({ data: [], error: null }) });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);
    const tree = treeOf(result);

    // Base FS still readable at guest tier: /bin survives, /srv (patch-only) does not.
    expect(get(tree, 'bin')?.kind).toBe('directory');
    expect(get(tree, 'srv')).toBeUndefined();
  });

  it('degrades a null patches result (no error) to the baseline tree', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({ patches: async () => ({ data: null, error: null }) });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result.status).toBe(200);
    expect(get(treeOf(result), 'bin')?.kind).toBe('directory');
  });

  it('reports a server error when the registry lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({ registry: async () => ({ data: null, error: new Error('db down') }) });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'registry_lookup_failed' } });
  });

  it('reports a server error when the session lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({ session: async () => ({ data: null, error: new Error('db down') }) });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
  });

  it('reports a server error when the patches lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({ patches: async () => ({ data: null, error: new Error('db down') }) });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('rejects a tampered envelope without any lookup', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByMachineId } = makeDeps();
    const signed = envelope(id);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleResolveCrossPlayerFs(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findRegistryByMachineId).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByMachineId } = makeDeps();

    const result = await handleResolveCrossPlayerFs(envelope(id, MACHINE_ID, { player_key: 'x' }), deps);

    expect(result.status).toBe(400);
    expect(findRegistryByMachineId).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the machine_id', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByMachineId } = makeDeps();

    const result = await handleResolveCrossPlayerFs(signRequest(id, 'resolveCrossPlayerFs', {}), deps);

    expect(result.status).toBe(400);
    expect(findRegistryByMachineId).not.toHaveBeenCalled();
  });
});
