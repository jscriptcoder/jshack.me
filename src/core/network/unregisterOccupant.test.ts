import { describe, expect, it, vi } from 'vitest';
import {
  handleUnregisterOccupant,
  type UnregisterOccupantDeps,
} from './unregisterOccupant.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { sessionRow, sessionTable, type SessionRow } from '../../test/factories/sessionTable.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

/**
 * `handleUnregisterOccupant` is the disconnect half of the occupancy lifecycle: leaving
 * a WiFi network removes the player's occupancy row, and with it every connection
 * another player holds to their box. The delete is scoped to (essid, owner_key) where
 * owner_key is server-stamped from the verified pubkey — a caller can only ever remove
 * its OWN row, never another occupant's. Idempotent (a repeat disconnect deletes nothing
 * and still succeeds).
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

type Identity = ReturnType<typeof generateIdentity>;

const boxOf = (owner: Identity): string => computeWorkstationId('quarantine', owner.publicKeyHex);

/** A handler wired to an in-memory `sessions` table, with `owner`'s box on the network
 *  unless `onNetwork` says it already left. */
const makeDeps = (
  owner: Identity,
  options: {
    readonly sessions?: readonly SessionRow[];
    readonly onNetwork?: boolean;
    readonly over?: Partial<UnregisterOccupantDeps>;
  } = {},
) => {
  const table = sessionTable(options.sessions ?? []);
  const deleteOccupant = vi.fn<UnregisterOccupantDeps['deleteOccupant']>(async () => ({
    data: options.onNetwork === false ? null : { workstation_machine_id: boxOf(owner) },
    error: null,
  }));
  const deps: UnregisterOccupantDeps = {
    nonceStore: freshStore,
    deleteOccupant,
    endVisitorSessions: table.endVisitorSessions,
    endSessionsAbove: table.endSessionsAbove,
    ...options.over,
  };
  return { deps, deleteOccupant, table };
};

const envelope = (id: Identity, over: Record<string, unknown> = {}) =>
  signRequest(id, 'unregisterOccupant', { essid: ESSID, ...over });

