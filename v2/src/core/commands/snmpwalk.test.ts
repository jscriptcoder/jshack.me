import { describe, expect, it, vi } from 'vitest';
import { snmpwalk } from './snmpwalk';
import {
  mockCommandEnv,
  mockNetworkViewFromConnectivity,
  mockSnmpApi,
} from '../../test/factories/commandEnv';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { assignHomeNetwork } from '../network/homeNetwork';
import { asPlayerKeyHex } from '../types';
import type { CommandEnv, CommandResult, SnmpApi, SnmpWalkResult } from './types';

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
        `Querying ${GATEWAY_IP} with community string "public"...`,
        '[READ-ONLY] Community "public" accepted.',
        '',
        'SNMPv2-MIB::sysDescr.0    = STRING:    Linux gw-main',
        'SNMPv2-MIB::sysName.0     = STRING:    gw-main',
        'SNMPv2-MIB::sysContact.0  = STRING:    netops@corp.local',
        'IF-MIB::ifDescr.1         = STRING:    eth0',
        'IF-MIB::ifDescr.2         = STRING:    eth1',
        `IF-MIB::ifAddr.1          = IpAddress: ${GATEWAY_IP}`,
        `IF-MIB::ifAddr.2          = IpAddress: ${PUBLIC_IP}`,
        '',
        '7 OIDs returned. Community "public" is READ-ONLY.',
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
      sourceIp: assignHomeNetwork(PUBKEY, ESSID).localIp,
    });
  });

  it('sends the community the player typed, and says which one answered', async () => {
    const walk = vi.fn<SnmpApi['walk']>(async () => ANSWERED);

    const result = await run(onLan({ walk }), [GATEWAY_IP, 'corpnet']);

    expect(walk.mock.calls[0]![0]).toMatchObject({ community: 'corpnet' });
    expect(linesOf(result)).toContain('[READ-ONLY] Community "corpnet" accepted.');
  });
});

describe('walking a device with a community that reads its port table', () => {
  const CRACKED: SnmpWalkResult = {
    ok: true,
    tier: 'read-write',
    identity: {
      hostname: 'gw-main',
      kind: 'router',
      sysContact: 'netops@corp.local',
      addresses: [GATEWAY_IP, PUBLIC_IP],
    },
    portTable: {
      kind: 'nat',
      forwards: [{ publicPort: 2222, internalIp: '10.0.0.10', internalPort: 22 }],
    },
  };

  it('prints the port table and what to write, not the retry hint', async () => {
    const result = await run(onLan({ walk: async () => CRACKED }), [GATEWAY_IP, 'corpnet']);

    expect(linesOf(result)).toContain('NAT-MIB::natForward.2222  = STRING:    10.0.0.10:22');
    expect(linesOf(result)).toContain('Writable: snmpset');
    // The read-only trailer tells a player to go and find a better community. Printed
    // to somebody who just used one, it would read as a failure.
    expect(linesOf(result)).not.toContain('Retry with a read-write community');
  });

  it('renders an empty table as an empty table, never as a refusal', async () => {
    // Default-deny makes this the usual answer from a fresh router, and it arrives at
    // the same exit code as a full one: the community worked.
    const result = await run(
      onLan({ walk: async () => ({ ...CRACKED, portTable: { kind: 'nat', forwards: [] } }) }),
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

    expect(linesOf(result)).toBe('usage: snmpwalk <host> [community]');
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
