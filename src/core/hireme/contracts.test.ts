import { describe, expect, it } from 'vitest';
import {
  answerAccept,
  answerContractBoard,
  answerDrop,
  type BoardStore,
  type ContractMail,
  type OfferCandidate,
} from './contracts.js';
import { missionTerms, type MissionTerms } from '../missions/missionTerms.js';
import { missionAddressForNumber, missionEssid } from '../missions/missionNetwork.js';
import { lanSubnetPrefix } from '../network/lanAddress.js';
import {
  DEPLOYMENT_POOLS,
  DEPLOYMENT_SECRETS,
  plaintextFor,
  WHITE_HAT_PASSWORDS,
} from '../../test/passwords.js';
import { missionKeyPath } from '../missions/missionSecret.js';
import {
  missionFileItem,
  missionFileName,
  missionFilePath,
  missionPlantContent,
} from '../missions/missionFileItem.js';
import {
  chainFinal,
  missionKind,
  missionShape,
  patchHole,
  type ChainFinal,
} from '../missions/missionShape.js';
import { backdoorJob, chainJob, cleanupJob, lockoutJob, patchJob } from '../missions/targetRoles.js';
import { portforwardJob } from '../missions/portforwardJob.js';
import { closeDoorJob } from '../missions/closeDoorJob.js';
import {
  RECORD_SETTINGS,
  missionAction,
  missionRecords,
  missionSetting,
  type RecordAction,
  type RecordSetting,
  type RecordTarget,
} from '../missions/missionRecords.js';
import { isMissionNumber } from '../missions/missionNetwork.js';
import { DATADIR_PATH } from '../mysql/datadir.js';
import { writeAmount } from '../wallet/amount.js';
import { FRONT_BOX_SUFFIX, GATEWAY_SUFFIX, KEY_BOX_SUFFIX } from '../missions/pools.js';

/**
 * A board's three doors: reading it (which tops its offers up), accepting an offer, and
 * dropping the current contract. What the store answers is faked by a small in-memory board;
 * what it is asked, and the page the reader gets back, are the behaviour.
 */

const HANDLE = 'neo';
const BOARD_ADDRESS = '194.12.34.56';

/** Contract numbers with a host last octet, each a different client and target. The first
 *  two are two-hop contracts, the last two single-hop. */
const FIRST = 100001;
const SECOND = 100022;
const THIRD = 70006;
const FOURTH = 70011;

/** The first tamper contract from 70,000 up drawing `setting` and `action`, on one hop or
 *  on two. */
const tamperNumber = (setting: RecordSetting, action: RecordAction, twoHop: boolean): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (
      shape.kind === 'tamper' &&
      missionSetting(candidate) === setting &&
      missionAction(candidate) === action &&
      (shape.frontBox !== null) === twoHop
    ) {
      return candidate;
    }
  }
  throw new Error(`no ${setting} ${action} contract`);
};

/** The machine a sabotage contract asks taken down, read off the board's line. */
const machineOf = (missionNumber: number): string =>
  missionTerms(missionNumber).kind.replace(/^take down (a|an internal) /, '');

/** The first sabotage contract from 70,000 up asking for `machine` down, on one hop or on two. */
const sabotageNumber = (twoHop: boolean, machine = 'CCTV recorder'): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind !== 'sabotage' || (shape.frontBox !== null) !== twoHop) continue;
    if (machineOf(candidate) === machine) return candidate;
  }
  throw new Error(`no sabotage contract on a ${machine}`);
};

const SABOTAGE_SINGLE_HOP = sabotageNumber(false);
const SABOTAGE_TWO_HOP = sabotageNumber(true);

/** The first file contract from 70,000 up, on one hop or on two. */
const fileNumber = (twoHop: boolean): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'file' && (shape.frontBox !== null) === twoHop) return candidate;
  }
  throw new Error('no file contract');
};

const FILE_SINGLE_HOP = fileNumber(false);
const FILE_TWO_HOP = fileNumber(true);

/** The first infiltrate contract from 70,000 up, on one hop or on two. */
const infiltrateNumber = (twoHop: boolean): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'infiltrate' && (shape.frontBox !== null) === twoHop) return candidate;
  }
  throw new Error('no infiltrate contract');
};

const INFILTRATE_SINGLE_HOP = infiltrateNumber(false);
const INFILTRATE_TWO_HOP = infiltrateNumber(true);

/** The deployment's mission secret, which the client's file on an infiltrate job is drawn from. */
const MISSION_SECRET = 'test-mission-secret';

/** The first cleanup contract from 70,000 up, on one hop or on two. */
const cleanupNumber = (twoHop: boolean): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate) || missionKind(candidate) !== 'cleanup') continue;
    if ((missionShape(candidate).frontBox !== null) === twoHop) return candidate;
  }
  throw new Error('no cleanup contract');
};

const CLEANUP_SINGLE_HOP = cleanupNumber(false);
const CLEANUP_TWO_HOP = cleanupNumber(true);

/** The first lock-them-out contract from 70,000 up, on one hop or on two. */
const lockoutNumber = (twoHop: boolean): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate) || missionKind(candidate) !== 'lockout') continue;
    if ((missionShape(candidate).frontBox !== null) === twoHop) return candidate;
  }
  throw new Error('no lock-them-out contract');
};

const LOCKOUT_SINGLE_HOP = lockoutNumber(false);
const LOCKOUT_TWO_HOP = lockoutNumber(true);

/** The first patch-it contract from 70,000 up, on one hop or on two. */
const patchNumber = (twoHop: boolean): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate) || missionKind(candidate) !== 'patch') continue;
    if ((missionShape(candidate).frontBox !== null) === twoHop) return candidate;
  }
  throw new Error('no patch-it contract');
};

const PATCH_SINGLE_HOP = patchNumber(false);
const PATCH_TWO_HOP = patchNumber(true);

/** The machine a backdoor contract wants a way into, read off the board's line. */
const backdoorMachineOf = (missionNumber: number): string =>
  missionTerms(missionNumber).kind.replace(/^plant a backdoor on (a|an internal) /, '');

/** The first backdoor contract from 70,000 up on `machine`, on one hop or on two. */
const backdoorNumber = (twoHop: boolean, machine = 'build server'): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind !== 'backdoor' || (shape.frontBox !== null) !== twoHop) continue;
    if (backdoorMachineOf(candidate) === machine) return candidate;
  }
  throw new Error(`no backdoor contract on a ${machine}`);
};

const BACKDOOR_SINGLE_HOP = backdoorNumber(false);
const BACKDOOR_TWO_HOP = backdoorNumber(true);

/** The machine a credential contract wants the root login of, read off the board's line. */
const credentialMachineOf = (missionNumber: number): string =>
  missionTerms(missionNumber).kind.replace(/^steal the root login for (a|an internal) /, '');

/** The first credential contract from 70,000 up on `machine`, on one hop or on two. */
const credentialNumber = (twoHop: boolean, machine = 'backup server'): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind !== 'credential' || (shape.frontBox !== null) !== twoHop) continue;
    if (credentialMachineOf(candidate) === machine) return candidate;
  }
  throw new Error(`no credential contract on a ${machine}`);
};

const CREDENTIAL_SINGLE_HOP = credentialNumber(false);
const CREDENTIAL_TWO_HOP = credentialNumber(true);

/** The first destroy contract from 70,000 up wanting the item called `noun` gone, on one hop or
 *  on two. */
const destroyNumber = (twoHop: boolean, noun = 'signed contract'): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (shape.kind !== 'destroy' || (shape.frontBox !== null) !== twoHop) continue;
    if (missionFileItem(candidate).noun === noun) return candidate;
  }
  throw new Error(`no destroy contract for a ${noun}`);
};

const DESTROY_SINGLE_HOP = destroyNumber(false);
const DESTROY_TWO_HOP = destroyNumber(true);

/** The first portforward contract from 70,000 up on the machine called `noun`. */
const portforwardNumber = (noun: string): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate)) continue;
    if (missionShape(candidate).kind !== 'portforward') continue;
    if (portforwardJob(candidate).machine.noun === noun) return candidate;
  }
  throw new Error(`no portforward contract on a ${noun}`);
};

/** The first close-the-door contract from 70,000 up on the machine called `noun`. */
const closeDoorNumber = (noun: string): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate)) continue;
    if (missionShape(candidate).kind !== 'closedoor') continue;
    if (closeDoorJob(candidate).machine.noun === noun) return candidate;
  }
  throw new Error(`no close-the-door contract on a ${noun}`);
};

/** The first single-hop file contract from 70,000 up asking for the item called `noun`. */
const fileNumberFor = (noun: string): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate) || missionFileItem(candidate).noun !== noun) continue;
    const shape = missionShape(candidate);
    if (shape.kind === 'file' && shape.frontBox === null) return candidate;
  }
  throw new Error(`no file contract for a ${noun}`);
};

/** The first single-hop infiltrate contract from 70,000 up slipping in the item called `noun`. */
const infiltrateNumberFor = (noun: string): number => {
  for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
    if (!isMissionNumber(candidate) || missionShape(candidate).kind !== 'infiltrate') continue;
    if (missionFileItem(candidate).noun === noun && missionShape(candidate).frontBox === null) {
      return candidate;
    }
  }
  throw new Error(`no infiltrate contract for a ${noun}`);
};

/** The briefing's line asking for the job's item. */
const askedLine = (missionNumber: number): string => {
  const { keepers, noun } = missionFileItem(missionNumber);
  return `Their ${keepers} keep a ${noun}. Bring it to us. Its name is:`;
};

/** School contracts asking for a grade changed rather than a key: a single-hop one and a
 *  two-hop one. */
const TAMPER_SINGLE_HOP = tamperNumber('school', 'change', false);
const TAMPER_TWO_HOP = tamperNumber('school', 'change', true);

/** School contracts asking for a grade gone: a single-hop one and a two-hop one. */
const ERASE_SINGLE_HOP = tamperNumber('school', 'erase', false);
const ERASE_TWO_HOP = tamperNumber('school', 'erase', true);

/** A grade as said aloud: "an A", "a B". */
const aGrade = (grade: string): string => `${grade === 'A' || grade === 'F' ? 'an' : 'a'} ${grade}`;

