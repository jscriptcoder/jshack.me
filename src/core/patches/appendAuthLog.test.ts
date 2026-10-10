import { describe, expect, it, vi } from 'vitest';
import {
  handleAppendAuthLog,
  type AppendAuthLogDeps,
} from './appendAuthLog.js';
import type { PatchRow } from './upsertPatch.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { AUTH_LOG_OWNER, AUTH_LOG_PATH, AUTH_LOG_PERMISSIONS } from '../logging/authLog.js';
import { derivePid } from '../logging/syslog.js';
import {
  VSFTPD_LOG_OWNER,
  VSFTPD_LOG_PATH,
  VSFTPD_LOG_PERMISSIONS,
} from '../logging/vsftpdLog.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { logRead, logRow } from '../../test/factories/logRows.js';

const freshStore: NonceStore = async () => ({ fresh: true });

// A fixed server clock so the formatted line is deterministic: Jun 7 2026,
// 14:32:01 UTC. The server stamps BOTH the timestamp and the pid from this.
const STAMP = Date.UTC(2026, 5, 7, 14, 32, 1);

const makeDeps = (over: Partial<AppendAuthLogDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readAuthLog = vi.fn<AppendAuthLogDeps['readAuthLog']>(async () => ({
    data: [],
    error: null,
  }));
  const deps: AppendAuthLogDeps = {
    nonceStore: freshStore,
    now: () => STAMP,
    readAuthLog,
    upsertPatch,
    ...over,
  };
  return { deps, upsertPatch, readAuthLog };
};

// A successful-su event targeting the signer's OWN workstation.
const ownEvent = (publicKeyHex: string) => ({
  machine_id: computeWorkstationId('skylab', publicKeyHex),
  target_user: 'root',
  from_user: 'neo',
  outcome: 'success' as const,
  hostname: 'rig',
});

