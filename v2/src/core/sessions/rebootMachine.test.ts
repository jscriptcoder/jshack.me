import { describe, expect, it, vi } from 'vitest';
import {
  handleRebootMachine,
  type EndMachineSessionsParams,
  type RebootMachineDeps,
  type WriteBootIdParams,
} from './rebootMachine';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { computeApGatewayId } from '../identity/router';
import type { ActiveSession, FindActiveSession } from '../patches/authorizeMachineAccess';
import type { Identity } from '../commands/types';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { UserType } from '../types';

/**
 * `rebootMachine` is the eviction action: a reboot ends the sessions on the box
 * it ran on in ONE act, named by the MACHINE rather than by a session id — which
 * is the whole difference from `endSession`. A player holding several sessions on
 * one box (an ssh hop plus an su elevation, or a second shell opened from another
 * terminal) loses all of them, including the ones no hop chain on any screen is
 * currently showing.
 *
 * It now ends EVERYBODY's rows on that box, not just the caller's — which is what
 * makes it the defender's one eviction lever. Because scoping to the caller is no
 * longer doing the authorizing, the authority is a separate, server-derived
 * question: the caller owns the box, or holds a live root session on it. Nothing
 * here is ever a client claim.
 *
 * The handler-level claim is that it asks for the MACHINE's rows without naming a
 * player, and refuses a caller who can show neither authority. That a stranger's
 * row really does close is proven end-to-end by the two-identity wire-check, which
 * is the only place two real players exist at once.
 */

const freshStore: NonceStore = async () => ({ fresh: true });

/** The player's own box, by the same suffix derivation the server matches on. */
const ownBoxOf = (identity: Identity): string =>
  computeWorkstationId('skylab', identity.publicKeyHex);

/** Somebody else's workstation: a well-formed id whose suffix belongs to no
 *  identity this test generates. */
const FOREIGN_BOX = 'victim-0b0b0b0b';

const sessionAt = (userType: UserType): ActiveSession => ({
  username: userType === 'root' ? 'root' : 'kai',
  userType,
  essid: 'HOME-9F2A',
});

const holding = (userType: UserType): FindActiveSession => {
  const session = sessionAt(userType);
  return async () => ({ data: session, error: null });
};

const holdingNothing: FindActiveSession = async () => ({ data: null, error: null });

const makeDeps = (over: Partial<RebootMachineDeps> = {}) => {
  const endMachineSessions = vi.fn<
    (params: EndMachineSessionsParams) => Promise<{ error: unknown }>
  >(over.endMachineSessions ?? (async () => ({ error: null })));
  const writeBootId = vi.fn<(params: WriteBootIdParams) => Promise<{ error: unknown }>>(
    over.writeBootId ?? (async () => ({ error: null })),
  );
  const findActiveSession = vi.fn<FindActiveSession>(over.findActiveSession ?? holdingNothing);
  const deps: RebootMachineDeps = {
    nonceStore: over.nonceStore ?? freshStore,
    // Minting is injected so a test can name the value the box ends up carrying.
    // In production it is a random id nobody can predict, which is the point: a
    // client that could guess the next one could claim to be standing on a box it
    // had already been thrown off.
    newBootId: over.newBootId ?? (() => 'boot-fixed'),
    findActiveSession,
    endMachineSessions,
    writeBootId,
  };
  return { deps, endMachineSessions, writeBootId, findActiveSession };
};

