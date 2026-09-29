/**
 * What counts as a public address. Every network's public address is derived from its
 * place in the world, so the blocks the world answers in are the only public ones.
 */

import { PLACELESS_FIRST_OCTET, REGION_FIRST_OCTETS } from './world.js';

const SINGLE_IP = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Whether `target` is a single public address: a `x.y.z.w` inside one of the blocks
 *  the world answers in, a region's or the placeless one. Used by every command that
 *  reaches across networks to route the target to the server instead of the player's
 *  own LAN; a range, a private or own-subnet address, or any other shape is not one.
 *  Every declared network's address classifies true by construction. */
export const isPublicIp = (target: string): boolean => {
  const match = target.match(SINGLE_IP);
  if (match === null) return false;
  const firstOctet = Number(match[1]);
  return firstOctet === PLACELESS_FIRST_OCTET || REGION_FIRST_OCTETS.includes(firstOctet);
};
