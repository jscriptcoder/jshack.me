import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveCrossPlayerFs,
  type ActiveSession,
  type RegistryWorkstation,
  type RegistryRouter,
  type RegistryMachine,
  type ResolveCrossPlayerFsDeps,
  type OwnerPatchRow,
} from './resolveCrossPlayerFs';
import { deserializeTree } from '../filesystem/treeCodec';
import type { Directory, FileNode } from '../filesystem/types';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolveCrossPlayerFs` is the cross-player READ (Story 2, slices 2c+2d):
 * one identity (B) holding an active session on ANOTHER identity's (A's) workstation
 * fetches A's filesystem SERVER-side. The server rebuilds A's box from the persisted
 * identity, replays A's OWN patch journal over it, and prunes the tree to the
 * caller's server-derived TIER BEFORE it leaves — the wire is the threat surface, so
 * a forbidden path must never appear in the response. Three tiers:
 *   - tier 1 (owner): caller's pubkey == owner_key -> the FULL tree (ownership
 *     trumps any session; the session table is not even consulted);
 *   - tier 2 (active session): pruned by the permission walker at the session tier;
 *   - tier 3 (no session): only the externally-observable allowlist (pidfiles,
 *     /var/www, NAT rules, ...) — everything else default-denies.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const MACHINE_ID = 'skylab-deadbeef';
const ROUTER_MACHINE_ID = 'router-deadbeef';
const OWNER_KEY = 'a'.repeat(64);
const REGISTERED: RegistryWorkstation = {
  kind: 'workstation',
  owner_key: OWNER_KEY,
  workstation_username: 'alice',
  workstation_root_hash: '5f4dcc3b5aa765d61d8327deb882cf99',
};
const REGISTERED_ROUTER: RegistryRouter = {
  kind: 'router',
  owner_key: OWNER_KEY,
};

// A guest-readable file A created (a real persisted patch) and a user-only one —
// the tier filter must keep the first for a guest reader and drop the second.
const worldReadable = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
} as const;
const userOnly = { read: ['root', 'user'], write: ['root'], execute: ['root'] } as const;

/** A persisted row on the machine's shared journal. Carries the SERVER
 *  `updated_at` + `writer_key` the chronological replay depends on. */
const ownerRow = (over: Partial<OwnerPatchRow> = {}): OwnerPatchRow => ({
  path: '/srv/file.txt',
  content: 'data',
  owner: 'root',
  permissions: worldReadable,
  node_type: 'file',
  updated_at: '2026-06-14T12:00:00.000000+00:00',
  writer_key: OWNER_KEY,
  ...over,
});

const OWNER_PATCHES: readonly OwnerPatchRow[] = [
  ownerRow({ path: '/srv/loot.txt', content: 'OWNED_BY_A', permissions: worldReadable }),
  ownerRow({ path: '/srv/secret.txt', content: 'TOP_SECRET', permissions: userOnly }),
];

type RegistryResult = { data: RegistryMachine | null; error: unknown };
type SessionResult = { data: ActiveSession | null; error: unknown };
type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

const makeDeps = (
  over: {
    registry?: () => Promise<RegistryResult>;
    session?: () => Promise<SessionResult>;
    patches?: () => Promise<PatchesResult>;
  } = {},
) => {
  const findRegistryByMachineId = vi.fn<(machineId: string) => Promise<RegistryResult>>(
    over.registry ?? (async () => ({ data: REGISTERED, error: null })),
  );
  const findActiveSession = vi.fn<
    (query: { player_key: string; machine_id: string }) => Promise<SessionResult>
  >(over.session ?? (async () => ({ data: { userType: 'guest' }, error: null })));
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(
    over.patches ?? (async () => ({ data: OWNER_PATCHES, error: null })),
  );
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

  it('serves A’s ROUTER tree for a router registry row — rules.v4 + journal replay at the root tier', async () => {
    const id = generateIdentity();
    const rootOnly = { read: ['root'], write: ['root'], execute: [] } as const;
    // B holds a ROOT session on A's router (the only way onto a root-only appliance).
    const { deps } = makeDeps({
      registry: async () => ({ data: REGISTERED_ROUTER, error: null }),
      session: async () => ({ data: { userType: 'root' }, error: null }),
      patches: async () => ({
        data: [
          ownerRow({
            path: '/etc/iptables/rules.v4',
            content: 'forward 2222 to 10.0.0.10:22',
            permissions: rootOnly,
          }),
        ],
        error: null,
      }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, ROUTER_MACHINE_ID), deps);
    const tree = treeOf(result);

    expect(result.status).toBe(200);
    // A's journal edit replayed over the router base (not the seed) — proves the
    // router's journal is replayed.
    const rules = get(tree, 'etc', 'iptables', 'rules.v4');
    expect(rules?.kind === 'file' ? rules.content : null).toBe('forward 2222 to 10.0.0.10:22');
    // The discriminator: the router is a ROOT-ONLY appliance, so its /etc/passwd has
    // no `guest` account — whereas every workstation base seeds a weak `guest`. If the
    // handler materialized a workstation instead of the router, `guest` would appear.
    const passwd = get(tree, 'etc', 'passwd');
    expect(passwd?.kind).toBe('file');
    expect(passwd?.kind === 'file' ? passwd.content : '').not.toContain('guest');
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
    const { deps } = makeDeps({
      session: async () => ({ data: { userType: 'user' }, error: null }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);
    const tree = treeOf(result);

    const passwd = get(tree, 'etc', 'passwd');
    expect(passwd?.kind).toBe('file');
    // The passwd reflects A's PERSISTED identity (username + root hash), proving the
    // box is rebuilt from the registry row, not from empty/defaulted fields.
    expect(passwd?.kind === 'file' ? passwd.content : '').toContain('alice');
    expect(passwd?.kind === 'file' ? passwd.content : '').toContain(
      REGISTERED.workstation_root_hash,
    );
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
        data: [
          ownerRow({
            path: '/srv/loot',
            content: null,
            permissions: worldDir,
            node_type: 'directory',
          }),
        ],
        error: null,
      }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    // Dropping node_type would turn this content:null row into a deletion marker —
    // the directory would never appear.
    expect(get(treeOf(result), 'srv', 'loot')?.kind).toBe('directory');
  });

  it('reads the machine’s shared-journal rows, scoped to machine_id (never the caller’s)', async () => {
    const id = generateIdentity();
    const { deps, findPatches } = makeDeps();

    await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(findPatches).toHaveBeenCalledWith({ machine_id: MACHINE_ID });
  });

  it('combines multiple writers’ rows for one path chronologically (latest server write wins)', async () => {
    const id = generateIdentity();
    const path = '/srv/loot.txt';
    // Two writers edited A's file; the server returns them out of order.
    const { deps } = makeDeps({
      patches: async () => ({
        data: [
          ownerRow({
            path,
            content: 'NEWER_BY_B',
            writer_key: 'b'.repeat(64),
            updated_at: '2026-06-14T13:00:00.000000+00:00',
          }),
          ownerRow({
            path,
            content: 'OLDER_BY_A',
            writer_key: OWNER_KEY,
            updated_at: '2026-06-14T12:00:00.000000+00:00',
          }),
        ],
        error: null,
      }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);
    const loot = get(treeOf(result), 'srv', 'loot.txt');

    // Replayed oldest-first → the later (B's) write is the materialized content.
    expect(loot?.kind === 'file' ? loot.content : null).toBe('NEWER_BY_B');
  });

  it('replays delete-then-recreate chronologically: a later owner write wins over an earlier tombstone, and vice-versa', async () => {
    const id = generateIdentity();
    const path = '/srv/loot.txt';
    const writeRow = (updated_at: string): OwnerPatchRow =>
      ownerRow({
        path,
        content: 'REBORN',
        permissions: worldReadable,
        writer_key: OWNER_KEY,
        updated_at,
      });
    // A visitor's rm lands a content:null tombstone (the Slice-4 cross-player delete).
    const tombRow = (updated_at: string): OwnerPatchRow =>
      ownerRow({ path, content: null, writer_key: 'b'.repeat(64), updated_at });
    const T1 = '2026-06-14T12:00:00.000000+00:00';
    const T2 = '2026-06-14T13:00:00.000000+00:00';

    // tombstone@T1, owner re-create@T2 → recreate wins → file present.
    const present = await handleResolveCrossPlayerFs(
      envelope(id),
      makeDeps({ patches: async () => ({ data: [tombRow(T1), writeRow(T2)], error: null }) }).deps,
    );
    const reborn = get(treeOf(present), 'srv', 'loot.txt');
    expect(reborn?.kind === 'file' ? reborn.content : null).toBe('REBORN');

    // owner write@T1, tombstone@T2 → delete wins → file gone (the rows are passed in
    // the SAME array order, so only the server `updated_at` flips the verdict).
    const gone = await handleResolveCrossPlayerFs(
      envelope(id),
      makeDeps({ patches: async () => ({ data: [writeRow(T1), tombRow(T2)], error: null }) }).deps,
    );
    expect(get(treeOf(gone), 'srv', 'loot.txt')).toBeUndefined();
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

  it('serves ONLY the externally-observable allowlist to a no-session caller (tier 3)', async () => {
    const id = generateIdentity();
    const { deps, findPatches } = makeDeps({
      session: async () => ({ data: null, error: null }),
      patches: async () => ({
        data: [
          ownerRow({ path: '/var/run/sshd.pid', content: '4131', permissions: worldReadable }),
          ownerRow({ path: '/srv/secret.txt', content: 'TOP_SECRET', permissions: userOnly }),
        ],
        error: null,
      }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);
    const tree = treeOf(result);

    expect(result.status).toBe(200);
    // The pidfile leaks (port liveness is externally observable)...
    expect(get(tree, 'var', 'run', 'sshd.pid')?.kind).toBe('file');
    // ...but nothing off the allowlist — not the secret, not passwd's inline hashes.
    expect(get(tree, 'srv', 'secret.txt')).toBeUndefined();
    expect(get(tree, 'etc', 'passwd')).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain('TOP_SECRET');
    expect(JSON.stringify(result.body)).not.toContain(REGISTERED.workstation_root_hash);
    // Tier 3 still reads the machine's shared journal (pidfiles live there).
    expect(findPatches).toHaveBeenCalledWith({ machine_id: MACHINE_ID });
  });

  it('returns the FULL unfiltered tree to the owner, never consulting the session table (tier 1)', async () => {
    const id = generateIdentity();
    const rootOnly = { read: ['root'], write: ['root'], execute: ['root'] } as const;
    const { deps, findActiveSession } = makeDeps({
      // The caller IS the owner: registry.owner_key == the verified caller pubkey.
      registry: async () => ({ data: { ...REGISTERED, owner_key: id.publicKeyHex }, error: null }),
      patches: async () => ({
        data: [
          ownerRow({ path: '/root/.wallet', content: 'PRIVKEY', permissions: rootOnly }),
          ownerRow({ path: '/srv/secret.txt', content: 'TOP_SECRET', permissions: userOnly }),
        ],
        error: null,
      }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);
    const tree = treeOf(result);

    expect(result.status).toBe(200);
    // Ownership trumps any session tier — even root-only and user-only files appear.
    expect(get(tree, 'root', '.wallet')?.kind).toBe('file');
    expect(get(tree, 'srv', 'secret.txt')?.kind).toBe('file');
    expect(get(tree, 'etc', 'passwd')?.kind).toBe('file');
    // The owner bypass short-circuits before the session lookup runs.
    expect(findActiveSession).not.toHaveBeenCalled();
  });

  it('reports an unregistered machine as unreachable, without checking the session', async () => {
    const id = generateIdentity();
    const { deps, findActiveSession } = makeDeps({
      registry: async () => ({ data: null, error: null }),
    });

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
    const { deps } = makeDeps({
      registry: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'registry_lookup_failed' } });
  });

  it('reports a server error when the session lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({
      session: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
  });

  it('reports a server error when the patches lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({
      patches: async () => ({ data: null, error: new Error('db down') }),
    });

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

    const result = await handleResolveCrossPlayerFs(
      envelope(id, MACHINE_ID, { player_key: 'x' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findRegistryByMachineId).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the machine_id', async () => {
    const id = generateIdentity();
    const { deps, findRegistryByMachineId } = makeDeps();

    const result = await handleResolveCrossPlayerFs(
      signRequest(id, 'resolveCrossPlayerFs', {}),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findRegistryByMachineId).not.toHaveBeenCalled();
  });
});