describe('handleRebootMachine', () => {
  it('ends the sessions on the named machine, not one named session', async () => {
    const identity = generateIdentity();
    const ownBox = ownBoxOf(identity);
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: ownBox });
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    // Machine-scoped and nothing else: a session the caller holds on that box but
    // has no hop chain standing on goes with the rest, and so does one belonging to
    // a player they have never met. Naming a player here is what used to make this
    // an eviction lever nobody could be evicted by.
    expect(endMachineSessions).toHaveBeenCalledWith({
      machine_id: ownBox,
      reason: 'rebooted',
    });
  });

  it('records the rows as rebooted even when the client asks for another reason', async () => {
    const identity = generateIdentity();
    const ownBox = ownBoxOf(identity);
    const envelope = signRequest(identity, 'rebootMachine', {
      machine_id: ownBox,
      reason: 'user_exit',
    });
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    // Why a row closed is the server's fact, not the caller's: a reboot that
    // could be logged as a voluntary exit would erase the only record that the
    // player was thrown off rather than walked away.
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(endMachineSessions).toHaveBeenCalledWith({
      machine_id: ownBox,
      reason: 'rebooted',
    });
  });

  it('rejects a client-supplied player_key with 400 and ends nothing', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', {
      machine_id: ownBoxOf(identity),
      player_key: 'forged-key',
    });
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(endMachineSessions).not.toHaveBeenCalled();
  });

  it('rejects a payload missing machine_id with 400 and ends nothing', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', {});
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(endMachineSessions).not.toHaveBeenCalled();
  });

  it('rejects an empty machine_id with 400 and ends nothing', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: '' });
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    // An empty id names no box. Refusing it is what keeps "which machine" from
    // becoming an open question the update layer answers on its own.
    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(endMachineSessions).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and ends nothing', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: ownBoxOf(identity) });
    const { deps, endMachineSessions } = makeDeps();

    const result = await handleRebootMachine({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(endMachineSessions).not.toHaveBeenCalled();
  });

  it('returns 500 when the update fails, so the caller can say the eviction did not take', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: ownBoxOf(identity) });
    const { deps } = makeDeps({
      endMachineSessions: async () => ({ error: { message: 'db down' } }),
    });

    const result = await handleRebootMachine(envelope, deps);

    // The one place a swallowed failure costs more than a log line: the defender
    // would be told the box came back up while the intruder is still on it.
    expect(result).toEqual({ status: 500, body: { error: 'update_failed' } });
  });

  /**
   * Closing the rows handles the player who reloads. It does nothing for the one
   * sitting in an open shell, and that player is the entire point of the feature —
   * so the box is left carrying a freshly minted id, which is what their next line
   * compares against and fails to recognise.
   */
  it('leaves a freshly minted boot id on the box, so an open shell finds out', async () => {
    const identity = generateIdentity();
    const ownBox = ownBoxOf(identity);
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: ownBox });
    const { deps, writeBootId } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(writeBootId).toHaveBeenCalledWith({
      machine_id: ownBox,
      player_key: identity.publicKeyHex,
      boot_id: 'boot-fixed',
    });
  });

  // The id is the server's word, exactly as the reason is. A caller that could name
  // it could name the one its own session is already carrying, and reboot a box
  // without the shell standing on it ever noticing.
  it('mints the id itself rather than taking one off the wire', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', {
      machine_id: ownBoxOf(identity),
      boot_id: 'the-one-i-am-already-holding',
    });
    const { deps, writeBootId } = makeDeps();

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(writeBootId).toHaveBeenCalledWith(expect.objectContaining({ boot_id: 'boot-fixed' }));
  });

  // The rows are the authority, so they close first; the marker is only how a
  // terminal finds out. A marker written over rows that failed to close would evict
  // players from a box that still holds their standing write grant.
  it('closes the rows before it touches the box', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: ownBoxOf(identity) });
    const order: string[] = [];
    const { deps } = makeDeps({
      endMachineSessions: async () => {
        order.push('rows');
        return { error: null };
      },
      writeBootId: async () => {
        order.push('marker');
        return { error: null };
      },
    });

    await handleRebootMachine(envelope, deps);

    expect(order).toEqual(['rows', 'marker']);
  });

  it('never touches the box when the rows did not close', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: ownBoxOf(identity) });
    const { deps, writeBootId } = makeDeps({
      endMachineSessions: async () => ({ error: { message: 'db down' } }),
    });

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'update_failed' } });
    expect(writeBootId).not.toHaveBeenCalled();
  });

  // As loud as a failed eviction, and for the same reason. Rows closed with nobody
  // told is a defender watching a convincing animation while an intruder keeps
  // typing — which is the one failure this command exists to prevent.
  it('returns 500 when the marker could not be written', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: ownBoxOf(identity) });
    const { deps } = makeDeps({ writeBootId: async () => ({ error: { message: 'db down' } }) });

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'update_failed' } });
  });
});

/**
 * Who is allowed to take a box down under everyone standing on it. Two authorities,
 * both derived on the server from the verified pubkey: the box is the caller's own,
 * or the caller holds a live session on it at root. Anything else is refused before
 * a single row is touched.
 */
