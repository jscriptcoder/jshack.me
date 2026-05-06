import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePatchesRequest } from './handler';
import type {
  ClearPatchesParams,
  ClearPatchesResult,
  FilePermissions,
  ListPatchesForMachinesParams,
  ListPatchesForMachinesResult,
  PatchRow,
  PatchSummary,
  RemovePatchParams,
  RemovePatchResult,
  UpsertPatchResult,
} from './types';
type PublishPatchChange = (machine_id: string, originator_key: string) => Promise<void>;
import type {
  FindActiveSessionParams,
  FindActiveSessionResult,
} from '../sessionRegistry/supabaseFindActive';
import type { FindMachineFsParams, FindMachineFsResult } from './supabaseFindMachineFs';
import type {
  FindMachineFsBatchParams,
  FindMachineFsBatchResult,
} from './supabaseFindMachineFsBatch';
import type {
  FindActiveSessionsBatchParams,
  FindActiveSessionsBatchResult,
} from '../sessionRegistry/supabaseFindActiveBatch';
import type { RateLimiter } from '../ipRegistry/rateLimit';
import { noopRateLimiter } from '../ipRegistry/rateLimit';
import { noopNonceStore, type NonceStore } from '../signedRequest/nonceStore';
import { generateIdentity, type Identity } from '../identity/identity';
import { signRequest } from '../signedRequest/sign';
import { deriveHostnameSuffix } from '../homeNetworks/homeNetworkHelpers';

// Real signing in tests — handler-side behaviour is tightly coupled to
// the signing flow, so end-to-end tests are clearer than mocking verify.
const FIXED_NOW = 1_700_000_000_000;

type Fields = Record<string, unknown>;

const makeEnvelope = (
  identity: Identity,
  fields: Fields = {
    action: 'upsertPatch',
    machine_id: '10.0.0.1',
    path: '/tmp/foo.txt',
    content: 'hello',
    owner: 'user',
  },
) => {
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    const { action, ...rest } = fields as { action?: string };
    return signRequest(identity, action ?? 'upsertPatch', rest);
  } finally {
    Date.now = realNow;
  }
};

const mkDeps = (overrides: {
  readonly upsertPatch?: (row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>;
  readonly removePatch?: (params: RemovePatchParams) => Promise<RemovePatchResult>;
  readonly listPatchesForMachines?: (
    params: ListPatchesForMachinesParams,
  ) => Promise<ListPatchesForMachinesResult>;
  readonly clearOwnedPatches?: (params: ClearPatchesParams) => Promise<ClearPatchesResult>;
  readonly findActiveSession?: (
    params: FindActiveSessionParams,
  ) => Promise<FindActiveSessionResult>;
  readonly findMachineFs?: (params: FindMachineFsParams) => Promise<FindMachineFsResult>;
  readonly findMachineFsBatch?: (
    params: FindMachineFsBatchParams,
  ) => Promise<FindMachineFsBatchResult>;
  readonly findActiveSessionsBatch?: (
    params: FindActiveSessionsBatchParams,
  ) => Promise<FindActiveSessionsBatchResult>;
  readonly publishPatchChange?: PublishPatchChange;
  readonly rateLimiter?: RateLimiter;
  readonly nonceStore?: NonceStore;
  readonly now?: () => number;
}) => ({
  upsertPatch:
    overrides.upsertPatch ??
    vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true }),
  removePatch:
    overrides.removePatch ??
    vi
      .fn<(params: RemovePatchParams) => Promise<RemovePatchResult>>()
      .mockResolvedValue({ ok: true, affected: 1 }),
  listPatchesForMachines:
    overrides.listPatchesForMachines ??
    vi
      .fn<(params: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({ ok: true, patches: [] }),
  clearOwnedPatches:
    overrides.clearOwnedPatches ??
    vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: true, affected: 0 }),
  // Default: gate always passes. Session-specific tests override per-case.
  // Default credentials are user-typed for cross-machine sessions; L2-specific
  // tests override to root or guest as needed.
  findActiveSession:
    overrides.findActiveSession ??
    vi
      .fn<(params: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
      .mockResolvedValue({
        ok: true,
        exists: true,
        credentials: { username: 'alice', userType: 'user' },
      }),
  // Default: machine_filesystems has no row → permissive fallback. L2-specific
  // tests override to inject a target row with explicit permissions.
  findMachineFs:
    overrides.findMachineFs ??
    vi
      .fn<(params: FindMachineFsParams) => Promise<FindMachineFsResult>>()
      .mockResolvedValue({ ok: true, found: false }),
  // Read-path filter (listPatchesForMachines) bulk lookups. Defaults are
  // empty → no FS rows known → leaf-only fallback per row, no sessions
  // → tier-3 allowlist applies. Tests override to exercise tiers 1/2.
  findMachineFsBatch:
    overrides.findMachineFsBatch ??
    vi
      .fn<(params: FindMachineFsBatchParams) => Promise<FindMachineFsBatchResult>>()
      .mockResolvedValue({ ok: true, rows: [] }),
  findActiveSessionsBatch:
    overrides.findActiveSessionsBatch ??
    vi
      .fn<(params: FindActiveSessionsBatchParams) => Promise<FindActiveSessionsBatchResult>>()
      .mockResolvedValue({ ok: true, sessionsByMachine: new Map() }),
  publishPatchChange:
    overrides.publishPatchChange ?? vi.fn<PublishPatchChange>().mockResolvedValue(undefined),
  rateLimiter: overrides.rateLimiter ?? noopRateLimiter,
  nonceStore: overrides.nonceStore ?? noopNonceStore,
  now: overrides.now ?? (() => FIXED_NOW),
});

// -----------------------------------------------------------------------
// upsertPatch
// -----------------------------------------------------------------------

