import { describe, expect, it, vi } from 'vitest';
import { handleRecordFtpTransfer, type RecordFtpTransferDeps } from './recordFtpTransfer.js';
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
import {
  VSFTPD_LOG_OWNER,
  VSFTPD_LOG_PATH,
  VSFTPD_LOG_PERMISSIONS,
} from '../logging/vsftpdLog.js';
import { derivePid } from '../logging/syslog.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { logRead } from '../../test/factories/logRows.js';

/**
 * The download half of what makes ftp the LOUD door: a file that leaves a box is
 * itemised in that box's own `/var/log/vsftpd.log`, by path and byte count.
 *
 * The client says WHAT it took. It does not get to say who it is or when: the
 * account comes off the session row the server looked up, and the clock is the
 * server's — the same posture `appendAuthLog` takes, and for the same reason.
 * A defender's log that a visitor can author is not evidence.
 */

const freshStore: NonceStore = async () => ({ fresh: true });

// A fixed server clock: 2026-08-14 13:56:02 UTC, a Friday.
const STAMP = Date.UTC(2026, 7, 14, 13, 56, 2);

const THEIR_BOX = 'nas-04-c0ffee';

const activeSession = (over: Partial<ActiveSession> = {}): ActiveSession => ({
  username: 'guest',
  userType: 'guest',
  essid: 'BEAN-THERE-WIFI',
  ...over,
});

/** The box a transfer lands on when the target is another PLAYER's machine rather
 *  than a generated host — the occupancy row that names its owner. */
const THEIR_OWNER_KEY = 'd'.repeat(64);
const theirWorkstation = {
  owner_key: THEIR_OWNER_KEY,
  workstation_username: 'morpheus',
  workstation_root_hash: md5('toor'),
};
// Where the server places the actor. By default they are at home on their OWN network —
// a different ESSID from the box's — so a reach to the box crosses a NAT and is seen at
// the home network's PUBLIC address. A neighbour on the box's own LAN is named by the
// lease they hold there instead.
const ACTOR_HOME_ESSID = 'SKYLAB-HOUSE';
const ACTOR_HOME_OCTET = 42;
const ACTOR_HOME_IP = '198.51.100.22';
const PIVOT_ESSID = 'CAFE-DEL-MAR-GUEST';
const PIVOT_PUBLIC_IP = '203.0.113.199';
const PIVOT_MACHINE = 'workstation-p1v0t000';

