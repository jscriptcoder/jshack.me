import { describe, expect, it, vi } from 'vitest';
import {
  handleAppendAuthLog,
  type AppendAuthLogDeps,
  type AuthLogContentQuery,
} from './appendAuthLog';
import type { PatchRow } from './upsertPatch';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { AUTH_LOG_OWNER, AUTH_LOG_PATH, AUTH_LOG_PERMISSIONS } from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });

// A fixed server clock so the formatted line is deterministic: Jun 7 2026,
// 14:32:01 UTC. The server stamps BOTH the timestamp and the pid from this.
const STAMP = Date.UTC(2026, 5, 7, 14, 32, 1);

const makeDeps = (over: Partial<AppendAuthLogDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readAuthLog = vi.fn<
    (
      query: AuthLogContentQuery,
    ) => Promise<{ data: { content: string | null } | null; error: unknown }>
  >(async () => ({ data: null, error: null }));
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
      readAuthLog: async () => ({ data: { content: 'PRIOR LINE\n' }, error: null }),
    });

    await handleAppendAuthLog(envelope, deps);

    const row = upsertPatch.mock.calls[0]![0];
    expect(row.content).toBe(
      `PRIOR LINE\nJun  7 14:32:01 rig su[${derivePid(STAMP)}]: Successful su for root by neo\n`,
    );
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

  it('reads the current content scoped to the verified writer_key + auth.log path', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendAuthLog', ownEvent(id.publicKeyHex));
    const { deps, readAuthLog } = makeDeps();

    await handleAppendAuthLog(envelope, deps);

    expect(readAuthLog).toHaveBeenCalledWith({
      writer_key: id.publicKeyHex,
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      path: AUTH_LOG_PATH,
    });
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
