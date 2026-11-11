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
import { missionAddressForNumber } from '../missions/missionNetwork.js';
import { missionKeyPath } from '../missions/missionSecret.js';
import { missionShape } from '../missions/missionShape.js';
import { missionRecords } from '../missions/missionRecords.js';
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
const FIRST = 100000;
const SECOND = 100003;
const THIRD = 70000;
const FOURTH = 66051;

/** Contracts asking for a record changed rather than a key: a single-hop one and a two-hop
 *  one. The first two-hop number above is one too. */
const TAMPER_SINGLE_HOP = 70007;
const TAMPER_TWO_HOP = 70013;

/** Contracts asking for a record gone: a single-hop one and a two-hop one. */
const ERASE_SINGLE_HOP = 70003;
const ERASE_TWO_HOP = 70008;

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
  answerAccept({ handle: HANDLE, address: BOARD_ADDRESS, form, store, ...draws });

const drop = (store: BoardStore, draws = drawsFrom([FOURTH])) =>
  answerDrop({ handle: HANDLE, address: BOARD_ADDRESS, store, ...draws });

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
          `Their records give ${target.student} a ${target.from} in ${target.subject}. It should be a ${target.to}.`,
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
          `Their records give ${target.student} a ${target.from} in ${target.subject}. It should be a ${target.to}.`,
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
          `There is a failing ${target.subject} grade for ${target.student}. It should not exist.`,
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
          `There is a failing ${target.subject} grade for ${target.student}. It should not exist.`,
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
