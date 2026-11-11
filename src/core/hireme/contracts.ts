/**
 * A contractor board's three doors: reading it, accepting an offer, and dropping the
 * current contract.
 *
 * SERVER ONLY by discipline, as the board page and the terms are.
 *
 * Every door reads the board first, and reading tops it up: the store burns offers older
 * than a day and posts candidates until the offers and the current job fill three slots,
 * all in one transaction under the handle's lock, then answers with the board as it now
 * stands. The candidates are drawn here, from the server's randomness, and a number or ref
 * somebody already holds is skipped by the store, so a board still short after a read is
 * offered fresh draws until it fills or the draws run out.
 *
 * Accepting finds the offer by the ref the form posted among the offers just read, builds
 * the briefing from its number, and asks the store to take it; the store checks again under
 * the lock, so an offer that turned over in between is refused as gone, never swapped.
 * Dropping finds the current job the same way. A store that failed, or answered a word
 * nobody taught it, has not said what happened, so the door answers nothing rather than a
 * page that would be a guess.
 */

import { z } from 'zod';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import { missionAddressForNumber } from '../missions/missionNetwork.js';
import { missionTopology } from '../missions/missionShape.js';
import { missionRecords } from '../missions/missionRecords.js';
import { missionTerms, type MissionTerms } from '../missions/missionTerms.js';
import { contractBoardPage, type BoardNotice } from './contractBoard.js';

export type OfferCandidate = {
  readonly number: number;
  readonly ref: string;
};

/** A mail the store delivers as system mail, in the same step as what it is about. */
export type ContractMail = {
  readonly sender: string;
  readonly subject: string;
  readonly body: string;
};

type StoreReply = Promise<{ readonly data: unknown; readonly error: unknown }>;

export type BoardStore = {
  /** Top the board up from the candidates and answer with it as it now stands. */
  readonly postOffers: (request: {
    readonly handle: string;
    readonly candidates: readonly OfferCandidate[];
  }) => StoreReply;
  /** Take the offer numbered `number`, delivering the briefing: `accepted`, `busy` (a job is
   *  already held) or `gone` (it is no longer this handle's offer). */
  readonly accept: (request: {
    readonly handle: string;
    readonly number: number;
    readonly briefing: ContractMail;
  }) => StoreReply;
  /** Abandon the job numbered `number`, delivering the client's line: `dropped`, or
   *  `no_contract` when it is not the job held. */
  readonly drop: (request: {
    readonly handle: string;
    readonly number: number;
    readonly line: ContractMail;
  }) => StoreReply;
};

/** Where a door is, and how fresh offers are drawn for it. */
type BoardDoor = {
  readonly handle: string;
  /** The board's own address. */
  readonly address: string;
  readonly store: BoardStore;
  /** A contract number nobody may guess. */
  readonly drawNumber: () => number;
  /** A ref for an offer, as its form posts it. */
  readonly drawRef: () => string;
};

const boardSchema = z.object({
  offers: z.array(z.object({ number: z.number().int(), ref: z.string() })),
  current: z.number().int().nullable(),
});

type HeldBoard = z.infer<typeof boardSchema>;

const acceptOutcomeSchema = z.enum(['accepted', 'busy', 'gone']);
const dropOutcomeSchema = z.enum(['dropped', 'no_contract']);

/** Offers plus the current job: what a board holds when it is full. */
const BOARD_SLOTS = 3;

/** How many rounds of fresh draws a short board is offered. Collisions are rare enough that
 *  running out leaves a board briefly short, never broken. */
const MAX_DRAWS = 5;

const BUSY = 'Finish or drop your current contract first';
const GONE = 'That offer is no longer available.';
const NO_CONTRACT = 'You have no current contract.';

const slotsHeld = (held: HeldBoard): number => held.offers.length + (held.current === null ? 0 : 1);

/** The board after topping it up, or null when the store did not say. */
const readBoard = async (door: BoardDoor): Promise<HeldBoard | null> => {
  let held: HeldBoard | null = null;
  for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
    const candidates = Array.from({ length: BOARD_SLOTS }, () => ({
      number: door.drawNumber(),
      ref: door.drawRef(),
    }));
    const reply = await door.store.postOffers({ handle: door.handle, candidates });
    const read = boardSchema.safeParse(reply.data);
    if (reply.error || !read.success) return null;
    held = read.data;
    if (slotsHeld(held) >= BOARD_SLOTS) break;
  }
  return held;
};

const pageOf = (door: BoardDoor, held: HeldBoard, notice?: BoardNotice): string =>
  contractBoardPage({
    handle: door.handle,
    address: door.address,
    current: held.current === null ? null : missionTerms(held.current),
    offers: held.offers.map(({ number, ref }) => ({ ref, terms: missionTerms(number) })),
    ...(notice === undefined ? {} : { notice }),
  });

/** Read the board again and show it with what the form just did, or null when the store
 *  did not say. */
