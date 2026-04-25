import { describe, it, expect, vi } from 'vitest';
import { allocatePublicIp } from './client';
import { generateIdentity, verify } from '../identity/identity';
import { hexToBytes } from '../identity/hex';
import { signedEnvelopeSchema } from '../signedRequest/types';

const okResponse = (ip: string): Response =>
  new Response(JSON.stringify({ ip }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errorResponse = (status: number, body: object = { error: 'x' }): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('allocatePublicIp', () => {
  it('POSTs a signed envelope to /api/allocate-ip and returns the allocated ip', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse('51.1.2.3'));

    const ip = await allocatePublicIp(identity, { kind: 'mission_instance' }, fetchMock);

    expect(ip).toBe('51.1.2.3');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/allocate-ip',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('sends a body that matches the SignedEnvelope schema', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse('51.1.2.3'));

    await allocatePublicIp(identity, { kind: 'mission_instance' }, fetchMock);

    const calledWith = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body: unknown = JSON.parse(calledWith.body as string);
    expect(signedEnvelopeSchema.safeParse(body).success).toBe(true);
  });

  it('signs the payload with the provided identity (verifiable on the server)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse('51.1.2.3'));

    await allocatePublicIp(identity, { kind: 'mission_instance' }, fetchMock);

    const calledWith = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(calledWith.body as string) as {
      payload: string;
      publicKey: string;
      signature: string;
    };

    expect(body.publicKey).toBe(identity.publicKeyHex);
    const sig = hexToBytes(body.signature)!;
    const pub = hexToBytes(body.publicKey)!;
    const msg = new TextEncoder().encode(body.payload);
    expect(verify(pub, sig, msg)).toBe(true);
  });

  it('embeds the action and request fields in the signed payload', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse('51.1.2.3'));

    await allocatePublicIp(identity, { kind: 'home_network', instance_ref: 'ref-xyz' }, fetchMock);

    const calledWith = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(calledWith.body as string) as { payload: string };
    const payload = JSON.parse(body.payload) as Record<string, unknown>;
    expect(payload.action).toBe('allocateIp');
    expect(payload.kind).toBe('home_network');
    expect(payload.instance_ref).toBe('ref-xyz');
  });

  it('throws when the response has non-2xx status', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(500));
    await expect(
      allocatePublicIp(identity, { kind: 'mission_instance' }, fetchMock),
    ).rejects.toThrow();
  });

  it('throws on 429 rate-limit responses', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(429));
    await expect(
      allocatePublicIp(identity, { kind: 'mission_instance' }, fetchMock),
    ).rejects.toThrow();
  });

  it('throws on 401 (signature_invalid / replay / timestamp_skew) responses', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(401, { error: 'signature_invalid' }));
    await expect(
      allocatePublicIp(identity, { kind: 'mission_instance' }, fetchMock),
    ).rejects.toThrow();
  });

  it('throws when response body is missing ip field', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(
      allocatePublicIp(identity, { kind: 'mission_instance' }, fetchMock),
    ).rejects.toThrow();
  });

  it('throws when response body has non-string ip', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ip: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(
      allocatePublicIp(identity, { kind: 'mission_instance' }, fetchMock),
    ).rejects.toThrow();
  });

  it('propagates fetch errors (network failures)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));
    await expect(
      allocatePublicIp(identity, { kind: 'mission_instance' }, fetchMock),
    ).rejects.toThrow('network failure');
  });
});
