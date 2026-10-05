import { describe, expect, it } from 'vitest';
import { vantageOf } from './vantage.js';
import { buildColdStartConnectivity, type ConnectivityState } from './interfaces.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { machineIdForLanHost } from '../generation/lanTopology.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { asMachineId, asPlayerKeyHex } from '../types.js';
import { mockNetworkViewFromConnectivity, mockSession } from '../../test/factories/commandEnv.js';

/**
 * Where a command stands: the box of the session on top of the terminal's stack. On
 * the player's own workstation that is wherever their own WiFi card is associated; on
 * any other box it is that box's network and that box's place on it, whatever the
 * player's own card is doing.
 */

const PUBKEY = 'a'.repeat(64);
const HOME_ESSID = 'BEAN-THERE-WIFI';
const HOME_IP = '192.168.7.42';
const HOP_ESSID = 'RIDGEMONT-OFFICE';

const connectedTo = (essid: string, ipv4: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
  const online = { ...wlan0, association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' }, ipv4 };
  return { interfaces: new Map(cold.interfaces).set('wlan0', online) };
};

const homeNetwork = () => mockNetworkViewFromConnectivity(connectedTo(HOME_ESSID, HOME_IP));
const offline = () => mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY));

const hopHost = (kind: 'machine' | 'router') => {
  const host = generateHomeLan(HOP_ESSID).hosts.find((candidate) => candidate.kind === kind);
  if (host === undefined) throw new Error(`${HOP_ESSID} has no ${kind}`);
  return host;
};

const hopSession = (machineId: string) =>
  mockSession({ machineId: asMachineId(machineId), essid: HOP_ESSID, kind: 'ssh' });

describe('vantageOf', () => {
  it('stands on the player’s own WiFi, at their leased address, on their own box', () => {
    expect(vantageOf(mockSession({ essid: null }), homeNetwork())).toEqual({
      kind: 'home',
      essid: HOME_ESSID,
      address: HOME_IP,
    });
  });

  it('stands nowhere on their own box when their card is on no network', () => {
    expect(vantageOf(mockSession({ essid: null }), offline())).toBeNull();
  });

  it('stands on the hop’s network, at the hop’s own address, whatever the player’s card is on', () => {
    const host = hopHost('machine');
    const session = hopSession(machineIdForLanHost(host, HOP_ESSID));

    const expected = { kind: 'hop', essid: HOP_ESSID, address: host.ip };
    expect(vantageOf(session, homeNetwork())).toEqual(expected);
    expect(vantageOf(session, offline())).toEqual(expected);
  });

  it('places a hop on the network’s own router at the router’s address', () => {
    const router = hopHost('router');
    const session = hopSession(machineIdForLanHost(router, HOP_ESSID));

    expect(vantageOf(session, homeNetwork())).toEqual({
      kind: 'hop',
      essid: HOP_ESSID,
      address: router.ip,
    });
  });

  it('knows the network but not the address of a hop the network does not generate', () => {
    const someoneElsesBox = computeWorkstationId('rig', asPlayerKeyHex('c'.repeat(64)));

    expect(vantageOf(hopSession(someoneElsesBox), homeNetwork())).toEqual({
      kind: 'hop',
      essid: HOP_ESSID,
      address: null,
    });
  });
});