describe('handleAppendAuthLog', () => {
  it('stamps the server UTC time + pid into the line and appends to an empty auth.log', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', ownEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    const row = upsertPatch.mock.calls[0]![0];
    // Time + pid come from the server clock (STAMP), NOT any client value.
    expect(row.content).toBe(
      `Jun  7 14:32:01 rig su[${derivePid(STAMP)}]: Successful su for root by neo\n`,
    );
  });

  it('appends after existing content (preserves the prior log, single trailing newline)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', ownEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps({
      readAuthLog: async () => logRead('PRIOR LINE\n'),
    });

    await handleAppendAuthLog(envelope, deps);

    const row = upsertPatch.mock.calls[0]![0];
    expect(row.content).toBe(
      `PRIOR LINE\nJun  7 14:32:01 rig su[${derivePid(STAMP)}]: Successful su for root by neo\n`,
    );
  });

  it('accepts a su switch carrying its explicit suSwitch discriminant (what the adapter sends)', async () => {
    // The client adapter tags every su switch `kind: 'suSwitch'`; the handler must honour
    // that exact discriminant, not merely tolerate its absence.
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', {
      ...ownEvent(id.publicKeyHex),
      kind: 'suSwitch',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0].content).toContain('Successful su for root by neo');
  });

  it('renders a FAILED line for a failure outcome', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', {
      ...ownEvent(id.publicKeyHex),
      outcome: 'failure',
    });
    const { deps, upsertPatch } = makeDeps();

    await handleAppendAuthLog(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0].content).toContain('FAILED su for root by neo');
  });

  it('ignores a client-supplied time/pid — the timestamp is the server clock', async () => {
    const id = generateIdentity();
    // A malicious client jams a far-future time + a fixed pid into the payload.
    const envelope = signRequest(id, 'appendAuthLog', {
      ...ownEvent(id.publicKeyHex),
      time: Date.UTC(2099, 0, 1, 0, 0, 0),
      pid: 4242,
    });
    const { deps, upsertPatch } = makeDeps();

    await handleAppendAuthLog(envelope, deps);

    const content = upsertPatch.mock.calls[0]![0].content ?? '';
    expect(content).toContain('Jun  7 14:32:01');
    expect(content).toContain(`su[${derivePid(STAMP)}]`);
    expect(content).not.toContain('2099');
    expect(content).not.toContain('su[4242]');
  });

  it('writes the row as root at the canonical auth.log path with log perms and no is_new', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', ownEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps();

    await handleAppendAuthLog(envelope, deps);

    const row = upsertPatch.mock.calls[0]![0];
    expect(row.writer_key).toBe(id.publicKeyHex);
    expect(row.machine_id).toBe(computeWorkstationId('skylab', id.publicKeyHex));
    expect(row.path).toBe(AUTH_LOG_PATH);
    expect(row.owner).toBe(AUTH_LOG_OWNER);
    expect(row.permissions).toEqual(AUTH_LOG_PERMISSIONS);
    expect(row.node_type).toBe('file');
    // A base-FS file overwrite must NOT stamp is_new (it would flip the row to a
    // player-created, deletable node).
    expect(Object.keys(row)).not.toContain('is_new');
  });

  it('reads every writer’s copy of auth.log on the caller’s machine', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', ownEvent(id.publicKeyHex));
    const { deps, readAuthLog } = makeDeps();

    await handleAppendAuthLog(envelope, deps);

    expect(readAuthLog).toHaveBeenCalledWith({
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      path: AUTH_LOG_PATH,
    });
  });

  it('builds on an intruder’s root wipe of auth.log, so the wiped lines stay gone', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', ownEvent(id.publicKeyHex));
    const ownCopy = logRow({ content: 'PRIOR LINE\n' });
    const wipe = logRow({
      content: '',
      updated_at: '2026-06-07T10:00:00.000000+00:00',
      writer_key: 'an-intruder',
    });
    const { deps, upsertPatch } = makeDeps({
      readAuthLog: async () => ({ data: [wipe, ownCopy], error: null }),
    });

    await handleAppendAuthLog(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0].content).not.toContain('PRIOR LINE');
  });

  it('rejects an append to a machine that is not the caller’s workstation with 403 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', {
      machine_id: computeWorkstationId('victim', 'b'.repeat(64)),
      target_user: 'root',
      from_user: 'neo',
      outcome: 'success',
      hostname: 'rig',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied player_key with 400 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', {
      ...ownEvent(id.publicKeyHex),
      player_key: 'forged-key',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied writer_key (forged provenance) with 400 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', {
      ...ownEvent(id.publicKeyHex),
      writer_key: 'forged-provenance',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects an unknown outcome with 400 payload_invalid', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', {
      ...ownEvent(id.publicKeyHex),
      outcome: 'maybe',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and never reads or writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', ownEvent(id.publicKeyHex));
    const { deps, upsertPatch, readAuthLog } = makeDeps();

    const result = await handleAppendAuthLog(
      { ...envelope, payload: `${envelope.payload} ` },
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(readAuthLog).not.toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('returns 500 when the content read fails and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', ownEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps({
      readAuthLog: async () => ({ data: null, error: { message: 'db down' } }),
    });

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'read_failed' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('returns 500 when the upsert fails', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', ownEvent(id.publicKeyHex));
    const { deps } = makeDeps({ upsertPatch: async () => ({ error: { message: 'db down' } }) });

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'upsert_failed' } });
  });
});