describe('handlePatchesRequest — upsertPatch', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  const validUpsertPayload = {
    action: 'upsertPatch',
    machine_id: '10.0.0.1',
    path: '/tmp/foo.txt',
    content: 'hello',
    owner: 'user',
  };

  it('returns 200 with empty body on a valid upsert', async () => {
    const envelope = makeEnvelope(identity, validUpsertPayload);
    const result = await handlePatchesRequest(envelope, mkDeps({}));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({});
  });

  it('stamps player_key from verified public key (server-side, not client-trusted)', async () => {
    const upsertPatch = vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true });
    const envelope = makeEnvelope(identity, validUpsertPayload);

    await handlePatchesRequest(envelope, mkDeps({ upsertPatch }));

    // The handler fills in default permissions + node_type when the
    // client omits them, so machine_filesystems gets a row dual-written
    // (no IS NOT NULL skip). Defaults match the shared
    // defaultPermissions module — for a user-owned file, that's
    // root+user read/write, root-only execute.
    expect(upsertPatch).toHaveBeenCalledWith(
      {
        player_key: identity.publicKeyHex,
        machine_id: '10.0.0.1',
        path: '/tmp/foo.txt',
        content: 'hello',
        owner: 'user',
        permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
        node_type: 'file',
      },
      true,
    );
  });

  it('fills in default permissions + node_type when the client omits them', async () => {
    // Pinned: this is the L2 enforcement gap fix. Without server-side
    // defaults, a patch with no permissions skipped the dual-write
    // (machine_filesystems.permissions is NOT NULL) and L2 fell back
    // to "no row → allow" on subsequent writes to that path. A
    // malicious client could exploit that to land files invisibly to
    // L2. Fix: handler fills in defaults derived from owner +
    // node_type before passing to the upsert RPC.
    const upsertPatch = vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true });
    const envelope = makeEnvelope(identity, {
      action: 'upsertPatch',
      machine_id: '10.0.0.1',
      path: '/tmp/guest-file',
      content: 'data',
      owner: 'guest',
    });

    await handlePatchesRequest(envelope, mkDeps({ upsertPatch }));

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'guest',
        permissions: { read: ['root', 'guest'], write: ['root', 'guest'], execute: ['root'] },
        node_type: 'file',
      }),
      true,
    );
  });

  it('uses directory defaults when node_type=directory and permissions omitted', async () => {
    const upsertPatch = vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true });
    const envelope = makeEnvelope(identity, {
      action: 'upsertPatch',
      machine_id: '10.0.0.1',
      path: '/tmp/newdir',
      content: null,
      owner: 'user',
      node_type: 'directory',
    });

    await handlePatchesRequest(envelope, mkDeps({ upsertPatch }));

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'user',
        // Directory default: world-traversable, world-readable, owner-writable.
        permissions: {
          read: ['root', 'user', 'guest'],
          write: ['root', 'user'],
          execute: ['root', 'user', 'guest'],
        },
        node_type: 'directory',
      }),
      true,
    );
  });

  it('preserves explicit permissions when the client supplies them (no clobbering)', async () => {
    const customPerms = {
      read: ['root', 'user'] as const,
      write: ['root'] as const,
      execute: ['root', 'user', 'guest'] as const,
    };
    const upsertPatch = vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true });
    const envelope = makeEnvelope(identity, {
      action: 'upsertPatch',
      machine_id: '10.0.0.1',
      path: '/srv/script.sh',
      content: '#!/bin/sh\n',
      owner: 'root',
      permissions: customPerms,
    });

    await handlePatchesRequest(envelope, mkDeps({ upsertPatch }));

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: customPerms }),
      true,
    );
  });

  it('passes through optional permissions, is_new, node_type', async () => {
    const upsertPatch = vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true });
    const permissions = {
      read: ['root', 'user'] as const,
      write: ['root'] as const,
      execute: ['root'] as const,
    };
    const envelope = makeEnvelope(identity, {
      action: 'upsertPatch',
      machine_id: '10.0.0.1',
      path: '/srv/data',
      content: null,
      owner: 'root',
      permissions,
      is_new: true,
      node_type: 'directory',
    });

    await handlePatchesRequest(envelope, mkDeps({ upsertPatch }));

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions,
        is_new: true,
        node_type: 'directory',
        content: null,
      }),
      true,
    );
  });

  it('accepts content === null (deletion-of-base-file marker)', async () => {
    const upsertPatch = vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true });
    const envelope = makeEnvelope(identity, {
      action: 'upsertPatch',
      machine_id: '10.0.0.1',
      path: '/etc/passwd',
      content: null,
      owner: 'root',
    });

    const result = await handlePatchesRequest(envelope, mkDeps({ upsertPatch }));

    expect(result.status).toBe(200);
    expect(upsertPatch).toHaveBeenCalledWith(expect.objectContaining({ content: null }), true);
  });

  it('replaces NUL bytes in content with U+FFFD (Postgres TEXT rejects U+0000)', async () => {
    // Mock binary file contents in the game (e.g. /usr/bin/nmap's ELF
    // placeholder) carry NUL bytes — Postgres rejects them with 22P05.
    // Sanitization at the handler level (vs the client wrapper) is
    // defense-in-depth: even hand-crafted Burp envelopes get cleaned.
    const upsertPatch = vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true });
    const NUL = String.fromCharCode(0);
    const FFFD = String.fromCharCode(0xfffd);
    const envelope = makeEnvelope(identity, {
      action: 'upsertPatch',
      machine_id: '10.0.0.1',
      path: '/usr/bin/nmap',
      content: `ELF${NUL}${NUL}${NUL}binary`,
      owner: 'root',
    });

    const result = await handlePatchesRequest(envelope, mkDeps({ upsertPatch }));

    expect(result.status).toBe(200);
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `ELF${FFFD}${FFFD}${FFFD}binary`,
      }),
      true,
    );
  });

  it('returns 500 when the supabase upsert fails', async () => {
    const upsertPatch = vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: false });
    const envelope = makeEnvelope(identity, validUpsertPayload);
    const result = await handlePatchesRequest(envelope, mkDeps({ upsertPatch }));
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'upsert_failed' });
  });

  describe('schema validation', () => {
    it('returns 400 if client supplies player_key (strict schema rejects unknown fields)', async () => {
      const envelope = makeEnvelope(identity, {
        ...validUpsertPayload,
        player_key: 'ed25519:attacker',
      });
      const result = await handlePatchesRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: 'payload_invalid' });
    });

    it('returns 400 when machine_id is missing', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'upsertPatch',
        path: '/tmp/foo.txt',
        content: 'x',
        owner: 'user',
      });
      const result = await handlePatchesRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when path is missing', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'upsertPatch',
        machine_id: '10.0.0.1',
        content: 'x',
        owner: 'user',
      });
      const result = await handlePatchesRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when content is missing (must be string|null, not undefined)', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'upsertPatch',
        machine_id: '10.0.0.1',
        path: '/tmp/foo.txt',
        owner: 'user',
      });
      const result = await handlePatchesRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when owner is not in the user-type enum', async () => {
      const envelope = makeEnvelope(identity, {
        ...validUpsertPayload,
        owner: 'admin',
      });
      const result = await handlePatchesRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when permissions has unknown user type', async () => {
      const envelope = makeEnvelope(identity, {
        ...validUpsertPayload,
        permissions: {
          read: ['admin'],
          write: ['root'],
          execute: ['root'],
        },
      });
      const result = await handlePatchesRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when node_type is unknown', async () => {
      const envelope = makeEnvelope(identity, {
        ...validUpsertPayload,
        node_type: 'symlink',
      });
      const result = await handlePatchesRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });
  });
});

// -----------------------------------------------------------------------
// removePatch
// -----------------------------------------------------------------------

describe('handlePatchesRequest — removePatch', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  const validRemovePayload = {
    action: 'removePatch',
    machine_id: '10.0.0.1',
    path: '/tmp/foo.txt',
  };

  it('returns 200 with affected count on a valid remove', async () => {
    const removePatch = vi
      .fn<(params: RemovePatchParams) => Promise<RemovePatchResult>>()
      .mockResolvedValue({ ok: true, affected: 3 });
    const envelope = makeEnvelope(identity, validRemovePayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ removePatch }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ affected: 3 });
  });

  it('returns 200 with affected = 0 when no rows matched (idempotent removal)', async () => {
    const removePatch = vi
      .fn<(params: RemovePatchParams) => Promise<RemovePatchResult>>()
      .mockResolvedValue({ ok: true, affected: 0 });
    const envelope = makeEnvelope(identity, validRemovePayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ removePatch }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ affected: 0 });
  });

  it('calls removePatch with verified pubkey as player_key', async () => {
    const removePatch = vi
      .fn<(params: RemovePatchParams) => Promise<RemovePatchResult>>()
      .mockResolvedValue({ ok: true, affected: 1 });
    const envelope = makeEnvelope(identity, validRemovePayload);

    await handlePatchesRequest(envelope, mkDeps({ removePatch }));

    expect(removePatch).toHaveBeenCalledWith({
      player_key: identity.publicKeyHex,
      machine_id: '10.0.0.1',
      path: '/tmp/foo.txt',
      dual_write: true,
    });
  });

  it('returns 500 when the supabase delete errors', async () => {
    const removePatch = vi
      .fn<(params: RemovePatchParams) => Promise<RemovePatchResult>>()
      .mockResolvedValue({ ok: false });
    const envelope = makeEnvelope(identity, validRemovePayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ removePatch }));

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'remove_failed' });
  });

  describe('schema validation', () => {
    it('returns 400 when machine_id is missing', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'removePatch',
        path: '/tmp/foo.txt',
      });
      const result = await handlePatchesRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when path is missing', async () => {
      const envelope = makeEnvelope(identity, {
        action: 'removePatch',
        machine_id: '10.0.0.1',
      });
      const result = await handlePatchesRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });

    it('returns 400 when client supplies unknown extra fields', async () => {
      const envelope = makeEnvelope(identity, {
        ...validRemovePayload,
        admin: true,
      });
      const result = await handlePatchesRequest(envelope, mkDeps({}));
      expect(result.status).toBe(400);
    });
  });
});

// -----------------------------------------------------------------------
// listPatchesForMachines (cross-player read)
// -----------------------------------------------------------------------