/** The sentence a briefing names its target with: who, which field and old to new, or that the
 *  record should not exist. */
const askedSentence = (setting: RecordSetting, target: RecordTarget): string => {
  const at = (column: string): string => `${target.row[column]}`;
  if (target.action === 'erase') {
    return {
      school: `There is a failing ${at('subject')} grade for ${at('student')}. It should not exist.`,
      police: `Their records hold an active warrant for ${at('name')}, for ${at('offence')}. It should not exist.`,
      payroll: '',
      dmv: `Their records hold a ${at('offence')} offence against ${at('name')}. It should not exist.`,
      tournament: `Their league has ${at('player')} on ${at('score')} in ${at('game')}. That score should not exist.`,
      admissions: `Their records have ${at('name')} applying for ${at('program')}. That application should not exist.`,
      club: `The club has ${at('name')} banned. That ban should not exist.`,
      registry: `Their registry flags ${at('plate')} as stolen. That record should not exist.`,
    }[setting];
  }
  const { from, to } = target;
  return {
    school: `Their records give ${at('student')} ${aGrade(from)} in ${at('subject')}. It should be ${aGrade(to)}.`,
    police: `Their records hold an active warrant for ${at('name')}, for ${at('offence')}. It should read ${to}.`,
    payroll: `They pay ${at('name')} ${from} a year. It should be ${to}.`,
    dmv: `Their records give ${at('name')} ${from} points for ${at('offence')}. It should be ${to}.`,
    tournament: `Their league has ${at('player')} on ${from} in ${at('game')}. It should read ${to}.`,
    admissions: `Their records have ${at('name')} rejected for ${at('program')}. It should read ${to}.`,
    club: `The club has ${at('name')} down as ${from}. It should say ${to}.`,
    registry: `Their registry has ${at('plate')} registered to ${from}. It should be registered to ${to}.`,
  }[setting];
};

/** Every setting with every action it asks, on one hop. */
const SETTING_JOBS: readonly (readonly [RecordSetting, RecordAction])[] = RECORD_SETTINGS.flatMap(
  (setting): (readonly [RecordSetting, RecordAction])[] =>
    setting === 'payroll'
      ? [[setting, 'change']]
      : [
          [setting, 'change'],
          [setting, 'erase'],
        ],
);

/** The row a change job asks changed, failing the test on an erase job. */
const changeTargetOf = (missionNumber: number) => {
  const { target } = missionRecords(missionNumber);
  if (target.action !== 'change') throw new Error(`contract ${missionNumber} is not a change`);
  return target;
};

/** The row an erase job asks gone, failing the test on a change job. */
const eraseTargetOf = (missionNumber: number) => {
  const { target } = missionRecords(missionNumber);
  if (target.action !== 'erase') throw new Error(`contract ${missionNumber} is not an erase`);
  return target;
};

/** A key job's terms, failing the test on anything else. */
const keyTermsOf = (missionNumber: number): Extract<MissionTerms, { readonly job: 'key' }> => {
  const terms = missionTerms(missionNumber);
  if (terms.job !== 'key') throw new Error(`contract ${missionNumber} is not a key job`);
  return terms;
};

type Slot = OfferCandidate;
type StoreReply = { readonly data: unknown; readonly error: unknown };

/** A board held in memory, answering as the store does: posting candidates until offers and
 *  the current job fill three slots, and taking accepts and drops with the word it is told. */
const boardStore = ({
  offers = [],
  current = null,
  acceptWord = 'accepted',
  dropWord = 'dropped',
  landing = Number.POSITIVE_INFINITY,
}: {
  readonly offers?: readonly Slot[];
  readonly current?: number | null;
  readonly acceptWord?: unknown;
  readonly dropWord?: unknown;
  /** How many candidates land before the rest collide. */
  readonly landing?: number;
} = {}) => {
  let held: { offers: readonly Slot[]; current: number | null } = { offers, current };
  let landed = 0;
  const posts: (readonly OfferCandidate[])[] = [];
  const accepts: { number: number; briefing: ContractMail }[] = [];
  const drops: { number: number; line: ContractMail }[] = [];
  const reply = (data: unknown): StoreReply => ({ data, error: null });
  const slotsFree = () => 3 - held.offers.length - (held.current === null ? 0 : 1);

  const store: BoardStore = {
    postOffers: async ({ handle, candidates }) => {
      expect(handle).toBe(HANDLE);
      posts.push(candidates);
      for (const candidate of candidates) {
        if (slotsFree() === 0 || landed >= landing) break;
        landed += 1;
        held = { ...held, offers: [...held.offers, candidate] };
      }
      return reply({ offers: held.offers, current: held.current });
    },
    accept: async ({ handle, number, briefing }) => {
      expect(handle).toBe(HANDLE);
      accepts.push({ number, briefing });
      if (acceptWord === 'accepted') {
        held = { offers: held.offers.filter((offer) => offer.number !== number), current: number };
      }
      return reply(acceptWord);
    },
    drop: async ({ handle, number, line }) => {
      expect(handle).toBe(HANDLE);
      drops.push({ number, line });
      if (dropWord === 'dropped') held = { ...held, current: null };
      return reply(dropWord);
    },
  };
  return { store, posts, accepts, drops };
};

/** Fresh numbers and refs, in order, as the server's randomness would draw them. */
const drawsFrom = (numbers: readonly number[]) => {
  let drawn = 0;
  return {
    drawNumber: () => numbers[drawn++ % numbers.length]!,
    drawRef: () => `ref${drawn}`,
  };
};

const failing: BoardStore = {
  postOffers: async () => ({ data: null, error: new Error('down') }),
  accept: async () => ({ data: null, error: new Error('down') }),
  drop: async () => ({ data: null, error: new Error('down') }),
};

const textOf = (page: string | null): string =>
  new DOMParser().parseFromString(page ?? '', 'text/html').body.textContent ?? '';

const alertOf = (page: string | null): string | null =>
  new DOMParser().parseFromString(page ?? '', 'text/html').querySelector('[role="alert"]')
    ?.textContent ?? null;

/** The form the alert is said under, as its action and the offer it posts, or 'top' when
 *  the alert stands above the board. */
const answeredForm = (page: string | null): string => {
  const shown = new DOMParser().parseFromString(page ?? '', 'text/html');
  const form = shown.querySelector('[role="alert"]')?.previousElementSibling;
  if (form?.tagName !== 'FORM') return 'top';
  const offer = form.querySelector('input[name="offer"]')?.getAttribute('value');
  return offer === null || offer === undefined
    ? (form.getAttribute('action') ?? '')
    : `${form.getAttribute('action')} ${offer}`;
};

/** A store that reads the board once and is down from then on. */
const downAfterFirstRead = (store: BoardStore): BoardStore => {
  let reads = 0;
  return {
    ...store,
    postOffers: async (asked) => {
      reads += 1;
      return reads === 1 ? store.postOffers(asked) : { data: null, error: new Error('down') };
    },
  };
};

const board = (store: BoardStore, draws = drawsFrom([FIRST, SECOND, THIRD])) =>
  answerContractBoard({ handle: HANDLE, address: BOARD_ADDRESS, store, ...draws });

const accept = (form: string, store: BoardStore, draws = drawsFrom([FOURTH])) =>
  answerAccept({
    handle: HANDLE,
    address: BOARD_ADDRESS,
    form,
    store,
    missionSecret: MISSION_SECRET,
    rawSecrets: DEPLOYMENT_SECRETS,
    ...draws,
  });

/** Accepting on a deployment that has no mission secret. */
const acceptWithoutSecret = (form: string, store: BoardStore) =>
  answerAccept({
    handle: HANDLE,
    address: BOARD_ADDRESS,
    form,
    store,
    missionSecret: undefined,
    rawSecrets: DEPLOYMENT_SECRETS,
    ...drawsFrom([FOURTH]),
  });

/** Accepting on a deployment that holds no password pools. */
const acceptWithoutPools = (form: string, store: BoardStore) =>
  answerAccept({
    handle: HANDLE,
    address: BOARD_ADDRESS,
    form,
    store,
    missionSecret: MISSION_SECRET,
    rawSecrets: undefined,
    ...drawsFrom([FOURTH]),
  });

/** Dropping as the board's own confirmation does: the form says yes. */
const drop = (store: BoardStore, form = 'confirm=yes') =>
  answerDrop({ handle: HANDLE, address: BOARD_ADDRESS, form, store, ...drawsFrom([FOURTH]) });

