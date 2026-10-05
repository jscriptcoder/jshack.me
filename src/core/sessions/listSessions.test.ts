import { describe, expect, it, vi } from 'vitest';
import {
  handleListSessions,
  type ListSessionsDeps,
  type ListSessionsQuery,
  type SessionSummary,
} from './listSessions.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { sessionRow, sessionTable } from '../../test/factories/sessionTable.js';

const freshStore: NonceStore = async () => ({ fresh: true });

const aRow = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  session_id: 'su-root-1700000000000',
  machine_id: 'skylab-deadbeef',
  credentials: { username: 'root', userType: 'root' },
  parent_session_id: 'seed-session',
  source_ip: null,
  kind: 'su',
  created_at: '2026-06-07T14:32:01.000Z',
  essid: null,
  ...over,
});

const makeDeps = (over: Partial<ListSessionsDeps> = {}) => {
  const listSessions = vi.fn<
    (
      query: ListSessionsQuery,
    ) => Promise<{ data: readonly SessionSummary[] | null; error: unknown }>
  >(async () => ({ data: [], error: null }));
  const deps: ListSessionsDeps = {
    nonceStore: freshStore,
    listSessions,
    findEndedSessions: async () => ({ data: [], error: null }),
    endSessionsAbove: async () => ({ data: [], error: null }),
    ...over,
  };
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
    const { deps } = makeDeps({
      listSessions: async () => ({ data: null, error: { message: 'db down' } }),
    });

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'read_failed' } });
  });
});

/**
 * A reload rebuilds the hop chain from this list, so a session whose parent has
 * ended must not come back: it would stand the player on a box reached through a
 * hop that is gone. The server ends it here, with the reason only it may write.
 */
describe('a chain whose lower leg has ended', () => {
  it('ends a session whose parent has ended, and all above it, listing neither', async () => {
    const id = generateIdentity();
    const bob = id.publicKeyHex;
    const elevation = sessionRow({ session_id: 'su-own', player_key: bob, kind: 'su' });
    const table = sessionTable([
      sessionRow({ session_id: 'hop-p', player_key: bob, ended: 'rebooted' }),
      sessionRow({ session_id: 'hop-q', player_key: bob, parent_session_id: 'hop-p' }),
      sessionRow({ session_id: 'hop-r', player_key: bob, parent_session_id: 'hop-q' }),
      elevation,
    ]);
    const envelope = signRequest(id, 'listSessions', {});
    const { deps } = makeDeps(table);

    const result = await handleListSessions(envelope, deps);

    const { player_key: _player, ...listed } = elevation;
    expect(result).toEqual({ status: 200, body: { sessions: [listed] } });
    expect(table.reasonOf('hop-q')).toBe('upstream_lost');
    expect(table.reasonOf('hop-r')).toBe('upstream_lost');
  });

  // Every first hop names the base login, which has no row. Another player's ended
  // row carrying that name is no parent of this player's.
  it("keeps a first hop whose parent's name another player's ended row carries", async () => {
    const id = generateIdentity();
    const firstHop = sessionRow({ session_id: 'hop-p', player_key: id.publicKeyHex });
    const table = sessionTable([
      sessionRow({
        session_id: 'seed-session',
        player_key: 'mallory-key',
        parent_session_id: null,
        ended: 'rebooted',
      }),
      firstHop,
    ]);
    const envelope = signRequest(id, 'listSessions', {});
    const { deps } = makeDeps(table);

    const result = await handleListSessions(envelope, deps);

    const { player_key: _player, ...listed } = firstHop;
    expect(result).toEqual({ status: 200, body: { sessions: [listed] } });
    expect(table.reasonOf('hop-p')).toBeUndefined();
  });

  it('asks nothing further of rows that name no parent', async () => {
    const id = generateIdentity();
    const rows = [aRow({ parent_session_id: null })];
    const envelope = signRequest(id, 'listSessions', {});
    const findEndedSessions = vi.fn<ListSessionsDeps['findEndedSessions']>(async () => ({
      data: [],
      error: null,
    }));
    const { deps } = makeDeps({
      listSessions: async () => ({ data: rows, error: null }),
      findEndedSessions,
    });

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 200, body: { sessions: rows } });
    expect(findEndedSessions).not.toHaveBeenCalled();
  });

  it('returns 500 rather than a chain it could not check', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'listSessions', {});
    const { deps } = makeDeps({
      listSessions: async () => ({ data: [aRow()], error: null }),
      findEndedSessions: async () => ({ data: null, error: { message: 'db down' } }),
    });

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'read_failed' } });
  });

  it('returns 500 rather than a chain it could not mend', async () => {
    const id = generateIdentity();
    const table = sessionTable([
      sessionRow({ session_id: 'hop-p', player_key: id.publicKeyHex, ended: 'rebooted' }),
      sessionRow({ session_id: 'hop-q', player_key: id.publicKeyHex, parent_session_id: 'hop-p' }),
    ]);
    const envelope = signRequest(id, 'listSessions', {});
    const { deps } = makeDeps({
      listSessions: table.listSessions,
      findEndedSessions: table.findEndedSessions,
      endSessionsAbove: async () => ({ data: null, error: { message: 'db down' } }),
    });

    const result = await handleListSessions(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'read_failed' } });
  });
});
