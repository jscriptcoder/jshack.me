import { describe, expect, it, vi } from 'vitest';
import { handlePasswdChange, type PasswdChangeDeps } from './passwdChange.js';
import type { OccupantWorkstation } from './stoodOnBox.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { machineIdForLanHost } from '../generation/lanHostIdentity.js';
import { withAccountHash } from './passwdAccount.js';
import type { OwnerPatchRow } from '../network/materializeMachineFs.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { md5 } from '../generation/md5.js';
import { asAbsPath, asGameTime, type UserType } from '../types.js';
import { createFsView } from '../filesystem/fsView.js';
import { buildOccupantWorkstationFs } from '../patches/remoteWritePermission.js';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatPasswdLine,
} from '../logging/authLog.js';
import { derivePid } from '../logging/syslog.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import type { AppendLog } from '../patches/appendMachineLog.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type { FindActiveSession, StandingSession } from '../patches/authorizeMachineAccess.js';

/**
 * `handlePasswdChange` answers `passwd` on a box that is not the caller's own. The caller
 * already holds a ROOT shell there; the handler finds the box from that shell's session row,
 * reads it as its journal leaves it, rewrites the named account's `/etc/passwd` hash, and
 * stamps a `passwd` trace on the box's auth.log.
 *
 * Authorization is every foreign write's: L1 is the active session on the box, L2 is that
 * session being root (only root may write the root-owned `/etc/passwd`). The `/etc/passwd`
 * row is written under the CALLER's key (provenance), the auth.log line under the key that
 * owns the box's logs.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const MACHINE = 'skylab-deadbeef';
// 2026-06-19 12:00:00 UTC — the server clock the passwd auth.log line is stamped with.
const FIXED_NOW = Date.UTC(2026, 5, 19, 12, 0, 0);
const OWNER = generateIdentity();
const ESSID = 'BEAN-THERE-WIFI';
const SSH_LOGIN_IP = '198.51.100.23';
const OCCUPANT: OccupantWorkstation = {
  owner_key: OWNER.publicKeyHex,
  workstation_machine_id: MACHINE,
  essid: ESSID,
  workstation_username: 'neo',
  workstation_machine_name: 'nebuchadnezzar',
  workstation_root_hash: md5('matrix1999'),
};
// The hash the attacker sets root to — only this md5 crosses the wire, never a plaintext.
const NEW_HASH = md5('lockout');

/** The attacker's root shell on the box — the one `passwd` is typed into. */
const rootShell: FindActiveSession<StandingSession> = async () => ({
  data: { username: 'root', userType: 'root', essid: ESSID, sourceIp: SSH_LOGIN_IP },
  error: null,
});

const standingAs =
  (username: string, userType: UserType): FindActiveSession<StandingSession> =>
  async () => ({
    data: { username, userType, essid: ESSID, sourceIp: SSH_LOGIN_IP },
    error: null,
  });

type LookupResult = { data: OccupantWorkstation | null; error: unknown };
type JournalResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

/** A machine the network itself generates: nobody's workstation. */
const NPC_HOST = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'machine')!;
const NPC_MACHINE = machineIdForLanHost(NPC_HOST, ESSID);

const nobodysWorkstation = async (): Promise<LookupResult> => ({ data: null, error: null });

type Overrides = {
  findActiveSession?: FindActiveSession<StandingSession>;
  findPatches?: () => Promise<JournalResult>;
  now?: () => number;
  upsertPatch?: (row: PatchRow) => Promise<{ error: unknown }>;
  appendLog?: AppendLog;
};

