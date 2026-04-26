import { describe, it, expect, vi } from 'vitest';
import {
  upsertPatch,
  removePatch,
  listPatches,
  clearTransientPatches,
  clearOwnedPatches,
} from './client';
import { generateIdentity, verify } from '../identity/identity';
import { hexToBytes } from '../identity/hex';
import { signedEnvelopeSchema } from '../signedRequest/types';
import type { FileSystemPatch, FilePermissions } from '../filesystem/types';

const ok = (body: object): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errResponse = (status: number, body: object = { error: 'x' }): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const samplePatch: FileSystemPatch = {
  machineId: '10.0.0.1',
  path: '/tmp/foo.txt',
  content: 'hello',
  owner: 'user',
};

const samplePermissions: FilePermissions = {
  read: ['root', 'user'],
  write: ['root'],
  execute: ['root'],
};

const samplePatchFull: FileSystemPatch = {
  machineId: '10.0.0.1',
  path: '/srv/data',
  content: null,
  owner: 'root',
  permissions: samplePermissions,
  isNew: true,
  nodeType: 'directory',
};

// Helpers — reach into a fetch-mock call and pull out the inner signed payload.
const getEnvelope = (fetchMock: ReturnType<typeof vi.fn>) => {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(init.body as string) as {
    payload: string;
    publicKey: string;
    signature: string;
  };
};

const getPayload = (fetchMock: ReturnType<typeof vi.fn>) => {
  const env = getEnvelope(fetchMock);
  return JSON.parse(env.payload) as Record<string, unknown>;
};

// -----------------------------------------------------------------------
// upsertPatch
// -----------------------------------------------------------------------

describe('upsertPatch', () => {
  it('POSTs to /api/patches with a valid SignedEnvelope', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    await upsertPatch(identity, samplePatch, fetchMock);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/patches',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    const env = getEnvelope(fetchMock);
    expect(signedEnvelopeSchema.safeParse(env).success).toBe(true);
  });

  it('signs the payload with the provided identity (verifiable)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    await upsertPatch(identity, samplePatch, fetchMock);

    const env = getEnvelope(fetchMock);
    expect(env.publicKey).toBe(identity.publicKeyHex);
    const sig = hexToBytes(env.signature)!;
    const pub = hexToBytes(env.publicKey)!;
    const msg = new TextEncoder().encode(env.payload);
    expect(verify(pub, sig, msg)).toBe(true);
  });

  it('embeds action="upsertPatch" + snake_case core fields', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    await upsertPatch(identity, samplePatch, fetchMock);

    const payload = getPayload(fetchMock);
    expect(payload.action).toBe('upsertPatch');
    expect(payload.machine_id).toBe('10.0.0.1');
    expect(payload.path).toBe('/tmp/foo.txt');
    expect(payload.content).toBe('hello');
    expect(payload.owner).toBe('user');
  });

  it('omits optional fields (permissions, is_new, node_type) when not present on input', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    await upsertPatch(identity, samplePatch, fetchMock);

    const payload = getPayload(fetchMock);
    expect(payload).not.toHaveProperty('permissions');
    expect(payload).not.toHaveProperty('is_new');
    expect(payload).not.toHaveProperty('node_type');
  });

  it('passes optional fields through (camel→snake) when present on input', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    await upsertPatch(identity, samplePatchFull, fetchMock);

    const payload = getPayload(fetchMock);
    expect(payload.permissions).toEqual(samplePermissions);
    expect(payload.is_new).toBe(true);
    expect(payload.node_type).toBe('directory');
    expect(payload.machine_id).toBe('10.0.0.1');
    expect(payload.path).toBe('/srv/data');
    expect(payload.content).toBeNull();
  });

  it('passes content === null through (deletion-of-base-file marker)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    await upsertPatch(
      identity,
      { machineId: '10.0.0.1', path: '/etc/passwd', content: null, owner: 'root' },
      fetchMock,
    );

    const payload = getPayload(fetchMock);
    expect(payload.content).toBeNull();
  });

  it('resolves to undefined on 200', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

    const result = await upsertPatch(identity, samplePatch, fetchMock);

    expect(result).toBeUndefined();
  });

  it('throws with status code on any non-2xx', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errResponse(500));

    await expect(upsertPatch(identity, samplePatch, fetchMock)).rejects.toThrow(/500/);
  });

  it('throws on 401 (auth class)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(401, { error: 'signature_invalid' }));

    await expect(upsertPatch(identity, samplePatch, fetchMock)).rejects.toThrow(/401/);
  });

  it('propagates fetch errors (network failures)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));

    await expect(upsertPatch(identity, samplePatch, fetchMock)).rejects.toThrow('network failure');
  });
});

// -----------------------------------------------------------------------
// removePatch
// -----------------------------------------------------------------------

