import { describe, expect, it, vi } from 'vitest';
import { handleCreateSession, type CreateSessionDeps, type SessionRow } from './createSession';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });

const makeDeps = (over: Partial<CreateSessionDeps> = {}) => {
  const insertSession = vi.fn<(row: SessionRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const deps: CreateSessionDeps = { nonceStore: freshStore, insertSession, ...over };
  return { deps, insertSession };
};

// A `su root` session targeting the signer's OWN workstation.
const ownPayload = (publicKeyHex: string) => ({
  session_id: 'su-root-1700000000000',
  machine_id: computeWorkstationId('skylab', publicKeyHex),
  credentials: { username: 'root', userType: 'root' as const },
  kind: 'su' as const,
  parent_session_id: 'seed-session',
});

describe('handleCreateSession', () => {
  it('inserts a row with the server-stamped player_key and the client session fields', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'createSession', ownPayload(id.publicKeyHex));
    const { deps, insertSession } = makeDeps();

    const result = await handleCreateSession(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(insertSession.mock.calls[0]![0]).toEqual({
      session_id: 'su-root-1700000000000',
      // player_key is the VERIFIED pubkey, never a client claim.
      player_key: id.publicKeyHex,
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      credentials: { username: 'root', userType: 'root' },
      parent_session_id: 'seed-session',
      source_ip: null,
      kind: 'su',
    });
  });

  it('persists a switch to a regular account with userType "user"', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'createSession', {
      ...ownPayload(id.publicKeyHex),
      session_id: 'su-bob-1700000000001',
      credentials: { username: 'bob', userType: 'user' },
    });
    const { deps, insertSession } = makeDeps();

    const result = await handleCreateSession(envelope, deps);

    expect(result.status).toBe(200);
    expect(insertSession.mock.calls[0]![0].credentials).toEqual({
      username: 'bob',
      userType: 'user',
    });
  });

  it('persists a switch to the guest account with userType "guest"', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'createSession', {
      ...ownPayload(id.publicKeyHex),
      session_id: 'su-guest-1700000000002',
      credentials: { username: 'guest', userType: 'guest' },
    });
    const { deps, insertSession } = makeDeps();

    const result = await handleCreateSession(envelope, deps);

    expect(result.status).toBe(200);
    expect(insertSession.mock.calls[0]![0].credentials).toEqual({
      username: 'guest',
      userType: 'guest',
    });
  });

  it('defaults parent_session_id to null when the payload omits it', async () => {
    const id = generateIdentity();
    const { parent_session_id: _omit, ...withoutParent } = ownPayload(id.publicKeyHex);
    const envelope = signRequest(id, 'createSession', withoutParent);
    const { deps, insertSession } = makeDeps();

    await handleCreateSession(envelope, deps);

    expect(insertSession.mock.calls[0]![0].parent_session_id).toBeNull();
  });

  it('rejects a session on a machine that is not the caller’s workstation with 403 and never inserts', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'createSession', {
      ...ownPayload(id.publicKeyHex),
      machine_id: computeWorkstationId('victim', 'b'.repeat(64)),
    });
    const { deps, insertSession } = makeDeps();

    const result = await handleCreateSession(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied player_key with 400 and never inserts', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'createSession', {
      ...ownPayload(id.publicKeyHex),
      player_key: 'forged-key',
    });
    const { deps, insertSession } = makeDeps();

    const result = await handleCreateSession(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown userType with 400 and never inserts', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'createSession', {
      ...ownPayload(id.publicKeyHex),
      credentials: { username: 'root', userType: 'superuser' },
    });
    const { deps, insertSession } = makeDeps();

    const result = await handleCreateSession(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and never inserts', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'createSession', ownPayload(id.publicKeyHex));
    const { deps, insertSession } = makeDeps();

    const result = await handleCreateSession({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('returns 500 when the insert fails', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'createSession', ownPayload(id.publicKeyHex));
    const { deps } = makeDeps({ insertSession: async () => ({ error: { message: 'db down' } }) });

    const result = await handleCreateSession(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'insert_failed' } });
  });
});