const makeDeps = (
  lookup: () => Promise<LookupResult> = async () => ({ data: OCCUPANT, error: null }),
  over: Overrides = {},
) => {
  const findOccupantWorkstationByMachineId =
    vi.fn<(machineId: string) => Promise<LookupResult>>(lookup);
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(
    over.upsertPatch ?? (async () => ({ error: null })),
  );
  const appendLog = vi.fn<AppendLog>(over.appendLog ?? (async () => ({ error: null })));
  const findActiveSession = vi.fn<FindActiveSession<StandingSession>>(
    over.findActiveSession ?? rootShell,
  );
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<JournalResult>>(
    over.findPatches ?? (async () => ({ data: [], error: null })),
  );
  const deps: PasswdChangeDeps = {
    nonceStore: freshStore,
    findOccupantWorkstationByMachineId,
    findActiveSession,
    findPatches,
    now: over.now ?? (() => FIXED_NOW),
    upsertPatch,
    appendLog,
  };
  return { deps, findOccupantWorkstationByMachineId, upsertPatch, appendLog };
};

const envelope = (id: ReturnType<typeof generateIdentity>, fields: Record<string, unknown>) =>
  signRequest(id, 'passwdChange', {
    machine_id: MACHINE,
    username: 'root',
    new_hash: NEW_HASH,
    ...fields,
  });

/** The passwd auth.log line the server is expected to stamp at `FIXED_NOW`. */
const expectedPasswdLine = (user: string, hostname: string): string =>
  formatPasswdLine({ user, hostname, time: asGameTime(FIXED_NOW), pid: derivePid(FIXED_NOW) });

/** The occupant workstation's tree and its `/etc/passwd` node, for composing what the
 *  rewrite should land. The handler reads the same box the same way. */
const WS_TREE = buildOccupantWorkstationFs(OCCUPANT);
const WS_PASSWD_NODE = createFsView(WS_TREE, { userType: 'root' }).stat(asAbsPath('/etc/passwd'));

