import { describe, expect, it } from 'vitest';
import { vantageOf } from './vantage.js';
import { buildColdStartConnectivity, type ConnectivityState } from './interfaces.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { generateDeepLayer } from '../generation/generateDeepLayer.js';
import { hostMachineId } from '../generation/remoteHostId.js';
import { chainLinks, machineIdForLanHost, type ChainLink } from '../generation/lanTopology.js';
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
const HOME_SUBNET = generateHomeLan(HOME_ESSID).subnet;
const HOP_SUBNET = generateHomeLan(HOP_ESSID).subnet;

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
      reaches: [{ subnet: HOME_SUBNET, fronting: null, address: HOME_IP }],
    });
  });

  it('stands nowhere on their own box when their card is on no network', () => {
    expect(vantageOf(mockSession({ essid: null }), offline())).toBeNull();
  });

  it('stands on the hop’s network, at the hop’s own address, whatever the player’s card is on', () => {
    const host = hopHost('machine');
    const session = hopSession(machineIdForLanHost(host, HOP_ESSID));

    const expected = {
      kind: 'hop',
      essid: HOP_ESSID,
      address: host.ip,
      reaches: [{ subnet: HOP_SUBNET, fronting: null, address: host.ip }],
    };
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
      reaches: [{ subnet: HOP_SUBNET, fronting: null, address: router.ip }],
    });
  });

  it('knows the network but not the address of a hop the network does not generate', () => {
    const someoneElsesBox = computeWorkstationId('rig', asPlayerKeyHex('c'.repeat(64)));

    expect(vantageOf(hopSession(someoneElsesBox), homeNetwork())).toEqual({
      kind: 'hop',
      essid: HOP_ESSID,
      address: null,
      reaches: [{ subnet: HOP_SUBNET, fronting: null, address: null }],
    });
  });
});

/**
 * A deep layer is a hidden network of its own behind a gateway, so a box on one stands
 * there and not on the network above it. It still reaches every network above, out
 * through each gateway on the way up — and is seen there as that gateway, which hides
 * it behind its own address. A gateway stands on the network above it and also on the
 * layer it fronts, where it is that layer's `.1`.
 */
describe('vantageOf on a deep layer', () => {
  // Three gateways deep: an inner router on the LAN, a deep router behind it, and a
  // second deep router behind that.
  const DEEP_ESSID = 'BEAN-THERE-WIFI';
  const LAN_SUBNET = generateHomeLan(DEEP_ESSID).subnet;
  const [inner, middle, bottom] = chainLinks(DEEP_ESSID);

  const layerFrontedBy = (link: ChainLink | undefined) => {
    if (link === undefined) throw new Error(`${DEEP_ESSID} has no such gateway`);
    return generateDeepLayer(
      DEEP_ESSID,
      { machineId: link.machineId, kind: link.host.kind },
      { hangsChild: link.hangsChild },
    );
  };
  const innerLayer = layerFrontedBy(inner);
  const middleLayer = layerFrontedBy(middle);
  const deepSession = (machineId: string) =>
    mockSession({ machineId: asMachineId(machineId), essid: DEEP_ESSID, kind: 'ssh' });

  it('stands a deep host on its own layer, and reaches the LAN as the gateway above it', () => {
    const host = innerLayer.host;

    expect(vantageOf(deepSession(hostMachineId(host, DEEP_ESSID)), offline())).toEqual({
      kind: 'hop',
      essid: DEEP_ESSID,
      address: host.ip,
      reaches: [
        { subnet: innerLayer.subnet, fronting: inner, address: host.ip },
        { subnet: LAN_SUBNET, fronting: null, address: inner?.host.ip },
      ],
    });
  });

  it('reaches every network above a host two layers down, through each gateway in turn', () => {
    const host = middleLayer.host;

    expect(vantageOf(deepSession(hostMachineId(host, DEEP_ESSID)), offline())).toEqual({
      kind: 'hop',
      essid: DEEP_ESSID,
      address: host.ip,
      reaches: [
        { subnet: middleLayer.subnet, fronting: middle, address: host.ip },
        { subnet: innerLayer.subnet, fronting: inner, address: middle?.host.ip },
        { subnet: LAN_SUBNET, fronting: null, address: inner?.host.ip },
      ],
    });
  });

  it('stands a deep gateway on the layer above it, and on the layer it fronts at its .1', () => {
    expect(vantageOf(deepSession(middle?.machineId ?? ''), offline())).toEqual({
      kind: 'hop',
      essid: DEEP_ESSID,
      address: middle?.host.ip,
      reaches: [
        { subnet: innerLayer.subnet, fronting: inner, address: middle?.host.ip },
        { subnet: middleLayer.subnet, fronting: middle, address: `${middleLayer.subnet}.1` },
        { subnet: LAN_SUBNET, fronting: null, address: inner?.host.ip },
      ],
    });
  });

  it('stands an inner gateway on the LAN, and on the layer it fronts at its .1', () => {
    expect(vantageOf(deepSession(inner?.machineId ?? ''), offline())).toEqual({
      kind: 'hop',
      essid: DEEP_ESSID,
      address: inner?.host.ip,
      reaches: [
        { subnet: LAN_SUBNET, fronting: null, address: inner?.host.ip },
        { subnet: innerLayer.subnet, fronting: inner, address: `${innerLayer.subnet}.1` },
      ],
    });
  });

  it('gives the bottom gateway the whole chain above it', () => {
    const bottomLayer = layerFrontedBy(bottom);

    expect(vantageOf(deepSession(bottom?.machineId ?? ''), offline())?.reaches).toEqual([
      { subnet: middleLayer.subnet, fronting: middle, address: bottom?.host.ip },
      { subnet: bottomLayer.subnet, fronting: bottom, address: `${bottomLayer.subnet}.1` },
      { subnet: innerLayer.subnet, fronting: inner, address: middle?.host.ip },
      { subnet: LAN_SUBNET, fronting: null, address: inner?.host.ip },
    ]);
  });
});