describe('handlePatchesRequest — listPatchesForMachines', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  const validPayload = {
    action: 'listPatchesForMachines',
    machine_ids: ['10.0.0.1', 'localhost'],
  };

  // Two patches at the same path on the same machine, written by
  // different players — exactly what cross-player read needs to surface.
  // Path is on the externally-observable allowlist (daemon liveness)
  // so the read-path filter's tier 3 default-deny doesn't drop them
  // when the requester has no session on the machine. The cross-author
  // property under test is orthogonal to the filter — handled by the
  // dedicated tier tests in the read-path filter describe block below.
  const patchFromPlayerA: PatchSummary = {
    machine_id: '10.0.0.1',
    path: '/var/run/sshd.pid',
    content: 'pid-from-A',
    owner: 'root',
    permissions: null,
    is_new: false,
    node_type: 'file',
  };

  const patchFromPlayerB: PatchSummary = {
    machine_id: '10.0.0.1',
    path: '/var/run/sshd.pid',
    content: 'pid-from-B',
    owner: 'root',
    permissions: null,
    is_new: false,
    node_type: 'file',
  };

  it('returns 200 with multi-author patches array', async () => {
    const listPatchesForMachines = vi
      .fn<(params: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({ ok: true, patches: [patchFromPlayerA, patchFromPlayerB] });
    const envelope = makeEnvelope(identity, validPayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ listPatchesForMachines }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ patches: [patchFromPlayerA, patchFromPlayerB] });
  });

  it('returns 200 with empty array when no patches exist for those machines', async () => {
    const envelope = makeEnvelope(identity, validPayload);

    const result = await handlePatchesRequest(envelope, mkDeps({}));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ patches: [] });
  });

  it('forwards machine_ids verbatim and stamps verified player_key onto adapter call', async () => {
    const listPatchesForMachines = vi
      .fn<(params: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({ ok: true, patches: [] });
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: ['10.0.0.5', '10.0.0.6', '10.0.0.7'],
    });

    await handlePatchesRequest(envelope, mkDeps({ listPatchesForMachines }));

    expect(listPatchesForMachines).toHaveBeenCalledWith({
      machine_ids: ['10.0.0.5', '10.0.0.6', '10.0.0.7'],
      player_key: identity.publicKeyHex,
    });
  });

  it('stamps player_key from verified pubkey, never client-trusted', async () => {
    // Even if a client-side payload could carry a player_key (it can't —
    // schema rejects it via .strict()), the handler must always derive
    // player_key from verifySignedRequest, not the wire envelope.
    const listPatchesForMachines = vi
      .fn<(params: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({ ok: true, patches: [] });
    const envelope = makeEnvelope(identity, validPayload);

    await handlePatchesRequest(envelope, mkDeps({ listPatchesForMachines }));

    const call = listPatchesForMachines.mock.calls[0][0];
    expect(call.player_key).toBe(identity.publicKeyHex);
  });

  it('returns 500 when the DB query errors', async () => {
    const listPatchesForMachines = vi
      .fn<(params: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({ ok: false });
    const envelope = makeEnvelope(identity, validPayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ listPatchesForMachines }));

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'query_failed' });
  });

  it('does NOT call the single-row findActiveSession (read-path uses findActiveSessionsBatch)', async () => {
    // The single-row adapter is a write-path L1 helper. Reads use the
    // batch variant for per-machine tier dispatch — exercised by the
    // dedicated tier tests below. This test pins the adapter
    // separation so a future refactor can't silently route reads
    // through the L1 helper and break the tier semantics.
    const findActiveSession = vi
      .fn<(params: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
      .mockResolvedValue({
        ok: true,
        exists: true,
        credentials: { username: 'alice', userType: 'user' },
      });
    const envelope = makeEnvelope(identity, validPayload);

    await handlePatchesRequest(envelope, mkDeps({ findActiveSession }));

    expect(findActiveSession).not.toHaveBeenCalled();
  });

  it('returns 400 when machine_ids is empty', async () => {
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: [],
    });
    const result = await handlePatchesRequest(envelope, mkDeps({}));
    expect(result.status).toBe(400);
  });

  it('returns 400 when machine_ids is missing', async () => {
    const envelope = makeEnvelope(identity, { action: 'listPatchesForMachines' });
    const result = await handlePatchesRequest(envelope, mkDeps({}));
    expect(result.status).toBe(400);
  });
});

// -----------------------------------------------------------------------
// listPatchesForMachines — three-tier read filter
// (Tier 1: owner / Tier 2: session+walker / Tier 3: no-session+allowlist)
// -----------------------------------------------------------------------

describe('handlePatchesRequest — listPatchesForMachines (read-path filter)', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  // Path constants used across tier tests so the intent is visible
  // without scrolling.
  const ALLOWLIST_PATH = '/var/run/sshd.pid';
  const SECRET_PATH = '/etc/passwd';
  const ROOT_NOTES = '/root/.notes';

  const ownWorkstationId = (id: Identity, name = 'mybox'): string =>
    `${name}-${deriveHostnameSuffix(`ed25519:${id.publicKeyHex}`)}`;

  const mkPatch = (machine_id: string, path: string): PatchSummary => ({
    machine_id,
    path,
    content: 'data',
    owner: 'root',
    permissions: null,
    is_new: false,
    node_type: 'file',
  });

  const allTypesReadable: FilePermissions = {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  };
  const rootOnlyReadable: FilePermissions = {
    read: ['root'],
    write: ['root'],
    execute: ['root'],
  };

  it("returns all rows for the requester's own workstation (tier 1: owner bypass)", async () => {
    const ownId = ownWorkstationId(identity);
    const listPatchesForMachines = vi
      .fn<(p: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({
        ok: true,
        patches: [mkPatch(ownId, ROOT_NOTES), mkPatch(ownId, '/etc/passwd')],
      });
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: [ownId],
    });

    const result = await handlePatchesRequest(envelope, mkDeps({ listPatchesForMachines }));

    expect(result.status).toBe(200);
    expect((result.body as { patches: ReadonlyArray<PatchSummary> }).patches).toHaveLength(2);
  });

  it('drops sensitive rows for a no-session caller; allowlist paths still pass (tier 3)', async () => {
    const listPatchesForMachines = vi
      .fn<(p: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({
        ok: true,
        patches: [
          mkPatch('10.0.0.5', ALLOWLIST_PATH),
          mkPatch('10.0.0.5', SECRET_PATH),
          mkPatch('10.0.0.5', ROOT_NOTES),
        ],
      });
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: ['10.0.0.5'],
    });

    const result = await handlePatchesRequest(envelope, mkDeps({ listPatchesForMachines }));

    expect(result.status).toBe(200);
    const patches = (result.body as { patches: ReadonlyArray<PatchSummary> }).patches;
    expect(patches.map((p) => p.path)).toEqual([ALLOWLIST_PATH]);
  });

  it('passes walker-allowed paths for a session caller as user (tier 2)', async () => {
    const machine = '10.0.0.5';
    const listPatchesForMachines = vi
      .fn<(p: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({
        ok: true,
        patches: [mkPatch(machine, '/tmp/note.txt'), mkPatch(machine, ROOT_NOTES)],
      });
    const findActiveSessionsBatch = vi
      .fn<(p: FindActiveSessionsBatchParams) => Promise<FindActiveSessionsBatchResult>>()
      .mockResolvedValue({
        ok: true,
        sessionsByMachine: new Map([[machine, { username: 'alice', userType: 'user' as const }]]),
      });
    const findMachineFsBatch = vi
      .fn<(p: FindMachineFsBatchParams) => Promise<FindMachineFsBatchResult>>()
      .mockResolvedValue({
        ok: true,
        rows: [
          {
            machine_id: machine,
            path: '/tmp/note.txt',
            owner: 'user',
            permissions: allTypesReadable,
          },
          {
            machine_id: machine,
            path: ROOT_NOTES,
            owner: 'root',
            permissions: rootOnlyReadable,
          },
        ],
      });
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: [machine],
    });

    const result = await handlePatchesRequest(
      envelope,
      mkDeps({ listPatchesForMachines, findActiveSessionsBatch, findMachineFsBatch }),
    );

    expect(result.status).toBe(200);
    const patches = (result.body as { patches: ReadonlyArray<PatchSummary> }).patches;
    expect(patches.map((p) => p.path)).toEqual(['/tmp/note.txt']);
  });

  it('returns everything to a session caller as root (tier 2 walker root bypass)', async () => {
    const machine = '10.0.0.5';
    const listPatchesForMachines = vi
      .fn<(p: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({
        ok: true,
        patches: [mkPatch(machine, ROOT_NOTES), mkPatch(machine, '/var/log/auth.log')],
      });
    const findActiveSessionsBatch = vi
      .fn<(p: FindActiveSessionsBatchParams) => Promise<FindActiveSessionsBatchResult>>()
      .mockResolvedValue({
        ok: true,
        sessionsByMachine: new Map([[machine, { username: 'admin', userType: 'root' as const }]]),
      });
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: [machine],
    });

    const result = await handlePatchesRequest(
      envelope,
      mkDeps({ listPatchesForMachines, findActiveSessionsBatch }),
    );

    expect(result.status).toBe(200);
    const patches = (result.body as { patches: ReadonlyArray<PatchSummary> }).patches;
    expect(patches).toHaveLength(2);
  });

  it('mixed batch: owner machine + session machine + no-session machine (each tier)', async () => {
    const ownId = ownWorkstationId(identity);
    const sessionMachine = '10.0.0.5';
    const noSessionMachine = '10.0.0.6';
    const listPatchesForMachines = vi
      .fn<(p: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({
        ok: true,
        patches: [
          mkPatch(ownId, ROOT_NOTES), // tier 1 — keep
          mkPatch(sessionMachine, ROOT_NOTES), // tier 2 walker → drop (guest can't read root)
          mkPatch(sessionMachine, ALLOWLIST_PATH), // tier 2 walker → keep (default perms)
          mkPatch(noSessionMachine, SECRET_PATH), // tier 3 → drop
          mkPatch(noSessionMachine, ALLOWLIST_PATH), // tier 3 → keep
        ],
      });
    const findActiveSessionsBatch = vi
      .fn<(p: FindActiveSessionsBatchParams) => Promise<FindActiveSessionsBatchResult>>()
      .mockResolvedValue({
        ok: true,
        sessionsByMachine: new Map([
          [sessionMachine, { username: 'alice', userType: 'guest' as const }],
        ]),
      });
    const findMachineFsBatch = vi
      .fn<(p: FindMachineFsBatchParams) => Promise<FindMachineFsBatchResult>>()
      .mockResolvedValue({
        ok: true,
        rows: [
          {
            machine_id: sessionMachine,
            path: ROOT_NOTES,
            owner: 'root',
            permissions: rootOnlyReadable,
          },
        ],
      });
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: [ownId, sessionMachine, noSessionMachine],
    });

    const result = await handlePatchesRequest(
      envelope,
      mkDeps({ listPatchesForMachines, findActiveSessionsBatch, findMachineFsBatch }),
    );

    expect(result.status).toBe(200);
    const patches = (result.body as { patches: ReadonlyArray<PatchSummary> }).patches;
    expect(patches.map((p) => `${p.machine_id}:${p.path}`)).toEqual([
      `${ownId}:${ROOT_NOTES}`,
      `${sessionMachine}:${ALLOWLIST_PATH}`,
      `${noSessionMachine}:${ALLOWLIST_PATH}`,
    ]);
  });

  it('returns 500 fs_lookup_failed when findMachineFsBatch errors', async () => {
    const findMachineFsBatch = vi
      .fn<(p: FindMachineFsBatchParams) => Promise<FindMachineFsBatchResult>>()
      .mockResolvedValue({ ok: false });
    const listPatchesForMachines = vi
      .fn<(p: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({ ok: true, patches: [mkPatch('10.0.0.5', ALLOWLIST_PATH)] });
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: ['10.0.0.5'],
    });

    const result = await handlePatchesRequest(
      envelope,
      mkDeps({ listPatchesForMachines, findMachineFsBatch }),
    );

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'fs_lookup_failed' });
  });

  it('returns 500 session_lookup_failed when findActiveSessionsBatch errors', async () => {
    const findActiveSessionsBatch = vi
      .fn<(p: FindActiveSessionsBatchParams) => Promise<FindActiveSessionsBatchResult>>()
      .mockResolvedValue({ ok: false });
    const listPatchesForMachines = vi
      .fn<(p: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({ ok: true, patches: [mkPatch('10.0.0.5', ALLOWLIST_PATH)] });
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: ['10.0.0.5'],
    });

    const result = await handlePatchesRequest(
      envelope,
      mkDeps({ listPatchesForMachines, findActiveSessionsBatch }),
    );

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'session_lookup_failed' });
  });

  it('invokes both bulk lookups with the requested machine_ids', async () => {
    const findMachineFsBatch = vi
      .fn<(p: FindMachineFsBatchParams) => Promise<FindMachineFsBatchResult>>()
      .mockResolvedValue({ ok: true, rows: [] });
    const findActiveSessionsBatch = vi
      .fn<(p: FindActiveSessionsBatchParams) => Promise<FindActiveSessionsBatchResult>>()
      .mockResolvedValue({ ok: true, sessionsByMachine: new Map() });
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: ['10.0.0.5', '10.0.0.6'],
    });

    await handlePatchesRequest(envelope, mkDeps({ findMachineFsBatch, findActiveSessionsBatch }));

    expect(findMachineFsBatch).toHaveBeenCalledWith({
      machine_ids: ['10.0.0.5', '10.0.0.6'],
    });
    expect(findActiveSessionsBatch).toHaveBeenCalledWith({
      player_key: identity.publicKeyHex,
      machine_ids: ['10.0.0.5', '10.0.0.6'],
    });
  });

  it('preserves input ordering of kept rows', async () => {
    const listPatchesForMachines = vi
      .fn<(p: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({
        ok: true,
        patches: [
          mkPatch('a', ALLOWLIST_PATH),
          mkPatch('b', SECRET_PATH), // dropped
          mkPatch('c', ALLOWLIST_PATH),
        ],
      });
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: ['a', 'b', 'c'],
    });

    const result = await handlePatchesRequest(envelope, mkDeps({ listPatchesForMachines }));

    const patches = (result.body as { patches: ReadonlyArray<PatchSummary> }).patches;
    expect(patches.map((p) => p.machine_id)).toEqual(['a', 'c']);
  });
});

