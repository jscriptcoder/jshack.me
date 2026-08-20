import { describe, expect, it, vi } from 'vitest';
import { handleMysqlConnect, type MysqlConnectDeps } from './mysqlConnect';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { hostServices } from '../generation/remoteHostFs';
import { ALL_GENERATED_PASSWORDS } from '../generation/passwordPools';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { accountsIn } from './passwdAccount';
import { parseMysqlDatabase, type MysqlDatabase } from '../mysql/types';
import { md5 } from '../generation/md5';
import {
  MYSQL_LOG_OWNER,
  MYSQL_LOG_PATH,
  MYSQL_LOG_PERMISSIONS,
  formatMysqlAttemptLine,
} from '../logging/mysqlLog';
import { derivePid } from '../logging/syslog';
import { asAbsPath, asGameTime } from '../types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { Directory } from '../filesystem/types';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleMysqlConnect` decides whether a credential opens a box's database, and it
 * decides it SERVER-side against the box's REAL datadir — journal replayed over the
 * seeded base, so an account somebody added by editing `/var/lib/mysql/data.json`
 * is an account that logs in. A gate that read a locally regenerated baseline would
 * refuse a credential the player can see in the file.
 *
 * These are the database's accounts, never the box's. `/etc/passwd` answers who you
 * are on the machine; the datadir answers who you are to the database, and the two
 * are drawn on separate streams — so a box's root password must not open its
 * database, and that is the sharpest thing here.
 *
 * Unknown account and wrong password collapse to ONE response, byte for byte. An
 * error that told them apart would let a player enumerate the accounts a database
 * has by typing names at it, which is the enumeration `/etc/passwd`'s own gate
 * already refuses to give away.
 *
 * NO session row is created — a database connection has none. The credential is
 * re-validated per statement instead, which is what keeps this door from ever
 * reaching a filesystem.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
// 2026-08-09 11:04:07 UTC — the server clock every log line here is stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);
const CLIENT_IP = '192.168.1.50';

/** A LAN host running mysqld — the only kind with a database to open. */
const mysqlHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) =>
      candidate.kind === 'machine' &&
      hostServices(essid, candidate).some(({ spec }) => spec === SERVICE_CATALOG.mysql),
  );
  if (host === undefined) throw new Error('no mysql-running host on LAN');
  return host;
};

/** A LAN host running ssh but NO database. It has to be running SOMETHING: a box
 *  running nothing is refused whichever port the handler consults, so it could not
 *  tell a gate that reads 3306 from one that reads 22. */
const databaselessHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find((candidate) => {
    if (candidate.kind !== 'machine') return false;
    const services = hostServices(essid, candidate).map(({ spec }) => spec);
    return services.includes(SERVICE_CATALOG.ssh) && !services.includes(SERVICE_CATALOG.mysql);
  });
  if (host === undefined) throw new Error('every ssh host on LAN runs a database');
  return host;
};

const fileOn = (host: LanHost, segments: readonly string[]): string | undefined => {
  const parent = segments.slice(0, -1).reduce<Directory | undefined>((node, segment) => {
    const next = node?.entries.get(segment);
    return next !== undefined && next.kind === 'directory' ? next : undefined;
  }, resolveLanHostIdentity(host, ESSID).baseFs);
  const leaf = parent?.entries.get(segments.at(-1) ?? '');
  return leaf !== undefined && leaf.kind === 'file' ? leaf.content : undefined;
};

const databaseOn = (host: LanHost): MysqlDatabase => {
  const raw = fileOn(host, ['var', 'lib', 'mysql', 'data.json']);
  const database = raw === undefined ? null : parseMysqlDatabase(raw);
  if (database === null) throw new Error(`no database on ${host.hostname}`);
  return database;
};

/** One database account with its real plaintext, recovered by matching the stored
 *  md5 against the pool every generated password is drawn from — the test needs to
 *  KNOW a good password, which is a different thing from cracking one. */
const knownDatabaseCredential = (
  host: LanHost,
): { readonly username: string; readonly password: string } => {
  const found = databaseOn(host).credentials.flatMap((credential) => {
    const password = ALL_GENERATED_PASSWORDS.find(
      (candidate) => md5(candidate) === credential.passwordHash,
    );
    return password === undefined ? [] : [{ username: credential.username, password }];
  });
  const credential = found[0];
  if (credential === undefined) throw new Error(`no recoverable database account on ${host.hostname}`);
  return credential;
};

