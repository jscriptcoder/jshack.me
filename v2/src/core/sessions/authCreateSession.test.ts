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
import { seedInnerGatewayAdminPw, seedApGatewayAdminPw } from '../generation/routerFs';
import { hostMachineId } from '../generation/remoteHostId';
import { computeInnerGatewayId, computeApGatewayId } from '../identity/router';
import { md5 } from '../generation/md5';
import { asGameTime } from '../types';
import { AUTH_LOG_PATH, formatSshdAuthLine } from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { PatchRow } from '../patches/upsertPatch';
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
// 2026-06-07 14:32:01 UTC — the server clock the auth.log line is stamped with.
const FIXED_NOW = Date.UTC(2026, 5, 7, 14, 32, 1);

const makeDeps = (over: Partial<AuthCreateSessionDeps> = {}) => {
  const insertSession = vi.fn<(row: AuthSessionRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readAuthLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  // An empty journal is a healthy box: nothing has been written, so nothing is
  // tombstoned and `canBoot` holds. Every pre-existing test therefore keeps its
  // behaviour without naming the dep.
  const findPatches = vi.fn<
    (query: { machine_id: string }) => Promise<{
      data: readonly OwnerPatchRow[] | null;
      error: unknown;
    }>
  >(async () => ({ data: [], error: null }));
  const deps: AuthCreateSessionDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    insertSession,
    readAuthLog,
    upsertPatch,
    findPatches,
    ...over,
  };
  return { deps, insertSession, upsertPatch, readAuthLog, findPatches };
};

/** The sshd auth.log line the server is expected to stamp for an attempt at
 *  `FIXED_NOW`, given the host + outcome + source ip in the test payloads. */
const expectedSshdLine = (
  host: LanHost,
  outcome: 'success' | 'failure',
  user: string,
  fromIp = '192.168.1.50',
): string =>
  formatSshdAuthLine({
    outcome,
    user,
    fromIp,
    hostname: host.hostname,
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
  });

/** A real machine host on the signer's deterministic LAN to ssh into. */
const targetHostFor = (): LanHost => {
  const machine = generateHomeLan(ESSID)
    .hosts.filter((host) => host.kind === 'machine')
    .at(-1);
  if (machine === undefined) throw new Error('no machine host on LAN');
  return machine;
};

/** The `.1` gateway (the player's own router) on the signer's LAN. The first
 *  router in octet order is always the edge gateway at .1. */
const routerHostFor = (): LanHost => {
  const router = generateHomeLan(ESSID).hosts.find((host) => host.kind === 'router');
  if (router === undefined) throw new Error('no router host on LAN');
  return router;
};

/** The inner gateway — a SECOND router on the signer's LAN, at a non-.1 octet. */
const innerGatewayHostFor = (): LanHost => {
  const inner = generateHomeLan(ESSID).hosts.find(
    (host) => host.kind === 'router' && Number(host.ip.split('.')[3]) !== 1,
  );
  if (inner === undefined) throw new Error('no inner gateway on LAN');
  return inner;
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
  const fs = buildRemoteHostFs(ESSID, host);
  return signRequest(
    id,
    'authCreateSession',
    basePayload({ target_ip: host.ip, username, password: passwordFor(fs, username), ...over }),
  );
};