// -----------------------------------------------------------------------
// clearOwnedPatches
// -----------------------------------------------------------------------

describe('handlePatchesRequest — clearOwnedPatches', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  // Tests carry a static workstation_id in the signed payload — server-
  // side handler forwards it verbatim to the clearOwnedPatches adapter
  // alongside the verified player_key.
  const TEST_WORKSTATION_ID = 'skylab-aabbccdd';
  const validClearOwnedPayload = {
    action: 'clearOwnedPatches',
    workstation_id: TEST_WORKSTATION_ID,
  };

  it('returns 200 with affected count', async () => {
    const clearOwnedPatches = vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: true, affected: 42 });
    const envelope = makeEnvelope(identity, validClearOwnedPayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ clearOwnedPatches }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ affected: 42 });
  });

  it('queries with verified pubkey as player_key and the supplied workstation_id', async () => {
    const clearOwnedPatches = vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: true, affected: 0 });
    const envelope = makeEnvelope(identity, validClearOwnedPayload);

    await handlePatchesRequest(envelope, mkDeps({ clearOwnedPatches }));

    expect(clearOwnedPatches).toHaveBeenCalledWith({
      player_key: identity.publicKeyHex,
      workstation_id: TEST_WORKSTATION_ID,
    });
  });

  it('returns 500 when the DB delete errors', async () => {
    const clearOwnedPatches = vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: false });
    const envelope = makeEnvelope(identity, validClearOwnedPayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ clearOwnedPatches }));

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'clear_failed' });
  });

  it('returns 400 when client supplies unknown extra fields', async () => {
    const envelope = makeEnvelope(identity, {
      action: 'clearOwnedPatches',
      workstation_id: TEST_WORKSTATION_ID,
      foo: 'bar',
    });
    const result = await handlePatchesRequest(envelope, mkDeps({}));
    expect(result.status).toBe(400);
  });

  it('returns 400 when workstation_id is missing', async () => {
    const envelope = makeEnvelope(identity, { action: 'clearOwnedPatches' });
    const result = await handlePatchesRequest(envelope, mkDeps({}));
    expect(result.status).toBe(400);
  });
});

// -----------------------------------------------------------------------
// Cross-action isolation — each action calls only its own adapter
// -----------------------------------------------------------------------