describe('reading a board', () => {
  it('posts three drawn offers to an empty board and shows them', async () => {
    const { store, posts } = boardStore();

    const text = textOf(await board(store));

    expect(posts[0]).toEqual([
      { number: FIRST, ref: 'ref1' },
      { number: SECOND, ref: 'ref2' },
      { number: THIRD, ref: 'ref3' },
    ]);
    for (const missionNumber of [FIRST, SECOND, THIRD]) {
      const terms = missionTerms(missionNumber);
      expect(text).toContain(`${terms.client.company} — ${terms.kind}`);
    }
    expect(text).toContain('Ref: ref2');
  });

  it('shows the offers a board already holds', async () => {
    const { store } = boardStore({
      offers: [
        { number: FIRST, ref: 'aaa' },
        { number: SECOND, ref: 'bbb' },
        { number: THIRD, ref: 'ccc' },
      ],
    });

    const text = textOf(await board(store));

    expect(text).toContain('Ref: aaa');
    expect(text).toContain('Ref: ccc');
  });

  it('offers a tamper job by what it alters or erases, on one hop and on two', async () => {
    const { store } = boardStore({
      offers: [
        { number: TAMPER_SINGLE_HOP, ref: 'ttt' },
        { number: TAMPER_TWO_HOP, ref: 'uuu' },
        { number: ERASE_SINGLE_HOP, ref: 'vvv' },
        { number: ERASE_TWO_HOP, ref: 'www' },
      ],
    });

    const text = textOf(await board(store));

    for (const [missionNumber, line] of [
      [TAMPER_SINGLE_HOP, 'alter a school record'],
      [TAMPER_TWO_HOP, 'alter an internal school record'],
      [ERASE_SINGLE_HOP, 'erase a school record'],
      [ERASE_TWO_HOP, 'erase an internal school record'],
    ] as const) {
      const { client, pay } = missionTerms(missionNumber);
      expect(text).toContain(`${client.company} — ${line} — ${writeAmount(pay)}`);
    }
  });

  it('draws again while numbers or refs collide, and stops once the board is full', async () => {
    const { store, posts } = boardStore({ landing: 1 });
    const first = boardStore();

    await board(store);
    await board(first.store);

    // Only one candidate ever lands, so every allowed draw is spent.
    expect(posts).toHaveLength(5);
    expect(first.posts).toHaveLength(1);
  });

  it('counts the current contract as one of the three slots', async () => {
    const holding = boardStore({
      offers: [
        { number: FIRST, ref: 'aaa' },
        { number: SECOND, ref: 'bbb' },
      ],
      current: FOURTH,
    });
    const short = boardStore({ landing: 2 });

    await board(holding.store);
    await board(short.store);

    // Two offers and a job fill the board; two offers alone leave it a slot short.
    expect(holding.posts).toHaveLength(1);
    expect(short.posts).toHaveLength(5);
  });

  it('shows the board with what landed when every draw collided', async () => {
    const { store } = boardStore({ landing: 1 });

    const text = textOf(await board(store));

    expect(text).toContain('Ref: ref1');
    expect(text).not.toContain('Ref: ref2');
  });

  it('shows the current contract with who it is against', async () => {
    const { store } = boardStore({ current: FOURTH });

    const text = textOf(await board(store));

    expect(text).toContain('Current contract');
    expect(text).toContain(missionTerms(FOURTH).targetCompany);
  });

  it('never shows a mission address, held or offered', async () => {
    const { store } = boardStore({ current: FOURTH });

    expect(await board(store)).not.toMatch(/195\.\d/);
  });

  it.each([
    ['the store failed', failing],
    [
      'the store answered with something it was never taught',
      { ...boardStore().store, postOffers: async () => ({ data: { offers: 'x' }, error: null }) },
    ],
  ])('answers nothing when %s', async (_why, store) => {
    expect(await board(store)).toBeNull();
  });
});