describe('handleAuthCreateSession', () => {
  it('validates the root password against the regenerated passwd and inserts an ssh session', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
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
    const host = targetHostFor();
    const username = npcUsername(buildRemoteHostFs(ESSID, host));
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(validEnvelope(id, host, username), deps);

    expect(result.body).toEqual({ ok: true, userType: 'user' });
    expect(insertSession.mock.calls[0]![0].credentials).toEqual({ username, userType: 'user' });
  });

  it('server-derives userType "guest" for the guest account', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(validEnvelope(id, host, 'guest'), deps);

    expect(result.body).toEqual({ ok: true, userType: 'guest' });
    expect(insertSession.mock.calls[0]![0].credentials.userType).toBe('guest');
  });

  it('rejects a wrong password with 401 invalid_credentials and never inserts', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
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
    const host = targetHostFor();
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
    const host = targetHostFor();
    const fs = buildRemoteHostFs(ESSID, host);
    const {
      parent_session_id: _p,
      source_ip: _s,
      ...rest
    } = basePayload({
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
    const host = targetHostFor();
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
    const host = targetHostFor();
    const envelope = validEnvelope(id, host, 'root');
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(
      { ...envelope, payload: `${envelope.payload} ` },
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('returns 500 when the insert fails', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const { deps } = makeDeps({ insertSession: async () => ({ error: { message: 'db down' } }) });

    const result = await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    expect(result).toEqual({ status: 500, body: { error: 'insert_failed' } });
  });

  it('lands an sshd "Accepted password" line on the REMOTE host\'s auth.log on success', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const { deps, upsertPatch } = makeDeps();

    await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    // The line is system-written to the remote host's shared journal, keyed by
    // the attacker's writer_key + the remote machine_id, under /var/log/auth.log
    // with root-owner/root-write perms.
    expect(upsertPatch.mock.calls[0]![0]).toEqual({
      writer_key: id.publicKeyHex,
      machine_id: hostMachineId(host, ESSID),
      path: AUTH_LOG_PATH,
      content: `${expectedSshdLine(host, 'success', 'root')}\n`,
      owner: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      node_type: 'file',
    });
  });

  it('lands an sshd "Failed password" line on the remote auth.log for a wrong password', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({ target_ip: host.ip, username: 'root', password: 'not-the-password' }),
    );
    const { deps, upsertPatch, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result.status).toBe(401);
    expect(insertSession).not.toHaveBeenCalled();
    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `${expectedSshdLine(host, 'failure', 'root')}\n`,
    );
  });

  it('appends the line after the existing auth.log content (read-modify-write)', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const { deps, upsertPatch } = makeDeps({
      readAuthLog: async () => ({ data: { content: 'PRIOR LINE\n' }, error: null }),
    });

    await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `PRIOR LINE\n${expectedSshdLine(host, 'success', 'root')}\n`,
    );
  });

  it('reads and writes the auth.log on the remote machine, not the attacker workstation', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const { deps, readAuthLog } = makeDeps();

    await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    expect(readAuthLog.mock.calls[0]![0]).toEqual({
      writer_key: id.publicKeyHex,
      machine_id: hostMachineId(host, ESSID),
      path: AUTH_LOG_PATH,
    });
  });

  it('carries the caller source_ip into the auth.log line', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const { deps, upsertPatch } = makeDeps();

    await handleAuthCreateSession(validEnvelope(id, host, 'root', { source_ip: '10.9.8.7' }), deps);

    expect(upsertPatch.mock.calls[0]![0].content).toContain('from 10.9.8.7');
  });

  it('logs "from unknown" when no source_ip is supplied', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const fs = buildRemoteHostFs(ESSID, host);
    const { source_ip: _drop, ...noSource } = basePayload({
      target_ip: host.ip,
      username: 'root',
      password: passwordFor(fs, 'root'),
    });
    const { deps, upsertPatch } = makeDeps();

    await handleAuthCreateSession(signRequest(id, 'authCreateSession', noSource), deps);

    expect(upsertPatch.mock.calls[0]![0].content).toContain('from unknown');
  });

  it('does not append a line when the auth.log read fails (read-modify-write bails)', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const { deps, upsertPatch } = makeDeps({
      readAuthLog: async () => ({ data: null, error: { message: 'read failed' } }),
    });

    const result = await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    // The auth itself still succeeds — logging is best-effort — but the broken
    // read must not let the append clobber the log with a contentless write.
    expect(result.status).toBe(200);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('writes no auth.log line when the target host is unreachable (nothing to log on)', async () => {
    const id = generateIdentity();
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({ target_ip: '10.255.255.254', username: 'root', password: 'x' }),
    );
    const { deps, upsertPatch } = makeDeps();

    await handleAuthCreateSession(envelope, deps);

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('does not let a logging failure break (or fabricate) a successful auth', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const { deps, insertSession } = makeDeps({
      upsertPatch: async () => {
        throw new Error('log write exploded');
      },
    });

    const result = await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, userType: 'root' } });
    expect(insertSession).toHaveBeenCalledTimes(1);
  });

  // The own-LAN `.1` gateway is the player's ROUTER — a journal-backed box with a
  // root-only passwd seeded by the owner key. A login there must validate against
  // the SEEDED ADMIN PW and land on `computeApGatewayId`, not a regenerated sibling.
  it('logs into the OWN ROUTER at .1 with the seeded admin pw — root session on the router id', async () => {
    const id = generateIdentity();
    const router = routerHostFor();
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({
        target_ip: router.ip,
        username: 'root',
        password: seedApGatewayAdminPw(ESSID),
      }),
    );
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true, userType: 'root' } });
    const row = insertSession.mock.calls[0]![0];
    expect(row.machine_id).toBe(computeApGatewayId(ESSID));
    expect(row.credentials).toEqual({ username: 'root', userType: 'root' });
    expect(row.kind).toBe('ssh');
    expect(row.essid).toBe(ESSID);
  });

  it('rejects a wrong router admin password with 401 and never inserts', async () => {
    const id = generateIdentity();
    const router = routerHostFor();
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({
        target_ip: router.ip,
        username: 'root',
        password: 'definitely-not-the-admin-pw',
      }),
    );
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a guest login on the router even with the would-be NPC password (router is root-only)', async () => {
    const id = generateIdentity();
    const router = routerHostFor();
    // The password a generic machine FS WOULD seed for `guest` at this coordinate —
    // accepting it would prove the handler built a sibling machine FS, not the
    // root-only router FS, for a `.1` target.
    const wouldBeGuestPw = passwordFor(buildRemoteHostFs(ESSID, router), 'guest');
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({ target_ip: router.ip, username: 'guest', password: wouldBeGuestPw }),
    );
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  // The inner gateway is a SECOND router on the own LAN. A login there must validate
  // against ITS OWN octet-seeded admin pw and land on a machine id DISTINCT from the
  // edge router — proving the two routers no longer alias.
  it('logs into the INNER GATEWAY with its own octet-seeded admin pw — root session on a distinct id', async () => {
    const id = generateIdentity();
    const inner = innerGatewayHostFor();
    const octet = Number(inner.ip.split('.')[3]);
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({
        target_ip: inner.ip,
        username: 'root',
        password: seedInnerGatewayAdminPw(ESSID, octet),
      }),
    );
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true, userType: 'root' } });
    const row = insertSession.mock.calls[0]![0];
    expect(row.machine_id).toBe(computeInnerGatewayId(ESSID, octet));
    expect(row.machine_id).not.toBe(computeApGatewayId(ESSID));
    expect(row.credentials).toEqual({ username: 'root', userType: 'root' });
  });

  it('rejects a wrong admin password on the inner gateway with 401 and never inserts', async () => {
    const id = generateIdentity();
    const inner = innerGatewayHostFor();
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({ target_ip: inner.ip, username: 'root', password: 'not-the-inner-pw' }),
    );
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  // A switch is the second inner-gateway device type on the own LAN. A login there
  // must validate against ITS OWN octet-seeded admin pw and land on a machine id
  // DISTINCT from BOTH the edge router and the inner router — its own box, its own
  // /etc/passwd, never an alias.
  it('logs into a SWITCH with its octet-seeded admin pw — root session on a distinct inner-gateway id', async () => {
    const id = generateIdentity();
    const device = generateHomeLan(ESSID).hosts.find(
      (host) => host.kind === 'switch',
    );
    if (device === undefined) throw new Error('no switch on LAN');
    const octet = Number(device.ip.split('.')[3]);
    const innerOctet = Number(innerGatewayHostFor().ip.split('.')[3]);
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({
        target_ip: device.ip,
        username: 'root',
        password: seedInnerGatewayAdminPw(ESSID, octet),
      }),
    );
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true, userType: 'root' } });
    const row = insertSession.mock.calls[0]![0];
    expect(row.machine_id).toBe(computeInnerGatewayId(ESSID, octet));
    expect(row.machine_id).not.toBe(computeApGatewayId(ESSID));
    expect(row.machine_id).not.toBe(computeInnerGatewayId(ESSID, innerOctet));
    expect(row.credentials).toEqual({ username: 'root', userType: 'root' });
  });

  it('rejects a wrong admin password on the switch with 401 and never inserts', async () => {
    const id = generateIdentity();
    const device = generateHomeLan(ESSID).hosts.find(
      (host) => host.kind === 'switch',
    );
    if (device === undefined) throw new Error('no switch on LAN');
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({ target_ip: device.ip, username: 'root', password: 'not-the-switch-pw' }),
    );
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });
});