describe('handlePatchesRequest — cross-action isolation', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  const otherAdapters = (
    overrides: Parameters<typeof mkDeps>[0],
  ): Parameters<typeof mkDeps>[0] => ({
    upsertPatch: vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true }),
    removePatch: vi
      .fn<(params: RemovePatchParams) => Promise<RemovePatchResult>>()
      .mockResolvedValue({ ok: true, affected: 1 }),
    listPatchesForMachines: vi
      .fn<(params: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({ ok: true, patches: [] }),
    clearOwnedPatches: vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: true, affected: 0 }),
    ...overrides,
  });

  it('upsertPatch action calls only upsertPatch adapter', async () => {
    const adapters = otherAdapters({});
    const envelope = makeEnvelope(identity); // default = upsertPatch
    await handlePatchesRequest(envelope, mkDeps(adapters));
    expect(adapters.upsertPatch).toHaveBeenCalled();
    expect(adapters.removePatch).not.toHaveBeenCalled();
    expect(adapters.listPatchesForMachines).not.toHaveBeenCalled();
    expect(adapters.clearOwnedPatches).not.toHaveBeenCalled();
  });

  it('removePatch action calls only removePatch adapter', async () => {
    const adapters = otherAdapters({});
    const envelope = makeEnvelope(identity, {
      action: 'removePatch',
      machine_id: '10.0.0.1',
      path: '/tmp/foo.txt',
    });
    await handlePatchesRequest(envelope, mkDeps(adapters));
    expect(adapters.removePatch).toHaveBeenCalled();
    expect(adapters.upsertPatch).not.toHaveBeenCalled();
    expect(adapters.listPatchesForMachines).not.toHaveBeenCalled();
    expect(adapters.clearOwnedPatches).not.toHaveBeenCalled();
  });

  it('listPatchesForMachines action calls only listPatchesForMachines adapter', async () => {
    const adapters = otherAdapters({});
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: ['10.0.0.1'],
    });
    await handlePatchesRequest(envelope, mkDeps(adapters));
    expect(adapters.listPatchesForMachines).toHaveBeenCalled();
    expect(adapters.upsertPatch).not.toHaveBeenCalled();
    expect(adapters.removePatch).not.toHaveBeenCalled();
    expect(adapters.clearOwnedPatches).not.toHaveBeenCalled();
  });

  it('clearOwnedPatches action calls only clearOwnedPatches adapter', async () => {
    const adapters = otherAdapters({});
    const envelope = makeEnvelope(identity, {
      action: 'clearOwnedPatches',
      workstation_id: 'skylab-aabbccdd',
    });
    await handlePatchesRequest(envelope, mkDeps(adapters));
    expect(adapters.clearOwnedPatches).toHaveBeenCalled();
    expect(adapters.upsertPatch).not.toHaveBeenCalled();
    expect(adapters.removePatch).not.toHaveBeenCalled();
    expect(adapters.listPatchesForMachines).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// Signature, replay, and rate-limit checks (parity across actions)
// -----------------------------------------------------------------------

describe('handlePatchesRequest — envelope verification', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  it('returns 400 when envelope is not an object', async () => {
    const result = await handlePatchesRequest('garbage', mkDeps({}));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: 'envelope_invalid' });
  });

  it('returns 401 when signature does not match public key', async () => {
    const stranger = generateIdentity();
    const envelope = makeEnvelope(identity);
    const tampered = { ...envelope, publicKey: stranger.publicKeyHex };
    const result = await handlePatchesRequest(tampered, mkDeps({}));
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: 'signature_invalid' });
  });

  it('returns 401 when timestamp is outside replay window', async () => {
    const envelope = makeEnvelope(identity);
    const result = await handlePatchesRequest(envelope, mkDeps({ now: () => FIXED_NOW + 200_000 }));
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: 'timestamp_skew' });
  });

  it('returns 401 when nonce store reports a replay', async () => {
    const envelope = makeEnvelope(identity);
    const replayedStore: NonceStore = vi.fn().mockResolvedValue({ fresh: false });
    const result = await handlePatchesRequest(envelope, mkDeps({ nonceStore: replayedStore }));
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: 'replay' });
  });

  it('returns 400 when action is unknown', async () => {
    const envelope = makeEnvelope(identity, {
      action: 'unknownAction',
      machine_id: '10.0.0.1',
    });
    const result = await handlePatchesRequest(envelope, mkDeps({}));
    expect(result.status).toBe(400);
  });
});

describe('handlePatchesRequest — rate limiting', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  it('rate-limits on the verified public key', async () => {
    const rateLimiter = vi.fn<RateLimiter>().mockResolvedValue({ allowed: true });
    const envelope = makeEnvelope(identity);

    await handlePatchesRequest(envelope, mkDeps({ rateLimiter }));

    expect(rateLimiter).toHaveBeenCalledWith(identity.publicKeyHex);
  });

  it('returns 429 with Retry-After when rate-limited', async () => {
    const upsertPatch = vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true });
    const rateLimiter = vi
      .fn<RateLimiter>()
      .mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const envelope = makeEnvelope(identity);

    const result = await handlePatchesRequest(envelope, mkDeps({ upsertPatch, rateLimiter }));

    expect(result.status).toBe(429);
    expect(result.body).toMatchObject({ error: 'rate_limited' });
    expect(result.headers).toMatchObject({ 'Retry-After': '30' });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rate-limit check runs after verification (does not consume budget on garbage)', async () => {
    const rateLimiter = vi.fn<RateLimiter>().mockResolvedValue({ allowed: true });
    await handlePatchesRequest('garbage', mkDeps({ rateLimiter }));
    expect(rateLimiter).not.toHaveBeenCalled();
  });

  it('rate-limits the read path (listPatchesForMachines) too', async () => {
    const listPatchesForMachines = vi
      .fn<(params: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({ ok: true, patches: [] });
    const rateLimiter = vi
      .fn<RateLimiter>()
      .mockResolvedValue({ allowed: false, retryAfterSeconds: 5 });
    const envelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: ['10.0.0.1'],
    });

    const result = await handlePatchesRequest(
      envelope,
      mkDeps({ listPatchesForMachines, rateLimiter }),
    );

    expect(result.status).toBe(429);
    expect(listPatchesForMachines).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// Session-existence gate (L1 patch validation)
//
// Mutations on non-localhost machines must be backed by an active
// session row. Localhost is exempt (player always owns localhost).
// L2 (permission walking inside the session's credentials) is deferred.
// -----------------------------------------------------------------------

describe('handlePatchesRequest — session-existence gate (L1)', () => {
  let identity: Identity;
  // Build a workstation_id that ends with the identity's expected
  // suffix — this is what the server-side bypass check is looking for.
  // The prefix part doesn't matter (the player picks any
  // workstation_name); the suffix is the load-bearing identity-derived
  // part.
  let validUpsertOwnWorkstation: Record<string, unknown>;
  beforeEach(() => {
    identity = generateIdentity();
    const suffix = deriveHostnameSuffix(`ed25519:${identity.publicKeyHex}`);
    validUpsertOwnWorkstation = {
      action: 'upsertPatch',
      machine_id: `skylab-${suffix}`,
      path: '/home/me/notes.txt',
      content: 'local hello',
      owner: 'user',
    };
  });

  const validUpsertRemote = {
    action: 'upsertPatch',
    machine_id: '10.0.0.1',
    path: '/tmp/foo.txt',
    content: 'hello',
    owner: 'user',
  };

  const validRemovePayload = {
    action: 'removePatch',
    machine_id: '10.0.0.1',
    path: '/tmp/foo.txt',
  };

  describe('upsertPatch', () => {
    it('returns 200 on remote machine when player has an active session there', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'alice', userType: 'user' },
        });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });
      const envelope = makeEnvelope(identity, validUpsertRemote);

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, upsertPatch }),
      );

      expect(result.status).toBe(200);
      expect(upsertPatch).toHaveBeenCalled();
    });

    it('returns 403 no_session on remote machine when no active session exists', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: false });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });
      const envelope = makeEnvelope(identity, validUpsertRemote);

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, upsertPatch }),
      );

      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ error: 'no_session' });
      // Critical: the upsert adapter MUST NOT be called when the gate
      // rejects. A surviving mutant that drops the early-return would
      // record the patch despite the 403.
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('returns 500 session_lookup_failed when findActiveSession itself errors (DB outage)', async () => {
      // Distinct from 403: the lookup BROKE. Server can't decide.
      // Don't fail-open by treating DB errors as "session exists",
      // and don't fail-into-403 (would mask outages as auth failures).
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: false });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });
      const envelope = makeEnvelope(identity, validUpsertRemote);

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, upsertPatch }),
      );

      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({ error: 'session_lookup_failed' });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('skips the gate entirely when machine_id is the player own workstation (suffix matches identity)', async () => {
      // Bypass condition under the eliminated-localhost model: the
      // machine_id ends with the identity-derived suffix, so it can
      // ONLY refer to the verified player's own workstation. No
      // session lookup needed.
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: false });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });
      const envelope = makeEnvelope(identity, validUpsertOwnWorkstation);

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, upsertPatch }),
      );

      expect(result.status).toBe(200);
      // Critical: gate MUST NOT be consulted for the own-workstation
      // bypass. A mutant that calls findActiveSession anyway (and gets
      // exists:false above) would 403 — this test catches it.
      expect(findActiveSession).not.toHaveBeenCalled();
      expect(upsertPatch).toHaveBeenCalled();
      // L2 dual-write bypass: own-workstation patches are excluded from
      // machine_filesystems by design. The handler MUST forward
      // dualWrite=false here. A mutant that flips this to true would
      // project the player's private workstation FS into the shared
      // L2 walker's view of the world.
      expect(upsertPatch).toHaveBeenCalledWith(expect.anything(), false);
    });

    it('still gates a workstation_id-shaped machine_id whose suffix belongs to a DIFFERENT player', async () => {
      // Cross-player workstation write: A targets B's workstation_id
      // (`skylab-<B.suffix>`). The suffix doesn't match A's identity so
      // the bypass doesn't fire; A must have an active session on B's
      // box (e.g., from an SSH push) to mutate it.
      const someoneElsesSuffix = 'deadbeef';
      const otherWorkstationId = `skylab-${someoneElsesSuffix}`;
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: false });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });
      const envelope = makeEnvelope(identity, {
        ...validUpsertOwnWorkstation,
        machine_id: otherWorkstationId,
      });

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, upsertPatch }),
      );

      expect(result.status).toBe(403);
      expect(findActiveSession).toHaveBeenCalled();
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('passes verified pubkey + payload.machine_id to findActiveSession (not client-claimed)', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'alice', userType: 'user' },
        });
      const envelope = makeEnvelope(identity, validUpsertRemote);

      await handlePatchesRequest(envelope, mkDeps({ findActiveSession }));

      expect(findActiveSession).toHaveBeenCalledWith({
        player_key: identity.publicKeyHex,
        machine_id: '10.0.0.1',
      });
    });
  });

  describe('removePatch (parity with upsertPatch gate)', () => {
    it('returns 200 on remote when active session exists', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'alice', userType: 'user' },
        });
      const removePatch = vi
        .fn<(p: RemovePatchParams) => Promise<RemovePatchResult>>()
        .mockResolvedValue({ ok: true, affected: 0 });
      const envelope = makeEnvelope(identity, validRemovePayload);

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, removePatch }),
      );

      expect(result.status).toBe(200);
      expect(removePatch).toHaveBeenCalled();
    });

    it('returns 403 no_session when no active session', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: false });
      const removePatch = vi
        .fn<(p: RemovePatchParams) => Promise<RemovePatchResult>>()
        .mockResolvedValue({ ok: true, affected: 0 });
      const envelope = makeEnvelope(identity, validRemovePayload);

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, removePatch }),
      );

      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ error: 'no_session' });
      expect(removePatch).not.toHaveBeenCalled();
    });

    it('returns 500 session_lookup_failed when findActiveSession errors', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: false });
      const removePatch = vi
        .fn<(p: RemovePatchParams) => Promise<RemovePatchResult>>()
        .mockResolvedValue({ ok: true, affected: 0 });
      const envelope = makeEnvelope(identity, validRemovePayload);

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, removePatch }),
      );

      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({ error: 'session_lookup_failed' });
      expect(removePatch).not.toHaveBeenCalled();
    });

    it('skips the gate when machine_id is the player own workstation (suffix matches identity)', async () => {
      const suffix = deriveHostnameSuffix(`ed25519:${identity.publicKeyHex}`);
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: false });
      const removePatch = vi
        .fn<(p: RemovePatchParams) => Promise<RemovePatchResult>>()
        .mockResolvedValue({ ok: true, affected: 0 });
      const envelope = makeEnvelope(identity, {
        action: 'removePatch',
        machine_id: `skylab-${suffix}`,
        path: '/home/me/dead.txt',
      });

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, removePatch }),
      );

      expect(result.status).toBe(200);
      expect(findActiveSession).not.toHaveBeenCalled();
      expect(removePatch).toHaveBeenCalled();
      // L2 dual-delete bypass: own-workstation patches are excluded
      // from machine_filesystems. The handler MUST forward
      // dual_write=false. A mutant that flips this to true would drop
      // shared machine_filesystems rows whenever the player wipes
      // their own box.
      expect(removePatch).toHaveBeenCalledWith(expect.objectContaining({ dual_write: false }));
    });
  });

  describe('read / bulk-clear actions do not gate via the single-row L1 adapter', () => {
    // Reads route through findActiveSessionsBatch (per-machine session
    // map for the read-path tier dispatch); the SINGLE-row
    // findActiveSession is a write-path L1 helper and stays untouched
    // by reads/clear. clearOwnedPatches scopes by player_key +
    // workstation_id at the SQL layer and consults neither adapter.

    it('listPatchesForMachines does not invoke the single-row findActiveSession (read-path uses the batch variant)', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'alice', userType: 'user' },
        });
      const envelope = makeEnvelope(identity, {
        action: 'listPatchesForMachines',
        machine_ids: ['10.0.0.1'],
      });

      await handlePatchesRequest(envelope, mkDeps({ findActiveSession }));

      expect(findActiveSession).not.toHaveBeenCalled();
    });

    it('clearOwnedPatches does not invoke findActiveSession', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'alice', userType: 'user' },
        });
      const envelope = makeEnvelope(identity, { action: 'clearOwnedPatches' });

      await handlePatchesRequest(envelope, mkDeps({ findActiveSession }));

      expect(findActiveSession).not.toHaveBeenCalled();
    });
  });

  describe('gate ordering', () => {
    it('rate-limit fires BEFORE the gate (429 pre-empts session lookup)', async () => {
      // Saves a DB hit on rate-limited callers.
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'alice', userType: 'user' },
        });
      const rateLimiter = vi
        .fn<RateLimiter>()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
      const envelope = makeEnvelope(identity, validUpsertRemote);

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, rateLimiter }),
      );

      expect(result.status).toBe(429);
      expect(findActiveSession).not.toHaveBeenCalled();
    });
  });
});

