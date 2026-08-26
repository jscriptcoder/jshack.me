import { describe, expect, it, vi } from 'vitest';
import { hydra } from './hydra';
import {
  mockCommandEnv,
  mockHydraApi,
  mockNetworkViewFromConnectivity,
  mockSession,
} from '../../test/factories/commandEnv';
import { buildColdStartConnectivity } from '../network/interfaces';
import { asMachineId, asPlayerKeyHex, type MachineId } from '../types';
import { computeWorkstationId } from '../identity/workstation';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { isInnerGateway } from '../generation/lanHostIdentity';
import type {
  CommandResult,
  HydraCrackInnerGatewayParams,
  HydraCrackParams,
  HydraCrackPublicParams,
  HydraCrackResult,
  TerminalLine,
} from './types';
import type { ConnectivityState, NetworkInterface } from '../network/interfaces';

/**
 * `hydra` is the player-facing half of the credential layer. It decides NOTHING
 * about what cracks — the server does, against the same `/etc/passwd` `ssh` reads
 * — so these tests are about what the player is TOLD.
 *
 * The distinction that matters: a target that held and a target that was never
 * attacked look identical if both report "nothing found". A player who cannot
 * tell those apart will curate their wordlist to beat a host that has no ssh on
 * it. So each refusal names the thing to go and change.
 */

const OWNER_KEY = 'a'.repeat(64);
const WORKSTATION_ID = computeWorkstationId('skylab', OWNER_KEY);
const ESSID = 'BEAN-THERE-WIFI';

/** Addresses on the LAN this ESSID generates. The gateway is the only kind of host
 *  that fronts a hidden layer, so it is the only one for which `-p` addresses
 *  anything; both are read off the generated world rather than guessed. */
const lanIpWhere = (predicate: (host: LanHost) => boolean): string => {
  const host = generateHomeLan(ESSID).hosts.find(predicate);
  if (host === undefined) throw new Error('no matching host on the generated LAN');
  return host.ip;
};
const INNER_GATEWAY_IP = lanIpWhere((host) => host.kind === 'router' && isInnerGateway(host));
const SIBLING_IP = lanIpWhere((host) => host.kind === 'machine');

/** A workstation associated with an AP and holding a lease — hydra needs a LAN
 *  under it before it can name a target. */
