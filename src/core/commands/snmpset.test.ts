import { describe, expect, it, vi } from 'vitest';
import { snmpset } from './snmpset.js';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockNetworkViewFromConnectivity,
  mockPatchApi,
  mockSession,
  mockSnmpApi,
} from '../../test/factories/commandEnv.js';
import {
  AGENT_BOX_HOSTNAME,
  agentBoxCommunity,
  agentBoxTree,
  withAgentStopped,
} from '../../test/factories/snmpAgentBox.js';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces.js';
import { assignHomeNetwork } from '../network/homeNetwork.js';
import { applyPatches } from '../filesystem/applyPatches.js';
import {
  LOCAL_FILTER_SEED,
  RULES_V4_PATH,
  RULES_V4_PERMISSIONS,
} from '../network/iptablesRules.js';
import { SNMPD_LOG_PATH, SNMPD_LOG_PERMISSIONS } from '../logging/snmpdLog.js';
import { asAbsPath, asMachineId, asPlayerKeyHex } from '../types.js';
import type { Directory } from '../filesystem/types.js';
import type { CommandEnv, CommandResult, PatchApi, SnmpApi, SnmpSetResult } from './types.js';

/**
 * `snmpset <host> <community> <oid>=<value>` — the payoff of the whole door, and the
 * only command in the game that changes what a machine DOES without a shell on it.
 *
 * The assignment travels to the server AS TYPED. This command does not know what a
 * forward is: the grammar and every refusal belong to the agent, because a client that
 * parsed them would be a second authority on what a rule is and a client that could be
 * told what to send. All it checks is that the player handed it an assignment at all.
 *
 * TWO failure shapes, and the difference is what the player has already proved. Before
 * the community is accepted there is only silence — an absent device, a stopped agent
 * and a refused string are one timeout, exactly as a walk reports them. After it is
 * accepted the device answers in net-snmp's own error frame and names the constraint,
 * because the player holds a working string and a silent refusal here would leave them
 * unable to tell a bad value from a working one without walking the device again.
 */

const PUBKEY = asPlayerKeyHex('a'.repeat(64));
const ESSID = 'BEAN-THERE-WIFI';
const GATEWAY_IP = '10.0.0.1';
const COMMUNITY = 'corpnet';
const ASSIGNMENT = 'forward.2222=10.0.0.10:22';

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

const APPLIED: SnmpSetResult = {
  ok: true,
  oid: 'forward.2222',
  value: '10.0.0.10:22',
};

const onLan = (over: Partial<SnmpApi> = {}, envOver: Partial<CommandEnv> = {}): CommandEnv =>
  mockCommandEnv({
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    snmp: mockSnmpApi({ set: async () => APPLIED, ...over }),
    ...envOver,
  });

const run = (env: CommandEnv, args: readonly string[]) => snmpset.execute(env, args, new Map());

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return result;
};

const linesOf = (result: CommandResult): string =>
  sync(result)
    .lines.map((line) => line.content)
    .join('\n');

describe('setting a value a device accepts', () => {
  it('echoes the OID and the state the port is now in', async () => {
    const result = await run(onLan(), [GATEWAY_IP, COMMUNITY, ASSIGNMENT]);

    // The whole output for an accepted set: the object, and its new value. No summary
    // and no congratulation — the confirmation IS the echo, and a walk is there for
    // anyone who wants to see the table around it.
    expect(linesOf(result)).toBe('forward.2222 = 10.0.0.10:22');
    expect(sync(result).exitCode).toBe(0);
  });

  it('reports a port closed again in the same shape it reports one opened', async () => {
    const closed: SnmpSetResult = { ok: true, oid: 'forward.2222', value: 'none' };

    expect(linesOf(await run(onLan({ set: async () => closed }), [GATEWAY_IP, COMMUNITY, 'forward.2222=none']))).toBe(
      'forward.2222 = none',
    );
  });

  it('hands the assignment to the agent exactly as it was typed', async () => {
    const set = vi.fn<SnmpApi['set']>(async () => APPLIED);

    await run(onLan({ set }), [GATEWAY_IP, COMMUNITY, ASSIGNMENT]);

    // Untouched, and deliberately so. This command cannot tell a good assignment from
    // a bad one and must not try: the file's own parser is the gate, and it lives on
    // the far side of the wire.
    expect(set).toHaveBeenCalledWith({
      essid: ESSID,
      targetIp: GATEWAY_IP,
      community: COMMUNITY,
      assignment: ASSIGNMENT,
      callerMachineId: asMachineId('localhost'),
    });
  });
});

