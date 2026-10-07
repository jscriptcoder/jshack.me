import { describe, expect, it, vi } from 'vitest';
import {
  handleRecordPackageDowngrade,
  type RecordPackageDowngradeDeps,
} from './recordPackageDowngrade.js';
import type { PatchRow } from './upsertPatch.js';
import type { ActiveSession, FindActiveSessionResult } from './authorizeMachineAccess.js';
import type { MachineLogReadQuery, MachineLogReadResult } from './appendMachineLog.js';
import type { FindOccupantWorkstationByMachineId } from './remoteWritePermission.js';
import type { FindPublicIpByEssid } from '../logging/crossPlayerSourceIp.js';
import type { FindHomeVantage, FindWorkstationLease } from '../sessions/callerVantage.js';
import { md5 } from '../generation/md5.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { DPKG_LOG_OWNER, DPKG_LOG_PATH, DPKG_LOG_PERMISSIONS } from '../logging/dpkgLog.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { logRead } from '../../test/factories/logRows.js';

/**
 * The record a box keeps of being rolled BACKWARDS. Pinning a package to an older
 * release is the one apt verb that makes a box more vulnerable than it was, and on
 * another player's machine it is done by someone who does not own it — so the owner's
 * only way to learn it happened is the line this endpoint writes.
 *
 * The client says only WHICH package moved and between which releases. It does not get
 * to say who it is or when: the address is derived from the verified key on every path
 * that lands in someone else's log, and the clock is the server's. A defender's log a
 * visitor can author is not evidence.
 *
 * Unlike `recordFtpTransfer`, this does NOT refuse a target that is the caller's own
 * workstation. That handler needs a session row to name an ACCOUNT in its line; this
 * line names none, so the own-box L1 bypass costs it nothing — and a downgrade you ran
 * on yourself is a real entry in your own package history.
 */

const freshStore: NonceStore = async () => ({ fresh: true });

// A fixed server clock: 2026-08-14 13:56:02 UTC.
const STAMP = Date.UTC(2026, 7, 14, 13, 56, 2);

const THEIR_BOX = 'nas-04-c0ffee';

const activeSession = (over: Partial<ActiveSession> = {}): ActiveSession => ({
  username: 'guest',
  userType: 'guest',
  essid: 'BEAN-THERE-WIFI',
  ...over,
});

/** The occupancy row naming the owner of a box that belongs to another PLAYER. */
const THEIR_OWNER_KEY = 'd'.repeat(64);
const theirWorkstation = {
  owner_key: THEIR_OWNER_KEY,
  workstation_username: 'morpheus',
  workstation_root_hash: md5('toor'),
};

// Where the server places the actor. By default they are at home on their OWN network —
// a different ESSID from the box's — so a reach to the box crosses a NAT and is seen at
// the home network's PUBLIC address. A box they merely stand on is named by its public
// address too; a neighbour on the box's own LAN, by the lease they hold there.
const ACTOR_HOME_ESSID = 'SKYLAB-HOUSE';
const ACTOR_HOME_OCTET = 42;
const ACTOR_HOME_IP = '198.51.100.22';
const PIVOT_ESSID = 'CAFE-DEL-MAR-GUEST';
const PIVOT_PUBLIC_IP = '203.0.113.199';
const PIVOT_MACHINE = 'workstation-p1v0t000';

