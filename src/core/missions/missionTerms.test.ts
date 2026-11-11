import { describe, expect, it } from 'vitest';
import { CLIENT_HANDLES, clientByHandle, missionTerms, type MissionTerms } from './missionTerms.js';
import { missionKind, missionShape, missionTopology } from './missionShape.js';
import { missionAction } from './missionRecords.js';
import { md5 } from '../generation/md5.js';
import { validateUsername } from '../gameConfig/gameConfig.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const SAMPLE_NUMBERS = Array.from({ length: 2000 }, (_unused, index) => index * 8381 + 2).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
);

const isTwoHop = (missionNumber: number): boolean =>
  missionTopology(missionNumber).frontBoxOctet !== null;

const isKeyJob = (missionNumber: number): boolean => missionKind(missionNumber) === 'key';

const KEY_NUMBERS = SAMPLE_NUMBERS.filter(isKeyJob);
const TAMPER_NUMBERS = SAMPLE_NUMBERS.filter((missionNumber) => !isKeyJob(missionNumber));

const SINGLE_HOP_NUMBERS = KEY_NUMBERS.filter((missionNumber) => !isTwoHop(missionNumber));
const TWO_HOP_NUMBERS = KEY_NUMBERS.filter(isTwoHop);
const SINGLE_HOP_TAMPER_NUMBERS = TAMPER_NUMBERS.filter(
  (missionNumber) => !isTwoHop(missionNumber),
);
const TWO_HOP_TAMPER_NUMBERS = TAMPER_NUMBERS.filter(isTwoHop);

const isErase = (missionNumber: number): boolean => missionAction(missionNumber) === 'erase';

/** A key job's terms, failing the test on anything else. */
const keyTermsOf = (missionNumber: number): Extract<MissionTerms, { readonly job: 'key' }> => {
  const terms = missionTerms(missionNumber);
  if (terms.job !== 'key') throw new Error(`contract ${missionNumber} is not a key job`);
  return terms;
};

/** Terms as they read before a contract could be a tamper job, which had no `job`. */
const withoutJob = ({ job: _job, ...rest }: MissionTerms) => rest;

/** Every pitch a key job is offered with, none of which a tamper job may borrow. */
const KEY_JOB_PITCHES = new Set(
  KEY_NUMBERS.map((missionNumber) => missionTerms(missionNumber).pitch),
);

const capitalised = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

