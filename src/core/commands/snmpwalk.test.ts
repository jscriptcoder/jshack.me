import { describe, expect, it, vi } from 'vitest';
import { snmpwalk } from './snmpwalk.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockNetworkViewFromConnectivity,
  mockPatchApi,
  mockSession,
  mockSnmpApi,
} from '../../test/factories/commandEnv.js';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces.js';
import { assignHomeNetwork } from '../network/homeNetwork.js';
import { applyPatches } from '../filesystem/applyPatches.js';
import { LOCAL_FILTER_SEED } from '../network/iptablesRules.js';
import { SNMPD_LOG_PATH, SNMPD_LOG_PERMISSIONS } from '../logging/snmpdLog.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import {
  AGENT_BOX_HOSTNAME,
  agentBoxCommunity,
  agentBoxTree,
  withAgentStopped,
  withDaemonOn,
} from '../../test/factories/snmpAgentBox.js';
import { asAbsPath, asMachineId, asPlayerKeyHex } from '../types.js';
import type { Directory } from '../filesystem/types.js';
import type { CommandEnv, CommandResult, PatchApi, SnmpApi, SnmpWalkResult } from './types.js';

/**
 * `snmpwalk <host> [community]` — the first thing a player can DO with a device.
 *
 * Until now a router or a switch was a box you could scan and never touch. This asks
 * one what it is, and the answer is deliberately shallow: a name, a platform, a contact
 * and the addresses it holds. Not one port it forwards — that costs a community string
 * somebody has to crack, and this tier exists to make a player want to.
 *
 * Every failure is ONE message. A device that is not there, a device whose agent was
 * stopped, and a device that refused the community all time out in the same words,
 * because a real agent drops a bad community without a word. Told apart, this command
 * would map which devices hold a community worth cracking before a wordlist was spent.
 */

const PUBKEY = asPlayerKeyHex('a'.repeat(64));
const ESSID = 'BEAN-THERE-WIFI';
const GATEWAY_IP = '10.0.0.1';
const PUBLIC_IP = '82.14.203.77';

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

const ANSWERED: SnmpWalkResult = {
  ok: true,
  tier: 'read-only',
  identity: {
    hostname: 'gw-main',
    kind: 'router',
    platform: 'Linux',
    sysContact: 'netops@corp.local',
    addresses: [GATEWAY_IP, PUBLIC_IP],
  },
};

const onLan = (over: Partial<SnmpApi> = {}, envOver: Partial<CommandEnv> = {}): CommandEnv =>
  mockCommandEnv({
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    snmp: mockSnmpApi({ walk: async () => ANSWERED, ...over }),
    ...envOver,
  });

const run = (env: CommandEnv, args: readonly string[]) => snmpwalk.execute(env, args, new Map());

/** Narrows to the only result shape this command produces. `snmpwalk` prints once and
 *  exits — there is nothing to stream, unlike a scan that fills a table row by row. */
const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return result;
};

const linesOf = (result: CommandResult): string =>
  sync(result)
    .lines.map((line) => line.content)
    .join('\n');

describe('walking a device that answers', () => {
  it('prints what the device is, and what it is not', async () => {
    const result = await run(onLan(), [GATEWAY_IP]);

    expect(linesOf(result)).toBe(
      [
        `[READ-ONLY] Community "public" accepted on ${GATEWAY_IP}.`,
        '',
        'sysDescr    = Linux gw-main',
        'sysName     = gw-main',
        'sysContact  = netops@corp.local',
        `interface.1 = eth0 (${GATEWAY_IP})`,
        `interface.2 = eth1 (${PUBLIC_IP})`,
        '',
        '5 OIDs returned. Community "public" is READ-ONLY.',
        "Retry with a read-write community to see this device's port table.",
      ].join('\n'),
    );
    expect(sync(result).exitCode).toBe(0);
  });

  it('asks with `public` when the player names no community', async () => {
    const walk = vi.fn<SnmpApi['walk']>(async () => ANSWERED);

    await run(onLan({ walk }), [GATEWAY_IP]);

    // The read-only string being `public` is the actual joke of real SNMP, so the free
    // first walk is the joke landing rather than a convenience.
    expect(walk).toHaveBeenCalledWith({
      essid: ESSID,
      targetIp: GATEWAY_IP,
      community: 'public',
      callerMachineId: asMachineId('localhost'),
    });
  });

  it('sends the community the player typed, and says which one answered', async () => {
    const walk = vi.fn<SnmpApi['walk']>(async () => ANSWERED);

    const result = await run(onLan({ walk }), [GATEWAY_IP, 'corpnet']);

    expect(walk.mock.calls[0]![0]).toMatchObject({ community: 'corpnet' });
    expect(linesOf(result)).toContain(`[READ-ONLY] Community "corpnet" accepted on ${GATEWAY_IP}.`);
  });
});

