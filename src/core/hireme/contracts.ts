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
import { missionAddressForNumber, missionEssid } from '../missions/missionNetwork.js';
import { chainFinal, missionShape, missionTopology } from '../missions/missionShape.js';
import { lanSubnetPrefix } from '../network/lanAddress.js';
import { whiteHatWord } from '../missions/whiteHatLogin.js';
import {
  missionRecords,
  missionSetting,
  type RecordSetting,
  type RecordTarget,
} from '../missions/missionRecords.js';
import { missionTerms, type MissionTerms } from '../missions/missionTerms.js';
import {
  backdoorJob,
  chainJob,
  cleanupJob,
  credentialRole,
  sabotageRole,
} from '../missions/targetRoles.js';
import { portforwardJob } from '../missions/portforwardJob.js';
import {
  missionFileItem,
  missionFileName,
  missionFilePath,
  missionPlantContent,
} from '../missions/missionFileItem.js';
import { contractBoardPage, dropContractPage, type BoardNotice } from './contractBoard.js';

export type OfferCandidate = {
  readonly number: number;
  readonly ref: string;
};

/** A mail the store delivers as system mail, in the same step as what it is about. */
export type ContractMail = {
  readonly sender: string;
  readonly subject: string;
  readonly body: string;
  /** The one file the mail carries: an infiltrate job's briefing carries the client's own. */
  readonly attachment?: { readonly name: string; readonly content: string };
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

/** A grade as it is said aloud: "an A", "a B". */
const aGrade = (grade: string): string => `${grade === 'A' || grade === 'F' ? 'an' : 'a'} ${grade}`;

/** How a briefing names the record a change job is about, in its setting's words: whose it is,
 *  what it says now and what it should say. */
const CHANGE_SENTENCES: Readonly<
  Record<RecordSetting, (at: (column: string) => string, from: string, to: string) => string>
> = {
  school: (at, from, to) =>
    `Their records give ${at('student')} ${aGrade(from)} in ${at('subject')}. It should be ${aGrade(to)}.`,
  police: (at, _from, to) =>
    `Their records hold an active warrant for ${at('name')}, for ${at('offence')}. It should read ${to}.`,
  payroll: (at, from, to) => `They pay ${at('name')} ${from} a year. It should be ${to}.`,
  dmv: (at, from, to) =>
    `Their records give ${at('name')} ${from} points for ${at('offence')}. It should be ${to}.`,
  tournament: (at, from, to) =>
    `Their league has ${at('player')} on ${from} in ${at('game')}. It should read ${to}.`,
  admissions: (at, _from, to) =>
    `Their records have ${at('name')} rejected for ${at('program')}. It should read ${to}.`,
  club: (at, from, to) => `The club has ${at('name')} down as ${from}. It should say ${to}.`,
  registry: (at, from, to) =>
    `Their registry has ${at('plate')} registered to ${from}. It should be registered to ${to}.`,
};

/** How a briefing names the record an erase job is about, and that it should not exist. A
 *  setting that never asks a record gone has no sentence for it. */
const ERASE_SENTENCES: Readonly<Record<RecordSetting, (at: (column: string) => string) => string>> =
  {
    school: (at) =>
      `There is a failing ${at('subject')} grade for ${at('student')}. It should not exist.`,
    police: (at) =>
      `Their records hold an active warrant for ${at('name')}, for ${at('offence')}. It should not exist.`,
    payroll: () => '',
    dmv: (at) =>
      `Their records hold a ${at('offence')} offence against ${at('name')}. It should not exist.`,
    tournament: (at) =>
      `Their league has ${at('player')} on ${at('score')} in ${at('game')}. That score should not exist.`,
    admissions: (at) =>
      `Their records have ${at('name')} applying for ${at('program')}. That application should not exist.`,
    club: (at) => `The club has ${at('name')} banned. That ban should not exist.`,
    registry: (at) =>
      `Their registry flags ${at('plate')} as stolen. That record should not exist.`,
  };

/** What a wipe job's briefing says each setting's records hold, never the table they sit in:
 *  working out which of the three it means is part of the job. */
const WIPE_DESCRIPTIONS: Readonly<Record<RecordSetting, string>> = {
  school: 'what each student scored in each subject',
  police: 'everyone they want arrested',
  payroll: 'what they pay each of their people',
  dmv: 'the points held against each driver',
  tournament: 'what each player has racked up',
  admissions: 'everyone waiting on a place',
  club: 'everyone who belongs to the club',
  registry: 'who owns which car',
};

/** The sentence naming the record a tamper job is about: who, which field and old to new, or
 *  that it should not exist. Never the row's id, its table, its file or its box. */
const askedSentence = (setting: RecordSetting, target: RecordTarget): string => {
  const at = (column: string): string => `${target.row[column]}`;
  return target.action === 'erase'
    ? ERASE_SENTENCES[setting](at)
    : CHANGE_SENTENCES[setting](at, target.from, target.to);
};

/** A chain job's last step, in the words of the kind it borrows: the machine named, the file by its
 *  name, or the records by what they hold, each said to be inside and never where. */
const chainFinalLines = (missionNumber: number): readonly string[] => {
  const final = chainFinal(missionNumber);
  if (final === 'destroy') {
    const { keepers, noun } = missionFileItem(missionNumber);
    return [
      `Then get rid of a ${noun} their ${keepers} keep. Its name is:`,
      '',
      `  ${missionFileName(missionNumber)}`,
      '',
      ...insideLines('The file is'),
    ];
  }
  if (final === 'wipe') {
    return [
      `Then wipe their records of ${WIPE_DESCRIPTIONS[missionSetting(missionNumber)]}.`,
      ...insideLines('The records are'),
    ];
  }
  return [
    `Then take their ${chainJob(missionNumber).role.noun} offline. It is a machine inside their network, not on the edge.`,
    '',
  ];
};

/** What the job is and how it is paid: a key fetched and mailed back, a record changed or
 *  erased and the client told, a machine taken down and the client told, a file fetched and
 *  mailed back attached, a listener left on a machine and the client told while it listens, a
 *  port on the router sent to a machine and the client told while it is open, a machine's root
 *  password mailed back on a line of its own, a file destroyed and the client told, a table of
 *  records emptied and the client told, or a listener left on the front box and the machine behind
 *  it taken down, a file on it destroyed or its records emptied, and the client told. A tamper job
 *  names whose record and what it should say, or that it should not exist, never where; a sabotage,
 *  backdoor, credential, portforward or chain job names what the machine is, never which box; a file or
 *  destroy job names the file, never where it sits; a wipe job describes what the records hold,
 *  never their table, file or box. */
const jobLines = (
  missionNumber: number,
  terms: Exclude<MissionTerms, { readonly job: 'cleanup' }>,
  inside: boolean,
): readonly string[] => {
  if (terms.job === 'sabotage') {
    return [
      `Take their ${sabotageRole(missionNumber).noun} offline.`,
      '',
      // The machine is the job itself, so it is not "on" a machine as a key or records are.
      ...(inside ? ['It is a machine inside their network, not on the edge.', ''] : []),
      'Mail this address when it is done, with your wallet address.',
      'No outage, no money. No wallet, no money.',
    ];
  }
  if (terms.job === 'backdoor') {
    const { role, port } = backdoorJob(missionNumber);
    return [
      `We want a way into their ${role.noun} that stays open.`,
      // "A listener" is the whole hint: the briefing never names the tool that leaves one.
      `Leave a listener on it, on port ${port}.`,
      '',
      ...(inside ? ['It is a machine inside their network, not on the edge.', ''] : []),
      'Write to this address with your wallet address while it is listening.',
      'No listener, no money. No wallet, no money.',
    ];
  }
  if (terms.job === 'credential') {
    return [
      `Bring us the root login for their ${credentialRole(missionNumber).noun}.`,
      // Beside the machine it describes: after the sample line, "It" would read as the password.
      ...(inside ? ['It is a machine inside their network, not on the edge.'] : []),
      'Put the password on a line of its own, like this:',
      '',
      '  password: <the password>',
      '',
      'Reply to this address with that line and your wallet address.',
      'No login, no money. No wallet, no money.',
    ];
  }
  if (terms.job === 'portforward') {
    const { machine, publicPort } = portforwardJob(missionNumber);
    // The router is named, never which box it is or where its forwards are kept: finding the way
    // in, and the machine behind it, is the work.
    return [
      `We want to reach their ${machine.noun} from outside.`,
      `Their router should send port ${publicPort} to it, on ${machine.insidePort}.`,
      '',
      'Write to this address with your wallet address once it is open.',
      'No way in, no money. No wallet, no money.',
    ];
  }
  if (terms.job === 'infiltrate') {
    const { keepers, noun } = missionFileItem(missionNumber);
    return [
      `Their ${keepers} keep a ${noun}. We want ours in its place.`,
      'Put the attached file at:',
      '',
      `  ${missionFilePath(missionNumber)}`,
      '',
      ...(inside ? insideLines('The path is') : []),
      'Write to this address with your wallet address once it is there.',
      'No file in place, no money. No wallet, no money.',
    ];
  }
  if (terms.job === 'file') {
    const { keepers, noun } = missionFileItem(missionNumber);
    return [
      `Their ${keepers} keep a ${noun}. Bring it to us. Its name is:`,
      '',
      `  ${missionFileName(missionNumber)}`,
      '',
      ...(inside ? insideLines('The file is') : []),
      'Mail it to this address as an attachment, with your wallet address.',
      'No file, no money. No wallet, no money.',
    ];
  }
  if (terms.job === 'destroy') {
    const { keepers, noun } = missionFileItem(missionNumber);
    return [
      `Their ${keepers} keep a ${noun}. We want it gone. Its name is:`,
      '',
      `  ${missionFileName(missionNumber)}`,
      '',
      ...(inside ? insideLines('The file is') : []),
      'Write to this address with your wallet address once it is gone.',
      'Not gone, no money. No wallet, no money.',
    ];
  }
  if (terms.job === 'wipe') {
    return [
      // Never a warning off the two tables beside it: telling them apart is the job.
      `Their records hold ${WIPE_DESCRIPTIONS[missionSetting(missionNumber)]}. We want all of it gone.`,
      '',
      ...(inside ? insideLines('The records are') : []),
      'Mail this address when it is done, with your wallet address.',
      'Not wiped, no money. No wallet, no money.',
    ];
  }
  if (terms.job === 'chain') {
    // Every chain job is two-hop, so the machine is always inside, and the edge box is named by
    // where it stands, never by what it is.
    return [
      'This job has two parts. We pay for both or for neither.',
      '',
      `First, leave a listener on the machine on the edge of their network, on port ${chainJob(missionNumber).port}.`,
      ...chainFinalLines(missionNumber),
      'Write to this address with your wallet address once both are done.',
      'Both done or no money. No wallet, no money.',
    ];
  }
  if (terms.job === 'tamper') {
    const { setting, target } = missionRecords(missionNumber);
    return [
      askedSentence(setting, target),
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

/** The logins a cleanup job's client hands over, or null when the deployment cannot give the
 *  words: the edge machine's through the gateway's `:2222`, and on two hops the machine inside,
 *  named for what it is, on its own `:22` at its address on the contract's LAN. */
const cleanupLoginLines = (
  missionNumber: number,
  rawSecrets: string | undefined,
): readonly string[] | null => {
  const { keyBox, frontBox } = missionShape(missionNumber);
  const address = missionAddressForNumber(missionNumber);
  const edgeWord = whiteHatWord((frontBox ?? keyBox).rootHash, rawSecrets);
  if (edgeWord === null) return null;
  const edgeLogin = ['', `  ssh root@${address} -p 2222`, `  password: ${edgeWord}`, ''];
  if (frontBox === null) return ['They have given you root:', ...edgeLogin];
  const insideWord = whiteHatWord(keyBox.rootHash, rawSecrets);
  if (insideWord === null) return null;
  const inside = `${lanSubnetPrefix(missionEssid(missionNumber))}.${keyBox.octet}`;
  return [
    'They have given you root on the machine on the edge of their network:',
    ...edgeLogin,
    `The ${cleanupJob(missionNumber).role.noun} is inside their network, at ${inside}. From the edge machine:`,
    '',
    `  ssh root@${inside}`,
    `  password: ${insideWord}`,
    '',
  ];
};

/** A cleanup job's briefing past its opening: a symptom, the port something answers on, never
 *  the file behind it, then the logins, or null when the words cannot be given. Finding what runs
 *  it is the job, so it names no path, no tool and nothing of what was left. */
const cleanupLines = (
  missionNumber: number,
  rawSecrets: string | undefined,
): readonly string[] | null => {
  const logins = cleanupLoginLines(missionNumber, rawSecrets);
  if (logins === null) return null;
  const { role, port } = cleanupJob(missionNumber);
  const twoHop = missionTopology(missionNumber).frontBoxOctet !== null;
  return [
    `Something on their ${role.noun} answers on port ${port}, and nobody there put it there.`,
    'Find what runs it, stop it, and get it off the machine.',
    '',
    ...logins,
    twoHop
      ? 'Leave both machines running. If either no longer boots, there is no money.'
      : 'Leave the machine running. If it no longer boots, there is no money.',
    'Write to this address with your wallet address once it is gone.',
    'Still there, no money. No wallet, no money.',
  ];
};

/** The client's briefing, or null when it cannot be written: an infiltrate job's carries the
 *  client's file, drawn from the mission secret, and without the secret there is no file; a
 *  cleanup job's hands over words only the deployment's pools hold, and its target's files are
 *  laid from the mission secret, so without either there is no job to hand over. */
const briefingOf = (
  missionNumber: number,
  missionSecret: string | undefined,
  rawSecrets: string | undefined,
): ContractMail | null => {
  const terms = missionTerms(missionNumber);
  if (terms.job === 'cleanup') {
    const lines = missionSecret === undefined ? null : cleanupLines(missionNumber, rawSecrets);
    if (lines === null) return null;
    return {
      sender: clientAddress(terms),
      subject: subjectOf(terms),
      body: [
        terms.pitch,
        '',
        `Our customer is ${terms.targetCompany}. Their network is at ${missionAddressForNumber(missionNumber)}.`,
        '',
        ...lines,
        '',
        `-- ${terms.client.company}`,
        '',
      ].join('\n'),
    };
  }
  const inside = missionTopology(missionNumber).frontBoxOctet !== null;
  const attachment =
    terms.job !== 'infiltrate'
      ? undefined
      : missionSecret === undefined
        ? null
        : {
            name: missionFileName(missionNumber),
            content: missionPlantContent(missionNumber, missionSecret),
          };
  if (attachment === null) return null;
  return {
    ...(attachment === undefined ? {} : { attachment }),
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
  missionSecret,
  rawSecrets,
  ...door
}: BoardDoor & {
  /** The request body exactly as sent. */
  readonly form: string;
  /** The deployment's mission secret, which an infiltrate job's briefing draws its file from and
   *  a cleanup job's target its files; undefined when the deployment has none. */
  readonly missionSecret: string | undefined;
  /** The deployment's `JSHACK_SECRETS`, whose white-hat words a cleanup job's briefing hands
   *  over; undefined when the deployment has none. */
  readonly rawSecrets: string | undefined;
}): Promise<string | null> => {
  const held = await readBoard(door);
  if (held === null) return null;

  const ref = new URLSearchParams(form).get('offer') ?? '';
  const offer = held.offers.find((candidate) => candidate.ref === ref);
  if (offer === undefined) return pageOf(door, held, { message: GONE, under: { offer: ref } });

  const briefing = briefingOf(offer.number, missionSecret, rawSecrets);
  if (briefing === null) return null;
  const reply = await door.store.accept({ handle: door.handle, number: offer.number, briefing });
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
 *  happened. A form that does not say yes drops nothing: it is asked whether to. */
export const answerDrop = async ({
  form,
  ...door
}: BoardDoor & {
  /** The request body exactly as sent. */
  readonly form: string;
}): Promise<string | null> => {
  const held = await readBoard(door);
  if (held === null) return null;
  if (held.current === null) return pageOf(door, held, { message: NO_CONTRACT, under: 'contract' });
  if (new URLSearchParams(form).get('confirm') !== 'yes') {
    return dropContractPage(missionTerms(held.current));
  }

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
