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
import { asAbsPath, asGameTime } from '../types';
import { formatPidfileContent, pidfilePath } from '../services/pidfile';
import { deepStoreFixture, playerStoreOn } from '../../test/factories/lanStore';
import { computeApGatewayId } from '../identity/router';
import { lanAddressFor, type LanLeaseRow } from '../network/lanAddress';
import { md5 } from '../generation/md5';
import { DATADIR_PATH } from '../redis/datadir';
import type { ApNetworkLookup, NatOccupantRow } from '../network/resolvePublicTarget';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
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

  it('refuses a payload that names its own player key, however well signed', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);
    // Signed properly, with the claim INSIDE the signed payload — so the signature is
    // valid and the envelope is untampered. Only the schema stands between a caller and
    // acting under a key that is not theirs.
    const signed = await signRequest(identity, 'redisConnect', {
      essid: ESSID,
      target_ip: host.ip,
      port: SERVICE_CATALOG.redis.defaultPort,
      source_ip: CLIENT_IP,
      player_key: generateIdentity().publicKeyHex,
    });

    const response = await handleRedisConnect(signed, makeDeps().deps);

    // The server stamps the key from the verified signature and never reads one the
    // payload offers. Refused outright rather than ignored: a request that tried is a
    // request whose other fields are not worth trusting either.
    expect(response.status).toBe(400);
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

// ─── a store on a hidden layer, reached the only way anything reaches one ───
//
// A deep box has no address on the LAN, so the gateway plus a port its owner forwarded
// is the whole of how it can be named at all. Everything below the forward is the
// server's: the forward table lives in the gateway's own journal, and the box at the
// end of the chain is one no client can look up.

const DEEP = deepStoreFixture({ locked: false });

/** Deliberately neither the store's port nor 22: the port a player opened on their
 *  GATEWAY has nothing to do with the port the daemon holds behind it. */
const FORWARD_PORT = 36379;

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

/** Journals per machine, because the chain walk asks for one machine at a time and a
 *  mock answering the same rows for every id would hand the gateway's forward table to
 *  the deep box as well. */
const journals = (rows: Readonly<Record<string, readonly OwnerPatchRow[]>>) =>
  vi.fn<RedisConnectDeps['findPatches']>(async ({ machine_id }) => ({
    data: rows[machine_id] ?? [],
    error: null,
  }));

/** The player's own root `nano /etc/iptables/rules.v4` on the gateway — the opt-in that
 *  exposes the layer at all. `deep` is whatever else has happened to the box down
 *  there since it was generated. */
const throughForward = (deep: readonly OwnerPatchRow[] = []) =>
  journals({
    [DEEP.gatewayMachineId]: [
      patchRow(
        '/etc/iptables/rules.v4',
        `forward ${FORWARD_PORT} to ${DEEP.layer.host.ip}:${DEEP.port}`,
      ),
    ],
    [DEEP.machineId]: deep,
  });

const openDeepStore = async (identity: ReturnType<typeof generateIdentity>, deps: RedisConnectDeps) =>
  handleRedisConnect(
    await signedConnect(identity, {
      essid: DEEP.essid,
      target_ip: DEEP.gateway.ip,
      port: FORWARD_PORT,
    }),
    deps,
  );

