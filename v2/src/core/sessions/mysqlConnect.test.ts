import { describe, expect, it, vi } from 'vitest';
import { handleMysqlConnect, type MysqlConnectDeps } from './mysqlConnect';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import {
  deepDatabaseFixture,
  knownDatabaseCredentialIn,
  playerDatabaseOn,
} from '../../test/factories/lanDatabase';
import { computeApGatewayId } from '../identity/router';
import { lanAddressFor, type LanLeaseRow } from '../network/lanAddress';
import { formatPidfileContent, pidfilePath } from '../services/pidfile';
import { DATADIR_PATH } from '../mysql/datadir';
import type { ApNetworkLookup, NatOccupantRow } from '../network/resolvePublicTarget';
import { databaseIn } from '../mysql/datadir';
import { readOpenPorts } from '../services/pidfile';
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
    // No access point bears an address by default: these tests are the caller's OWN
    // world, and a public address nobody registered reaches nothing.
    findNetworkByPublicIp: async () => ({ data: null, error: null }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
    findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
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
    readonly port?: number;
  },
) =>
  signRequest(identity, 'mysqlConnect', {
    essid: request.essid ?? ESSID,
    target_ip: request.target_ip,
    port: request.port ?? SERVICE_CATALOG.mysql.defaultPort,
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


const DEEP = deepDatabaseFixture();

// ─── another player's box, reached the only way an outsider can reach one ───
//
// A public IP names an ACCESS POINT, never a machine, so the port is the whole of
// the address: the defender had to open a forward before their database existed to
// anyone outside. Everything below the forward is the server's — the occupancy row,
// the lease, the journal — because a client that could name a target box directly
// would be a client that could reach a box its owner never published.
const TARGET_PUBLIC_IP = '203.0.113.9';
const TARGET_ESSID = 'PIED-PIPER-GUEST';
const AP_GATEWAY_ID = computeApGatewayId(TARGET_ESSID);
const AP_NETWORK: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: TARGET_ESSID };
/** The attacker's own home address, as the server resolves it from their VERIFIED
 *  key. A cross-player log line is the defender's only evidence, so the address in it
 *  is never the one the client typed. */
const ATTACKER_PUBLIC_IP = '198.51.100.22';

const DEFENDER = generateIdentity();
const DEFENDER_OCTET = 84;
const DEFENDER_LAN_IP = lanAddressFor(TARGET_ESSID, DEFENDER_OCTET);
const DEFENDER_WS = 'workstation-c3d4e5f6';
const DEFENDER_HOSTNAME = 'nebuchadnezzar';
const defenderOccupant: NatOccupantRow = {
  owner_key: DEFENDER.publicKeyHex,
  workstation_machine_id: DEFENDER_WS,
  workstation_machine_name: DEFENDER_HOSTNAME,
  workstation_username: 'neo',
  workstation_root_hash: md5('correct-horse-battery-staple'),
};
const DEFENDER_LEASES: readonly LanLeaseRow[] = [
  { owner_key: DEFENDER.publicKeyHex, octet: DEFENDER_OCTET },
];
const { database: DEFENDER_DATABASE, credential: DEFENDER_DB_ACCOUNT } =
  playerDatabaseOn(defenderOccupant);

/** The port the defender published. Deliberately neither 3306 nor 22: on a public
 *  address the port is chosen by whoever wrote the forward. */
const PUBLIC_PORT = 43306;
const publicForward = (internalPort: number = SERVICE_CATALOG.mysql.defaultPort): OwnerPatchRow =>
  patchRow('/etc/iptables/rules.v4', `forward ${PUBLIC_PORT} to ${DEFENDER_LAN_IP}:${internalPort}`);

/** The defender ran `systemctl start mysqld` and, before that, `apt install mysql`.
 *  A box that did neither has an empty `/var/run` and no datadir at all. */
const defenderMysqld = patchRow(
  pidfilePath(SERVICE_CATALOG.mysql),
  formatPidfileContent(SERVICE_CATALOG.mysql, SERVICE_CATALOG.mysql.defaultPort),
);
const defenderDatadir = patchRow(DATADIR_PATH, JSON.stringify(DEFENDER_DATABASE));

const crossPlayerDeps = (over: Partial<MysqlConnectDeps> = {}) =>
  makeDeps({
    findPatches: journals({
      [AP_GATEWAY_ID]: [publicForward()],
      [DEFENDER_WS]: [defenderMysqld, defenderDatadir],
    }),
    findNetworkByPublicIp: async () => ({ data: AP_NETWORK, error: null }),
    listOccupantsByEssid: async () => ({ data: [defenderOccupant], error: null }),
    listLeasesByEssid: async () => ({ data: DEFENDER_LEASES, error: null }),
    findHomeNetworkByOwnerKey: async () => ({
      data: { public_ip: ATTACKER_PUBLIC_IP },
      error: null,
    }),
    ...over,
  });

/** Deliberately neither 3306 nor 22: the port the player opened on the GATEWAY has
 *  nothing to do with the port the daemon listens on behind it. */
const FORWARD_PORT = 33306;

/** The player's own root `nano /etc/iptables/rules.v4` on the gateway — the opt-in
 *  that exposes the layer at all. Without it the deep box has no address anyone can
 *  name. */
const forwardTo = (destination: string): OwnerPatchRow =>
  patchRow('/etc/iptables/rules.v4', `forward ${FORWARD_PORT} to ${destination}`);

/** Journals per machine, because the chain walk asks for one machine at a time and a
 *  mock answering the same rows for every id would hand the gateway's forward table to
 *  the deep box as well. */
const journals = (rows: Readonly<Record<string, readonly OwnerPatchRow[]>>) =>
  vi.fn<MysqlConnectDeps['findPatches']>(async ({ machine_id }) => ({
    data: rows[machine_id] ?? [],
    error: null,
  }));

const throughForward = (destination = `${DEEP.layer.host.ip}:3306`) =>
  journals({ [DEEP.gatewayMachineId]: [forwardTo(destination)] });

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

    expect(response).toEqual({ status: 200, body: { ok: true, hostname: host.hostname } });
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
    expect(wrongPassword).toEqual({ status: 401, body: { error: 'invalid_credentials', from: CLIENT_IP } });
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
    expect(response).toEqual({ status: 401, body: { error: 'invalid_credentials', from: CLIENT_IP } });
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
    expect(response).toEqual({ status: 401, body: { error: 'invalid_credentials', from: CLIENT_IP } });
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
    expect(response).toEqual({ status: 200, body: { ok: true, hostname: host.hostname } });
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

  it('reports a journal the store could not read as a failure, not as an empty box', async () => {
    const identity = generateIdentity();
    const host = mysqlHostOn(ESSID);
    const { username, password } = knownDatabaseCredential(host);
    const { deps } = makeDeps({
      findPatches: async () => ({ data: null, error: { message: 'connection reset' } }),
    });

    const response = await handleMysqlConnect(
      await signedConnect(identity, { target_ip: host.ip, username, password }),
      deps,
    );

    // An unreadable journal is not a box with no journal. Falling back to the seeded
    // baseline would refuse an account the player added, serve a table they dropped,
    // and hand back the box as it was the day the world was generated.
    expect(response).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
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

  describe("another player's database, reached by their public address", () => {
    it('opens on the box behind the forward, and names it', async () => {
      const identity = generateIdentity();
      const { deps } = crossPlayerDeps();

      const response = await handleMysqlConnect(
        await signedConnect(identity, {
          essid: TARGET_ESSID,
          target_ip: TARGET_PUBLIC_IP,
          port: PUBLIC_PORT,
          username: DEFENDER_DB_ACCOUNT.username,
          password: DEFENDER_DB_ACCOUNT.password,
        }),
        deps,
      );

      expect(response).toEqual({
        status: 200,
        body: { ok: true, hostname: DEFENDER_HOSTNAME },
      });
    });

    it("records the attempt on the defender's own box, under the defender's key", async () => {
      const identity = generateIdentity();
      const { deps, upsertPatch } = crossPlayerDeps();

      await handleMysqlConnect(
        await signedConnect(identity, {
          essid: TARGET_ESSID,
          target_ip: TARGET_PUBLIC_IP,
          port: PUBLIC_PORT,
          username: DEFENDER_DB_ACCOUNT.username,
          password: DEFENDER_DB_ACCOUNT.password,
        }),
        deps,
      );

      // The system owns its logs: every attacker's lines accrete into ONE row on the
      // defender's box rather than one row each, where the newest would erase the rest.
      expect(upsertPatch).toHaveBeenCalledWith({
        writer_key: DEFENDER.publicKeyHex,
        machine_id: DEFENDER_WS,
        path: MYSQL_LOG_PATH,
        content: `${formatMysqlAttemptLine({
          outcome: 'success',
          user: DEFENDER_DB_ACCOUNT.username,
          fromIp: ATTACKER_PUBLIC_IP,
          hostname: DEFENDER_HOSTNAME,
          time: asGameTime(FIXED_NOW),
          pid: derivePid(FIXED_NOW),
          database: DEFENDER_DATABASE.name,
        })}\n`,
        owner: MYSQL_LOG_OWNER,
        permissions: MYSQL_LOG_PERMISSIONS,
        node_type: 'file',
      });
    });

    it('writes the address the SERVER derived, never the one the client typed', async () => {
      const identity = generateIdentity();
      const { deps, upsertPatch } = crossPlayerDeps();

      await handleMysqlConnect(
        await signedConnect(identity, {
          essid: TARGET_ESSID,
          target_ip: TARGET_PUBLIC_IP,
          port: PUBLIC_PORT,
          username: DEFENDER_DB_ACCOUNT.username,
          password: DEFENDER_DB_ACCOUNT.password,
          source_ip: '10.0.0.1',
        }),
        deps,
      );

      const [written] = upsertPatch.mock.calls[0] ?? [];
      expect(written?.content).toContain(`@${ATTACKER_PUBLIC_IP}`);
      expect(written?.content).not.toContain('10.0.0.1');
    });

    it('refuses a database its owner never forwarded, before any password check', async () => {
      const identity = generateIdentity();
      const { deps, upsertPatch } = crossPlayerDeps({
        findPatches: journals({ [DEFENDER_WS]: [defenderMysqld, defenderDatadir] }),
      });

      const response = await handleMysqlConnect(
        await signedConnect(identity, {
          essid: TARGET_ESSID,
          target_ip: TARGET_PUBLIC_IP,
          port: PUBLIC_PORT,
          username: DEFENDER_DB_ACCOUNT.username,
          password: DEFENDER_DB_ACCOUNT.password,
        }),
        deps,
      );

      // The opt-in is the whole mechanism: a box behind NAT is dark until its owner
      // opens a door, and running a database is not the same as publishing one.
      expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('refuses once the defender has stopped the daemon, writing nothing', async () => {
      const identity = generateIdentity();
      const { deps, upsertPatch } = crossPlayerDeps({
        findPatches: journals({
          [AP_GATEWAY_ID]: [publicForward()],
          [DEFENDER_WS]: [defenderDatadir],
        }),
      });

      const response = await handleMysqlConnect(
        await signedConnect(identity, {
          essid: TARGET_ESSID,
          target_ip: TARGET_PUBLIC_IP,
          port: PUBLIC_PORT,
          username: DEFENDER_DB_ACCOUNT.username,
          password: DEFENDER_DB_ACCOUNT.password,
        }),
        deps,
      );

      // `systemctl stop mysqld` is the defender's counter-move, and it works from the
      // outside in: the pidfiles are the truth about what is listening, so a stopped
      // daemon leaves nothing to connect to and nothing to log.
      //
      // Unreachable rather than not-running, and deliberately: from outside somebody
      // else's NAT a forward onto a dead port and a forward that was never opened are
      // the same silence, which is what the gateway can actually observe. The door that
      // told them apart would be telling an outsider which services a box behind the
      // NAT has stopped. `ssh` answers the same way on the same address.
      expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('refuses a forward that reaches the box on a port no database holds', async () => {
      const identity = generateIdentity();
      const { deps } = crossPlayerDeps({
        findPatches: journals({
          [AP_GATEWAY_ID]: [publicForward(22)],
          [DEFENDER_WS]: [
            defenderMysqld,
            defenderDatadir,
            patchRow(pidfilePath(SERVICE_CATALOG.ssh), formatPidfileContent(SERVICE_CATALOG.ssh, 22)),
          ],
        }),
      });

      const response = await handleMysqlConnect(
        await signedConnect(identity, {
          essid: TARGET_ESSID,
          target_ip: TARGET_PUBLIC_IP,
          port: PUBLIC_PORT,
          username: DEFENDER_DB_ACCOUNT.username,
          password: DEFENDER_DB_ACCOUNT.password,
        }),
        deps,
      );

      // The port IS the address. A forward to sshd is not a door to the database, even
      // on a box plainly running one.
      expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
    });
  });

  describe('a database behind a forward', () => {
    it('opens on the deep box the forward leads to, and names it', async () => {
      const identity = generateIdentity();
      const { username, password } = knownDatabaseCredentialIn(DEEP.database, DEEP.layer.host.hostname);
      const { deps } = makeDeps({
        findPatches: throughForward(),
      });

      const response = await handleMysqlConnect(
        await signedConnect(identity, {
          essid: DEEP.essid,
          target_ip: DEEP.gateway.ip,
          port: FORWARD_PORT,
          username,
          password,
        }),
        deps,
      );

      // The hostname is the whole point of answering with one: this box's address is
      // absent from the generated LAN, so the client cannot name it any other way.
      expect(response).toEqual({
        status: 200,
        body: { ok: true, hostname: DEEP.layer.host.hostname },
      });
    });

    it('refuses a port the gateway forwards nowhere', async () => {
      const identity = generateIdentity();
      const { username, password } = knownDatabaseCredentialIn(DEEP.database, DEEP.layer.host.hostname);
      const { deps } = makeDeps({
        findPatches: throughForward(),
      });

      const response = await handleMysqlConnect(
        await signedConnect(identity, {
          essid: DEEP.essid,
          target_ip: DEEP.gateway.ip,
          port: FORWARD_PORT + 1,
          username,
          password,
        }),
        deps,
      );

      expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    });

    it('refuses a forward that lands on a port no daemon holds', async () => {
      const identity = generateIdentity();
      const { username, password } = knownDatabaseCredentialIn(DEEP.database, DEEP.layer.host.hostname);
      const { deps } = makeDeps({
        findPatches: throughForward(`${DEEP.layer.host.ip}:9999`),
      });

      const response = await handleMysqlConnect(
        await signedConnect(identity, {
          essid: DEEP.essid,
          target_ip: DEEP.gateway.ip,
          port: FORWARD_PORT,
          username,
          password,
        }),
        deps,
      );

      expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    });

    it('refuses a forward onto the right box on a port another daemon holds', async () => {
      const identity = generateIdentity();
      const { username, password } = knownDatabaseCredentialIn(DEEP.database, DEEP.layer.host.hostname);
      const sshPort = readOpenPorts(DEEP.fs).find(
        (open) => open.service !== SERVICE_CATALOG.mysql.service,
      );
      if (sshPort === undefined) throw new Error('need a second daemon on the deep box');
      const { deps } = makeDeps({
        findPatches: throughForward(`${DEEP.layer.host.ip}:${sshPort.port}`),
      });

      const response = await handleMysqlConnect(
        await signedConnect(identity, {
          essid: DEEP.essid,
          target_ip: DEEP.gateway.ip,
          port: FORWARD_PORT,
          username,
          password,
        }),
        deps,
      );

      // The forward really does reach this box, and something really is listening
      // there. A forward to sshd is not a door to the database.
      expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
    });

    it('records the attempt at the address NAT showed the box, not the one the client claimed', async () => {
      const identity = generateIdentity();
      const { username, password } = knownDatabaseCredentialIn(DEEP.database, DEEP.layer.host.hostname);
      const { deps, upsertPatch } = makeDeps({
        findPatches: throughForward(),
      });

      await handleMysqlConnect(
        await signedConnect(identity, {
          essid: DEEP.essid,
          target_ip: DEEP.gateway.ip,
          port: FORWARD_PORT,
          username,
          password,
          source_ip: '192.168.1.50',
        }),
        deps,
      );

      // The route decides the address, not where the player stands. A deep box behind
      // NAT never sees a 192.168.x address, so echoing the client's claim would write
      // a line no daemon could have produced.
      const [written] = upsertPatch.mock.calls[0] ?? [];
      expect(written?.machine_id).toBe(DEEP.machineId);
      expect(written?.content).toContain(`@${DEEP.natIp}`);
      expect(written?.content).not.toContain('192.168.1.50');
    });

    it('opens for an account added to the deep datadir by hand', async () => {
      const identity = generateIdentity();
      const database = databaseIn(DEEP.fs);
      if (database === null) throw new Error('no database on the deep box');
      const planted = {
        ...database,
        credentials: [
          ...database.credentials,
          { username: 'planted_dba', passwordHash: md5('plant-me'), userType: 'user' as const },
        ],
      };
      const { deps } = makeDeps({
        findPatches: journals({
          [DEEP.gatewayMachineId]: [forwardTo(`${DEEP.layer.host.ip}:3306`)],
          [DEEP.machineId]: [patchRow('/var/lib/mysql/data.json', JSON.stringify(planted))],
        }),
      });

      const response = await handleMysqlConnect(
        await signedConnect(identity, {
          essid: DEEP.essid,
          target_ip: DEEP.gateway.ip,
          port: FORWARD_PORT,
          username: 'planted_dba',
          password: 'plant-me',
        }),
        deps,
      );

      // The deep box is the one hop of the chain whose journal nothing used to read.
      // Left unreplayed, a write to this datadir persists and is never seen again.
      expect(response).toEqual({
        status: 200,
        body: { ok: true, hostname: DEEP.layer.host.hostname },
      });
    });
  });
});
