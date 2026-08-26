import { describe, expect, it, vi } from 'vitest';
import { handleRedisStatement, type RedisStatementDeps } from './redisStatement';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { hostServices } from '../generation/remoteHostFs';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { DATADIR_PATH } from '../redis/datadir';
import { DATADIR_FILE } from '../generation/baseFs';
import { ALL_GENERATED_PASSWORDS } from '../generation/passwordPools';
import { md5 } from '../generation/md5';
import {
  formatRedisAttemptLine,
  formatRedisMutationLine,
  REDIS_LOG_OWNER,
  REDIS_LOG_PATH,
  REDIS_LOG_PERMISSIONS,
} from '../logging/redisLog';
import { derivePid } from '../logging/syslog';
import { asGameTime } from '../types';
import { parseRedisStore, redisStoreSchema } from '../redis/types';
import { asAbsPath } from '../types';
import { formatPidfileContent, pidfilePath } from '../services/pidfile';
import {
  deepStoreFixture,
  playerStoreOn,
  type DeepStoreFixture,
} from '../../test/factories/lanStore';
import { computeApGatewayId } from '../identity/router';
import { lanAddressFor, type LanLeaseRow } from '../network/lanAddress';
import type { ApNetworkLookup, NatOccupantRow } from '../network/resolvePublicTarget';
import type { Directory } from '../filesystem/types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleRedisStatement` answers one question against a box's REAL store — journal
 * replayed over the seeded base, the same file `cat` shows to root.
 *
 * There is no credential to re-send, so what is re-established per statement is the
 * REACH: is the box still there, does it still boot, is the daemon still holding the
 * port. That repeat is the whole eviction mechanism — with no session row to
 * invalidate, a player who has been shut out can only discover it by asking again.
 *
 * Two things are load-bearing here beyond the answers themselves. A locked store
 * discloses NOTHING through this door, which is the wall that stands until the verb
 * that opens it lands. And a session of reads writes NOTHING — no datadir row, no log
 * line — which is a rule rather than a structure now, and so has to be a test: the
 * write verbs arrive next, and the rule that separates them can only be trusted if it
 * was already being watched before they did.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
/** The one LAN in the world that seeds BOTH shapes of store — `portal-41` open and
 *  `nginx-188` locked. Chosen so the locked case is the generator's own output rather
 *  than a lock this test planted, which is the difference between proving the door and
 *  proving the fixture. */
const ESSID = 'NACHO-WIFI';
const CLIENT_IP = '192.168.1.50';
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);

const storeHostsOn = (essid: string): readonly LanHost[] =>
  generateHomeLan(essid).hosts.filter(
    (candidate) =>
      candidate.kind === 'machine' &&
      hostServices(essid, candidate).some(({ spec }) => spec === SERVICE_CATALOG.redis),
  );

const fileOn = (host: LanHost, segments: readonly string[]): string | undefined => {
  const parent = segments.slice(0, -1).reduce<Directory | undefined>((node, segment) => {
    const next = node?.entries.get(segment);
    return next !== undefined && next.kind === 'directory' ? next : undefined;
  }, resolveLanHostIdentity(host, ESSID).baseFs);
  const leaf = parent?.entries.get(segments.at(-1) ?? '');
  return leaf !== undefined && leaf.kind === 'file' ? leaf.content : undefined;
};

const storeOn = (host: LanHost) => {
  const raw = fileOn(host, ['var', 'lib', 'redis', 'data.json']);
  const store = raw === undefined ? null : parseRedisStore(raw);
  if (store === null) throw new Error(`no store on ${host.hostname}`);
  return store;
};

/** A generated box whose store is OPEN — the four in ten a player can just read. */
const openStoreHostOn = (essid: string): LanHost => {
  const host = storeHostsOn(essid).find((candidate) => storeOn(candidate).requirepassHash === null);
  if (host === undefined) throw new Error('no open store on LAN');
  return host;
};

/** And one the generator locked, which is the majority case. */
const lockedStoreHostOn = (essid: string): LanHost => {
  const host = storeHostsOn(essid).find((candidate) => storeOn(candidate).requirepassHash !== null);
  if (host === undefined) throw new Error('no locked store on LAN');
  return host;
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

const makeDeps = (over: Partial<RedisStatementDeps> = {}) => {
  const findPatches = vi.fn<RedisStatementDeps['findPatches']>(async () => ({
    data: [],
    error: null,
  }));
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readRedisLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(
    async () => ({ data: null, error: null }),
  );
  const deps: RedisStatementDeps = {
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

/** The plaintext behind a generated store's lock. Every secret in this world is drawn
 *  from one of the two pools, so a hash with no plaintext among them would mean the
 *  generator and the door had stopped agreeing about what a store's password IS —
 *  which is the thing the sweep against one depends on. */
const plaintextOf = (hash: string): string => {
  const password = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === hash);
  if (password === undefined) throw new Error('a generated store holds a secret from no pool');
  return password;
};

const attemptLine = (outcome: 'success' | 'failure', hostname: string) =>
  formatRedisAttemptLine({
    outcome,
    user: '',
    fromIp: CLIENT_IP,
    hostname,
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
  });

const signedStatement = (
  identity: ReturnType<typeof generateIdentity>,
  request: {
    readonly target_ip: string;
    readonly statement: string;
    readonly essid?: string;
    readonly port?: number;
    readonly password?: string;
    readonly source_ip?: string | null;
  },
) =>
  signRequest(identity, 'redisStatement', {
    essid: request.essid ?? ESSID,
    target_ip: request.target_ip,
    port: request.port ?? SERVICE_CATALOG.redis.defaultPort,
    statement: request.statement,
    ...(request.password === undefined ? {} : { password: request.password }),
    source_ip: request.source_ip === undefined ? CLIENT_IP : request.source_ip,
  });

describe('what the request may not claim', () => {
  it('refuses a payload that names its own player key, however well signed', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    // Signed properly, with the claim INSIDE the signed payload, so nothing about the
    // envelope is wrong. The schema is the only thing standing between a caller and
    // asking questions under somebody else's key.
    const signed = await signRequest(identity, 'redisStatement', {
      essid: ESSID,
      target_ip: host.ip,
      port: SERVICE_CATALOG.redis.defaultPort,
      statement: 'KEYS *',
      source_ip: CLIENT_IP,
      player_key: generateIdentity().publicKeyHex,
    });

    const response = await handleRedisStatement(signed, makeDeps().deps);

    expect(response.status).toBe(400);
  });
});

describe('asking an open store a question', () => {
  it('answers with what the box actually holds', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const keys = Object.keys(storeOn(host).keys);
    const { deps } = makeDeps();

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'KEYS *' }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      output: keys.map((key, index) => `${index + 1}) "${key}"`),
      failed: false,
    });
  });

  it('reads the store the JOURNAL leaves, not the one the generator seeded', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const edited = redisStoreSchema.parse({
      keys: { 'sess:planted-by-hand': 'somebody edited this file as root' },
      requirepassHash: null,
    });
    const { deps } = makeDeps({
      findPatches: async ({ machine_id }) => ({
        data: machine_id === machineId ? [patchRow(DATADIR_PATH, JSON.stringify(edited))] : [],
        error: null,
      }),
    });

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'KEYS *' }),
      deps,
    );

    // The datadir is root-owned, and root on a box is a tier a player reaches. A door
    // reading a locally regenerated baseline would answer with keys the player can see
    // are no longer in the file.
    expect(response.body).toEqual({ output: ['1) "sess:planted-by-hand"'], failed: false });
  });

  it('sends back rendered text and never the store itself', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const { deps } = makeDeps();

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'DBSIZE' }),
      deps,
    );

    // A body carrying the store would hand this client every value the caller never
    // asked for, in a field the terminal never draws and anyone watching the wire can
    // read.
    expect(Object.keys(response.body).sort()).toEqual(['failed', 'output']);
  });
});