describe('a store on a hidden layer', () => {
  it('opens the box behind the forward, and names the box rather than the gateway', async () => {
    const identity = generateIdentity();
    const { deps } = makeDeps({ findPatches: throughForward() });

    const response = await openDeepStore(identity, deps);

    // Only the server can know that name: the deep box's address is absent from the
    // generated LAN, so there is nothing a client could have looked it up in.
    expect(response).toEqual({
      status: 200,
      body: { ok: true, hostname: DEEP.layer.host.hostname },
    });
  });

  it('records the arrival on the DEEP box, at the address NAT showed it', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = makeDeps({ findPatches: throughForward() });

    await openDeepStore(identity, deps);

    // Behind NAT the box only ever saw the fronting gateway's `.1`, whoever was behind
    // it. Writing the caller's own address here would put the defender's evidence and
    // the route in disagreement.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        machine_id: DEEP.machineId,
        path: REDIS_LOG_PATH,
        content: expect.stringContaining(`Client connected from ${DEEP.natIp}`),
      }),
    );
    expect(upsertPatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(CLIENT_IP) }),
    );
  });

  it('leaves the gateway with nothing written on it, because NAT does not log', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = makeDeps({ findPatches: throughForward() });

    await openDeepStore(identity, deps);

    // The gateway carried the packet and ran nothing. A row filed against it is a trace
    // pointing at the wrong box, which is worse for the defender than no trace at all.
    expect(upsertPatch).toHaveBeenCalled();
    expect(
      upsertPatch.mock.calls.every(([row]) => row.machine_id === DEEP.machineId),
    ).toBe(true);
  });

  it('refuses a deep box whose daemon was stopped through its own journal', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = makeDeps({
      findPatches: throughForward([patchRow(pidfilePath(SERVICE_CATALOG.redis), null)]),
    });

    const response = await openDeepStore(identity, deps);

    // The chain resolver hands back this box's SEEDED tree, where the daemon is still
    // up. Reading that would answer for a store the player has already stopped, so the
    // reach materializes the journal on top before it asks what is listening.
    expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a deep box bricked through its own journal', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = makeDeps({
      findPatches: throughForward([patchRow('/boot/vmlinuz', null)]),
    });

    const response = await openDeepStore(identity, deps);

    // A box with its kernel removed is dark to every tool, at any depth.
    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a port the gateway forwards to a daemon that is not the store', async () => {
    const identity = generateIdentity();
    const { deps } = makeDeps({
      findPatches: journals({
        [DEEP.gatewayMachineId]: [
          patchRow('/etc/iptables/rules.v4', `forward ${FORWARD_PORT} to ${DEEP.layer.host.ip}:22`),
        ],
      }),
    });

    const response = await openDeepStore(identity, deps);

    // A forward to sshd is not a door to the store behind it, however deep the box is.
    expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
  });
});

// ─── another player's store, reached the only way an outsider can reach one ───
//
// A public IP names an ACCESS POINT, never a machine, so the port is the whole of the
// address: the defender had to open a forward before their store existed to anyone
// outside. Everything below the forward is the server's — the occupancy row, the lease,
// the journal — because a client that could name a target box directly would be a
// client that could reach a box its owner never published.
//
// The store here is the one slice 6 plants: drawn from the defender's own key, locked
// to the root password in their own `/etc/passwd`. That lock is why nothing in this
// block is a walk-in — between players there is always a secret, so `AUTH` is always
// the next question.

const TARGET_PUBLIC_IP = '203.0.113.9';
const TARGET_ESSID = 'PIED-PIPER-GUEST';
const AP_GATEWAY_ID = computeApGatewayId(TARGET_ESSID);
const AP_NETWORK: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: TARGET_ESSID };

/** The attacker's own home address, as the server resolves it from their VERIFIED key.
 *  A cross-player log line is the defender's only evidence, so the address in it is
 *  never the one the client typed. */
const ATTACKER_PUBLIC_IP = '198.51.100.22';

const DEFENDER = generateIdentity();
const DEFENDER_OCTET = 84;
const DEFENDER_LAN_IP = lanAddressFor(TARGET_ESSID, DEFENDER_OCTET);
const DEFENDER_WS = 'workstation-c3d4e5f6';
const DEFENDER_HOSTNAME = 'nebuchadnezzar';
/** A password the PLAYER chose, so no wordlist the game hands out contains it. It is
 *  also this store's password, because slice 6 mirrors one onto the other — which is
 *  what puts the store out of a sweep's reach and inside the reach of whoever takes
 *  root. */
const DEFENDER_ROOT_PW = 'correct-horse-battery-staple';
const defenderOccupant: NatOccupantRow = {
  owner_key: DEFENDER.publicKeyHex,
  workstation_machine_id: DEFENDER_WS,
  workstation_machine_name: DEFENDER_HOSTNAME,
  workstation_username: 'neo',
  workstation_root_hash: md5(DEFENDER_ROOT_PW),
};
const DEFENDER_LEASES: readonly LanLeaseRow[] = [
  { owner_key: DEFENDER.publicKeyHex, octet: DEFENDER_OCTET },
];
const DEFENDER_STORE = playerStoreOn(defenderOccupant);

/** The port the defender published. Deliberately neither 6379 nor 22: on a public
 *  address the port is chosen by whoever wrote the forward. */
const PUBLIC_PORT = 46379;
const publicForward = (internalPort: number = SERVICE_CATALOG.redis.defaultPort): OwnerPatchRow =>
  patchRow('/etc/iptables/rules.v4', `forward ${PUBLIC_PORT} to ${DEFENDER_LAN_IP}:${internalPort}`);

/** The defender ran `apt install redis` and then `systemctl start redis`. A box that
 *  did neither has an empty `/var/run` and no datadir at all. */
const defenderRedisd = patchRow(
  pidfilePath(SERVICE_CATALOG.redis),
  formatPidfileContent(SERVICE_CATALOG.redis, SERVICE_CATALOG.redis.defaultPort),
);
const defenderDatadir = patchRow(DATADIR_PATH, JSON.stringify(DEFENDER_STORE));