/** One of the box's OWN unix accounts with its real plaintext — the key to the
 *  wrong lock. */
const knownUnixAccount = (
  host: LanHost,
): { readonly username: string; readonly password: string } => {
  const { baseFs } = resolveLanHostIdentity(host, ESSID);
  const found = accountsIn(baseFs).flatMap((account) => {
    const password = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === account.hash);
    return password === undefined ? [] : [{ username: account.username, password }];
  });
  const account = found[0];
  if (account === undefined) throw new Error(`no recoverable unix account on ${host.hostname}`);
  return account;
};

const patchRow = (path: string, content: string | null): OwnerPatchRow =>
  ({
    path: asAbsPath(path),
    content,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-08-09T11:00:00.000Z',
    writer_key: 'b'.repeat(64),
  }) as OwnerPatchRow;

const makeDeps = (over: Partial<MysqlConnectDeps> = {}) => {
  const findPatches = vi.fn<MysqlConnectDeps['findPatches']>(async () => ({
    data: [],
    error: null,
  }));
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readMysqlLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  const deps: MysqlConnectDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    findPatches,
    readMysqlLog,
    upsertPatch,
    ...over,
  };
  return { deps, findPatches, readMysqlLog, upsertPatch };
};

const signedConnect = (
  identity: ReturnType<typeof generateIdentity>,
  request: {
    readonly essid?: string;
    readonly target_ip: string;
    readonly username: string;
    readonly password: string;
    readonly source_ip?: string | null;
  },
) =>
  signRequest(identity, 'mysqlConnect', {
    essid: request.essid ?? ESSID,
    target_ip: request.target_ip,
    username: request.username,
    password: request.password,
    source_ip: request.source_ip === undefined ? CLIENT_IP : request.source_ip,
  });

/** One line the daemon is expected to leave on the target's mysql.log. An accepted
 *  connection names the database it opened; a refused one has none to name. */
const logLine = (outcome: 'success' | 'failure', user: string, host: LanHost, database?: string) =>
  formatMysqlAttemptLine({
    outcome,
    user,
    fromIp: CLIENT_IP,
    hostname: host.hostname,
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
    ...(database === undefined ? {} : { database }),
  });

