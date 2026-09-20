import { describe, expect, it, vi } from 'vitest';
import {
  handleAppendKernLog,
  type AppendKernLogDeps,
  type KernLogContentQuery,
} from './appendKernLog';
import type { PatchRow } from './upsertPatch';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { KERN_LOG_OWNER, KERN_LOG_PATH, KERN_LOG_PERMISSIONS } from '../logging/kernLog';
import { derivePid } from '../logging/syslog';
import type { NonceStore } from '../signedRequest/nonceStore';

const freshStore: NonceStore = async () => ({ fresh: true });

// A fixed server clock so the formatted line is deterministic: Jun 7 2026,
// 14:32:01 UTC. The server stamps BOTH the timestamp and the pid from this.
const STAMP = Date.UTC(2026, 5, 7, 14, 32, 1);

const makeDeps = (over: Partial<AppendKernLogDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readKernLog = vi.fn<
    (
      query: KernLogContentQuery,
    ) => Promise<{ data: { content: string | null } | null; error: unknown }>
  >(async () => ({ data: null, error: null }));
  const deps: AppendKernLogDeps = {
    nonceStore: freshStore,
    now: () => STAMP,
    readKernLog,
    upsertPatch,
    ...over,
  };
  return { deps, upsertPatch, readKernLog };
};

// A miss-crash event targeting the signer's OWN workstation: su faulted in libpam.
const ownEvent = (publicKeyHex: string) => ({
  machine_id: computeWorkstationId('skylab', publicKeyHex),
  command: 'su',
  library: 'libpam',
  hostname: 'rig',
});

describe('handleAppendKernLog', () => {
  it('stamps the server UTC time + pid into the segfault line and appends to an empty kern.log', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', ownEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    const row = upsertPatch.mock.calls[0]![0];
    // Time + pid come from the server clock (STAMP), NOT any client value; the message
    // names the command and the library it faulted in, with no CVE id.
    expect(row.content).toBe(
      `Jun  7 14:32:01 rig kernel: su[${derivePid(STAMP)}]: segfault at 0 ip 0000000000000000 sp 0000000000000000 error 4 in libpam.so\n`,
    );
  });

  it('appends after existing content (preserves the prior log, single trailing newline)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', ownEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps({
      readKernLog: async () => ({ data: { content: 'PRIOR LINE\n' }, error: null }),
    });

    await handleAppendKernLog(envelope, deps);

    const row = upsertPatch.mock.calls[0]![0];
    expect(row.content).toBe(
      `PRIOR LINE\nJun  7 14:32:01 rig kernel: su[${derivePid(STAMP)}]: segfault at 0 ip 0000000000000000 sp 0000000000000000 error 4 in libpam.so\n`,
    );
  });

  it('names whichever command and library the payload carries', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', {
      ...ownEvent(id.publicKeyHex),
      command: 'systemctl',
      library: 'libsystemd',
    });
    const { deps, upsertPatch } = makeDeps();

    await handleAppendKernLog(envelope, deps);

    expect(upsertPatch.mock.calls[0]![0].content).toContain(
      'systemctl[',
    );
    expect(upsertPatch.mock.calls[0]![0].content).toContain('in libsystemd.so');
  });

  it('ignores a client-supplied time/pid — the timestamp is the server clock', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', {
      ...ownEvent(id.publicKeyHex),
      time: Date.UTC(2099, 0, 1, 0, 0, 0),
      pid: 4242,
    });
    const { deps, upsertPatch } = makeDeps();

    await handleAppendKernLog(envelope, deps);

    const content = upsertPatch.mock.calls[0]![0].content ?? '';
    expect(content).toContain('Jun  7 14:32:01');
    expect(content).toContain(`su[${derivePid(STAMP)}]`);
    expect(content).not.toContain('2099');
    expect(content).not.toContain('su[4242]');
  });

  it('writes the row as root at the canonical kern.log path with log perms and no is_new', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', ownEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps();

    await handleAppendKernLog(envelope, deps);

    const row = upsertPatch.mock.calls[0]![0];
    expect(row.writer_key).toBe(id.publicKeyHex);
    expect(row.machine_id).toBe(computeWorkstationId('skylab', id.publicKeyHex));
    expect(row.path).toBe(KERN_LOG_PATH);
    expect(row.owner).toBe(KERN_LOG_OWNER);
    expect(row.permissions).toEqual(KERN_LOG_PERMISSIONS);
    expect(row.node_type).toBe('file');
    // A base-FS file overwrite must NOT stamp is_new (it would flip the row to a
    // player-created, deletable node).
    expect(Object.keys(row)).not.toContain('is_new');
  });

  it('reads the current content scoped to the verified writer_key + kern.log path', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', ownEvent(id.publicKeyHex));
    const { deps, readKernLog } = makeDeps();

    await handleAppendKernLog(envelope, deps);

    expect(readKernLog).toHaveBeenCalledWith({
      writer_key: id.publicKeyHex,
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      path: KERN_LOG_PATH,
    });
  });

  it('rejects an append to a machine that is not the caller’s workstation with 403 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', {
      machine_id: computeWorkstationId('victim', 'b'.repeat(64)),
      command: 'su',
      library: 'libpam',
      hostname: 'rig',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied player_key with 400 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', {
      ...ownEvent(id.publicKeyHex),
      player_key: 'forged-key',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied writer_key (forged provenance) with 400 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', {
      ...ownEvent(id.publicKeyHex),
      writer_key: 'forged-provenance',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a missing command with 400 payload_invalid', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', {
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      library: 'libpam',
      hostname: 'rig',
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and never reads or writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', ownEvent(id.publicKeyHex));
    const { deps, upsertPatch, readKernLog } = makeDeps();

    const result = await handleAppendKernLog({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(readKernLog).not.toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('returns 500 when the content read fails and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', ownEvent(id.publicKeyHex));
    const { deps, upsertPatch } = makeDeps({
      readKernLog: async () => ({ data: null, error: { message: 'db down' } }),
    });

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'read_failed' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('returns 500 when the upsert fails', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', ownEvent(id.publicKeyHex));
    const { deps } = makeDeps({ upsertPatch: async () => ({ error: { message: 'db down' } }) });

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'upsert_failed' } });
  });
});