// -----------------------------------------------------------------------
// L1 bypass for ambient log writes
//
// Recon (nmap, curl, hydra, gobuster, ssh-fail, etc.) leaves logs on
// the target machine without the actor needing an active session there
// — the network records the probe as a side effect. L1 was designed
// for "I logged in, I'm mutating this machine" writes; ambient log
// appends are a different write class. Bypass is path-prefix based,
// server-controlled, and applies ONLY to upsertPatch (not removePatch
// — covering tracks still requires real access).
//
// See project_multiplayer_cross_player_visibility memory.
// -----------------------------------------------------------------------

describe('handlePatchesRequest — log-path bypass on upsertPatch', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  const validLogUpsert = {
    action: 'upsertPatch',
    machine_id: '10.0.0.1',
    path: '/var/log/access.log',
    content: '[scan] 10.0.0.5 -> tcp/22\n',
    owner: 'root',
  };

  it('returns 200 for /var/log/* upsert on remote without an active session', async () => {
    const findActiveSession = vi
      .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
      .mockResolvedValue({ ok: true, exists: false });
    const upsertPatch = vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true });
    const envelope = makeEnvelope(identity, validLogUpsert);

    const result = await handlePatchesRequest(envelope, mkDeps({ findActiveSession, upsertPatch }));

    expect(result.status).toBe(200);
    expect(upsertPatch).toHaveBeenCalled();
  });

  it('does NOT consult findActiveSession for /var/log/* upsert (short-circuit)', async () => {
    // Mutation-kill: a mutant that drops the early-return would call
    // findActiveSession; with exists:false above it would 403.
    const findActiveSession = vi
      .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
      .mockResolvedValue({ ok: true, exists: false });
    const envelope = makeEnvelope(identity, validLogUpsert);

    await handlePatchesRequest(envelope, mkDeps({ findActiveSession }));

    expect(findActiveSession).not.toHaveBeenCalled();
  });

  it.each([
    '/var/log/auth.log',
    '/var/log/kern.log',
    '/var/log/messages',
    '/var/log/nginx/access.log',
    '/var/log/subdir/deeper/file.log',
  ])('bypasses the gate for path: %s', async (path) => {
    const findActiveSession = vi
      .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
      .mockResolvedValue({ ok: true, exists: false });
    const envelope = makeEnvelope(identity, { ...validLogUpsert, path });

    const result = await handlePatchesRequest(envelope, mkDeps({ findActiveSession }));

    expect(result.status).toBe(200);
    expect(findActiveSession).not.toHaveBeenCalled();
  });

  it.each([
    '/var/loganalyzer/foo.txt', // looks similar but isn't /var/log/
    '/var/log', // exactly /var/log with no child component
    '/etc/passwd', // entirely different path
    '/foo/var/log/bar.log', // /var/log/ not at the start
  ])('does NOT bypass the gate for non-log path: %s', async (path) => {
    const findActiveSession = vi
      .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
      .mockResolvedValue({ ok: true, exists: false });
    const envelope = makeEnvelope(identity, { ...validLogUpsert, path });

    const result = await handlePatchesRequest(envelope, mkDeps({ findActiveSession }));

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: 'no_session' });
    expect(findActiveSession).toHaveBeenCalled();
  });

  it('removePatch on /var/log/* is NOT bypassed (covering tracks still needs access)', async () => {
    const findActiveSession = vi
      .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
      .mockResolvedValue({ ok: true, exists: false });
    const removePatch = vi
      .fn<(p: RemovePatchParams) => Promise<RemovePatchResult>>()
      .mockResolvedValue({ ok: true, affected: 0 });
    const envelope = makeEnvelope(identity, {
      action: 'removePatch',
      machine_id: '10.0.0.1',
      path: '/var/log/access.log',
    });

    const result = await handlePatchesRequest(envelope, mkDeps({ findActiveSession, removePatch }));

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: 'no_session' });
    expect(removePatch).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// Realtime hint broadcast on successful mutation
