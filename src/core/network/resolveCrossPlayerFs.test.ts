import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveCrossPlayerFs,
  type ActiveSession,
  type OccupantWorkstation,
  type ResolveCrossPlayerFsDeps,
  type OwnerPatchRow,
} from './resolveCrossPlayerFs.js';
import { deserializeTree } from '../filesystem/treeCodec.js';
import type { Directory, FileNode } from '../filesystem/types.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeApGatewayId } from '../identity/router.js';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan.js';
import { generateDeepLayer } from '../generation/generateDeepLayer.js';
import { hostMachineId } from '../generation/remoteHostId.js';
import { chainLinks, isInnerGateway, machineIdForLanHost } from '../generation/lanTopology.js';
import { networkBaseFsForMachineId } from '../generation/lanHostIdentity.js';
import { BOOT_ID_OWNER, BOOT_ID_PATH, BOOT_ID_PERMISSIONS, readBootId } from '../boot/bootId.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type { SpoolAccount } from '../emailit/spool.js';
import type { Board } from '../hireme/boards.js';
import { BOARD_SERVER_NETWORK, EMAILIT_NETWORK } from '../generation/fixedSites.js';
import { MAIL_SPOOL_FILE, ROOT_FILE } from '../generation/baseFs.js';

/**
 * `handleResolveCrossPlayerFs` is the cross-player READ (Story 2, slices 2c+2d):
 * one identity (B) holding an active session on ANOTHER identity's (A's) workstation
 * fetches A's filesystem SERVER-side. The server rebuilds A's box from the persisted
 * identity, replays A's OWN patch journal over it, and prunes the tree to the
 * caller's server-derived TIER BEFORE it leaves — the wire is the threat surface, so
 * a forbidden path must never appear in the response. Three tiers:
 *   - tier 1 (owner): caller's pubkey == owner_key -> the FULL tree (ownership
 *     trumps any session; the session table is not even consulted);
 *   - tier 2 (active session): pruned by the permission walker at the session tier,
 *     together with everything tier 3 is shown;
 *   - tier 3 (no session): only the externally-observable allowlist (pidfiles,
 *     /var/www, NAT rules, ...) — everything else default-denies.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const MACHINE_ID = 'skylab-deadbeef';
const OWNER_KEY = 'a'.repeat(64);
const REGISTERED: OccupantWorkstation = {
  owner_key: OWNER_KEY,
  workstation_username: 'alice',
  workstation_root_hash: '5f4dcc3b5aa765d61d8327deb882cf99',
};
const ROUTER_ESSID = 'BEAN-THERE-WIFI';
/** The AP gateway's real id. It is a pure function of the ESSID, which is what lets a
 *  caller's session identify the gateway without any stored row. */
const AP_GATEWAY_ID = computeApGatewayId(ROUTER_ESSID);

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

type OccupantResult = { data: OccupantWorkstation | null; error: unknown };
type SessionResult = { data: ActiveSession | null; error: unknown };
type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };
type LastEssidResult = { data: string | null; error: unknown };
type SpoolResult = { data: readonly SpoolAccount[] | null; error: unknown };
type BoardsResult = { data: readonly Board[] | null; error: unknown };

const NEO_BOARD = '194.12.40.7';

/** One board, held by neo. */
const BOARDS: readonly Board[] = [
  { handle: 'neo', address: NEO_BOARD, applied_at: '2026-10-20T09:00:00.000+00:00' },
];

const NEO_HASH = '5f4dcc3b5aa765d61d8327deb882cf99';

/** One account at emailit.io, with its welcome mail unread. */
const SPOOL: readonly SpoolAccount[] = [
  {
    handle: 'neo',
    password_md5: NEO_HASH,
    signed_up_at: '2026-10-14T09:12:03.000+00:00',
    messages: [
      {
        number: 1,
        sender: 'noreply@emailit.io',
        subject: 'Welcome to emailit.io',
        body: 'Welcome aboard.',
        delivered_at: '2026-10-14T09:12:03.000+00:00',
        read: false,
      },
    ],
  },
];