const crossPlayerDeps = (over: Partial<RedisConnectDeps> = {}) =>
  makeDeps({
    findPatches: journals({
      [AP_GATEWAY_ID]: [publicForward()],
      [DEFENDER_WS]: [defenderRedisd, defenderDatadir],
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

const openAcrossTheWorld = async (
  identity: ReturnType<typeof generateIdentity>,
  deps: RedisConnectDeps,
  port: number = PUBLIC_PORT,
) =>
  handleRedisConnect(
    await signedConnect(identity, { essid: TARGET_ESSID, target_ip: TARGET_PUBLIC_IP, port }),
    deps,
  );

describe("another player's store, reached by their public address", () => {
  it('opens on the box behind the forward, and names the box rather than the access point', async () => {
    const identity = generateIdentity();
    const { deps } = crossPlayerDeps();

    const response = await openAcrossTheWorld(identity, deps);

    // The address named an access point. Which machine answered is something only the
    // forward table knows, so the name coming back is the one thing here the client
    // could not have looked up for itself.
    expect(response).toEqual({ status: 200, body: { ok: true, hostname: DEFENDER_HOSTNAME } });
  });

  it("records the arrival on the defender's own box, under the DEFENDER's key", async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = crossPlayerDeps();

    await openAcrossTheWorld(identity, deps);

    // `patches` is keyed (machine_id, path, writer_key). A row per attacker would fold
    // to whichever was written last, so the defender's log would keep only the most
    // recent stranger and silently drop the rest.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: DEFENDER.publicKeyHex,
        machine_id: DEFENDER_WS,
        path: REDIS_LOG_PATH,
      }),
    );
  });

  it('writes the address the SERVER derived, never the one the client typed', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = crossPlayerDeps();

    await openAcrossTheWorld(identity, deps);

    // A defender's log is their evidence, and evidence a client can write is none. The
    // attacker's own public address is resolved from their VERIFIED key.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(`Client connected from ${ATTACKER_PUBLIC_IP}`),
      }),
    );
    expect(upsertPatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(CLIENT_IP) }),
    );
  });

  it('never answers from the generated world the caller can regenerate for itself', async () => {
    const identity = generateIdentity();
    // Nobody has registered this address. If the reach fell through to the caller's own
    // LAN it would find the seeded store host sitting on that essid and open it —
    // handing the player somebody else's box under a stranger's name.
    const { deps, upsertPatch } = crossPlayerDeps({
      findNetworkByPublicIp: async () => ({ data: null, error: null }),
    });

    const response = await openAcrossTheWorld(identity, deps);

    expect(response.status).toBe(404);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a forward that reaches a live port the store is not the one holding', async () => {
    const identity = generateIdentity();
    const { deps } = crossPlayerDeps({
      findPatches: journals({
        [AP_GATEWAY_ID]: [publicForward(22)],
        [DEFENDER_WS]: [
          defenderRedisd,
          defenderDatadir,
          patchRow(pidfilePath(SERVICE_CATALOG.ssh), formatPidfileContent(SERVICE_CATALOG.ssh, 22)),
        ],
      }),
    });

    const response = await openAcrossTheWorld(identity, deps);

    // The port IS the address. A forward to sshd is not a door to the store, even on a
    // box plainly running one — and the daemon really is up on the other end, so this
    // is the service check refusing rather than the route failing to find anything.
    expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
  });

  it('refuses a defender who bought the store but never started it, as simple silence', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = crossPlayerDeps({
      findPatches: journals({
        [AP_GATEWAY_ID]: [publicForward()],
        [DEFENDER_WS]: [defenderDatadir],
      }),
    });

    const response = await openAcrossTheWorld(identity, deps);

    // Unreachable rather than not-running, and deliberately — the database door's rule
    // on the same address. From outside somebody else's NAT a forward onto a dead port
    // and a forward that was never opened are the same silence, which is all the
    // gateway can actually observe. A door that told them apart would tell an outsider
    // which services a box behind the NAT has stopped.
    //
    // This is where a deep box and a stranger's box deliberately part: down a chain of
    // one's own gateways the same case answers `service_not_running`, because there the
    // player is inside the network and asking about their own layer.
    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a defender whose box will not boot, before anything is asked of it', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = crossPlayerDeps({
      findPatches: journals({
        [AP_GATEWAY_ID]: [publicForward()],
        [DEFENDER_WS]: [defenderRedisd, defenderDatadir, patchRow('/boot/vmlinuz', null)],
      }),
    });

    const response = await openAcrossTheWorld(identity, deps);

    // A bricked box is dark to every door. Nothing is written on a machine that cannot
    // come up.
    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

