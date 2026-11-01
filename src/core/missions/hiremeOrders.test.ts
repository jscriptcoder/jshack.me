import { describe, expect, it } from 'vitest';
import {
  acceptedLine,
  droppedLine,
  readMissionOrder,
  showReport,
} from './hiremeOrders.js';
import { missionShape } from './missionShape.js';
import { missionKey, missionKeyPath } from './missionSecret.js';
import { missionAddressForNumber, missionEssid } from './missionNetwork.js';

/**
 * What the operator types at `scripts/hireme.ts`, and what `show` prints back. The order
 * parser refuses anything that is not exactly one of the three the script runs, so a near
 * miss is never taken for another; the report names the one thing only an operator can see,
 * the key, beside the address and route a contractor would work out for themselves.
 */

describe('readMissionOrder', () => {
  it('reads an accept of a handle, with no number drawn yet', () => {
    expect(readMissionOrder(['accept', 'alice'])).toEqual({
      verb: 'accept',
      handle: 'alice',
      number: null,
    });
  });

  it('reads an accept at a chosen number', () => {
    expect(readMissionOrder(['accept', 'alice', '--number', '66051'])).toEqual({
      verb: 'accept',
      handle: 'alice',
      number: 66051,
    });
  });

  it('refuses an accept with a --number that is not a non-negative integer', () => {
    expect(readMissionOrder(['accept', 'alice', '--number', 'x'])).toBeNull();
    expect(readMissionOrder(['accept', 'alice', '--number', '-1'])).toBeNull();
    expect(readMissionOrder(['accept', 'alice', '--number', '1.5'])).toBeNull();
  });

  it('refuses an accept with --number but no number after it', () => {
    expect(readMissionOrder(['accept', 'alice', '--number'])).toBeNull();
  });

  it('refuses an accept with a trailing word it does not understand', () => {
    expect(readMissionOrder(['accept', 'alice', 'extra'])).toBeNull();
    expect(readMissionOrder(['accept', 'alice', '--number', '1', 'extra'])).toBeNull();
  });

  it('refuses an accept with no handle, or a handle that looks like a flag', () => {
    expect(readMissionOrder(['accept'])).toBeNull();
    expect(readMissionOrder(['accept', '--number'])).toBeNull();
  });

  it('reads a show of an address', () => {
    expect(readMissionOrder(['show', '195.1.2.3'])).toEqual({ verb: 'show', address: '195.1.2.3' });
  });

  it('reads a drop of a handle', () => {
    expect(readMissionOrder(['drop', 'alice'])).toEqual({ verb: 'drop', handle: 'alice' });
  });

  it('refuses show and drop without exactly one argument', () => {
    expect(readMissionOrder(['show'])).toBeNull();
    expect(readMissionOrder(['show', '195.1.2.3', 'extra'])).toBeNull();
    expect(readMissionOrder(['drop'])).toBeNull();
    expect(readMissionOrder(['drop', 'alice', 'extra'])).toBeNull();
  });

  it('refuses an unknown verb and an empty order', () => {
    expect(readMissionOrder(['complete', 'alice'])).toBeNull();
    expect(readMissionOrder([])).toBeNull();
  });
});

describe('showReport', () => {
  const SECRET = 'operator-test-secret';
  // One number per route, so the report is checked on both.
  const HYDRA = Array.from({ length: 4000 }, (_unused, index) => index * 256 + 2).find(
    (candidate) => missionShape(candidate).route === 'hydra',
  )!;
  const MSFCONSOLE = Array.from({ length: 4000 }, (_unused, index) => index * 256 + 2).find(
    (candidate) => missionShape(candidate).route === 'msfconsole',
  )!;

  it('prints the key only an operator can derive, beside its path', () => {
    const report = showReport(HYDRA, SECRET);

    expect(report).toContain(missionKey(HYDRA, SECRET));
    expect(report).toContain(missionKeyPath(HYDRA));
  });

  it('names the contract by its address and essid', () => {
    const report = showReport(HYDRA, SECRET);

    expect(report).toContain(missionAddressForNumber(HYDRA)!);
    expect(report).toContain(missionEssid(HYDRA));
  });

  it("names the number's actual route", () => {
    expect(showReport(HYDRA, SECRET)).toContain('hydra');
    expect(showReport(MSFCONSOLE, SECRET)).toContain('msfconsole');
  });

  it('prints a different key under a different secret, as the two deployments do', () => {
    expect(showReport(HYDRA, 'secret-one')).not.toBe(showReport(HYDRA, 'secret-two'));
  });
});

describe('the lines the script prints with an address', () => {
  it('names the address an accepted contract now answers at', () => {
    const line = acceptedLine('alice', 66051, '195.1.2.3');

    expect(line).toContain('alice');
    expect(line).toContain('66051');
    expect(line).toContain('195.1.2.3');
  });

  it('names the address a dropped contract still answers at', () => {
    const line = droppedLine('alice', 66051, '195.1.2.3');

    expect(line).toContain('alice');
    expect(line).toContain('66051');
    expect(line).toContain('195.1.2.3');
  });
});
