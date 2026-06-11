import { describe, expect, it, vi } from 'vitest';
import {
  handleAuthCreateSession,
  type AuthCreateSessionDeps,
  type AuthSessionRow,
} from './authCreateSession';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs, WEAK_PASSWORDS } from '../generation/remoteHostFs';
import { hostMachineId } from '../generation/remoteHostId';
import { md5 } from '../generation/md5';
import type { Directory } from '../filesystem/types';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleAuthCreateSession` is the server-side gate for an ssh session on a
 * FOREIGN host: it REGENERATES the target's filesystem from the verified pubkey +
 * essid + ip (v2's pure generation replaces legacy's stored passwd projection),
 * reads its `/etc/passwd`, server-derives the userType (never a client claim), and
 * validates `md5(password)` against the stored hash before persisting the row. The
 * own-workstation gate does NOT apply (the host is foreign by design) — the passwd
 * check IS the gate. Unknown-user and wrong-password collapse to one 401 so the
 * response never reveals which accounts exist.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

const makeDeps = (over: Partial<AuthCreateSessionDeps> = {}) => {
  const insertSession = vi.fn<(row: AuthSessionRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const deps: AuthCreateSessionDeps = { nonceStore: freshStore, insertSession, ...over };
  return { deps, insertSession };
};

/** A real machine host on the signer's deterministic LAN to ssh into. */
const targetHostFor = (pubkey: string): LanHost => {
  const machine = generateHomeLan(pubkey, ESSID).hosts.filter((host) => host.kind === 'machine').at(-1);
  if (machine === undefined) throw new Error('no machine host on LAN');
  return machine;
};

const passwdRows = (fs: Directory): readonly (readonly string[])[] => {
  const etc = fs.entries.get('etc');
  if (etc?.kind !== 'directory') throw new Error('no /etc');
  const passwd = etc.entries.get('passwd');
  if (passwd?.kind !== 'file') throw new Error('no /etc/passwd');
  return passwd.content
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(':'));
};

/** Recover the seeded plaintext password for `username` by matching its stored
 *  md5 against the known weak pool — the same way a future cracker would. */
const passwordFor = (fs: Directory, username: string): string => {
  const row = passwdRows(fs).find((fields) => fields[0] === username);
  if (row === undefined) throw new Error(`no passwd row for ${username}`);
  const plain = WEAK_PASSWORDS.find((candidate) => md5(candidate) === row[1]);
  if (plain === undefined) throw new Error(`could not recover password for ${username}`);
  return plain;
};

/** The seeded non-root, non-guest account on a host. */
const npcUsername = (fs: Directory): string => {
  const row = passwdRows(fs).find((fields) => fields[0] !== 'root' && fields[0] !== 'guest');
  if (row === undefined) throw new Error('no NPC user');
  return row[0]!;
};

const basePayload = (over: Record<string, unknown>) => ({
  session_id: 'ssh-1700000000000',
  essid: ESSID,
  target_ip: '',
  username: 'root',
  password: '',
  parent_session_id: 'su-root-1',
  source_ip: '192.168.1.50',
  ...over,
});

/** A signed, valid authCreateSession envelope for `username` against `host`. */
const validEnvelope = (
  id: ReturnType<typeof generateIdentity>,
  host: LanHost,
  username: string,
  over: Record<string, unknown> = {},
) => {
  const fs = buildRemoteHostFs(id.publicKeyHex, ESSID, host);
  return signRequest(
    id,
    'authCreateSession',
    basePayload({ target_ip: host.ip, username, password: passwordFor(fs, username), ...over }),
  );
};

describe('handleAuthCreateSession', () => {
  it('validates the root password against the regenerated passwd and inserts an ssh session', async () => {
    const id = generateIdentity();
    const host = targetHostFor(id.publicKeyHex);
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, userType: 'root' } });
    expect(insertSession.mock.calls[0]![0]).toEqual({
      session_id: 'ssh-1700000000000',
      // player_key is the VERIFIED pubkey; machine_id is SERVER-derived from the
      // host's coordinates; userType is SERVER-derived from passwd (uid 0 → root).
      player_key: id.publicKeyHex,
      machine_id: hostMachineId(host, ESSID),
      credentials: { username: 'root', userType: 'root' },
      parent_session_id: 'su-root-1',
      source_ip: '192.168.1.50',
      kind: 'ssh',
      // essid is the regeneration key the server needs later (L1/L2); target_ip is
      // NOT stored — it is recoverable from (essid, machine_id) via hostForMachineId.
      essid: ESSID,
    });
  });

  it('server-derives userType "user" for the non-root account', async () => {
    const id = generateIdentity();
    const host = targetHostFor(id.publicKeyHex);
    const username = npcUsername(buildRemoteHostFs(id.publicKeyHex, ESSID, host));
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(validEnvelope(id, host, username), deps);

    expect(result.body).toEqual({ ok: true, userType: 'user' });
    expect(insertSession.mock.calls[0]![0].credentials).toEqual({ username, userType: 'user' });
  });

  it('server-derives userType "guest" for the guest account', async () => {
    const id = generateIdentity();
    const host = targetHostFor(id.publicKeyHex);
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(validEnvelope(id, host, 'guest'), deps);

    expect(result.body).toEqual({ ok: true, userType: 'guest' });
    expect(insertSession.mock.calls[0]![0].credentials.userType).toBe('guest');
  });

  it('rejects a wrong password with 401 invalid_credentials and never inserts', async () => {
    const id = generateIdentity();
    const host = targetHostFor(id.publicKeyHex);
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({ target_ip: host.ip, username: 'root', password: 'not-the-password' }),
    );
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown username with the SAME 401 invalid_credentials (no user enumeration)', async () => {
    const id = generateIdentity();
    const host = targetHostFor(id.publicKeyHex);
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({ target_ip: host.ip, username: 'ghost', password: 'anything' }),
    );
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a target IP that is not a host on the caller’s LAN with 404 host_unreachable', async () => {
    const id = generateIdentity();
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({ target_ip: '10.255.255.254', username: 'root', password: 'x' }),
    );
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('defaults parent_session_id and source_ip to null when omitted', async () => {
    const id = generateIdentity();
    const host = targetHostFor(id.publicKeyHex);
    const fs = buildRemoteHostFs(id.publicKeyHex, ESSID, host);
    const { parent_session_id: _p, source_ip: _s, ...rest } = basePayload({
      target_ip: host.ip,
      username: 'root',
      password: passwordFor(fs, 'root'),
    });
    const { deps, insertSession } = makeDeps();

    await handleAuthCreateSession(signRequest(id, 'authCreateSession', rest), deps);

    const row = insertSession.mock.calls[0]![0];
    expect(row.parent_session_id).toBeNull();
    expect(row.source_ip).toBeNull();
  });

  it('rejects a payload missing a required field with 400 payload_invalid and never inserts', async () => {
    const id = generateIdentity();
    const { target_ip: _omit, ...withoutTarget } = basePayload({ username: 'root', password: 'x' });
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(
      signRequest(id, 'authCreateSession', withoutTarget),
      deps,
    );

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied player_key with 400 payload_invalid and never inserts', async () => {
    const id = generateIdentity();
    const host = targetHostFor(id.publicKeyHex);
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({ target_ip: host.ip, username: 'root', password: 'x', player_key: 'forged' }),
    );
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401 signature_invalid and never inserts', async () => {
    const id = generateIdentity();
    const host = targetHostFor(id.publicKeyHex);
    const envelope = validEnvelope(id, host, 'root');
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession({ ...envelope, payload: `${envelope.payload} ` }, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('returns 500 when the insert fails', async () => {
    const id = generateIdentity();
    const host = targetHostFor(id.publicKeyHex);
    const { deps } = makeDeps({ insertSession: async () => ({ error: { message: 'db down' } }) });

    const result = await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    expect(result).toEqual({ status: 500, body: { error: 'insert_failed' } });
  });
});