describe('removePatch', () => {
  it('POSTs a signed envelope with action="removePatch" + machine_id + path', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ affected: 0 }));

    await removePatch(identity, { machineId: '10.0.0.1', path: '/tmp/foo.txt' }, fetchMock);

    const payload = getPayload(fetchMock);
    expect(payload.action).toBe('removePatch');
    expect(payload.machine_id).toBe('10.0.0.1');
    expect(payload.path).toBe('/tmp/foo.txt');
  });

  it('signs with the provided identity', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ affected: 1 }));

    await removePatch(identity, { machineId: '10.0.0.1', path: '/tmp/foo.txt' }, fetchMock);

    const env = getEnvelope(fetchMock);
    expect(env.publicKey).toBe(identity.publicKeyHex);
    const sig = hexToBytes(env.signature)!;
    const pub = hexToBytes(env.publicKey)!;
    const msg = new TextEncoder().encode(env.payload);
    expect(verify(pub, sig, msg)).toBe(true);
  });

  it('resolves to undefined on 200', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ affected: 3 }));

    const result = await removePatch(
      identity,
      { machineId: '10.0.0.1', path: '/tmp/foo.txt' },
      fetchMock,
    );

    expect(result).toBeUndefined();
  });

  it('throws with status code on any non-2xx', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errResponse(500));

    await expect(
      removePatch(identity, { machineId: '10.0.0.1', path: '/tmp/foo.txt' }, fetchMock),
    ).rejects.toThrow(/500/);
  });

  it('propagates fetch errors', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));

    await expect(
      removePatch(identity, { machineId: '10.0.0.1', path: '/tmp/foo.txt' }, fetchMock),
    ).rejects.toThrow('network failure');
  });
});

// -----------------------------------------------------------------------
// listPatches — includes wire→client conversion
// -----------------------------------------------------------------------

describe('listPatches', () => {
  it('POSTs action="listPatches" with a valid envelope', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ patches: [] }));

    await listPatches(identity, fetchMock);

    const payload = getPayload(fetchMock);
    expect(payload.action).toBe('listPatches');
    expect(payload).not.toHaveProperty('machine_id');
  });

  it('signs with the provided identity', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ patches: [] }));

    await listPatches(identity, fetchMock);

    const env = getEnvelope(fetchMock);
    expect(env.publicKey).toBe(identity.publicKeyHex);
    const sig = hexToBytes(env.signature)!;
    const pub = hexToBytes(env.publicKey)!;
    const msg = new TextEncoder().encode(env.payload);
    expect(verify(pub, sig, msg)).toBe(true);
  });

  it('returns empty array when server has no patches', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ patches: [] }));

    expect(await listPatches(identity, fetchMock)).toEqual([]);
  });

  describe('wire→client conversion', () => {
    it('converts machine_id → machineId on a minimal patch', async () => {
      const identity = generateIdentity();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        ok({
          patches: [
            {
              machine_id: '10.0.0.1',
              path: '/tmp/foo.txt',
              content: 'hello',
              owner: 'user',
              permissions: null,
              is_new: false,
              node_type: 'file',
            },
          ],
        }),
      );

      const patches = await listPatches(identity, fetchMock);

      expect(patches).toEqual([
        {
          machineId: '10.0.0.1',
          path: '/tmp/foo.txt',
          content: 'hello',
          owner: 'user',
        },
      ]);
    });

    it('omits permissions when wire returns null', async () => {
      const identity = generateIdentity();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        ok({
          patches: [
            {
              machine_id: '10.0.0.1',
              path: '/x',
              content: 'x',
              owner: 'user',
              permissions: null,
              is_new: false,
              node_type: 'file',
            },
          ],
        }),
      );

      const patches = await listPatches(identity, fetchMock);

      expect(patches[0]).not.toHaveProperty('permissions');
    });

    it('includes permissions when wire returns a non-null object', async () => {
      const identity = generateIdentity();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        ok({
          patches: [
            {
              machine_id: '10.0.0.1',
              path: '/x',
              content: 'x',
              owner: 'user',
              permissions: samplePermissions,
              is_new: false,
              node_type: 'file',
            },
          ],
        }),
      );

      const patches = await listPatches(identity, fetchMock);

      expect(patches[0].permissions).toEqual(samplePermissions);
    });

    it('omits isNew when wire returns is_new === false', async () => {
      const identity = generateIdentity();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        ok({
          patches: [
            {
              machine_id: '10.0.0.1',
              path: '/x',
              content: 'x',
              owner: 'user',
              permissions: null,
              is_new: false,
              node_type: 'file',
            },
          ],
        }),
      );

      const patches = await listPatches(identity, fetchMock);

      expect(patches[0]).not.toHaveProperty('isNew');
    });

    it('sets isNew: true when wire returns is_new === true', async () => {
      const identity = generateIdentity();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        ok({
          patches: [
            {
              machine_id: '10.0.0.1',
              path: '/x',
              content: 'x',
              owner: 'user',
              permissions: null,
              is_new: true,
              node_type: 'file',
            },
          ],
        }),
      );

      const patches = await listPatches(identity, fetchMock);

      expect(patches[0].isNew).toBe(true);
    });

    it('omits nodeType when wire returns node_type === "file" (the default)', async () => {
      const identity = generateIdentity();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        ok({
          patches: [
            {
              machine_id: '10.0.0.1',
              path: '/x',
              content: 'x',
              owner: 'user',
              permissions: null,
              is_new: false,
              node_type: 'file',
            },
          ],
        }),
      );

      const patches = await listPatches(identity, fetchMock);

      expect(patches[0]).not.toHaveProperty('nodeType');
    });

    it('sets nodeType: "directory" when wire returns node_type === "directory"', async () => {
      const identity = generateIdentity();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        ok({
          patches: [
            {
              machine_id: '10.0.0.1',
              path: '/srv/data',
              content: null,
              owner: 'root',
              permissions: null,
              is_new: true,
              node_type: 'directory',
            },
          ],
        }),
      );

      const patches = await listPatches(identity, fetchMock);

      expect(patches[0].nodeType).toBe('directory');
    });

    it('passes content === null through verbatim (deletion marker)', async () => {
      const identity = generateIdentity();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        ok({
          patches: [
            {
              machine_id: '10.0.0.1',
              path: '/etc/passwd',
              content: null,
              owner: 'root',
              permissions: null,
              is_new: false,
              node_type: 'file',
            },
          ],
        }),
      );

      const patches = await listPatches(identity, fetchMock);

      expect(patches[0].content).toBeNull();
    });
  });

  describe('malformed responses', () => {
    it('throws when response is missing patches field', async () => {
      const identity = generateIdentity();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({}));

      await expect(listPatches(identity, fetchMock)).rejects.toThrow();
    });

    it('throws when patches is not an array', async () => {
      const identity = generateIdentity();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ patches: 'oops' }));

      await expect(listPatches(identity, fetchMock)).rejects.toThrow();
    });
  });

  it('throws on non-2xx with status code in message', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errResponse(500));

    await expect(listPatches(identity, fetchMock)).rejects.toThrow(/500/);
  });

  it('propagates fetch errors', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));

    await expect(listPatches(identity, fetchMock)).rejects.toThrow('network failure');
  });
});

