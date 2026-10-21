/**
 * What counts as a public address. Every network's public address is derived from its
 * place in the world, and every contractor board's is drawn in a block of its own, so the
 * blocks the world answers in are the only public ones.
 */

import { BOARD_FIRST_OCTET, PLACELESS_FIRST_OCTET, REGION_FIRST_OCTETS } from './world.js';

const SINGLE_IP = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** The first octet of a single `x.y.z.w` address, or `null` for any other shape. */
const firstOctetOf = (target: string): number | null => {
  const match = target.match(SINGLE_IP);
  return match === null ? null : Number(match[1]);
};

/** Whether `target` is a single public address: a `x.y.z.w` inside one of the blocks
 *  the world answers in, a region's, the placeless one or the contractor boards'. Used by
 *  every command that reaches across networks to route the target to the server instead
 *  of the player's own LAN; a range, a private or own-subnet address, or any other shape
 *  is not one. Every declared network's address classifies true by construction. */
export const isPublicIp = (target: string): boolean => {
  const firstOctet = firstOctetOf(target);
  return (
    firstOctet === PLACELESS_FIRST_OCTET ||
    firstOctet === BOARD_FIRST_OCTET ||
    (firstOctet !== null && REGION_FIRST_OCTETS.includes(firstOctet))
  );
};

/** Whether `target` is a single address in the contractor boards' block, held or not. */
export const isBoardAddress = (target: string): boolean =>
  firstOctetOf(target) === BOARD_FIRST_OCTET;
