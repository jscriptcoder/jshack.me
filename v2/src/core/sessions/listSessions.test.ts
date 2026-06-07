import { describe, expect, it, vi } from 'vitest';
import {
  handleListSessions,
  type ListSessionsDeps,
  type ListSessionsQuery,
  type SessionSummary,
} from './listSessions';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });

const aRow = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  session_id: 'su-root-1700000000000',
  machine_id: 'skylab-deadbeef',
  credentials: { username: 'root', userType: 'root' },
  parent_session_id: 'seed-session',
  source_ip: null,
  kind: 'su',
  created_at: '2026-06-07T14:32:01.000Z',
  ...over,
});

const makeDeps = (over: Partial<ListSessionsDeps> = {}) => {
  const listSessions = vi.fn<
    (query: ListSessionsQuery) => Promise<{ data: readonly SessionSummary[] | null; error: unknown }>
  >(async () => ({ data: [], error: null }));
  const deps: ListSessionsDeps = { nonceStore: freshStore, listSessions, ...over };
  return { deps, listSessions };
};

const ownQuery = (publicKeyHex: string) => ({
  machine_id: computeWorkstationId('skylab', publicKeyHex),
});

describe('handleListSessions', () => {
  it('returns the active rows scoped to the verified player_key + own machine', async () => {
    const id = generateIdentity();
    const machineId = computeWorkstationId('skylab', id.publicKeyHex);
    const rows = [aRow({ machine_id: machineId })];
    const envelope = signRequest(id, 'listSessions', ownQuery(id.publicKeyHex));
    const { deps, listSessions } = makeDeps();
    listSessions.mockResolvedValue({ data: rows, error: null });

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 200, body: { sessions: rows } });
    // The query is scoped to the VERIFIED pubkey, never a client claim.
    expect(listSessions).toHaveBeenCalledWith({ player_key: id.publicKeyHex, machine_id: machineId });
  });

  it('returns an empty list (not null) when the player has no active sessions', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'listSessions', ownQuery(id.publicKeyHex));
    const { deps } = makeDeps({ listSessions: async () => ({ data: null, error: null }) });

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 200, body: { sessions: [] } });
  });

  it('rejects a read of a machine that is not the caller’s workstation with 403 and never queries', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'listSessions', {
      machine_id: computeWorkstationId('victim', 'b'.repeat(64)),
    });
    const { deps, listSessions } = makeDeps();

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('rejects a payload missing machine_id with 400 payload_invalid and never queries', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'listSessions', {});
    const { deps, listSessions } = makeDeps();

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied player_key with 400 and never queries', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'listSessions', {
      ...ownQuery(id.publicKeyHex),
      player_key: 'forged-key',
    });
    const { deps, listSessions } = makeDeps();

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and never queries', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'listSessions', ownQuery(id.publicKeyHex));
    const { deps, listSessions } = makeDeps();

    const result = await handleListSessions({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('returns 500 when the query fails', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'listSessions', ownQuery(id.publicKeyHex));
    const { deps } = makeDeps({ listSessions: async () => ({ data: null, error: { message: 'db down' } }) });

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'read_failed' } });
  });
});