// A `--local` shell success opens a session with NO authentication before it. It lands in
// the SAME auth.log as a su switch, through the same appendAuthLog action, disambiguated by
// a `kind` discriminant.
describe('handleAppendAuthLog — a no-auth session line', () => {
  const sessionEvent = (publicKeyHex: string) => ({
    kind: 'sessionOpened' as const,
    machine_id: computeWorkstationId('skylab', publicKeyHex),
    user: 'root',
    hostname: 'rig',
  });

  it('stamps the server time+pid into a login session-opened line for the shell user', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', sessionEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `Jun  7 14:32:01 rig login[${derivePid(STAMP)}]: session opened for user root\n`,
    );
  });

  it('records no password line before the session — the missing auth is the whole tell', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', sessionEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps({
      readAuthLog: async () => logRead('PRIOR\n'),
    });

    await handleAppendAuthLog(envelope, deps);

    const content = upsertPatch.mock.calls[0]![0].content ?? '';
    expect(content).toContain('PRIOR\n');
    expect(content).toContain('session opened for user root');
    expect(content).not.toContain('Accepted password');
  });

  it('writes the session line to the same auth.log row (root, canonical path) as a su switch', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', sessionEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps();

    await handleAppendAuthLog(envelope, deps);

    const row = upsertPatch.mock.calls[0]![0];
    expect(row.path).toBe(AUTH_LOG_PATH);
    expect(row.owner).toBe(AUTH_LOG_OWNER);
    expect(row.permissions).toEqual(AUTH_LOG_PERMISSIONS);
  });

  it('rejects a session-opened append to a machine that is not the caller’s workstation with 403', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', {
      kind: 'sessionOpened',
      machine_id: computeWorkstationId('victim', 'b'.repeat(64)),
      user: 'root',
      hostname: 'rig',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a session-opened event missing its user with 400 payload_invalid', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', {
      kind: 'sessionOpened',
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      hostname: 'rig',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

// A login through a door on the caller's own box: the daemon's own line, from the
// address the box was reached by, stamped by the server's clock as every line is.
describe('handleAppendAuthLog — a login through a door on the own box', () => {
  const doorEvent = (publicKeyHex: string, over: Record<string, unknown> = {}) => ({
    kind: 'doorLogin' as const,
    door: 'ssh',
    machine_id: computeWorkstationId('skylab', publicKeyHex),
    user: 'guest',
    from_ip: '127.0.0.1',
    outcome: 'success',
    hostname: 'rig',
    ...over,
  });

  it('stamps the server time+pid into sshd’s accepted line, from the address the box was reached by', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', doorEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0]).toMatchObject({
      path: AUTH_LOG_PATH,
      content: `Jun  7 14:32:01 rig sshd[${derivePid(STAMP)}]: Accepted password for guest from 127.0.0.1\n`,
      owner: AUTH_LOG_OWNER,
      permissions: AUTH_LOG_PERMISSIONS,
    });
  });

  it('records a refused login as sshd’s failed line, after what the log already held', async () => {
    const id = generateIdentity();
    const envelope = signRequest(
      id,
      'appendAuthLog',
      doorEvent(id.publicKeyHex, { outcome: 'failure', from_ip: '10.4.0.23' }),
    );
    const { deps, upsertPatch } = makeDeps({ readAuthLog: async () => logRead('PRIOR\n') });

    await handleAppendAuthLog(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `PRIOR\nJun  7 14:32:01 rig sshd[${derivePid(STAMP)}]: Failed password for guest from 10.4.0.23\n`,
    );
  });

  it('records an ftp login in vsftpd’s own log, the connection and the login together', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', doorEvent(id.publicKeyHex, { door: 'ftp' }));
    const readAuthLog = vi.fn<AppendAuthLogDeps['readAuthLog']>(async () => logRead('PRIOR\n'));
    const { deps, upsertPatch } = makeDeps({ readAuthLog });

    await handleAppendAuthLog(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0]).toMatchObject({
      path: VSFTPD_LOG_PATH,
      content:
        'PRIOR\n' +
        `Sun Jun  7 14:32:01 2026 [pid ${derivePid(STAMP)}] CONNECT: Client "127.0.0.1"\n` +
        `Sun Jun  7 14:32:01 2026 [pid ${derivePid(STAMP)}] [guest] OK LOGIN: Client "127.0.0.1"\n`,
      owner: VSFTPD_LOG_OWNER,
      permissions: VSFTPD_LOG_PERMISSIONS,
    });
    expect(readAuthLog).toHaveBeenCalledWith(expect.objectContaining({ path: VSFTPD_LOG_PATH }));
  });

  it('records an scp login as sshd’s own line — the daemon cannot know it is a copy', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', doorEvent(id.publicKeyHex, { door: 'scp' }));
    const { deps, upsertPatch } = makeDeps();

    await handleAppendAuthLog(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0]).toMatchObject({
      path: AUTH_LOG_PATH,
      content: `Jun  7 14:32:01 rig sshd[${derivePid(STAMP)}]: Accepted password for guest from 127.0.0.1\n`,
    });
  });

  it('rejects a door login on a machine that is not the caller’s workstation with 403', async () => {
    const id = generateIdentity();
    const envelope = signRequest(
      id,
      'appendAuthLog',
      doorEvent(id.publicKeyHex, { machine_id: computeWorkstationId('victim', 'b'.repeat(64)) }),
    );
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a from address that is not an address with 400 payload_invalid — it would write a line of its own', async () => {
    const id = generateIdentity();
    const envelope = signRequest(
      id,
      'appendAuthLog',
      doorEvent(id.publicKeyHex, { from_ip: '127.0.0.1\nJun  7 00:00:00 rig sshd[1]: forged' }),
    );
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a door the own box has no daemon log for with 400 payload_invalid', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', doorEvent(id.publicKeyHex, { door: 'nc' }));
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendAuthLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

// A file moved over an ftp login to the caller's own box. The client answered that login
// itself, so no session row names the account: the transfer is itemised here, beside the
// login, in the log a stranger's box would keep it in.
describe('handleAppendAuthLog — a file moved over ftp on the own box', () => {
  const transferEvent = (publicKeyHex: string, over: Record<string, unknown> = {}) => ({
    kind: 'ftpTransfer' as const,
    machine_id: computeWorkstationId('skylab', publicKeyHex),
    user: 'guest',
    from_ip: '127.0.0.1',
    direction: 'download',
    path: '/etc/passwd',
    bytes: 1243,
    ...over,
  });

  const append = async (over: Record<string, unknown> = {}, depsOver: Partial<AppendAuthLogDeps> = {}) => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', transferEvent(id.publicKeyHex, over));
    const { deps, upsertPatch } = makeDeps(depsOver);
    const result = await handleAppendAuthLog(envelope, deps);
    return { id, result, upsertPatch };
  };

  it('itemises a file taken off the box in vsftpd’s own log, after the login already there', async () => {
    const { id, result, upsertPatch } = await append({}, { readAuthLog: async () => logRead('PRIOR\n') });

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0]).toEqual({
      writer_key: id.publicKeyHex,
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      path: VSFTPD_LOG_PATH,
      content:
        'PRIOR\n' +
        `Sun Jun  7 14:32:01 2026 [pid ${derivePid(STAMP)}] [guest] OK DOWNLOAD: Client "127.0.0.1", "/etc/passwd", 1243 bytes\n`,
      owner: VSFTPD_LOG_OWNER,
      permissions: VSFTPD_LOG_PERMISSIONS,
      node_type: 'file',
    });
  });

  it('itemises a file left on the box, from the address the login came by', async () => {
    const { upsertPatch } = await append({
      direction: 'upload',
      user: 'root',
      from_ip: '10.4.0.23',
      path: '/tmp/planted.sh',
      bytes: 0,
    });

    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `Sun Jun  7 14:32:01 2026 [pid ${derivePid(STAMP)}] [root] OK UPLOAD: Client "10.4.0.23", "/tmp/planted.sh", 0 bytes\n`,
    );
  });

  it('rejects a transfer on a machine that is not the caller’s workstation with 403', async () => {
    const { result, upsertPatch } = await append({
      machine_id: computeWorkstationId('victim', 'b'.repeat(64)),
    });

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it.each([
    ['a direction the daemon has no verb for', { direction: 'sideways' }],
    ['a from address that is not an address', { from_ip: 'localhost' }],
    // The forged line names a path of its own, so the rule has to hold from the first
    // character: checked only from some later slash, the tail alone would pass.
    [
      'a path that carries a line of its own',
      { path: '/tmp/x", 1 bytes\nSun Jun  7 [root] OK UPLOAD: Client "10.0.0.9", "/etc/shadow' },
    ],
    ['a path that is not absolute', { path: 'tmp/passwd' }],
    ['a byte count that is not a whole number', { bytes: 12.5 }],
    ['a negative byte count', { bytes: -1 }],
    ['no account', { user: '' }],
    ['a writer the caller chose', { writer_key: 'f'.repeat(64) }],
  ])('rejects %s with 400 payload_invalid and writes nothing', async (_what, over) => {
    const { result, upsertPatch } = await append(over);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});