describe('handlePasswdChange', () => {
  it("rewrites an account's hash on another player's workstation under the caller's key", async () => {
    const attacker = generateIdentity();
    const { deps, upsertPatch, appendLog } = makeDeps();

    const result = await handlePasswdChange(
      envelope(attacker, { username: 'root', new_hash: NEW_HASH }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    // First the /etc/passwd row: only root's field 2 changes, every other byte preserved,
    // owner + perms carried from the file the box holds, provenance the attacker's key.
    expect(upsertPatch.mock.calls[0]![0]).toEqual({
      writer_key: attacker.publicKeyHex,
      machine_id: MACHINE,
      path: asAbsPath('/etc/passwd'),
      content: withAccountHash(WS_TREE, 'root', NEW_HASH),
      owner: WS_PASSWD_NODE?.kind === 'file' ? WS_PASSWD_NODE.owner : 'root',
      permissions: WS_PASSWD_NODE?.kind === 'file' ? WS_PASSWD_NODE.perms : undefined,
      node_type: 'file',
    });
    // Then the trace, under the OWNER's key (the system owns its logs), never the attacker's.
    expect(appendLog.mock.calls[0]![0]).toEqual({
      writer_key: OCCUPANT.owner_key,
      machine_id: MACHINE,
      path: AUTH_LOG_PATH,
      text: `${expectedPasswdLine('root', OCCUPANT.workstation_machine_name)}\n`,
      owner: AUTH_LOG_OWNER,
      permissions: AUTH_LOG_PERMISSIONS,
    });
    expect(appendLog.mock.calls[0]![0].writer_key).not.toBe(attacker.publicKeyHex);
  });

  it('files a generated machine’s trace under the network’s key, in the box’s own name', async () => {
    // Every generated LAN host has a root account; that is the one we rewrite.
    const account = 'root';
    const { deps, upsertPatch, appendLog } = makeDeps(nobodysWorkstation);

    const result = await handlePasswdChange(
      envelope(generateIdentity(), { machine_id: NPC_MACHINE, username: account, new_hash: NEW_HASH }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0]).toMatchObject({ machine_id: NPC_MACHINE, path: asAbsPath('/etc/passwd') });
    expect(appendLog.mock.calls[0]![0]).toMatchObject({
      writer_key: apGatewayLogWriterKey(ESSID),
      path: AUTH_LOG_PATH,
      text: `${expectedPasswdLine(account, NPC_HOST.hostname)}\n`,
    });
  });

  it('refuses a non-root shell (L2) without reading or writing the box', async () => {
    const { appendLog, deps, upsertPatch, findOccupantWorkstationByMachineId } = makeDeps(undefined, {
      findActiveSession: standingAs('neo', 'user'),
    });

    const result = await handlePasswdChange(
      envelope(generateIdentity(), { username: 'root', new_hash: NEW_HASH }),
      deps,
    );

    expect(result).toEqual({ status: 403, body: { error: 'not_authorized' } });
    expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
    expect(deps.findPatches).not.toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('refuses a caller who holds no session on the box', async () => {
    const { appendLog, deps, upsertPatch, findOccupantWorkstationByMachineId } = makeDeps(undefined, {
      findActiveSession: async () => ({ data: null, error: null }),
    });

    const result = await handlePasswdChange(
      envelope(generateIdentity(), { username: 'root', new_hash: NEW_HASH }),
      deps,
    );

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('reports a server error when the session lookup fails', async () => {
    const { appendLog, deps, upsertPatch } = makeDeps(undefined, {
      findActiveSession: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handlePasswdChange(
      envelope(generateIdentity(), { username: 'root', new_hash: NEW_HASH }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'session_lookup_failed' } });
    expect(upsertPatch).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('reports host_unreachable when the box is on no network', async () => {
    const { appendLog, deps, upsertPatch } = makeDeps(nobodysWorkstation);

    const result = await handlePasswdChange(
      envelope(generateIdentity(), { username: 'root', new_hash: NEW_HASH }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(upsertPatch).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('reports user_not_found when the box has no such account, writing nothing', async () => {
    const { appendLog, deps, upsertPatch } = makeDeps();

    const result = await handlePasswdChange(
      envelope(generateIdentity(), { username: 'ghost', new_hash: NEW_HASH }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'user_not_found' } });
    expect(upsertPatch).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('reports a server error when the journal cannot be read', async () => {
    const { appendLog, deps, upsertPatch } = makeDeps(undefined, {
      findPatches: async () => ({ data: null, error: new Error('db down') }),
    });

    const result = await handlePasswdChange(
      envelope(generateIdentity(), { username: 'root', new_hash: NEW_HASH }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
    expect(upsertPatch).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('reports upsert_failed when the /etc/passwd write errors', async () => {
    const { deps } = makeDeps(undefined, {
      upsertPatch: async () => ({ error: new Error('write boom') }),
    });

    const result = await handlePasswdChange(
      envelope(generateIdentity(), { username: 'root', new_hash: NEW_HASH }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'upsert_failed' } });
  });

  it('still returns ok when the auth.log append throws (best-effort logging)', async () => {
    const { deps } = makeDeps(undefined, {
      appendLog: async () => {
        throw new Error('log write blew up');
      },
    });

    const result = await handlePasswdChange(
      envelope(generateIdentity(), { username: 'root', new_hash: NEW_HASH }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
  });

  it('rejects an envelope that smuggles a client-supplied player_key, writing nothing', async () => {
    const { appendLog, deps, upsertPatch, findOccupantWorkstationByMachineId } = makeDeps();

    const result = await handlePasswdChange(
      envelope(generateIdentity(), { username: 'root', new_hash: NEW_HASH, player_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied writer_key, writing nothing', async () => {
    // writer_key is the row's provenance, which the server stamps from the verified
    // pubkey; a client-claimed one is forged provenance and rejected like player_key.
    const { appendLog, deps, upsertPatch, findOccupantWorkstationByMachineId } = makeDeps();

    const result = await handlePasswdChange(
      envelope(generateIdentity(), { username: 'root', new_hash: NEW_HASH, writer_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findOccupantWorkstationByMachineId).not.toHaveBeenCalled();
    expect(upsertPatch).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without writing', async () => {
    const attacker = generateIdentity();
    const { appendLog, deps, upsertPatch } = makeDeps();
    const signed = envelope(attacker, { username: 'root', new_hash: NEW_HASH });
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handlePasswdChange(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });
});
