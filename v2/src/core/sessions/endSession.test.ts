import { describe, expect, it, vi } from 'vitest';
import { handleEndSession, type EndSessionDeps, type EndSessionParams } from './endSession';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });

const makeDeps = (over: Partial<EndSessionDeps> = {}) => {
  const endSession = vi.fn<(params: EndSessionParams) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const deps: EndSessionDeps = { nonceStore: freshStore, endSession, ...over };
  return { deps, endSession };
};

describe('handleEndSession', () => {
  it('ends the session scoped to the verified player_key', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'endSession', { session_id: 'su-root-1700000000000' });
    const { deps, endSession } = makeDeps();

    const result = await handleEndSession(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    // Scoped to the VERIFIED pubkey so a caller can only end their OWN sessions.
    expect(endSession).toHaveBeenCalledWith({
      session_id: 'su-root-1700000000000',
      player_key: id.publicKeyHex,
      reason: 'user_exit',
    });
  });

  it('records why the session ended, so an abandoned row is distinguishable from an exit', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'endSession', {
      session_id: 'ftp-guest-1700000000000',
      reason: 'abandoned',
    });
    const { deps, endSession } = makeDeps();

    const result = await handleEndSession(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(endSession).toHaveBeenCalledWith({
      session_id: 'ftp-guest-1700000000000',
      player_key: id.publicKeyHex,
      reason: 'abandoned',
    });
  });

  it('refuses a reason outside the known set rather than storing free text', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'endSession', {
      session_id: 'su-root-1700000000000',
      reason: 'whatever the client felt like',
    });
    const { deps, endSession } = makeDeps();

    const result = await handleEndSession(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(endSession).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied player_key with 400 and never ends', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'endSession', {
      session_id: 'su-root-1700000000000',
      player_key: 'forged-key',
    });
    const { deps, endSession } = makeDeps();

    const result = await handleEndSession(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(endSession).not.toHaveBeenCalled();
  });

  it('rejects a payload missing session_id with 400 and never ends', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'endSession', {});
    const { deps, endSession } = makeDeps();

    const result = await handleEndSession(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(endSession).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and never ends', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'endSession', { session_id: 'su-root-1700000000000' });
    const { deps, endSession } = makeDeps();

    const result = await handleEndSession({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(endSession).not.toHaveBeenCalled();
  });

  it('returns 500 when the update fails', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'endSession', { session_id: 'su-root-1700000000000' });
    const { deps } = makeDeps({ endSession: async () => ({ error: { message: 'db down' } }) });

    const result = await handleEndSession(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'update_failed' } });
  });
});
