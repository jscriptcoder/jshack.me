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
 * shell. A box behind a deeper gateway stands on that gateway's layer, and reaches the
 * networks above it the way the gateway's NAT lets it. A box the network does not
 * generate — another player's workstation — has no address this side can recover, so
 * it travels from that network with its address unknown.
 *
 * The server derives the same answer for itself from the session row; this is what the
 * shell routes on, never evidence.
 */

import { generateHomeLan } from '../generation/generateHomeLan.js';
import { segmentsReachedFrom, type ReachedSegment } from '../generation/lanTopology.js';
import { connectedWlan0, type Ipv4, type NetworkInterface } from './interfaces.js';
import type { Session } from '../commands/types.js';

/** `reaches` is every network a command typed here can get to, the one the box stands
 *  on first, each with the address the box is seen at there; `address` is its address
 *  on the one it stands on. */
export type Vantage =
  | {
      readonly kind: 'home';
      readonly essid: string;
      readonly address: Ipv4;
      readonly reaches: readonly ReachedSegment[];
    }
  | {
      readonly kind: 'hop';
      readonly essid: string;
      readonly address: Ipv4 | null;
      readonly reaches: readonly ReachedSegment[];
    };

export const vantageOf = (
  session: Session,
  network: {
    readonly isOnline: () => boolean;
    readonly interfaces: () => readonly NetworkInterface[];
  },
): Vantage | null => {
  if (session.essid !== null) {
    const reaches = segmentsReachedFrom(session.essid, session.machineId) ?? [
      { subnet: generateHomeLan(session.essid).subnet, fronting: null, address: null },
    ];
    return {
      kind: 'hop',
      essid: session.essid,
      address: reaches[0]?.address ?? null,
      reaches,
    };
  }
  const wlan0 = connectedWlan0(network);
  if (wlan0 === null) return null;
  const { essid } = wlan0.association;
  return {
    kind: 'home',
    essid,
    address: wlan0.ipv4,
    reaches: [{ subnet: generateHomeLan(essid).subnet, fronting: null, address: wlan0.ipv4 }],
  };
};
