import { describe, expect, it } from 'vitest';
import { isBoardAddress, isPublicIp } from './ip.js';
import { BOARD_FIRST_OCTET, PLACELESS_FIRST_OCTET } from './world.js';

// The first octets networks' addresses were once drawn from at random. None of them is
// a block the world answers in.
const RETIRED_FIRST_OCTETS = [45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212];

describe('isPublicIp', () => {
  it("accepts an address in a region's block and in the placeless block", () => {
    expect(isPublicIp('87.1.0.159')).toBe(true);
    expect(isPublicIp(`${PLACELESS_FIRST_OCTET}.44.12.9`)).toBe(true);
  });

  it("accepts an address in the contractor boards' block, held or not", () => {
    // A board's address is routed to the server like any public one; whether anybody holds
    // it is the server's to say, so an unheld one answers there as nothing.
    expect(isPublicIp(`${BOARD_FIRST_OCTET}.12.40.7`)).toBe(true);
    expect(isPublicIp('194.0.0.2')).toBe(true);
    expect(isPublicIp('194.255.255.254')).toBe(true);
  });

  it("refuses the blocks either side of the boards'", () => {
    expect(isPublicIp('192.12.40.7')).toBe(false);
    expect(isPublicIp('195.12.40.7')).toBe(false);
  });

  it('refuses an address outside every block the world answers in', () => {
    // Every network's address is derived from its place in the world, so an address in
    // no block of it is no network's: aimed at, it is just an address off the LAN.
    for (const octet of RETIRED_FIRST_OCTETS) {
      expect(isPublicIp(`${octet}.12.34.56`), String(octet)).toBe(false);
    }
  });

  it('refuses a private address, a range, a name and a longer run of digits', () => {
    expect(isPublicIp('192.168.1.5')).toBe(false);
    expect(isPublicIp('87.12.34.56-60')).toBe(false);
    expect(isPublicIp('1087.12.34.56')).toBe(false);
    expect(isPublicIp('ridgemont.edu')).toBe(false);
  });
});

describe('isBoardAddress', () => {
  it("accepts a single address in the contractor boards' block", () => {
    expect(isBoardAddress('194.12.40.7')).toBe(true);
  });

  it('refuses an address in any other block, and any other shape', () => {
    expect(isBoardAddress('193.12.40.7')).toBe(false);
    expect(isBoardAddress('87.1.0.159')).toBe(false);
    expect(isBoardAddress('194.12.40')).toBe(false);
    expect(isBoardAddress('194.12.40.7-9')).toBe(false);
  });
});