describe('walking a device with a community that reads its port table', () => {
  const CRACKED: SnmpWalkResult = {
    ok: true,
    tier: 'read-write',
    identity: {
      hostname: 'gw-main',
      kind: 'router',
      platform: 'Linux',
      sysContact: 'netops@corp.local',
      addresses: [GATEWAY_IP, PUBLIC_IP],
    },
    portTables: [
      { kind: 'nat', forwards: [{ publicPort: 2222, internalIp: '10.0.0.10', internalPort: 22 }] },
      { kind: 'filter', denies: [] },
    ],
  };

  it('prints the port table and what to write, not the retry hint', async () => {
    const result = await run(onLan({ walk: async () => CRACKED }), [GATEWAY_IP, 'corpnet']);

    expect(linesOf(result)).toContain('forward.2222 = 10.0.0.10:22');
    expect(linesOf(result)).toContain('Writable: snmpset');
    // The read-only trailer tells a player to go and find a better community. Printed
    // to somebody who just used one, it would read as a failure.
    expect(linesOf(result)).not.toContain('Retry with a read-write community');
  });

  it('renders an empty table as an empty table, never as a refusal', async () => {
    // Default-deny makes this the usual answer from a fresh router, and it arrives at
    // the same exit code as a full one: the community worked.
    const result = await run(
      onLan({ walk: async () => ({ ...CRACKED, portTables: [{ kind: 'nat', forwards: [] }] }) }),
      [GATEWAY_IP, 'corpnet'],
    );

    expect(sync(result).exitCode).toBe(0);
    expect(linesOf(result)).toContain('This device forwards no ports.');
    expect(linesOf(result)).not.toContain('Timeout');
  });
});

describe('walking a device that does not answer', () => {
  it('times out in the words a real agent’s silence produces', async () => {
    const result = await run(onLan({ walk: async () => ({ ok: false }) }), [GATEWAY_IP]);

    expect(linesOf(result)).toBe(`Timeout: No Response from ${GATEWAY_IP}`);
    expect(sync(result).exitCode).toBe(1);
  });

  it('says the same thing whatever the reason was', async () => {
    // A refused community, a stopped agent and an address with nothing on it are ONE
    // answer here by design. The server knows which is which, because the log it writes
    // has to; this client never learns, and so can never be used to sort devices into
    // worth-cracking and not.
    const refused = await run(onLan({ walk: async () => ({ ok: false }) }), [GATEWAY_IP, 'private']);
    const nothing = await run(onLan({ walk: async () => ({ ok: false }) }), [GATEWAY_IP]);

    expect(linesOf(refused)).toBe(linesOf(nothing));
  });

  it('needs a target to walk', async () => {
    const result = await run(onLan(), []);

    expect(linesOf(result)).toBe('usage: snmpwalk <host>[:<port>] [community]');
    expect(sync(result).exitCode).toBe(1);
  });

  it('cannot reach anything at all with no network', async () => {
    const walk = vi.fn<SnmpApi['walk']>(async () => ANSWERED);
    const env = onLan({ walk }, {
      network: mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY)),
    });

    const result = await run(env, [GATEWAY_IP]);

    expect(linesOf(result)).toBe(`snmpwalk: ${GATEWAY_IP}: Network is unreachable`);
    expect(walk).not.toHaveBeenCalled();
  });
});