const makeDeps = (
  over: {
    occupant?: () => Promise<OccupantResult>;
    session?: () => Promise<SessionResult>;
    patches?: () => Promise<PatchesResult>;
    lastEssid?: () => Promise<LastEssidResult>;
    spool?: () => Promise<SpoolResult>;
    boards?: () => Promise<BoardsResult>;
  } = {},
) => {
  // Whose box this is — and, by saying it is on a WiFi at all, whether it is reachable.
  const findOccupantWorkstationByMachineId = vi.fn<(machineId: string) => Promise<OccupantResult>>(
    over.occupant ?? (async () => ({ data: REGISTERED, error: null })),
  );
  const findActiveSession = vi.fn<
    (query: { player_key: string; machine_id: string }) => Promise<SessionResult>
  >(over.session ?? (async () => ({ data: { userType: 'guest', essid: null }, error: null })));
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(
    over.patches ?? (async () => ({ data: OWNER_PATCHES, error: null })),
  );
  const findLastSessionEssid = vi.fn<
    (query: { player_key: string; machine_id: string }) => Promise<LastEssidResult>
  >(over.lastEssid ?? (async () => ({ data: null, error: null })));
  const findMailSpool = vi.fn<() => Promise<SpoolResult>>(
    over.spool ?? (async () => ({ data: SPOOL, error: null })),
  );
  const findBoards = vi.fn<() => Promise<BoardsResult>>(
    over.boards ?? (async () => ({ data: BOARDS, error: null })),
  );
  const deps: ResolveCrossPlayerFsDeps = {
    nonceStore: freshStore,
    findOccupantWorkstationByMachineId,
    findActiveSession,
    findLastSessionEssid,
    findPatches,
    findMailSpool,
    findBoards,
  };
  return {
    deps,
    findOccupantWorkstationByMachineId,
    findActiveSession,
    findLastSessionEssid,
    findPatches,
    findMailSpool,
    findBoards,
  };
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

  it('serves the AP GATEWAY tree the caller’s session names — rules.v4 + journal replay at the root tier', async () => {
    const id = generateIdentity();
    const rootOnly = { read: ['root'], write: ['root'], execute: [] } as const;
    // B holds a ROOT session on the AP's gateway (the only way onto a root-only
    // appliance), and that session records which access point it is — nothing owns a
    // gateway, so there is no occupancy row to find it by.
    const { deps } = makeDeps({
      occupant: async () => ({ data: null, error: null }),
      session: async () => ({ data: { userType: 'root', essid: ROUTER_ESSID }, error: null }),
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

    const result = await handleResolveCrossPlayerFs(envelope(id, AP_GATEWAY_ID), deps);
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

  it.each(['guest', 'user'] as const)(
    'serves a %s session on the AP gateway its rules.v4, still readable by root alone',
    async (userType) => {
      const id = generateIdentity();
      // What a caller with no session is already shown of this box. Holding a session
      // must never show less, and the gateway's own NAT table is root's to read.
      const { deps } = makeDeps({
        occupant: async () => ({ data: null, error: null }),
        session: async () => ({ data: { userType, essid: ROUTER_ESSID }, error: null }),
        patches: async () => ({ data: [], error: null }),
      });

      const result = await handleResolveCrossPlayerFs(envelope(id, AP_GATEWAY_ID), deps);
      const rules = get(treeOf(result), 'etc', 'iptables', 'rules.v4');

      expect(result.status).toBe(200);
      expect(rules?.kind).toBe('file');
      expect(rules?.perms.read).toEqual(['root']);
    },
  );

  it('serves a guest session a web page somebody narrowed to root, and nothing else it cannot read', async () => {
    const id = generateIdentity();
    const rootOnly = { read: ['root'], write: ['root'], execute: [] } as const;
    const { deps } = makeDeps({
      patches: async () => ({
        data: [
          ...OWNER_PATCHES,
          ownerRow({
            path: '/var/www/html/staff.html',
            content: 'STAFF_ONLY',
            permissions: rootOnly,
          }),
          ownerRow({ path: '/srv/keys.txt', content: 'ROOT_KEYS', permissions: rootOnly }),
        ],
        error: null,
      }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);
    const tree = treeOf(result);
    const page = get(tree, 'var', 'www', 'html', 'staff.html');

    // A page is what the web server hands anybody who asks from outside.
    expect(page?.kind === 'file' ? page.content : null).toBe('STAFF_ONLY');
    expect(page?.perms.read).toEqual(['root']);
    // What the tier reads is still there beside it...
    expect(get(tree, 'srv', 'loot.txt')?.kind).toBe('file');
    // ...and a root-only file nobody outside could see stays on the server.
    expect(get(tree, 'srv', 'keys.txt')).toBeUndefined();
    expect(get(tree, 'srv', 'secret.txt')).toBeUndefined();
    expect(get(tree, 'etc', 'passwd')).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain('ROOT_KEYS');
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
      session: async () => ({ data: { userType: 'user', essid: null }, error: null }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);
    const tree = treeOf(result);

    const passwd = get(tree, 'etc', 'passwd');
    expect(passwd?.kind).toBe('file');
    // The passwd reflects A's PERSISTED identity (username + root hash), proving the
    // box is rebuilt from the occupancy row, not from empty/defaulted fields.
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
      // The caller IS the owner: the occupant row's owner_key == the verified pubkey.
      occupant: async () => ({ data: { ...REGISTERED, owner_key: id.publicKeyHex }, error: null }),
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

  it('reports a machine on no network unreachable, even to a caller holding a session on it', async () => {
    // No occupancy row means the machine is on no WiFi — its owner disconnected, or it
    // was never there. A session is not enough to reach it: sessions outlive the
    // machine leaving the network, so the box must still resolve on its own.
    const id = generateIdentity();
    const { deps, findOccupantWorkstationByMachineId } = makeDeps({
      occupant: async () => ({ data: null, error: null }),
      session: async () => ({ data: { userType: 'root', essid: 'SOME-OTHER-WIFI' }, error: null }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findOccupantWorkstationByMachineId).toHaveBeenCalledWith(MACHINE_ID);
  });

  it('serves a fellow occupant a world-readable /bin, so ls/cat/su resolve their binaries', async () => {
    const id = generateIdentity();
    // The world-readable /bin must survive the guest filter — that is what makes
    // ls/cat/su find their binaries on a box you have ssh'd into (the same-LAN
    // command-not-found bug).
    const { deps, findOccupantWorkstationByMachineId } = makeDeps({
      occupant: async () => ({ data: REGISTERED, error: null }),
      patches: async () => ({ data: [], error: null }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);
    const tree = treeOf(result);

    expect(result.status).toBe(200);
    expect(get(tree, 'bin', 'ls')?.kind).toBe('file');
    // The guest tier filter still applies to the occupant-resolved tree — passwd hides.
    expect(get(tree, 'etc', 'passwd')).toBeUndefined();
    expect(findOccupantWorkstationByMachineId).toHaveBeenCalledWith(MACHINE_ID);
  });

  it('reports a server error when the occupancy fallback lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({
      occupant: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'occupant_lookup_failed' } });
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

  it('reports a server error when the occupancy lookup fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({
      occupant: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'occupant_lookup_failed' } });
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
    const { deps, findOccupantWorkstationByMachineId } = makeDeps();
    const signed = envelope(id);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleResolveCrossPlayerFs(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const id = generateIdentity();
    const { deps, findOccupantWorkstationByMachineId } = makeDeps();

    const result = await handleResolveCrossPlayerFs(
      envelope(id, MACHINE_ID, { player_key: 'x' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the machine_id', async () => {
    const id = generateIdentity();
    const { deps, findOccupantWorkstationByMachineId } = makeDeps();

    const result = await handleResolveCrossPlayerFs(
      signRequest(id, 'resolveCrossPlayerFs', {}),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
  });
});

const requireGenerated = <Value>(value: Value | undefined, what: string): Value => {
  if (value === undefined) throw new Error(`expected ${ROUTER_ESSID} to generate ${what}`);
  return value;
};

const lanMachineId = (what: string, pick: (host: LanHost) => boolean): string =>
  machineIdForLanHost(
    requireGenerated(generateHomeLan(ROUTER_ESSID).hosts.find(pick), what),
    ROUTER_ESSID,
  );

const LAN_MACHINE = lanMachineId('a machine', (host) => host.kind === 'machine');
const INNER_ROUTER = lanMachineId(
  'an inner router',
  (host) => host.kind === 'router' && isInnerGateway(host),
);
const SWITCH = lanMachineId('a switch', (host) => host.kind === 'switch');
const DEEP_GATEWAY = requireGenerated(
  chainLinks(ROUTER_ESSID).find((link) => link.parentMachineId !== null),
  'a gateway down the chain',
).machineId;
const DEEP_HOST = hostMachineId(
  generateDeepLayer(ROUTER_ESSID, { machineId: INNER_ROUTER, kind: 'router' }).host,
  ROUTER_ESSID,
);

/** Every kind of box a network makes besides its own gateway: a machine and both kinds of
 *  inner gateway on its LAN, a gateway further down the chain, and the machine behind one. */
const GENERATED = [
  ['a LAN machine', LAN_MACHINE],
  ['an inner router', INNER_ROUTER],
  ['a switch', SWITCH],
  ['a gateway down the chain', DEEP_GATEWAY],
  ['a machine behind a gateway', DEEP_HOST],
] as const;

const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] } as const;

/** What somebody left on the box: a file anyone may read, one only root may, and the
 *  marker a reboot leaves. None of the three is in any generated tree. */
const NETWORK_BOX_PATCHES: readonly OwnerPatchRow[] = [
  ownerRow({ path: '/srv/loot.txt', content: 'LEFT_IN_THE_OPEN', permissions: worldReadable }),
  ownerRow({ path: '/srv/keys.txt', content: 'ROOT_KEYS', permissions: ROOT_ONLY }),
  ownerRow({
    path: BOOT_ID_PATH,
    content: 'boot-7\n',
    owner: BOOT_ID_OWNER,
    permissions: BOOT_ID_PERMISSIONS,
  }),
];

/** A box nobody owns, so occupancy has no row for it, with the caller's row saying which
 *  network it was opened on. */
const onNetworkBox = (over: Parameters<typeof makeDeps>[0] = {}) =>
  makeDeps({
    occupant: async () => ({ data: null, error: null }),
    session: async () => ({ data: { userType: 'guest', essid: ROUTER_ESSID }, error: null }),
    patches: async () => ({ data: NETWORK_BOX_PATCHES, error: null }),
    ...over,
  });

const passwdOf = (tree: Directory): string | null => {
  const passwd = get(tree, 'etc', 'passwd');
  return passwd?.kind === 'file' ? passwd.content : null;
};

describe('handleResolveCrossPlayerFs on a machine the network generates', () => {
  it.each(GENERATED)(
    'serves a guest session on %s what it may read there, without a root-only file',
    async (_kind, machineId) => {
      const id = generateIdentity();
      const { deps, findPatches } = onNetworkBox();

      const result = await handleResolveCrossPlayerFs(envelope(id, machineId), deps);
      const tree = treeOf(result);
      const loot = get(tree, 'srv', 'loot.txt');

      expect(result.status).toBe(200);
      expect(loot?.kind === 'file' ? loot.content : null).toBe('LEFT_IN_THE_OPEN');
      expect(get(tree, 'srv', 'keys.txt')).toBeUndefined();
      expect(get(tree, 'etc', 'passwd')).toBeUndefined();
      expect(JSON.stringify(result.body)).not.toContain('ROOT_KEYS');
      expect(findPatches).toHaveBeenCalledWith({ machine_id: machineId });
    },
  );

  it.each(GENERATED)(
    'serves a root session on %s that very box, as its journal leaves it',
    async (_kind, machineId) => {
      const id = generateIdentity();
      const { deps } = onNetworkBox({
        session: async () => ({ data: { userType: 'root', essid: ROUTER_ESSID }, error: null }),
      });
      const generated = requireGenerated(
        networkBaseFsForMachineId(ROUTER_ESSID, machineId) ?? undefined,
        machineId,
      );

      const result = await handleResolveCrossPlayerFs(envelope(id, machineId), deps);
      const tree = treeOf(result);
      const keys = get(tree, 'srv', 'keys.txt');

      expect(result.status).toBe(200);
      // The accounts are seeded per machine, so this is that box and no other.
      expect(passwdOf(tree)).not.toBeNull();
      expect(passwdOf(tree)).toBe(passwdOf(generated));
      expect(keys?.kind === 'file' ? keys.content : null).toBe('ROOT_KEYS');
    },
  );

  it('reports the box unreachable to a session opened on another network', async () => {
    const id = generateIdentity();
    const { deps, findPatches } = onNetworkBox({
      session: async () => ({ data: { userType: 'root', essid: 'SOME-OTHER-WIFI' }, error: null }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, LAN_MACHINE), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('reports the box unreachable to a caller who never held a row on it', async () => {
    const id = generateIdentity();
    const { deps, findLastSessionEssid } = onNetworkBox({
      session: async () => ({ data: null, error: null }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, LAN_MACHINE), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findLastSessionEssid).toHaveBeenCalledWith({
      player_key: id.publicKeyHex,
      machine_id: LAN_MACHINE,
    });
  });

  it('reads the network off the open row and looks for no ended one', async () => {
    const id = generateIdentity();
    const { deps, findLastSessionEssid } = onNetworkBox({
      // An ended row on the right network must not rescue an open one that names none.
      session: async () => ({ data: { userType: 'guest', essid: null }, error: null }),
      lastEssid: async () => ({ data: ROUTER_ESSID, error: null }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, LAN_MACHINE), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findLastSessionEssid).not.toHaveBeenCalled();
  });
});

describe('handleResolveCrossPlayerFs for a caller whose session on the box has ended', () => {
  const ended = (over: Parameters<typeof makeDeps>[0] = {}) =>
    onNetworkBox({
      session: async () => ({ data: null, error: null }),
      lastEssid: async () => ({ data: ROUTER_ESSID, error: null }),
      ...over,
    });

  it.each([...GENERATED, ['the access point gateway', AP_GATEWAY_ID] as const])(
    'serves %s as the externally-observable list alone, carrying the boot marker',
    async (_kind, machineId) => {
      const id = generateIdentity();
      const { deps } = ended();

      const result = await handleResolveCrossPlayerFs(envelope(id, machineId), deps);
      const tree = treeOf(result);

      expect(result.status).toBe(200);
      // A reboot is what ends a session nobody closed, and this is how its holder learns.
      expect(readBootId(tree)).toBe('boot-7');
      // A file every tier may read is still not served: the row behind it is closed.
      expect(get(tree, 'srv')).toBeUndefined();
      expect(get(tree, 'bin')).toBeUndefined();
      expect(get(tree, 'etc', 'passwd')).toBeUndefined();
      expect(JSON.stringify(result.body)).not.toContain('ROOT_KEYS');
    },
  );

  it('reports the box unreachable when the ended row was opened on another network', async () => {
    const id = generateIdentity();
    const { deps } = ended({ lastEssid: async () => ({ data: 'SOME-OTHER-WIFI', error: null }) });

    const result = await handleResolveCrossPlayerFs(envelope(id, LAN_MACHINE), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });

  it('reports a server error when the ended row cannot be looked up', async () => {
    const id = generateIdentity();
    const { deps } = ended({
      lastEssid: async () => ({ data: ROUTER_ESSID, error: new Error('db down') }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, LAN_MACHINE), deps);

    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
  });

  it('looks for no ended row on a workstation, which occupancy already found', async () => {
    const id = generateIdentity();
    const { deps, findLastSessionEssid } = makeDeps({
      session: async () => ({ data: null, error: null }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id), deps);

    expect(result.status).toBe(200);
    expect(findLastSessionEssid).not.toHaveBeenCalled();
  });
});

const EMAILIT_MACHINE = computeApGatewayId(EMAILIT_NETWORK);

/** emailit.io's box, with the caller's session on it opened from emailit.io's network. */
const onEmailit = (over: Parameters<typeof makeDeps>[0] = {}) =>
  makeDeps({
    occupant: async () => ({ data: null, error: null }),
    session: async () => ({ data: { userType: 'root', essid: EMAILIT_NETWORK }, error: null }),
    patches: async () => ({ data: [], error: null }),
    ...over,
  });

const contentOf = (tree: Directory, ...segments: readonly string[]): string | null => {
  const node = get(tree, ...segments);
  return node?.kind === 'file' ? node.content : null;
};

describe("handleResolveCrossPlayerFs on emailit.io, whose mail lives in the server's tables", () => {
  it('lays every account into the box for a root session', async () => {
    const id = generateIdentity();
    const { deps, findMailSpool } = onEmailit();

    const result = await handleResolveCrossPlayerFs(envelope(id, EMAILIT_MACHINE), deps);
    const tree = treeOf(result);

    expect(result.status).toBe(200);
    expect(contentOf(tree, 'etc', 'emailit', 'passwd')).toBe(`neo:${NEO_HASH}\n`);
    expect(contentOf(tree, 'var', 'mail', 'neo')).toContain('\nSubject: Welcome to emailit.io\n');
    expect(findMailSpool).toHaveBeenCalledTimes(1);
  });

  it('lays an empty spool for a root session when the store has no accounts', async () => {
    const id = generateIdentity();
    const { deps } = onEmailit({ spool: async () => ({ data: null, error: null }) });

    const result = await handleResolveCrossPlayerFs(envelope(id, EMAILIT_MACHINE), deps);
    const tree = treeOf(result);
    const spool = get(tree, 'var', 'mail');

    expect(result.status).toBe(200);
    expect(contentOf(tree, 'etc', 'emailit', 'passwd')).toBe('');
    expect(spool?.kind === 'directory' ? spool.entries.size : null).toBe(0);
  });

  it.each(['user', 'guest'] as const)(
    'reads no table for a %s session, and sends none of it',
    async (userType) => {
      const id = generateIdentity();
      const { deps, findMailSpool } = onEmailit({
        session: async () => ({ data: { userType, essid: EMAILIT_NETWORK }, error: null }),
      });

      const result = await handleResolveCrossPlayerFs(envelope(id, EMAILIT_MACHINE), deps);
      const tree = treeOf(result);

      expect(result.status).toBe(200);
      expect(get(tree, 'var', 'mail')).toBeUndefined();
      expect(get(tree, 'etc', 'emailit')).toBeUndefined();
      expect(findMailSpool).not.toHaveBeenCalled();
    },
  );

  it('reads no table for a caller whose session on the box has ended', async () => {
    const id = generateIdentity();
    const { deps, findMailSpool } = onEmailit({
      session: async () => ({ data: null, error: null }),
      lastEssid: async () => ({ data: EMAILIT_NETWORK, error: null }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, EMAILIT_MACHINE), deps);

    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain(NEO_HASH);
    expect(findMailSpool).not.toHaveBeenCalled();
  });

  it("reads no table for a root session on any other network's box", async () => {
    const id = generateIdentity();
    const { deps, findMailSpool } = onNetworkBox({
      session: async () => ({ data: { userType: 'root', essid: ROUTER_ESSID }, error: null }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, AP_GATEWAY_ID), deps);

    expect(result.status).toBe(200);
    expect(findMailSpool).not.toHaveBeenCalled();
  });

  it("shows a root's write to a mailbox in place of the mailbox", async () => {
    const id = generateIdentity();
    const forged = ownerRow({
      path: '/var/mail/neo',
      content: 'FORGED',
      permissions: MAIL_SPOOL_FILE,
    });
    const { deps } = onEmailit({ patches: async () => ({ data: [forged], error: null }) });

    const result = await handleResolveCrossPlayerFs(envelope(id, EMAILIT_MACHINE), deps);

    expect(contentOf(treeOf(result), 'var', 'mail', 'neo')).toBe('FORGED');
  });

  it("shows a root's rm of the passwd file, and of the whole spool", async () => {
    const id = generateIdentity();
    const { deps } = onEmailit({
      patches: async () => ({
        data: [
          ownerRow({ path: '/etc/emailit/passwd', content: null, permissions: null }),
          ownerRow({ path: '/var/mail', content: null, permissions: null }),
        ],
        error: null,
      }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, EMAILIT_MACHINE), deps);
    const tree = treeOf(result);

    expect(result.status).toBe(200);
    expect(get(tree, 'etc', 'emailit', 'passwd')).toBeUndefined();
    expect(get(tree, 'var', 'mail')).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain(NEO_HASH);
  });

  it('reports a server error, not an empty spool, when the tables cannot be read', async () => {
    const id = generateIdentity();
    const { deps } = onEmailit({
      spool: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, EMAILIT_MACHINE), deps);

    expect(result).toEqual({ status: 500, body: { error: 'mail_spool_lookup_failed' } });
  });
});

const BOARD_SERVER_MACHINE = computeApGatewayId(BOARD_SERVER_NETWORK);

/** The boards' server, with the caller's session on it opened from its network. */
const onBoardServer = (over: Parameters<typeof makeDeps>[0] = {}) =>
  makeDeps({
    occupant: async () => ({ data: null, error: null }),
    session: async () => ({
      data: { userType: 'root', essid: BOARD_SERVER_NETWORK },
      error: null,
    }),
    patches: async () => ({ data: [], error: null }),
    ...over,
  });

describe("handleResolveCrossPlayerFs on the boards' server, whose list is the boards' table", () => {
  it('lays every board into the box for a root session, root-only', async () => {
    const id = generateIdentity();
    const { deps, findBoards } = onBoardServer();

    const result = await handleResolveCrossPlayerFs(envelope(id, BOARD_SERVER_MACHINE), deps);
    const tree = treeOf(result);

    expect(result.status).toBe(200);
    expect(contentOf(tree, 'etc', 'hireme', 'boards')).toBe(`neo ${NEO_BOARD}\n`);
    expect(get(tree, 'etc', 'hireme', 'boards')).toMatchObject({ perms: ROOT_FILE });
    expect(findBoards).toHaveBeenCalledTimes(1);
  });

  it('lays an empty list for a root session when nobody has applied', async () => {
    const id = generateIdentity();
    const { deps } = onBoardServer({ boards: async () => ({ data: null, error: null }) });

    const result = await handleResolveCrossPlayerFs(envelope(id, BOARD_SERVER_MACHINE), deps);

    expect(result.status).toBe(200);
    expect(contentOf(treeOf(result), 'etc', 'hireme', 'boards')).toBe('');
  });

  it.each(['user', 'guest'] as const)(
    'reads no table for a %s session, and sends none of it',
    async (userType) => {
      const id = generateIdentity();
      const { deps, findBoards } = onBoardServer({
        session: async () => ({ data: { userType, essid: BOARD_SERVER_NETWORK }, error: null }),
      });

      const result = await handleResolveCrossPlayerFs(envelope(id, BOARD_SERVER_MACHINE), deps);

      expect(result.status).toBe(200);
      expect(get(treeOf(result), 'etc', 'hireme')).toBeUndefined();
      expect(JSON.stringify(result.body)).not.toContain(NEO_BOARD);
      expect(findBoards).not.toHaveBeenCalled();
    },
  );

  it('reads no table for a caller whose session on the box has ended', async () => {
    const id = generateIdentity();
    const { deps, findBoards } = onBoardServer({
      session: async () => ({ data: null, error: null }),
      lastEssid: async () => ({ data: BOARD_SERVER_NETWORK, error: null }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, BOARD_SERVER_MACHINE), deps);

    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain(NEO_BOARD);
    expect(findBoards).not.toHaveBeenCalled();
  });

  it('reads no boards for a root on emailit.io, and no mail for a root here', async () => {
    const id = generateIdentity();
    const emailit = onEmailit();
    const boards = onBoardServer();

    await handleResolveCrossPlayerFs(envelope(id, EMAILIT_MACHINE), emailit.deps);
    await handleResolveCrossPlayerFs(envelope(id, BOARD_SERVER_MACHINE), boards.deps);

    expect(emailit.findBoards).not.toHaveBeenCalled();
    expect(boards.findMailSpool).not.toHaveBeenCalled();
  });

  it("shows a root's rewrite of the list in place of the list", async () => {
    const id = generateIdentity();
    const forged = ownerRow({
      path: '/etc/hireme/boards',
      content: 'trin 194.1.1.1\n',
      permissions: ROOT_FILE,
    });
    const { deps } = onBoardServer({ patches: async () => ({ data: [forged], error: null }) });

    const result = await handleResolveCrossPlayerFs(envelope(id, BOARD_SERVER_MACHINE), deps);

    expect(contentOf(treeOf(result), 'etc', 'hireme', 'boards')).toBe('trin 194.1.1.1\n');
  });

  it("shows a root's rm of the list", async () => {
    const id = generateIdentity();
    const { deps } = onBoardServer({
      patches: async () => ({
        data: [ownerRow({ path: '/etc/hireme/boards', content: null, permissions: null })],
        error: null,
      }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, BOARD_SERVER_MACHINE), deps);

    expect(result.status).toBe(200);
    expect(get(treeOf(result), 'etc', 'hireme', 'boards')).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain(NEO_BOARD);
  });

  it('reports a server error, not an empty list, when the table cannot be read', async () => {
    const id = generateIdentity();
    const { deps } = onBoardServer({
      boards: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleResolveCrossPlayerFs(envelope(id, BOARD_SERVER_MACHINE), deps);

    expect(result).toEqual({ status: 500, body: { error: 'boards_lookup_failed' } });
  });
});
