import { describe, expect, it, vi } from 'vitest';
import { redisCli } from './redisCli';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockNetworkViewFromConnectivity,
  mockRedisApi,
  mockScanApi,
} from '../../test/factories/commandEnv';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { isInnerGateway } from '../generation/lanHostIdentity';
import { hostServices } from '../generation/remoteHostFs';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { formatPidfileContent, pidfilePath, PIDFILE_PERMISSIONS } from '../services/pidfile';
import { buildWorkstationBaseFs } from '../generation/workstationFs';
import { applyPatches } from '../filesystem/applyPatches';
import { ownStore } from '../redis/ownStore';
import { DATADIR_OWNER, DATADIR_PATH } from '../redis/datadir';
import { DATADIR_FILE } from '../generation/baseFs';
import { REDIS_LOG_PATH, REDIS_LOG_PERMISSIONS } from '../logging/redisLog';
import { asAbsPath, asPlayerKeyHex, type AbsPath } from '../types';
import type { Directory } from '../filesystem/types';
import type { FsView } from './types';
import { bindFlags } from '../shell/bindFlags';
import { SERVICE_CATALOG as CATALOG } from '../services/serviceCatalog';
import type { CommandEnv, CommandResult, RedisApi } from './types';

/**
 * `redis-cli <host>` — the fifth door, and the only one that asks the player for
 * nothing at all.
 *
 * There is no account to name and no password to type: a store answers to one secret
 * or to none, and the secret belongs to the SERVICE. So the whole of this command is
 * reaching the box and handing over the prompt — and the refusals, which are the only
 * thing it can say instead.
 *
 * A LOCKED store still opens. The lock lands on the first question, not on the door,
 * which is what the real client does and what keeps a scanner from learning which
 * stores hold a secret without sending one.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
/** The player's OWN address on this LAN — what the target's daemon records the
 *  arrival from, and so what the connection carries. Never the target's. */
const OWN_IP = assignHomeNetwork(PUBKEY, ESSID).localIp;

const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
  return {
    interfaces: new Map(cold.interfaces).set('wlan0', {
      ...wlan0,
      association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' },
      ipv4: assignHomeNetwork(PUBKEY, essid).localIp,
    }),
  };
};

const storeHost = (() => {
  const host = generateHomeLan(ESSID).hosts.find(
    (candidate) =>
      candidate.kind === 'machine' &&
      hostServices(ESSID, candidate).some(({ spec }) => spec === SERVICE_CATALOG.redis),
  );
  if (host === undefined) throw new Error('no store-running host on LAN');
  return host;
})();

const storelessHost = (() => {
  const host = generateHomeLan(ESSID).hosts.find(
    (candidate) =>
      candidate.kind === 'machine' &&
      !hostServices(ESSID, candidate).some(({ spec }) => spec === SERVICE_CATALOG.redis),
  );
  if (host === undefined) throw new Error('every host on LAN runs a store');
  return host;
})();

/** The LAN's inner gateway — the one kind of host where a port names something BEHIND
 *  the box rather than a door on it. A deep store has no LAN address of its own, so the
 *  gateway plus the port its owner forwarded is the whole of how it can be named. */
const innerGatewayOn = (essid: string): LanHost => {
  const gateway = generateHomeLan(essid).hosts.find(isInnerGateway);
  if (gateway === undefined) throw new Error('no inner gateway on this LAN');
  return gateway;
};

/** Deliberately neither 6379 nor the gateway's own 22: this is a port a player opened on
 *  their gateway, and what it reaches is the gateway's business rather than this LAN's. */
const FORWARD_PORT = 36379;

const onLan = (over: Partial<RedisApi> = {}, envOver: Partial<CommandEnv> = {}) =>
  mockCommandEnv({
    redis: mockRedisApi({ connect: async () => ({ ok: true, hostname: 'unused' }), ...over }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    scan: mockScanApi({ resolveOccupants: async () => [] }),
    // Every box has one. A store opened on the player's OWN box writes its arrival line
    // through this, so a door that reaches one must not die on a mock that has none —
    // the tests that assert on those writes bring their own recording stub.
    patches: {
      write: async () => ({ ok: true }),
      mkdir: async () => ({ ok: true }),
      remove: async () => ({ ok: true }),
    },
    ...envOver,
  });

const run = (env: CommandEnv, args: readonly string[]) =>
  redisCli.execute(env, args, new Map());

const runWith = (
  env: CommandEnv,
  args: readonly string[],
  flags: ReadonlyMap<string, string | true>,
) => redisCli.execute(env, args, flags);

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return result;
};

