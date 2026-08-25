import { describe, expect, it, vi } from 'vitest';
import { rediscli } from './rediscli';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockNetworkViewFromConnectivity,
  mockRedisApi,
  mockScanApi,
} from '../../test/factories/commandEnv';
import { generateHomeLan } from '../generation/generateHomeLan';
import { hostServices } from '../generation/remoteHostFs';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { formatPidfileContent } from '../services/pidfile';
import type { CommandEnv, CommandResult, RedisApi } from './types';

/**
 * `rediscli <host>` — the fifth door, and the only one that asks the player for
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

const onLan = (over: Partial<RedisApi> = {}, envOver: Partial<CommandEnv> = {}) =>
  mockCommandEnv({
    redis: mockRedisApi({ connect: async () => ({ ok: true, hostname: 'unused' }), ...over }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    scan: mockScanApi({ resolveOccupants: async () => [] }),
    ...envOver,
  });

const run = (env: CommandEnv, args: readonly string[]) =>
  rediscli.execute(env, args, new Map());

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

    expect(linesOf(result)).toBe('usage: rediscli <host> [password]');
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

describe('the player own box, once it runs a store', () => {
  /** Their box with the daemon actually up — the pidfile `nmap`, `ps` and `systemctl`
   *  all read, sitting in the real filesystem this client is holding. */
  const ownBoxRunningRedis = () =>
    buildDirectory({
      var: buildDirectory({
        run: buildDirectory({
          'redis.pid': buildFile(formatPidfileContent(SERVICE_CATALOG.redis, 6379)),
        }),
      }),
    });

  it('opens it, rather than refusing a daemon that is plainly listening', async () => {
    const connect = vi.fn(async () => ({ ok: true as const, hostname: 'box' }));
    const env = onLan({ connect }, { fs: mockFsViewFromTree(ownBoxRunningRedis()) });

    await run(env, ['127.0.0.1']);

    expect(connect).toHaveBeenCalled();
  });

  it('holds it under the address it was LEASED, whichever name reached it', async () => {
    const enter = vi.fn();
    const env = onLan(
      { connect: async () => ({ ok: true, hostname: 'box' }), enter },
      { fs: mockFsViewFromTree(ownBoxRunningRedis()) },
    );

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
    expect(rediscli.withoutTty).toBeDefined();
  });

  it('documents itself for man and help, with an example a player can copy', () => {
    // Criterion: `man rediscli` and `help` list the command. Both read the registry
    // row, so what they show is exactly this.
    expect(rediscli.manual?.synopsis).toBe('rediscli <host> [password]');
    expect(rediscli.description.length).toBeGreaterThan(10);
    expect(rediscli.manual?.arguments?.[0]?.name).toBe('host');
    // Every example is a line a player can copy, and every argument says what it is
    // for. An example with no command, or an argument with no description, is a manual
    // page that looks complete and teaches nothing.
    expect(
      rediscli.manual?.examples?.every(
        (example) => example.command.startsWith('rediscli ') && example.description.length > 10,
      ),
    ).toBe(true);
    expect(
      rediscli.manual?.arguments?.every((argument) => argument.description.length > 10),
    ).toBe(true);
    // And it names the verb that opens a locked store, because the password argument is
    // only half the answer: a player who did not have it at connect time needs the other.
    expect(rediscli.manual?.description).toContain('AUTH <password>');
  });

  it('is reachable from the box the player is standing on and nowhere else', () => {
    // A store connection is made from where you stand. `localhost-only` is what every
    // other door that opens a prompt declares.
    expect(rediscli.availability).toEqual({ kind: 'localhost-only' });
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

    expect(linesOf(refused)).toContain('rediscli <host> [password]');
    expect(rediscli.manual?.synopsis).toBe('rediscli <host> [password]');
    expect(rediscli.manual?.arguments?.map((argument) => argument.name)).toContain('password');
  });
});
