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
import type { FindOccupantWorkstationByMachineId } from '../patches/remoteWritePermission';
import type {
  MachineLogReadQuery,
  MachineLogReadResult,
} from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import { KERN_LOG_PATH, KERN_LOG_PERMISSIONS } from '../logging/kernLog';
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

/** A clock the rendered line can be read against: `Sep 18 12:03:44` UTC. */
const REBOOT_AT = Date.UTC(2026, 8, 18, 12, 3, 44);
/** The address the actor's own home network answers to — what a defender reads. */
const ACTOR_IP = '203.0.113.77';

/** Whose box this is. The occupancy row is the only thing that tells a player's
 *  machine apart from one nobody owns. */
const ownedBy =
  (ownerKey: string): FindOccupantWorkstationByMachineId =>
  async () => ({
    data: {
      owner_key: ownerKey,
      workstation_username: 'kai',
      workstation_root_hash: 'a1b2c3',
    },
    error: null,
  });

const ownedByNobody: FindOccupantWorkstationByMachineId = async () => ({
  data: null,
  error: null,
});

const makeDeps = (over: Partial<RebootMachineDeps> = {}) => {
  const endMachineSessions = vi.fn<
    (params: EndMachineSessionsParams) => Promise<{ error: unknown }>
  >(over.endMachineSessions ?? (async () => ({ error: null })));
  const writeBootId = vi.fn<(params: WriteBootIdParams) => Promise<{ error: unknown }>>(
    over.writeBootId ?? (async () => ({ error: null })),
  );
  const findActiveSession = vi.fn<FindActiveSession>(over.findActiveSession ?? holdingNothing);
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(
    over.upsertPatch ?? (async () => ({ error: null })),
  );
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    over.readLog ?? (async () => ({ data: null, error: null })),
  );
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
    // The trace half: whose row the line is filed under, which address it names,
    // and the clock it is stamped with — all server-side, none of it the caller's
    // to report.
    now: over.now ?? (() => REBOOT_AT),
    findOccupantWorkstationByMachineId:
      over.findOccupantWorkstationByMachineId ?? ownedByNobody,
    findHomeNetworkByOwnerKey:
      over.findHomeNetworkByOwnerKey ?? (async () => ({ data: { public_ip: ACTOR_IP }, error: null })),
    listLeasesByEssid: over.listLeasesByEssid ?? (async () => ({ data: [], error: null })),
    readLog,
    upsertPatch,
  };
  return { deps, endMachineSessions, writeBootId, findActiveSession, upsertPatch, readLog };
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

/**
 * A reboot is the one act in this game that throws another player out, and until
 * now it left the defender nothing to come back to: their box was up, their
 * intruder was gone, and there was no record that either had happened.
 *
 * `kern.log` is where it lands, because a reboot is a kernel event and that file
 * already exists on every box — root-owned, world-readable, and already the home
 * of the netfilter scan trace. There is no carve-out for rebooting your OWN box:
 * an exception is one more rule to remember, and it would tell an attacker exactly
 * which act is invisible.
 *
 * The line names the actor's address, derived server-side from the verified key.
 * A defender's log that a visitor can author is not evidence.
 */
