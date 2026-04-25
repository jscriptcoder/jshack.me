import { describe, it, expect, vi } from 'vitest';
import { createUpstashNonceStore, noopNonceStore } from './nonceStore';

describe('noopNonceStore', () => {
  it('always reports fresh', async () => {
    expect(await noopNonceStore('any-nonce')).toEqual({ fresh: true });
  });

  it('reports fresh even on repeated calls with the same nonce', async () => {
    expect(await noopNonceStore('repeated')).toEqual({ fresh: true });
    expect(await noopNonceStore('repeated')).toEqual({ fresh: true });
  });
});

describe('createUpstashNonceStore', () => {
  it('reports fresh when SET NX returns OK (key did not exist)', async () => {
    const setMock = vi.fn().mockResolvedValue('OK');
    const store = createUpstashNonceStore(setMock);
    expect(await store('abc123')).toEqual({ fresh: true });
  });

  it('reports not-fresh when SET NX returns null (key already existed)', async () => {
    const setMock = vi.fn().mockResolvedValue(null);
    const store = createUpstashNonceStore(setMock);
    expect(await store('abc123')).toEqual({ fresh: false });
  });

  it('uses a namespaced key (nonce:<value>) so it does not collide with rate-limit keys', async () => {
    const setMock = vi.fn().mockResolvedValue('OK');
    const store = createUpstashNonceStore(setMock);
    await store('deadbeef');
    expect(setMock).toHaveBeenCalledWith(
      'nonce:deadbeef',
      expect.any(String),
      expect.objectContaining({ nx: true }),
    );
  });

  it('sets a 120-second TTL matching the replay window', async () => {
    const setMock = vi.fn().mockResolvedValue('OK');
    const store = createUpstashNonceStore(setMock);
    await store('abc');
    expect(setMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ ex: 120, nx: true }),
    );
  });
});
