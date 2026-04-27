import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePatchesRequest } from './handler';
import type {
  ClearPatchesParams,
  ClearPatchesResult,
  ListPatchesParams,
  ListPatchesResult,
  PatchRow,
  PatchSummary,
  RemovePatchParams,
  RemovePatchResult,
  UpsertPatchResult,
} from './types';
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
  readonly listPatches?: (params: ListPatchesParams) => Promise<ListPatchesResult>;
  readonly clearTransientPatches?: (params: ClearPatchesParams) => Promise<ClearPatchesResult>;
  readonly clearOwnedPatches?: (params: ClearPatchesParams) => Promise<ClearPatchesResult>;
  readonly findActiveSession?: (
    params: FindActiveSessionParams,
  ) => Promise<FindActiveSessionResult>;
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
  listPatches:
    overrides.listPatches ??
    vi
      .fn<(params: ListPatchesParams) => Promise<ListPatchesResult>>()
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
// listPatches
// -----------------------------------------------------------------------

describe('handlePatchesRequest — listPatches', () => {
  let identity: Identity;
  beforeEach(() => {
    identity = generateIdentity();
  });

  const validListPayload = { action: 'listPatches' };

  const samplePatch: PatchSummary = {
    machine_id: '10.0.0.1',
    path: '/tmp/foo.txt',
    content: 'hello',
    owner: 'user',
    permissions: null,
    is_new: false,
    node_type: 'file',
  };

  it('returns 200 with the patches array', async () => {
    const listPatches = vi
      .fn<(params: ListPatchesParams) => Promise<ListPatchesResult>>()
      .mockResolvedValue({ ok: true, patches: [samplePatch] });
    const envelope = makeEnvelope(identity, validListPayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ listPatches }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ patches: [samplePatch] });
  });

  it('returns 200 with empty array when player has no patches', async () => {
    const envelope = makeEnvelope(identity, validListPayload);

    const result = await handlePatchesRequest(envelope, mkDeps({}));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ patches: [] });
  });

  it('queries with verified pubkey as player_key', async () => {
    const listPatches = vi
      .fn<(params: ListPatchesParams) => Promise<ListPatchesResult>>()
      .mockResolvedValue({ ok: true, patches: [] });
    const envelope = makeEnvelope(identity, validListPayload);

    await handlePatchesRequest(envelope, mkDeps({ listPatches }));

    expect(listPatches).toHaveBeenCalledWith({ player_key: identity.publicKeyHex });
  });

  it('returns 500 when the DB query errors', async () => {
    const listPatches = vi
      .fn<(params: ListPatchesParams) => Promise<ListPatchesResult>>()
      .mockResolvedValue({ ok: false });
    const envelope = makeEnvelope(identity, validListPayload);

    const result = await handlePatchesRequest(envelope, mkDeps({ listPatches }));

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: 'query_failed' });
  });

  it('returns 400 when client supplies unknown extra fields', async () => {
    const envelope = makeEnvelope(identity, {
      action: 'listPatches',
      machine_id: '10.0.0.1',
    });
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
    listPatches: vi
      .fn<(params: ListPatchesParams) => Promise<ListPatchesResult>>()
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
    expect(adapters.listPatches).not.toHaveBeenCalled();
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
    expect(adapters.listPatches).not.toHaveBeenCalled();
    expect(adapters.clearTransientPatches).not.toHaveBeenCalled();
    expect(adapters.clearOwnedPatches).not.toHaveBeenCalled();
  });

  it('listPatches action calls only listPatches adapter', async () => {
    const adapters = otherAdapters({});
    const envelope = makeEnvelope(identity, { action: 'listPatches' });
    await handlePatchesRequest(envelope, mkDeps(adapters));
    expect(adapters.listPatches).toHaveBeenCalled();
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
    expect(adapters.listPatches).not.toHaveBeenCalled();
    expect(adapters.clearOwnedPatches).not.toHaveBeenCalled();
  });

  it('clearOwnedPatches action calls only clearOwnedPatches adapter', async () => {
    const adapters = otherAdapters({});
    const envelope = makeEnvelope(identity, { action: 'clearOwnedPatches' });
    await handlePatchesRequest(envelope, mkDeps(adapters));
    expect(adapters.clearOwnedPatches).toHaveBeenCalled();
    expect(adapters.upsertPatch).not.toHaveBeenCalled();
    expect(adapters.removePatch).not.toHaveBeenCalled();
    expect(adapters.listPatches).not.toHaveBeenCalled();
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

  it('rate-limits the read path (listPatches) too', async () => {
    const listPatches = vi
      .fn<(params: ListPatchesParams) => Promise<ListPatchesResult>>()
      .mockResolvedValue({ ok: true, patches: [] });
    const rateLimiter = vi
      .fn<RateLimiter>()
      .mockResolvedValue({ allowed: false, retryAfterSeconds: 5 });
    const envelope = makeEnvelope(identity, { action: 'listPatches' });

    const result = await handlePatchesRequest(envelope, mkDeps({ listPatches, rateLimiter }));

    expect(result.status).toBe(429);
    expect(listPatches).not.toHaveBeenCalled();
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
    // listPatches / clearTransient / clearOwned scope to the player's
    // own patches by player_key — they don't depend on machine ownership.
    // They MUST NOT consult findActiveSession.

    it('listPatches does not invoke findActiveSession', async () => {
      const findActiveSession = vi
        .fn<(p: FindActiveSessionParams) => Promise<FindActiveSessionResult>>()
        .mockResolvedValue({ ok: true, exists: true });
      const envelope = makeEnvelope(identity, { action: 'listPatches' });

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