const connectedState = (): ConnectivityState => {
  const cold = buildColdStartConnectivity(OWNER_KEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
  const connected: NetworkInterface = {
    ...wlan0,
    association: { essid: ESSID, bssid: 'AA:BB:CC:DD:EE:FF' },
    ipv4: '192.168.4.50',
  };
  return { interfaces: new Map(cold.interfaces).set('wlan0', connected) };
};

type EnvOpts = {
  readonly result?: HydraCrackResult;
  readonly machineId?: MachineId;
  readonly connectivity?: ConnectivityState;
};

const hydraEnv = (opts: EnvOpts = {}) => {
  const crack = vi.fn<(params: HydraCrackParams) => Promise<HydraCrackResult>>(
    async () => opts.result ?? { ok: true, port: 22, cracked: [], wordlistFound: true },
  );
  const crackPublic = vi.fn<(params: HydraCrackPublicParams) => Promise<HydraCrackResult>>(
    async () => opts.result ?? { ok: true, port: 22, cracked: [], wordlistFound: true },
  );
  const crackInnerGateway = vi.fn<
    (params: HydraCrackInnerGatewayParams) => Promise<HydraCrackResult>
  >(async () => opts.result ?? { ok: true, port: 2222, cracked: [], wordlistFound: true });
  const env = mockCommandEnv({
    identity: { publicKeyHex: asPlayerKeyHex(OWNER_KEY), privateKeyHex: 'b'.repeat(64) },
    session: mockSession({ machineId: opts.machineId ?? asMachineId(WORKSTATION_ID) }),
    network: mockNetworkViewFromConnectivity(opts.connectivity ?? connectedState()),
    hydra: mockHydraApi({ crack, crackPublic, crackInnerGateway }),
  });
  return { env, crack, crackPublic, crackInnerGateway };
};

const drain = async (
  result: CommandResult,
): Promise<{ readonly lines: readonly TerminalLine[]; readonly text: string }> => {
  if (result.kind !== 'async') throw new Error('async expected');
  const lines: TerminalLine[] = [];
  for await (const line of result.lines) lines.push(line);
  return { lines, text: lines.map((line) => line.content).join('\n') };
};

const syncResult = (
  result: CommandResult,
): { readonly text: string; readonly kinds: readonly string[] } => {
  if (result.kind !== 'sync') throw new Error('sync expected');
  return {
    text: result.lines.map((line) => line.content).join('\n'),
    kinds: result.lines.map((line) => line.kind),
  };
};

describe('hydra', () => {
  it('reports each cracked credential with its account and password', async () => {
    const { env } = hydraEnv({
      result: {
        ok: true,
        port: 22,
        cracked: [
          { username: 'guest', password: 'letmein' },
          { username: 'deploy', password: 'welcome1' },
        ],
        wordlistFound: true,
      },
    });

    const { text } = await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(text).toContain('login: guest   password: letmein');
    expect(text).toContain('login: deploy   password: welcome1');
    expect(text).toContain('2 valid password(s) found');
  });

  it('says the wordlist did not match when a reachable target holds', async () => {
    // The target WAS attacked and survived. That is a fact about the player's
    // wordlist, and it must not read like a failed connection.
    const { env } = hydraEnv({ result: { ok: true, port: 22, cracked: [], wordlistFound: true } });

    const { text } = await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(text).toContain('0 valid passwords found');
    expect(text).toContain('nothing in your wordlist matched');
  });

  it('tells the player to install the wordlist when they have none', async () => {
    // Distinct from "held": nothing was tried at all, and the fix is an install
    // rather than a better list.
    const { env } = hydraEnv({ result: { ok: true, port: 22, cracked: [], wordlistFound: false } });

    const { lines, text } = await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(text).toContain('apt install hydra');
    expect(lines.some((line) => line.kind === 'error')).toBe(true);
    expect(text).not.toContain('0 valid passwords found');
  });

  it('names the missing service rather than reporting a failed crack', async () => {
    const { env } = hydraEnv({ result: { ok: false, error: 'service_not_running' } });

    const { text } = await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(text).toContain('no such service on that host');
    expect(text).toContain('nmap');
  });

  it('tells a player whose session on this box has ended what to do about it', async () => {
    // Standing on a box you no longer hold is the new way a sweep can be refused,
    // and it is recoverable — so it must read as "log back in", not as a target
    // that resisted.
    const { env } = hydraEnv({ result: { ok: false, error: 'no_session' } });

    const { text } = await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(text).toContain('not logged in on this machine');
    expect(text).not.toContain('no_session');
  });

  it('names a machine it cannot attack from rather than blaming the target', async () => {
    const { env } = hydraEnv({ result: { ok: false, error: 'caller_not_on_lan' } });

    const { text } = await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(text).toContain('cannot attack from this machine');
    expect(text).not.toContain('caller_not_on_lan');
  });

  it('distinguishes a wordlist it could not read from one that held nothing', async () => {
    const { env } = hydraEnv({ result: { ok: false, error: 'wordlist_lookup_failed' } });

    const { text } = await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(text).toContain('could not read your wordlist');
    expect(text).not.toContain('0 valid passwords found');
  });

  it('distinguishes a target it could not reach from one that resisted', async () => {
    const { env } = hydraEnv({ result: { ok: false, error: 'patches_lookup_failed' } });

    const { text } = await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(text).toContain('could not reach the target');
    expect(text).not.toContain('0 valid passwords found');
  });

  it('names an unreachable host rather than reporting a failed crack', async () => {
    const { env } = hydraEnv({ result: { ok: false, error: 'host_unreachable' } });

    const { text } = await drain(await hydra.execute(env, ['10.0.0.1'], new Map()));

    expect(text).toContain('no route to host');
  });

  it('passes the target, service and account through to the server unchanged', async () => {
    const { env, crack } = hydraEnv();

    await drain(await hydra.execute(env, ['192.168.4.31', 'ssh', 'root'], new Map()));

    expect(crack).toHaveBeenCalledWith({
      essid: ESSID,
      target: '192.168.4.31',
      service: 'ssh',
      username: 'root',
      callerMachineId: WORKSTATION_ID,
      sourceIp: '192.168.4.50',
    });
  });

  it("names the address the attack comes from, so the target's log can record it", async () => {
    // The same address `ssh` reports for a login from this machine: a sweep and a
    // login from one box must not appear to the defender as two different callers.
    const { env, crack } = hydraEnv();

    await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(crack).toHaveBeenCalledWith(expect.objectContaining({ sourceIp: '192.168.4.50' }));
  });

  it('attacks ssh and every account when neither is named', async () => {
    const { env, crack } = hydraEnv();

    await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(crack).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'ssh', username: undefined }),
    );
  });

  it('says it is enumerating accounts when no user is named', async () => {
    // The player has to be able to tell a sweep from a targeted run: one explains
    // several result lines, the other explains exactly one.
    const { env } = hydraEnv();

    const { text } = await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(text).toContain('Enumerating accounts from the target');
    expect(text).not.toContain('Targeting login:');
  });

  it('names the wordlist file it is reading, and streams as ordinary output', async () => {
    // The path is how a player learns where to go and edit — growing that file is
    // the whole progression, and nothing else in the game points at it.
    const { env } = hydraEnv();

    const { lines, text } = await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(text).toContain('/usr/share/wordlists/passwords.txt');
    expect(lines.every((line) => line.kind === 'text')).toBe(true);
  });

  it('names the account it is attacking when a user is given', async () => {
    const { env } = hydraEnv();

    const { text } = await drain(await hydra.execute(env, ['192.168.4.31', 'ssh', 'root'], new Map()));

    expect(text).toContain('Targeting login: root');
    expect(text).not.toContain('Enumerating accounts');
  });

  it('renders a refusal as an error line, not as ordinary output', async () => {
    // A refusal that renders like normal output reads as a result. This one is the
    // difference between "your wordlist failed" and "nothing was ever tried".
    const { env } = hydraEnv({ result: { ok: false, error: 'host_unreachable' } });

    const { lines } = await drain(await hydra.execute(env, ['10.0.0.1'], new Map()));

    expect(lines.filter((line) => line.kind === 'error')).toHaveLength(1);
  });

  it('exits 0 after a completed run', async () => {
    const { env } = hydraEnv();
    const result = await hydra.execute(env, ['192.168.4.31'], new Map());

    if (result.kind !== 'async') throw new Error('async expected');
    await drain(result);

    expect(await result.exitCode()).toBe(0);
  });

  it('refuses with usage when no target is given', async () => {
    const { env, crack } = hydraEnv();

    const { text, kinds } = syncResult(await hydra.execute(env, [], new Map()));

    expect(text).toContain('usage: hydra [-p port] <host> [service] [user]');
    // A refusal renders red: it is not a result the player should read as output.
    expect(kinds).toEqual(['error']);
    expect(crack).not.toHaveBeenCalled();
  });

  it('refuses while offline, without asking the server', async () => {
    const { env, crack } = hydraEnv({ connectivity: buildColdStartConnectivity(OWNER_KEY) });

    const { text, kinds } = syncResult(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(text).toContain('not connected to a network');
    expect(kinds).toEqual(['error']);
    expect(crack).not.toHaveBeenCalled();
  });

  it('routes a public IP to the cross-player action, which names no source address', async () => {
    // A public IP is not on the player's own LAN, so it resolves the way `ssh`
    // resolves one: server-side, against the access point that bears it. The
    // address the target records is derived there too — this call carries none,
    // because a log line on a foreign box is evidence rather than decoration.
    const { env, crack, crackPublic } = hydraEnv();

    await drain(await hydra.execute(env, ['203.0.113.7'], new Map()));

    expect(crack).not.toHaveBeenCalled();
    expect(crackPublic).toHaveBeenCalledWith({
      essid: ESSID,
      target: '203.0.113.7',
      service: 'ssh',
      port: undefined,
      username: undefined,
      callerMachineId: WORKSTATION_ID,
    });
  });

  it('carries -p to a public IP as the destination port behind it', async () => {
    // A public IP names an access point, and its forward table is addressed by port:
    // this is how a player says "the machine somebody published", not "the gateway".
    const { env, crackPublic } = hydraEnv();

    await drain(await hydra.execute(env, ['203.0.113.7'], new Map([['-p', '5544']])));

    expect(crackPublic).toHaveBeenCalledWith(expect.objectContaining({ port: 5544 }));
  });

  it.each([
    ['a service name', 'ssh' as string | true],
    ['a valueless flag', true as string | true],
    ['a fractional port', '2.5' as string | true],
    ['port zero', '0' as string | true],
    ['a negative port', '-1' as string | true],
  ])('falls back to the default door when -p is given %s', async (_case, raw) => {
    // Anything that is not a port means the player named none, which is the gateway.
    // Not an error — the target they typed is still a real target — but it must not
    // become port 1 or port 0 either: a wrong door is worse than the default one.
    const { env, crackPublic } = hydraEnv();

    await drain(await hydra.execute(env, ['203.0.113.7'], new Map([['-p', raw]])));

    expect(crackPublic).toHaveBeenCalledWith(expect.objectContaining({ port: undefined }));
  });

  it('documents -p in the manual, so a player can find the door at all', async () => {
    // The forward table is addressed by port and nothing else advertises that. A flag
    // nobody can discover is a mechanic nobody has.
    expect(hydra.manual?.synopsis).toContain('-p');
    expect(`${hydra.manual?.description} ${JSON.stringify(hydra.manual?.examples)}`).toContain(
      '-p',
    );
  });

  it('ignores -p on an ordinary host, where the service already picks the port', async () => {
    // A sibling on your own network IS the machine — it has no forward table to
    // address, and `hydra <host> ssh` already attacks wherever that sshd listens.
    const { env, crack, crackPublic } = hydraEnv();

    await drain(await hydra.execute(env, [SIBLING_IP], new Map([['-p', '5544']])));

    expect(crackPublic).not.toHaveBeenCalled();
    expect(crack).toHaveBeenCalledWith(
      expect.not.objectContaining({ port: expect.anything() as unknown }),
    );
  });

  it('sends -p on an INNER GATEWAY to the deep action — the one host with a forward table', async () => {
    // An inner gateway is the door to a hidden layer, and the port is what addresses a
    // box behind it. The same rule `ssh -p <fwd> <inner>` routes by, so the two tools
    // reach the same box.
    const { env, crack, crackPublic, crackInnerGateway } = hydraEnv();

    await drain(await hydra.execute(env, [INNER_GATEWAY_IP], new Map([['-p', '2222']])));

    expect(crackInnerGateway).toHaveBeenCalledWith(
      expect.objectContaining({ target: INNER_GATEWAY_IP, port: 2222, essid: ESSID }),
    );
    expect(crack).not.toHaveBeenCalled();
    expect(crackPublic).not.toHaveBeenCalled();
  });

  it('attacks the gateway itself when no port is named at all', async () => {
    // Without `-p` there is no forward to follow, on a gateway as much as anywhere
    // else: `hydra <gateway>` is an ordinary own-LAN sweep of the box at that address.
    const { env, crack, crackInnerGateway } = hydraEnv();

    await drain(await hydra.execute(env, [INNER_GATEWAY_IP], new Map()));

    expect(crackInnerGateway).not.toHaveBeenCalled();
    expect(crack).toHaveBeenCalledTimes(1);
  });

  it('attacks the gateway itself when -p names the port it serves', async () => {
    // Its own sshd is the gateway, not a forward into the layer behind it — so this is
    // an ordinary own-LAN sweep, traced from the player's real LAN address.
    const { env, crack, crackInnerGateway } = hydraEnv();

    await drain(await hydra.execute(env, [INNER_GATEWAY_IP], new Map([['-p', '22']])));

    expect(crackInnerGateway).not.toHaveBeenCalled();
    expect(crack).toHaveBeenCalledTimes(1);
  });

  it('keeps a private address on the own-LAN action', async () => {
    const { env, crack, crackPublic } = hydraEnv();

    await drain(await hydra.execute(env, ['192.168.4.31'], new Map()));

    expect(crackPublic).not.toHaveBeenCalled();
    expect(crack).toHaveBeenCalledTimes(1);
  });

  it('runs from whatever machine the player is standing on', async () => {
    // Tools run where you stand. A rooted box with hydra installed on it is a
    // place to attack FROM, and the box the player is on is the one whose
    // wordlist the sweep uses — so the command names it and lets the server
    // decide, rather than refusing on the player's behalf.
    const standing = asMachineId('192.168.4.31');
    const { env, crack } = hydraEnv({ machineId: standing });

    const { text } = await drain(await hydra.execute(env, ['192.168.4.9'], new Map()));

    expect(crack).toHaveBeenCalledWith(
      expect.objectContaining({ callerMachineId: standing, target: '192.168.4.9' }),
    );
    expect(text).toContain('Hydra starting attack');
  });
});

