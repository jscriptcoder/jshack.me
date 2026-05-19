import { describe, it, expect, vi } from 'vitest';
import { lookupHomeNetwork } from './lookupClient';
import { generateIdentity, verify } from '../identity/identity';
import { hexToBytes } from '../identity/hex';
import { signedEnvelopeSchema } from '../signedRequest/types';

const okResponse = (body: object): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errorResponse = (status: number, body: object = { error: 'x' }): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const validLookupResult = {
  public_ip: '162.174.39.103',
  essid_template: 'ACME-CORP',
  density_tier: 'crowded' as const,
  max_slots: 8,
  seed: 'home-162.174.39.103',
};

describe('lookupHomeNetwork', () => {
  it('POSTs a signed envelope to /api/lookup-home-network and returns the parsed result', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse(validLookupResult));

    const result = await lookupHomeNetwork(identity, '162.174.39.103', fetchMock);

    expect(result).toEqual(validLookupResult);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lookup-home-network',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('sends a body that matches the SignedEnvelope schema', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse(validLookupResult));

    await lookupHomeNetwork(identity, '162.174.39.103', fetchMock);

    const calledWith = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body: unknown = JSON.parse(calledWith.body as string);
    expect(signedEnvelopeSchema.safeParse(body).success).toBe(true);
  });

  it('signs the payload with the provided identity (verifiable on the server)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse(validLookupResult));

    await lookupHomeNetwork(identity, '162.174.39.103', fetchMock);

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

  it('embeds action="lookupHomeNetwork" and the public_ip in the signed payload', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse(validLookupResult));

    await lookupHomeNetwork(identity, '203.0.113.42', fetchMock);

    const calledWith = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(calledWith.body as string) as { payload: string };
    const payload = JSON.parse(body.payload) as Record<string, unknown>;
    expect(payload.action).toBe('lookupHomeNetwork');
    expect(payload.public_ip).toBe('203.0.113.42');
  });

  it('returns null on 404 (not found is a routine outcome for lookup)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(404, { error: 'not_found' }));

    const result = await lookupHomeNetwork(identity, '192.0.2.111', fetchMock);

    expect(result).toBeNull();
  });

  it('throws on 401 (signature_invalid / replay / timestamp_skew)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(401, { error: 'signature_invalid' }));

    await expect(lookupHomeNetwork(identity, '162.174.39.103', fetchMock)).rejects.toThrow();
  });

  it('throws on 429 rate-limit responses', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(429));

    await expect(lookupHomeNetwork(identity, '162.174.39.103', fetchMock)).rejects.toThrow();
  });

  it('throws on 500 responses', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(500));

    await expect(lookupHomeNetwork(identity, '162.174.39.103', fetchMock)).rejects.toThrow();
  });

  it('throws when response body is missing required fields', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse({ public_ip: '162.174.39.103' }));

    await expect(lookupHomeNetwork(identity, '162.174.39.103', fetchMock)).rejects.toThrow();
  });

  it('throws when response body has unexpected field types', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse({ ...validLookupResult, max_slots: '8' }));

    await expect(lookupHomeNetwork(identity, '162.174.39.103', fetchMock)).rejects.toThrow();
  });

  it('throws when response body has a density_tier outside the canonical set', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse({ ...validLookupResult, density_tier: 'tiny' }));

    await expect(lookupHomeNetwork(identity, '162.174.39.103', fetchMock)).rejects.toThrow();
  });

  it('propagates fetch errors (network failures)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));

    await expect(lookupHomeNetwork(identity, '162.174.39.103', fetchMock)).rejects.toThrow(
      'network failure',
    );
  });
});