describe('setting a value a device refuses', () => {
  it("prints the agent's own error frame, naming what was wrong", async () => {
    const refused: SnmpSetResult = {
      ok: false,
      refusal: {
        reason: 'wrongValue',
        detail: "10.9.9.9 is not on this device's segment",
        failedObject: 'forward.2222',
      },
    };

    const result = await run(onLan({ set: async () => refused }), [
      GATEWAY_IP,
      COMMUNITY,
      'forward.2222=10.9.9.9:22',
    ]);

    expect(linesOf(result)).toBe(
      [
        'Error in packet.',
        "Reason: wrongValue (10.9.9.9 is not on this device's segment)",
        'Failed object: forward.2222',
      ].join('\n'),
    );
    expect(sync(result).exitCode).toBe(1);
  });

  it('says so when the community it was given only reads', async () => {
    const readOnly: SnmpSetResult = {
      ok: false,
      refusal: {
        reason: 'notWritable',
        detail: 'the community "public" is read-only',
        failedObject: 'forward.2222',
      },
    };

    // The device answers `public` — a walk with it works — so a silent refusal here
    // would read as the box being down while the walk beside it says otherwise.
    expect(linesOf(await run(onLan({ set: async () => readOnly }), [GATEWAY_IP, 'public', ASSIGNMENT]))).toContain(
      'Reason: notWritable (the community "public" is read-only)',
    );
  });
});

describe('setting a value on a device that never answers', () => {
  it('times out in the words a walk uses, whatever the silence meant', async () => {
    const silent: SnmpSetResult = { ok: false, refusal: null };

    const result = await run(onLan({ set: async () => silent }), [
      GATEWAY_IP,
      COMMUNITY,
      ASSIGNMENT,
    ]);

    // A device that is not there, one whose agent was stopped, and one that refused the
    // community are one answer. Told apart, a sweep could sort devices into
    // worth-cracking and not before spending a word of a wordlist.
    expect(linesOf(result)).toBe(`Timeout: No Response from ${GATEWAY_IP}`);
    expect(sync(result).exitCode).toBe(1);
  });

  it('refuses to try at all with no network under it', async () => {
    const offline = mockCommandEnv({
      network: mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY)),
      snmp: mockSnmpApi({ set: async () => APPLIED }),
    });

    expect(linesOf(await run(offline, [GATEWAY_IP, COMMUNITY, ASSIGNMENT]))).toBe(
      `snmpset: ${GATEWAY_IP}: Network is unreachable`,
    );
  });
});

describe('setting nothing in particular', () => {
  it('asks for the three things it needs', async () => {
    const usage = 'usage: snmpset <host>[:<port>] <community> <oid>=<value>';

    expect(linesOf(await run(onLan(), []))).toBe(usage);
    expect(linesOf(await run(onLan(), [GATEWAY_IP]))).toBe(usage);
    expect(linesOf(await run(onLan(), [GATEWAY_IP, COMMUNITY]))).toBe(usage);
  });

  it('asks again when the last argument is not an assignment', async () => {
    // Whether the OID exists and whether the value is any good are the agent's to say.
    // Whether the player typed an assignment AT ALL is a shape this command can see
    // without knowing a thing about NAT, and a round trip to learn it would be a round
    // trip spent on a typo.
    expect(linesOf(await run(onLan(), [GATEWAY_IP, COMMUNITY, 'forward.2222']))).toBe(
      'usage: snmpset <host>[:<port>] <community> <oid>=<value>',
    );
  });

  it('does not reach the network for a request it will not send', async () => {
    const set = vi.fn<SnmpApi['set']>(async () => APPLIED);

    await run(onLan({ set }), [GATEWAY_IP, COMMUNITY, 'forward.2222']);

    expect(set).not.toHaveBeenCalled();
  });
});

