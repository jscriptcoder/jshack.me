/**
 * A contract network's two public names, both pure functions of its number.
 *
 * A contract's identity is a 24-bit number. It has two faces the rest of the world
 * sees: a public ADDRESS in the 195 block, which is the number written as the low three
 * octets of `195.a.b.c`, and an ESSID, `mission-<number>` in decimal, which keys its
 * subnet, its generated shape and its journal the way every other network's ESSID does.
 * The number itself never leaves the server; these are the forms a player holds.
 *
 * Not every 24-bit number names a contract. The last octet of the address is a host
 * octet, so it runs 2–254 as the contractor boards' addresses do (`.0`, `.1` and `.255`
 * are not hosts) — the address writer and both readers agree on exactly that set, so the
 * number and the address map one-to-one over it and nothing else.
 */

import { MISSION_FIRST_OCTET } from '../generation/world.js';

/** The widest a contract number can be: three octets. */
const MISSION_NUMBER_CEILING = 0x1000000;
const LOWEST_HOST_OCTET = 2;
const HIGHEST_HOST_OCTET = 254;

/** Whether `candidate` is a number that names a contract: a whole number in the 24-bit
 *  block whose last octet is a host octet (2–254), so it has an address. */
export const isMissionNumber = (candidate: number): boolean =>
  Number.isInteger(candidate) &&
  candidate >= 0 &&
  candidate < MISSION_NUMBER_CEILING &&
  candidate % 256 >= LOWEST_HOST_OCTET &&
  candidate % 256 <= HIGHEST_HOST_OCTET;

/** The 195 address of the contract numbered `missionNumber`, or null when the number
 *  names no contract. */
export const missionAddressForNumber = (missionNumber: number): string | null => {
  if (!isMissionNumber(missionNumber)) return null;
  const high = Math.floor(missionNumber / 65536);
  const mid = Math.floor(missionNumber / 256) % 256;
  const low = missionNumber % 256;
  return `${MISSION_FIRST_OCTET}.${high}.${mid}.${low}`;
};

const OCTET = /^(0|[1-9]\d{0,2})$/;

/** The octets of `address`, or null for anything that is not four 0–255 octets written
 *  without leading zeros. */
const octetsOf = (address: string): readonly number[] | null => {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (OCTET.test(part) ? Number(part) : -1));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
};

/** The contract number a 195 address carries, or null when the address is in another
 *  block or names no contract. */
export const missionNumberForAddress = (address: string): number | null => {
  const octets = octetsOf(address);
  if (octets === null || octets[0] !== MISSION_FIRST_OCTET) return null;
  const missionNumber = octets[1] * 65536 + octets[2] * 256 + octets[3];
  return isMissionNumber(missionNumber) ? missionNumber : null;
};

const MISSION_ESSID_PREFIX = 'mission-';

/** The ESSID of the contract numbered `missionNumber`: `mission-` and the number in
 *  decimal. */
export const missionEssid = (missionNumber: number): string =>
  `${MISSION_ESSID_PREFIX}${missionNumber}`;

/** The contract number an ESSID names, or null when the ESSID is not a contract
 *  network's — a reader that lets `generateHomeLan` and the server branch on one. The
 *  decimal must be canonical (no leading zeros) and itself name a contract. */
export const missionNumberFromEssid = (essid: string): number | null => {
  if (!essid.startsWith(MISSION_ESSID_PREFIX)) return null;
  const digits = essid.slice(MISSION_ESSID_PREFIX.length);
  if (!/^(0|[1-9]\d*)$/.test(digits)) return null;
  const missionNumber = Number(digits);
  return isMissionNumber(missionNumber) ? missionNumber : null;
};
