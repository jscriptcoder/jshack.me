/**
 * vantageOf — where a network command typed into this shell travels from.
 *
 * A shell on a box is a place to stand. The box is the one the session on top of the
 * terminal's stack is on: an `su` does not move it, because it changes the user and not
 * the machine, and an `exit` steps back to whatever is beneath. Every IP tool asks this
 * one question rather than its own copy of it, so no tool can reach a network the shell
 * is not standing on.
 *
 * On the player's own workstation the answer is their own WiFi card — its network and
 * the address they were leased on it — and there is nowhere to stand when it is on no
 * network. On any other box it is that box's network and its place on that LAN, whatever
 * the player's own card is doing: the radio stays with the body, and the IP follows the
 * shell. A box the network does not stand on its LAN has no address this side can
 * recover, so it travels from that network with its address unknown.
 *
 * The server derives the same answer for itself from the session row; this is what the
 * shell routes on, never evidence.
 */

import { lanAddressForMachineId } from '../generation/lanTopology.js';
import { connectedWlan0, type Ipv4, type NetworkInterface } from './interfaces.js';
import type { Session } from '../commands/types.js';

export type Vantage =
  | { readonly kind: 'home'; readonly essid: string; readonly address: Ipv4 }
  | { readonly kind: 'hop'; readonly essid: string; readonly address: Ipv4 | null };

export const vantageOf = (
  session: Session,
  network: {
    readonly isOnline: () => boolean;
    readonly interfaces: () => readonly NetworkInterface[];
  },
): Vantage | null => {
  if (session.essid !== null) {
    return {
      kind: 'hop',
      essid: session.essid,
      address: lanAddressForMachineId(session.essid, session.machineId),
    };
  }
  const wlan0 = connectedWlan0(network);
  return wlan0 === null
    ? null
    : { kind: 'home', essid: wlan0.association.essid, address: wlan0.ipv4 };
};
