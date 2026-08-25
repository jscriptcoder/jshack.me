import { describe, expect, it, vi } from 'vitest';
import { handleRedisConnect, type RedisConnectDeps } from './redisConnect';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { hostServices } from '../generation/remoteHostFs';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import {
  REDIS_LOG_OWNER,
  REDIS_LOG_PATH,
  REDIS_LOG_PERMISSIONS,
  formatRedisConnectLine,
} from '../logging/redisLog';
import { derivePid } from '../logging/syslog';
import { asGameTime } from '../types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleRedisConnect` opens a key-value store, and it opens one for ANYBODY.
 *
 * That is the door rather than a hole in it. A store answers to one secret or to
 * none, and the secret belongs to the service — so there is no account to name, no
 * credential to send, and nothing here to refuse a caller for being who they are.
 * What can still refuse them is the box: gone, dark, or not running the daemon.
 *
 * A LOCKED store opens too. The lock is not on the door, it is on every question
 * asked through it, which is what the real client does and what the statement handler
 * beside this one enforces. Connecting and being told nothing is the honest shape.
 *
 * NO session row is minted, for a reason sharper than the database door's: that door
 * at least validated a credential, and this one has none to validate. A row would hand
 * `listPatches` and `upsertPatch` to anyone who can reach port 6379.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
// 2026-08-09 11:04:07 UTC — the server clock every log line here is stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);
const CLIENT_IP = '192.168.1.50';

const runsService = (host: LanHost, spec: (typeof SERVICE_CATALOG)[keyof typeof SERVICE_CATALOG]) =>
  host.kind === 'machine' && hostServices(ESSID, host).some((service) => service.spec === spec);

/** A LAN host running the store daemon — the only kind with a store to open. */
const storeHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find((candidate) =>
    runsService(candidate, SERVICE_CATALOG.redis),
  );
  if (host === undefined) throw new Error('no store-running host on LAN');
  return host;
};

/** A LAN host running BOTH daemons. The sharpest fixture here, and sharper than two
 *  boxes would be: the reach is shared with the database door now, so one machine
 *  answering on one port and not the other is what proves the service is really being
 *  asked for rather than assumed from the box. */
const twoDaemonHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) =>
      runsService(candidate, SERVICE_CATALOG.mysql) && runsService(candidate, SERVICE_CATALOG.redis),
  );
  if (host === undefined) throw new Error('no host on LAN runs both a database and a store');
  return host;
};

const makeDeps = (over: Partial<RedisConnectDeps> = {}) => {
  const findPatches = vi.fn<RedisConnectDeps['findPatches']>(async () => ({
    data: [],
    error: null,
  }));
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readRedisLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  const deps: RedisConnectDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    findPatches,
    readRedisLog,
    upsertPatch,
    findNetworkByPublicIp: async () => ({ data: null, error: null }),
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
    findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
    ...over,
  };
  return { deps, findPatches, readRedisLog, upsertPatch };
};

const signedConnect = (
  identity: ReturnType<typeof generateIdentity>,
  request: {
    readonly target_ip: string;
    readonly essid?: string;
    readonly port?: number;
    readonly source_ip?: string | null;
  },
) =>
  signRequest(identity, 'redisConnect', {
    essid: request.essid ?? ESSID,
    target_ip: request.target_ip,
    port: request.port ?? SERVICE_CATALOG.redis.defaultPort,
    source_ip: request.source_ip === undefined ? CLIENT_IP : request.source_ip,
  });

const arrivalLine = () =>
  formatRedisConnectLine({
    fromIp: CLIENT_IP,
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
  });

describe('opening a store', () => {
  it('opens it for a caller who sent no credential, and names the box that answered', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);
    const { deps } = makeDeps();

    const response = await handleRedisConnect(
      await signedConnect(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response).toEqual({ status: 200, body: { ok: true, hostname: host.hostname } });
  });

  it('opens a LOCKED store too, because the lock is on the questions, not the door', async () => {
    const identity = generateIdentity();
    const lan = generateHomeLan(ESSID);
    const locked = lan.hosts.filter((host) => runsService(host, SERVICE_CATALOG.redis));
    expect(locked.length).toBeGreaterThan(0);
    const { deps } = makeDeps();

    const opened = await Promise.all(
      locked.map(async (host) =>
        handleRedisConnect(await signedConnect(identity, { target_ip: host.ip }), deps),
      ),
    );

    // Every store-running box on the LAN opens, whether or not it holds a secret —
    // and roughly six in ten of them do.
    expect(opened.map((response) => response.status)).toEqual(locked.map(() => 200));
  });

  it('mints no session row — there is nothing here to authorize anything with', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);
    const { deps } = makeDeps();

    const response = await handleRedisConnect(
      await signedConnect(identity, { target_ip: host.ip }),
      deps,
    );

    expect(Object.keys(response.body)).toEqual(['ok', 'hostname']);
  });
});

