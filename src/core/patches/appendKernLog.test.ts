import { describe, expect, it, vi } from 'vitest';
import {
  handleAppendKernLog,
  type AppendKernLogDeps,
} from './appendKernLog.js';
import type { AppendLog } from './appendMachineLog.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { KERN_LOG_OWNER, KERN_LOG_PATH, KERN_LOG_PERMISSIONS } from '../logging/kernLog.js';
import { derivePid } from '../logging/syslog.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

const freshStore: NonceStore = async () => ({ fresh: true });

// A fixed server clock so the formatted line is deterministic: Jun 7 2026,
// 14:32:01 UTC. The server stamps BOTH the timestamp and the pid from this.
const STAMP = Date.UTC(2026, 5, 7, 14, 32, 1);

const makeDeps = (over: Partial<AppendKernLogDeps> = {}) => {
  const appendLog = vi.fn<AppendLog>(async () => ({ error: null }));
  const deps: AppendKernLogDeps = {
    nonceStore: freshStore,
    now: () => STAMP,
    appendLog,
    ...over,
  };
  return { deps, appendLog };
};

// A miss-crash event targeting the signer's OWN workstation: su faulted in libpam.
const ownEvent = (publicKeyHex: string) => ({
  machine_id: computeWorkstationId('skylab', publicKeyHex),
  command: 'su',
  library: 'libpam',
  hostname: 'rig',
});

describe('handleAppendKernLog', () => {
  it('stamps the server UTC time + pid into the segfault line and appends it to kern.log as one line', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', ownEvent(id.publicKeyHex));
    const { deps, appendLog } = makeDeps();

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    // Time + pid come from the server clock (STAMP), NOT any client value; the message
    // names the command and the library it faulted in, with no CVE id.
    expect(appendLog.mock.calls[0]![0].text).toBe(
      `Jun  7 14:32:01 rig kernel: su[${derivePid(STAMP)}]: segfault at 0 ip 0000000000000000 sp 0000000000000000 error 4 in libpam.so\n`,
    );
  });

  it('names whichever command and library the payload carries', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', {
      ...ownEvent(id.publicKeyHex),
      command: 'systemctl',
      library: 'libsystemd',
    });
    const { deps, appendLog } = makeDeps();

    await handleAppendKernLog(envelope, deps);

    expect(appendLog.mock.calls[0]![0].text).toContain(
      'systemctl[',
    );
    expect(appendLog.mock.calls[0]![0].text).toContain('in libsystemd.so');
  });

  it('ignores a client-supplied time/pid — the timestamp is the server clock', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', {
      ...ownEvent(id.publicKeyHex),
      time: Date.UTC(2099, 0, 1, 0, 0, 0),
      pid: 4242,
    });
    const { deps, appendLog } = makeDeps();

    await handleAppendKernLog(envelope, deps);

    const content = appendLog.mock.calls[0]![0].text ?? '';
    expect(content).toContain('Jun  7 14:32:01');
    expect(content).toContain(`su[${derivePid(STAMP)}]`);
    expect(content).not.toContain('2099');
    expect(content).not.toContain('su[4242]');
  });

  it('appends to the caller’s own kern.log as the caller, root-owned with the log’s mode', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', ownEvent(id.publicKeyHex));
    const { deps, appendLog } = makeDeps();

    await handleAppendKernLog(envelope, deps);

    expect(appendLog).toHaveBeenCalledWith({
      writer_key: id.publicKeyHex,
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      path: KERN_LOG_PATH,
      owner: KERN_LOG_OWNER,
      permissions: KERN_LOG_PERMISSIONS,
      text: expect.stringContaining('segfault'),
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
    const { deps, appendLog } = makeDeps();

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied player_key with 400 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', {
      ...ownEvent(id.publicKeyHex),
      player_key: 'forged-key',
    });
    const { deps, appendLog } = makeDeps();

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied writer_key (forged provenance) with 400 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', {
      ...ownEvent(id.publicKeyHex),
      writer_key: 'forged-provenance',
    });
    const { deps, appendLog } = makeDeps();

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('rejects a missing command with 400 payload_invalid', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', {
      machine_id: computeWorkstationId('skylab', id.publicKeyHex),
      library: 'libpam',
      hostname: 'rig',
    });
    const { deps, appendLog } = makeDeps();

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 and never writes', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', ownEvent(id.publicKeyHex));
    const { deps, appendLog } = makeDeps();

    const result = await handleAppendKernLog({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('returns 500 when the append fails, since the player asked for that line', async () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'appendKernLog', ownEvent(id.publicKeyHex));
    const { deps } = makeDeps({ appendLog: async () => ({ error: { message: 'db down' } }) });

    const result = await handleAppendKernLog(envelope, deps);

    expect(result).toEqual({ status: 500, body: { error: 'append_failed' } });
  });
});