describe('naming a device behind a gateway', () => {
  it('sends the port as a port and the address without it', async () => {
    const walk = vi.fn<SnmpApi['walk']>(async () => ANSWERED);

    await run(onLan({ walk }), ['10.0.0.7:2222', 'corpnet']);

    expect(walk).toHaveBeenCalledWith(
      expect.objectContaining({ targetIp: '10.0.0.7', port: 2222 }),
    );
  });

  it('sends a bare address with no port at all, leaving the agent its own', async () => {
    // Absent rather than 161. The default is the server's, and a client that stated it
    // would be a client that could be told to state a different one.
    const walk = vi.fn<SnmpApi['walk']>(async () => ANSWERED);

    await run(onLan({ walk }), ['10.0.0.7', 'corpnet']);

    expect(walk).toHaveBeenCalledWith(expect.objectContaining({ targetIp: '10.0.0.7' }));
    expect(walk.mock.calls[0]?.[0].port).toBeUndefined();
  });

  it('echoes the address the player typed, port and all', async () => {
    // A tool prints back the argument it was given. A header that dropped the port would
    // describe a different request than the one made, and a timeout that dropped it
    // would send the player looking at the wrong box.
    const answered = sync(await run(onLan(), ['10.0.0.7:2222', 'corpnet']));
    expect(answered.lines[0]?.content).toContain('10.0.0.7:2222');

    const silent = sync(await run(onLan({ walk: async () => ({ ok: false }) }), ['10.0.0.7:2222']));
    expect(silent.lines[0]?.content).toBe('Timeout: No Response from 10.0.0.7:2222');
  });
});

describe('walking from a hop', () => {
  it('walks the hop network from the hop box, whatever the home card is doing', async () => {
    const walk = vi.fn<SnmpApi['walk']>(async () => ANSWERED);
    // Standing in a shell on `hop-box` on another network; the player's own WiFi is
    // still associated to ESSID and does not matter at all.
    const env = mockCommandEnv({
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      snmp: mockSnmpApi({ walk }),
      session: mockSession({ essid: 'HOP-NET', machineId: asMachineId('hop-box') }),
    });

    await snmpwalk.execute(env, [GATEWAY_IP], new Map());

    expect(walk).toHaveBeenCalledWith({
      essid: 'HOP-NET',
      targetIp: GATEWAY_IP,
      community: 'public',
      callerMachineId: asMachineId('hop-box'),
    });
  });

  it('names the box the shell stands on by its loopback address', async () => {
    // The server places loopback by its address, so a name it does not resolve would
    // walk nothing at all.
    const walk = vi.fn<SnmpApi['walk']>(async () => ANSWERED);
    const env = mockCommandEnv({
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      snmp: mockSnmpApi({ walk }),
      session: mockSession({ essid: 'HOP-NET', machineId: asMachineId('hop-box') }),
    });

    const result = await snmpwalk.execute(env, ['localhost'], new Map());

    expect(walk.mock.calls[0]![0]).toMatchObject({ targetIp: '127.0.0.1' });
    // The header still echoes what the player typed.
    expect(linesOf(result)).toContain('[READ-ONLY] Community "public" accepted on localhost.');
  });
});

/**
 * The agent on your OWN box.
 *
 * Answered here rather than through the server, for the reason every other own-box door
 * gives: the server's same-LAN vantage excludes the caller, so a walk of your own
 * address that went out found nothing there and timed out, while a stranger's walk of
 * the very same agent answered. A player could not read their own device over SNMP.
 *
 * What differs is WHERE the decision runs, never what it decides: the same community
 * judgement, the same identity and port tables, and the same two lines in the box's own
 * `snmpd.log`, all read off the machine as it stands.
 */
