import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveOccupiedEssids,
  type OccupiedEssidRow,
  type ResolveOccupiedEssidsDeps,
} from './resolveOccupiedEssids';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolveOccupiedEssids` is the organic-discovery read: it answers "which
 * ESSIDs does anyone currently occupy?" to any VERIFIED identity. Unlike the
 * occupant-list read, it is deliberately UNGATED — a player discovers networks
 * they are not yet on — and deliberately NAME-ONLY: it returns occupied ESSID
 * strings and nothing else (no owner key, machine id, or LAN IP), so it can be
 * injected into a stranger's scan without leaking who is there.
 */

const freshStore: NonceStore = async () => ({ fresh: true });

const makeDeps = (
  essids: readonly string[],
  over: Partial<ResolveOccupiedEssidsDeps> = {},
) => {
  const rows: readonly OccupiedEssidRow[] = essids.map((essid) => ({ essid }));
  const listAllOccupiedEssids = vi.fn<
    () => Promise<{ data: readonly OccupiedEssidRow[] | null; error: unknown }>
  >(async () => ({ data: rows, error: null }));
  const deps: ResolveOccupiedEssidsDeps = { nonceStore: freshStore, listAllOccupiedEssids, ...over };
  return { deps, listAllOccupiedEssids };
};

const envelope = (id: ReturnType<typeof generateIdentity>, over: Record<string, unknown> = {}) =>
  signRequest(id, 'resolveOccupiedEssids', { ...over });

describe('handleResolveOccupiedEssids', () => {
  it('returns the currently-occupied ESSID names to a verified caller', async () => {
    const caller = generateIdentity();
    const { deps } = makeDeps(['BEAN-THERE-WIFI', 'NAKATOMI-PLAZA']);

    const result = await handleResolveOccupiedEssids(envelope(caller), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, essids: ['BEAN-THERE-WIFI', 'NAKATOMI-PLAZA'] },
    });
  });

  it('serves a caller who occupies nothing (ungated discovery — no occupancy needed)', async () => {
    // The caller's key is nowhere in the occupied set, yet the read still succeeds
    // — this is what lets a stranger discover a network before joining it.
    const stranger = generateIdentity();
    const { deps } = makeDeps(['STARK-WIFI']);

    const result = await handleResolveOccupiedEssids(envelope(stranger), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, essids: ['STARK-WIFI'] } });
  });

  it('returns each occupied ESSID once even when several players occupy it', async () => {
    const caller = generateIdentity();
    const { deps } = makeDeps(['STARK-WIFI', 'STARK-WIFI', 'BEAN-THERE-WIFI', 'STARK-WIFI']);

    const result = await handleResolveOccupiedEssids(envelope(caller), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, essids: ['STARK-WIFI', 'BEAN-THERE-WIFI'] },
    });
  });

  it('returns only ESSID names — no owner key, machine id, or LAN IP crosses the wire', async () => {
    const caller = generateIdentity();
    const { deps } = makeDeps(['STARK-WIFI']);

    const result = await handleResolveOccupiedEssids(envelope(caller), deps);

    const essids = result.body.essids as readonly unknown[];
    // Every element is a bare string, never an object carrying occupant identity.
    for (const entry of essids) {
      expect(typeof entry).toBe('string');
    }
  });

  it('returns an empty list when nobody is occupying any network', async () => {
    const caller = generateIdentity();
    const { deps } = makeDeps([]);

    const result = await handleResolveOccupiedEssids(envelope(caller), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, essids: [] } });
  });

  it('rejects a payload that smuggles a client-supplied owner_key without reading', async () => {
    const caller = generateIdentity();
    const { deps, listAllOccupiedEssids } = makeDeps(['STARK-WIFI']);

    const result = await handleResolveOccupiedEssids(
      envelope(caller, { owner_key: 'attacker-key' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(listAllOccupiedEssids).not.toHaveBeenCalled();
  });

  it('rejects a payload that smuggles a client-supplied player_key without reading', async () => {
    const caller = generateIdentity();
    const { deps, listAllOccupiedEssids } = makeDeps(['STARK-WIFI']);

    const result = await handleResolveOccupiedEssids(
      envelope(caller, { player_key: 'attacker-key' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(listAllOccupiedEssids).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope (payload changed after signing) without reading', async () => {
    const caller = generateIdentity();
    const { deps, listAllOccupiedEssids } = makeDeps(['STARK-WIFI']);
    const signed = envelope(caller);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleResolveOccupiedEssids(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(listAllOccupiedEssids).not.toHaveBeenCalled();
  });

  it('rejects a validly-signed envelope for a different action without reading', async () => {
    // Defense in depth at the trust boundary: the handler validates the action
    // itself rather than trusting the dispatcher to have routed correctly.
    const caller = generateIdentity();
    const { deps, listAllOccupiedEssids } = makeDeps(['STARK-WIFI']);

    const result = await handleResolveOccupiedEssids(
      signRequest(caller, 'resolveOccupants', { essid: 'STARK-WIFI' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(listAllOccupiedEssids).not.toHaveBeenCalled();
  });

  it('reports a server error when the occupied-ESSID lookup fails', async () => {
    const caller = generateIdentity();
    const { deps } = makeDeps([], {
      listAllOccupiedEssids: vi.fn(async () => ({ data: null, error: new Error('db down') })),
    });

    const result = await handleResolveOccupiedEssids(envelope(caller), deps);

    expect(result).toEqual({ status: 500, body: { error: 'occupied_essids_lookup_failed' } });
  });
});