// ─── the same WiFi: a fellow occupant's box, with nothing in between ───
//
// No router, no NAT, no forward — two boxes on one LAN, so the address IS the box.
// Which makes the whole reach the occupancy table: the caller must be ON the WiFi to
// reach anything on it, the target must still be on it, and the address each answers to
// is the LEASE the server issued rather than anything either client claims. It is also
// why `nmcli disconnect` is a defence on this vantage and nothing like it is across NAT:
// there, leaving the WiFi closes a forward; here, it removes the box.

const ATTACKER_OCTET = 61;
const ATTACKER_LAN_IP = lanAddressFor(ESSID, ATTACKER_OCTET);
const DEFENDER_SAME_LAN_IP = lanAddressFor(ESSID, DEFENDER_OCTET);

/** A generated sibling running a store of its own, and the octet it stands on. A lease
 *  can land there too — nothing stops the server issuing an occupant the address a
 *  seeded box already fills — which is the collision the merge settles. */
const NPC_STORE_HOST = storeHostOn(ESSID);
const NPC_STORE_OCTET = Number(NPC_STORE_HOST.ip.split('.')[3]);

const attackerOccupant = (attackerKey: string): NatOccupantRow => ({
  owner_key: attackerKey,
  workstation_machine_id: 'workstation-a1b2c3d4',
  workstation_machine_name: 'trinity-box',
  workstation_username: 'trinity',
  workstation_root_hash: md5('a-different-password'),
});

/** Both players on one ESSID, each holding their own lease — the defender's box the only
 *  one with a journal, since the attacker never has to be rebuilt to be attacked from. */
const sameLanDeps = (
  attackerKey: string,
  options: {
    readonly defenderOctet?: number;
    readonly occupants?: readonly NatOccupantRow[];
    readonly over?: Partial<RedisConnectDeps>;
  } = {},
) =>
  makeDeps({
    findPatches: journals({ [DEFENDER_WS]: [defenderRedisd, defenderDatadir] }),
    listOccupantsByEssid: async () => ({
      data: options.occupants ?? [defenderOccupant, attackerOccupant(attackerKey)],
      error: null,
    }),
    listLeasesByEssid: async () => ({
      data: [
        { owner_key: DEFENDER.publicKeyHex, octet: options.defenderOctet ?? DEFENDER_OCTET },
        { owner_key: attackerKey, octet: ATTACKER_OCTET },
      ] as readonly LanLeaseRow[],
      error: null,
    }),
    ...options.over,
  });

const openNextDoor = async (
  identity: ReturnType<typeof generateIdentity>,
  deps: RedisConnectDeps,
  targetIp: string = DEFENDER_SAME_LAN_IP,
) => handleRedisConnect(await signedConnect(identity, { target_ip: targetIp }), deps);