const reread = async (door: BoardDoor, notice: BoardNotice): Promise<string | null> => {
  const held = await readBoard(door);
  return held === null ? null : pageOf(door, held, notice);
};

const clientAddress = (terms: MissionTerms): string => `${terms.client.handle}@${EMAILIT_DOMAIN}`;

const subjectOf = (terms: MissionTerms): string => `Contract: ${terms.targetCompany}`;

/** What a two-hop briefing adds: that much and no more, since working out what "inside"
 *  means is the job. It names no machine, route or address. */
const insideLines = (what: string): readonly string[] => [
  `${what} on a machine inside their network, not on the edge.`,
  '',
];

/** What the job is and how it is paid: a key fetched and mailed back, or a record changed or
 *  erased and the client told. A tamper job names whose record and what it should say, or that
 *  it should not exist, never where. */
const jobLines = (
  missionNumber: number,
  terms: MissionTerms,
  inside: boolean,
): readonly string[] => {
  if (terms.job === 'tamper') {
    const { target } = missionRecords(missionNumber);
    return [
      target.action === 'erase'
        ? `There is a failing ${target.subject} grade for ${target.student}. It should not exist.`
        : `Their records give ${target.student} a ${target.from} in ${target.subject}. It should be a ${target.to}.`,
      '',
      ...(inside ? insideLines('The records are') : []),
      'Mail this address when it is done, with your wallet address.',
      'No change, no money. No wallet, no money.',
    ];
  }
  return [
    `Somewhere on it is the key to ${terms.keyOpens}. It looks like this:`,
    '',
    '  ACCESS-XXXX-XXXX-XXXX',
    '',
    ...(inside ? insideLines('The key is') : []),
    'Reply to this address with the key and your wallet address.',
    'No key, no money. No wallet, no money.',
  ];
};

const briefingOf = (missionNumber: number): ContractMail => {
  const terms = missionTerms(missionNumber);
  const inside = missionTopology(missionNumber).frontBoxOctet !== null;
  return {
    sender: clientAddress(terms),
    subject: subjectOf(terms),
    body: [
      terms.pitch,
      '',
      `The target is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(missionNumber)}.`,
      '',
      ...jobLines(missionNumber, terms, inside),
      '',
      `-- ${terms.client.company}`,
      '',
    ].join('\n'),
  };
};

const dropLineOf = (missionNumber: number): ContractMail => {
  const terms = missionTerms(missionNumber);
  return {
    sender: clientAddress(terms),
    subject: subjectOf(terms),
    body: ['Understood. We will not be in touch again.', '', `-- ${terms.client.company}`, ''].join(
      '\n',
    ),
  };
};

/** The board, topped up, or null when the store could not say what it holds. */
export const answerContractBoard = async (door: BoardDoor): Promise<string | null> => {
  const held = await readBoard(door);
  return held === null ? null : pageOf(door, held);
};

/** The board after accepting the offer the form names, or null when the store could not
 *  say what happened. */
export const answerAccept = async ({
  form,
  ...door
}: BoardDoor & {
  /** The request body exactly as sent. */
  readonly form: string;
}): Promise<string | null> => {
  const held = await readBoard(door);
  if (held === null) return null;

  const ref = new URLSearchParams(form).get('offer') ?? '';
  const offer = held.offers.find((candidate) => candidate.ref === ref);
  if (offer === undefined) return pageOf(door, held, { message: GONE, under: { offer: ref } });

  const reply = await door.store.accept({
    handle: door.handle,
    number: offer.number,
    briefing: briefingOf(offer.number),
  });
  const outcome = acceptOutcomeSchema.safeParse(reply.data);
  if (reply.error || !outcome.success) return null;
  if (outcome.data === 'busy') return reread(door, { message: BUSY, under: { offer: ref } });
  if (outcome.data === 'gone') return reread(door, { message: GONE, under: { offer: ref } });
  const company = missionTerms(offer.number).client.company;
  return reread(door, {
    message: `Contract accepted. ${company} has sent you a briefing.`,
    under: 'contract',
  });
};

/** The board after dropping the current contract, or null when the store could not say what
 *  happened. */
export const answerDrop = async (door: BoardDoor): Promise<string | null> => {
  const held = await readBoard(door);
  if (held === null) return null;
  if (held.current === null) return pageOf(door, held, { message: NO_CONTRACT, under: 'contract' });

  const reply = await door.store.drop({
    handle: door.handle,
    number: held.current,
    line: dropLineOf(held.current),
  });
  const outcome = dropOutcomeSchema.safeParse(reply.data);
  if (reply.error || !outcome.success) return null;
  if (outcome.data === 'no_contract')
    return reread(door, { message: NO_CONTRACT, under: 'contract' });
  const company = missionTerms(held.current).client.company;
  return reread(door, {
    message: `Contract dropped. ${company} will not be in touch again.`,
    under: 'contract',
  });
};