describe('the player own box, once it runs an agent', () => {
  const HOSTNAME = AGENT_BOX_HOSTNAME;
  const OWN_IP = assignHomeNetwork(PUBKEY, ESSID).localIp;
  const RW_COMMUNITY = agentBoxCommunity(PUBKEY);

  /** The server door, deliberately unreachable. A walk of your own box that took the
   *  network path would throw here rather than quietly pass. */
  const NOT_WIRED = () => {
    throw new Error('own-box snmpwalk must not reach the server');
  };

  const ownBoxRunningAgent = (rules?: string): Directory => agentBoxTree(PUBKEY, rules);

  const viewOf = (tree: Directory) =>
    mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') });

  /** What this client walked in holding, and what the machine has become since. They are
   *  the same box unless a test says otherwise. */
  type Write = {
    readonly path: string;
    readonly content: string | null;
    readonly options: Parameters<PatchApi['write']>[2];
  };

  const ownBoxEnv = (held: Directory, machine: Directory = held) => {
    const writes: Write[] = [];
    const env = mockCommandEnv({
      snmp: mockSnmpApi({ walk: NOT_WIRED }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      hostname: HOSTNAME,
      fs: { ...viewOf(held), reload: async () => viewOf(machine) },
      patches: mockPatchApi({
        write: async (path, content, options) => {
          writes.push({ path, content, options });
          return { ok: true };
        },
      }),
    });
    return { env, writes };
  };

  const snmpdLogOf = (writes: readonly Write[]): string =>
    writes.find((write) => write.path === SNMPD_LOG_PATH)?.content ?? '';

  it('answers a walk of localhost without asking the server', async () => {
    const { env } = ownBoxEnv(ownBoxRunningAgent());

    const result = await run(env, ['localhost']);

    // One address: a workstation fronts nothing, so it has no outside face to show.
    expect(linesOf(result)).toBe(
      [
        '[READ-ONLY] Community "public" accepted on localhost.',
        '',
        `sysDescr    = Linux ${HOSTNAME}`,
        `sysName     = ${HOSTNAME}`,
        'sysContact  = netops@corp.local',
        `interface.1 = eth0 (${OWN_IP})`,
        '',
        '4 OIDs returned. Community "public" is READ-ONLY.',
        "Retry with a read-write community to see this device's port table.",
      ].join('\n'),
    );
    expect(sync(result).exitCode).toBe(0);
  });

  it('answers a walk of the box own LAN address the same way', async () => {
    const { env } = ownBoxEnv(ownBoxRunningAgent());

    const result = await run(env, [OWN_IP]);

    expect(linesOf(result)).toContain(`[READ-ONLY] Community "public" accepted on ${OWN_IP}.`);
    expect(linesOf(result)).toContain(`interface.1 = eth0 (${OWN_IP})`);
  });

  it('shows the port tables to the read-write community the install printed', async () => {
    const { env } = ownBoxEnv(ownBoxRunningAgent(`${LOCAL_FILTER_SEED}deny 6379\n`));

    const result = await run(env, ['127.0.0.1', RW_COMMUNITY]);

    expect(linesOf(result)).toContain(
      `[READ-WRITE] Community "${RW_COMMUNITY}" accepted on 127.0.0.1.`,
    );
    expect(linesOf(result)).toMatch(/inputPort\.6379 += deny/);
    expect(linesOf(result)).toContain(`snmpset 127.0.0.1 ${RW_COMMUNITY} inputPort.<port>=deny`);
  });

  it('answers its owner even with its own port denied to the network', async () => {
    // The filter closes a port to the NETWORK. The box's own addresses never cross it,
    // which is what the seeded file promises its owner.
    const { env } = ownBoxEnv(ownBoxRunningAgent(`${LOCAL_FILTER_SEED}deny 161\n`));

    const result = await run(env, [OWN_IP]);

    expect(sync(result).exitCode).toBe(0);
  });

  it('times out when the agent is stopped', async () => {
    const { env } = ownBoxEnv(withAgentStopped(ownBoxRunningAgent()));

    const result = await run(env, ['localhost']);

    expect(linesOf(result)).toBe('Timeout: No Response from localhost');
    expect(sync(result).exitCode).toBe(1);
  });

  it('times out when the agent was stopped since this client last looked', async () => {
    // A `systemctl stop` in another tab: the copy held still shows the daemon up, the
    // machine itself does not, and the machine is the authority.
    const running = ownBoxRunningAgent();
    const { env } = ownBoxEnv(running, withAgentStopped(running));

    const result = await run(env, ['localhost']);

    expect(linesOf(result)).toBe('Timeout: No Response from localhost');
  });

  it('times out on a community the agent does not answer', async () => {
    const { env } = ownBoxEnv(ownBoxRunningAgent());

    const result = await run(env, ['localhost', 'wrong-guess']);

    expect(linesOf(result)).toBe('Timeout: No Response from localhost');
    expect(sync(result).exitCode).toBe(1);
  });

  it('times out on a port the agent is not holding', async () => {
    const { env } = ownBoxEnv(ownBoxRunningAgent());

    const result = await run(env, ['localhost:1161']);

    expect(linesOf(result)).toBe('Timeout: No Response from localhost:1161');
  });

  it('times out when another daemon holds the agent port and the agent is stopped', async () => {
    // An open port is not an agent: a box serving the store on 161 has nothing there
    // that speaks SNMP.
    const { env } = ownBoxEnv(
      withDaemonOn(withAgentStopped(ownBoxRunningAgent()), SERVICE_CATALOG.redis, 161),
    );

    const result = await run(env, ['localhost']);

    expect(linesOf(result)).toBe('Timeout: No Response from localhost');
  });

  it('starts the box own snmpd.log with the two lines a visit leaves', async () => {
    const { env, writes } = ownBoxEnv(ownBoxRunningAgent());

    await run(env, ['localhost']);

    // An arrival and a verdict, in the shape and the file the server writes for a
    // stranger, and created root's at the permissions every snmpd.log carries.
    expect(snmpdLogOf(writes).split('\n')).toEqual([
      expect.stringMatching(
        /^[A-Z][a-z]{2} [ \d]\d [\d:]{8} workstation snmpd\[\d+\]: Connection from UDP: \[127\.0\.0\.1\]$/,
      ),
      expect.stringMatching(
        /^[A-Z][a-z]{2} [ \d]\d [\d:]{8} workstation snmpd\[\d+\]: Authentication succeeded from UDP: \[127\.0\.0\.1\]$/,
      ),
      '',
    ]);
    expect(writes).toEqual([
      expect.objectContaining({
        options: { owner: 'root', permissions: SNMPD_LOG_PERMISSIONS, isNew: true },
      }),
    ]);
  });

  it('writes nothing over a log path it cannot read as a file', async () => {
    // Replacing whatever stands there with two lines is worse than dropping them.
    const blocked = applyPatches(ownBoxRunningAgent(), [
      {
        path: asAbsPath(`${SNMPD_LOG_PATH}/rotated`),
        content: 'an old log somebody moved here',
        owner: 'root',
        permissions: SNMPD_LOG_PERMISSIONS,
      },
    ]);
    const { env, writes } = ownBoxEnv(blocked);

    const result = await run(env, ['localhost']);

    expect(writes).toEqual([]);
    expect(sync(result).exitCode).toBe(0);
  });

  it('records a refused community too, which is somebody guessing', async () => {
    const { env, writes } = ownBoxEnv(ownBoxRunningAgent());

    await run(env, [OWN_IP, 'wrong-guess']);

    expect(snmpdLogOf(writes)).toContain(
      `Authentication failure (incorrect community name) from UDP: [${OWN_IP}]`,
    );
  });

  it('records nothing on a box whose agent never answered', async () => {
    const { env, writes } = ownBoxEnv(withAgentStopped(ownBoxRunningAgent()));

    await run(env, ['localhost']);

    expect(writes).toEqual([]);
  });

  it('appends to the history the machine holds, not the copy this client walked in with', async () => {
    const earlier =
      'Oct 18 09:00:00 workstation snmpd[100]: Authentication succeeded from UDP: [10.0.0.9]\n';
    const withHistory = applyPatches(ownBoxRunningAgent(), [
      { path: SNMPD_LOG_PATH, content: earlier, owner: 'root', permissions: SNMPD_LOG_PERMISSIONS },
    ]);
    const { env, writes } = ownBoxEnv(ownBoxRunningAgent(), withHistory);

    await run(env, ['localhost']);

    expect(snmpdLogOf(writes).startsWith(earlier)).toBe(true);
    expect(snmpdLogOf(writes)).toContain('from UDP: [127.0.0.1]');
    // An existing file is appended to, not created again.
    expect(writes[0]?.options).toEqual({ owner: 'root', permissions: SNMPD_LOG_PERMISSIONS });
  });
});