describe('handleUnregisterOccupant', () => {
  it("deletes the caller's occupancy row scoped to (essid, server-stamped owner_key)", async () => {
    const id = generateIdentity();
    const { deps, deleteOccupant } = makeDeps(id);

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
    const { deps, deleteOccupant } = makeDeps(id);

    const result = await handleUnregisterOccupant(envelope(id, { owner_key: 'attacker-key' }), deps);

    expect(result.status).toBe(400);
    expect(deleteOccupant).not.toHaveBeenCalled();
  });

  it('rejects a payload that smuggles a client-supplied player_key without deleting', async () => {
    const id = generateIdentity();
    const { deps, deleteOccupant } = makeDeps(id);

    const result = await handleUnregisterOccupant(
      envelope(id, { player_key: 'attacker-key' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(deleteOccupant).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the essid without deleting', async () => {
    const id = generateIdentity();
    const { deps, deleteOccupant } = makeDeps(id);

    const result = await handleUnregisterOccupant(signRequest(id, 'unregisterOccupant', {}), deps);

    expect(result.status).toBe(400);
    expect(deleteOccupant).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope (payload changed after signing) without deleting', async () => {
    const id = generateIdentity();
    const { deps, deleteOccupant } = makeDeps(id);
    const signed = envelope(id);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleUnregisterOccupant(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(deleteOccupant).not.toHaveBeenCalled();
  });

  it('reports a server error when the delete fails', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps(id, {
      over: { deleteOccupant: vi.fn(async () => ({ data: null, error: new Error('db down') })) },
    });

    const result = await handleUnregisterOccupant(envelope(id), deps);

    expect(result).toEqual({ status: 500, body: { error: 'occupant_delete_failed' } });
  });
});

/**
 * A box that leaves the network drops every connection to it. A session row that
 * outlived the box's place on the WiFi kept placing its holder on that network, at no
 * address: every door they knocked on from it recorded `unknown`.
 */
describe('the connections to a box that leaves the network', () => {
  it("closes a visitor's session on the box, recorded as the box leaving", async () => {
    const owner = generateIdentity();
    const { deps, table } = makeDeps(owner, {
      sessions: [sessionRow({ session_id: 'visitor-shell', machine_id: boxOf(owner) })],
    });

    const result = await handleUnregisterOccupant(envelope(owner), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(table.reasonOf('visitor-shell')).toBe('network_left');
  });

  it('closes every visitor on the box, whoever they are', async () => {
    const owner = generateIdentity();
    const { deps, table } = makeDeps(owner, {
      sessions: [
        sessionRow({ session_id: 'bob-shell', player_key: 'bob-key', machine_id: boxOf(owner) }),
        sessionRow({
          session_id: 'eve-ftp',
          player_key: 'eve-key',
          machine_id: boxOf(owner),
          kind: 'ftp',
        }),
      ],
    });

    await handleUnregisterOccupant(envelope(owner), deps);

    expect(table.reasonOf('bob-shell')).toBe('network_left');
    expect(table.reasonOf('eve-ftp')).toBe('network_left');
  });

  // A hop made from the box stood on its connection, so it goes down with it, however
  // far up the chain it reaches.
  it('closes the sessions a visitor opened from the box, all the way up their chain', async () => {
    const owner = generateIdentity();
    const { deps, table } = makeDeps(owner, {
      sessions: [
        sessionRow({ session_id: 'visitor-shell', machine_id: boxOf(owner) }),
        sessionRow({
          session_id: 'hop-from-the-box',
          machine_id: 'web-01-cafef00d',
          parent_session_id: 'visitor-shell',
        }),
        sessionRow({
          session_id: 'hop-above-that',
          machine_id: 'db-07-cafef00d',
          parent_session_id: 'hop-from-the-box',
        }),
      ],
    });

    await handleUnregisterOccupant(envelope(owner), deps);

    expect(table.reasonOf('hop-from-the-box')).toBe('upstream_lost');
    expect(table.reasonOf('hop-above-that')).toBe('upstream_lost');
  });

  it('leaves a session on any other box open', async () => {
    const owner = generateIdentity();
    const { deps, table } = makeDeps(owner, {
      sessions: [
        sessionRow({ session_id: 'visitor-shell', machine_id: boxOf(owner) }),
        sessionRow({ session_id: 'elsewhere', machine_id: 'web-01-cafef00d' }),
      ],
    });

    await handleUnregisterOccupant(envelope(owner), deps);

    expect(table.reasonOf('elsewhere')).toBeUndefined();
  });

  // Taking the box off the WiFi is not logging out of it: the owner's own root shell
  // on their own machine opened no connection across the network.
  it("leaves the owner's own sessions on their box open", async () => {
    const owner = generateIdentity();
    const { deps, table } = makeDeps(owner, {
      sessions: [
        sessionRow({
          session_id: 'own-su',
          player_key: owner.publicKeyHex,
          machine_id: boxOf(owner),
          kind: 'su',
        }),
        sessionRow({ session_id: 'visitor-shell', machine_id: boxOf(owner) }),
      ],
    });

    await handleUnregisterOccupant(envelope(owner), deps);

    expect(table.reasonOf('own-su')).toBeUndefined();
    expect(table.reasonOf('visitor-shell')).toBe('network_left');
  });

  // A repeat disconnect finds no box on the network, so there is no machine whose
  // connections could be named.
  it('closes nothing when the box had already left', async () => {
    const owner = generateIdentity();
    const { deps, table } = makeDeps(owner, {
      onNetwork: false,
      sessions: [sessionRow({ session_id: 'visitor-shell', machine_id: boxOf(owner) })],
    });

    const result = await handleUnregisterOccupant(envelope(owner), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(table.reasonOf('visitor-shell')).toBeUndefined();
  });

  it('closes nothing when the box could not be taken off the network', async () => {
    const owner = generateIdentity();
    const { deps, table } = makeDeps(owner, {
      sessions: [sessionRow({ session_id: 'visitor-shell', machine_id: boxOf(owner) })],
      over: { deleteOccupant: vi.fn(async () => ({ data: null, error: new Error('db down') })) },
    });

    await handleUnregisterOccupant(envelope(owner), deps);

    expect(table.reasonOf('visitor-shell')).toBeUndefined();
  });

  // Loud, because a disconnect that left a visitor's row open is the defect itself: the
  // owner believes they are clear and the visitor still stands on their network.
  it('reports a server error when the sessions could not be closed', async () => {
    const owner = generateIdentity();
    const { deps } = makeDeps(owner, {
      over: { endVisitorSessions: async () => ({ data: null, error: new Error('db down') }) },
    });

    const result = await handleUnregisterOccupant(envelope(owner), deps);

    expect(result).toEqual({ status: 500, body: { error: 'sessions_end_failed' } });
  });

  it('walks no chain when the box had no visitor to close', async () => {
    const owner = generateIdentity();
    const endSessionsAbove = vi.fn<UnregisterOccupantDeps['endSessionsAbove']>(async () => ({
      data: [],
      error: null,
    }));
    const { deps } = makeDeps(owner, {
      over: { endVisitorSessions: async () => ({ data: null, error: null }), endSessionsAbove },
    });

    const result = await handleUnregisterOccupant(envelope(owner), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(endSessionsAbove).not.toHaveBeenCalled();
  });

  it('reports a server error when a chain above the box could not be closed', async () => {
    const owner = generateIdentity();
    const { deps } = makeDeps(owner, {
      sessions: [sessionRow({ session_id: 'visitor-shell', machine_id: boxOf(owner) })],
      over: { endSessionsAbove: async () => ({ data: null, error: new Error('db down') }) },
    });

    const result = await handleUnregisterOccupant(envelope(owner), deps);

    expect(result).toEqual({ status: 500, body: { error: 'sessions_end_failed' } });
  });
});