/**
 * A bricked box is dark on EVERY interface, not just the WAN.
 *
 * The public paths (`resolvePublicScan`, `authCreateSessionPublic`) already refuse a
 * host whose `/boot` kernel has been tombstoned, so a bricked AP gateway takes its
 * public IP dark. This handler serves the INSIDE of the LAN — `ssh root@<.1>` and
 * `ssh <user>@<npc>` from an occupant — and used to authenticate against the purely
 * regenerated base FS, which cannot carry a tombstone. A bricked gateway therefore
 * kept serving ssh to every occupant of its own network.
 *
 * That matters more since the gateway became one shared machine per ESSID: the brick
 * is a permanent, world-visible scar, so the box has to be unreachable from the LAN
 * too. What survives a gateway brick is the NETWORK, not the box — the ESSID keeps
 * broadcasting, occupants keep reaching each other (`authCreateSessionSameLan`), and
 * joins keep working. Radio and switching outlive the router.
 */
describe('handleAuthCreateSession — a bricked own-LAN host is dark from inside the LAN', () => {
  /** A root `rm /boot/vmlinuz` tombstone on the host's shared journal — replayed over
   *  its seeded base it deletes the kernel, so `canBoot` fails and the box is dark. */
  const bootTombstone = (writerKey: string): OwnerPatchRow => ({
    path: '/boot/vmlinuz',
    content: null,
    owner: 'root',
    permissions: null,
    node_type: null,
    updated_at: '2026-07-26T00:00:00.000Z',
    writer_key: writerKey,
  });

  it('refuses ssh to a bricked AP gateway even with the correct seeded admin password', async () => {
    const id = generateIdentity();
    const router = routerHostFor();
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({
        target_ip: router.ip,
        username: 'root',
        password: seedApGatewayAdminPw(ESSID),
      }),
    );
    const { deps, insertSession } = makeDeps({
      findPatches: async () => ({ data: [bootTombstone(id.publicKeyHex)], error: null }),
    });

    const result = await handleAuthCreateSession(envelope, deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reads the journal of the machine the target resolves to — the gateway id, not a sibling', async () => {
    const id = generateIdentity();
    const router = routerHostFor();
    const envelope = signRequest(
      id,
      'authCreateSession',
      basePayload({
        target_ip: router.ip,
        username: 'root',
        password: seedApGatewayAdminPw(ESSID),
      }),
    );
    const { deps, findPatches } = makeDeps();

    await handleAuthCreateSession(envelope, deps);

    expect(findPatches).toHaveBeenCalledWith({ machine_id: computeApGatewayId(ESSID) });
  });

  it('refuses ssh to a bricked NPC host on the LAN — the same defect, any host kind', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const { deps, insertSession } = makeDeps({
      findPatches: async () => ({ data: [bootTombstone(id.publicKeyHex)], error: null }),
    });

    const result = await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('leaves no auth.log line on a bricked host — a dark box records nothing', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const { deps, upsertPatch } = makeDeps({
      findPatches: async () => ({ data: [bootTombstone(id.publicKeyHex)], error: null }),
    });

    await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('still logs in when the journal carries writes that are NOT a boot tombstone', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const unrelatedWrite: OwnerPatchRow = {
      path: '/home/notes.txt',
      content: 'a write that leaves the kernel intact',
      owner: 'root',
      permissions: null,
      node_type: 'file',
      updated_at: '2026-07-26T00:00:00.000Z',
      writer_key: id.publicKeyHex,
    };
    const { deps, insertSession } = makeDeps({
      findPatches: async () => ({ data: [unrelatedWrite], error: null }),
    });

    const result = await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, userType: 'root' } });
    expect(insertSession).toHaveBeenCalledTimes(1);
  });

  it('fails the login with 500 when the journal read errors — never a false login or false dark', async () => {
    const id = generateIdentity();
    const host = targetHostFor();
    const { deps, insertSession } = makeDeps({
      findPatches: async () => ({ data: null, error: new Error('journal unavailable') }),
    });

    const result = await handleAuthCreateSession(validEnvelope(id, host, 'root'), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
    expect(insertSession).not.toHaveBeenCalled();
  });
});