describe('a fellow occupant, on the WiFi they are both connected to', () => {
  it('opens their store with nothing in between to pass through', async () => {
    const identity = generateIdentity();
    const { deps } = sameLanDeps(identity.publicKeyHex);

    const response = await openNextDoor(identity, deps);

    // The name is the workstation name every occupant of this LAN already sees — the
    // one thing here the caller could have looked up, and still the one that proves a
    // real box answered rather than the sibling the generator would have drawn.
    expect(response).toEqual({ status: 200, body: { ok: true, hostname: DEFENDER_HOSTNAME } });
  });

  it("records the arrival at the address the LEASE says, under the DEFENDER's key", async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = sameLanDeps(identity.publicKeyHex);

    await openNextDoor(identity, deps);

    // A defender's log is their evidence. On this vantage the address is a LEASE rather
    // than a NAT address, because there is nothing in between to rewrite it — the box
    // really did see the caller's own address on the WiFi they share.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: DEFENDER.publicKeyHex,
        machine_id: DEFENDER_WS,
        path: REDIS_LOG_PATH,
        content: expect.stringContaining(`Client connected from ${ATTACKER_LAN_IP}`),
      }),
    );
    expect(upsertPatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(CLIENT_IP) }),
    );
  });

  it('answers as the player who took over an address the generator also filled', async () => {
    const identity = generateIdentity();
    const { deps } = sameLanDeps(identity.publicKeyHex, { defenderOctet: NPC_STORE_OCTET });

    const response = await openNextDoor(identity, deps, NPC_STORE_HOST.ip);

    // A real occupant beats a generated sibling on one octet — the precedence `nmap`,
    // `ssh` and `nc` already answer by. The sibling is not merely outranked, it is GONE
    // from that address, which is what separates a merge from a fallback.
    expect(response).toEqual({ status: 200, body: { ok: true, hostname: DEFENDER_HOSTNAME } });
  });

  it('reaches nothing on a WiFi the caller is not on', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = sameLanDeps(identity.publicKeyHex, {
      occupants: [defenderOccupant],
    });

    const response = await openNextDoor(identity, deps);

    // The LAN boundary: you reach a box on a WiFi by being on that WiFi. A caller with
    // no occupancy row is shown the generated world, which has nobody at this address.
    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('loses the box when its owner leaves the WiFi, lease or no lease', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = sameLanDeps(identity.publicKeyHex, {
      occupants: [attackerOccupant(identity.publicKeyHex)],
    });

    const response = await openNextDoor(identity, deps);

    // Occupancy IS the reach here, so `nmcli disconnect` takes the box off the LAN even
    // though its lease is still held. Nothing across NAT behaves like this.
    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses rather than falling through when the occupancy read fails', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = sameLanDeps(identity.publicKeyHex, {
      over: { listOccupantsByEssid: async () => ({ data: null, error: new Error('offline') }) },
    });

    const response = await openNextDoor(identity, deps);

    // Quietly dropping to the generated world would route the caller onto a seeded box
    // standing where a real player is, and write their data to it.
    expect(response).toEqual({ status: 500, body: { error: 'occupants_lookup_failed' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses rather than falling through when the lease read fails', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = sameLanDeps(identity.publicKeyHex, {
      over: { listLeasesByEssid: async () => ({ data: null, error: new Error('offline') }) },
    });

    const response = await openNextDoor(identity, deps);

    // An address that cannot be read is never derived as a fallback: a derivation cannot
    // know what OTHER identities were issued, which is the drift the lease store exists
    // to end.
    expect(response).toEqual({ status: 500, body: { error: 'leases_lookup_failed' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('reads an answer that carries no rows as nobody being there', async () => {
    const identity = generateIdentity();
    const { deps } = sameLanDeps(identity.publicKeyHex, {
      over: { listOccupantsByEssid: async () => ({ data: null, error: null }) },
    });

    const response = await openNextDoor(identity, deps);

    // Asserting the shape of "no rows" rather than a rule of the game: the store answers
    // an empty read with `[]`, so this is the type's other branch being handled rather
    // than a state the game reaches. Without the fallback the read throws instead.
    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });

  it('reads a lease answer that carries no rows as nobody being addressed', async () => {
    const identity = generateIdentity();
    const { deps } = sameLanDeps(identity.publicKeyHex, {
      over: { listLeasesByEssid: async () => ({ data: null, error: null }) },
    });

    const response = await openNextDoor(identity, deps);

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });
});

/**
 * A box that filters its own store port stops serving it to the LAN, and goes on
 * serving it to itself.
 *
 * Nothing in this door knows about the filter. The reach every data door shares reads
 * it once, which is why the store, the database and the agent all answer a filtered
 * port the same way and cannot drift apart later.
 */
describe('a box that filters the port its store answers on', () => {
  const filtering = (rules: string): Partial<RedisConnectDeps> => ({
    findPatches: async () => ({ data: [patchRow('/etc/iptables/rules.v4', rules)], error: null }),
  });

  it('refuses a neighbour exactly as a stopped daemon refuses them', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);

    const filtered = makeDeps(filtering(`deny ${SERVICE_CATALOG.redis.defaultPort}\n`));
    const refused = await handleRedisConnect(
      await signedConnect(identity, { target_ip: host.ip }),
      filtered.deps,
    );

    const stopped = makeDeps({
      findPatches: async () => ({
        data: [patchRow(pidfilePath(SERVICE_CATALOG.redis), null)],
        error: null,
      }),
    });
    const silent = await handleRedisConnect(
      await signedConnect(identity, { target_ip: host.ip }),
      stopped.deps,
    );

    // Word for word, so the filter is no oracle: a caller who could tell these apart
    // would learn which boxes are defended and therefore worth attacking.
    expect(refused).toEqual(silent);
    expect(refused).toEqual({ status: 404, body: { error: 'service_not_running' } });
  });

  it('goes on answering the ports its owner left open', async () => {
    const identity = generateIdentity();
    const host = storeHostOn(ESSID);
    const { deps } = makeDeps(filtering('deny 8080\n'));

    const response = await handleRedisConnect(
      await signedConnect(identity, { target_ip: host.ip }),
      deps,
    );

    expect(response.status).toBe(200);
  });
});
