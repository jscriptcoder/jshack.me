/**
 * Network-interface & connectivity state (WiFi connectivity arc).
 *
 * The player's workstation NICs as a discriminated union, plus the cold-start
 * snapshot and the `isOnline` predicate the whole arc gates on. A freshly
 * booted player is OFFLINE: `lo` is up, `wlan0` is up but unassociated (radio
 * on, no network), `eth0` is down (no wired LAN in this arc). Getting online
 * means cracking a WiFi AP and associating `wlan0` — see the arc plan.
 *
 * Design (grill-me decision 3): a RICHER union over a flat legacy interface, so
 * each NIC carries exactly the state its commands mutate — `wlan0` alone has
 * `monitorMode` (airmon) and `association` (nmcli). MACs are seeded from the
 * identity so a player's NICs are stable across reloads, like the workstation FS.
 */

import { createPrng, type Prng } from '../generation/prng';

export type Ipv4 = string;
export type MacAddress = string;

export type WirelessAssociation = {
  readonly essid: string;
  readonly bssid: string;
};

export type LoopbackInterface = {
  readonly kind: 'loopback';
  readonly name: 'lo';
  readonly up: true;
  readonly ipv4: '127.0.0.1';
};

export type EthernetInterface = {
  readonly kind: 'ethernet';
  readonly name: 'eth0';
  readonly mac: MacAddress;
  readonly up: boolean;
  readonly ipv4: Ipv4 | null;
};

export type WirelessInterface = {
  readonly kind: 'wireless';
  readonly name: 'wlan0';
  readonly mac: MacAddress;
  readonly up: boolean;
  readonly monitorMode: boolean;
  readonly association: WirelessAssociation | null;
  readonly ipv4: Ipv4 | null;
};

export type NetworkInterface = LoopbackInterface | EthernetInterface | WirelessInterface;

/** A `wlan0` that can actually reach something: wireless, associated with an AP, and
 *  holding an address. The narrowed nulls are the point — a caller that has one of
 *  these needs no further checks to read its `essid` or its `ipv4`. */
export type ConnectedWlan0 = WirelessInterface & {
  readonly association: WirelessAssociation;
  readonly ipv4: Ipv4;
};

/**
 * The connected `wlan0`, or null when this machine cannot reach a network.
 *
 * Every network command opens by asking the same question — is there a LAN under us? —
 * and four things can answer no: offline, no `wlan0` at all, associated with nothing,
 * or associated but never issued an address (the lease is server-allocated, so an
 * addressless association is genuinely not on the network). Callers collapse all four
 * into ONE message on purpose: which gate stopped you is not something the player
 * needs, and four sentences would invite them to debug the simulation.
 *
 * Takes the two readers it uses rather than the whole command env, so it stays a
 * network fact rather than a command one.
 */
export const connectedWlan0 = (network: {
  readonly isOnline: () => boolean;
  readonly interfaces: () => readonly NetworkInterface[];
}): ConnectedWlan0 | null => {
  if (!network.isOnline()) return null;
  const wlan0 = network.interfaces().find((iface) => iface.name === 'wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') return null;
  const { association, ipv4 } = wlan0;
  if (association === null || ipv4 === null) return null;
  return { ...wlan0, association, ipv4 };
};

export type ConnectivityState = {
  readonly interfaces: ReadonlyMap<string, NetworkInterface>;
};

/** The address a machine reaches ITSELF on. Exported because `curl` resolves it as a
 *  name for the player's own box, and one loopback address is enough for the world. */
export const LOOPBACK_IPV4 = '127.0.0.1';

/** The names a box answers to for ITSELF, whichever door is being knocked on. A
 *  player testing their own server types `localhost` long before they type the
 *  address they were leased, and every real box answers to both — so a door that
 *  knew only one of them would read as broken rather than as picky. */
export const LOOPBACK_NAMES: readonly string[] = ['localhost', LOOPBACK_IPV4];

/** One locally-administered MAC: `02:` (the locally-administered-unicast
 *  prefix) followed by five seeded octets, lowercase hex. */
const seededMac = (prng: Prng): MacAddress => {
  const octet = (): string => prng.nextInt(0, 255).toString(16).padStart(2, '0');
  return ['02', octet(), octet(), octet(), octet(), octet()].join(':');
};

/**
 * Cold-start connectivity for a freshly booted workstation, seeded by the
 * player's Ed25519 identity pubkey (stable NIC MACs across reloads). Offline by
 * construction: only `lo` carries an address.
 */
export const buildColdStartConnectivity = (seedPubkeyHex: string): ConnectivityState => {
  const prng = createPrng(`network-${seedPubkeyHex}`);

  const lo: LoopbackInterface = { kind: 'loopback', name: 'lo', up: true, ipv4: LOOPBACK_IPV4 };
  const eth0: EthernetInterface = {
    kind: 'ethernet',
    name: 'eth0',
    mac: seededMac(prng),
    up: false,
    ipv4: null,
  };
  const wlan0: WirelessInterface = {
    kind: 'wireless',
    name: 'wlan0',
    mac: seededMac(prng),
    up: true,
    monitorMode: false,
    association: null,
    ipv4: null,
  };

  return {
    interfaces: new Map<string, NetworkInterface>([
      ['lo', lo],
      ['eth0', eth0],
      ['wlan0', wlan0],
    ]),
  };
};

/** Online = any NON-loopback interface has been assigned an IPv4 address.
 *  Loopback's 127.0.0.1 never counts. */
export const isOnline = (state: ConnectivityState): boolean =>
  [...state.interfaces.values()].some((iface) => iface.kind !== 'loopback' && iface.ipv4 !== null);
