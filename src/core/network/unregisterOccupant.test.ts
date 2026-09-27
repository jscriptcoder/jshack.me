import { describe, expect, it, vi } from 'vitest';
import {
  handleUnregisterOccupant,
  type UnregisterOccupantDeps,
} from './unregisterOccupant';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleUnregisterOccupant` is the disconnect half of the occupancy lifecycle
 * (Story 7, slice 7.2b): leaving a WiFi network removes the player's occupancy row.
 * The delete is scoped to (essid, owner_key) where owner_key is server-stamped from
 * the verified pubkey — a caller can only ever remove its OWN row, never another
 * occupant's. Idempotent (a repeat disconnect deletes nothing and still succeeds).
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

const makeDeps = (over: Partial<UnregisterOccupantDeps> = {}) => {
  const deleteOccupant = vi.fn<
    (query: { essid: string; owner_key: string }) => Promise<{ error: unknown }>
  >(async () => ({ error: null }));
  const deps: UnregisterOccupantDeps = { nonceStore: freshStore, deleteOccupant, ...over };
  return { deps, deleteOccupant };
};

const envelope = (id: ReturnType<typeof generateIdentity>, over: Record<string, unknown> = {}) =>
  signRequest(id, 'unregisterOccupant', { essid: ESSID, ...over });

describe('handleUnregisterOccupant', () => {
  it("deletes the caller's occupancy row scoped to (essid, server-stamped owner_key)", async () => {
    const id = generateIdentity();
    const { deps, deleteOccupant } = makeDeps();

    const result = await handleUnregisterOccupant(envelope(id), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(deleteOccupant).toHaveBeenCalledTimes(1);
    expect(deleteOccupant.mock.calls[0]![0]).toEqual({
      essid: ESSID,
      owner_key: id.publicKeyHex,
    });
  });

  it('rejects a payload that smuggles a client-supplied owner_key without deleting', async () => {
    const id = generateIdentity();
    const { deps, deleteOccupant } = makeDeps();

    const result = await handleUnregisterOccupant(envelope(id, { owner_key: 'attacker-key' }), deps);

    expect(result.status).toBe(400);
    expect(deleteOccupant).not.toHaveBeenCalled();
  });

  it('rejects a payload that smuggles a client-supplied player_key without deleting', async () => {
    const id = generateIdentity();
    const { deps, deleteOccupant } = makeDeps();

    const result = await handleUnregisterOccupant(
      envelope(id, { player_key: 'attacker-key' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(deleteOccupant).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the essid without deleting', async () => {
    const id = generateIdentity();
    const { deps, deleteOccupant } = makeDeps();

    const result = await handleUnregisterOccupant(signRequest(id, 'unregisterOccupant', {}), deps);

    expect(result.status).toBe(400);
    expect(deleteOccupant).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope (payload changed after signing) without deleting', async () => {
    const id = generateIdentity();
    const { deps, deleteOccupant } = makeDeps();
    const signed = envelope(id);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleUnregisterOccupant(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(deleteOccupant).not.toHaveBeenCalled();
  });

  it('reports a server error when the delete fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps({
      deleteOccupant: vi.fn(async () => ({ error: new Error('db down') })),
    });

    const result = await handleUnregisterOccupant(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'occupant_delete_failed' } });
  });
});