describe('asking a locked store a question', () => {
  it('discloses nothing at all, whatever is asked', async () => {
    const identity = generateIdentity();
    const host = lockedStoreHostOn(ESSID);
    const holds = Object.keys(storeOn(host).keys);
    expect(holds.length).toBeGreaterThan(0);
    const { deps } = makeDeps();

    const asked = await Promise.all(
      ['KEYS *', `GET ${holds[0]}`, 'DBSIZE'].map(async (statement) =>
        handleRedisStatement(await signedStatement(identity, { target_ip: host.ip, statement }), deps),
      ),
    );

    // The box really does hold keys — the refusal is the door's, not an empty store's.
    expect(asked.map((response) => response.body)).toEqual(
      asked.map(() => ({ output: ['(error) NOAUTH Authentication required.'], failed: true })),
    );
  });

  it('gives a locked store the same refusal for a key it holds and one it does not', async () => {
    const identity = generateIdentity();
    const host = lockedStoreHostOn(ESSID);
    const held = Object.keys(storeOn(host).keys)[0] ?? '';
    const { deps } = makeDeps();

    const [real, imagined] = await Promise.all(
      [held, 'sess:no-such-key'].map(async (key) =>
        handleRedisStatement(
          await signedStatement(identity, { target_ip: host.ip, statement: `GET ${key}` }),
          deps,
        ),
      ),
    );

    expect(real?.body).toEqual(imagined?.body);
  });
});

describe('what a statement leaves behind', () => {
  it('writes NOTHING for a session of reads — not a row, not a line', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps();

    const quiet = [
      'KEYS *',
      'GET nothing:here',
      'DBSIZE',
      'wat',
      // The two that LOOK like writes and are not. A verb keyed on its own name rather
      // than on what it did would file both, handing a defender an intruder to chase
      // who changed nothing on the box.
      'DEL nothing:here',
      'SET missing-its-value',
    ];

    for (const statement of quiet) {
      await handleRedisStatement(
        await signedStatement(identity, { target_ip: host.ip, statement }),
        deps,
      );
    }

    // The rule the write verbs are measured against: mutations append, reads never.
    // It was watched from before the first write existed, which is what makes it a rule
    // the writes had to fit rather than one they could quietly have broken.
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

describe('the request itself', () => {
  it('refuses a body nobody signed', async () => {
    const host = openStoreHostOn(ESSID);

    const response = await handleRedisStatement(
      {
        action: 'redisStatement',
        essid: ESSID,
        target_ip: host.ip,
        port: SERVICE_CATALOG.redis.defaultPort,
        statement: 'KEYS *',
        source_ip: CLIENT_IP,
      },
      makeDeps().deps,
    );

    expect(response.status).toBe(400);
    expect(response.body).not.toHaveProperty('output');
  });

  it('refuses a signed payload with no statement in it at all', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);

    const response = await handleRedisStatement(
      await signRequest(identity, 'redisStatement', {
        essid: ESSID,
        target_ip: host.ip,
        port: SERVICE_CATALOG.redis.defaultPort,
        source_ip: CLIENT_IP,
      }),
      makeDeps().deps,
    );

    expect(response.status).toBe(400);
    expect(response.body).not.toHaveProperty('output');
  });

  it('refuses a caller who stamps their own key onto the payload', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const signed = await signedStatement(identity, { target_ip: host.ip, statement: 'KEYS *' });

    const response = await handleRedisStatement(
      { ...signed, player_key: generateIdentity().publicKeyHex },
      makeDeps().deps,
    );

    expect(response.status).toBe(400);
  });
});

describe('a box that stopped answering', () => {
  it('refuses once the daemon is no longer holding the port', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const { deps } = makeDeps({
      // `systemctl stop redis` removes the pidfile, and the journal is where that
      // removal lives.
      findPatches: async ({ machine_id }) => ({
        data: machine_id === machineId ? [patchRow('/var/run/redis.pid', null)] : [],
        error: null,
      }),
    });

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'KEYS *' }),
      deps,
    );

    // There is no session row to invalidate, so the next statement is the only thing
    // that can discover this — which is exactly why the reach is re-established here
    // rather than trusted from the connection.
    expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
  });

  it('refuses an address no host on the LAN answers to', async () => {
    const identity = generateIdentity();
    const { deps } = makeDeps();

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: '192.168.1.253', statement: 'KEYS *' }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });
});