describe('accepting an offer', () => {
  const offered = () =>
    boardStore({
      offers: [
        { number: FIRST, ref: 'aaa' },
        { number: SECOND, ref: 'bbb' },
        { number: THIRD, ref: 'ccc' },
      ],
    });

  it('accepts the offer the ref names and says the client has sent a briefing', async () => {
    const { store, accepts } = offered();

    const page = await accept('offer=bbb', store);

    expect(accepts.map((asked) => asked.number)).toEqual([SECOND]);
    expect(alertOf(page)).toBe(
      `Contract accepted. ${missionTerms(SECOND).client.company} has sent you a briefing.`,
    );
    expect(textOf(page)).toContain('Current contract');
    expect(answeredForm(page)).toBe('/drop');
  });

  it('mails a briefing from the client, naming the target, the address and the rules', async () => {
    const { store, accepts } = offered();
    const terms = keyTermsOf(SECOND);

    await accept('offer=bbb', store);
    const briefing = accepts[0]!.briefing;

    expect(briefing.sender).toBe(`${terms.client.handle}@emailit.io`);
    expect(briefing.subject).toBe(`Contract: ${terms.targetCompany}`);
    expect(briefing.body).toContain(terms.targetCompany);
    expect(briefing.body).toContain(missionAddressForNumber(SECOND));
    expect(briefing.body).toContain(terms.keyOpens);
    expect(briefing.body).toContain('ACCESS-XXXX-XXXX-XXXX');
    expect(briefing.body).toContain('No key, no money. No wallet, no money.');
    expect(briefing.body).toContain(`-- ${terms.client.company}`);
  });

  it('writes a single-hop briefing as the client would, line by line', async () => {
    const { store, accepts } = offered();
    const terms = keyTermsOf(THIRD);

    await accept('offer=ccc', store);

    expect(accepts[0]!.briefing.body).toBe(
      [
        terms.pitch,
        '',
        `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(THIRD)}.`,
        '',
        `Somewhere on it is the key to ${terms.keyOpens}. It looks like this:`,
        '',
        '  ACCESS-XXXX-XXXX-XXXX',
        '',
        'Reply to this address with the key and your wallet address.',
        'No key, no money. No wallet, no money.',
        '',
        `-- ${terms.client.company}`,
        '',
      ].join('\n'),
    );
  });

  // Working out what "inside" means is the job, so the briefing says only that much.
  it('tells a two-hop contractor the key is inside the network, not on the edge', async () => {
    const { store, accepts } = offered();
    const terms = keyTermsOf(SECOND);

    await accept('offer=bbb', store);

    expect(accepts[0]!.briefing.body).toBe(
      [
        terms.pitch,
        '',
        `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(SECOND)}.`,
        '',
        `Somewhere on it is the key to ${terms.keyOpens}. It looks like this:`,
        '',
        '  ACCESS-XXXX-XXXX-XXXX',
        '',
        'The key is on a machine inside their network, not on the edge.',
        '',
        'Reply to this address with the key and your wallet address.',
        'No key, no money. No wallet, no money.',
        '',
        `-- ${terms.client.company}`,
        '',
      ].join('\n'),
    );
  });

  it.each([
    ['single-hop', 'ccc', THIRD],
    ['two-hop', 'bbb', SECOND],
  ])(
    'never says in a %s briefing where the key sits or how to get in',
    async (_template, ref, missionNumber) => {
      const { store, accepts } = offered();

      await accept(`offer=${ref}`, store);
      const { body } = accepts[0]!.briefing;

      expect(body).not.toContain(missionKeyPath(missionNumber));
      expect(body).not.toMatch(/hydra|msfconsole|exploit|password/i);
    },
  );

  describe('on a sabotage job', () => {
    const offeredSabotage = () =>
      boardStore({
        offers: [
          { number: SABOTAGE_SINGLE_HOP, ref: 'sss' },
          { number: SABOTAGE_TWO_HOP, ref: 'rrr' },
        ],
      });

    it('writes a single-hop briefing asking for the machine taken offline, and nothing more', async () => {
      const { store, accepts } = offeredSabotage();
      const terms = missionTerms(SABOTAGE_SINGLE_HOP);

      await accept('offer=sss', store);

      expect(accepts[0]!.briefing.subject).toBe(`Contract: ${terms.targetCompany}`);
      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(SABOTAGE_SINGLE_HOP)}.`,
          '',
          'Take their CCTV recorder offline.',
          '',
          'Mail this address when it is done, with your wallet address.',
          'No outage, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it('tells a two-hop contractor the machine is inside the network, not on the edge', async () => {
      const { store, accepts } = offeredSabotage();
      const terms = missionTerms(SABOTAGE_TWO_HOP);

      await accept('offer=rrr', store);

      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(SABOTAGE_TWO_HOP)}.`,
          '',
          'Take their CCTV recorder offline.',
          '',
          'It is a machine inside their network, not on the edge.',
          '',
          'Mail this address when it is done, with your wallet address.',
          'No outage, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it('names no box, no address but the network and no path', async () => {
      for (const [missionNumber, ref] of [
        [SABOTAGE_SINGLE_HOP, 'sss'],
        [SABOTAGE_TWO_HOP, 'rrr'],
      ] as const) {
        const { store, accepts } = offeredSabotage();
        const { stem } = missionShape(missionNumber);

        await accept(`offer=${ref}`, store);
        const { body } = accepts[0]!.briefing;

        expect(body).not.toContain(`${stem}-`);
        expect(body).not.toMatch(/\/boot|vmlinuz|initrd|\bkey\b/i);
        expect(body.match(/\d+\.\d+\.\d+\.\d+/g)).toEqual([missionAddressForNumber(missionNumber)]);
      }
    });

    it.each([
      'CCTV recorder',
      'backup server',
      'monitoring station',
      'build server',
      'licence server',
      'door-access controller',
      'billing server',
    ])('asks for a %s taken offline, in so many words', async (machine) => {
      const missionNumber = sabotageNumber(false, machine);
      const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'mmm' }] });

      await accept('offer=mmm', store);

      expect(accepts[0]!.briefing.body.split('\n')).toContain(`Take their ${machine} offline.`);
    });
  });

  describe('on a backdoor job', () => {
    const offeredBackdoor = () =>
      boardStore({
        offers: [
          { number: BACKDOOR_SINGLE_HOP, ref: 'bbb' },
          { number: BACKDOOR_TWO_HOP, ref: 'ccc' },
        ],
      });

    it('writes a single-hop briefing asking for a listener on the port named, and nothing more', async () => {
      const { store, accepts } = offeredBackdoor();
      const terms = missionTerms(BACKDOOR_SINGLE_HOP);
      const { port } = backdoorJob(BACKDOOR_SINGLE_HOP);

      await accept('offer=bbb', store);

      expect(accepts[0]!.briefing.subject).toBe(`Contract: ${terms.targetCompany}`);
      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(BACKDOOR_SINGLE_HOP)}.`,
          '',
          'We want a way into their build server that stays open.',
          `Leave a listener on it, on port ${port}.`,
          '',
          'Write to this address with your wallet address while it is listening.',
          'No listener, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it('tells a two-hop contractor the machine is inside the network, not on the edge', async () => {
      const { store, accepts } = offeredBackdoor();
      const terms = missionTerms(BACKDOOR_TWO_HOP);
      const { port } = backdoorJob(BACKDOOR_TWO_HOP);

      await accept('offer=ccc', store);

      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(BACKDOOR_TWO_HOP)}.`,
          '',
          'We want a way into their build server that stays open.',
          `Leave a listener on it, on port ${port}.`,
          '',
          'It is a machine inside their network, not on the edge.',
          '',
          'Write to this address with your wallet address while it is listening.',
          'No listener, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it('names no box, no address but the network, no path and no tool', async () => {
      for (const [missionNumber, ref] of [
        [BACKDOOR_SINGLE_HOP, 'bbb'],
        [BACKDOOR_TWO_HOP, 'ccc'],
      ] as const) {
        const { store, accepts } = offeredBackdoor();
        const { stem } = missionShape(missionNumber);

        await accept(`offer=${ref}`, store);
        const { body } = accepts[0]!.briefing;

        expect(body).not.toContain(`${stem}-`);
        expect(body).not.toMatch(/\/var|\bnc\b|netcat|pidfile|\bkey\b/i);
        expect(body.match(/\d+\.\d+\.\d+\.\d+/g)).toEqual([missionAddressForNumber(missionNumber)]);
      }
    });

    it.each([
      'CCTV recorder',
      'backup server',
      'monitoring station',
      'build server',
      'licence server',
      'door-access controller',
      'billing server',
    ])('asks for a way into a %s, in so many words', async (machine) => {
      const missionNumber = backdoorNumber(false, machine);
      const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'mmm' }] });

      await accept('offer=mmm', store);

      expect(accepts[0]!.briefing.body.split('\n')).toContain(
        `We want a way into their ${machine} that stays open.`,
      );
    });
  });

  describe('on a credential job', () => {
    const offeredCredential = () =>
      boardStore({
        offers: [
          { number: CREDENTIAL_SINGLE_HOP, ref: 'bbb' },
          { number: CREDENTIAL_TWO_HOP, ref: 'ccc' },
        ],
      });

    it('writes a single-hop briefing asking for the root login on a labelled line', async () => {
      const { store, accepts } = offeredCredential();
      const terms = missionTerms(CREDENTIAL_SINGLE_HOP);

      await accept('offer=bbb', store);

      expect(accepts[0]!.briefing.subject).toBe(`Contract: ${terms.targetCompany}`);
      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(CREDENTIAL_SINGLE_HOP)}.`,
          '',
          'Bring us the root login for their backup server.',
          'Put the password on a line of its own, like this:',
          '',
          '  password: <the password>',
          '',
          'Reply to this address with that line and your wallet address.',
          'No login, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it('tells a two-hop contractor the machine is inside the network, not on the edge', async () => {
      const { store, accepts } = offeredCredential();
      const terms = missionTerms(CREDENTIAL_TWO_HOP);

      await accept('offer=ccc', store);

      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(CREDENTIAL_TWO_HOP)}.`,
          '',
          'Bring us the root login for their backup server.',
          'It is a machine inside their network, not on the edge.',
          'Put the password on a line of its own, like this:',
          '',
          '  password: <the password>',
          '',
          'Reply to this address with that line and your wallet address.',
          'No login, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it("names neither the machine's hostname nor any address but the network's", async () => {
      for (const [missionNumber, ref] of [
        [CREDENTIAL_SINGLE_HOP, 'bbb'],
        [CREDENTIAL_TWO_HOP, 'ccc'],
      ] as const) {
        const { store, accepts } = offeredCredential();
        const { stem } = missionShape(missionNumber);

        await accept(`offer=${ref}`, store);
        const { body } = accepts[0]!.briefing;

        expect(body).not.toContain(`${stem}-`);
        expect(body.match(/\d+\.\d+\.\d+\.\d+/g)).toEqual([missionAddressForNumber(missionNumber)]);
      }
    });

    it.each([
      'CCTV recorder',
      'backup server',
      'monitoring station',
      'build server',
      'licence server',
      'door-access controller',
      'billing server',
    ])('asks for the root login of a %s, in so many words', async (machine) => {
      const missionNumber = credentialNumber(false, machine);
      const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'mmm' }] });

      await accept('offer=mmm', store);

      expect(accepts[0]!.briefing.body.split('\n')).toContain(
        `Bring us the root login for their ${machine}.`,
      );
    });
  });

  describe('on a destroy job', () => {
    const offeredDestroy = () =>
      boardStore({
        offers: [
          { number: DESTROY_SINGLE_HOP, ref: 'bbb' },
          { number: DESTROY_TWO_HOP, ref: 'ccc' },
        ],
      });

    it("writes a single-hop briefing giving the file's name and asking for it gone", async () => {
      const { store, accepts } = offeredDestroy();
      const terms = missionTerms(DESTROY_SINGLE_HOP);

      await accept('offer=bbb', store);

      expect(accepts[0]!.briefing.subject).toBe(`Contract: ${terms.targetCompany}`);
      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(DESTROY_SINGLE_HOP)}.`,
          '',
          'Their lawyers keep a signed contract. We want it gone. Its name is:',
          '',
          `  ${missionFileName(DESTROY_SINGLE_HOP)}`,
          '',
          'Write to this address with your wallet address once it is gone.',
          'Not gone, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it('tells a two-hop contractor the file is on a machine inside the network', async () => {
      const { store, accepts } = offeredDestroy();
      const terms = missionTerms(DESTROY_TWO_HOP);

      await accept('offer=ccc', store);

      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(DESTROY_TWO_HOP)}.`,
          '',
          'Their lawyers keep a signed contract. We want it gone. Its name is:',
          '',
          `  ${missionFileName(DESTROY_TWO_HOP)}`,
          '',
          'The file is on a machine inside their network, not on the edge.',
          '',
          'Write to this address with your wallet address once it is gone.',
          'Not gone, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it("never gives the file's path, the machine's hostname or any address but the network's", async () => {
      for (const [missionNumber, ref] of [
        [DESTROY_SINGLE_HOP, 'bbb'],
        [DESTROY_TWO_HOP, 'ccc'],
      ] as const) {
        const { store, accepts } = offeredDestroy();
        const { stem } = missionShape(missionNumber);
        const directory = missionFilePath(missionNumber).replace(/\/[^/]+$/, '');

        await accept(`offer=${ref}`, store);
        const { body, attachment } = accepts[0]!.briefing;

        expect(body).not.toContain(directory);
        expect(body).not.toContain(`${stem}-`);
        expect(body.match(/\d+\.\d+\.\d+\.\d+/g)).toEqual([missionAddressForNumber(missionNumber)]);
        expect(attachment).toBeUndefined();
      }
    });

    it.each([
      ['prototype render', 'designers'],
      ['site photo', 'surveyors'],
      ['signed contract', 'lawyers'],
      ['firmware image', 'engineers'],
      ['customer export', 'salespeople'],
      ['key ring', 'admins'],
    ])('asks for a %s gone, in the words of the %s who keep it', async (noun, keepers) => {
      const missionNumber = destroyNumber(false, noun);
      const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'mmm' }] });

      await accept('offer=mmm', store);

      expect(accepts[0]!.briefing.body.split('\n')).toContain(
        `Their ${keepers} keep a ${noun}. We want it gone. Its name is:`,
      );
    });
  });

  describe('on a wipe job', () => {
    /** The first wipe contract from 70,000 up drawing `setting`, on one hop or on two. */
    const wipeNumber = (setting: RecordSetting, twoHop: boolean): number => {
      for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
        if (!isMissionNumber(candidate)) continue;
        const shape = missionShape(candidate);
        if (shape.kind !== 'wipe' || (shape.frontBox !== null) !== twoHop) continue;
        if (missionSetting(candidate) === setting) return candidate;
      }
      throw new Error(`no ${setting} wipe contract`);
    };

    const WIPE_SINGLE_HOP = wipeNumber('police', false);
    const WIPE_TWO_HOP = wipeNumber('police', true);

    it('writes a single-hop briefing describing the records and asking for all of it gone', async () => {
      const { store, accepts } = boardStore({ offers: [{ number: WIPE_SINGLE_HOP, ref: 'bbb' }] });
      const terms = missionTerms(WIPE_SINGLE_HOP);

      await accept('offer=bbb', store);

      expect(accepts[0]!.briefing.subject).toBe(`Contract: ${terms.targetCompany}`);
      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(WIPE_SINGLE_HOP)}.`,
          '',
          'Their records hold everyone they want arrested. We want all of it gone.',
          '',
          'Mail this address when it is done, with your wallet address.',
          'Not wiped, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it('tells a two-hop contractor the records are on a machine inside the network', async () => {
      const { store, accepts } = boardStore({ offers: [{ number: WIPE_TWO_HOP, ref: 'ccc' }] });
      const terms = missionTerms(WIPE_TWO_HOP);

      await accept('offer=ccc', store);

      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(WIPE_TWO_HOP)}.`,
          '',
          'Their records hold everyone they want arrested. We want all of it gone.',
          '',
          'The records are on a machine inside their network, not on the edge.',
          '',
          'Mail this address when it is done, with your wallet address.',
          'Not wiped, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it.each([
      ['school', 'what each student scored in each subject'],
      ['police', 'everyone they want arrested'],
      ['payroll', 'what they pay each of their people'],
      ['dmv', 'the points held against each driver'],
      ['tournament', 'what each player has racked up'],
      ['admissions', 'everyone waiting on a place'],
      ['club', 'everyone who belongs to the club'],
      ['registry', 'who owns which car'],
    ] as const)(
      'describes the records on a %s job as %s, and names no table, file or machine',
      async (setting, description) => {
        const missionNumber = wipeNumber(setting, false);
        const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'mmm' }] });
        const { stem } = missionShape(missionNumber);

        await accept('offer=mmm', store);
        const { body, attachment } = accepts[0]!.briefing;

        expect(body.split('\n')).toContain(
          `Their records hold ${description}. We want all of it gone.`,
        );
        for (const { name } of missionRecords(missionNumber).tables) {
          expect(body).not.toMatch(new RegExp(`\\b${name}\\b`));
        }
        expect(body).not.toContain('/srv/');
        expect(body).not.toContain(DATADIR_PATH);
        expect(body).not.toContain(`${stem}-`);
        expect(body.match(/\d+\.\d+\.\d+\.\d+/g)).toEqual([missionAddressForNumber(missionNumber)]);
        expect(attachment).toBeUndefined();
      },
    );
  });

  describe('on a portforward job', () => {
    it.each([
      ['customer database', 3306],
      ['cache server', 6379],
      ['staff intranet', 80],
      ['development server', 22],
    ] as const)(
      'asks for a way from outside into their %s, the public port sent to it on %i',
      async (noun, insidePort) => {
        const missionNumber = portforwardNumber(noun);
        const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'ppp' }] });
        const terms = missionTerms(missionNumber);
        const { publicPort } = portforwardJob(missionNumber);

        await accept('offer=ppp', store);

        expect(accepts[0]!.briefing.subject).toBe(`Contract: ${terms.targetCompany}`);
        expect(accepts[0]!.briefing.body).toBe(
          [
            terms.pitch,
            '',
            `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(missionNumber)}.`,
            '',
            `We want to reach their ${noun} from outside.`,
            `Their router should send port ${publicPort} to it, on ${insidePort}.`,
            '',
            'Write to this address with your wallet address once it is open.',
            'No way in, no money. No wallet, no money.',
            '',
            `-- ${terms.client.company}`,
            '',
          ].join('\n'),
        );
        expect(accepts[0]!.briefing.attachment).toBeUndefined();
      },
    );

    it('names no box, no address but the network, no file and no path', async () => {
      const missionNumber = portforwardNumber('customer database');
      const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'ppp' }] });
      const { stem } = missionShape(missionNumber);

      await accept('offer=ppp', store);
      const { body } = accepts[0]!.briefing;

      expect(body).not.toContain(`${stem}-`);
      expect(body).not.toMatch(/rules\.v4|iptables|\/etc|nano|\bkey\b/i);
      expect(body.match(/\d+\.\d+\.\d+\.\d+/g)).toEqual([missionAddressForNumber(missionNumber)]);
    });
  });

  describe('on a cleanup job', () => {
    const offeredCleanup = () =>
      boardStore({
        offers: [
          { number: CLEANUP_SINGLE_HOP, ref: 'uuu' },
          { number: CLEANUP_TWO_HOP, ref: 'vvv' },
        ],
      });

    it('writes a single-hop briefing naming the machine and the port, and handing over root', async () => {
      const { store, accepts } = offeredCleanup();
      const terms = missionTerms(CLEANUP_SINGLE_HOP);
      const { role, port } = cleanupJob(CLEANUP_SINGLE_HOP);
      const address = missionAddressForNumber(CLEANUP_SINGLE_HOP);
      const word = plaintextFor(missionShape(CLEANUP_SINGLE_HOP).keyBox.rootHash);

      await accept('offer=uuu', store);

      expect(accepts[0]!.briefing).toEqual({
        sender: `${terms.client.handle}@emailit.io`,
        subject: `Contract: ${terms.targetCompany}`,
        body: [
          terms.pitch,
          '',
          `Our customer is ${terms.targetCompany}. Their network is at ${address}.`,
          '',
          `Something on their ${role.noun} answers on port ${port}, and nobody there put it there.`,
          'Find what runs it, stop it, and get it off the machine.',
          '',
          'They have given you root:',
          '',
          `  ssh root@${address} -p 2222`,
          `  password: ${word}`,
          '',
          'Leave the machine running. If it no longer boots, there is no money.',
          'Write to this address with your wallet address once it is gone.',
          'Still there, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      });
    });

    it('hands a two-hop contractor the edge machine, then the machine inside at its own address', async () => {
      const { store, accepts } = offeredCleanup();
      const terms = missionTerms(CLEANUP_TWO_HOP);
      const { role, port } = cleanupJob(CLEANUP_TWO_HOP);
      const { keyBox, frontBox } = missionShape(CLEANUP_TWO_HOP);
      const address = missionAddressForNumber(CLEANUP_TWO_HOP);
      const inside = `${lanSubnetPrefix(missionEssid(CLEANUP_TWO_HOP))}.${keyBox.octet}`;

      await accept('offer=vvv', store);

      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `Our customer is ${terms.targetCompany}. Their network is at ${address}.`,
          '',
          `Something on their ${role.noun} answers on port ${port}, and nobody there put it there.`,
          'Find what runs it, stop it, and get it off the machine.',
          '',
          'They have given you root on the machine on the edge of their network:',
          '',
          `  ssh root@${address} -p 2222`,
          `  password: ${plaintextFor(frontBox!.rootHash)}`,
          '',
          `The ${role.noun} is inside their network, at ${inside}. From the edge machine:`,
          '',
          `  ssh root@${inside}`,
          `  password: ${plaintextFor(keyBox.rootHash)}`,
          '',
          'Leave both machines running. If either no longer boots, there is no money.',
          'Write to this address with your wallet address once it is gone.',
          'Still there, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    // A symptom, never the answer: the hunt is the work, so the briefing names no path, no
    // tool and nothing about what the intruder left.
    it('names no box, no path, no tool and nothing of what was left', async () => {
      for (const [missionNumber, ref] of [
        [CLEANUP_SINGLE_HOP, 'uuu'],
        [CLEANUP_TWO_HOP, 'vvv'],
      ] as const) {
        const { store, accepts } = offeredCleanup();
        const { stem } = missionShape(missionNumber);

        await accept(`offer=${ref}`, store);
        const { body } = accepts[0]!.briefing;

        expect(body).not.toContain(`${stem}-`);
        expect(body).not.toMatch(
          /\/etc|\/var|\bnc\b|netcat|\bps\b|\bkill\b|cron|implant|backdoor/i,
        );
      }
    });

    // The words are the server's, so a briefing that cannot carry them is no briefing, and the
    // job's files are laid from the mission secret, so the job cannot be worked without it.
    it('answers nothing, asking the store nothing, when the password pools are unset', async () => {
      const { store, accepts } = offeredCleanup();

      expect(await acceptWithoutPools('offer=uuu', store)).toBeNull();
      expect(accepts).toEqual([]);
    });

    // A briefing handing over the edge login alone would strand the contractor at the second hop.
    it('answers nothing when the pools have lost the inside machine’s word', async () => {
      const { store, accepts } = offeredCleanup();
      const insideWord = plaintextFor(missionShape(CLEANUP_TWO_HOP).keyBox.rootHash);
      const rawSecrets = JSON.stringify({
        ...DEPLOYMENT_POOLS,
        WHITE_HAT_PASSWORDS: WHITE_HAT_PASSWORDS.filter((word) => word !== insideWord),
      });

      const answer = await answerAccept({
        handle: HANDLE,
        address: BOARD_ADDRESS,
        form: 'offer=vvv',
        store,
        missionSecret: MISSION_SECRET,
        rawSecrets,
        ...drawsFrom([FOURTH]),
      });

      expect(answer).toBeNull();
      expect(accepts).toEqual([]);
    });

    it('answers nothing, asking the store nothing, when the mission secret is unset', async () => {
      const { store, accepts } = offeredCleanup();

      expect(await acceptWithoutSecret('offer=vvv', store)).toBeNull();
      expect(accepts).toEqual([]);
    });

    it('takes a black-hat job without the pools: only a cleanup briefing hands over a word', async () => {
      const { store, accepts } = boardStore({
        offers: [{ number: BACKDOOR_SINGLE_HOP, ref: 'bbb' }],
      });

      expect(alertOf(await acceptWithoutPools('offer=bbb', store))).toMatch(/^Contract accepted\./);
      expect(accepts).toHaveLength(1);
    });
  });

  describe('on a lock-them-out job', () => {
    const offeredLockout = () =>
      boardStore({
        offers: [
          { number: LOCKOUT_SINGLE_HOP, ref: 'lll' },
          { number: LOCKOUT_TWO_HOP, ref: 'mmm' },
        ],
      });

    it('writes a single-hop briefing naming the machine, and handing over root with the word that leaked', async () => {
      const { store, accepts } = offeredLockout();
      const terms = missionTerms(LOCKOUT_SINGLE_HOP);
      const { role } = lockoutJob(LOCKOUT_SINGLE_HOP);
      const address = missionAddressForNumber(LOCKOUT_SINGLE_HOP);
      const word = plaintextFor(missionShape(LOCKOUT_SINGLE_HOP).keyBox.rootHash);

      await accept('offer=lll', store);

      expect(accepts[0]!.briefing).toEqual({
        sender: `${terms.client.handle}@emailit.io`,
        subject: `Contract: ${terms.targetCompany}`,
        body: [
          terms.pitch,
          '',
          `Our customer is ${terms.targetCompany}. Their network is at ${address}.`,
          '',
          `Someone outside has root's password on their ${role.noun}, and nobody there gave it to them.`,
          'Lock them out. Leave their own accounts as they are.',
          '',
          'This is the password they have. The customer has given you root with it:',
          '',
          `  ssh root@${address} -p 2222`,
          `  password: ${word}`,
          '',
          'Leave the machine running. If it no longer boots, there is no money.',
          'Write to this address with your wallet address once they are locked out.',
          'Still open, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      });
    });

    it('hands a two-hop contractor the edge machine, then the word that leaked for the machine inside', async () => {
      const { store, accepts } = offeredLockout();
      const terms = missionTerms(LOCKOUT_TWO_HOP);
      const { role } = lockoutJob(LOCKOUT_TWO_HOP);
      const { keyBox, frontBox } = missionShape(LOCKOUT_TWO_HOP);
      const address = missionAddressForNumber(LOCKOUT_TWO_HOP);
      const inside = `${lanSubnetPrefix(missionEssid(LOCKOUT_TWO_HOP))}.${keyBox.octet}`;

      await accept('offer=mmm', store);

      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `Our customer is ${terms.targetCompany}. Their network is at ${address}.`,
          '',
          `Someone outside has root's password on their ${role.noun}, and nobody there gave it to them.`,
          'Lock them out. Leave their own accounts as they are.',
          '',
          'They have given you root on the machine on the edge of their network:',
          '',
          `  ssh root@${address} -p 2222`,
          `  password: ${plaintextFor(frontBox!.rootHash)}`,
          '',
          `The ${role.noun} is inside their network, at ${inside}.`,
          'This is the password they have. From the edge machine:',
          '',
          `  ssh root@${inside}`,
          `  password: ${plaintextFor(keyBox.rootHash)}`,
          '',
          'Leave both machines running. If either no longer boots, there is no money.',
          'Write to this address with your wallet address once they are locked out.',
          'Still open, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    // Changing root's password is not the whole lockout, and the briefing must not say so: the
    // account the intruder added is the contractor's to find.
    it('names no added account, no file and no tool', async () => {
      for (const [missionNumber, ref] of [
        [LOCKOUT_SINGLE_HOP, 'lll'],
        [LOCKOUT_TWO_HOP, 'mmm'],
      ] as const) {
        const { store, accepts } = offeredLockout();
        const { account } = lockoutJob(missionNumber);

        await accept(`offer=${ref}`, store);
        const { body } = accepts[0]!.briefing;

        expect(body).not.toContain(account);
        expect(body).not.toMatch(/\/etc|passwd|uid|nano|added|another account/i);
      }
    });

    // The words are the server's, so a briefing that cannot carry them is no briefing.
    it('answers nothing, asking the store nothing, when the password pools are unset', async () => {
      const { store, accepts } = offeredLockout();

      expect(await acceptWithoutPools('offer=mmm', store)).toBeNull();
      expect(accepts).toEqual([]);
    });

    // Nothing is laid on a lock-them-out job's boxes by the server: the added account ships with
    // the box.
    it('takes the job without the mission secret', async () => {
      const { store, accepts } = offeredLockout();

      expect(alertOf(await acceptWithoutSecret('offer=lll', store))).toMatch(
        /^Contract accepted\./,
      );
      expect(accepts).toHaveLength(1);
    });
  });

  describe('on a patch-it job', () => {
    const offeredPatch = () =>
      boardStore({
        offers: [
          { number: PATCH_SINGLE_HOP, ref: 'ppp' },
          { number: PATCH_TWO_HOP, ref: 'qqq' },
        ],
      });

    it('writes a single-hop briefing naming the machine, and handing over root on it', async () => {
      const { store, accepts } = offeredPatch();
      const terms = missionTerms(PATCH_SINGLE_HOP);
      const { role } = patchJob(PATCH_SINGLE_HOP);
      const address = missionAddressForNumber(PATCH_SINGLE_HOP);
      const word = plaintextFor(missionShape(PATCH_SINGLE_HOP).keyBox.rootHash);

      await accept('offer=ppp', store);

      expect(accepts[0]!.briefing).toEqual({
        sender: `${terms.client.handle}@emailit.io`,
        subject: `Contract: ${terms.targetCompany}`,
        body: [
          terms.pitch,
          '',
          `Our customer is ${terms.targetCompany}. Their network is at ${address}.`,
          '',
          `Something on their ${role.noun} lets anyone in as root. It needs patching.`,
          'Move only what has to move. The rest of their software is certified on the versions it runs.',
          '',
          'They have given you root:',
          '',
          `  ssh root@${address} -p 2222`,
          `  password: ${word}`,
          '',
          'Leave the machine running. If it no longer boots, there is no money.',
          'Write to this address with your wallet address once it is patched.',
          'Still open, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      });
    });

    it('hands a two-hop contractor the edge machine, then the machine inside', async () => {
      const { store, accepts } = offeredPatch();
      const terms = missionTerms(PATCH_TWO_HOP);
      const { role } = patchJob(PATCH_TWO_HOP);
      const { keyBox, frontBox } = missionShape(PATCH_TWO_HOP);
      const address = missionAddressForNumber(PATCH_TWO_HOP);
      const inside = `${lanSubnetPrefix(missionEssid(PATCH_TWO_HOP))}.${keyBox.octet}`;

      await accept('offer=qqq', store);

      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `Our customer is ${terms.targetCompany}. Their network is at ${address}.`,
          '',
          `Something on their ${role.noun} lets anyone in as root. It needs patching.`,
          'Move only what has to move. The rest of their software is certified on the versions it runs.',
          '',
          'They have given you root on the machine on the edge of their network:',
          '',
          `  ssh root@${address} -p 2222`,
          `  password: ${plaintextFor(frontBox!.rootHash)}`,
          '',
          `The ${role.noun} is inside their network, at ${inside}. From the edge machine:`,
          '',
          `  ssh root@${inside}`,
          `  password: ${plaintextFor(keyBox.rootHash)}`,
          '',
          'Leave both machines running. If either no longer boots, there is no money.',
          'Write to this address with your wallet address once it is patched.',
          'Still open, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    // Reading which package is holed is the job, so the briefing names no package, port, release
    // or CVE, and no tool.
    it('names no package, port, release, CVE or tool', async () => {
      for (const [missionNumber, ref] of [
        [PATCH_SINGLE_HOP, 'ppp'],
        [PATCH_TWO_HOP, 'qqq'],
      ] as const) {
        const { store, accepts } = offeredPatch();
        const hole = patchHole(missionNumber);

        await accept(`offer=${ref}`, store);
        const { body } = accepts[0]!.briefing;

        expect(body).not.toContain(hole.package);
        expect(body).not.toContain(hole.program);
        expect(body).not.toContain(hole.version);
        expect(body).not.toMatch(new RegExp(`\\b${hole.port}\\b`));
        expect(body).not.toMatch(/\b(CVE|apt|nmap|critical|upgrade)\b/i);
      }
    });

    it('answers nothing, asking the store nothing, when the password pools are unset', async () => {
      const { store, accepts } = offeredPatch();

      expect(await acceptWithoutPools('offer=qqq', store)).toBeNull();
      expect(accepts).toEqual([]);
    });

    // Nothing is laid on a patch-it job's boxes by the server: the hole ships with the box.
    it('takes the job without the mission secret', async () => {
      const { store, accepts } = offeredPatch();

      expect(alertOf(await acceptWithoutSecret('offer=ppp', store))).toMatch(
        /^Contract accepted\./,
      );
      expect(accepts).toHaveLength(1);
    });
  });

  describe('on a close-the-door job', () => {
    it.each(['customer database', 'cache server', 'staff intranet', 'development server'])(
      'names their %s as reachable from outside, never the port, and hands over root on their router',
      async (noun) => {
        const missionNumber = closeDoorNumber(noun);
        const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'ccc' }] });
        const terms = missionTerms(missionNumber);
        const address = missionAddressForNumber(missionNumber);
        const word = plaintextFor(missionShape(missionNumber).gatewayAdminHash);

        await accept('offer=ccc', store);

        expect(accepts[0]!.briefing).toEqual({
          sender: `${terms.client.handle}@emailit.io`,
          subject: `Contract: ${terms.targetCompany}`,
          body: [
            terms.pitch,
            '',
            `Our customer is ${terms.targetCompany}. Their network is at ${address}.`,
            '',
            `Someone opened a way into their ${noun} from outside, and nobody there did it.`,
            'Shut it. Leave the rest of what their router forwards as it is.',
            '',
            'They have given you root on their router:',
            '',
            `  ssh root@${address}`,
            `  password: ${word}`,
            '',
            'Leave the router running. If it no longer boots, there is no money.',
            'Write to this address with your wallet address once it is shut.',
            'Still open, no money. No wallet, no money.',
            '',
            `-- ${terms.client.company}`,
            '',
          ].join('\n'),
        });
      },
    );

    // A symptom, never the answer: which forward reaches the machine is the job, so the
    // briefing names neither of its ports, no box, no file and no tool.
    it('names no port, no box, no file and no tool', async () => {
      for (const noun of ['customer database', 'staff intranet', 'development server']) {
        const missionNumber = closeDoorNumber(noun);
        const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'ccc' }] });
        const { stem } = missionShape(missionNumber);
        const { machine, publicPort } = closeDoorJob(missionNumber);

        await accept('offer=ccc', store);
        const { body } = accepts[0]!.briefing;

        expect(body, noun).not.toContain(`${stem}-`);
        expect(body, noun).not.toMatch(new RegExp(`\\b(${publicPort}|${machine.insidePort})\\b`));
        expect(body, noun).not.toMatch(/rules\.v4|iptables|\/etc|nano|\bport\b/i);
        expect(new Set(body.match(/\d+\.\d+\.\d+\.\d+/g)), noun).toEqual(
          new Set([missionAddressForNumber(missionNumber)]),
        );
      }
    });

    // The word is the server's, so a briefing that cannot carry it is no briefing.
    it('answers nothing, asking the store nothing, when the password pools are unset', async () => {
      const { store, accepts } = boardStore({
        offers: [{ number: closeDoorNumber('cache server'), ref: 'ccc' }],
      });

      expect(await acceptWithoutPools('offer=ccc', store)).toBeNull();
      expect(accepts).toEqual([]);
    });

    // Nothing is laid on a close-the-door job's boxes: the rogue forward is the router's own.
    it('takes the job without the mission secret', async () => {
      const { store, accepts } = boardStore({
        offers: [{ number: closeDoorNumber('cache server'), ref: 'ccc' }],
      });

      expect(alertOf(await acceptWithoutSecret('offer=ccc', store))).toMatch(
        /^Contract accepted\./,
      );
      expect(accepts).toHaveLength(1);
    });
  });

  describe('on an infiltrate job', () => {
    const offeredInfiltrate = () =>
      boardStore({
        offers: [
          { number: INFILTRATE_SINGLE_HOP, ref: 'iii' },
          { number: INFILTRATE_TWO_HOP, ref: 'jjj' },
        ],
      });

    /** The briefing as the client writes it, the inside line on two hops. */
    const briefingBody = (missionNumber: number, inside: readonly string[]) => {
      const terms = missionTerms(missionNumber);
      return [
        terms.pitch,
        '',
        `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(missionNumber)}.`,
        '',
        `Their ${missionFileItem(missionNumber).keepers} keep a ${missionFileItem(missionNumber).noun}. We want ours in its place.`,
        'Put the attached file at:',
        '',
        `  ${missionFilePath(missionNumber)}`,
        '',
        ...inside,
        'Write to this address with your wallet address once it is there.',
        'No file in place, no money. No wallet, no money.',
        '',
        `-- ${terms.client.company}`,
        '',
      ].join('\n');
    };

    it('writes a single-hop briefing naming the whole path, and attaches the file to put there', async () => {
      const { store, accepts } = offeredInfiltrate();

      await accept('offer=iii', store);

      expect(accepts[0]!.briefing).toEqual({
        sender: `${missionTerms(INFILTRATE_SINGLE_HOP).client.handle}@emailit.io`,
        subject: `Contract: ${missionTerms(INFILTRATE_SINGLE_HOP).targetCompany}`,
        body: briefingBody(INFILTRATE_SINGLE_HOP, []),
        attachment: {
          name: missionFileName(INFILTRATE_SINGLE_HOP),
          content: missionPlantContent(INFILTRATE_SINGLE_HOP, MISSION_SECRET),
        },
      });
    });

    it('tells a two-hop contractor the path is inside the network, not on the edge', async () => {
      const { store, accepts } = offeredInfiltrate();

      await accept('offer=jjj', store);

      expect(accepts[0]!.briefing.body).toBe(
        briefingBody(INFILTRATE_TWO_HOP, [
          'The path is on a machine inside their network, not on the edge.',
          '',
        ]),
      );
      expect(accepts[0]!.briefing.attachment).toEqual({
        name: missionFileName(INFILTRATE_TWO_HOP),
        content: missionPlantContent(INFILTRATE_TWO_HOP, MISSION_SECRET),
      });
    });

    it.each([
      ['prototype render', 'designers'],
      ['site photo', 'surveyors'],
      ['signed contract', 'lawyers'],
      ['firmware image', 'engineers'],
      ['customer export', 'salespeople'],
      ['key ring', 'admins'],
      ['boot script', 'admins'],
    ])('asks for its own %s in place of the one the %s keep', async (noun, keepers) => {
      const missionNumber = infiltrateNumberFor(noun);
      const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'kkk' }] });

      await accept('offer=kkk', store);

      expect(accepts[0]!.briefing.body).toContain(
        [
          `Their ${keepers} keep a ${noun}. We want ours in its place.`,
          'Put the attached file at:',
          '',
          `  ${missionFilePath(missionNumber)}`,
          '',
        ].join('\n'),
      );
      expect(accepts[0]!.briefing.attachment).toEqual({
        name: missionFileName(missionNumber),
        content: missionPlantContent(missionNumber, MISSION_SECRET),
      });
    });

    // The client's file is drawn from the secret, and a briefing that cannot carry it is no
    // briefing: the job is not taken rather than taken with nothing to put in place.
    it('answers nothing, asking the store nothing, when the mission secret is unset', async () => {
      const { store, accepts } = offeredInfiltrate();

      expect(await acceptWithoutSecret('offer=iii', store)).toBeNull();
      expect(accepts).toEqual([]);
    });

    it('takes every other kind of job without the secret, carrying no file', async () => {
      const { store, accepts } = boardStore({
        offers: [
          { number: FILE_SINGLE_HOP, ref: 'fff' },
          { number: BACKDOOR_SINGLE_HOP, ref: 'bbb' },
        ],
      });

      expect(alertOf(await acceptWithoutSecret('offer=fff', store))).toMatch(
        /^Contract accepted\./,
      );
      expect(accepts[0]!.briefing.attachment).toBeUndefined();
    });
  });

  describe('on a file job', () => {
    const offeredFile = () =>
      boardStore({
        offers: [
          { number: FILE_SINGLE_HOP, ref: 'fff' },
          { number: FILE_TWO_HOP, ref: 'ggg' },
        ],
      });

    it('writes a single-hop briefing naming the file and asking for it attached', async () => {
      const { store, accepts } = offeredFile();
      const terms = missionTerms(FILE_SINGLE_HOP);

      await accept('offer=fff', store);

      expect(accepts[0]!.briefing.subject).toBe(`Contract: ${terms.targetCompany}`);
      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(FILE_SINGLE_HOP)}.`,
          '',
          askedLine(FILE_SINGLE_HOP),
          '',
          `  ${missionFileName(FILE_SINGLE_HOP)}`,
          '',
          'Mail it to this address as an attachment, with your wallet address.',
          'No file, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it('tells a two-hop contractor the file is inside the network, not on the edge', async () => {
      const { store, accepts } = offeredFile();
      const terms = missionTerms(FILE_TWO_HOP);

      await accept('offer=ggg', store);

      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(FILE_TWO_HOP)}.`,
          '',
          askedLine(FILE_TWO_HOP),
          '',
          `  ${missionFileName(FILE_TWO_HOP)}`,
          '',
          'The file is on a machine inside their network, not on the edge.',
          '',
          'Mail it to this address as an attachment, with your wallet address.',
          'No file, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it.each([
      ['prototype render', 'designers'],
      ['site photo', 'surveyors'],
      ['signed contract', 'lawyers'],
      ['firmware image', 'engineers'],
      ['customer export', 'salespeople'],
      ['key ring', 'admins'],
    ])('asks for a %s from the %s who keep it, by its name', async (noun, keepers) => {
      const missionNumber = fileNumberFor(noun);
      const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'hhh' }] });

      await accept('offer=hhh', store);

      expect(accepts[0]!.briefing.body).toContain(
        [
          `Their ${keepers} keep a ${noun}. Bring it to us. Its name is:`,
          '',
          `  ${missionFileName(missionNumber)}`,
          '',
        ].join('\n'),
      );
    });

    it('names no box, no address but the network, and not where the file sits', async () => {
      for (const [missionNumber, ref] of [
        [FILE_SINGLE_HOP, 'fff'],
        [FILE_TWO_HOP, 'ggg'],
      ] as const) {
        const { store, accepts } = offeredFile();
        const { stem } = missionShape(missionNumber);
        const directory = missionFilePath(missionNumber).replace(/\/[^/]+$/, '');

        await accept(`offer=${ref}`, store);
        const { body } = accepts[0]!.briefing;

        expect(body).not.toContain(`${stem}-`);
        expect(body).not.toContain(directory);
        // A key ring is the one item whose name says key; nothing else in the mail does.
        expect(body.replaceAll(missionFileItem(missionNumber).noun, '')).not.toMatch(/\bkey\b/i);
        expect(body.match(/\d+\.\d+\.\d+\.\d+/g)).toEqual([missionAddressForNumber(missionNumber)]);
      }
    });
  });

  describe('on a tamper job', () => {
    const offeredTamper = () =>
      boardStore({
        offers: [
          { number: TAMPER_SINGLE_HOP, ref: 'ttt' },
          { number: TAMPER_TWO_HOP, ref: 'uuu' },
          { number: ERASE_SINGLE_HOP, ref: 'vvv' },
          { number: ERASE_TWO_HOP, ref: 'www' },
        ],
      });

    it('writes a single-hop briefing naming the student, the subject and both grades', async () => {
      const { store, accepts } = offeredTamper();
      const terms = missionTerms(TAMPER_SINGLE_HOP);
      const target = changeTargetOf(TAMPER_SINGLE_HOP);

      await accept('offer=ttt', store);

      expect(accepts[0]!.briefing.subject).toBe(`Contract: ${terms.targetCompany}`);
      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(TAMPER_SINGLE_HOP)}.`,
          '',
          askedSentence('school', target),
          '',
          'Mail this address when it is done, with your wallet address.',
          'No change, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it('tells a two-hop contractor the records are inside the network, not on the edge', async () => {
      const { store, accepts } = offeredTamper();
      const terms = missionTerms(TAMPER_TWO_HOP);
      const target = changeTargetOf(TAMPER_TWO_HOP);

      await accept('offer=uuu', store);

      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(TAMPER_TWO_HOP)}.`,
          '',
          askedSentence('school', target),
          '',
          'The records are on a machine inside their network, not on the edge.',
          '',
          'Mail this address when it is done, with your wallet address.',
          'No change, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it('writes a single-hop erase briefing naming the student, the subject and the failing grade', async () => {
      const { store, accepts } = offeredTamper();
      const terms = missionTerms(ERASE_SINGLE_HOP);
      const target = eraseTargetOf(ERASE_SINGLE_HOP);

      await accept('offer=vvv', store);

      expect(accepts[0]!.briefing.subject).toBe(`Contract: ${terms.targetCompany}`);
      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(ERASE_SINGLE_HOP)}.`,
          '',
          askedSentence('school', target),
          '',
          'Mail this address when it is done, with your wallet address.',
          'No change, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it('tells a two-hop erase contractor the records are inside the network', async () => {
      const { store, accepts } = offeredTamper();
      const terms = missionTerms(ERASE_TWO_HOP);
      const target = eraseTargetOf(ERASE_TWO_HOP);

      await accept('offer=www', store);

      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(ERASE_TWO_HOP)}.`,
          '',
          askedSentence('school', target),
          '',
          'The records are on a machine inside their network, not on the edge.',
          '',
          'Mail this address when it is done, with your wallet address.',
          'No change, no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
    });

    it.each([
      ['single-hop change', 'ttt', TAMPER_SINGLE_HOP],
      ['two-hop change', 'uuu', TAMPER_TWO_HOP],
      ['single-hop erase', 'vvv', ERASE_SINGLE_HOP],
      ['two-hop erase', 'www', ERASE_TWO_HOP],
    ])(
      'never names in a %s briefing the row, the table, the box or the path',
      async (_template, ref, missionNumber) => {
        const { store, accepts } = offeredTamper();
        const { stem } = missionShape(missionNumber);

        await accept(`offer=${ref}`, store);
        const { body } = accepts[0]!.briefing;

        expect(body).not.toMatch(/\bid\b|grades|table|database|mysql|ACCESS-/i);
        expect(body).not.toContain(DATADIR_PATH);
        expect(body).not.toContain(`${stem}-`);
        expect(body.match(/\d+\.\d+\.\d+\.\d+/g)).toEqual([missionAddressForNumber(missionNumber)]);
      },
    );

    it.each(SETTING_JOBS)(
      'names the record a %s %s job is about, and nothing of where it is kept',
      async (setting, action) => {
        const missionNumber = tamperNumber(setting, action, false);
        const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'xyz' }] });
        const { stem } = missionShape(missionNumber);
        const { tables, target } = missionRecords(missionNumber);
        const tableWords = new RegExp(`\\b(${tables.map(({ name }) => name).join('|')})\\b`, 'i');

        await accept('offer=xyz', store);
        const { body } = accepts[0]!.briefing;

        expect(body.split('\n')[4]).toBe(askedSentence(setting, target));
        expect(body).not.toMatch(/\b(id|table|database|mysql|csv)\b|\/srv\//i);
        // The target's own name is the grill's ("a Members Club"), and the pitch is the
        // setting's prose ("The payroll never got the memo."), which says no more than the
        // board's "alter a payroll record" already did, so only the rest is read.
        const { targetCompany, pitch } = missionTerms(missionNumber);
        expect(body.replace(targetCompany, '').replace(pitch, '')).not.toMatch(tableWords);
        expect(body).not.toContain(`${stem}-`);
      },
    );
  });

  it('names no box, route, count of machines or address of a two-hop network but its own', async () => {
    const { store, accepts } = offered();
    const { stem, keyBox, frontBox } = missionShape(SECOND);

    await accept('offer=bbb', store);
    const { body } = accepts[0]!.briefing;

    expect(body.match(/\d+\.\d+\.\d+\.\d+/g)).toEqual([missionAddressForNumber(SECOND)]);
    for (const suffix of [GATEWAY_SUFFIX, FRONT_BOX_SUFFIX, KEY_BOX_SUFFIX]) {
      expect(body).not.toContain(`${stem}-${suffix}`);
    }
    for (const route of [keyBox.route, frontBox!.route]) expect(body).not.toContain(route);
    expect(body).not.toMatch(/\b(two|three|second|front|pivot|hop|machines)\b/i);
  });

  it('refuses under the offer while another contract is held', async () => {
    const { store } = offered();

    const page = await accept('offer=bbb', {
      ...store,
      accept: async () => ({ data: 'busy', error: null }),
    });

    expect(alertOf(page)).toBe('Finish or drop your current contract first');
    expect(answeredForm(page)).toBe('/accept bbb');
  });

  it('says the offer is gone when the store finds it turned over', async () => {
    const { store } = offered();

    const page = await accept('offer=bbb', {
      ...store,
      accept: async () => ({ data: 'gone', error: null }),
    });

    expect(alertOf(page)).toBe('That offer is no longer available.');
    expect(answeredForm(page)).toBe('/accept bbb');
  });

  it.each([
    ['a ref the board does not hold', 'offer=zzz'],
    ['no ref at all', 'offer='],
    ['a form with no offer', 'confirm=yes'],
  ])('says the offer is gone, asking the store nothing, for %s', async (_what, form) => {
    const { store, accepts } = offered();

    const page = await accept(form, store);

    expect(accepts).toEqual([]);
    expect(alertOf(page)).toBe('That offer is no longer available.');
  });

  it.each([
    ['the store failed', { data: null, error: new Error('down') }],
    ['the store answered a word it was never taught', { data: 'maybe', error: null }],
  ])('answers nothing when %s', async (_why, reply) => {
    const { store } = offered();

    expect(await accept('offer=bbb', { ...store, accept: async () => reply })).toBeNull();
  });

  it('answers nothing when the board cannot be read', async () => {
    expect(await accept('offer=bbb', failing)).toBeNull();
  });

  it('answers nothing when the board cannot be read again after accepting', async () => {
    const { store, accepts } = offered();

    expect(await accept('offer=bbb', downAfterFirstRead(store))).toBeNull();
    expect(accepts).toHaveLength(1);
  });

  describe('on a chain job', () => {
    /** The first chain contract from 70,000 up whose last step is `final`, and that `wanted`
     *  accepts. */
    const chainNumber = (
      final: ChainFinal,
      wanted: (missionNumber: number) => boolean = () => true,
    ): number => {
      for (let candidate = 70_000; candidate < 2_000_000; candidate++) {
        if (
          isMissionNumber(candidate) &&
          missionKind(candidate) === 'chain' &&
          chainFinal(candidate) === final &&
          wanted(candidate)
        ) {
          return candidate;
        }
      }
      throw new Error(`no chain contract ending in ${final}`);
    };
    const CHAIN = chainNumber('sabotage');

    /** The briefing's body as the client writes it around `jobLines`. */
    const briefingOf = (missionNumber: number, jobLines: readonly string[]): string => {
      const terms = missionTerms(missionNumber);
      return [
        terms.pitch,
        '',
        `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(missionNumber)}.`,
        '',
        ...jobLines,
        '',
        `-- ${terms.client.company}`,
        '',
      ].join('\n');
    };

    it('writes a briefing asking for a listener on the edge and a file inside gone, by its name, when that is the last step', async () => {
      const missionNumber = chainNumber(
        'destroy',
        (candidate) => missionFileItem(candidate).noun === 'signed contract',
      );
      const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'ddd' }] });
      const { port } = chainJob(missionNumber);

      await accept('offer=ddd', store);

      expect(accepts[0]!.briefing.body).toBe(
        briefingOf(missionNumber, [
          'This job has two parts. We pay for both or for neither.',
          '',
          `First, leave a listener on the machine on the edge of their network, on port ${port}.`,
          'Then get rid of a signed contract their lawyers keep. Its name is:',
          '',
          `  ${missionFileName(missionNumber)}`,
          '',
          'The file is on a machine inside their network, not on the edge.',
          '',
          'Write to this address with your wallet address once both are done.',
          'Both done or no money. No wallet, no money.',
        ]),
      );
      expect(accepts[0]!.briefing.body).not.toContain(missionFilePath(missionNumber));
      expect(accepts[0]!.briefing.attachment).toBeUndefined();
    });

    it('writes a briefing asking for a listener on the edge and the records inside wiped, by what they hold, when that is the last step', async () => {
      const missionNumber = chainNumber(
        'wipe',
        (candidate) => missionSetting(candidate) === 'police',
      );
      const { store, accepts } = boardStore({ offers: [{ number: missionNumber, ref: 'ddd' }] });
      const { port } = chainJob(missionNumber);

      await accept('offer=ddd', store);
      const { body } = accepts[0]!.briefing;

      expect(body).toBe(
        briefingOf(missionNumber, [
          'This job has two parts. We pay for both or for neither.',
          '',
          `First, leave a listener on the machine on the edge of their network, on port ${port}.`,
          'Then wipe their records of everyone they want arrested.',
          'The records are on a machine inside their network, not on the edge.',
          '',
          'Write to this address with your wallet address once both are done.',
          'Both done or no money. No wallet, no money.',
        ]),
      );
      for (const { name } of missionRecords(missionNumber).tables) {
        expect(body).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
    });

    it('writes a briefing asking for a listener on the edge and the machine inside taken down', async () => {
      const { store, accepts } = boardStore({ offers: [{ number: CHAIN, ref: 'ddd' }] });
      const terms = missionTerms(CHAIN);
      const { role, port } = chainJob(CHAIN);

      await accept('offer=ddd', store);

      expect(accepts[0]!.briefing.subject).toBe(`Contract: ${terms.targetCompany}`);
      expect(accepts[0]!.briefing.body).toBe(
        [
          terms.pitch,
          '',
          `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(CHAIN)}.`,
          '',
          'This job has two parts. We pay for both or for neither.',
          '',
          `First, leave a listener on the machine on the edge of their network, on port ${port}.`,
          `Then take their ${role.noun} offline. It is a machine inside their network, not on the edge.`,
          '',
          'Write to this address with your wallet address once both are done.',
          'Both done or no money. No wallet, no money.',
          '',
          `-- ${terms.client.company}`,
          '',
        ].join('\n'),
      );
      expect(accepts[0]!.briefing.attachment).toBeUndefined();
    });

    it('names no hostname and no address but the network', async () => {
      const { store, accepts } = boardStore({ offers: [{ number: CHAIN, ref: 'eee' }] });
      const { stem } = missionShape(CHAIN);

      await accept('offer=eee', store);
      const { body } = accepts[0]!.briefing;

      expect(body).not.toContain(`${stem}-`);
      expect(body.match(/\d+\.\d+\.\d+\.\d+/g)).toEqual([missionAddressForNumber(CHAIN)]);
    });
  });
});

