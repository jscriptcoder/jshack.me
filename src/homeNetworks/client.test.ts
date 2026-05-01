import { describe, it, expect, vi } from 'vitest';
import { joinHomeNetwork } from './client';
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

const validJoinResult = {
  public_ip: '203.0.113.42',
  lan_ip: '.187',
  hostname: 'skylab-9k3',
  network_seed: 'home-203.0.113.42',
};

describe('joinHomeNetwork', () => {
  it('POSTs a signed envelope to /api/join-home-network and returns the parsed result', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse(validJoinResult));

    const result = await joinHomeNetwork(
      identity,
      { essid_template: 'ACME-CORP', density_tier: 'crowded', workstation_prefix: 'skylab' },
      fetchMock,
    );

    expect(result).toEqual(validJoinResult);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/join-home-network',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('sends a body that matches the SignedEnvelope schema', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse(validJoinResult));

    await joinHomeNetwork(
      identity,
      { essid_template: 'ACME-CORP', density_tier: 'shared', workstation_prefix: 'rocket' },
      fetchMock,
    );

    const calledWith = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body: unknown = JSON.parse(calledWith.body as string);
    expect(signedEnvelopeSchema.safeParse(body).success).toBe(true);
  });

  it('signs the payload with the provided identity (verifiable on the server)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse(validJoinResult));

    await joinHomeNetwork(
      identity,
      { essid_template: 'ACME-CORP', density_tier: 'crowded', workstation_prefix: 'skylab' },
      fetchMock,
    );

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

  it('embeds action="joinHomeNetwork" and the request fields in the signed payload', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse(validJoinResult));

    await joinHomeNetwork(
      identity,
      { essid_template: 'GLOBEX-NET', density_tier: 'solo', workstation_prefix: 'mainframe' },
      fetchMock,
    );

    const calledWith = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(calledWith.body as string) as { payload: string };
    const payload = JSON.parse(body.payload) as Record<string, unknown>;
    expect(payload.action).toBe('joinHomeNetwork');
    expect(payload.essid_template).toBe('GLOBEX-NET');
    expect(payload.density_tier).toBe('solo');
    expect(payload.workstation_prefix).toBe('mainframe');
  });

  it('throws when the response has non-2xx status', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(500));
    await expect(
      joinHomeNetwork(
        identity,
        { essid_template: 'ACME-CORP', density_tier: 'crowded', workstation_prefix: 'skylab' },
        fetchMock,
      ),
    ).rejects.toThrow();
  });

  it('throws on 429 rate-limit responses', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(429));
    await expect(
      joinHomeNetwork(
        identity,
        { essid_template: 'ACME-CORP', density_tier: 'crowded', workstation_prefix: 'skylab' },
        fetchMock,
      ),
    ).rejects.toThrow();
  });

  it('throws on 401 responses (signature_invalid / replay / timestamp_skew)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(401, { error: 'signature_invalid' }));
    await expect(
      joinHomeNetwork(
        identity,
        { essid_template: 'ACME-CORP', density_tier: 'crowded', workstation_prefix: 'skylab' },
        fetchMock,
      ),
    ).rejects.toThrow();
  });

  it('throws on 409 hostname_conflict responses', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(409, { error: 'hostname_conflict' }));
    await expect(
      joinHomeNetwork(
        identity,
        { essid_template: 'ACME-CORP', density_tier: 'crowded', workstation_prefix: 'skylab' },
        fetchMock,
      ),
    ).rejects.toThrow();
  });

  it('throws when response body is missing required fields', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse({ public_ip: '203.0.113.42' }));
    await expect(
      joinHomeNetwork(
        identity,
        { essid_template: 'ACME-CORP', density_tier: 'crowded', workstation_prefix: 'skylab' },
        fetchMock,
      ),
    ).rejects.toThrow();
  });

  it('throws when response body has unexpected field types', async () => {
    const identity = generateIdentity();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse({ ...validJoinResult, lan_ip: 187 }));
    await expect(
      joinHomeNetwork(
        identity,
        { essid_template: 'ACME-CORP', density_tier: 'crowded', workstation_prefix: 'skylab' },
        fetchMock,
      ),
    ).rejects.toThrow();
  });

  it('propagates fetch errors (network failures)', async () => {
    const identity = generateIdentity();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));
    await expect(
      joinHomeNetwork(
        identity,
        { essid_template: 'ACME-CORP', density_tier: 'crowded', workstation_prefix: 'skylab' },
        fetchMock,
      ),
    ).rejects.toThrow('network failure');
  });
});
