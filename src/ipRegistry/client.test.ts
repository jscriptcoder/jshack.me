import { describe, it, expect, vi } from 'vitest';
import { allocatePublicIp } from './client';

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
  it('POSTs to /api/allocate-ip with JSON body and returns the allocated ip', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse('51.1.2.3'));

    const ip = await allocatePublicIp({ kind: 'mission_instance' }, fetchMock);

    expect(ip).toBe('51.1.2.3');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/allocate-ip',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ kind: 'mission_instance' }),
      }),
    );
  });

  it('includes owner_key and instance_ref in the body when provided', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse('51.1.2.3'));

    await allocatePublicIp(
      { kind: 'home_network', owner_key: 'ed25519:abc', instance_ref: 'ref-xyz' },
      fetchMock,
    );

    const calledWith = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(calledWith.body as string)).toEqual({
      kind: 'home_network',
      owner_key: 'ed25519:abc',
      instance_ref: 'ref-xyz',
    });
  });

  it('throws when the response has non-2xx status', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(500));

    await expect(allocatePublicIp({ kind: 'mission_instance' }, fetchMock)).rejects.toThrow();
  });

  it('throws on 429 rate-limit responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(429));

    await expect(allocatePublicIp({ kind: 'mission_instance' }, fetchMock)).rejects.toThrow();
  });

  it('throws when response body is missing ip field', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(allocatePublicIp({ kind: 'mission_instance' }, fetchMock)).rejects.toThrow();
  });

  it('throws when response body has non-string ip', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ip: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(allocatePublicIp({ kind: 'mission_instance' }, fetchMock)).rejects.toThrow();
  });

  it('propagates fetch errors (network failures)', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'));

    await expect(allocatePublicIp({ kind: 'mission_instance' }, fetchMock)).rejects.toThrow(
      'network failure',
    );
  });
});