const makeDeps = (over: Partial<RecordPackageDowngradeDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(async () => ({
    data: null,
    error: null,
  }));
  const findActiveSession = vi.fn<() => Promise<FindActiveSessionResult>>(async () => ({
    data: activeSession(),
    error: null,
  }));
  // A generated LAN host by default — nobody owns it, so the line stays the caller's
  // own record.
  const findOccupantWorkstationByMachineId = vi.fn<FindOccupantWorkstationByMachineId>(async () => ({
    data: null,
    error: null,
  }));
  const findHomeVantage = vi.fn<FindHomeVantage>(async () => ({
    data: { essid: ACTOR_HOME_ESSID, octet: ACTOR_HOME_OCTET },
    error: null,
  }));
  // A caller standing on another player's box holds no generated placement there, so the
  // vantage falls to this lease — null by default, which lands the cross-network path on
  // the standing network's public address.
  const findWorkstationLease = vi.fn<FindWorkstationLease>(async () => ({
    data: null,
    error: null,
  }));
  const findPublicIpByEssid = vi.fn<FindPublicIpByEssid>(async (essid) => ({
    data: { public_ip: essid === PIVOT_ESSID ? PIVOT_PUBLIC_IP : ACTOR_HOME_IP },
    error: null,
  }));
  const deps: RecordPackageDowngradeDeps = {
    nonceStore: freshStore,
    now: () => STAMP,
    findActiveSession,
    readLog,
    upsertPatch,
    findOccupantWorkstationByMachineId,
    findHomeVantage,
    findWorkstationLease,
    findPublicIpByEssid,
    ...over,
  };
  return {
    deps,
    upsertPatch,
    readLog,
    findActiveSession,
    findOccupantWorkstationByMachineId,
    findHomeVantage,
    findWorkstationLease,
    findPublicIpByEssid,
  };
};

const downgrade = {
  machine_id: THEIR_BOX,
  package_name: 'redis',
  from_version: '7.9.7',
  to_version: '7.2.5',
  source_ip: '10.0.0.9',
};