const makeDeps = (over: Partial<RecordFtpTransferDeps> = {}) => {
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
  // own record, exactly as it was before players could be reached.
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
  const deps: RecordFtpTransferDeps = {
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

const transfer = {
  direction: 'download',
  machine_id: THEIR_BOX,
  path: '/etc/passwd',
  bytes: 1243,
  source_ip: '10.0.0.9',
};

describe('handleRecordFtpTransfer', () => {
  it('itemises the transfer in the target box own vsftpd.log', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpTransfer', transfer);
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordFtpTransfer(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0]).toEqual({
      // The network's own key, off the session row: nobody owns a generated box, and
      // every visitor to its network reaches the identical one.
      writer_key: apGatewayLogWriterKey(activeSession().essid),
      machine_id: THEIR_BOX,
      path: VSFTPD_LOG_PATH,
      content: `Fri Aug 14 13:56:02 2026 [pid ${derivePid(STAMP)}] [guest] OK DOWNLOAD: Client "198.51.100.22", "/etc/passwd", 1243 bytes\n`,
      owner: VSFTPD_LOG_OWNER,
      permissions: VSFTPD_LOG_PERMISSIONS,
      node_type: 'file',
    });
  });

  it('itemises a file that ARRIVED on the box, in the same log the downloads land in', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpTransfer', {
      ...transfer,
      direction: 'upload',
      path: '/home/guest/backdoor.sh',
      bytes: 512,
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordFtpTransfer(envelope, deps);

    // The direction a defender most needs: something was LEFT on their machine.
    // One log, one shape, both halves of a visit.
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `Fri Aug 14 13:56:02 2026 [pid ${derivePid(STAMP)}] [guest] OK UPLOAD: Client "198.51.100.22", "/home/guest/backdoor.sh", 512 bytes\n`,
    );
  });

  it('refuses a direction the daemon has no verb for, rather than inventing one', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpTransfer', { ...transfer, direction: 'sideways' });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordFtpTransfer(envelope, deps);

    // Unchecked, a caller writes their own verb into someone else's evidence —
    // `OK SIDEWAYS`, or worse, a line that reads as something the daemon says.
    expect(result).toEqual({ status: 400, body: { error: expect.any(String) } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('names the account the SESSION carries, not the one the caller claims', async () => {
    const id = generateIdentity();
    // A visitor who logged in as `guest` signs a line claiming to be root — the
    // account is the server's to know, or the log names whoever the thief prefers.
    const envelope = signRequest(id, 'recordFtpTransfer', { ...transfer, user: 'root' });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: async () => ({ data: activeSession({ username: 'guest' }), error: null }),
    });

    await handleRecordFtpTransfer(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0].content).toContain('[guest] OK DOWNLOAD');
    expect(upsertPatch.mock.calls[0]![0].content).not.toContain('[root]');
  });

  it('stamps its own clock, ignoring any time the caller sends', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpTransfer', {
      ...transfer,
      time: Date.UTC(2001, 0, 1),
      pid: 1,
    });
    const { deps, upsertPatch } = makeDeps();

    await handleRecordFtpTransfer(envelope, deps);

    const { content } = upsertPatch.mock.calls[0]![0];
    expect(content).toContain('Fri Aug 14 13:56:02 2026');
    expect(content).toContain(`[pid ${derivePid(STAMP)}]`);
    expect(content).not.toContain('2001');
  });

  it('appends after what the log already holds, so the record accumulates', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpTransfer', transfer);
    const { deps, upsertPatch } = makeDeps({
      readLog: async () => logRead('AN EARLIER LOGIN\n'),
    });

    await handleRecordFtpTransfer(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `AN EARLIER LOGIN\nFri Aug 14 13:56:02 2026 [pid ${derivePid(STAMP)}] [guest] OK DOWNLOAD: Client "198.51.100.22", "/etc/passwd", 1243 bytes\n`,
    );
  });

  it('refuses a caller holding no session on that box, and writes nothing', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpTransfer', transfer);
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: async () => ({ data: null, error: null }),
    });

    const result = await handleRecordFtpTransfer(envelope, deps);

    // Without this, anyone could write lines into any stranger's log — inventing
    // thefts that never happened on a box they never reached.
    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a transfer claimed against the caller own workstation', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpTransfer', {
      ...transfer,
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordFtpTransfer(envelope, deps);

    // The own-box L1 bypass hands back no session row, and this line needs one to
    // name an account. A download from yourself is not a transfer anyone logged.
    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('reports a session lookup failure as a server error rather than a refusal', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpTransfer', transfer);
    const { deps } = makeDeps({
      findActiveSession: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleRecordFtpTransfer(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
  });

  it('names an unknown client rather than a false one when the address cannot be resolved', async () => {
    const id = generateIdentity();
    const { source_ip: _omitted, ...withoutVantage } = transfer;
    const envelope = signRequest(id, 'recordFtpTransfer', withoutVantage);
    // Placed on a network whose public address cannot be read: the transfer still
    // happened, so the line is still written — the client named unknown rather than a
    // guess, and never the address the caller tried to send.
    const { deps, upsertPatch } = makeDeps({
      findPublicIpByEssid: async () => ({ data: null, error: null }),
    });

    await handleRecordFtpTransfer(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0].content).toContain('Client "unknown"');
  });

  it('rejects a caller trying to sign either half of the identity the server stamps', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps();

    // Provenance is the server's: a chosen writer_key files the theft under someone
    // else's name, and a chosen player_key is the same trick one field over.
    const asAnotherWriter = await handleRecordFtpTransfer(
      signRequest(id, 'recordFtpTransfer', { ...transfer, writer_key: 'f'.repeat(64) }),
      deps,
    );
    const asAnotherPlayer = await handleRecordFtpTransfer(
      signRequest(id, 'recordFtpTransfer', { ...transfer, player_key: 'f'.repeat(64) }),
      deps,
    );

    expect(asAnotherWriter).toEqual({ status: 400, body: { error: expect.any(String) } });
    expect(asAnotherPlayer).toEqual({ status: 400, body: { error: expect.any(String) } });
  });

  /**
   * On a generated host the caller's own row IS the record — nobody else writes there,
   * and the address they report is their LAN address, which is what that box saw.
   *
   * Another player's box is the opposite on both counts. Its log is a shared record:
   * a line written under the VISITOR's key lands in a different row from the login that
   * preceded it, and the journal replays with the latest write to a path winning — so
   * the defender reads half a visit, and a second visitor erases the first. And the
   * address is the defender's only evidence, so it comes from the verified key rather
   * than from the visitor.
   */
  describe('a transfer on another player box', () => {
    const onTheirBox = (over: Partial<RecordFtpTransferDeps> = {}) =>
      makeDeps({
        findOccupantWorkstationByMachineId: async () => ({ data: theirWorkstation, error: null }),
        ...over,
      });

    it('files the line under the BOX owner key, so the whole visit stays in one record', async () => {
      const id = generateIdentity();
      const envelope = signRequest(id, 'recordFtpTransfer', transfer);
      const findOccupant = vi.fn<FindOccupantWorkstationByMachineId>(async () => ({
        data: theirWorkstation,
        error: null,
      }));
      const { deps, upsertPatch } = makeDeps({
        findOccupantWorkstationByMachineId: findOccupant,
      });

      await handleRecordFtpTransfer(envelope, deps);

      expect(findOccupant).toHaveBeenCalledWith(THEIR_BOX);
      expect(upsertPatch.mock.calls[0]![0].writer_key).toBe(THEIR_OWNER_KEY);
      expect(upsertPatch.mock.calls[0]![0].writer_key).not.toBe(id.publicKeyHex);
    });

    it('names the address the SERVER resolves for the visitor, not the one they sent', async () => {
      const id = generateIdentity();
      const envelope = signRequest(id, 'recordFtpTransfer', { ...transfer, source_ip: '10.0.0.9' });
      const { deps, upsertPatch, findHomeVantage } = onTheirBox();

      await handleRecordFtpTransfer(envelope, deps);

      expect(findHomeVantage).toHaveBeenCalledWith(id.publicKeyHex);
      expect(upsertPatch.mock.calls[0]![0].content).toContain(`Client "${ACTOR_HOME_IP}"`);
      expect(upsertPatch.mock.calls[0]![0].content).not.toContain('10.0.0.9');
    });

    it('traces a transfer run from a box the visitor is STANDING on to that network', async () => {
      const id = generateIdentity();
      const envelope = signRequest(id, 'recordFtpTransfer', {
        ...transfer,
        caller_machine_id: PIVOT_MACHINE,
      });
      const { deps, upsertPatch, findPublicIpByEssid } = onTheirBox({
        findActiveSession: async ({ machine_id }) => ({
          data:
            machine_id === PIVOT_MACHINE
              ? activeSession({ essid: PIVOT_ESSID })
              : activeSession(),
          error: null,
        }),
      });

      await handleRecordFtpTransfer(envelope, deps);

      // The pivot is the only honest answer: the visitor's own address never touched
      // the target, and the box they launched from is what it actually saw.
      expect(findPublicIpByEssid).toHaveBeenCalledWith(PIVOT_ESSID);
      expect(upsertPatch.mock.calls[0]![0].content).toContain(`Client "${PIVOT_PUBLIC_IP}"`);
    });

    it('uses the address the visitor OWNS when the box they name is their own workstation', async () => {
      const id = generateIdentity();
      const envelope = signRequest(id, 'recordFtpTransfer', {
        ...transfer,
        caller_machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      });
      const { deps, upsertPatch, findPublicIpByEssid } = onTheirBox();

      await handleRecordFtpTransfer(envelope, deps);

      // Reaching out from home is the ordinary case, and it holds no session row — the
      // own-box L1 bypass hands one back as null, placing the caller on their own home
      // network. The target is elsewhere, so it saw that network's public address.
      expect(findPublicIpByEssid).toHaveBeenCalledWith(ACTOR_HOME_ESSID);
      expect(upsertPatch.mock.calls[0]![0].content).toContain(`Client "${ACTOR_HOME_IP}"`);
    });

    it('refuses a visitor claiming to stand on a box they hold no session on, and writes nothing', async () => {
      const id = generateIdentity();
      const envelope = signRequest(id, 'recordFtpTransfer', {
        ...transfer,
        caller_machine_id: 'workstation-not-theirs',
      });
      const { deps, upsertPatch } = onTheirBox({
        findActiveSession: async ({ machine_id }) => ({
          data: machine_id === THEIR_BOX ? activeSession() : null,
          error: null,
        }),
      });

      const result = await handleRecordFtpTransfer(envelope, deps);

      expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('writes nothing when it cannot tell whose box this is, rather than guessing a row', async () => {
      const id = generateIdentity();
      const envelope = signRequest(id, 'recordFtpTransfer', transfer);
      const { deps, upsertPatch } = makeDeps({
        findOccupantWorkstationByMachineId: async () => ({ data: null, error: new Error('db down') }),
      });

      const result = await handleRecordFtpTransfer(envelope, deps);

      // Guessing means the caller's key, which on a foreign box splits the defender's
      // log across two rows — worse than the line never arriving.
      expect(result).toEqual({ status: 500, body: { error: 'occupant_lookup_failed' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });
  });

  it('rejects a byte count that is not a number, rather than logging a nonsense size', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpTransfer', { ...transfer, bytes: 'lots' });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordFtpTransfer(envelope, deps);

    // Unvalidated, this renders `NaN bytes` into a stranger's evidence.
    expect(result).toEqual({ status: 400, body: { error: expect.any(String) } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});