//
// Every successful upsertPatch / removePatch fires
// deps.publishPatchChange with the affected machine_id and the verified
// originator pubkey. The broadcast is a HINT — receivers refetch via
// listPatchesForMachines to obtain authoritative state. Forging the
// hint cannot corrupt UI state because there's no content payload to
// inject; a forged hint just causes a refetch that returns server
// truth. See project_realtime_publish_authorization memory.
//
// Broadcast must NOT fire when the DB op fails — we don't want
// subscribers reacting to a write that didn't happen.
// -----------------------------------------------------------------------

describe('handlePatchesRequest — hint broadcast on successful mutation', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  it('fires publishPatchChange(machine_id, originator_key) after successful upsertPatch', async () => {
    const publishPatchChange = vi.fn<PublishPatchChange>().mockResolvedValue(undefined);
    const envelope = makeEnvelope(identity, {
      action: 'upsertPatch',
      machine_id: '10.0.0.5',
      path: '/etc/hosts',
      content: 'shared world',
      owner: 'root',
    });

    await handlePatchesRequest(envelope, mkDeps({ publishPatchChange }));

    expect(publishPatchChange).toHaveBeenCalledTimes(1);
    expect(publishPatchChange).toHaveBeenCalledWith('10.0.0.5', identity.publicKeyHex);
  });

  it('originator_key is the verified pubkey, never client-claimed', async () => {
    // Mutation-kill: a mutant that passed (machine_id, machine_id) or a
    // hard-coded constant would fail this — only the verified pubkey
    // satisfies the assertion.
    const publishPatchChange = vi.fn<PublishPatchChange>().mockResolvedValue(undefined);
    const envelope = makeEnvelope(identity);

    await handlePatchesRequest(envelope, mkDeps({ publishPatchChange }));

    const originatorKey = publishPatchChange.mock.calls[0][1];
    expect(originatorKey).toBe(identity.publicKeyHex);
    expect(originatorKey).not.toBe('10.0.0.1');
  });

  it('does NOT pass any patch content / path / owner to the broadcast (hint shape only)', async () => {
    // The hint payload is just (machine_id, originator_key). No path,
    // no content, no owner — those are forge-resistant only because
    // they don't exist in the broadcast. Receivers refetch authoritative
    // state via listPatchesForMachines.
    const publishPatchChange = vi.fn<PublishPatchChange>().mockResolvedValue(undefined);
    const NUL = String.fromCharCode(0);
    const envelope = makeEnvelope(identity, {
      action: 'upsertPatch',
      machine_id: '10.0.0.5',
      path: '/usr/bin/nmap',
      content: `ELF${NUL}${NUL}${NUL}binary`,
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      is_new: true,
      node_type: 'directory',
    });

    await handlePatchesRequest(envelope, mkDeps({ publishPatchChange }));

    expect(publishPatchChange).toHaveBeenCalledTimes(1);
    expect(publishPatchChange).toHaveBeenCalledWith('10.0.0.5', identity.publicKeyHex);
    // The 2-arg signature is what enforces hint-only shape — extra args
    // would be a regression toward leaking content into the broadcast.
    expect(publishPatchChange.mock.calls[0]).toHaveLength(2);
  });

  it('does NOT fire publishPatchChange when upsertPatch DB op fails', async () => {
    const upsertPatch = vi
      .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: false });
    const publishPatchChange = vi.fn<PublishPatchChange>().mockResolvedValue(undefined);
    const envelope = makeEnvelope(identity);

    const result = await handlePatchesRequest(
      envelope,
      mkDeps({ upsertPatch, publishPatchChange }),
    );

    expect(result.status).toBe(500);
    expect(publishPatchChange).not.toHaveBeenCalled();
  });

  it('fires publishPatchChange(machine_id, originator_key) after successful removePatch', async () => {
    const publishPatchChange = vi.fn<PublishPatchChange>().mockResolvedValue(undefined);
    const envelope = makeEnvelope(identity, {
      action: 'removePatch',
      machine_id: '10.0.0.5',
      path: '/etc/hosts',
    });

    await handlePatchesRequest(envelope, mkDeps({ publishPatchChange }));

    expect(publishPatchChange).toHaveBeenCalledTimes(1);
    expect(publishPatchChange).toHaveBeenCalledWith('10.0.0.5', identity.publicKeyHex);
  });

  it('does NOT fire publishPatchChange when removePatch DB op fails', async () => {
    const removePatch = vi
      .fn<(params: RemovePatchParams) => Promise<RemovePatchResult>>()
      .mockResolvedValue({ ok: false });
    const publishPatchChange = vi.fn<PublishPatchChange>().mockResolvedValue(undefined);
    const envelope = makeEnvelope(identity, {
      action: 'removePatch',
      machine_id: '10.0.0.1',
      path: '/tmp/foo.txt',
    });

    const result = await handlePatchesRequest(
      envelope,
      mkDeps({ removePatch, publishPatchChange }),
    );

    expect(result.status).toBe(500);
    expect(publishPatchChange).not.toHaveBeenCalled();
  });

  it('does NOT fire publishPatchChange on read / clear actions (listPatchesForMachines / clearOwnedPatches)', async () => {
    const publishPatchChange = vi.fn<PublishPatchChange>().mockResolvedValue(undefined);

    const listEnvelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: ['10.0.0.1'],
    });
    await handlePatchesRequest(listEnvelope, mkDeps({ publishPatchChange }));

    const clearOwnedEnvelope = makeEnvelope(identity, { action: 'clearOwnedPatches' });
    await handlePatchesRequest(clearOwnedEnvelope, mkDeps({ publishPatchChange }));

    expect(publishPatchChange).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// L2 patch validation — walker decision on machine_filesystems target
//
// L2 sits after L1 (which checked "session exists") and before the DB
// mutation. It looks up the target path in machine_filesystems and runs
// the shared walker against the active session's verified userType.
//
// Today's wiring is leaf-only: target.write is the only check. Parent-
// chain enforcement is deferred to a later step that requires base-FS
// backfill of machine_filesystems (Pattern A's projection only contains
// patched files; untouched files have no row).
//
// Permissive fallback: when machine_filesystems has no row for the path,
// L2 allows the mutation. This is a documented gap — closing it requires
// machine_filesystems to contain the full base FS, not just patches.
// -----------------------------------------------------------------------