describe('handleRecordPackageDowngrade', () => {
  it('records the rollback in the target box own dpkg.log', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordPackageDowngrade', downgrade);
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordPackageDowngrade(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    // The whole row is asserted, not just the content: an entry written at the wrong
    // owner or permissions is invisible to the very reader it exists for.
    expect(upsertPatch.mock.calls[0]![0]).toEqual({
      // The network's own key, off the session row: nobody owns a generated box, and
      // every visitor to its network reaches the identical one.
      writer_key: apGatewayLogWriterKey(activeSession().essid),
      machine_id: THEIR_BOX,
      path: DPKG_LOG_PATH,
      content: '2026-08-14 13:56:02 downgrade redis 7.9.7 7.2.5 Client "198.51.100.22"\n',
      owner: DPKG_LOG_OWNER,
      permissions: DPKG_LOG_PERMISSIONS,
      node_type: 'file',
    });
  });

  it('names the release the box left before the one it landed on', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordPackageDowngrade', {
      ...downgrade,
      package_name: 'vsftpd',
      from_version: '3.0.5',
      to_version: '3.0.3',
    });
    const { deps, upsertPatch } = makeDeps();

    await handleRecordPackageDowngrade(envelope, deps);

    // Reversed, the same two numbers describe an upgrade and the record means the
    // opposite of what happened to the box.
    expect(upsertPatch.mock.calls[0]![0].content).toContain('downgrade vsftpd 3.0.5 3.0.3');
  });

  it('stamps its own clock, ignoring any time the caller sends', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordPackageDowngrade', {
      ...downgrade,
      time: Date.UTC(1999, 0, 1),
    });
    const { deps, upsertPatch } = makeDeps();

    await handleRecordPackageDowngrade(envelope, deps);

    // A visitor who picks the timestamp can file their visit outside the window the
    // owner is looking at.
    expect(upsertPatch.mock.calls[0]![0].content).toMatch(/^2026-08-14 13:56:02 /);
  });

  it('appends after what the log already holds, so the history accumulates', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordPackageDowngrade', downgrade);
    const existing = '2026-08-01 09:00:00 downgrade nginx 1.25.3 1.24.0 Client "10.0.0.5"\n';
    const { deps, upsertPatch } = makeDeps({
      readLog: async () => logRead(existing),
    });

    await handleRecordPackageDowngrade(envelope, deps);

    // A package history that only ever holds the newest entry hides every rollback but
    // the last one.
    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `${existing}2026-08-14 13:56:02 downgrade redis 7.9.7 7.2.5 Client "198.51.100.22"\n`,
    );
  });

  it('refuses a caller holding no session on that box, and writes nothing', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordPackageDowngrade', downgrade);
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: async () => ({ data: null, error: null }),
    });

    const result = await handleRecordPackageDowngrade(envelope, deps);

    // Without this, anyone could write rollbacks into any stranger's package history —
    // inventing exposure on a box they never reached.
    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('records a downgrade the caller ran on their OWN workstation', async () => {
    const id = generateIdentity();
    const ownBox = computeWorkstationId('skylab', id.publicKeyHex);
    const envelope = signRequest(id, 'recordPackageDowngrade', {
      ...downgrade,
      machine_id: ownBox,
    });
    const { deps, upsertPatch } = makeDeps({
      findOccupantWorkstationByMachineId: async () => ({
        data: { ...theirWorkstation, owner_key: id.publicKeyHex },
        error: null,
      }),
    });

    const result = await handleRecordPackageDowngrade(envelope, deps);

    // Diverges from recordFtpTransfer, which refuses its own-box target because its
    // line must name an account and the L1 bypass hands back no session. This line
    // names no account, so the bypass costs it nothing — and rolling your own box back
    // is a real entry in its history. The address is the one the caller OWNS.
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0].writer_key).toBe(id.publicKeyHex);
    expect(upsertPatch.mock.calls[0]![0].content).toContain(`Client "${ACTOR_HOME_IP}"`);
  });

  it('keeps the caller own key on their own workstation when they are on no WiFi', async () => {
    const id = generateIdentity();
    const ownBox = computeWorkstationId('skylab', id.publicKeyHex);
    const envelope = signRequest(id, 'recordPackageDowngrade', {
      ...downgrade,
      machine_id: ownBox,
    });
    // No occupancy row, so nothing says whose box it is — but no session either, which
    // only the caller's own workstation is reached by.
    const { deps, upsertPatch } = makeDeps({
      findOccupantWorkstationByMachineId: async () => ({ data: null, error: null }),
    });

    await handleRecordPackageDowngrade(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0].writer_key).toBe(id.publicKeyHex);
  });

  it('rejects a caller trying to sign either half of the identity the server stamps', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps();

    const asAnotherWriter = await handleRecordPackageDowngrade(
      signRequest(id, 'recordPackageDowngrade', { ...downgrade, writer_key: 'f'.repeat(64) }),
      deps,
    );
    const asAnotherPlayer = await handleRecordPackageDowngrade(
      signRequest(id, 'recordPackageDowngrade', { ...downgrade, player_key: 'f'.repeat(64) }),
      deps,
    );

    expect(asAnotherWriter).toEqual({ status: 400, body: { error: expect.any(String) } });
    expect(asAnotherPlayer).toEqual({ status: 400, body: { error: expect.any(String) } });
  });

  it('rejects a blank version rather than writing a line with a hole in it', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordPackageDowngrade', { ...downgrade, to_version: '' });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordPackageDowngrade(envelope, deps);

    // Unvalidated this renders `downgrade redis 7.9.7  Client "..."`, which reads as a
    // corrupt log rather than as the rollback it was.
    expect(result).toEqual({ status: 400, body: { error: expect.any(String) } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('reports a session lookup failure as a server error rather than a refusal', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordPackageDowngrade', downgrade);
    const { deps } = makeDeps({
      findActiveSession: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleRecordPackageDowngrade(envelope, deps);

    // A false 403 would tell an honest caller they are not on a box they are on.
    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
  });

  describe('a downgrade on another player box', () => {
    const onTheirBox = (over: Partial<RecordPackageDowngradeDeps> = {}) =>
      makeDeps({
        findOccupantWorkstationByMachineId: async () => ({ data: theirWorkstation, error: null }),
        ...over,
      });

    it('files the line under the BOX owner key, so the whole visit stays in one record', async () => {
      const id = generateIdentity();
      const envelope = signRequest(id, 'recordPackageDowngrade', downgrade);
      const findOccupant = vi.fn<FindOccupantWorkstationByMachineId>(async () => ({
        data: theirWorkstation,
        error: null,
      }));
      const { deps, upsertPatch } = makeDeps({
        findOccupantWorkstationByMachineId: findOccupant,
      });

      await handleRecordPackageDowngrade(envelope, deps);

      // Under the visitor's own key the line lands in a different row from the login
      // that preceded it, and a second attacker erases the first.
      expect(findOccupant).toHaveBeenCalledWith(THEIR_BOX);
      expect(upsertPatch.mock.calls[0]![0].writer_key).toBe(THEIR_OWNER_KEY);
      expect(upsertPatch.mock.calls[0]![0].writer_key).not.toBe(id.publicKeyHex);
    });

    it('names the address the SERVER resolves for the visitor, not the one they sent', async () => {
      const id = generateIdentity();
      const envelope = signRequest(id, 'recordPackageDowngrade', {
        ...downgrade,
        source_ip: '10.0.0.9',
      });
      const { deps, upsertPatch, findHomeVantage } = onTheirBox();

      await handleRecordPackageDowngrade(envelope, deps);

      // The address is the defender's only route back to who did this, so a claimed
      // one would let the attacker write somebody else's name on it.
      expect(findHomeVantage).toHaveBeenCalledWith(id.publicKeyHex);
      expect(upsertPatch.mock.calls[0]![0].content).toContain(`Client "${ACTOR_HOME_IP}"`);
      expect(upsertPatch.mock.calls[0]![0].content).not.toContain('10.0.0.9');
    });

    it('traces a downgrade run from a box the visitor is STANDING on to that network', async () => {
      const id = generateIdentity();
      const envelope = signRequest(id, 'recordPackageDowngrade', {
        ...downgrade,
        caller_machine_id: PIVOT_MACHINE,
      });
      const { deps, upsertPatch, findPublicIpByEssid } = onTheirBox({
        findActiveSession: async ({ machine_id }) => ({
          data:
            machine_id === PIVOT_MACHINE ? activeSession({ essid: PIVOT_ESSID }) : activeSession(),
          error: null,
        }),
      });

      await handleRecordPackageDowngrade(envelope, deps);

      // The visitor's own address never touched the target; the box they launched from
      // is what it actually saw.
      expect(findPublicIpByEssid).toHaveBeenCalledWith(PIVOT_ESSID);
      expect(upsertPatch.mock.calls[0]![0].content).toContain(`Client "${PIVOT_PUBLIC_IP}"`);
    });

    it('refuses a visitor claiming to stand on a box they hold no session on, and writes nothing', async () => {
      const id = generateIdentity();
      const envelope = signRequest(id, 'recordPackageDowngrade', {
        ...downgrade,
        caller_machine_id: 'workstation-not-theirs',
      });
      const { deps, upsertPatch } = onTheirBox({
        findActiveSession: async ({ machine_id }) => ({
          data: machine_id === THEIR_BOX ? activeSession() : null,
          error: null,
        }),
      });

      const result = await handleRecordPackageDowngrade(envelope, deps);

      expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('writes nothing when it cannot tell whose box this is, rather than guessing a row', async () => {
      const id = generateIdentity();
      const envelope = signRequest(id, 'recordPackageDowngrade', downgrade);
      const { deps, upsertPatch } = makeDeps({
        findOccupantWorkstationByMachineId: async () => ({
          data: null,
          error: new Error('db down'),
        }),
      });

      const result = await handleRecordPackageDowngrade(envelope, deps);

      // Guessing means the caller's key, which on a foreign box splits the owner's
      // history across two rows — worse than the line never arriving.
      expect(result).toEqual({ status: 500, body: { error: 'occupant_lookup_failed' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });
  });
});