/**
 * The store door has no logins, and `hydra` has to say so.
 *
 * Every other service in the catalog authenticates a PERSON, so the command's whole
 * vocabulary — enumerating accounts, targeting a login, reporting one beside a password
 * — assumes there is a name involved. Against a store there is not: one lock, no
 * accounts, and a status line promising otherwise sends the player looking for a
 * username that does not exist.
 */
describe('hydra against a door with no accounts', () => {
  it('reports the password with no login field at all', async () => {
    const { env } = hydraEnv({
      result: { ok: true, port: 6379, cracked: [{ password: 'sunshine' }], wordlistFound: true },
    });

    const { text } = await drain(
      await hydra.execute(env, ['192.168.4.31', 'redis'], new Map()),
    );

    expect(text).toContain('[6379][redis] host: 192.168.4.31   password: sunshine');
    expect(text).not.toContain('login:');
    expect(text).toContain('1 valid password(s) found');
  });

  it('says it is attacking the store password rather than enumerating accounts', async () => {
    const { env } = hydraEnv({
      result: { ok: true, port: 6379, cracked: [], wordlistFound: true },
    });

    const { text } = await drain(
      await hydra.execute(env, ['192.168.4.31', 'redis'], new Map()),
    );

    expect(text).toContain('This service has no logins');
    expect(text).not.toContain('Enumerating accounts');
  });

  it('says the same when a login was named, instead of pretending to target it', async () => {
    const { env, crack } = hydraEnv({
      result: { ok: true, port: 6379, cracked: [{ password: 'sunshine' }], wordlistFound: true },
    });

    const { text } = await drain(
      await hydra.execute(env, ['192.168.4.31', 'redis', 'root'], new Map()),
    );

    // The name still travels — the server answers it rather than filtering by it, so a
    // player who guessed at the syntax still gets the store's password.
    expect(crack).toHaveBeenCalledWith(expect.objectContaining({ username: 'root' }));
    expect(text).toContain('This service has no logins');
    expect(text).not.toContain('Targeting login: root');
  });

  it('goes on naming the login for every door that has them', async () => {
    const { env } = hydraEnv({ result: { ok: true, port: 22, cracked: [], wordlistFound: true } });

    const { text } = await drain(
      await hydra.execute(env, ['192.168.4.31', 'ssh', 'root'], new Map()),
    );

    expect(text).toContain('Targeting login: root');
    expect(text).not.toContain('This service has no logins');
  });

  it('does not fall over on a service the world has no row for', async () => {
    const { env } = hydraEnv({ result: { ok: false, error: 'service_not_running' } });

    const { text } = await drain(
      await hydra.execute(env, ['192.168.4.31', 'nosuchd'], new Map()),
    );

    // The service name is player input, so an unknown one is an ordinary answer rather
    // than a fault — and the catalog lookup that decides how to describe the door has to
    // survive finding no row at all, before the request is ever sent.
    expect(text).toContain('no such service on that host');
  });

  it('tells the player a store was open rather than reporting that it held', async () => {
    const { env } = hydraEnv({ result: { ok: false, error: 'no_password_set' } });

    const { text } = await drain(
      await hydra.execute(env, ['192.168.4.31', 'redis'], new Map()),
    );

    // "0 valid passwords found" here would be the exact opposite of the truth: there is
    // nothing to find because there is nothing in the way.
    expect(text).toContain('no password set (open access)');
    expect(text).toContain('redis-cli');
    expect(text).not.toContain('valid password');
  });
});