describe('handlePatchesRequest — L2 walker enforcement', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  const rootOnlyPerms: FilePermissions = {
    read: ['root'],
    write: ['root'],
    execute: ['root'],
  };
  const userWritablePerms: FilePermissions = {
    read: ['root', 'user'],
    write: ['root', 'user'],
    execute: ['root', 'user'],
  };

  describe('upsertPatch', () => {
    const validUpsert = {
      action: 'upsertPatch',
      machine_id: '10.0.0.1',
      path: '/etc/shadow',
      content: 'pwn',
      owner: 'root',
    };

    it('returns 403 permission_denied when guest tries to write a root-only file', async () => {
      // The flagship L2 attack: guest holds a legitimate session on the
      // remote machine (L1 passes), but tries to overwrite /etc/shadow.
      // Server's stored row has write=['root']; walker denies.
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'guest', userType: 'guest' },
        });
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({
          ok: true,
          found: true,
          node: { owner: 'root', permissions: rootOnlyPerms },
        });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });

      const envelope = makeEnvelope(identity, validUpsert);
      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, findMachineFs, upsertPatch }),
      );

      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ error: 'permission_denied' });
      // Critical: no DB mutation when L2 denies. A surviving mutant that
      // dropped the early-return would let the patch land despite the 403.
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('returns 200 when root tries to write a root-only file (walker allows)', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'root', userType: 'root' },
        });
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({
          ok: true,
          found: true,
          node: { owner: 'root', permissions: rootOnlyPerms },
        });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });

      const envelope = makeEnvelope(identity, validUpsert);
      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, findMachineFs, upsertPatch }),
      );

      expect(result.status).toBe(200);
      expect(upsertPatch).toHaveBeenCalled();
    });

    it('uses target.write (not target.read) for mode dispatch', async () => {
      // Pinned: a mutant that called canRead instead of canWrite would
      // pass this guest: target.read includes guest, but target.write
      // doesn't. The handler MUST consult target.write for mutating
      // actions, otherwise overwrite-via-readable becomes a free attack.
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'guest', userType: 'guest' },
        });
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({
          ok: true,
          found: true,
          node: {
            owner: 'root',
            permissions: {
              read: ['root', 'user', 'guest'], // guest can read
              write: ['root', 'user'], // guest CANNOT write
              execute: ['root'],
            },
          },
        });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });

      const envelope = makeEnvelope(identity, validUpsert);
      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, findMachineFs, upsertPatch }),
      );

      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ error: 'permission_denied' });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('returns 200 when user is in target.write list', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'alice', userType: 'user' },
        });
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({
          ok: true,
          found: true,
          node: { owner: 'user', permissions: userWritablePerms },
        });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });

      const envelope = makeEnvelope(identity, validUpsert);
      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, findMachineFs, upsertPatch }),
      );

      expect(result.status).toBe(200);
      expect(upsertPatch).toHaveBeenCalled();
    });

    it('allows the mutation (permissive fallback) when machine_filesystems has no row for the path', async () => {
      // Documented Pattern A gap: untouched paths have no row, so L2 has
      // no perms to check. Future step closes this with base-FS backfill.
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({ ok: true, found: false });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });

      const envelope = makeEnvelope(identity, validUpsert);
      const result = await handlePatchesRequest(envelope, mkDeps({ findMachineFs, upsertPatch }));

      expect(result.status).toBe(200);
      expect(upsertPatch).toHaveBeenCalled();
    });

    it('returns 500 fs_lookup_failed when findMachineFs DB op errors', async () => {
      // Distinguished from 403 (walker denied) — the lookup itself
      // failed, server can't decide. Don't fail-open by treating DB
      // errors as found:false → would silently skip L2.
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({ ok: false });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });

      const envelope = makeEnvelope(identity, validUpsert);
      const result = await handlePatchesRequest(envelope, mkDeps({ findMachineFs, upsertPatch }));

      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({ error: 'fs_lookup_failed' });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('skips L2 entirely when machine_id is the player own workstation', async () => {
      // Own-workstation bypass — no L2 row should be fetched at all,
      // and a (synthetic) restrictive row would not block the mutation.
      const suffix = deriveHostnameSuffix(`ed25519:${identity.publicKeyHex}`);
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({
          ok: true,
          found: true,
          node: { owner: 'root', permissions: rootOnlyPerms },
        });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });

      const envelope = makeEnvelope(identity, {
        action: 'upsertPatch',
        machine_id: `kali-${suffix}`,
        path: '/home/me/notes.txt',
        content: 'self',
        owner: 'user',
      });
      const result = await handlePatchesRequest(envelope, mkDeps({ findMachineFs, upsertPatch }));

      expect(result.status).toBe(200);
      expect(upsertPatch).toHaveBeenCalled();
      // Pinned: own-workstation bypass MUST short-circuit before L2.
      // A mutant that dropped the bypass would fetch the synthetic
      // restrictive row above and 403.
      expect(findMachineFs).not.toHaveBeenCalled();
    });

    it('skips both L1 and L2 for /var/log/* (ambient log writes)', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'guest', userType: 'guest' },
        });
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({
          ok: true,
          found: true,
          node: { owner: 'root', permissions: rootOnlyPerms },
        });
      const envelope = makeEnvelope(identity, {
        action: 'upsertPatch',
        machine_id: '10.0.0.1',
        path: '/var/log/auth.log',
        content: '[scan] 10.0.0.5 -> tcp/22\n',
        owner: 'root',
      });

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, findMachineFs }),
      );

      expect(result.status).toBe(200);
      // Critical: ambient log path bypasses BOTH gates. A mutant that
      // moved the L2 check outside the !isAmbientLogPath block would
      // 403 here on the rootOnlyPerms target.
      expect(findActiveSession).not.toHaveBeenCalled();
      expect(findMachineFs).not.toHaveBeenCalled();
    });

    it('returns 403 no_session (L1) before consulting findMachineFs at all', async () => {
      // Pinned: L2 must run AFTER L1. A mutant that ran them in
      // parallel or swapped the order would fetch machine_filesystems
      // for unauthenticated requests.
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: false });
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({ ok: true, found: false });

      const envelope = makeEnvelope(identity, validUpsert);
      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, findMachineFs }),
      );

      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ error: 'no_session' });
      expect(findMachineFs).not.toHaveBeenCalled();
    });

    it('passes verified userType from session credentials to walker (not client-claimed)', async () => {
      // Mutation-kill: a mutant that used a hardcoded userType (e.g.
      // 'root') would let any session pass L2 here. The walker decision
      // depends on the session's credentials.userType being plumbed
      // through.
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'guest', userType: 'guest' },
        });
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({
          ok: true,
          found: true,
          node: {
            owner: 'user',
            permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
          },
        });
      const upsertPatch = vi
        .fn<(row: PatchRow, dualWrite: boolean) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });

      const envelope = makeEnvelope(identity, validUpsert);
      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, findMachineFs, upsertPatch }),
      );

      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ error: 'permission_denied' });
      expect(upsertPatch).not.toHaveBeenCalled();
    });
  });

  describe('removePatch (parity with upsertPatch)', () => {
    const validRemove = {
      action: 'removePatch',
      machine_id: '10.0.0.1',
      path: '/etc/shadow',
    };

    it('returns 403 permission_denied when guest tries to remove a root-only file', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'guest', userType: 'guest' },
        });
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({
          ok: true,
          found: true,
          node: { owner: 'root', permissions: rootOnlyPerms },
        });
      const removePatch = vi
        .fn<(p: RemovePatchParams) => Promise<RemovePatchResult>>()
        .mockResolvedValue({ ok: true, affected: 0 });

      const envelope = makeEnvelope(identity, validRemove);
      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, findMachineFs, removePatch }),
      );

      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ error: 'permission_denied' });
      expect(removePatch).not.toHaveBeenCalled();
    });

    it('returns 200 when root removes a root-only file', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({
          ok: true,
          exists: true,
          credentials: { username: 'root', userType: 'root' },
        });
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({
          ok: true,
          found: true,
          node: { owner: 'root', permissions: rootOnlyPerms },
        });
      const removePatch = vi
        .fn<(p: RemovePatchParams) => Promise<RemovePatchResult>>()
        .mockResolvedValue({ ok: true, affected: 1 });

      const envelope = makeEnvelope(identity, validRemove);
      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, findMachineFs, removePatch }),
      );

      expect(result.status).toBe(200);
      expect(removePatch).toHaveBeenCalled();
    });

    it('skips L2 entirely on the player own workstation', async () => {
      const suffix = deriveHostnameSuffix(`ed25519:${identity.publicKeyHex}`);
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({
          ok: true,
          found: true,
          node: { owner: 'root', permissions: rootOnlyPerms },
        });
      const removePatch = vi
        .fn<(p: RemovePatchParams) => Promise<RemovePatchResult>>()
        .mockResolvedValue({ ok: true, affected: 1 });

      const envelope = makeEnvelope(identity, {
        action: 'removePatch',
        machine_id: `kali-${suffix}`,
        path: '/home/me/dead.txt',
      });
      const result = await handlePatchesRequest(envelope, mkDeps({ findMachineFs, removePatch }));

      expect(result.status).toBe(200);
      expect(removePatch).toHaveBeenCalled();
      expect(findMachineFs).not.toHaveBeenCalled();
    });
  });

  describe('read / clear actions do not invoke the single-row machine_filesystems adapter', () => {
    // Reads route through findMachineFsBatch (one bulk fetch driving
    // the read filter); the SINGLE-row findMachineFs is a write-path
    // L2 helper and stays untouched by reads/clear. clearOwnedPatches
    // scopes by player_key + workstation_id at the SQL layer and
    // consults neither adapter.

    it('listPatchesForMachines does not invoke the single-row findMachineFs (read-path uses the batch variant)', async () => {
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({ ok: true, found: false });
      const envelope = makeEnvelope(identity, {
        action: 'listPatchesForMachines',
        machine_ids: ['10.0.0.1'],
      });

      await handlePatchesRequest(envelope, mkDeps({ findMachineFs }));

      expect(findMachineFs).not.toHaveBeenCalled();
    });

    it('clearOwnedPatches does not invoke findMachineFs', async () => {
      const findMachineFs = vi
        .fn<(p: FindMachineFsParams) => Promise<FindMachineFsResult>>()
        .mockResolvedValue({ ok: true, found: false });
      const envelope = makeEnvelope(identity, { action: 'clearOwnedPatches' });

      await handlePatchesRequest(envelope, mkDeps({ findMachineFs }));

      expect(findMachineFs).not.toHaveBeenCalled();
    });
  });
});