describe('missionTerms', () => {
  it('gives the same terms for the same number', () => {
    expect(missionTerms(66051)).toEqual(missionTerms(66051));
  });

  it('offers a single-hop key job as retrieving an access key', () => {
    for (const missionNumber of SINGLE_HOP_NUMBERS) {
      expect(missionTerms(missionNumber).kind).toBe('retrieve an access key');
    }
  });

  // The board says which job is the harder one, so a contractor takes it knowingly and its
  // pay makes sense.
  it('offers a two-hop key job as retrieving an internal access key', () => {
    for (const missionNumber of TWO_HOP_NUMBERS) {
      expect(missionTerms(missionNumber).kind).toBe('retrieve an internal access key');
    }
  });

  it('pays a single-hop key job from 500 to 2,000 JSC in steps of 50, reaching both ends', () => {
    const pays = SINGLE_HOP_NUMBERS.map((missionNumber) => missionTerms(missionNumber).pay);

    for (const pay of pays) expect(pay % 50).toBe(0);
    expect(Math.min(...pays)).toBe(500);
    expect(Math.max(...pays)).toBe(2000);
  });

  it('pays a two-hop key job from 2,000 to 4,000 JSC in steps of 50, reaching both ends', () => {
    const pays = TWO_HOP_NUMBERS.map((missionNumber) => missionTerms(missionNumber).pay);

    for (const pay of pays) expect(pay % 50).toBe(0);
    expect(Math.min(...pays)).toBe(2000);
    expect(Math.max(...pays)).toBe(4000);
  });

  it('keeps the terms of every single-hop key job as they were', () => {
    // Taken before a two-hop job had terms of its own: every single-hop contract's client,
    // target, pitch, key and pay.
    expect(md5(JSON.stringify(SINGLE_HOP_NUMBERS.map(missionTerms).map(withoutJob)))).toBe(
      'dca6fb2ad0d50ab224d7d38682eee693',
    );
  });

  it('keeps the client, target, pitch and key of a two-hop key job as they were', () => {
    const beside = TWO_HOP_NUMBERS.map(missionTerms)
      .map(withoutJob)
      .map(({ kind: _kind, pay: _pay, ...rest }) => rest);

    expect(md5(JSON.stringify(beside))).toBe('ef39e6bae266b14600778ba4950c9746');
  });

  it('marks each contract a key job or a tamper job, as its shape does', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      expect(missionTerms(missionNumber).job).toBe(missionShape(missionNumber).kind);
    }
  });

  describe('a tamper job', () => {
    it('is offered as altering a school record on one hop, an internal one on two', () => {
      for (const missionNumber of SINGLE_HOP_TAMPER_NUMBERS.filter((number) => !isErase(number))) {
        expect(missionTerms(missionNumber).kind).toBe('alter a school record');
      }
      for (const missionNumber of TWO_HOP_TAMPER_NUMBERS.filter((number) => !isErase(number))) {
        expect(missionTerms(missionNumber).kind).toBe('alter an internal school record');
      }
    });

    it('is offered as erasing a school record on one hop, an internal one on two, when it asks a record gone', () => {
      const singleHopErases = SINGLE_HOP_TAMPER_NUMBERS.filter(isErase);
      const twoHopErases = TWO_HOP_TAMPER_NUMBERS.filter(isErase);

      expect(singleHopErases.length).toBeGreaterThan(0);
      expect(twoHopErases.length).toBeGreaterThan(0);
      for (const missionNumber of singleHopErases) {
        expect(missionTerms(missionNumber).kind).toBe('erase a school record');
      }
      for (const missionNumber of twoHopErases) {
        expect(missionTerms(missionNumber).kind).toBe('erase an internal school record');
      }
    });

    it('pays 1,000 to 2,500 JSC on one hop, in steps of 50, reaching both ends', () => {
      const pays = SINGLE_HOP_TAMPER_NUMBERS.map(
        (missionNumber) => missionTerms(missionNumber).pay,
      );

      for (const pay of pays) expect(pay % 50).toBe(0);
      expect(Math.min(...pays)).toBe(1000);
      expect(Math.max(...pays)).toBe(2500);
    });

    it('pays 2,500 to 5,000 JSC on two hops, in steps of 50, reaching both ends', () => {
      const pays = TWO_HOP_TAMPER_NUMBERS.map((missionNumber) => missionTerms(missionNumber).pay);

      for (const pay of pays) expect(pay % 50).toBe(0);
      expect(Math.min(...pays)).toBe(2500);
      expect(Math.max(...pays)).toBe(5000);
    });

    it('names the school after the stem its boxes are named for', () => {
      for (const missionNumber of TAMPER_NUMBERS.slice(0, 200)) {
        const { stem } = missionShape(missionNumber);
        expect(missionTerms(missionNumber).targetCompany).toBe(`${capitalised(stem)} Academy`);
      }
    });

    it('draws every client, and pitches a reason a school record is worth changing', () => {
      const terms = TAMPER_NUMBERS.map(missionTerms);
      const pitches = new Set(terms.map(({ pitch }) => pitch));

      expect(new Set(terms.map(({ client }) => client.handle))).toEqual(new Set(CLIENT_HANDLES));
      expect(pitches.size).toBeGreaterThan(3);
      for (const pitch of pitches) {
        expect(pitch).toMatch(/^[A-Z].{20,}\.$/);
        expect(KEY_JOB_PITCHES.has(pitch)).toBe(false);
      }
    });

    // A pitch for raising a grade reads wrong on a job that deletes one, and the other way round.
    it('pitches an erase job from reasons of its own, none a change job is pitched with', () => {
      const pitchesOf = (numbers: readonly number[]) =>
        new Set(numbers.map((missionNumber) => missionTerms(missionNumber).pitch));
      const erasePitches = pitchesOf(TAMPER_NUMBERS.filter(isErase));
      const changePitches = pitchesOf(TAMPER_NUMBERS.filter((number) => !isErase(number)));

      expect(erasePitches.size).toBeGreaterThan(2);
      expect(changePitches.size).toBeGreaterThan(2);
      for (const pitch of erasePitches) expect(changePitches.has(pitch)).toBe(false);
    });

    it('promises no key', () => {
      for (const missionNumber of TAMPER_NUMBERS) {
        expect('keyOpens' in missionTerms(missionNumber)).toBe(false);
      }
    });
  });

  it('names the target company after the stem its boxes are named for', () => {
    // A briefing against "Halden Logistics" leads to `halden-gw` and `halden-files`, so the
    // company and the hostnames a scan turns up read as one business.
    for (const missionNumber of KEY_NUMBERS.slice(0, 200)) {
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
    for (const missionNumber of KEY_NUMBERS) {
      const { client, pitch, keyOpens } = keyTermsOf(missionNumber);
      expect(client.company).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      expect(pitch).toMatch(/^[A-Z].{20,}\.$/);
      expect(keyOpens).toMatch(/^the [a-z]+( [A-Za-z]+)+$/);
    }
  });

  it('varies the pitch and what the key opens between key jobs', () => {
    const pitches = new Set(KEY_NUMBERS.map((missionNumber) => missionTerms(missionNumber).pitch));
    const opens = new Set(KEY_NUMBERS.map((missionNumber) => keyTermsOf(missionNumber).keyOpens));

    expect(pitches.size).toBeGreaterThan(1);
    expect(opens.size).toBeGreaterThan(1);
  });
});
