import { describe, it, expect, vi } from 'vitest';
import { registerWorkstation } from './client';
import { generateIdentity, verify } from '../identity/identity';
import { hexToBytes } from '../identity/hex';
import { signedEnvelopeSchema } from '../signedRequest/types';

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

describe('registerWorkstation', () => {
  it('POSTs a signed envelope to /api/register-workstation and returns the response', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ inserted: true }));

    const result = await registerWorkstation(
      identity,
      { workstation_name: 'skylab', username: 'alice' },
      fetchMock,
    );

    expect(result).toEqual({ inserted: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/register-workstation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('sends a body matching the SignedEnvelope schema with action=registerWorkstation', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ inserted: true }));

    await registerWorkstation(
      identity,
      { workstation_name: 'skylab', username: 'alice' },
      fetchMock,
    );

    const init = fetchMock.mock.calls[0]![1]!;
    const envelope = signedEnvelopeSchema.parse(JSON.parse(init.body as string));
    expect(envelope.publicKey).toBe(identity.publicKeyHex);

    const payload = JSON.parse(envelope.payload) as Record<string, unknown>;
    expect(payload.action).toBe('registerWorkstation');
    expect(payload.workstation_name).toBe('skylab');
    expect(payload.username).toBe('alice');

    const signatureValid = verify(
      hexToBytes(envelope.publicKey)!,
      hexToBytes(envelope.signature)!,
      new TextEncoder().encode(envelope.payload),
    );
    expect(signatureValid).toBe(true);
  });

  it('throws on non-2xx responses', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errResponse(429, { error: 'rate_limited' }));

    await expect(
      registerWorkstation(identity, { workstation_name: 'skylab', username: 'alice' }, fetchMock),
    ).rejects.toThrow(/status 429/);
  });

  it('throws when the response body is missing `inserted`', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok({ wrong_field: true }));

    await expect(
      registerWorkstation(identity, { workstation_name: 'skylab', username: 'alice' }, fetchMock),
    ).rejects.toThrow(/malformed response/);
  });
});