describe('handleMysqlConnect', () => {
  it('opens the database for one of its own accounts', async () => {
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const { username, password } = knownDatabaseCredential(host);
    const { deps } = makeDeps();

    const response = await handleMysqlConnect(
      await signedConnect(identity, { target_ip: host.ip, username, password }),
      deps,
    );

    expect(response).toEqual({ status: 200, body: { ok: true } });
  });

  it('answers an unknown account and a wrong password with the same bytes', async () => {
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const { username } = knownDatabaseCredential(host);
    const { deps } = makeDeps();

    const wrongPassword = await handleMysqlConnect(
      await signedConnect(identity, { target_ip: host.ip, username, password: 'not-the-one' }),
      deps,
    );
    const noSuchAccount = await handleMysqlConnect(
      await signedConnect(identity, {
        target_ip: host.ip,
        username: 'nobody-by-that-name',
        password: 'not-the-one',
      }),
      deps,
    );

    // The claim is the SAMENESS. A refusal that named which half was wrong would let
    // a player enumerate the database's accounts by typing names at it.
    expect(wrongPassword).toEqual(noSuchAccount);
    expect(wrongPassword).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
  });

  it('refuses a real password typed against an account it does not belong to', async () => {
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const { password } = knownDatabaseCredential(host);
    const { deps } = makeDeps();

    const response = await handleMysqlConnect(
      await signedConnect(identity, {
        target_ip: host.ip,
        username: 'nobody-by-that-name',
        password,
      }),
      deps,
    );

    // The password is genuinely one of this database's, which is what makes the
    // refusal meaningful: a gate that checked the hash against ANY account rather
    // than the one named would open here for a name the database has never held.
    expect(response).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
  });

  it('refuses the box own unix account, which is a key to a different lock', async () => {
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const { username, password } = knownUnixAccount(host);
    const { deps } = makeDeps();

    const response = await handleMysqlConnect(
      await signedConnect(identity, { target_ip: host.ip, username, password }),
      deps,
    );

    // A real account with its real password — and it opens nothing here, because
    // `/etc/passwd` and the datadir are drawn on separate streams. A gate that read
    // the box's accounts instead would let this through.
    expect(response).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
  });

  it('opens an account somebody added by editing the datadir', async () => {
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const database = databaseOn(host);
    const edited = {
      ...database,
      credentials: [
        ...database.credentials,
        { username: 'planted', passwordHash: md5('let-me-in'), userType: 'root' },
      ],
    };
    const { deps } = makeDeps({
      findPatches: async () => ({
        data: [patchRow('/var/lib/mysql/data.json', JSON.stringify(edited))],
        error: null,
      }),
    });

    const response = await handleMysqlConnect(
      await signedConnect(identity, {
        target_ip: host.ip,
        username: 'planted',
        password: 'let-me-in',
      }),
      deps,
    );

    // The whole reason this gate is server-side: the datadir is a file, root can
    // edit it, and the accounts it holds after that edit are the real ones.
    expect(response).toEqual({ status: 200, body: { ok: true } });
  });

  it('records an accepted connection on the target, naming the database it opened', async () => {
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const { username, password } = knownDatabaseCredential(host);
    const { deps, upsertPatch } = makeDeps();

    await handleMysqlConnect(
      await signedConnect(identity, { target_ip: host.ip, username, password }),
      deps,
    );

    expect(upsertPatch).toHaveBeenCalledWith({
      writer_key: identity.publicKeyHex,
      machine_id: machineId,
      path: MYSQL_LOG_PATH,
      content: `${logLine('success', username, host, databaseOn(host).name)}\n`,
      owner: MYSQL_LOG_OWNER,
      permissions: MYSQL_LOG_PERMISSIONS,
      node_type: 'file',
    });
  });

  it('records a refused connection, which has no database to name', async () => {
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps();

    await handleMysqlConnect(
      await signedConnect(identity, {
        target_ip: host.ip,
        username: 'nobody-by-that-name',
        password: 'not-the-one',
      }),
      deps,
    );

    // A client that never authenticated was never told which database it would have
    // reached — and a wall of these followed by one accepted line is the defender's
    // most useful signal.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        path: MYSQL_LOG_PATH,
        content: `${logLine('failure', 'nobody-by-that-name', host)}\n`,
      }),
    );
  });

  it('appends to the log the box already has rather than replacing it', async () => {
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const { username, password } = knownDatabaseCredential(host);
    const { deps, upsertPatch } = makeDeps({
      readMysqlLog: async () => ({ data: { content: 'an earlier visit\n' }, error: null }),
    });

    await handleMysqlConnect(
      await signedConnect(identity, { target_ip: host.ip, username, password }),
      deps,
    );

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `an earlier visit\n${logLine('success', username, host, databaseOn(host).name)}\n`,
      }),
    );
  });

  it('refuses an address that is no host on this LAN, writing nothing', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = makeDeps();

    const response = await handleMysqlConnect(
      await signedConnect(identity, {
        target_ip: '192.168.99.99',
        username: 'root',
        password: 'anything',
      }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    // There is no machine, so there is nothing to log on — and a log that grew would
    // make a nonexistent box probeable through its own trace.
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a host running no database, writing nothing', async () => {
    const identity = generateIdentity();
    const host = databaselessHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps();

    const response = await handleMysqlConnect(
      await signedConnect(identity, {
        target_ip: host.ip,
        username: 'root',
        password: 'anything',
      }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a bricked host, exactly as every other door does', async () => {
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const { username, password } = knownDatabaseCredential(host);
    const { deps, upsertPatch } = makeDeps({
      findPatches: async () => ({ data: [patchRow('/boot/vmlinuz', null)], error: null }),
    });

    const response = await handleMysqlConnect(
      await signedConnect(identity, { target_ip: host.ip, username, password }),
      deps,
    );

    // A box with its kernel removed is dark to every tool. Its database daemon is
    // not running because nothing on it is.
    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses an unenveloped request before reading anything', async () => {
    const host = mysqlHostOn(ESSID);
    const { deps, findPatches } = makeDeps();

    // A bare payload with no signature envelope. Refused as malformed rather than
    // resolved into a credential answer further down — the body is a trust
    // boundary, and a password check on an unverifiable request proves nothing.
    const response = await handleMysqlConnect(
      { action: 'mysqlConnect', essid: ESSID, target_ip: host.ip, username: 'root', password: 'x' },
      deps,
    );

    expect(response).toEqual({ status: 400, body: { error: 'envelope_invalid' } });
    expect(findPatches).not.toHaveBeenCalled();
  });
});
