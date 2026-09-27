/**
 * The MAC address of a generated host. One fact of the network: every table that names
 * a host — a router's leases, a switch's forwarding table — reads it from here, keyed by
 * the host's machine id, so two tables can never disagree about which card a box has.
 */

import { createPrng } from './prng';
import type { MacAddress } from '../network/interfaces';

/** Maker prefixes (OUIs) a generated card is drawn from. All are globally administered
 *  unicast, so no generated host shares the `02:` range the player's own NICs use. */
const MAKER_PREFIXES = [
  '00:1a:2b',
  '00:1e:c2',
  '00:24:d7',
  '00:50:56',
  '08:00:27',
  '3c:22:fb',
  '40:b0:34',
  '5c:f9:38',
  '70:85:c2',
  'a4:83:e7',
  'b8:27:eb',
  'd8:3a:dd',
  'dc:a6:32',
  'f0:18:98',
] as const;

const hexOctet = (value: number): string => value.toString(16).padStart(2, '0');

export const hostMac = (machineId: string): MacAddress => {
  const prng = createPrng(`mac-${machineId}`);
  const maker = prng.pick(MAKER_PREFIXES);
  const card = [0, 1, 2].map(() => hexOctet(prng.nextInt(0, 255)));
  return [maker, ...card].join(':');
};