const linesOf = (result: CommandResult): string =>
  sync(result)
    .lines.map((line) => line.content)
    .join('\n');

describe('opening a store on the LAN', () => {
  it('names the box that answered and hands over the prompt', async () => {
    const enter = vi.fn();
    const env = onLan({
      connect: async () => ({ ok: true, hostname: storeHost.hostname }),
      enter,
    });

    const result = await run(env, [storeHost.ip]);

    expect(linesOf(result)).toBe(
      `Connecting to ${storeHost.ip}:6379...\nConnected to Redis ${storeHost.hostname}.`,
    );
    expect(sync(result).exitCode).toBe(0);
    expect(enter).toHaveBeenCalled();
  });

  it('draws the greeting as ordinary output and a refusal as an error', async () => {
    const greeted = await run(
      onLan({ connect: async () => ({ ok: true, hostname: 'www-07' }) }),
      [storeHost.ip],
    );
    const refused = await run(onLan(), ['192.168.1.253']);

    // The terminal colours by `kind` and the exit code follows it. A refusal drawn as
    // ordinary text reads as though the connection worked.
    expect(sync(greeted).lines.map((line) => line.kind)).toEqual(['text', 'text']);
    expect(sync(refused).lines.map((line) => line.kind)).toEqual(['error']);
  });

  it('holds the whole connection, because every statement re-sends it', async () => {
    const enter = vi.fn();
    const env = onLan({ connect: async () => ({ ok: true, hostname: 'www-07' }), enter });

    await run(env, [storeHost.ip]);

    // No session id to send instead — that is the mechanism rather than an oversight,
    // and it is why the prompt has to keep the address it was opened on.
    expect(enter).toHaveBeenCalledWith({
      essid: ESSID,
      targetIp: storeHost.ip,
      port: 6379,
      sourceIp: OWN_IP,
    });
  });

  it('asks the player for nothing at all along the way', async () => {
    const prompt = vi.fn();
    const env = onLan({ connect: async () => ({ ok: true, hostname: 'www-07' }) }, { prompt });

    await run(env, [storeHost.ip]);

    // The one door with no credential. A prompt here would be this client inventing a
    // question the daemon never asks.
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('what it says instead', () => {
  it('asks for a host when given none, and reaches nothing', async () => {
    const connect = vi.fn();

    const result = await run(onLan({ connect }), []);

    expect(linesOf(result)).toBe('usage: redis-cli [-p port] <host> [password]');
    expect(sync(result).exitCode).toBe(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses a LAN box that runs no store, without asking the server', async () => {
    const connect = vi.fn();

    const result = await run(onLan({ connect }), [storelessHost.ip]);

    // Settled from the pidfiles — the same source `nmap` reads, so a door the player
    // was shown is a door that opens and one they were not is refused here for free.
    expect(linesOf(result)).toBe(
      `Could not connect to Redis at ${storelessHost.ip}:6379: Connection refused`,
    );
    expect(sync(result).exitCode).toBe(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses an address no host on the LAN answers to', async () => {
    const result = await run(onLan(), ['192.168.1.253']);

    expect(linesOf(result)).toBe(
      'Could not connect to Redis at 192.168.1.253:6379: Connection refused',
    );
  });

  it('refuses the player own box, which runs no store yet', async () => {
    const connect = vi.fn();
    // The default mock tree is empty, which is exactly a box that has installed
    // nothing: no pidfile, so no daemon.
    const env = onLan({ connect });

    const result = await run(env, ['127.0.0.1']);

    // Their box has a REAL filesystem this client holds, so the pidfile that would say
    // otherwise is sitting right here. Nothing installed it yet.
    expect(linesOf(result)).toBe('Could not connect to Redis at 127.0.0.1:6379: Connection refused');
    expect(connect).not.toHaveBeenCalled();
  });

  it('says the network is unreachable when nothing is associated', async () => {
    const env = mockCommandEnv({
      redis: mockRedisApi(),
      network: mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY)),
    });

    const result = await run(env, [storeHost.ip]);

    expect(linesOf(result)).toBe(
      `Could not connect to Redis at ${storeHost.ip}:6379: Network is unreachable`,
    );
  });

  it('passes on a refusal the server made, without a prompt being handed over', async () => {
    const enter = vi.fn();
    const env = onLan({ connect: async () => ({ ok: false, reason: 'refused' }), enter });

    const result = await run(env, [storeHost.ip]);

    expect(linesOf(result)).toBe(
      `Could not connect to Redis at ${storeHost.ip}:6379: Connection refused`,
    );
    expect(enter).not.toHaveBeenCalled();
  });

  it('tells a box that was never there apart from one that refused', async () => {
    const env = onLan({ connect: async () => ({ ok: false, reason: 'unreachable' }) });

    const result = await run(env, [storeHost.ip]);

    expect(linesOf(result)).toBe(
      `Could not connect to Redis at ${storeHost.ip}:6379: No route to host`,
    );
  });
});

describe('the vantages this client cannot settle for itself', () => {
  it('asks the server about a PUBLIC address instead of refusing it here', async () => {
    const connect = vi.fn(async () => ({ ok: true as const, hostname: 'somebody-elses-box' }));

    await run(onLan({ connect }), ['203.0.113.9']);

    // A public address names an ACCESS POINT, and which box sits behind which forward
    // lives in that gateway's server-side journal. Refusing it from the generated LAN
    // would refuse every stranger in the world.
    expect(connect).toHaveBeenCalled();
  });

  it('still refuses a storeless LAN box when the player does have neighbours', async () => {
    const connect = vi.fn(async () => ({ ok: true as const, hostname: 'unused' }));
    const env = onLan(
      { connect },
      {
        scan: mockScanApi({
          resolveOccupants: async () => [
            {
              workstation_machine_id: 'workstation-a1b2c3d4',
              localIp: '192.168.1.77',
              machineName: 'somebody-else',
            },
          ],
        }),
      },
    );

    await runWith(env, [storelessHost.ip], new Map());

    // Having neighbours does not make every address one of them. A client that sent
    // each of these to the server would refuse nothing locally and cost a round-trip
    // per box on a scan the player already has in front of them.
    expect(connect).not.toHaveBeenCalled();
  });

  it('asks the server about a FELLOW OCCUPANT rather than the box they displaced', async () => {
    const connect = vi.fn(async () => ({ ok: true as const, hostname: 'neighbour' }));
    const neighbour = '192.168.1.61';
    const env = onLan({ connect }, {
      scan: mockScanApi({
        resolveOccupants: async () => [
          {
            workstation_machine_id: 'workstation-c3d4e5f6',
            localIp: neighbour,
            machineName: 'neighbour',
          },
        ],
      }),
    });

    await run(env, [neighbour]);

    // A real player wins an octet the generator also filled. Pre-flighting them against
    // the generated world would refuse them on behalf of the seeded box their lease
    // displaced.
    expect(connect).toHaveBeenCalled();
  });
});

/**
 * The store on your OWN box.
 *
 * Answered here rather than through the server, and that is not a shortcut — it is the
 * only correct answer available. The server's same-LAN vantage excludes the caller on
 * purpose, so a self-addressed reach that went out would fall through to the generated
 * world and open whichever seeded box happens to stand at the address the player was
 * leased. Your own box is the client's to answer because the client is the only side
 * that holds it.
 *
 * What differs is WHERE the decision runs, never what it decides: the same daemon check
 * against the same pidfile, the same arrival line in the same format, on a store read
 * from the machine rather than from the copy this client walked in with.
 */
describe('the player own box, once it runs a store', () => {
  const CONFIG = { machineName: 'workstation', username: 'alice', rootPassword: 'hunter2' };

  /** The server door, deliberately unreachable. A connection to your own box that took
   *  the cross-network path would throw here rather than quietly pass. */
  const NOT_WIRED = () => {
    throw new Error('own-box redis-cli must not reach the server');
  };

  /** Their box after buying a store and starting the daemon. Both files come from the
   *  production code that writes them, so a change to either format arrives in this
   *  fixture instead of drifting past it. */
  const ownBoxRunningRedis = (port: number = SERVICE_CATALOG.redis.defaultPort): Directory => {
    const base = buildWorkstationBaseFs(asPlayerKeyHex(PUBKEY), CONFIG);
    return applyPatches(base, [
      {
        path: DATADIR_PATH,
        content: JSON.stringify(
          ownStore({ ownerKeyHex: PUBKEY, hostname: CONFIG.machineName, fs: base }),
        ),
        owner: DATADIR_OWNER,
        permissions: DATADIR_FILE,
      },
      {
        path: pidfilePath(SERVICE_CATALOG.redis),
        content: formatPidfileContent(SERVICE_CATALOG.redis, port),
        owner: 'root',
        permissions: PIDFILE_PERMISSIONS,
      },
    ]);
  };

  /** The same box with the daemon stopped — the pidfile gone, which is the whole of
   *  what `systemctl stop` leaves behind. */
  const withDaemonStopped = (tree: Directory): Directory =>
    applyPatches(tree, [
      {
        path: pidfilePath(SERVICE_CATALOG.redis),
        content: null,
        owner: 'root',
        permissions: PIDFILE_PERMISSIONS,
      },
    ]);

  /** A box whose filesystem changes under a command mid-run, the way a real one does:
   *  a `systemctl stop` in another tab is visible to the very next read. */
  const liveBox = (initial: Directory) => {
    let tree = initial;
    const view = () => mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') });
    return {
      become: (next: Directory) => {
        tree = next;
      },
      fs: {
        cwd: () => asAbsPath('/'),
        read: (path: AbsPath) => view().read(path),
        list: (path: AbsPath) => view().list(path),
        stat: (path: AbsPath) => view().stat(path),
        canWrite: (path: AbsPath) => view().canWrite(path),
        root: () => tree,
        // Re-reading this box reaches whatever it has become, which is the whole point
        // of the seam: the machine is the authority, not a copy taken on the way in.
        reload: async () => view(),
      } satisfies FsView,
    };
  };

  const ownBoxEnv = (
    box: ReturnType<typeof liveBox>,
    over: Partial<RedisApi> = {},
  ) => {
    const writes: { path: string; content: string | null; isNew?: boolean }[] = [];
    const env = mockCommandEnv({
      redis: mockRedisApi({ connect: NOT_WIRED, ...over }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      scan: mockScanApi({ resolveOccupants: async () => [] }),
      hostname: CONFIG.machineName,
      fs: box.fs,
      patches: {
        write: async (path, content, options) => {
          writes.push({
            path,
            content,
            ...(options?.isNew === undefined ? {} : { isNew: options.isNew }),
          });
          return { ok: true };
        },
        mkdir: async () => ({ ok: true }),
        remove: async () => ({ ok: true }),
      },
    });
    return { env, writes };
  };

  it('opens the store on your own box without asking the server', async () => {
    const enter = vi.fn();
    const { env } = ownBoxEnv(liveBox(ownBoxRunningRedis()), { enter });

    const result = await run(env, ['127.0.0.1']);

    // The greeting names the box the player is standing on, because that is the box
    // that answered — there is no forward here for a name to arrive through.
    expect(linesOf(result)).toContain(`Connected to Redis ${CONFIG.machineName}.`);
    expect(enter).toHaveBeenCalled();
  });

  it('records the arrival on the box own redis.log, as a stranger arrival is recorded', async () => {
    // A daemon that recorded strangers but not its owner would be one that knows which
    // is which, and the defender's skill is reading the file rather than being handed
    // it pre-filtered.
    const { env, writes } = ownBoxEnv(liveBox(ownBoxRunningRedis()));

    await run(env, ['127.0.0.1']);

    const logged = writes.find((write) => write.path === REDIS_LOG_PATH);
    expect(logged?.content).toContain('Client connected from 127.0.0.1');
  });

  /** A box this client's copy is STALE about: what it walked in holding still shows the
   *  daemon up, and the machine itself says otherwise. That gap is the whole reason the
   *  own-box path spends a round trip it could have saved — a copy is only ever the
   *  player's own edits, and it is not the only thing that writes to this box. */
  const staleBox = (held: Directory, machine: Directory) => {
    const of = (tree: Directory) =>
      mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') });
    return {
      cwd: () => asAbsPath('/'),
      read: (path: AbsPath) => of(held).read(path),
      list: (path: AbsPath) => of(held).list(path),
      stat: (path: AbsPath) => of(held).stat(path),
      canWrite: (path: AbsPath) => of(held).canWrite(path),
      root: () => held,
      reload: async () => of(machine),
    } satisfies FsView;
  };

  it('adds its arrival to a log that already has history, rather than replacing it', async () => {
    // The box's own log is the defender's evidence. A visit of their own that shortened
    // it to one line would erase whatever an intruder left behind, by the owner's
    // routine use of their own box.
    const HISTORY = '1:M 20 Aug 2026 09:14:02.000 * Client connected from 192.168.1.77';
    const withHistory = applyPatches(ownBoxRunningRedis(), [
      {
        path: REDIS_LOG_PATH,
        content: `${HISTORY}\n`,
        owner: 'root',
        permissions: REDIS_LOG_PERMISSIONS,
      },
    ]);
    const { env, writes } = ownBoxEnv(liveBox(withHistory));

    await run(env, ['127.0.0.1']);

    const logged = writes.find((write) => write.path === REDIS_LOG_PATH);
    expect(logged?.content).toContain(HISTORY);
    expect(logged?.content).toContain('Client connected from 127.0.0.1');
    // Not a new file: a box whose daemon has already said something has one.
    expect(logged?.isNew).toBeUndefined();
  });

  it('creates the log on a box whose daemon has never had anything to say', async () => {
    const { env, writes } = ownBoxEnv(liveBox(ownBoxRunningRedis()));

    await run(env, ['127.0.0.1']);

    const logged = writes.find((write) => write.path === REDIS_LOG_PATH);
    expect(logged?.isNew).toBe(true);
    // The whole file, not merely a file containing the line: a first line that arrived
    // with anything in front of it would be a history the box never had.
    expect(logged?.content).toMatch(/^\d+:M .* \* Client connected from 127\.0\.0\.1\n$/);
  });

  it('leaves a log it could not READ alone, rather than replacing it with one line', async () => {
    // Root can put something at that path that is not a log — a directory is the easy
    // one. Whatever it is, replacing it with a single line is worse than dropping the
    // line: on a box whose log really is a log, that is the box's whole history gone.
    const blocked = applyPatches(ownBoxRunningRedis(), [
      {
        path: REDIS_LOG_PATH,
        content: null,
        owner: 'root',
        permissions: REDIS_LOG_PERMISSIONS,
      },
    ]);
    const withDirectory = applyPatches(blocked, [
      {
        path: asAbsPath(`${REDIS_LOG_PATH}/rotated`),
        content: 'an old log somebody moved here',
        owner: 'root',
        permissions: REDIS_LOG_PERMISSIONS,
      },
    ]);
    const { env, writes } = ownBoxEnv(liveBox(withDirectory));

    const result = await run(env, ['127.0.0.1']);

    // The store still opens. An arrival that could not be recorded is a line lost, not
    // a door shut.
    expect(linesOf(result)).toContain(`Connected to Redis ${CONFIG.machineName}.`);
    expect(writes.filter((write) => write.path === REDIS_LOG_PATH)).toEqual([]);
  });

  it('re-checks the daemon against the MACHINE, not the copy it walked in with', async () => {
    // A `systemctl stop` between the pre-flight and the open is a door that closed while
    // the player was still typing, and it must not open anyway. Only the reload can see
    // it: the copy in hand still has the pidfile.
    const running = ownBoxRunningRedis();
    const { env } = ownBoxEnv({
      become: () => undefined,
      fs: staleBox(running, withDaemonStopped(running)),
    });

    const result = await run(env, ['127.0.0.1']);

    expect(linesOf(result)).toBe(
      'Could not connect to Redis at 127.0.0.1:6379: Connection refused',
    );
  });

  it('holds it under the address it was LEASED, whichever name reached it', async () => {
    const enter = vi.fn();
    const { env } = ownBoxEnv(liveBox(ownBoxRunningRedis()), { enter });

    await run(env, ['localhost']);

    // All three names mean the one address the box was leased, and every statement
    // after this re-resolves one machine rather than three.
    expect(enter).toHaveBeenCalledWith(
      expect.objectContaining({ targetIp: OWN_IP, sourceIp: '127.0.0.1' }),
    );
  });
});

describe('the command in the world', () => {
  it('needs a terminal, because what it opens is a prompt', () => {
    // The message, not merely its presence: an empty string is "defined" and would
    // leave a player who piped this into a script reading a blank line.
    expect(redisCli.withoutTty).toBe('redis-cli: must be run from a terminal');
  });

  it('is a door a guest can walk up to, because the store asks nothing of the machine', () => {
    // A store has no accounts, so requiring one on the box the player is STANDING on
    // would be a credential this door invented for itself.
    expect(redisCli.tier).toBe('guest');
  });

  it('documents itself for man and help, with an example a player can copy', () => {
    // Criterion: `man redis-cli` and `help` list the command. Both read the registry
    // row, so what they show is exactly this.
    expect(redisCli.manual?.synopsis).toBe('redis-cli [-p port] <host> [password]');
    expect(redisCli.description.length).toBeGreaterThan(10);
    expect(redisCli.manual?.arguments?.[0]?.name).toBe('host');
    // Every example is a line a player can copy, and every argument says what it is
    // for. An example with no command, or an argument with no description, is a manual
    // page that looks complete and teaches nothing.
    // Counted as well as checked: `every` on an empty array is true, so the shape
    // assertion below would pass just as happily on a page with no examples at all.
    expect(redisCli.manual?.examples?.length).toBeGreaterThan(2);
    expect(
      redisCli.manual?.examples?.every(
        (example) => example.command.startsWith('redis-cli ') && example.description.length > 10,
      ),
    ).toBe(true);
    expect(
      redisCli.manual?.arguments?.every((argument) => argument.description.length > 10),
    ).toBe(true);
    // And it names the verb that opens a locked store, because the password argument is
    // only half the answer: a player who did not have it at connect time needs the other.
    expect(redisCli.manual?.description).toContain('AUTH <password>');
    // And the two verbs that change a store, because a player who reached a prompt
    // they can write to has no other place to learn that they can.
    expect(redisCli.manual?.description).toContain('SET');
    expect(redisCli.manual?.description).toContain('DEL');
    // And the flag, which is the only way to say the name of a store that has no
    // address: a player who found a forward in a gateway's rules has nowhere else to
    // learn that this client can follow it.
    expect(
      redisCli.manual?.arguments?.some(
        (argument) => argument.name === '-p' && argument.description.length > 10,
      ),
    ).toBe(true);
  });

  it('is reachable from the box the player is standing on and nowhere else', () => {
    // A store connection is made from where you stand. `localhost-only` is what every
    // other door that opens a prompt declares.
    expect(redisCli.availability).toEqual({ kind: 'localhost-only' });
  });
});

/**
 * The password argument, which is an `AUTH` sent early rather than a second kind of
 * connection.
 *
 * The handshake still carries nothing: the store is opened exactly as it is for a
 * player who typed no password, and the secret is spent afterwards as an ordinary
 * statement. That is what the real client does with `-a`, and it is what keeps a
 * scanner from learning which stores hold a secret by watching connections succeed.
 */
describe('opening a store with the password in hand', () => {
  const connectingTo = (host: string, hostname: string) =>
    `Connecting to ${host}:6379...\nConnected to Redis ${hostname}.`;

  it('spends the password as its first statement, after the store is open', async () => {
    const statement = vi.fn(async () => ({ kind: 'answered' as const, output: ['OK'], failed: false }));
    const env = onLan({ connect: async () => ({ ok: true, hostname: 'www-07' }), run: statement });

    const result = await run(env, [storeHost.ip, 'sunshine']);

    expect(statement).toHaveBeenCalledWith(
      expect.objectContaining({ statement: 'AUTH sunshine', targetIp: storeHost.ip }),
    );
    // Printed, where the real client is silent: the greeting is already two chatty
    // lines, and a silent success is indistinguishable from a client that ignored the
    // argument it was handed.
    expect(linesOf(result)).toBe(`${connectingTo(storeHost.ip, 'www-07')}\nOK`);
    expect(sync(result).exitCode).toBe(0);
  });

  it('holds the password once the store has accepted it', async () => {
    const enter = vi.fn();
    const statement = vi.fn(async () => ({ kind: 'answered' as const, output: ['OK'], failed: false }));
    const env = onLan({ connect: async () => ({ ok: true, hostname: 'www-07' }), enter, run: statement });

    await run(env, [storeHost.ip, 'sunshine']);

    // Every later statement re-sends it — there is no session row holding it instead.
    expect(enter).toHaveBeenLastCalledWith(expect.objectContaining({ password: 'sunshine' }));
  });

  it('leaves the player at the prompt when the store refused the password', async () => {
    const leave = vi.fn();
    const statement = vi.fn(async () => ({
      kind: 'answered' as const,
      output: ['(error) ERR invalid password'],
      failed: true,
    }));
    const env = onLan({ connect: async () => ({ ok: true, hostname: 'www-07' }), leave, run: statement });

    const result = await run(env, [storeHost.ip, 'guesswork']);

    // A wrong password is not a refused connection. The store is open, the prompt is
    // theirs, and they are free to AUTH again.
    expect(linesOf(result)).toContain('(error) ERR invalid password');
    expect(sync(result).exitCode).toBe(1);
    expect(leave).not.toHaveBeenCalled();
  });

  it('says so when the store had no password to be given one', async () => {
    const statement = vi.fn(async () => ({
      kind: 'answered' as const,
      output: ['(error) ERR Client sent AUTH, but no password is set'],
      failed: true,
    }));
    const env = onLan({ connect: async () => ({ ok: true, hostname: 'www-07' }), run: statement });

    expect(linesOf(await run(env, [storeHost.ip, 'sunshine']))).toContain(
      'no password is set',
    );
  });

  it('asks the store nothing extra when no password was typed', async () => {
    const statement = vi.fn();
    const env = onLan({ connect: async () => ({ ok: true, hostname: 'www-07' }), run: statement });

    const result = await run(env, [storeHost.ip]);

    expect(statement).not.toHaveBeenCalled();
    expect(linesOf(result)).toBe(connectingTo(storeHost.ip, 'www-07'));
  });

  it('names the optional password where a player would look for it', async () => {
    const refused = await run(onLan(), []);

    expect(linesOf(refused)).toContain('redis-cli [-p port] <host> [password]');
    expect(redisCli.manual?.synopsis).toBe('redis-cli [-p port] <host> [password]');
    expect(redisCli.manual?.arguments?.map((argument) => argument.name)).toContain('password');
  });
});

describe('the port the flag names', () => {
  /** Their own box with the daemon up on a port they chose — the pidfile `nmap`, `ps`
   *  and `systemctl` all read, sitting in the real filesystem this client holds. */
  const ownBoxServingOn = (port: number) =>
    buildDirectory({
      var: buildDirectory({
        run: buildDirectory({
          'redis-server.pid': buildFile(formatPidfileContent(SERVICE_CATALOG.redis, port)),
        }),
      }),
    });

  const refusedFlag = async (raw: string | true) => {
    const connect = vi.fn(async () => ({ ok: true as const, hostname: 'unused' }));

    const result = await runWith(onLan({ connect }), [storeHost.ip], new Map([['-p', raw]]));

    return { result, connect };
  };

  it('refuses a flag that named no port, rather than quietly using the default door', async () => {
    const { result, connect } = await refusedFlag(true);

    // The port IS the address of the daemon here, so substituting a number the player
    // did not type would open a store they never asked for and never mention it.
    expect(linesOf(result)).toBe('usage: redis-cli [-p port] <host> [password]');
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses a flag that named something which is not a port', async () => {
    const { result, connect } = await refusedFlag('redis');

    expect(linesOf(result)).toBe('usage: redis-cli [-p port] <host> [password]');
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses port zero, which addresses no door at all', async () => {
    const { result, connect } = await refusedFlag('0');

    expect(linesOf(result)).toBe('usage: redis-cli [-p port] <host> [password]');
    expect(connect).not.toHaveBeenCalled();
  });

  it('reaches the daemon own door when no port was named', async () => {
    const connect = vi.fn(async () => ({ ok: true as const, hostname: storeHost.hostname }));

    await runWith(onLan({ connect }), [storeHost.ip], new Map());

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ port: 6379 }));
  });

  it('consults the player own pidfiles at the port they named', async () => {
    const enter = vi.fn();
    const env = onLan({ enter }, { fs: mockFsViewFromTree(ownBoxServingOn(6380)) });

    // The prompt is handed the port that opened, which on your own box is decided
    // against your own pidfiles rather than by anything the server was told.
    await runWith(env, ['127.0.0.1'], new Map([['-p', '6380']]));

    expect(enter).toHaveBeenCalledWith(expect.objectContaining({ port: 6380 }));
  });

  it('is handed the port by the shell, rather than reading it out of the host slot', () => {
    // The shell binds flags from the command's OWN declaration before `execute` ever
    // runs (`runLine.ts`). Undeclared, `-p` arrives as a POSITIONAL: the host becomes
    // "-p", the port becomes the password, and every test that builds the map by hand
    // stays green while the command is unusable. This is the two-sides-of-one-rule pair
    // for this slice — the declaration and `parsePort`, each correct alone.
    const bound = bindFlags(['-p', '36379', '192.168.1.1'], redisCli.flags ?? {});

    expect(bound).toMatchObject({
      ok: true,
      positional: ['192.168.1.1'],
      flags: new Map([['-p', '36379']]),
    });
  });

  it('refuses the player own box at a port another daemon is holding', async () => {
    const connect = vi.fn(async () => ({ ok: true as const, hostname: 'box' }));
    const sshOnly = buildDirectory({
      var: buildDirectory({
        run: buildDirectory({
          'sshd.pid': buildFile(formatPidfileContent(CATALOG.ssh, 22)),
        }),
      }),
    });
    const env = onLan({ connect }, { fs: mockFsViewFromTree(sshOnly) });

    const result = await runWith(env, ['127.0.0.1'], new Map([['-p', '22']]));

    // The flag addresses a PORT, and a port is not a door until the right daemon is
    // behind it. Opening a "store" on somebody's sshd would be the same defect the
    // server refuses at the other end.
    expect(linesOf(result)).toBe('Could not connect to Redis at 127.0.0.1:22: Connection refused');
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses the player own box at a port nothing there is holding', async () => {
    const connect = vi.fn(async () => ({ ok: true as const, hostname: 'box' }));
    const env = onLan({ connect }, { fs: mockFsViewFromTree(ownBoxServingOn(6380)) });

    const result = await runWith(env, ['127.0.0.1'], new Map([['-p', '6381']]));

    // Their own filesystem is in front of this client, so the refusal costs no
    // round-trip — and a door on a port nobody is holding is not a door.
    expect(linesOf(result)).toBe('Could not connect to Redis at 127.0.0.1:6381: Connection refused');
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('a store behind a forward', () => {
  it('sends a forwarded port on to the gateway instead of looking for the box here', async () => {
    const gateway = innerGatewayOn(ESSID);
    const connect = vi.fn(async () => ({ ok: true as const, hostname: 'vault-04' }));

    await runWith(onLan({ connect }), [gateway.ip], new Map([['-p', String(FORWARD_PORT)]]));

    // Nothing here can answer whether that port leads anywhere: the forward table lives
    // in the gateway's server-side journal. Pre-flighting it against this LAN would
    // refuse every deep connection, because no deep box has a LAN address at all.
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ targetIp: gateway.ip, port: FORWARD_PORT }),
    );
  });

  it('names the box that answered, which no scan of this LAN can show', async () => {
    const env = onLan({ connect: async () => ({ ok: true, hostname: 'vault-04' }) });
    const gateway = innerGatewayOn(ESSID);

    const result = await runWith(env, [gateway.ip], new Map([['-p', String(FORWARD_PORT)]]));

    // The hostname is the DEEP box's, and only the server can know it: a deep address is
    // absent from the generated LAN, so there is nothing here to look it up in.
    expect(linesOf(result)).toBe(
      `Connecting to ${gateway.ip}:${FORWARD_PORT}...\nConnected to Redis vault-04.`,
    );
  });

  it('holds the port it opened on, so every statement re-resolves the same forward', async () => {
    const gateway = innerGatewayOn(ESSID);
    const enter = vi.fn();
    const env = onLan({ connect: async () => ({ ok: true, hostname: 'vault-04' }), enter });

    await runWith(env, [gateway.ip], new Map([['-p', String(FORWARD_PORT)]]));

    // Dropped from the held connection, the first statement would go to 6379 on the
    // GATEWAY — and a forward pulled mid-session could never drop the player either.
    expect(enter).toHaveBeenCalledWith(
      expect.objectContaining({ targetIp: gateway.ip, port: FORWARD_PORT }),
    );
  });

  it('reports a forward that leads nowhere as a box that was not there', async () => {
    const gateway = innerGatewayOn(ESSID);
    const env = onLan({ connect: async () => ({ ok: false, reason: 'unreachable' as const }) });

    const result = await runWith(env, [gateway.ip], new Map([['-p', String(FORWARD_PORT)]]));

    expect(linesOf(result)).toBe(
      `Could not connect to Redis at ${gateway.ip}:${FORWARD_PORT}: No route to host`,
    );
  });

  it('tells a stopped daemon apart from a forward that leads nowhere', async () => {
    const gateway = innerGatewayOn(ESSID);
    const env = onLan({ connect: async () => ({ ok: false, reason: 'refused' as const }) });

    const result = await runWith(env, [gateway.ip], new Map([['-p', String(FORWARD_PORT)]]));

    // The box is there and the forward is good; the daemon is not running. A player who
    // has just stopped one should read that, rather than "no route".
    expect(linesOf(result)).toBe(
      `Could not connect to Redis at ${gateway.ip}:${FORWARD_PORT}: Connection refused`,
    );
  });

  it('spends a password given here behind the forward, not at the gateway door', async () => {
    const gateway = innerGatewayOn(ESSID);
    const statement = vi.fn(async () => ({
      kind: 'answered' as const,
      output: ['OK'],
      failed: false,
    }));
    const env = onLan({ connect: async () => ({ ok: true, hostname: 'vault-04' }), run: statement });

    await runWith(env, [gateway.ip, 'hunter2'], new Map([['-p', String(FORWARD_PORT)]]));

    // The password is an ordinary statement once the store is open, so it travels on the
    // same connection — a copy that dropped the port would AUTH against whatever the
    // gateway itself is running on 6379.
    expect(statement).toHaveBeenCalledWith(
      expect.objectContaining({ targetIp: gateway.ip, port: FORWARD_PORT }),
    );
  });
});