describe('what the store cannot be reached through', () => {
  it('refuses the database port on a box that really is running a store elsewhere', async () => {
    const identity = generateIdentity();
    const host = twoDaemonHostOn(ESSID);
    const { deps } = makeDeps();

    const [onStorePort, onDatabasePort] = await Promise.all([
      handleRedisConnect(await signedConnect(identity, { target_ip: host.ip }), deps),
      handleRedisConnect(
        await signedConnect(identity, {
          target_ip: host.ip,
          port: SERVICE_CATALOG.mysql.defaultPort,
        }),
        deps,
      ),
    ]);

    // One box, one boot, one journal, two daemons — so the ONLY thing that can tell
    // these two answers apart is the service this door asked the reach for. mysqld
    // holding 3306 is not a store, and a shared reach that forgot to ask which daemon
    // would have opened one here.
    expect(onStorePort.status).toBe(200);
    expect(onDatabasePort).toEqual({ status: 404, body: { error: 'service_not_running' } });
  });

  it('refuses an address no host on the LAN answers to', async () => {
    const identity = generateIdentity();
    const { deps } = makeDeps();

    const response = await handleRedisConnect(
      await signedConnect(identity, { target_ip: '192.168.1.253' }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });

  it('writes nothing at all on a box it could not reach', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = makeDeps();

    await handleRedisConnect(await signedConnect(identity, { target_ip: '192.168.1.253' }), deps);

    // There is no machine to log on. A line written here would be a daemon's note
    // about a connection no daemon ever saw.
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

describe('the line the daemon leaves behind', () => {
  it('records the arrival on the TARGET, root-owned and readable by everyone on it', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const { deps, upsertPatch } = makeDeps();

    await handleRedisConnect(await signedConnect(identity, { target_ip: host.ip }), deps);

    expect(upsertPatch).toHaveBeenCalledWith({
      writer_key: identity.publicKeyHex,
      machine_id: machineId,
      path: REDIS_LOG_PATH,
      content: `${arrivalLine()}\n`,
      owner: REDIS_LOG_OWNER,
      permissions: REDIS_LOG_PERMISSIONS,
      node_type: 'file',
    });
  });

  it('writes ONE line per connection — an arrival, and no attempt beside it', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps();

    await handleRedisConnect(await signedConnect(identity, { target_ip: host.ip }), deps);

    // The database door writes an arrival and an attempt together, because it sends
    // the credential in the handshake. Nothing was attempted here — there was no
    // credential to attempt — so a second line would be recording a thing that did
    // not happen.
    const [written] = upsertPatch.mock.calls[0] ?? [];
    expect(written?.content).toBe(`${arrivalLine()}\n`);
    expect(upsertPatch).toHaveBeenCalledTimes(1);
  });

  it('appends to the log the box already has rather than replacing it', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);
    const earlier = '1234:M 08 Aug 2026 09:14:02.000 * Client connected from 10.0.0.9';
    const { deps, upsertPatch } = makeDeps({
      readRedisLog: async () => ({ data: { content: `${earlier}\n` }, error: null }),
    });

    await handleRedisConnect(await signedConnect(identity, { target_ip: host.ip }), deps);

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ content: `${earlier}\n${arrivalLine()}\n` }),
    );
  });

  it('records an arrival it was told no address for as coming from nowhere nameable', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps();

    await handleRedisConnect(
      await signedConnect(identity, { target_ip: host.ip, source_ip: null }),
      deps,
    );

    // The defender's evidence must not be a blank. On the caller's own LAN the route
    // knows nothing and the claim is all there is — so a caller who claims nothing is
    // written down as exactly that, rather than as an empty field that reads like a
    // line the daemon never finished.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Client connected from unknown') }),
    );
  });

  it('opens the store even when the line about it could not be written', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);
    const { deps } = makeDeps({
      upsertPatch: async () => ({ error: new Error('journal is down') }),
    });

    const response = await handleRedisConnect(
      await signedConnect(identity, { target_ip: host.ip }),
      deps,
    );

    // Best-effort, like every other door's trace: a connection that really happened
    // must not be undone by a note about it that did not.
    expect(response.status).toBe(200);
  });
});

describe('the request itself', () => {
  it('refuses a body nobody signed, as malformed rather than as unauthorized', async () => {
    const host = storeHostOn(ESSID);

    const response = await handleRedisConnect(
      {
        action: 'redisConnect',
        essid: ESSID,
        target_ip: host.ip,
        port: SERVICE_CATALOG.redis.defaultPort,
        source_ip: CLIENT_IP,
      },
      makeDeps().deps,
    );

    // No signature is not a bad signature: there is no envelope to check, so this is
    // refused by the shape of the request before any identity is in question.
    expect(response.status).toBe(400);
  });

  it('refuses a signed payload that is not the shape this door accepts', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);

    const response = await handleRedisConnect(
      // Signed by a real key, and still refused: the signature says who sent it, never
      // that what they sent means anything.
      await signRequest(identity, 'redisConnect', {
        essid: ESSID,
        target_ip: host.ip,
        port: 'six-three-seven-nine',
        source_ip: CLIENT_IP,
      }),
      makeDeps().deps,
    );

    expect(response.status).toBe(400);
    expect(response.body).not.toHaveProperty('hostname');
  });

  it('refuses a caller who stamps their own key onto the payload', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);
    const signed = await signedConnect(identity, { target_ip: host.ip });

    const response = await handleRedisConnect(
      { ...signed, player_key: generateIdentity().publicKeyHex },
      makeDeps().deps,
    );

    // The server stamps the key from the verified signature. A payload that names its
    // own is refused by the schema, not corrected.
    expect(response.status).toBe(400);
  });
});