describe('the authority to reboot a box', () => {
  it('ends every row on a box the caller holds root on, rather than only their own', async () => {
    const intruder = generateIdentity();
    const envelope = signRequest(intruder, 'rebootMachine', { machine_id: FOREIGN_BOX });
    const { deps, endMachineSessions, findActiveSession } = makeDeps({
      findActiveSession: holding('root'),
    });

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    // The tier is read off the caller's OWN row on the target, so the question the
    // server answers is "are you root on that box", never "who do you say you are".
    expect(findActiveSession).toHaveBeenCalledWith({
      player_key: intruder.publicKeyHex,
      machine_id: FOREIGN_BOX,
    });
    // No player named: the owner's rows close alongside the intruder's.
    expect(endMachineSessions).toHaveBeenCalledWith({
      machine_id: FOREIGN_BOX,
      reason: 'rebooted',
    });
  });

  it('refuses a caller who holds no session on a box that is not theirs', async () => {
    const stranger = generateIdentity();
    const envelope = signRequest(stranger, 'rebootMachine', { machine_id: FOREIGN_BOX });
    const { deps, endMachineSessions, writeBootId } = makeDeps({
      findActiveSession: holdingNothing,
    });

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    // Refused BEFORE anything moves: a machine id is public enough to guess, so an
    // unauthorized reboot must not reach the rows or leave a marker that would evict
    // everyone standing on the box anyway.
    expect(endMachineSessions).not.toHaveBeenCalled();
    expect(writeBootId).not.toHaveBeenCalled();
  });

  it('refuses a caller standing on the box at a tier below root', async () => {
    const guest = generateIdentity();
    const envelope = signRequest(guest, 'rebootMachine', { machine_id: FOREIGN_BOX });
    const { deps, endMachineSessions, writeBootId } = makeDeps({
      findActiveSession: holding('user'),
    });

    const result = await handleRebootMachine(envelope, deps);

    // Being on the box is not authority over it. In-game the binary gate already
    // says so — /bin/reboot is execute:['root'] — and this is the same rule where a
    // tampered client cannot talk its way past it.
    expect(result).toEqual({ status: 403, body: { error: 'not_root' } });
    expect(endMachineSessions).not.toHaveBeenCalled();
    expect(writeBootId).not.toHaveBeenCalled();
  });

  it('lets the owner reboot their own box without consulting the session table', async () => {
    const owner = generateIdentity();
    const ownBox = ownBoxOf(owner);
    const envelope = signRequest(owner, 'rebootMachine', { machine_id: ownBox });
    const { deps, endMachineSessions, findActiveSession } = makeDeps({
      // Would refuse if it were asked. The owner's base login is not a row, so a box
      // whose owner is sitting at their own prompt has nothing for this to find.
      findActiveSession: holdingNothing,
    });

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(findActiveSession).not.toHaveBeenCalled();
    expect(endMachineSessions).toHaveBeenCalledWith({ machine_id: ownBox, reason: 'rebooted' });
  });

  it('lets a root session reboot an access point gateway, which nobody owns', async () => {
    const intruder = generateIdentity();
    const gateway = computeApGatewayId('HOME-9F2A');
    const envelope = signRequest(intruder, 'rebootMachine', { machine_id: gateway });
    const { deps, endMachineSessions } = makeDeps({ findActiveSession: holding('root') });

    const result = await handleRebootMachine(envelope, deps);

    // A gateway belongs to the access point rather than to any player, so the owner
    // arm simply never matches and the root-session arm carries it — no branch of
    // its own, and no way for an occupant to claim one by being on that WiFi.
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(endMachineSessions).toHaveBeenCalledWith({ machine_id: gateway, reason: 'rebooted' });
  });

  it('answers a session lookup failure with 500 rather than a refusal', async () => {
    const caller = generateIdentity();
    const envelope = signRequest(caller, 'rebootMachine', { machine_id: FOREIGN_BOX });
    const { deps, endMachineSessions } = makeDeps({
      findActiveSession: async () => ({ data: null, error: { message: 'db down' } }),
    });

    const result = await handleRebootMachine(envelope, deps);

    // A false 403 would tell a player holding perfectly good root that they do not,
    // and send them looking for an in-game reason that does not exist.
    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
    expect(endMachineSessions).not.toHaveBeenCalled();
  });
});