describe('the line a reboot leaves behind', () => {
  it('records the reboot on the box that went down, naming where it came from', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: FOREIGN_BOX });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: holding('root'),
      findOccupantWorkstationByMachineId: ownedBy('0a0a0a0a'),
    });

    const result = await handleRebootMachine(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    // One line, in the box's own kernel log, in the shape the rest of that file
    // is written in — a defender reads this with `cat`, so it has to read like
    // the entries already above it.
    expect(upsertPatch).toHaveBeenCalledWith({
      writer_key: '0a0a0a0a',
      machine_id: FOREIGN_BOX,
      path: KERN_LOG_PATH,
      content:
        'Sep 18 12:03:44 victim kernel: [reboot] System restart requested from 203.0.113.77 — all sessions terminated\n',
      owner: 'root',
      permissions: KERN_LOG_PERMISSIONS,
      node_type: 'file',
    });
  });

  it("files a second attacker's line under the same key, so it joins the first", async () => {
    const first = generateIdentity();
    const second = generateIdentity();
    const owned = ownedBy('0a0a0a0a');
    const existing =
      'Sep 18 11:00:00 victim kernel: [reboot] System restart requested from 198.51.100.4 — all sessions terminated\n';
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: holding('root'),
      findOccupantWorkstationByMachineId: owned,
      readLog: async () => ({ data: { content: existing }, error: null }),
    });

    await handleRebootMachine(
      signRequest(first, 'rebootMachine', { machine_id: FOREIGN_BOX }),
      deps,
    );
    await handleRebootMachine(
      signRequest(second, 'rebootMachine', { machine_id: FOREIGN_BOX }),
      deps,
    );

    // Both visits are still readable. The journal keys a file by its writer, so a
    // line filed under each attacker's own key would mean the newer row replacing
    // the older one wholesale — the defender reading half a break-in and never
    // knowing the other half existed.
    const written = upsertPatch.mock.calls.at(-1)?.[0];
    expect(written?.writer_key).toBe('0a0a0a0a');
    expect(written?.content).toBe(
      `${existing}Sep 18 12:03:44 victim kernel: [reboot] System restart requested from 203.0.113.77 — all sessions terminated\n`,
    );
  });

  it('records a reboot the owner ran on their own box', async () => {
    const identity = generateIdentity();
    const ownBox = ownBoxOf(identity);
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: ownBox });
    const { deps, upsertPatch } = makeDeps({
      findOccupantWorkstationByMachineId: ownedBy(identity.publicKeyHex),
    });

    await handleRebootMachine(envelope, deps);

    // Unconditional, exactly as your own `su` shows up in your own `auth.log`.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: identity.publicKeyHex,
        machine_id: ownBox,
        path: KERN_LOG_PATH,
        content:
          'Sep 18 12:03:44 skylab kernel: [reboot] System restart requested from 203.0.113.77 — all sessions terminated\n',
      }),
    );
  });

  it("files an access point's line under the network's key rather than the rebooter's", async () => {
    const identity = generateIdentity();
    const gateway = computeApGatewayId('HOME-9F2A');
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: gateway });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: holding('root'),
      findOccupantWorkstationByMachineId: ownedByNobody,
      listLeasesByEssid: async () => ({
        data: [
          { owner_key: 'high-octet', octet: 9 },
          { owner_key: 'low-octet', octet: 4 },
        ],
        error: null,
      }),
    });

    await handleRebootMachine(envelope, deps);

    // Nobody owns an access point, so its log needs a key that does not move when
    // players join and leave: the lowest address ever leased on the network. Under
    // the rebooter's own key instead, two attackers would erase each other here.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ writer_key: 'low-octet', machine_id: gateway }),
    );
  });

  it('names the address the server derived, not one the caller reported', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', {
      machine_id: FOREIGN_BOX,
      source_ip: '198.51.100.250',
    });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: holding('root'),
      findOccupantWorkstationByMachineId: ownedBy('0a0a0a0a'),
    });

    await handleRebootMachine(envelope, deps);

    const written = upsertPatch.mock.calls.at(-1)?.[0];
    expect(written?.content).toContain(ACTOR_IP);
    expect(written?.content).not.toContain('198.51.100.250');
  });

  it('says unknown rather than guessing when the actor is on no network', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: FOREIGN_BOX });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: holding('root'),
      findOccupantWorkstationByMachineId: ownedBy('0a0a0a0a'),
      findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
    });

    await handleRebootMachine(envelope, deps);

    // A false origin in a defender's log is worse than no origin.
    const written = upsertPatch.mock.calls.at(-1)?.[0];
    expect(written?.content).toContain('requested from unknown');
  });

  it("falls back to the rebooter's own key when the network's leases cannot be read", async () => {
    const identity = generateIdentity();
    const gateway = computeApGatewayId('HOME-9F2A');
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: gateway });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: holding('root'),
      findOccupantWorkstationByMachineId: ownedByNobody,
      listLeasesByEssid: async () => ({ data: null, error: 'down' }),
    });

    await handleRebootMachine(envelope, deps);

    // A lease read that fails costs the stable key, never the line. One reboot
    // recorded in a row of its own beats a reboot nobody can see was run.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ writer_key: identity.publicKeyHex, machine_id: gateway }),
    );
  });

  it('falls back the same way on a network nobody has ever leased an address on', async () => {
    const identity = generateIdentity();
    const gateway = computeApGatewayId('HOME-9F2A');
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: gateway });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: holding('root'),
      findOccupantWorkstationByMachineId: ownedByNobody,
      listLeasesByEssid: async () => ({ data: null, error: null }),
    });

    await handleRebootMachine(envelope, deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ writer_key: identity.publicKeyHex }),
    );
  });

  it('names a generated host by the only name anybody has for it', async () => {
    const identity = generateIdentity();
    const generated = 'lan-host-10-0-0-77';
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: generated });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: holding('root'),
      findOccupantWorkstationByMachineId: ownedByNobody,
    });

    await handleRebootMachine(envelope, deps);

    // A player's box carries a name in its id and a generated one does not, so
    // the hostname column falls back to the id itself rather than going blank.
    const written = upsertPatch.mock.calls.at(-1)?.[0];
    expect(written?.content).toContain(`${generated} kernel: [reboot]`);
  });

  it('leaves no line behind when the reboot itself was refused', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: FOREIGN_BOX });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: holdingNothing,
      findOccupantWorkstationByMachineId: ownedBy('0a0a0a0a'),
    });

    const result = await handleRebootMachine(envelope, deps);

    // A stranger who cannot reboot a box cannot write in its logs either — a
    // forged entry naming somebody else is its own attack on the defender.
    expect(result.status).toBe(403);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('still reports the eviction when the trace cannot be filed', async () => {
    const identity = generateIdentity();
    const envelope = signRequest(identity, 'rebootMachine', { machine_id: FOREIGN_BOX });
    const { deps, upsertPatch, endMachineSessions } = makeDeps({
      findActiveSession: holding('root'),
      findOccupantWorkstationByMachineId: async () => ({ data: null, error: 'down' }),
    });

    const result = await handleRebootMachine(envelope, deps);

    // The eviction is the command; the line is the record of it. Failing the
    // request over a log would tell the player their reboot did not take when
    // every row on the box has already closed — the one lie this handler must
    // never tell. An unreadable answer writes nothing rather than filing a
    // stranger's evidence under the wrong row.
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(endMachineSessions).toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});