describe('dropping the current contract', () => {
  it('drops the contract held and says the client will not be in touch', async () => {
    const { store, drops } = boardStore({ current: FOURTH });
    const company = missionTerms(FOURTH).client.company;

    const page = await drop(store);

    expect(drops.map((asked) => asked.number)).toEqual([FOURTH]);
    expect(alertOf(page)).toBe(`Contract dropped. ${company} will not be in touch again.`);
    expect(textOf(page)).not.toContain('Current contract');
    expect(answeredForm(page)).toBe('top');
  });

  it('has the client mail one short line about it', async () => {
    const { store, drops } = boardStore({ current: FOURTH });
    const terms = missionTerms(FOURTH);

    await drop(store);
    const { line } = drops[0]!;

    expect(line.sender).toBe(`${terms.client.handle}@emailit.io`);
    expect(line.subject).toBe(`Contract: ${terms.targetCompany}`);
    expect(line.body).toContain(`-- ${terms.client.company}`);
    expect(line.body).toBe(
      ['Understood. We will not be in touch again.', '', `-- ${terms.client.company}`, ''].join(
        '\n',
      ),
    );
  });

  it.each([
    ['the form says nothing', ''],
    ['the form says something other than yes', 'confirm=no'],
  ])('asks first, dropping nothing, when %s', async (_why, form) => {
    const { store, drops } = boardStore({ current: FOURTH });
    const company = missionTerms(FOURTH).client.company;

    const page = await drop(store, form);

    expect(drops).toEqual([]);
    expect(textOf(page)).toContain(`${company} will not be in touch again.`);
    expect(textOf(page)).not.toContain('Contract dropped.');
  });

  it('says there is nothing to drop, asking nothing, when no contract is held', async () => {
    const { store, drops } = boardStore();

    const page = await drop(store, '');

    expect(drops).toEqual([]);
    expect(alertOf(page)).toBe('You have no current contract.');
  });

  it('says there is nothing to drop, asking the store nothing, when no contract is held', async () => {
    const { store, drops } = boardStore();

    const page = await drop(store);

    expect(drops).toEqual([]);
    expect(alertOf(page)).toBe('You have no current contract.');
  });

  it('says there is nothing to drop when the store finds it already gone', async () => {
    const { store } = boardStore({ current: FOURTH });

    const page = await drop({ ...store, drop: async () => ({ data: 'no_contract', error: null }) });

    expect(alertOf(page)).toBe('You have no current contract.');
  });

  it.each([
    ['the store failed', { data: null, error: new Error('down') }],
    ['the store answered a word it was never taught', { data: 'maybe', error: null }],
  ])('answers nothing when %s', async (_why, reply) => {
    const { store } = boardStore({ current: FOURTH });

    expect(await drop({ ...store, drop: async () => reply })).toBeNull();
  });

  it('answers nothing when the board cannot be read', async () => {
    expect(await drop(failing)).toBeNull();
  });

  it('answers nothing when the board cannot be read again after dropping', async () => {
    const { store, drops } = boardStore({ current: FOURTH });

    expect(await drop(downAfterFirstRead(store))).toBeNull();
    expect(drops).toHaveLength(1);
  });
});
