import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePatchesRequest } from './handler';
import type {
  ClearPatchesParams,
  ClearPatchesResult,
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
import type { RateLimiter } from '../ipRegistry/rateLimit';
import { noopRateLimiter } from '../ipRegistry/rateLimit';
import { noopNonceStore, type NonceStore } from '../signedRequest/nonceStore';
import { generateIdentity, type Identity } from '../identity/identity';
import { signRequest } from '../signedRequest/sign';

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
  readonly upsertPatch?: (row: PatchRow) => Promise<UpsertPatchResult>;
  readonly removePatch?: (params: RemovePatchParams) => Promise<RemovePatchResult>;
  readonly listPatchesForMachines?: (
    params: ListPatchesForMachinesParams,
  ) => Promise<ListPatchesForMachinesResult>;
  readonly clearTransientPatches?: (params: ClearPatchesParams) => Promise<ClearPatchesResult>;
  readonly clearOwnedPatches?: (params: ClearPatchesParams) => Promise<ClearPatchesResult>;
  readonly findActiveSession?: (
    params: FindActiveSessionParams,
  ) => Promise<FindActiveSessionResult>;
  readonly publishPatchChange?: PublishPatchChange;
  readonly rateLimiter?: RateLimiter;
  readonly nonceStore?: NonceStore;
  readonly now?: () => number;
}) => ({
  upsertPatch:
    overrides.upsertPatch ??
    vi.fn<(row: PatchRow) => Promise<UpsertPatchResult>>().mockResolvedValue({ ok: true }),
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
  clearTransientPatches:
    overrides.clearTransientPatches ??
    vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: true, affected: 0 }),
  clearOwnedPatches:
    overrides.clearOwnedPatches ??
    vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: true, affected: 0 }),
  // Default: gate always passes. Session-specific tests override per-case.
  findActiveSession:
    overrides.findActiveSession ??
    vi
      .fn<(params: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
      .mockResolvedValue({ ok: true, exists: true }),
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
      .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true });
    const envelope = makeEnvelope(identity, validUpsertPayload);

    await handlePatchesRequest(envelope, mkDeps({ upsertPatch }));

    expect(upsertPatch).toHaveBeenCalledWith({
      player_key: identity.publicKeyHex,
      machine_id: '10.0.0.1',
      path: '/tmp/foo.txt',
      content: 'hello',
      owner: 'user',
    });
  });

  it('passes through optional permissions, is_new, node_type', async () => {
    const upsertPatch = vi
      .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
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
    );
  });

  it('accepts content === null (deletion-of-base-file marker)', async () => {
    const upsertPatch = vi
      .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
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
    expect(upsertPatch).toHaveBeenCalledWith(expect.objectContaining({ content: null }));
  });

  it('replaces NUL bytes in content with U+FFFD (Postgres TEXT rejects U+0000)', async () => {
    // Mock binary file contents in the game (e.g. /usr/bin/nmap's ELF
    // placeholder) carry NUL bytes — Postgres rejects them with 22P05.
    // Sanitization at the handler level (vs the client wrapper) is
    // defense-in-depth: even hand-crafted Burp envelopes get cleaned.
    const upsertPatch = vi
      .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
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
    );
  });

  it('returns 500 when the supabase upsert fails', async () => {
    const upsertPatch = vi
      .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
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
  const patchFromPlayerA: PatchSummary = {
    machine_id: '10.0.0.1',
    path: '/etc/hosts',
    content: '127.0.0.1 localhost\n10.0.0.1 from-A',
    owner: 'root',
    permissions: null,
    is_new: false,
    node_type: 'file',
  };

  const patchFromPlayerB: PatchSummary = {
    machine_id: '10.0.0.1',
    path: '/etc/hosts',
    content: '127.0.0.1 localhost\n10.0.0.1 from-B',
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

  it('does NOT call findActiveSession (no L1 gate on reads)', async () => {
    const findActiveSession = vi
      .fn<(params: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
      .mockResolvedValue({ ok: true, exists: true });
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
// clearTransientPatches
// -----------------------------------------------------------------------

describe('handlePatchesRequest — clearTransientPatches', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  const validClearTransientPayload = { action: 'clearTransientPatches' };

  it('returns 200 with affected count', async () => {
    const clearTransientPatches = vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: true, affected: 7 });
    const envelope = makeEnvelope(identity, validClearTransientPayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ clearTransientPatches }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ affected: 7 });
  });

  it('queries with verified pubkey as player_key', async () => {
    const clearTransientPatches = vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: true, affected: 0 });
    const envelope = makeEnvelope(identity, validClearTransientPayload);

    await handlePatchesRequest(envelope, mkDeps({ clearTransientPatches }));

    expect(clearTransientPatches).toHaveBeenCalledWith({
      player_key: identity.publicKeyHex,
    });
  });

  it('returns 500 when the DB delete errors', async () => {
    const clearTransientPatches = vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: false });
    const envelope = makeEnvelope(identity, validClearTransientPayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ clearTransientPatches }));

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'clear_failed' });
  });

  it('returns 400 when client supplies unknown extra fields', async () => {
    const envelope = makeEnvelope(identity, {
      action: 'clearTransientPatches',
      machine_id: '10.0.0.1',
    });
    const result = await handlePatchesRequest(envelope, mkDeps({}));
    expect(result.status).toBe(400);
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

  const validClearOwnedPayload = { action: 'clearOwnedPatches' };

  it('returns 200 with affected count', async () => {
    const clearOwnedPatches = vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: true, affected: 42 });
    const envelope = makeEnvelope(identity, validClearOwnedPayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ clearOwnedPatches }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ affected: 42 });
  });

  it('queries with verified pubkey as player_key', async () => {
    const clearOwnedPatches = vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: true, affected: 0 });
    const envelope = makeEnvelope(identity, validClearOwnedPayload);

    await handlePatchesRequest(envelope, mkDeps({ clearOwnedPatches }));

    expect(clearOwnedPatches).toHaveBeenCalledWith({ player_key: identity.publicKeyHex });
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
      foo: 'bar',
    });
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
      .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
      .mockResolvedValue({ ok: true }),
    removePatch: vi
      .fn<(params: RemovePatchParams) => Promise<RemovePatchResult>>()
      .mockResolvedValue({ ok: true, affected: 1 }),
    listPatchesForMachines: vi
      .fn<(params: ListPatchesForMachinesParams) => Promise<ListPatchesForMachinesResult>>()
      .mockResolvedValue({ ok: true, patches: [] }),
    clearTransientPatches: vi
      .fn<(params: ClearPatchesParams) => Promise<ClearPatchesResult>>()
      .mockResolvedValue({ ok: true, affected: 0 }),
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
    expect(adapters.clearTransientPatches).not.toHaveBeenCalled();
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
    expect(adapters.clearTransientPatches).not.toHaveBeenCalled();
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
    expect(adapters.clearTransientPatches).not.toHaveBeenCalled();
    expect(adapters.clearOwnedPatches).not.toHaveBeenCalled();
  });

  it('clearTransientPatches action calls only clearTransientPatches adapter', async () => {
    const adapters = otherAdapters({});
    const envelope = makeEnvelope(identity, { action: 'clearTransientPatches' });
    await handlePatchesRequest(envelope, mkDeps(adapters));
    expect(adapters.clearTransientPatches).toHaveBeenCalled();
    expect(adapters.upsertPatch).not.toHaveBeenCalled();
    expect(adapters.removePatch).not.toHaveBeenCalled();
    expect(adapters.listPatchesForMachines).not.toHaveBeenCalled();
    expect(adapters.clearOwnedPatches).not.toHaveBeenCalled();
  });

  it('clearOwnedPatches action calls only clearOwnedPatches adapter', async () => {
    const adapters = otherAdapters({});
    const envelope = makeEnvelope(identity, { action: 'clearOwnedPatches' });
    await handlePatchesRequest(envelope, mkDeps(adapters));
    expect(adapters.clearOwnedPatches).toHaveBeenCalled();
    expect(adapters.upsertPatch).not.toHaveBeenCalled();
    expect(adapters.removePatch).not.toHaveBeenCalled();
    expect(adapters.listPatchesForMachines).not.toHaveBeenCalled();
    expect(adapters.clearTransientPatches).not.toHaveBeenCalled();
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
      .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
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
  beforeEach(() => {
    identity = generateIdentity();
  });

  const validUpsertRemote = {
    action: 'upsertPatch',
    machine_id: '10.0.0.1',
    path: '/tmp/foo.txt',
    content: 'hello',
    owner: 'user',
  };

  const validUpsertLocalhost = {
    action: 'upsertPatch',
    machine_id: 'localhost',
    path: '/home/me/notes.txt',
    content: 'local hello',
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
        .mockResolvedValue({ ok: true, exists: true });
      const upsertPatch = vi
        .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
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
        .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
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
        .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
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

    it('skips the gate entirely on machine_id=localhost (player always owns own box)', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: false });
      const upsertPatch = vi
        .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
        .mockResolvedValue({ ok: true });
      const envelope = makeEnvelope(identity, validUpsertLocalhost);

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, upsertPatch }),
      );

      expect(result.status).toBe(200);
      // Critical: gate MUST NOT be consulted for localhost. A mutant
      // that calls findActiveSession anyway (and gets exists:false above)
      // would 403 — this test catches it.
      expect(findActiveSession).not.toHaveBeenCalled();
      expect(upsertPatch).toHaveBeenCalled();
    });

    it('passes verified pubkey + payload.machine_id to findActiveSession (not client-claimed)', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: true });
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
        .mockResolvedValue({ ok: true, exists: true });
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

    it('skips the gate on machine_id=localhost', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: false });
      const removePatch = vi
        .fn<(p: RemovePatchParams) => Promise<RemovePatchResult>>()
        .mockResolvedValue({ ok: true, affected: 0 });
      const envelope = makeEnvelope(identity, {
        action: 'removePatch',
        machine_id: 'localhost',
        path: '/home/me/dead.txt',
      });

      const result = await handlePatchesRequest(
        envelope,
        mkDeps({ findActiveSession, removePatch }),
      );

      expect(result.status).toBe(200);
      expect(findActiveSession).not.toHaveBeenCalled();
      expect(removePatch).toHaveBeenCalled();
    });
  });

  describe('read / bulk-clear actions are NOT gated', () => {
    // listPatchesForMachines is a cross-player read — knowing the
    // machine_id is the gate, not session ownership. clearTransient /
    // clearOwned scope to the player's own patches by player_key.
    // None of them consult findActiveSession.

    it('listPatchesForMachines does not invoke findActiveSession', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: true });
      const envelope = makeEnvelope(identity, {
        action: 'listPatchesForMachines',
        machine_ids: ['10.0.0.1'],
      });

      await handlePatchesRequest(envelope, mkDeps({ findActiveSession }));

      expect(findActiveSession).not.toHaveBeenCalled();
    });

    it('clearTransientPatches does not invoke findActiveSession', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: true });
      const envelope = makeEnvelope(identity, { action: 'clearTransientPatches' });

      await handlePatchesRequest(envelope, mkDeps({ findActiveSession }));

      expect(findActiveSession).not.toHaveBeenCalled();
    });

    it('clearOwnedPatches does not invoke findActiveSession', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: true });
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
        .mockResolvedValue({ ok: true, exists: true });
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
      .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
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
      .fn<(row: PatchRow) => Promise<UpsertPatchResult>>()
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

  it('does NOT fire publishPatchChange on read actions (listPatchesForMachines / clears)', async () => {
    const publishPatchChange = vi.fn<PublishPatchChange>().mockResolvedValue(undefined);

    const listEnvelope = makeEnvelope(identity, {
      action: 'listPatchesForMachines',
      machine_ids: ['10.0.0.1'],
    });
    await handlePatchesRequest(listEnvelope, mkDeps({ publishPatchChange }));

    const clearEnvelope = makeEnvelope(identity, { action: 'clearTransientPatches' });
    await handlePatchesRequest(clearEnvelope, mkDeps({ publishPatchChange }));

    const clearOwnedEnvelope = makeEnvelope(identity, { action: 'clearOwnedPatches' });
    await handlePatchesRequest(clearOwnedEnvelope, mkDeps({ publishPatchChange }));

    expect(publishPatchChange).not.toHaveBeenCalled();
  });
});