describe('setting from a hop', () => {
  it('names the box the shell stands on by its loopback address', async () => {
    // The server places loopback by its address, so a name it does not resolve would
    // reach nothing at all.
    const set = vi.fn<SnmpApi['set']>(async () => APPLIED);
    const env = mockCommandEnv({
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      snmp: mockSnmpApi({ set }),
      session: mockSession({ essid: 'HOP-NET', machineId: asMachineId('hop-box') }),
    });

    await run(env, ['localhost', COMMUNITY, 'inputPort.6379=deny']);

    expect(set).toHaveBeenCalledWith({
      essid: 'HOP-NET',
      targetIp: '127.0.0.1',
      community: COMMUNITY,
      assignment: 'inputPort.6379=deny',
      callerMachineId: asMachineId('hop-box'),
    });
  });
});

/**
 * The agent on your OWN box.
 *
 * Answered here rather than through the server, as the walk is: the server's same-LAN
 * vantage excludes the caller, so a set on your own address that went out found
 * nothing there and timed out, while a stranger's set on the very same agent landed.
 *
 * What differs is WHERE the decision runs, never what it decides: the same community
 * judgement, the same grammar and refusals, the same file rewritten, and the same lines
 * in the box's own `snmpd.log`, all read off the machine as it stands.
 */
