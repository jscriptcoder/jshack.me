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

describe('handleListSessions', () => {
  it('returns the player’s active rows across ALL machines, scoped by the verified player_key alone', async () => {
    const id = generateIdentity();
    // A hop chain spanning machines: an su elevation on the own workstation AND
    // an ssh hop onto a remote LAN host — both must come back, or a refresh
    // silently drops the cross-machine part of the chain.
    const rows = [
      aRow({ machine_id: computeWorkstationId('skylab', id.publicKeyHex) }),
      aRow({
        session_id: 'ssh-root-1700000000100',
        machine_id: 'darkstar-12345678',
        kind: 'ssh',
        source_ip: '192.168.50.7',
        created_at: '2026-06-07T14:33:01.000Z',
      }),
    ];
    const envelope = signRequest(id, 'listSessions', {});
    const { deps, listSessions } = makeDeps();
    listSessions.mockResolvedValue({ data: rows, error: null });

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 200, body: { sessions: rows } });
    // The query is scoped to the VERIFIED pubkey, never a client claim — and to
    // NOTHING else: player_key alone IS the boundary (no machine filter).
    expect(listSessions).toHaveBeenCalledWith({ player_key: id.publicKeyHex });
  });

  it('returns an empty list (not null) when the player has no active sessions', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'listSessions', {});
    const { deps } = makeDeps({ listSessions: async () => ({ data: null, error: null }) });

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 200, body: { sessions: [] } });
  });

  it('rejects a client-supplied player_key with 400 and never queries', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'listSessions', { player_key: 'forged-key' });
    const { deps, listSessions } = makeDeps();

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('rejects an envelope signed for a different action with 400 and never queries', async () => {
    const id = generateIdentity();
    // A validly-signed envelope for ANOTHER action must not double as a
    // listSessions read — the action literal binds the signature to one intent.
    const envelope = signRequest(id, 'endSession', { session_id: 'su-root-1' });
    const { deps, listSessions } = makeDeps();

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and never queries', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'listSessions', {});
    const { deps, listSessions } = makeDeps();

    const result = await handleListSessions({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('returns 500 when the query fails', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'listSessions', {});
    const { deps } = makeDeps({ listSessions: async () => ({ data: null, error: { message: 'db down' } }) });

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'read_failed' } });
  });
});
