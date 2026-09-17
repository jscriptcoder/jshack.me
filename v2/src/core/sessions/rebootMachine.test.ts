import { describe, expect, it, vi } from 'vitest';
import {
  handleRebootMachine,
  type EndMachineSessionsParams,
  type RebootMachineDeps,
} from './rebootMachine';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `rebootMachine` is the eviction action: a reboot ends the sessions on the box
 * it ran on in ONE act, named by the MACHINE rather than by a session id — which
 * is the whole difference from `endSession`. A player holding several sessions on
 * one box (an ssh hop plus an su elevation, or a second shell opened from another
 * terminal) loses all of them, including the ones no hop chain on any screen is
 * currently showing.
 *
 * That "all of them" claim is proven end-to-end by the wire-check, which reboots
 * a box carrying two of the caller's rows and reads both back closed; here the
 * claim is that the handler asks for the MACHINE's rows and stamps why they went.
 *
 * Scoping to the verified `player_key` is, for now, both the ownership rule and
 * the authorization: a caller can only end their OWN rows, exactly as
 * `handleEndSession` does. Reaching a stranger's row needs a server-derived
 * authority this handler does not yet have.
 */

const freshStore: NonceStore = async () => ({ fresh: true });

const makeDeps = (over: Partial<RebootMachineDeps> = {}) => {
  const endMachineSessions = vi.fn<
    (params: EndMachineSessionsParams) => Promise<{ error: unknown }>
  >(async () => ({ error: null }));
  const deps: RebootMachineDeps = { nonceStore: freshStore, endMachineSessions, ...over };
  return { deps, endMachineSessions };
};

describe('handleRebootMachine', () => {
  it('ends the sessions on the named machine, not one named session', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'rebootMachine', { machine_id: 'boxa-0b0b0b0b' });
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    // Machine-scoped, so a session the caller holds on that box but has no hop
    // chain standing on goes with the rest; player-scoped to the VERIFIED pubkey,
    // so it reaches none of anyone else's.
    expect(endMachineSessions).toHaveBeenCalledWith({
      machine_id: 'boxa-0b0b0b0b',
      player_key: id.publicKeyHex,
      reason: 'rebooted',
    });
  });

  it('records the rows as rebooted even when the client asks for another reason', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'rebootMachine', {
      machine_id: 'boxa-0b0b0b0b',
      reason: 'user_exit',
    });
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    // Why a row closed is the server's fact, not the caller's: a reboot that
    // could be logged as a voluntary exit would erase the only record that the
    // player was thrown off rather than walked away.
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(endMachineSessions).toHaveBeenCalledWith({
      machine_id: 'boxa-0b0b0b0b',
      player_key: id.publicKeyHex,
      reason: 'rebooted',
    });
  });

  it('rejects a client-supplied player_key with 400 and ends nothing', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'rebootMachine', {
      machine_id: 'boxa-0b0b0b0b',
      player_key: 'forged-key',
    });
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(endMachineSessions).not.toHaveBeenCalled();
  });

  it('rejects a payload missing machine_id with 400 and ends nothing', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'rebootMachine', {});
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(endMachineSessions).not.toHaveBeenCalled();
  });

  it('rejects an empty machine_id with 400 and ends nothing', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'rebootMachine', { machine_id: '' });
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    // An empty id names no box. Refusing it is what keeps "which machine" from
    // becoming an open question the update layer answers on its own.
    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(endMachineSessions).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and ends nothing', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'rebootMachine', { machine_id: 'boxa-0b0b0b0b' });
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(endMachineSessions).not.toHaveBeenCalled();
  });

  it('returns 500 when the update fails, so the caller can say the eviction did not take', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'rebootMachine', { machine_id: 'boxa-0b0b0b0b' });
    const { deps } = makeDeps({ endMachineSessions: async () => ({ error: { message: 'db down' } }) });

    const result = await handleRebootMachine(envelope, deps);

    // The one place a swallowed failure costs more than a log line: the defender
    // would be told the box came back up while the intruder is still on it.
    expect(result).toEqual({ status: 500, body: { error: 'update_failed' } });
  });
});
