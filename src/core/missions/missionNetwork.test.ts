import { describe, expect, it } from 'vitest';
import {
  missionAddressForNumber,
  missionEssid,
  missionNumberForAddress,
  missionNumberFromEssid,
} from './missionNetwork.js';
import { MISSION_FIRST_OCTET } from '../generation/world.js';

describe('missionAddressForNumber', () => {
  it('writes the number as the low three octets of a 195 address', () => {
    // 1·65536 + 2·256 + 3 = 66051.
    expect(missionAddressForNumber(66051)).toBe(`${MISSION_FIRST_OCTET}.1.2.3`);
    expect(missionAddressForNumber(2)).toBe(`${MISSION_FIRST_OCTET}.0.0.2`);
    expect(missionAddressForNumber(0xffffff - 1)).toBe(`${MISSION_FIRST_OCTET}.255.255.254`);
  });

  it('has no address for a number whose last octet falls outside the host range', () => {
    // The last octet mirrors the boards' CHECK of 2–254: .0, .1 and .255 are not hosts.
    expect(missionAddressForNumber(0)).toBeNull();
    expect(missionAddressForNumber(1)).toBeNull();
    expect(missionAddressForNumber(255)).toBeNull();
  });

  it('has no address for a number outside the 24-bit block or not a whole number', () => {
    expect(missionAddressForNumber(-1)).toBeNull();
    expect(missionAddressForNumber(0x1000000)).toBeNull();
    // Just past the ceiling with a host last octet: the ceiling check must reject it, not
    // only the last-octet check (which the ceiling itself trips because it is a multiple
    // of 256).
    expect(missionAddressForNumber(0x1000002)).toBeNull();
    expect(missionAddressForNumber(66051.5)).toBeNull();
  });
});

describe('missionNumberForAddress', () => {
  it('reads the number back from a 195 address, one-to-one with the writer', () => {
    for (const missionNumber of [2, 66051, 0xffffff - 1]) {
      const address = missionAddressForNumber(missionNumber);
      expect(address).not.toBeNull();
      expect(missionNumberForAddress(address as string)).toBe(missionNumber);
    }
  });

  it('has no number for an address whose last octet is not a host', () => {
    expect(missionNumberForAddress(`${MISSION_FIRST_OCTET}.0.0.0`)).toBeNull();
    expect(missionNumberForAddress(`${MISSION_FIRST_OCTET}.0.0.1`)).toBeNull();
    expect(missionNumberForAddress(`${MISSION_FIRST_OCTET}.255.255.255`)).toBeNull();
  });

  it('has no number for an address in another block or of another shape', () => {
    expect(missionNumberForAddress('194.1.2.3')).toBeNull();
    expect(missionNumberForAddress('87.1.2.3')).toBeNull();
    expect(missionNumberForAddress('195.1.2')).toBeNull();
    expect(missionNumberForAddress('195.1.2.3.4')).toBeNull();
    expect(missionNumberForAddress('195.1.2.300')).toBeNull();
    expect(missionNumberForAddress('mission-66051')).toBeNull();
  });

  it('has no number for an address with a non-numeric or non-canonical octet', () => {
    // A non-numeric octet is not quietly read as some number; a leading zero or trailing
    // space is not a canonical octet, so neither names a contract even where the digits
    // would otherwise decode to a host number.
    expect(missionNumberForAddress('195.1.x.3')).toBeNull();
    expect(missionNumberForAddress('195.01.2.3')).toBeNull();
    expect(missionNumberForAddress('195.1.2.3 ')).toBeNull();
  });
});

describe('missionEssid and missionNumberFromEssid', () => {
  it('names a network after its number in decimal, and reads it back', () => {
    expect(missionEssid(66051)).toBe('mission-66051');
    expect(missionNumberFromEssid('mission-66051')).toBe(66051);
  });

  it('has no number for an essid that is not a mission network', () => {
    expect(missionNumberFromEssid('Ridgemont Public Library')).toBeNull();
    expect(missionNumberFromEssid('mission-')).toBeNull();
    expect(missionNumberFromEssid('mission-12x')).toBeNull();
    expect(missionNumberFromEssid('mission-01')).toBeNull();
    expect(missionNumberFromEssid('mission-0')).toBeNull();
    // A leading zero or a trailing non-digit is not canonical, even where the digits parse
    // to a real contract number — the essid must be the exact decimal the writer produced.
    expect(missionNumberFromEssid('mission-066051')).toBeNull();
    expect(missionNumberFromEssid('mission-66051.0')).toBeNull();
  });
});
