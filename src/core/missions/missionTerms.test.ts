import { describe, expect, it } from 'vitest';
import { CLIENT_HANDLES, clientByHandle, missionTerms, type MissionTerms } from './missionTerms.js';
import {
  missionKind,
  missionShape,
  missionTopology,
  type MissionKind,
} from './missionShape.js';
import { missionAction, missionSetting, type RecordSetting } from './missionRecords.js';
import { missionFileItem } from './missionFileItem.js';
import { portforwardJob } from './portforwardJob.js';
import { md5 } from '../generation/md5.js';
import { isMissionNumber } from './missionNetwork.js';
import { validateUsername } from '../gameConfig/gameConfig.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const SAMPLE_NUMBERS = Array.from({ length: 2000 }, (_unused, index) => index * 8381 + 2).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
);

/** The jobs of one kind across a wider spread than the sample, for the checks that must reach
 *  every share or both ends of a pay range: a tenth of the sample is too few to. */
const widerJobsOf = (kind: MissionKind): readonly number[] =>
  Array.from({ length: 6000 }, (_unused, index) => index * 2741 + 2).filter(
    (missionNumber) => isMissionNumber(missionNumber) && missionKind(missionNumber) === kind,
  );

const isTwoHop = (missionNumber: number): boolean =>
  missionTopology(missionNumber).frontBoxOctet !== null;

const KEY_NUMBERS = SAMPLE_NUMBERS.filter((missionNumber) => missionKind(missionNumber) === 'key');
const TAMPER_NUMBERS = SAMPLE_NUMBERS.filter(
  (missionNumber) => missionKind(missionNumber) === 'tamper',
);

const SABOTAGE_NUMBERS = SAMPLE_NUMBERS.filter(
  (missionNumber) => missionKind(missionNumber) === 'sabotage',
);

const FILE_NUMBERS = SAMPLE_NUMBERS.filter(
  (missionNumber) => missionKind(missionNumber) === 'file',
);

const BACKDOOR_NUMBERS = SAMPLE_NUMBERS.filter(
  (missionNumber) => missionKind(missionNumber) === 'backdoor',
);

const INFILTRATE_NUMBERS = SAMPLE_NUMBERS.filter(
  (missionNumber) => missionKind(missionNumber) === 'infiltrate',
);

const PORTFORWARD_NUMBERS = SAMPLE_NUMBERS.filter(
  (missionNumber) => missionKind(missionNumber) === 'portforward',
);

/** The machines a sabotage job can ask taken down. */
const SABOTAGE_MACHINES = [
  'CCTV recorder',
  'backup server',
  'monitoring station',
  'build server',
  'licence server',
  'door-access controller',
  'billing server',
];

const SINGLE_HOP_NUMBERS = KEY_NUMBERS.filter((missionNumber) => !isTwoHop(missionNumber));
const TWO_HOP_NUMBERS = KEY_NUMBERS.filter(isTwoHop);
const SINGLE_HOP_TAMPER_NUMBERS = TAMPER_NUMBERS.filter(
  (missionNumber) => !isTwoHop(missionNumber),
);

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

/** What each setting's target is called after its stem, and what the board calls its records. */
const SETTING_NAMES: Readonly<Record<RecordSetting, { institution: string; noun: string }>> = {
  school: { institution: 'Academy', noun: 'school' },
  police: { institution: 'Police Dept', noun: 'police' },
  payroll: { institution: 'Holdings', noun: 'payroll' },
  dmv: { institution: 'Motor Registry', noun: 'motor registry' },
  tournament: { institution: 'Esports League', noun: 'tournament' },
  admissions: { institution: 'University', noun: 'admissions' },
  club: { institution: 'Members Club', noun: 'club' },
  registry: { institution: 'Vehicle Registry', noun: 'vehicle registry' },
};

/** The board line a tamper job is offered with: its verb, then its records, with an article
 *  that reads. */
