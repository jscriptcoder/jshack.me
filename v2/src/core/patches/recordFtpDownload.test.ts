import { describe, expect, it, vi } from 'vitest';
import { handleRecordFtpDownload, type RecordFtpDownloadDeps } from './recordFtpDownload';
import type { PatchRow } from './upsertPatch';
import type { ActiveSession, FindActiveSessionResult } from './authorizeMachineAccess';
import type { MachineLogReadQuery, MachineLogReadResult } from './appendMachineLog';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import {
  VSFTPD_LOG_OWNER,
  VSFTPD_LOG_PATH,
  VSFTPD_LOG_PERMISSIONS,
} from '../logging/vsftpdLog';
import { derivePid } from '../logging/syslog';
import type { NonceStore } from '../signedRequest/nonceStore';

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

const makeDeps = (over: Partial<RecordFtpDownloadDeps> = {}) => {
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
  const deps: RecordFtpDownloadDeps = {
    nonceStore: freshStore,
    now: () => STAMP,
    findActiveSession,
    readLog,
    upsertPatch,
    ...over,
  };
  return { deps, upsertPatch, readLog, findActiveSession };
};

const transfer = {
  machine_id: THEIR_BOX,
  path: '/etc/passwd',
  bytes: 1243,
  source_ip: '10.0.0.9',
};

describe('handleRecordFtpDownload', () => {
  it('itemises the transfer in the target box own vsftpd.log', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpDownload', transfer);
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordFtpDownload(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0]).toEqual({
      writer_key: id.publicKeyHex,
      machine_id: THEIR_BOX,
      path: VSFTPD_LOG_PATH,
      content: `Fri Aug 14 13:56:02 2026 [pid ${derivePid(STAMP)}] [guest] OK DOWNLOAD: Client "10.0.0.9", "/etc/passwd", 1243 bytes\n`,
      owner: VSFTPD_LOG_OWNER,
      permissions: VSFTPD_LOG_PERMISSIONS,
      node_type: 'file',
    });
  });

  it('names the account the SESSION carries, not the one the caller claims', async () => {
    const id = generateIdentity();
    // A visitor who logged in as `guest` signs a line claiming to be root — the
    // account is the server's to know, or the log names whoever the thief prefers.
    const envelope = signRequest(id, 'recordFtpDownload', { ...transfer, user: 'root' });
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: async () => ({ data: activeSession({ username: 'guest' }), error: null }),
    });

    await handleRecordFtpDownload(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0].content).toContain('[guest] OK DOWNLOAD');
    expect(upsertPatch.mock.calls[0]![0].content).not.toContain('[root]');
  });

  it('stamps its own clock, ignoring any time the caller sends', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpDownload', {
      ...transfer,
      time: Date.UTC(2001, 0, 1),
      pid: 1,
    });
    const { deps, upsertPatch } = makeDeps();

    await handleRecordFtpDownload(envelope, deps);

    const { content } = upsertPatch.mock.calls[0]![0];
    expect(content).toContain('Fri Aug 14 13:56:02 2026');
    expect(content).toContain(`[pid ${derivePid(STAMP)}]`);
    expect(content).not.toContain('2001');
  });

  it('appends after what the log already holds, so the record accumulates', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpDownload', transfer);
    const { deps, upsertPatch } = makeDeps({
      readLog: async () => ({ data: { content: 'AN EARLIER LOGIN\n' }, error: null }),
    });

    await handleRecordFtpDownload(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `AN EARLIER LOGIN\nFri Aug 14 13:56:02 2026 [pid ${derivePid(STAMP)}] [guest] OK DOWNLOAD: Client "10.0.0.9", "/etc/passwd", 1243 bytes\n`,
    );
  });

  it('refuses a caller holding no session on that box, and writes nothing', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpDownload', transfer);
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: async () => ({ data: null, error: null }),
    });

    const result = await handleRecordFtpDownload(envelope, deps);

    // Without this, anyone could write lines into any stranger's log — inventing
    // thefts that never happened on a box they never reached.
    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a transfer claimed against the caller own workstation', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpDownload', {
      ...transfer,
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordFtpDownload(envelope, deps);

    // The own-box L1 bypass hands back no session row, and this line needs one to
    // name an account. A download from yourself is not a transfer anyone logged.
    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('reports a session lookup failure as a server error rather than a refusal', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpDownload', transfer);
    const { deps } = makeDeps({
      findActiveSession: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handleRecordFtpDownload(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
  });

  it('names an unknown client when the caller is on no network to report', async () => {
    const id = generateIdentity();
    const { source_ip: _omitted, ...withoutVantage } = transfer;
    const envelope = signRequest(id, 'recordFtpDownload', withoutVantage);
    const { deps, upsertPatch } = makeDeps();

    await handleRecordFtpDownload(envelope, deps);

    // The transfer still happened, so the line is still written — with the client
    // named as unknown rather than left blank, which reads as a corrupt log.
    expect(upsertPatch.mock.calls[0]![0].content).toContain('Client "unknown"');
  });

  it('rejects a caller trying to sign either half of the identity the server stamps', async () => {
    const id = generateIdentity();
    const { deps } = makeDeps();

    // Provenance is the server's: a chosen writer_key files the theft under someone
    // else's name, and a chosen player_key is the same trick one field over.
    const asAnotherWriter = await handleRecordFtpDownload(
      signRequest(id, 'recordFtpDownload', { ...transfer, writer_key: 'f'.repeat(64) }),
      deps,
    );
    const asAnotherPlayer = await handleRecordFtpDownload(
      signRequest(id, 'recordFtpDownload', { ...transfer, player_key: 'f'.repeat(64) }),
      deps,
    );

    expect(asAnotherWriter).toEqual({ status: 400, body: { error: expect.any(String) } });
    expect(asAnotherPlayer).toEqual({ status: 400, body: { error: expect.any(String) } });
  });

  it('rejects a byte count that is not a number, rather than logging a nonsense size', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'recordFtpDownload', { ...transfer, bytes: 'lots' });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordFtpDownload(envelope, deps);

    // Unvalidated, this renders `NaN bytes` into a stranger's evidence.
    expect(result).toEqual({ status: 400, body: { error: expect.any(String) } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});
