import { describe, expect, it } from 'vitest';
import { CLIENT_HANDLES, clientByHandle, missionTerms } from './missionTerms.js';
import { missionShape, missionTopology } from './missionShape.js';
import { md5 } from '../generation/md5.js';
import { validateUsername } from '../gameConfig/gameConfig.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const SAMPLE_NUMBERS = Array.from({ length: 2000 }, (_unused, index) => index * 8381 + 2).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
);

const isTwoHop = (missionNumber: number): boolean =>
  missionTopology(missionNumber).frontBoxOctet !== null;

const SINGLE_HOP_NUMBERS = SAMPLE_NUMBERS.filter((missionNumber) => !isTwoHop(missionNumber));
const TWO_HOP_NUMBERS = SAMPLE_NUMBERS.filter(isTwoHop);

const capitalised = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

describe('missionTerms', () => {
  it('gives the same terms for the same number', () => {
    expect(missionTerms(66051)).toEqual(missionTerms(66051));
  });

  it('offers a single-hop job as retrieving an access key', () => {
    for (const missionNumber of SINGLE_HOP_NUMBERS) {
      expect(missionTerms(missionNumber).kind).toBe('retrieve an access key');
    }
  });

  // The board says which job is the harder one, so a contractor takes it knowingly and its
  // pay makes sense.
  it('offers a two-hop job as retrieving an internal access key', () => {
    for (const missionNumber of TWO_HOP_NUMBERS) {
      expect(missionTerms(missionNumber).kind).toBe('retrieve an internal access key');
    }
  });

  it('pays a single-hop job from 500 to 2,000 JSC in steps of 50, reaching both ends', () => {
    const pays = SINGLE_HOP_NUMBERS.map((missionNumber) => missionTerms(missionNumber).pay);

    for (const pay of pays) expect(pay % 50).toBe(0);
    expect(Math.min(...pays)).toBe(500);
    expect(Math.max(...pays)).toBe(2000);
  });

  it('pays a two-hop job from 2,000 to 4,000 JSC in steps of 50, reaching both ends', () => {
    const pays = TWO_HOP_NUMBERS.map((missionNumber) => missionTerms(missionNumber).pay);

    for (const pay of pays) expect(pay % 50).toBe(0);
    expect(Math.min(...pays)).toBe(2000);
    expect(Math.max(...pays)).toBe(4000);
  });

  it('keeps the terms of every single-hop contract as they were', () => {
    // Taken before a two-hop job had terms of its own: every single-hop contract's client,
    // target, pitch, key and pay.
    expect(md5(JSON.stringify(SINGLE_HOP_NUMBERS.map(missionTerms)))).toBe(
      'd3bb6b75e3330c47cdb497b937549cc0',
    );
  });

  it('keeps the client, target, pitch and key of a two-hop contract as they were', () => {
    const beside = TWO_HOP_NUMBERS.map(missionTerms).map(
      ({ kind: _kind, pay: _pay, ...rest }) => rest,
    );

    expect(md5(JSON.stringify(beside))).toBe('e66e3edbd697f212acf143798fb709c2');
  });

  it('names the target company after the stem its boxes are named for', () => {
    // A briefing against "Halden Logistics" leads to `halden-gw` and `halden-files`, so the
    // company and the hostnames a scan turns up read as one business.
    for (const missionNumber of SAMPLE_NUMBERS.slice(0, 200)) {
      const { stem } = missionShape(missionNumber);
      expect(missionTerms(missionNumber).targetCompany).toMatch(
        new RegExp(`^${capitalised(stem)} [A-Z][a-z]+$`),
      );
    }
  });

  it('draws every client in the pool, each writing from a handle mail can send to', () => {
    // `mail` sends only to a valid handle, and the proof of a job is mailed to the client.
    const drawn = new Set(
      SAMPLE_NUMBERS.map((missionNumber) => missionTerms(missionNumber).client.handle),
    );

    expect(drawn).toEqual(new Set(CLIENT_HANDLES));
    for (const handle of CLIENT_HANDLES) expect(validateUsername(handle)).toBeNull();
  });

  // A mail to a client handle is answered by that client, in its company's name.
  it('finds the client a handle belongs to, and nobody for any other handle', () => {
    const { client } = missionTerms(SAMPLE_NUMBERS[0]!);

    expect(clientByHandle(client.handle)).toEqual(client);
    expect(clientByHandle('neo')).toBeNull();
    expect(clientByHandle(client.handle.toUpperCase())).toBeNull();
  });

  it('pairs each client handle with one company', () => {
    const companyByHandle = new Map<string, Set<string>>();
    for (const missionNumber of SAMPLE_NUMBERS) {
      const { client } = missionTerms(missionNumber);
      companyByHandle.set(
        client.handle,
        new Set([...(companyByHandle.get(client.handle) ?? []), client.company]),
      );
    }
    for (const companies of companyByHandle.values()) expect(companies.size).toBe(1);
  });

  // Each pool entry ends up in front of a player, on the board or in the briefing.
  it('names every client, pitch and thing the key opens in words a player can read', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const { client, pitch, keyOpens } = missionTerms(missionNumber);
      expect(client.company).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      expect(pitch).toMatch(/^[A-Z].{20,}\.$/);
      expect(keyOpens).toMatch(/^the [a-z]+( [A-Za-z]+)+$/);
    }
  });

  it('varies the pitch and what the key opens between contracts', () => {
    const pitches = new Set(
      SAMPLE_NUMBERS.map((missionNumber) => missionTerms(missionNumber).pitch),
    );
    const opens = new Set(
      SAMPLE_NUMBERS.map((missionNumber) => missionTerms(missionNumber).keyOpens),
    );

    expect(pitches.size).toBeGreaterThan(1);
    expect(opens.size).toBeGreaterThan(1);
  });
});