const tamperKindOf = (missionNumber: number): string => {
  const verb = isErase(missionNumber) ? 'erase' : 'alter';
  const { noun } = SETTING_NAMES[missionSetting(missionNumber)];
  if (isTwoHop(missionNumber)) return `${verb} an internal ${noun} record`;
  return `${verb} ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun} record`;
};

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
    // target, pitch, key and pay. Retaken when sabotage jobs took a third of the numbers, again
    // when file jobs took a quarter, again when backdoor jobs took a fifth, and again when
    // infiltrate jobs took a sixth, again when portforward jobs took a seventh, again when
    // credential jobs took an eighth, again when destroy jobs took a ninth, and again when wipe
    // jobs took a tenth, each time over the key jobs left, whose terms the earlier digest's own
    // fixture held unchanged.
    expect(md5(JSON.stringify(SINGLE_HOP_NUMBERS.map(missionTerms).map(withoutJob)))).toBe(
      '66bb96149e260315c00f0fe96ded64a8',
    );
  });

  // Retaken over the key jobs left when wipe jobs took a tenth of the numbers.
  it('keeps the client, target, pitch and key of a two-hop key job as they were', () => {
    const beside = TWO_HOP_NUMBERS.map(missionTerms)
      .map(withoutJob)
      .map(({ kind: _kind, pay: _pay, ...rest }) => rest);

    expect(md5(JSON.stringify(beside))).toBe('5a5559e0cb5d853793360aaea274af64');
  });

  it('marks each contract a key, tamper, sabotage, file, backdoor, infiltrate, portforward, credential, destroy or wipe job, as its shape does', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      expect(missionTerms(missionNumber).job).toBe(missionShape(missionNumber).kind);
    }
  });

  describe('a tamper job', () => {
    it("is offered as altering or erasing its setting's record, an internal one on two hops", () => {
      for (const missionNumber of TAMPER_NUMBERS) {
        expect(missionTerms(missionNumber).kind, `contract ${missionNumber}`).toBe(
          tamperKindOf(missionNumber),
        );
      }
    });

    it('offers every setting, altering on one hop and two, and erasing wherever it may', () => {
      const offered = new Set(
        TAMPER_NUMBERS.map((missionNumber) => missionTerms(missionNumber).kind),
      );

      for (const [setting, { noun }] of Object.entries(SETTING_NAMES)) {
        expect(offered).toContain(`alter an internal ${noun} record`);
        if (setting === 'payroll') {
          expect(offered).not.toContain(`erase an internal ${noun} record`);
        } else {
          expect(offered).toContain(`erase an internal ${noun} record`);
        }
      }
      expect(offered).toContain('alter a school record');
      expect(offered).toContain('erase an admissions record');
      expect(offered).toContain('alter a vehicle registry record');
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
      const pays = widerJobsOf('tamper')
        .filter(isTwoHop)
        .map((missionNumber) => missionTerms(missionNumber).pay);

      for (const pay of pays) expect(pay % 50).toBe(0);
      expect(Math.min(...pays)).toBe(2500);
      expect(Math.max(...pays)).toBe(5000);
    });

    it('names the target after the stem its boxes are named for and what its setting is', () => {
      for (const missionNumber of TAMPER_NUMBERS) {
        const { stem } = missionShape(missionNumber);
        const { institution } = SETTING_NAMES[missionSetting(missionNumber)];
        expect(missionTerms(missionNumber).targetCompany).toBe(
          `${capitalised(stem)} ${institution}`,
        );
      }
    });

    it('draws every client, and pitches a reason the record is worth changing', () => {
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

    // A pitch about a grade reads wrong on a job at a police department, so each setting brings
    // three to five of its own for each thing it asks.
    it('pitches each setting from three to five reasons of its own for each action', () => {
      const pitchesBy = new Map<string, Set<string>>();
      for (const missionNumber of widerJobsOf('tamper')) {
        const asked = `${missionSetting(missionNumber)} ${missionAction(missionNumber)}`;
        pitchesBy.set(
          asked,
          new Set([...(pitchesBy.get(asked) ?? []), missionTerms(missionNumber).pitch]),
        );
      }
      const all = [...pitchesBy.values()].flatMap((pitches) => [...pitches]);

      expect([...pitchesBy.keys()].sort()).toHaveLength(15);
      for (const [asked, pitches] of pitchesBy) {
        expect(pitches.size, asked).toBeGreaterThanOrEqual(3);
        expect(pitches.size, asked).toBeLessThanOrEqual(6);
      }
      expect(new Set(all).size).toBe(all.length);
    });

    it('promises no key', () => {
      for (const missionNumber of TAMPER_NUMBERS) {
        expect('keyOpens' in missionTerms(missionNumber)).toBe(false);
      }
    });
  });

  describe('a sabotage job', () => {
    const SINGLE_HOP_SABOTAGE_NUMBERS = SABOTAGE_NUMBERS.filter(
      (missionNumber) => !isTwoHop(missionNumber),
    );
    const TWO_HOP_SABOTAGE_NUMBERS = SABOTAGE_NUMBERS.filter(isTwoHop);

    /** The machine a sabotage job is offered as taking down, read off the board's line. */
    const machineOf = (missionNumber: number): string =>
      missionTerms(missionNumber).kind.replace(/^take down (a|an internal) /, '');

    it('is offered as taking down one of seven machines, an internal one on two hops', () => {
      for (const missionNumber of SINGLE_HOP_SABOTAGE_NUMBERS) {
        expect(missionTerms(missionNumber).kind).toBe(`take down a ${machineOf(missionNumber)}`);
      }
      for (const missionNumber of TWO_HOP_SABOTAGE_NUMBERS) {
        expect(missionTerms(missionNumber).kind).toBe(
          `take down an internal ${machineOf(missionNumber)}`,
        );
      }
      expect(new Set(SABOTAGE_NUMBERS.map(machineOf))).toEqual(new Set(SABOTAGE_MACHINES));
    });

    it('asks for each machine about a seventh of the time', () => {
      const sabotageJobs = widerJobsOf('sabotage');
      for (const machine of SABOTAGE_MACHINES) {
        const share =
          sabotageJobs.filter((missionNumber) => machineOf(missionNumber) === machine).length /
          sabotageJobs.length;
        expect(share, machine).toBeGreaterThan(0.1);
        expect(share, machine).toBeLessThan(0.19);
      }
    });

    // Retaken over the sabotage jobs left when infiltrate jobs took a sixth of the numbers.
    it('keeps the client, the target and the pay it drew before its machine was drawn', () => {
      const kept = SABOTAGE_NUMBERS.map(missionTerms).map(({ client, targetCompany, pay }) => ({
        client,
        targetCompany,
        pay,
      }));

      // Retaken over the sabotage jobs left when wipe jobs took a tenth of the numbers.
      expect(md5(JSON.stringify(kept))).toBe('63b04718a8ab6414fb5750c9966d0266');
    });

    // The work is a key job's, finding the way in and rooting the box, so the pay is too.
    it('pays a key job: 500 to 2,000 JSC on one hop, 2,000 to 4,000 on two, in steps of 50', () => {
      const paysOf = (numbers: readonly number[]) =>
        numbers.map((missionNumber) => missionTerms(missionNumber).pay);
      const singleHop = paysOf(SINGLE_HOP_SABOTAGE_NUMBERS);
      const twoHop = paysOf(TWO_HOP_SABOTAGE_NUMBERS);

      for (const pay of [...singleHop, ...twoHop]) expect(pay % 50).toBe(0);
      expect([Math.min(...singleHop), Math.max(...singleHop)]).toEqual([500, 2000]);
      expect([Math.min(...twoHop), Math.max(...twoHop)]).toEqual([2000, 4000]);
    });

    // Any business runs a CCTV recorder, so the target is a key job's: the stem and a trade.
    it('names the target after its stem and a trade a key job is drawn from', () => {
      const keyJobTrades = new Set(
        KEY_NUMBERS.map((missionNumber) => missionTerms(missionNumber).targetCompany.split(' ')[1]),
      );

      for (const missionNumber of SABOTAGE_NUMBERS) {
        const { stem } = missionShape(missionNumber);
        const [company, trade, ...rest] = missionTerms(missionNumber).targetCompany.split(' ');
        expect(company).toBe(capitalised(stem));
        expect(keyJobTrades.has(trade ?? ''), `contract ${missionNumber}`).toBe(true);
        expect(rest).toEqual([]);
      }
    });

    it("draws every client, and pitches from three to six reasons of its machine's own", () => {
      const terms = SABOTAGE_NUMBERS.map(missionTerms);
      const tamperPitches = new Set(
        TAMPER_NUMBERS.map((missionNumber) => missionTerms(missionNumber).pitch),
      );
      const pitchesFor = (machine: string) =>
        new Set(
          SABOTAGE_NUMBERS.filter((missionNumber) => machineOf(missionNumber) === machine).map(
            (missionNumber) => missionTerms(missionNumber).pitch,
          ),
        );
      const seen = new Set<string>();

      expect(new Set(terms.map(({ client }) => client.handle))).toEqual(new Set(CLIENT_HANDLES));
      for (const machine of SABOTAGE_MACHINES) {
        const pitches = pitchesFor(machine);
        expect(pitches.size, machine).toBeGreaterThanOrEqual(3);
        expect(pitches.size, machine).toBeLessThanOrEqual(6);
        for (const pitch of pitches) {
          expect(pitch).toMatch(/^[A-Z].{20,}\.$/);
          expect(KEY_JOB_PITCHES.has(pitch)).toBe(false);
          expect(tamperPitches.has(pitch)).toBe(false);
          // A reason belongs to one machine: a backup server is not wanted down for its footage.
          expect(seen.has(pitch), pitch).toBe(false);
          seen.add(pitch);
        }
      }
    });

    it('promises no key', () => {
      for (const missionNumber of SABOTAGE_NUMBERS) {
        expect('keyOpens' in missionTerms(missionNumber)).toBe(false);
      }
    });
  });

  describe('a file job', () => {
    it('is offered as retrieving the item it asks for, an internal one on two hops', () => {
      for (const missionNumber of FILE_NUMBERS) {
        const { noun } = missionFileItem(missionNumber);
        expect(missionTerms(missionNumber).kind, `contract ${missionNumber}`).toBe(
          isTwoHop(missionNumber) ? `retrieve an internal ${noun}` : `retrieve a ${noun}`,
        );
      }
      expect(
        new Set(FILE_NUMBERS.map((missionNumber) => missionTerms(missionNumber).kind)).size,
      ).toBe(12);
    });

    // Carrying bytes home is more work than reading a key, but not a different tier.
    it('pays a key job: 500 to 2,000 JSC on one hop, 2,000 to 4,000 on two, in steps of 50', () => {
      const paysOf = (numbers: readonly number[]) =>
        numbers.map((missionNumber) => missionTerms(missionNumber).pay);
      const singleHop = paysOf(FILE_NUMBERS.filter((missionNumber) => !isTwoHop(missionNumber)));
      const twoHop = paysOf(FILE_NUMBERS.filter(isTwoHop));

      for (const pay of [...singleHop, ...twoHop]) expect(pay % 50).toBe(0);
      expect([Math.min(...singleHop), Math.max(...singleHop)]).toEqual([500, 2000]);
      expect([Math.min(...twoHop), Math.max(...twoHop)]).toEqual([2000, 4000]);
    });

    it('names the target after its stem and a trade a key job is drawn from', () => {
      const keyJobTrades = new Set(
        KEY_NUMBERS.map((missionNumber) => missionTerms(missionNumber).targetCompany.split(' ')[1]),
      );

      for (const missionNumber of FILE_NUMBERS) {
        const { stem } = missionShape(missionNumber);
        const [company, trade, ...rest] = missionTerms(missionNumber).targetCompany.split(' ');
        expect(company).toBe(capitalised(stem));
        expect(keyJobTrades.has(trade ?? ''), `contract ${missionNumber}`).toBe(true);
        expect(rest).toEqual([]);
      }
    });

    it("draws every client, and pitches from four reasons of its item's own", () => {
      const terms = FILE_NUMBERS.map(missionTerms);
      const otherPitches = new Set(
        [...KEY_NUMBERS, ...TAMPER_NUMBERS, ...SABOTAGE_NUMBERS].map(
          (missionNumber) => missionTerms(missionNumber).pitch,
        ),
      );
      const pitches = new Set(terms.map(({ pitch }) => pitch));

      expect(new Set(terms.map(({ client }) => client.handle))).toEqual(new Set(CLIENT_HANDLES));
      for (const missionNumber of FILE_NUMBERS) {
        expect(missionFileItem(missionNumber).pitches).toContain(missionTerms(missionNumber).pitch);
      }
      expect(pitches.size).toBe(24);
      for (const pitch of pitches) {
        expect(pitch).toMatch(/^[A-Z].{20,}\.$/);
        expect(otherPitches.has(pitch), pitch).toBe(false);
      }
    });

    it('promises no key', () => {
      for (const missionNumber of FILE_NUMBERS) {
        expect('keyOpens' in missionTerms(missionNumber)).toBe(false);
      }
    });
  });

  describe('an infiltrate job', () => {
    it('is offered as infiltrating its item, an internal one on two hops', () => {
      for (const missionNumber of INFILTRATE_NUMBERS) {
        const { noun } = missionFileItem(missionNumber);
        expect(missionTerms(missionNumber).kind, `contract ${missionNumber}`).toBe(
          isTwoHop(missionNumber) ? `infiltrate an internal ${noun}` : `infiltrate a ${noun}`,
        );
      }
      // Seven items, each offered on one hop and on two.
      expect(
        new Set(INFILTRATE_NUMBERS.map((missionNumber) => missionTerms(missionNumber).kind)).size,
      ).toBe(14);
    });

    // Putting a file in place is a key job's work, finding the way in and rooting the box.
    it('pays a key job: 500 to 2,000 JSC on one hop, 2,000 to 4,000 on two, in steps of 50', () => {
      const paysOf = (numbers: readonly number[]) =>
        numbers.map((missionNumber) => missionTerms(missionNumber).pay);
      const singleHop = paysOf(
        INFILTRATE_NUMBERS.filter((missionNumber) => !isTwoHop(missionNumber)),
      );
      const twoHop = paysOf(INFILTRATE_NUMBERS.filter(isTwoHop));

      for (const pay of [...singleHop, ...twoHop]) expect(pay % 50).toBe(0);
      expect([Math.min(...singleHop), Math.max(...singleHop)]).toEqual([500, 2000]);
      expect([Math.min(...twoHop), Math.max(...twoHop)]).toEqual([2000, 4000]);
    });

    it('names the target after its stem and a trade a key job is drawn from', () => {
      const keyJobTrades = new Set(
        KEY_NUMBERS.map((missionNumber) => missionTerms(missionNumber).targetCompany.split(' ')[1]),
      );

      for (const missionNumber of INFILTRATE_NUMBERS) {
        const { stem } = missionShape(missionNumber);
        const [company, trade, ...rest] = missionTerms(missionNumber).targetCompany.split(' ');
        expect(company).toBe(capitalised(stem));
        expect(keyJobTrades.has(trade ?? ''), `contract ${missionNumber}`).toBe(true);
        expect(rest).toEqual([]);
      }
    });

    it("draws every client, and pitches from its item's four reasons for slipping one in", () => {
      const infiltrateJobs = widerJobsOf('infiltrate');
      const terms = infiltrateJobs.map(missionTerms);
      const otherPitches = new Set(
        [
          ...KEY_NUMBERS,
          ...TAMPER_NUMBERS,
          ...SABOTAGE_NUMBERS,
          ...FILE_NUMBERS,
          ...BACKDOOR_NUMBERS,
        ].map((missionNumber) => missionTerms(missionNumber).pitch),
      );
      const pitches = new Set(terms.map(({ pitch }) => pitch));

      expect(new Set(terms.map(({ client }) => client.handle))).toEqual(new Set(CLIENT_HANDLES));
      for (const missionNumber of infiltrateJobs) {
        expect(missionFileItem(missionNumber).infiltratePitches).toContain(
          missionTerms(missionNumber).pitch,
        );
      }
      // Four for each of the seven items.
      expect(pitches.size).toBe(28);
      for (const pitch of pitches) {
        expect(pitch).toMatch(/^[A-Z].{20,}\.$/);
        expect(otherPitches.has(pitch), pitch).toBe(false);
      }
    });

    it('promises no key', () => {
      for (const missionNumber of INFILTRATE_NUMBERS) {
        expect('keyOpens' in missionTerms(missionNumber)).toBe(false);
      }
    });
  });

  describe('a backdoor job', () => {
    const SINGLE_HOP_BACKDOOR_NUMBERS = BACKDOOR_NUMBERS.filter(
      (missionNumber) => !isTwoHop(missionNumber),
    );
    const TWO_HOP_BACKDOOR_NUMBERS = BACKDOOR_NUMBERS.filter(isTwoHop);

    /** The machine a backdoor job is offered as planting on, read off the board's line. */
    const machineOf = (missionNumber: number): string =>
      missionTerms(missionNumber).kind.replace(/^plant a backdoor on (a|an internal) /, '');

    it('is offered as planting a backdoor on one of the seven machines, an internal one on two hops', () => {
      for (const missionNumber of SINGLE_HOP_BACKDOOR_NUMBERS) {
        expect(missionTerms(missionNumber).kind).toBe(
          `plant a backdoor on a ${machineOf(missionNumber)}`,
        );
      }
      for (const missionNumber of TWO_HOP_BACKDOOR_NUMBERS) {
        expect(missionTerms(missionNumber).kind).toBe(
          `plant a backdoor on an internal ${machineOf(missionNumber)}`,
        );
      }
      expect(new Set(BACKDOOR_NUMBERS.map(machineOf))).toEqual(new Set(SABOTAGE_MACHINES));
    });

    it('asks for each machine about a seventh of the time', () => {
      const backdoorJobs = widerJobsOf('backdoor');
      for (const machine of SABOTAGE_MACHINES) {
        const share =
          backdoorJobs.filter((missionNumber) => machineOf(missionNumber) === machine).length /
          backdoorJobs.length;
        expect(share, machine).toBeGreaterThan(0.1);
        expect(share, machine).toBeLessThan(0.19);
      }
    });

    // The work is a key job's, finding the way in and rooting the box, with one more step.
    it('pays a key job: 500 to 2,000 JSC on one hop, 2,000 to 4,000 on two, in steps of 50', () => {
      const paysOf = (numbers: readonly number[]) =>
        numbers.map((missionNumber) => missionTerms(missionNumber).pay);
      const backdoorJobs = widerJobsOf('backdoor');
      const singleHop = paysOf(backdoorJobs.filter((missionNumber) => !isTwoHop(missionNumber)));
      const twoHop = paysOf(backdoorJobs.filter(isTwoHop));

      for (const pay of [...singleHop, ...twoHop]) expect(pay % 50).toBe(0);
      expect([Math.min(...singleHop), Math.max(...singleHop)]).toEqual([500, 2000]);
      expect([Math.min(...twoHop), Math.max(...twoHop)]).toEqual([2000, 4000]);
    });

    it('names the target after its stem and a trade a key job is drawn from', () => {
      const keyJobTrades = new Set(
        KEY_NUMBERS.map((missionNumber) => missionTerms(missionNumber).targetCompany.split(' ')[1]),
      );

      for (const missionNumber of BACKDOOR_NUMBERS) {
        const { stem } = missionShape(missionNumber);
        const [company, trade, ...rest] = missionTerms(missionNumber).targetCompany.split(' ');
        expect(company).toBe(capitalised(stem));
        expect(keyJobTrades.has(trade ?? ''), `contract ${missionNumber}`).toBe(true);
        expect(rest).toEqual([]);
      }
    });

    it("draws every client, and pitches from three or four reasons of its machine's own", () => {
      const terms = BACKDOOR_NUMBERS.map(missionTerms);
      const otherPitches = new Set(
        [...KEY_NUMBERS, ...TAMPER_NUMBERS, ...SABOTAGE_NUMBERS, ...FILE_NUMBERS].map(
          (missionNumber) => missionTerms(missionNumber).pitch,
        ),
      );
      const pitchesFor = (machine: string) =>
        new Set(
          BACKDOOR_NUMBERS.filter((missionNumber) => machineOf(missionNumber) === machine).map(
            (missionNumber) => missionTerms(missionNumber).pitch,
          ),
        );
      const seen = new Set<string>();

      expect(new Set(terms.map(({ client }) => client.handle))).toEqual(new Set(CLIENT_HANDLES));
      for (const machine of SABOTAGE_MACHINES) {
        const pitches = pitchesFor(machine);
        expect(pitches.size, machine).toBeGreaterThanOrEqual(3);
        expect(pitches.size, machine).toBeLessThanOrEqual(4);
        for (const pitch of pitches) {
          expect(pitch).toMatch(/^[A-Z].{20,}\.$/);
          // A standing way in is not why anyone wants a machine taken down.
          expect(otherPitches.has(pitch), pitch).toBe(false);
          expect(seen.has(pitch), pitch).toBe(false);
          seen.add(pitch);
        }
      }
    });

    it('promises no key', () => {
      for (const missionNumber of BACKDOOR_NUMBERS) {
        expect('keyOpens' in missionTerms(missionNumber)).toBe(false);
      }
    });
  });

  describe('a destroy job', () => {
    const DESTROY_NUMBERS = widerJobsOf('destroy');
    const SINGLE_HOP_DESTROY_NUMBERS = DESTROY_NUMBERS.filter(
      (missionNumber) => !isTwoHop(missionNumber),
    );
    const TWO_HOP_DESTROY_NUMBERS = DESTROY_NUMBERS.filter(isTwoHop);

    /** The six items a client can want gone. */
    const DESTROY_ITEMS = [
      'prototype render',
      'site photo',
      'signed contract',
      'firmware image',
      'customer export',
      'key ring',
    ];

    it('is offered as destroying the item it names, an internal one on two hops', () => {
      for (const missionNumber of SINGLE_HOP_DESTROY_NUMBERS) {
        expect(missionTerms(missionNumber).kind).toBe(
          `destroy a ${missionFileItem(missionNumber).noun}`,
        );
      }
      for (const missionNumber of TWO_HOP_DESTROY_NUMBERS) {
        expect(missionTerms(missionNumber).kind).toBe(
          `destroy an internal ${missionFileItem(missionNumber).noun}`,
        );
      }
      expect(
        new Set(DESTROY_NUMBERS.map((missionNumber) => missionFileItem(missionNumber).noun)),
      ).toEqual(new Set(DESTROY_ITEMS));
    });

    it('sits behind a front box about a third of the time', () => {
      const share = TWO_HOP_DESTROY_NUMBERS.length / DESTROY_NUMBERS.length;

      expect(share).toBeGreaterThan(0.28);
      expect(share).toBeLessThan(0.39);
    });

    it('pays a key job: 500 to 2,000 JSC on one hop, 2,000 to 4,000 on two, in steps of 50', () => {
      const paysOf = (numbers: readonly number[]) =>
        numbers.map((missionNumber) => missionTerms(missionNumber).pay);
      const singleHop = paysOf(SINGLE_HOP_DESTROY_NUMBERS);
      const twoHop = paysOf(TWO_HOP_DESTROY_NUMBERS);

      for (const pay of [...singleHop, ...twoHop]) expect(pay % 50).toBe(0);
      expect([Math.min(...singleHop), Math.max(...singleHop)]).toEqual([500, 2000]);
      expect([Math.min(...twoHop), Math.max(...twoHop)]).toEqual([2000, 4000]);
    });

    it('names the target after its stem and a trade a key job is drawn from', () => {
      const keyJobTrades = new Set(
        KEY_NUMBERS.map((missionNumber) => missionTerms(missionNumber).targetCompany.split(' ')[1]),
      );

      for (const missionNumber of DESTROY_NUMBERS) {
        const { stem } = missionShape(missionNumber);
        const [company, trade, ...rest] = missionTerms(missionNumber).targetCompany.split(' ');
        expect(company).toBe(capitalised(stem));
        expect(keyJobTrades.has(trade ?? ''), `contract ${missionNumber}`).toBe(true);
        expect(rest).toEqual([]);
      }
    });

    it("draws every client, and pitches from its item's four reasons for wanting it gone", () => {
      expect(
        new Set(DESTROY_NUMBERS.map((missionNumber) => missionTerms(missionNumber).client.handle)),
      ).toEqual(new Set(CLIENT_HANDLES));
      for (const noun of DESTROY_ITEMS) {
        const jobs = DESTROY_NUMBERS.filter(
          (missionNumber) => missionFileItem(missionNumber).noun === noun,
        );
        const pitches = new Set(jobs.map((missionNumber) => missionTerms(missionNumber).pitch));

        expect(pitches, noun).toEqual(new Set(missionFileItem(jobs[0]!).destroyPitches));
      }
    });

    it('promises no key', () => {
      for (const missionNumber of DESTROY_NUMBERS) {
        expect('keyOpens' in missionTerms(missionNumber)).toBe(false);
      }
    });
  });

  describe('a wipe job', () => {
    const WIPE_NUMBERS = widerJobsOf('wipe');
    const SINGLE_HOP_WIPE_NUMBERS = WIPE_NUMBERS.filter(
      (missionNumber) => !isTwoHop(missionNumber),
    );
    const TWO_HOP_WIPE_NUMBERS = WIPE_NUMBERS.filter(isTwoHop);

    it("is offered as wiping its setting's records, internal ones on two hops", () => {
      for (const missionNumber of SINGLE_HOP_WIPE_NUMBERS) {
        const { noun } = SETTING_NAMES[missionSetting(missionNumber)];
        expect(missionTerms(missionNumber).kind).toBe(`wipe ${noun} records`);
      }
      for (const missionNumber of TWO_HOP_WIPE_NUMBERS) {
        const { noun } = SETTING_NAMES[missionSetting(missionNumber)];
        expect(missionTerms(missionNumber).kind).toBe(`wipe internal ${noun} records`);
      }
      expect(new Set(WIPE_NUMBERS.map(missionSetting))).toEqual(
        new Set(Object.keys(SETTING_NAMES)),
      );
    });

    it('sits behind a front box about a third of the time', () => {
      const share = TWO_HOP_WIPE_NUMBERS.length / WIPE_NUMBERS.length;

      expect(share).toBeGreaterThan(0.28);
      expect(share).toBeLessThan(0.39);
    });

    it('pays a tamper job: 1,000 to 2,500 JSC on one hop, 2,500 to 5,000 on two, in steps of 50', () => {
      // Wider again: a two-hop pay has fifty-one steps, and two-hop wipe jobs are a thirtieth of
      // the numbers.
      const wipeJobs = Array.from({ length: 15000 }, (_unused, index) => index * 1097 + 2).filter(
        (missionNumber) => isMissionNumber(missionNumber) && missionKind(missionNumber) === 'wipe',
      );
      const paysOf = (numbers: readonly number[]) =>
        numbers.map((missionNumber) => missionTerms(missionNumber).pay);
      const singleHop = paysOf(wipeJobs.filter((missionNumber) => !isTwoHop(missionNumber)));
      const twoHop = paysOf(wipeJobs.filter(isTwoHop));

      for (const pay of [...singleHop, ...twoHop]) expect(pay % 50).toBe(0);
      expect([Math.min(...singleHop), Math.max(...singleHop)]).toEqual([1000, 2500]);
      expect([Math.min(...twoHop), Math.max(...twoHop)]).toEqual([2500, 5000]);
    });

    it('names the target after the stem its boxes are named for and what its setting is', () => {
      for (const missionNumber of WIPE_NUMBERS) {
        const { stem } = missionShape(missionNumber);
        const { institution } = SETTING_NAMES[missionSetting(missionNumber)];
        expect(missionTerms(missionNumber).targetCompany).toBe(
          `${capitalised(stem)} ${institution}`,
        );
      }
    });

    // A reason to change one grade reads wrong on a job that wipes every grade, so each setting
    // brings three reasons of its own for wanting all of its records gone.
    it('draws every client, and pitches each setting from three reasons of its own', () => {
      const tamperPitches = new Set(
        widerJobsOf('tamper').map((missionNumber) => missionTerms(missionNumber).pitch),
      );
      const pitchesBy = new Map<string, Set<string>>();
      for (const missionNumber of WIPE_NUMBERS) {
        const setting = missionSetting(missionNumber);
        pitchesBy.set(
          setting,
          new Set([...(pitchesBy.get(setting) ?? []), missionTerms(missionNumber).pitch]),
        );
      }
      const every = [...pitchesBy.values()].flatMap((pitches) => [...pitches]);

      expect(
        new Set(WIPE_NUMBERS.map((missionNumber) => missionTerms(missionNumber).client.handle)),
      ).toEqual(new Set(CLIENT_HANDLES));
      expect([...pitchesBy.keys()].sort()).toEqual(Object.keys(SETTING_NAMES).sort());
      for (const [setting, pitches] of pitchesBy) expect(pitches.size, setting).toBe(3);
      expect(new Set(every).size).toBe(every.length);
      for (const pitch of every) {
        expect(pitch).toMatch(/^[A-Z].{20,}\.$/);
        expect(tamperPitches.has(pitch), pitch).toBe(false);
        expect(KEY_JOB_PITCHES.has(pitch), pitch).toBe(false);
      }
    });

    it('promises no key', () => {
      for (const missionNumber of WIPE_NUMBERS) {
        expect('keyOpens' in missionTerms(missionNumber)).toBe(false);
      }
    });
  });

  describe('a credential job', () => {
    const CREDENTIAL_NUMBERS = widerJobsOf('credential');
    const SINGLE_HOP_CREDENTIAL_NUMBERS = CREDENTIAL_NUMBERS.filter(
      (missionNumber) => !isTwoHop(missionNumber),
    );
    const TWO_HOP_CREDENTIAL_NUMBERS = CREDENTIAL_NUMBERS.filter(isTwoHop);

    /** The machine a credential job wants the root login of, read off the board's line. */
    const machineOf = (missionNumber: number): string =>
      missionTerms(missionNumber).kind.replace(/^steal the root login for (a|an internal) /, '');

    it('is offered as stealing the root login for one of the seven machines, an internal one on two hops', () => {
      for (const missionNumber of SINGLE_HOP_CREDENTIAL_NUMBERS) {
        expect(missionTerms(missionNumber).kind).toBe(
          `steal the root login for a ${machineOf(missionNumber)}`,
        );
      }
      for (const missionNumber of TWO_HOP_CREDENTIAL_NUMBERS) {
        expect(missionTerms(missionNumber).kind).toBe(
          `steal the root login for an internal ${machineOf(missionNumber)}`,
        );
      }
      expect(new Set(CREDENTIAL_NUMBERS.map(machineOf))).toEqual(new Set(SABOTAGE_MACHINES));
    });

    it('asks for each machine about a seventh of the time', () => {
      for (const machine of SABOTAGE_MACHINES) {
        const share =
          CREDENTIAL_NUMBERS.filter((missionNumber) => machineOf(missionNumber) === machine)
            .length / CREDENTIAL_NUMBERS.length;
        expect(share, machine).toBeGreaterThan(0.1);
        expect(share, machine).toBeLessThan(0.19);
      }
    });

    it('sits behind a front box about a third of the time', () => {
      const share = TWO_HOP_CREDENTIAL_NUMBERS.length / CREDENTIAL_NUMBERS.length;

      expect(share).toBeGreaterThan(0.28);
      expect(share).toBeLessThan(0.39);
    });

    it('pays a key job: 500 to 2,000 JSC on one hop, 2,000 to 4,000 on two, in steps of 50', () => {
      const paysOf = (numbers: readonly number[]) =>
        numbers.map((missionNumber) => missionTerms(missionNumber).pay);
      const singleHop = paysOf(SINGLE_HOP_CREDENTIAL_NUMBERS);
      const twoHop = paysOf(TWO_HOP_CREDENTIAL_NUMBERS);

      for (const pay of [...singleHop, ...twoHop]) expect(pay % 50).toBe(0);
      expect([Math.min(...singleHop), Math.max(...singleHop)]).toEqual([500, 2000]);
      expect([Math.min(...twoHop), Math.max(...twoHop)]).toEqual([2000, 4000]);
    });

    it('names the target after its stem and a trade a key job is drawn from', () => {
      const keyJobTrades = new Set(
        KEY_NUMBERS.map((missionNumber) => missionTerms(missionNumber).targetCompany.split(' ')[1]),
      );

      for (const missionNumber of CREDENTIAL_NUMBERS) {
        const { stem } = missionShape(missionNumber);
        const [company, trade, ...rest] = missionTerms(missionNumber).targetCompany.split(' ');
        expect(company).toBe(capitalised(stem));
        expect(keyJobTrades.has(trade ?? ''), `contract ${missionNumber}`).toBe(true);
        expect(rest).toEqual([]);
      }
    });

    it("draws every client, and pitches from three reasons of its machine's own", () => {
      const otherPitches = new Set(
        [
          ...KEY_NUMBERS,
          ...TAMPER_NUMBERS,
          ...SABOTAGE_NUMBERS,
          ...FILE_NUMBERS,
          ...BACKDOOR_NUMBERS,
          ...INFILTRATE_NUMBERS,
          ...PORTFORWARD_NUMBERS,
        ].map((missionNumber) => missionTerms(missionNumber).pitch),
      );
      const seen = new Set<string>();

      expect(
        new Set(CREDENTIAL_NUMBERS.map((missionNumber) => missionTerms(missionNumber).client.handle)),
      ).toEqual(new Set(CLIENT_HANDLES));
      for (const machine of SABOTAGE_MACHINES) {
        const pitches = new Set(
          CREDENTIAL_NUMBERS.filter((missionNumber) => machineOf(missionNumber) === machine).map(
            (missionNumber) => missionTerms(missionNumber).pitch,
          ),
        );
        expect(pitches.size, machine).toBe(3);
        for (const pitch of pitches) {
          expect(pitch).toMatch(/^[A-Z].{20,}\.$/);
          expect(otherPitches.has(pitch), pitch).toBe(false);
          expect(seen.has(pitch), pitch).toBe(false);
          seen.add(pitch);
        }
      }
    });

    it('promises no key', () => {
      for (const missionNumber of CREDENTIAL_NUMBERS) {
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
  describe('a portforward job', () => {
    /** The machine a portforward job is offered as opening a way into, read off the board's line. */
    const machineOf = (missionNumber: number): string =>
      missionTerms(missionNumber).kind.replace(/^open a way into a /, '');

    it('is offered as opening a way into one of four machines', () => {
      for (const missionNumber of PORTFORWARD_NUMBERS) {
        expect(missionTerms(missionNumber).kind, `contract ${missionNumber}`).toBe(
          `open a way into a ${portforwardJob(missionNumber).machine.noun}`,
        );
      }
      expect(new Set(PORTFORWARD_NUMBERS.map(machineOf))).toEqual(
        new Set(['customer database', 'cache server', 'staff intranet', 'development server']),
      );
    });

    // The router is the one box broken into, and the target is right behind it: a single-hop
    // key job's work.
    it('pays a single-hop key job: 500 to 2,000 JSC, in steps of 50', () => {
      const pays = PORTFORWARD_NUMBERS.map((missionNumber) => missionTerms(missionNumber).pay);

      for (const pay of pays) expect(pay % 50).toBe(0);
      expect([Math.min(...pays), Math.max(...pays)]).toEqual([500, 2000]);
    });

    it('names the target after its stem and a trade a key job is drawn from', () => {
      const keyJobTrades = new Set(
        KEY_NUMBERS.map((missionNumber) => missionTerms(missionNumber).targetCompany.split(' ')[1]),
      );

      for (const missionNumber of PORTFORWARD_NUMBERS) {
        const { stem } = missionShape(missionNumber);
        const [company, trade, ...rest] = missionTerms(missionNumber).targetCompany.split(' ');
        expect(company).toBe(capitalised(stem));
        expect(keyJobTrades.has(trade ?? ''), `contract ${missionNumber}`).toBe(true);
        expect(rest).toEqual([]);
      }
    });

    it("draws every client, and pitches from its machine's own three reasons", () => {
      const terms = PORTFORWARD_NUMBERS.map(missionTerms);

      expect(new Set(terms.map(({ client }) => client.handle))).toEqual(new Set(CLIENT_HANDLES));
      for (const missionNumber of PORTFORWARD_NUMBERS) {
        expect(portforwardJob(missionNumber).machine.pitches).toContain(
          missionTerms(missionNumber).pitch,
        );
      }
      expect(new Set(terms.map(({ pitch }) => pitch)).size).toBe(12);
    });
  });
});
