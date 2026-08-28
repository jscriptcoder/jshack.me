import { describe, expect, it, vi } from 'vitest';
import { snmpset } from './snmpset';
import {
  mockCommandEnv,
  mockNetworkViewFromConnectivity,
  mockSnmpApi,
} from '../../test/factories/commandEnv';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { asPlayerKeyHex } from '../types';
import type { CommandEnv, CommandResult, SnmpApi, SnmpSetResult } from './types';

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
const ASSIGNMENT = 'natForward.2222=10.0.0.10:22';

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
  oid: 'NAT-MIB::natForward.2222',
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

    // Real snmpset's whole output for an accepted set: the object, its type, its new
    // value. No summary and no congratulation — the confirmation IS the echo, and a
    // walk is there for anyone who wants to see the table around it.
    expect(linesOf(result)).toBe('NAT-MIB::natForward.2222 = STRING: 10.0.0.10:22');
    expect(sync(result).exitCode).toBe(0);
  });

  it('reports a port closed again in the same shape it reports one opened', async () => {
    const closed: SnmpSetResult = { ok: true, oid: 'NAT-MIB::natForward.2222', value: 'none' };

    expect(linesOf(await run(onLan({ set: async () => closed }), [GATEWAY_IP, COMMUNITY, 'natForward.2222=none']))).toBe(
      'NAT-MIB::natForward.2222 = STRING: none',
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
      sourceIp: assignHomeNetwork(PUBKEY, ESSID).localIp,
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
        failedObject: 'NAT-MIB::natForward.2222',
      },
    };

    const result = await run(onLan({ set: async () => refused }), [
      GATEWAY_IP,
      COMMUNITY,
      'natForward.2222=10.9.9.9:22',
    ]);

    expect(linesOf(result)).toBe(
      [
        'Error in packet.',
        "Reason: wrongValue (10.9.9.9 is not on this device's segment)",
        'Failed object: NAT-MIB::natForward.2222',
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
        failedObject: 'NAT-MIB::natForward.2222',
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
    const usage = 'usage: snmpset <host> <community> <oid>=<value>';

    expect(linesOf(await run(onLan(), []))).toBe(usage);
    expect(linesOf(await run(onLan(), [GATEWAY_IP]))).toBe(usage);
    expect(linesOf(await run(onLan(), [GATEWAY_IP, COMMUNITY]))).toBe(usage);
  });

  it('asks again when the last argument is not an assignment', async () => {
    // Whether the OID exists and whether the value is any good are the agent's to say.
    // Whether the player typed an assignment AT ALL is a shape this command can see
    // without knowing a thing about NAT, and a round trip to learn it would be a round
    // trip spent on a typo.
    expect(linesOf(await run(onLan(), [GATEWAY_IP, COMMUNITY, 'natForward.2222']))).toBe(
      'usage: snmpset <host> <community> <oid>=<value>',
    );
  });

  it('does not reach the network for a request it will not send', async () => {
    const set = vi.fn<SnmpApi['set']>(async () => APPLIED);

    await run(onLan({ set }), [GATEWAY_IP, COMMUNITY, 'natForward.2222']);

    expect(set).not.toHaveBeenCalled();
  });
});