describe('the player own box, once it runs an agent', () => {
  const OWN_IP = assignHomeNetwork(PUBKEY, ESSID).localIp;
  const RW_COMMUNITY = agentBoxCommunity(PUBKEY);
  const CLOSE_REDIS = 'inputPort.6379=deny';

  /** The server door, deliberately unreachable. A set on your own box that took the
   *  network path would throw here rather than quietly pass. */
  const NOT_WIRED = () => {
    throw new Error('own-box snmpset must not reach the server');
  };

  const viewOf = (tree: Directory) =>
    mockFsViewFromTree(tree, { userType: 'root', cwd: () => asAbsPath('/') });

  type Write = {
    readonly path: string;
    readonly content: string | null;
    readonly options: Parameters<PatchApi['write']>[2];
  };

  /** What this client walked in holding, and what the machine has become since. They are
   *  the same box unless a test says otherwise. A write to `refusedPath` is refused. */
  const ownBoxEnv = (
    held: Directory,
    machine: Directory = held,
    refusedPath: string | null = null,
  ) => {
    const writes: Write[] = [];
    const env = mockCommandEnv({
      snmp: mockSnmpApi({ set: NOT_WIRED }),
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
      hostname: AGENT_BOX_HOSTNAME,
      fs: { ...viewOf(held), reload: async () => viewOf(machine) },
      patches: mockPatchApi({
        write: async (path, content, options) => {
          if (path === refusedPath) return { ok: false, error: 'network_error' };
          writes.push({ path, content, options });
          return { ok: true };
        },
      }),
    });
    return { env, writes };
  };

  const writeTo = (writes: readonly Write[], path: string): Write | undefined =>
    writes.find((write) => write.path === path);

  it('closes a port on its own filter without asking the server', async () => {
    const { env, writes } = ownBoxEnv(agentBoxTree(PUBKEY));

    const result = await run(env, ['localhost', RW_COMMUNITY, CLOSE_REDIS]);

    expect(linesOf(result)).toBe('inputPort.6379 = deny');
    expect(sync(result).exitCode).toBe(0);
    expect(writeTo(writes, RULES_V4_PATH)).toEqual({
      path: RULES_V4_PATH,
      content: `${LOCAL_FILTER_SEED}deny 6379\n`,
      options: { owner: 'root', permissions: RULES_V4_PERMISSIONS },
    });
  });

  it('opens a denied port again on its own LAN address', async () => {
    const { env, writes } = ownBoxEnv(agentBoxTree(PUBKEY, `${LOCAL_FILTER_SEED}deny 6379\n`));

    const result = await run(env, [OWN_IP, RW_COMMUNITY, 'inputPort.6379=permit']);

    expect(linesOf(result)).toBe('inputPort.6379 = permit');
    expect(writeTo(writes, RULES_V4_PATH)?.content).toBe(LOCAL_FILTER_SEED);
  });

  it('rewrites the filter as the machine holds it, not as this client last saw it', async () => {
    // A deny the owner added in another tab must survive a set made from this one.
    const { env, writes } = ownBoxEnv(
      agentBoxTree(PUBKEY),
      agentBoxTree(PUBKEY, `${LOCAL_FILTER_SEED}deny 22\n`),
    );

    await run(env, ['localhost', RW_COMMUNITY, CLOSE_REDIS]);

    expect(writeTo(writes, RULES_V4_PATH)?.content).toBe(
      `${LOCAL_FILTER_SEED}deny 22\ndeny 6379\n`,
    );
  });

  it('creates the filter as a new file when the owner deleted it', async () => {
    const withoutFilter = applyPatches(agentBoxTree(PUBKEY), [
      { path: RULES_V4_PATH, content: null, owner: 'root', permissions: RULES_V4_PERMISSIONS },
    ]);
    const { env, writes } = ownBoxEnv(withoutFilter);

    await run(env, ['localhost', RW_COMMUNITY, CLOSE_REDIS]);

    expect(writeTo(writes, RULES_V4_PATH)).toEqual({
      path: RULES_V4_PATH,
      content: 'deny 6379\n',
      options: { owner: 'root', permissions: RULES_V4_PERMISSIONS, isNew: true },
    });
  });

  it('records the visit and the change in the box own snmpd.log, in one write', async () => {
    const { env, writes } = ownBoxEnv(agentBoxTree(PUBKEY));

    await run(env, ['localhost', RW_COMMUNITY, CLOSE_REDIS]);

    // The file changes FIRST, so the SET line is only ever claimed for a write that
    // happened.
    expect(writes.map((write) => write.path)).toEqual([RULES_V4_PATH, SNMPD_LOG_PATH]);
    expect(writeTo(writes, SNMPD_LOG_PATH)?.content?.split('\n')).toEqual([
      expect.stringMatching(
        /^[A-Z][a-z]{2} [ \d]\d [\d:]{8} workstation snmpd\[\d+\]: Connection from UDP: \[127\.0\.0\.1\]$/,
      ),
      expect.stringMatching(/ snmpd\[\d+\]: Authentication succeeded from UDP: \[127\.0\.0\.1\]$/),
      expect.stringMatching(
        / snmpd\[\d+\]: SET inputPort\.6379 = permit -> deny from UDP: \[127\.0\.0\.1\]$/,
      ),
      '',
    ]);
    expect(writeTo(writes, SNMPD_LOG_PATH)?.options).toEqual({
      owner: 'root',
      permissions: SNMPD_LOG_PERMISSIONS,
      isNew: true,
    });
  });

  it('names the LAN address in the log when it was reached by one', async () => {
    const { env, writes } = ownBoxEnv(agentBoxTree(PUBKEY));

    await run(env, [OWN_IP, RW_COMMUNITY, CLOSE_REDIS]);

    expect(writeTo(writes, SNMPD_LOG_PATH)?.content).toContain(
      `SET inputPort.6379 = permit -> deny from UDP: [${OWN_IP}]`,
    );
  });

  it('times out, and claims no change, when the filter could not be written', async () => {
    const { env, writes } = ownBoxEnv(agentBoxTree(PUBKEY), undefined, RULES_V4_PATH);

    const result = await run(env, ['localhost', RW_COMMUNITY, CLOSE_REDIS]);

    expect(linesOf(result)).toBe('Timeout: No Response from localhost');
    expect(sync(result).exitCode).toBe(1);
    // The visit happened and is recorded; the change did not, and nothing claims it.
    expect(writeTo(writes, SNMPD_LOG_PATH)?.content?.split('\n')).toEqual([
      expect.stringMatching(/ snmpd\[\d+\]: Connection from UDP: \[127\.0\.0\.1\]$/),
      expect.stringMatching(/ snmpd\[\d+\]: Authentication succeeded from UDP: \[127\.0\.0\.1\]$/),
      '',
    ]);
  });

  it('refuses the read-only community in the agent own error frame', async () => {
    const { env, writes } = ownBoxEnv(agentBoxTree(PUBKEY));

    const result = await run(env, ['localhost', 'public', CLOSE_REDIS]);

    expect(linesOf(result)).toBe(
      [
        'Error in packet.',
        'Reason: notWritable (the community "public" is read-only)',
        'Failed object: inputPort.6379',
      ].join('\n'),
    );
    expect(sync(result).exitCode).toBe(1);
    expect(writes.map((write) => write.path)).toEqual([SNMPD_LOG_PATH]);
    expect(writeTo(writes, SNMPD_LOG_PATH)?.content).toContain('Authentication succeeded');
  });

  it('refuses a forward, because a workstation fronts no network', async () => {
    const { env, writes } = ownBoxEnv(agentBoxTree(PUBKEY));

    const result = await run(env, ['localhost', RW_COMMUNITY, `forward.2222=${OWN_IP}:22`]);

    expect(linesOf(result)).toContain('Reason: wrongValue (this device fronts no network)');
    expect(writes.map((write) => write.path)).toEqual([SNMPD_LOG_PATH]);
  });

  it('refuses an access-list port, which only a switch keeps', async () => {
    const { env } = ownBoxEnv(agentBoxTree(PUBKEY));

    const result = await run(env, ['localhost', RW_COMMUNITY, 'aclPort.8080=deny']);

    expect(linesOf(result)).toContain(
      'Reason: noSuchName (aclPort is not implemented on this device)',
    );
  });

  it('refuses an object the agent does not have', async () => {
    const { env } = ownBoxEnv(agentBoxTree(PUBKEY));

    const result = await run(env, ['localhost', RW_COMMUNITY, 'sysName.0=pwned']);

    expect(linesOf(result)).toContain('Failed object: sysName.0');
    expect(sync(result).exitCode).toBe(1);
  });

  it('times out on a community the agent does not answer, and logs the guess', async () => {
    const { env, writes } = ownBoxEnv(agentBoxTree(PUBKEY));

    const result = await run(env, [OWN_IP, 'wrong-guess', CLOSE_REDIS]);

    expect(linesOf(result)).toBe(`Timeout: No Response from ${OWN_IP}`);
    expect(writes.map((write) => write.path)).toEqual([SNMPD_LOG_PATH]);
    expect(writeTo(writes, SNMPD_LOG_PATH)?.content).toContain(
      `Authentication failure (incorrect community name) from UDP: [${OWN_IP}]`,
    );
  });

  it('times out and writes nothing when the agent is stopped', async () => {
    const { env, writes } = ownBoxEnv(withAgentStopped(agentBoxTree(PUBKEY)));

    const result = await run(env, ['localhost', RW_COMMUNITY, CLOSE_REDIS]);

    expect(linesOf(result)).toBe('Timeout: No Response from localhost');
    expect(writes).toEqual([]);
  });

  it('times out when the agent was stopped since this client last looked', async () => {
    const running = agentBoxTree(PUBKEY);
    const { env, writes } = ownBoxEnv(running, withAgentStopped(running));

    const result = await run(env, ['localhost', RW_COMMUNITY, CLOSE_REDIS]);

    expect(linesOf(result)).toBe('Timeout: No Response from localhost');
    expect(writes).toEqual([]);
  });

  it('times out on a port the agent is not holding', async () => {
    const { env, writes } = ownBoxEnv(agentBoxTree(PUBKEY));

    const result = await run(env, ['localhost:1161', RW_COMMUNITY, CLOSE_REDIS]);

    expect(linesOf(result)).toBe('Timeout: No Response from localhost:1161');
    expect(writes).toEqual([]);
  });
});