describe('producing a locked store secret', () => {
  it('answers its reads once the statement carries the password', async () => {
    const identity = generateIdentity();
    const host = lockedStoreHostOn(ESSID);
    const store = storeOn(host);
    const password = plaintextOf(store.requirepassHash ?? '');
    const { deps } = makeDeps();

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'KEYS *', password }),
      deps,
    );

    expect(response.body).toEqual({
      output: Object.keys(store.keys).map((key, index) => `${index + 1}) "${key}"`),
      failed: false,
    });
  });

  it('refuses a statement carrying the wrong password exactly as it refuses one carrying none', async () => {
    const identity = generateIdentity();
    const host = lockedStoreHostOn(ESSID);
    const { deps } = makeDeps();

    const [wrong, none] = await Promise.all([
      handleRedisStatement(
        await signedStatement(identity, {
          target_ip: host.ip,
          statement: 'DBSIZE',
          password: 'not-the-one',
        }),
        deps,
      ),
      handleRedisStatement(
        await signedStatement(identity, { target_ip: host.ip, statement: 'DBSIZE' }),
        deps,
      ),
    ]);

    expect(wrong?.body).toEqual({
      output: ['(error) NOAUTH Authentication required.'],
      failed: true,
    });
    expect(none?.body).toEqual(wrong?.body);
  });

  it('accepts the password and records the attempt on the TARGET, root-owned', async () => {
    const identity = generateIdentity();
    const host = lockedStoreHostOn(ESSID);
    const password = plaintextOf(storeOn(host).requirepassHash ?? '');
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const { deps, upsertPatch } = makeDeps();

    const response = await handleRedisStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        statement: `AUTH ${password}`,
        password,
      }),
      deps,
    );

    expect(response.body).toEqual({ output: ['OK'], failed: false });
    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(upsertPatch).toHaveBeenCalledWith({
      writer_key: identity.publicKeyHex,
      machine_id: machineId,
      path: REDIS_LOG_PATH,
      content: `${attemptLine('success', host.hostname)}\n`,
      owner: REDIS_LOG_OWNER,
      permissions: REDIS_LOG_PERMISSIONS,
      node_type: 'file',
    });
  });

  it('records a refused attempt too, appended to what the log already held', async () => {
    const identity = generateIdentity();
    const host = lockedStoreHostOn(ESSID);
    const earlier = '4470:M 09 Aug 2026 11:00:00.000 * Client connected from 10.0.0.9';
    const { deps, upsertPatch } = makeDeps({
      readRedisLog: async () => ({ data: { content: `${earlier}\n` }, error: null }),
    });

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'AUTH guesswork' }),
      deps,
    );

    // The wall of failures IS the defender's evidence, so a guess must accrete onto
    // the box's history rather than replace it.
    expect(response.body).toEqual({ output: ['(error) ERR invalid password'], failed: true });
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${earlier}\n${attemptLine('failure', host.hostname)}\n`,
      }),
    );
  });

  it('records nothing for an AUTH at a store that holds no secret', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps();

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'AUTH anything' }),
      deps,
    );

    // Nothing was weighed. A line here would tell a defender somebody tried to get past
    // a lock their box does not have.
    expect(response.body).toEqual({
      output: ['(error) ERR Client sent AUTH, but no password is set'],
      failed: true,
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses the next statement once the store secret has changed under it', async () => {
    const identity = generateIdentity();
    const host = lockedStoreHostOn(ESSID);
    const store = storeOn(host);
    const password = plaintextOf(store.requirepassHash ?? '');
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const rekeyed = redisStoreSchema.parse({
      keys: store.keys,
      requirepassHash: md5('somebody-changed-it'),
    });
    const { deps } = makeDeps({
      findPatches: async ({ machine_id }) => ({
        data: machine_id === machineId ? [patchRow(DATADIR_PATH, JSON.stringify(rekeyed))] : [],
        error: null,
      }),
    });

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'KEYS *', password }),
      deps,
    );

    // Nothing here remembers that this caller was ever let in, which is what makes a
    // defender changing the password an eviction rather than a note for next time.
    expect(response.body).toEqual({
      output: ['(error) NOAUTH Authentication required.'],
      failed: true,
    });
  });

  it('keeps the judgement itself off the wire', async () => {
    const identity = generateIdentity();
    const host = lockedStoreHostOn(ESSID);
    const password = plaintextOf(storeOn(host).requirepassHash ?? '');
    const { deps } = makeDeps();

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: `AUTH ${password}` }),
      deps,
    );

    // What the target recorded is the target's. The client is told what a terminal
    // prints and nothing beside it.
    expect(Object.keys(response.body).sort()).toEqual(['failed', 'output']);
  });

  it('still writes nothing for reads, even carrying a password that opens the store', async () => {
    const identity = generateIdentity();
    const host = lockedStoreHostOn(ESSID);
    const password = plaintextOf(storeOn(host).requirepassHash ?? '');
    const { deps, upsertPatch } = makeDeps();

    for (const statement of ['KEYS *', 'GET nothing:here', 'DBSIZE']) {
      await handleRedisStatement(
        await signedStatement(identity, { target_ip: host.ip, statement, password }),
        deps,
      );
    }

    // Learning to write for one verb must not have made reads noisy: against an open
    // store the arrival line is still the defender's only evidence of a theft.
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

/**
 * What a statement CHANGES, and what the box keeps about it.
 *
 * The door's first write with nothing behind it. An open store takes a `SET` from
 * whoever reached it — no account named, no tier, no credential produced — so the two
 * rows this handler writes are the entire consequence: the store as it now stands, and
 * one line in a file the box's own accounts can read saying who did it.
 *
 * The rule the reads have been measured against since the door opened stays exactly
 * where it was. It just stops being a fact about the handler and becomes a fact about
 * the verbs: mutations append, reads never, and a write that turned out to write
 * nothing is a read.
 */
describe('changing a store through the door', () => {
  const rowsAt = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch'], path: string) =>
    upsertPatch.mock.calls.map(([row]) => row).filter((row) => row.path === path);

  it('persists the whole store, root-owned, under the target own writer key', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const before = storeOn(host);
    const { deps, upsertPatch } = makeDeps();

    const response = await handleRedisStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        // Unquoted, because a generated session value carries no spaces and every
        // quote in it is its own. Quotes are for values that need a space, and a
        // quoted run cannot itself contain one.
        statement: 'SET sess:planted {"username":"intruder"}',
      }),
      deps,
    );

    expect(response).toEqual({ status: 200, body: { output: ['OK'], failed: false } });

    const [written] = rowsAt(upsertPatch, DATADIR_PATH);
    expect(written).toMatchObject({
      machine_id: machineId,
      path: DATADIR_PATH,
      // The literal rather than the constant: `owner: DATADIR_OWNER` agrees with that
      // constant whatever it comes to say, and root IS the claim here — a store written
      // back under any other owner is one the daemon that serves it cannot read.
      owner: 'root',
      // Re-stated rather than inherited: a rewrite must not be able to widen the one
      // file on the box that holds a hash a sweep has to work for.
      permissions: DATADIR_FILE,
      node_type: 'file',
    });
    expect(parseRedisStore(written?.content ?? '')).toEqual({
      keys: { ...before.keys, 'sess:planted': '{"username":"intruder"}' },
      requirepassHash: before.requirepassHash,
    });
  });

  it('appends what was done to the box own log, beside the arrival lines', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    const { deps, upsertPatch } = makeDeps();

    await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'SET greeting hello' }),
      deps,
    );

    const [logged] = rowsAt(upsertPatch, REDIS_LOG_PATH);
    expect(logged).toMatchObject({
      // The box it happened ON, named explicitly: `patches` is keyed on
      // (machine_id, path, writer_key), so a line filed against the wrong machine is a
      // line the defender never finds and every assertion about its CONTENT still passes.
      machine_id: machineId,
      path: REDIS_LOG_PATH,
      owner: REDIS_LOG_OWNER,
      permissions: REDIS_LOG_PERMISSIONS,
    });
    expect(logged?.content).toContain(
      formatRedisMutationLine({
        detail: 'SET greeting "hello"',
        fromIp: CLIENT_IP,
        time: asGameTime(FIXED_NOW),
        pid: derivePid(FIXED_NOW),
      }),
    );
  });

  it('writes a change it can name no address for as coming from nowhere nameable', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps();

    await handleRedisStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        statement: 'SET greeting hello',
        source_ip: null,
      }),
      deps,
    );

    // On the caller's own LAN the route knows nothing, so the address is the client's to
    // state — and a client may state none. The line is still written, because a defender
    // reading their own log needs to see that the key changed even when the visitor
    // cannot be placed. The connect door already answers this way; both rungs of the
    // same fallback belong to both doors.
    const [logged] = rowsAt(upsertPatch, REDIS_LOG_PATH);
    expect(logged?.content).toContain('unknown');
  });

  it('accretes onto the log the box already held rather than replacing it', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps({
      readRedisLog: vi.fn(async () => ({
        data: { content: 'a line the box already held' },
        error: null,
      })),
    });

    await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'SET greeting hello' }),
      deps,
    );

    expect(rowsAt(upsertPatch, REDIS_LOG_PATH)[0]?.content).toContain(
      'a line the box already held',
    );
  });

  it('removes a key and records the removal, without recording a removal that missed', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const held = Object.keys(storeOn(host).keys)[0] ?? '';
    const { deps: hitDeps, upsertPatch: hitPatch } = makeDeps();
    const { deps: missDeps, upsertPatch: missPatch } = makeDeps();

    const hit = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: `DEL ${held}` }),
      hitDeps,
    );
    const miss = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'DEL sess:never-existed' }),
      missDeps,
    );

    expect(hit.body).toEqual({ output: ['(integer) 1'], failed: false });
    expect(rowsAt(hitPatch, DATADIR_PATH)).toHaveLength(1);
    expect(rowsAt(hitPatch, REDIS_LOG_PATH)).toHaveLength(1);

    // A key the store never held is a write verb that wrote nothing. Persisting an
    // unchanged store and filing a line about a removal that did not happen would give
    // a defender an intruder to chase who had changed nothing.
    expect(miss.body).toEqual({ output: ['(integer) 0'], failed: false });
    expect(missPatch).not.toHaveBeenCalled();
  });

  it('never reports OK for a change that could not be stored', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const { deps, upsertPatch } = makeDeps({
      upsertPatch: vi.fn(async () => ({ error: { message: 'the row was rejected' } })),
    });

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'SET greeting hello' }),
      deps,
    );

    // The client turns any non-200 into `lost`, so the player is dropped rather than
    // told their write landed. Telling somebody OK about a change that did not happen
    // is the one answer this door must never give.
    expect(response).toEqual({ status: 500, body: { error: 'datadir_write_failed' } });
    // And no line claiming a change that was never stored.
    expect(rowsAt(upsertPatch, REDIS_LOG_PATH)).toHaveLength(0);
  });

  it('refuses a write to a locked store, and takes it once the password rides along', async () => {
    const identity = generateIdentity();
    const host = lockedStoreHostOn(ESSID);
    const secret = plaintextOf(storeOn(host).requirepassHash ?? '');
    const { deps: shutDeps, upsertPatch: shutPatch } = makeDeps();
    const { deps: openDeps, upsertPatch: openPatch } = makeDeps();

    const refused = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'SET greeting hello' }),
      shutDeps,
    );
    const taken = await handleRedisStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        statement: 'SET greeting hello',
        password: secret,
      }),
      openDeps,
    );

    expect(refused.body).toEqual({
      output: ['(error) NOAUTH Authentication required.'],
      failed: true,
    });
    expect(shutPatch).not.toHaveBeenCalled();

    expect(taken.body).toEqual({ output: ['OK'], failed: false });
    expect(rowsAt(openPatch, DATADIR_PATH)).toHaveLength(1);
  });

  it('gives a box running the daemon with no store one on its first write', async () => {
    const identity = generateIdentity();
    const host = openStoreHostOn(ESSID);
    const { machineId } = resolveLanHostIdentity(host, ESSID);
    // Somebody removed the file with an editor. `systemctl start redis` on a box that
    // never held anything is the same state, and both are honest: an empty store is a
    // store, and the first write is what gives it a file again.
    const { deps, upsertPatch } = makeDeps({
      findPatches: vi.fn(async ({ machine_id }) => ({
        data: machine_id === machineId ? [patchRow(DATADIR_PATH, null)] : [],
        error: null,
      })),
    });

    const response = await handleRedisStatement(
      await signedStatement(identity, { target_ip: host.ip, statement: 'SET greeting hello' }),
      deps,
    );

    expect(response.body).toEqual({ output: ['OK'], failed: false });
    expect(parseRedisStore(rowsAt(upsertPatch, DATADIR_PATH)[0]?.content ?? '')).toEqual({
      keys: { greeting: 'hello' },
      requirepassHash: null,
    });
  });
});

// ─── a store on a hidden layer, where the box's own journal is the whole question ───
//
// The chain resolver hands back the terminal box's SEEDED tree. For a door that
// authenticates against seeded accounts that is survivable; for one that ANSWERS WITH
// DATA it is not, because a change written down there would persist and never be read
// back. These are the tests that say so.

const DEEP_OPEN = deepStoreFixture({ locked: false });
const DEEP_LOCKED = deepStoreFixture({ locked: true });

/** Deliberately neither the store's port nor 22: the port a player opened on their
 *  GATEWAY has nothing to do with the port the daemon holds behind it. */
const FORWARD_PORT = 36379;

/** Journals per machine, because the chain walk asks for one machine at a time and a
 *  mock answering the same rows for every id would hand the gateway's forward table to
 *  the deep box as well. */
const journals = (rows: Readonly<Record<string, readonly OwnerPatchRow[]>>) =>
  vi.fn<RedisStatementDeps['findPatches']>(async ({ machine_id }) => ({
    data: rows[machine_id] ?? [],
    error: null,
  }));

/** The player's own root `nano /etc/iptables/rules.v4` on the gateway — the opt-in that
 *  exposes the layer at all. `deep` is whatever else has happened to the box down there
 *  since the world was generated. */
const throughForward = (fixture: DeepStoreFixture, deep: readonly OwnerPatchRow[] = []) =>
  journals({
    [fixture.gatewayMachineId]: [
      patchRow(
        '/etc/iptables/rules.v4',
        `forward ${FORWARD_PORT} to ${fixture.layer.host.ip}:${fixture.port}`,
      ),
    ],
    [fixture.machineId]: deep,
  });

const askDeep = async (
  identity: ReturnType<typeof generateIdentity>,
  fixture: DeepStoreFixture,
  deps: RedisStatementDeps,
  request: { readonly statement: string; readonly password?: string },
) =>
  handleRedisStatement(
    await signedStatement(identity, {
      essid: fixture.essid,
      target_ip: fixture.gateway.ip,
      port: FORWARD_PORT,
      statement: request.statement,
      ...(request.password === undefined ? {} : { password: request.password }),
    }),
    deps,
  );

describe('a store on a hidden layer', () => {
  it('answers with what the deep box holds NOW, not what it was generated holding', async () => {
    const identity = generateIdentity();
    const planted = { ...DEEP_OPEN.store, keys: { ...DEEP_OPEN.store.keys, 'sess:planted': 'yes' } };
    const { deps } = makeDeps({
      findPatches: throughForward(DEEP_OPEN, [patchRow(DATADIR_PATH, JSON.stringify(planted))]),
    });

    const response = await askDeep(identity, DEEP_OPEN, deps, { statement: 'GET sess:planted' });

    // The resolver hands this box back SEEDED, and that key exists in no seeded tree.
    // A door answering off the resolver's copy would serve a store nobody can change.
    expect(response).toEqual({ status: 200, body: { output: ['"yes"'], failed: false } });
  });

  it('writes a change onto the DEEP box, under its own machine id', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = makeDeps({ findPatches: throughForward(DEEP_OPEN) });

    const response = await askDeep(identity, DEEP_OPEN, deps, {
      statement: 'SET sess:new hello',
    });

    expect(response).toEqual({ status: 200, body: { output: ['OK'], failed: false } });
    // The gateway carried the packet and ran nothing. A datadir filed against it is a
    // change no store will ever be read from.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ machine_id: DEEP_OPEN.machineId, path: DATADIR_PATH }),
    );
    expect(
      upsertPatch.mock.calls.every(([row]) => row.machine_id === DEEP_OPEN.machineId),
    ).toBe(true);
  });

  it('reads back through a second request what the first one wrote', async () => {
    const identity = generateIdentity();
    const written: OwnerPatchRow[] = [];
    const { deps } = makeDeps({
      findPatches: vi.fn<RedisStatementDeps['findPatches']>(async ({ machine_id }) => ({
        data:
          machine_id === DEEP_OPEN.gatewayMachineId
            ? [
                patchRow(
                  '/etc/iptables/rules.v4',
                  `forward ${FORWARD_PORT} to ${DEEP_OPEN.layer.host.ip}:${DEEP_OPEN.port}`,
                ),
              ]
            : machine_id === DEEP_OPEN.machineId
              ? written
              : [],
        error: null,
      })),
      upsertPatch: vi.fn(async (row: PatchRow) => {
        if (row.path === DATADIR_PATH) written.push(patchRow(row.path, row.content));
        return { error: null };
      }),
    });

    await askDeep(identity, DEEP_OPEN, deps, { statement: 'SET sess:new hello' });
    const response = await askDeep(identity, DEEP_OPEN, deps, { statement: 'GET sess:new' });

    // Two round-trips, and the second one is a fresh reach: nothing is held between
    // them, so this is the journal really being replayed rather than a copy echoed.
    expect(response).toEqual({ status: 200, body: { output: ['"hello"'], failed: false } });
  });

  it('records the change in the deep box own log, at the address NAT showed it', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = makeDeps({ findPatches: throughForward(DEEP_OPEN) });

    await askDeep(identity, DEEP_OPEN, deps, { statement: 'SET sess:new hello' });

    // Behind NAT the box only ever saw the fronting gateway's `.1`. The line a defender
    // finds down there has to name what the route showed, not what the caller claimed.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        machine_id: DEEP_OPEN.machineId,
        path: REDIS_LOG_PATH,
        content: expect.stringContaining(`Client ${DEEP_OPEN.natIp} SET sess:new "hello"`),
      }),
    );
    expect(upsertPatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        path: REDIS_LOG_PATH,
        content: expect.stringContaining(CLIENT_IP),
      }),
    );
  });

  it('leaves a deep box byte-identical when the statement was a read', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = makeDeps({ findPatches: throughForward(DEEP_OPEN) });

    await askDeep(identity, DEEP_OPEN, deps, { statement: 'KEYS *' });

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a locked deep store until the password crosses the forward too', async () => {
    const identity = generateIdentity();
    const hash = DEEP_LOCKED.store.requirepassHash;
    if (hash === null) throw new Error('the locked fixture is not locked');
    const { deps } = makeDeps({ findPatches: throughForward(DEEP_LOCKED) });

    const [refused, answered] = [
      await askDeep(identity, DEEP_LOCKED, deps, { statement: 'DBSIZE' }),
      await askDeep(identity, DEEP_LOCKED, deps, {
        statement: 'DBSIZE',
        password: plaintextOf(hash),
      }),
    ];

    // The wall is the same one it puts up on the LAN. Depth is not a credential, in
    // either direction: it neither opens a locked store nor locks an open one.
    expect(refused).toEqual({
      status: 200,
      body: { output: ['(error) NOAUTH Authentication required.'], failed: true },
    });
    expect(answered.status).toBe(200);
    expect(answered.body).toEqual({
      output: [`(integer) ${Object.keys(DEEP_LOCKED.store.keys).length}`],
      failed: false,
    });
  });

  it('takes the password a player REWROTE down there, and refuses the one it replaced', async () => {
    const identity = generateIdentity();
    const seededHash = DEEP_LOCKED.store.requirepassHash;
    if (seededHash === null) throw new Error('the locked fixture is not locked');
    const chosen = 'hunter2';
    const rewritten = { ...DEEP_LOCKED.store, requirepassHash: md5(chosen) };
    const { deps } = makeDeps({
      findPatches: throughForward(DEEP_LOCKED, [patchRow(DATADIR_PATH, JSON.stringify(rewritten))]),
    });

    const [accepted, refused] = [
      await askDeep(identity, DEEP_LOCKED, deps, { statement: 'DBSIZE', password: chosen }),
      await askDeep(identity, DEEP_LOCKED, deps, {
        statement: 'DBSIZE',
        password: plaintextOf(seededHash),
      }),
    ];

    // The other side of the rule the sweep states: the lock a player changed is the lock
    // the door has. Both read this same file, so a door answering off the seeded tree
    // would refuse the password the sweep had just reported.
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({
      output: [`(integer) ${Object.keys(DEEP_LOCKED.store.keys).length}`],
      failed: false,
    });
    expect(refused).toEqual({
      status: 200,
      body: { output: ['(error) NOAUTH Authentication required.'], failed: true },
    });
  });

  it('drops a player whose deep daemon was stopped under them', async () => {
    const identity = generateIdentity();
    const { deps } = makeDeps({
      findPatches: throughForward(DEEP_OPEN, [
        patchRow(pidfilePath(SERVICE_CATALOG.redis), null),
      ]),
    });

    const response = await askDeep(identity, DEEP_OPEN, deps, { statement: 'DBSIZE' });

    // No session row exists to be invalidated, so asking again IS the eviction — at
    // any depth.
    expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
  });
});

// ─── statements against another player's store, from the other side of the world ───
//
// The reach is the connect door's, shared, so nothing here re-proves routing. What it
// proves is what a statement DOES once it has arrived on somebody else's machine: whose
// row the rewritten store lands in, whose log the line lands in, and which address that
// line names.
//
// Every store between players is LOCKED. Slice 6 mirrors the box's own root password
// onto it with no opt-out, so the vacuous-authorization case — a store that lets an
// outsider straight in — cannot arise here at all. `AUTH` is always the next question,
// and the password is one a sweep will not find.

const TARGET_PUBLIC_IP = '203.0.113.9';
const TARGET_ESSID = 'PIED-PIPER-GUEST';
const AP_GATEWAY_ID = computeApGatewayId(TARGET_ESSID);
const AP_NETWORK: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: TARGET_ESSID };
const ATTACKER_PUBLIC_IP = '198.51.100.22';

const DEFENDER = generateIdentity();
const DEFENDER_OCTET = 84;
const DEFENDER_LAN_IP = lanAddressFor(TARGET_ESSID, DEFENDER_OCTET);
const DEFENDER_WS = 'workstation-c3d4e5f6';
const DEFENDER_HOSTNAME = 'nebuchadnezzar';
/** The password the defender CHOSE for root, and therefore — slice 6's mirror — the
 *  password on their store. Not drawn from any pool, which is exactly why `hydra`
 *  cannot find it and why holding it means having taken the box first. */
const DEFENDER_ROOT_PW = 'correct-horse-battery-staple';
const defenderOccupant: NatOccupantRow = {
  owner_key: DEFENDER.publicKeyHex,
  workstation_machine_id: DEFENDER_WS,
  workstation_machine_name: DEFENDER_HOSTNAME,
  workstation_username: 'neo',
  workstation_root_hash: md5(DEFENDER_ROOT_PW),
};
const DEFENDER_STORE = playerStoreOn(defenderOccupant);
const DEFENDER_KEY = Object.keys(DEFENDER_STORE.keys)[0] ?? '';

const PUBLIC_PORT = 46379;
const publicForward = patchRow(
  '/etc/iptables/rules.v4',
  `forward ${PUBLIC_PORT} to ${DEFENDER_LAN_IP}:${SERVICE_CATALOG.redis.defaultPort}`,
);
const defenderRedisd = patchRow(
  pidfilePath(SERVICE_CATALOG.redis),
  formatPidfileContent(SERVICE_CATALOG.redis, SERVICE_CATALOG.redis.defaultPort),
);
const defenderDatadir = patchRow(DATADIR_PATH, JSON.stringify(DEFENDER_STORE));

const crossPlayerDeps = (defenderJournal: readonly OwnerPatchRow[] = [
  defenderRedisd,
  defenderDatadir,
]) =>
  makeDeps({
    findPatches: journals({
      [AP_GATEWAY_ID]: [publicForward],
      [DEFENDER_WS]: defenderJournal,
    }),
    findNetworkByPublicIp: async () => ({ data: AP_NETWORK, error: null }),
    listOccupantsByEssid: async () => ({ data: [defenderOccupant], error: null }),
    listLeasesByEssid: async () => ({
      data: [{ owner_key: DEFENDER.publicKeyHex, octet: DEFENDER_OCTET }] as readonly LanLeaseRow[],
      error: null,
    }),
    findHomeNetworkByOwnerKey: async () => ({
      data: { public_ip: ATTACKER_PUBLIC_IP },
      error: null,
    }),
  });

const askAcrossTheWorld = async (
  identity: ReturnType<typeof generateIdentity>,
  deps: RedisStatementDeps,
  request: { readonly statement: string; readonly password?: string },
) =>
  handleRedisStatement(
    await signedStatement(identity, {
      essid: TARGET_ESSID,
      target_ip: TARGET_PUBLIC_IP,
      port: PUBLIC_PORT,
      statement: request.statement,
      ...(request.password === undefined ? {} : { password: request.password }),
    }),
    deps,
  );

const datadirRows = (upsertPatch: { mock: { calls: readonly (readonly [PatchRow])[] } }) =>
  upsertPatch.mock.calls.map(([row]) => row).filter((row) => row.path === DATADIR_PATH);

describe("another player's store, asked from the other side of the world", () => {
  it('refuses the first question, because a store between players is always locked', async () => {
    const identity = generateIdentity();
    const { deps } = crossPlayerDeps();

    const response = await askAcrossTheWorld(identity, deps, { statement: 'KEYS *' });

    // Slice 6 mirrors the box's root password onto its store with no opt-out. Reaching
    // a player's store and walking straight in is a state the game cannot be in.
    expect(response).toEqual({
      status: 200,
      body: { output: ['(error) NOAUTH Authentication required.'], failed: true },
    });
  });

  it("accepts the password the defender chose for their own root account", async () => {
    const identity = generateIdentity();
    const { deps } = crossPlayerDeps();

    const response = await askAcrossTheWorld(identity, deps, {
      statement: `GET ${DEFENDER_KEY}`,
      password: DEFENDER_ROOT_PW,
    });

    // The mirror, seen from the attacking side: what opens the box opens the store, so
    // taking root is what this door is really waiting for. How a value is RENDERED is
    // the verb table's business and already asserted there; what matters here is that
    // the defender's own value is what came back.
    expect(response.body).toMatchObject({ failed: false });
    expect(String(response.body.output)).toContain(DEFENDER_STORE.keys[DEFENDER_KEY] ?? '');
  });

  it("writes the rewritten store into the DEFENDER's own row, not the attacker's", async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = crossPlayerDeps();

    await askAcrossTheWorld(identity, deps, {
      statement: 'SET intruder:was-here yes',
      password: DEFENDER_ROOT_PW,
    });

    // `patches` is keyed (machine_id, path, writer_key), so a row per attacker would
    // fold to whichever was written last — every other intruder's changes, and the
    // owner's own, silently dropped. One row is what a file several people edit IS.
    const [row] = datadirRows(upsertPatch);
    expect(row?.writer_key).toBe(DEFENDER.publicKeyHex);
    expect(row?.machine_id).toBe(DEFENDER_WS);
    expect(parseRedisStore(row?.content ?? '')?.keys['intruder:was-here']).toBe('yes');
  });

  it('leaves the mutation line in the defender log at the SERVER-derived address', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = crossPlayerDeps();

    await askAcrossTheWorld(identity, deps, {
      statement: 'SET intruder:was-here yes',
      password: DEFENDER_ROOT_PW,
    });

    // The one thing the defender has to go on, so it cannot be a string the attacker's
    // own client chose. Their public address is resolved from their VERIFIED key.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: DEFENDER.publicKeyHex,
        path: REDIS_LOG_PATH,
        content: expect.stringContaining(ATTACKER_PUBLIC_IP),
      }),
    );
    expect(upsertPatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: REDIS_LOG_PATH, content: expect.stringContaining(CLIENT_IP) }),
    );
  });

  it('records a guess at the lock on the defender box, and changes nothing', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = crossPlayerDeps();

    await askAcrossTheWorld(identity, deps, { statement: 'AUTH hunter2' });

    // A password actually weighed is the one thing besides the arrival that leaves a
    // mark, and it lands on the DEFENDER's log at the address the server derived. A
    // stranger guessing at the lock is what a defender most needs to be able to see.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        writer_key: DEFENDER.publicKeyHex,
        machine_id: DEFENDER_WS,
        path: REDIS_LOG_PATH,
        content: expect.stringContaining(ATTACKER_PUBLIC_IP),
      }),
    );
    // A guess is not a change. Nothing about the store moved.
    expect(datadirRows(upsertPatch)).toEqual([]);
  });

  it('reads the defender store without leaving a line behind', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = crossPlayerDeps();

    await askAcrossTheWorld(identity, deps, {
      statement: 'KEYS *',
      password: DEFENDER_ROOT_PW,
    });

    // A successful `AUTH` leaves its own attempt line; the READ beside it leaves none.
    // Against a store an intruder can open, that silence is the defender's problem
    // rather than an omission — the arrival line is their whole evidence.
    const mutationLines = upsertPatch.mock.calls
      .map(([row]) => row)
      .filter((row) => row.path === REDIS_LOG_PATH && !row.content?.includes('AUTH'));
    expect(mutationLines).toEqual([]);
    expect(datadirRows(upsertPatch)).toEqual([]);
  });

  it('drops the attacker once the defender stops the daemon under them', async () => {
    const identity = generateIdentity();
    const { deps } = crossPlayerDeps([defenderDatadir]);

    const response = await askAcrossTheWorld(identity, deps, {
      statement: 'KEYS *',
      password: DEFENDER_ROOT_PW,
    });

    // `systemctl stop redis` is the defender's counter-move and it works from the
    // outside in. There is no session row to invalidate, so asking again IS the
    // eviction — and from beyond the NAT a dead forward reads as simple silence.
    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });
});

// ─── the same WiFi: the neighbour's store, with nothing in between ───
//
// The other end of the reach the block above walks. Across NAT the port is the whole
// address and a stopped daemon reads as silence; here the address IS the box, and a
// stopped daemon says so. What does NOT change is the lock: slice 6 mirrors a box's
// root password onto its store wherever the caller is standing, so a neighbour is no
// more walked in on than a stranger across the world.

const ATTACKER_OCTET = 61;
const ATTACKER_LAN_IP = lanAddressFor(ESSID, ATTACKER_OCTET);
const DEFENDER_SAME_LAN_IP = lanAddressFor(ESSID, DEFENDER_OCTET);

const attackerOccupant = (attackerKey: string): NatOccupantRow => ({
  owner_key: attackerKey,
  workstation_machine_id: 'workstation-a1b2c3d4',
  workstation_machine_name: 'trinity-box',
  workstation_username: 'trinity',
  workstation_root_hash: md5('a-different-password'),
});

const sameLanDeps = (
  attackerKey: string,
  defenderJournal: readonly OwnerPatchRow[] = [defenderRedisd, defenderDatadir],
) =>
  makeDeps({
    findPatches: journals({ [DEFENDER_WS]: defenderJournal }),
    listOccupantsByEssid: async () => ({
      data: [defenderOccupant, attackerOccupant(attackerKey)],
      error: null,
    }),
    listLeasesByEssid: async () => ({
      data: [
        { owner_key: DEFENDER.publicKeyHex, octet: DEFENDER_OCTET },
        { owner_key: attackerKey, octet: ATTACKER_OCTET },
      ] as readonly LanLeaseRow[],
      error: null,
    }),
  });

const askNextDoor = async (
  identity: ReturnType<typeof generateIdentity>,
  deps: RedisStatementDeps,
  request: { readonly statement: string; readonly password?: string },
) =>
  handleRedisStatement(
    await signedStatement(identity, {
      target_ip: DEFENDER_SAME_LAN_IP,
      statement: request.statement,
      ...(request.password === undefined ? {} : { password: request.password }),
    }),
    deps,
  );

describe("a fellow occupant's store, asked from across the room", () => {
  it('refuses the first question here too, because the lock does not care where you stand', async () => {
    const identity = generateIdentity();
    const { deps } = sameLanDeps(identity.publicKeyHex);

    const response = await askNextDoor(identity, deps, { statement: 'KEYS *' });

    // Proximity is not authorization. The mirror slice 6 put on every player's store
    // has no vantage in it, so being on somebody's WiFi buys exactly nothing.
    expect(response).toEqual({
      status: 200,
      body: { output: ['(error) NOAUTH Authentication required.'], failed: true },
    });
  });

  it("accepts the password the neighbour chose for their own root account", async () => {
    const identity = generateIdentity();
    const { deps } = sameLanDeps(identity.publicKeyHex);

    const response = await askNextDoor(identity, deps, {
      statement: `GET ${DEFENDER_KEY}`,
      password: DEFENDER_ROOT_PW,
    });

    expect(response.body).toMatchObject({ failed: false });
    expect(String(response.body.output)).toContain(DEFENDER_STORE.keys[DEFENDER_KEY] ?? '');
  });

  it("writes the rewritten store into the NEIGHBOUR's own row, not the caller's", async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = sameLanDeps(identity.publicKeyHex);

    await askNextDoor(identity, deps, {
      statement: 'SET intruder:was-here yes',
      password: DEFENDER_ROOT_PW,
    });

    // One box, one datadir, however many neighbours have touched it. A row per caller
    // would fold to whichever was written last and silently drop the rest.
    const [row] = datadirRows(upsertPatch);
    expect(row?.writer_key).toBe(DEFENDER.publicKeyHex);
    expect(row?.machine_id).toBe(DEFENDER_WS);
  });

  it('names the caller by the address the LEASE issued, never the one they typed', async () => {
    const identity = generateIdentity();
    const { deps, upsertPatch } = sameLanDeps(identity.publicKeyHex);

    await askNextDoor(identity, deps, {
      statement: `AUTH ${DEFENDER_ROOT_PW}`,
    });

    // Nothing rewrote the source on the way in — the box really did see this address —
    // but it is still read from the lease store rather than taken from the request,
    // because evidence a client can write is none.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        path: REDIS_LOG_PATH,
        content: expect.stringContaining(ATTACKER_LAN_IP),
      }),
    );
    expect(upsertPatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(CLIENT_IP) }),
    );
  });

  it('says the daemon has stopped rather than falling silent, because there is no NAT to hide it', async () => {
    const identity = generateIdentity();
    const { deps } = sameLanDeps(identity.publicKeyHex, [defenderDatadir]);

    const response = await askNextDoor(identity, deps, {
      statement: 'KEYS *',
      password: DEFENDER_ROOT_PW,
    });

    // The deliberate asymmetry with the block above. Across somebody else's NAT a dead
    // forward and a forward that was never opened are the same silence, and telling
    // them apart would disclose which services a box has stopped. On the shared WiFi
    // the caller is INSIDE the network, so the honest answer is the specific one.
    expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
  });
});