// -----------------------------------------------------------------------
// clearTransientPatches
// -----------------------------------------------------------------------

describe('clearTransientPatches', () => {
  it('POSTs action="clearTransientPatches" with a valid envelope', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ affected: 0 }));

    await clearTransientPatches(identity, fetchMock);

    const payload = getPayload(fetchMock);
    expect(payload.action).toBe('clearTransientPatches');
    expect(payload).not.toHaveProperty('machine_id');
  });

  it('signs with the provided identity', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ affected: 0 }));

    await clearTransientPatches(identity, fetchMock);

    const env = getEnvelope(fetchMock);
    expect(env.publicKey).toBe(identity.publicKeyHex);
    const sig = hexToBytes(env.signature)!;
    const pub = hexToBytes(env.publicKey)!;
    const msg = new TextEncoder().encode(env.payload);
    expect(verify(pub, sig, msg)).toBe(true);
  });

  it('resolves to undefined on 200', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ affected: 5 }));

    expect(await clearTransientPatches(identity, fetchMock)).toBeUndefined();
  });

  it('throws on non-2xx', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errResponse(500));

    await expect(clearTransientPatches(identity, fetchMock)).rejects.toThrow(/500/);
  });
});

// -----------------------------------------------------------------------
// clearOwnedPatches
// -----------------------------------------------------------------------

describe('clearOwnedPatches', () => {
  it('POSTs action="clearOwnedPatches" with a valid envelope', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ affected: 0 }));

    await clearOwnedPatches(identity, fetchMock);

    const payload = getPayload(fetchMock);
    expect(payload.action).toBe('clearOwnedPatches');
  });

  it('signs with the provided identity', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ affected: 0 }));

    await clearOwnedPatches(identity, fetchMock);

    const env = getEnvelope(fetchMock);
    expect(env.publicKey).toBe(identity.publicKeyHex);
    const sig = hexToBytes(env.signature)!;
    const pub = hexToBytes(env.publicKey)!;
    const msg = new TextEncoder().encode(env.payload);
    expect(verify(pub, sig, msg)).toBe(true);
  });

  it('resolves to undefined on 200', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ affected: 42 }));

    expect(await clearOwnedPatches(identity, fetchMock)).toBeUndefined();
  });

  it('throws on non-2xx', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errResponse(500));

    await expect(clearOwnedPatches(identity, fetchMock)).rejects.toThrow(/500/);
  });
});
