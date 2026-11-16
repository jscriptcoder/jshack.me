/**
 * What a file job asks brought back: the item, the file's name and where it sits on the target,
 * and the bytes the client checks.
 *
 * SERVER ONLY by discipline, as the terms and the key are. The item, the name and the directory
 * are drawn from the number, as the key's path is, and kept off the wire for the same reason: a
 * player holding the bundle would otherwise read where the file sits before rooting the box.
 * The bytes are drawn from the deployment's secret, so nobody can make the file without taking
 * it.
 *
 * Six items, each a file of its own format. A render and a photo are jpegs and a contract a
 * pdf, rendered as the world's documents are (`documentFormats.ts`), so `strings` gives up
 * their Exif or Info as a real one would. A firmware image, a customer export and a key ring
 * are a readable header and then noise. Every character is one a copy carries unchanged
 * through the signed write and the TEXT column: Latin-1 above the range `strings` keeps,
 * printable ASCII, and only in a pdf a line break.
 *
 * No item sits in a user's home: its owner may remove a directory there without root, which
 * would lose the job for everyone without the box ever being rooted.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createPrng, type Prng } from '../generation/prng.js';
import { renderDocument } from '../generation/documentFormats.js';
import { CAMERAS } from '../generation/pools/shareFiles.js';
import { FIRST_NAMES_BY_INITIAL, SURNAMES } from '../generation/pools/people.js';
import { WORLD_EPOCH } from '../cve/worldClock.js';
import { missionKind, missionTopology } from './missionShape.js';

/** One kind of file a client can want, as the board and the briefing name it. */
export type MissionFileItem = {
  /** What the board calls it: "firmware image". */
  readonly noun: string;
  /** Who at the target keeps it, as the briefing says: "Their engineers keep …". */
  readonly keepers: string;
  /** Why a client wants it, in the two moral lights the other kinds' reasons are. */
  readonly pitches: readonly string[];
  /** Why a client wants its own version put in place of the company's, on an infiltrate job. */
  readonly infiltratePitches: readonly string[];
};

/** The job's file as the number draws it: its name and directory, and how its bytes are made
 *  from the secret's stream. */
type DrawnFile = {
  readonly name: string;
  readonly directory: string;
  readonly render: (secretPrng: Prng) => string;
};

type ItemSpec = MissionFileItem & {
  readonly draw: (prng: Prng, missionNumber: number) => DrawnFile;
};

/** Latin-1 from `¡` (0xA1) to `ÿ` (0xFF), less the soft hyphen, which reads as nothing: the
 *  characters the world's binaries are drawn from. */
const NOISE_CHARACTERS: readonly string[] = Array.from({ length: 0xff - 0xa1 + 1 }, (_, index) =>
  String.fromCharCode(0xa1 + index),
).filter((character) => character !== '\u00ad');

/** How long the noise after a header runs. */
const NOISE_LENGTH = { min: 1000, max: 3000 } as const;

/** A header `strings` finds, then noise whose length and every character the secret draws. */
const headed =
  (header: string) =>
  (secretPrng: Prng): string => {
    const length = secretPrng.nextInt(NOISE_LENGTH.min, NOISE_LENGTH.max);
    const noise = Array.from({ length }, () => secretPrng.pick(NOISE_CHARACTERS)).join('');
    return `${header}${noise}`;
  };

const DAY_MS = 86_400_000;

/** How far back the items' dates reach: the window a share's documents are dated in. */
const WINDOW_DAYS = 300;

/** A moment in working hours on one of the days before the world's epoch. */
const drawMoment = (prng: Prng): number => {
  const day = Math.floor(WORLD_EPOCH / DAY_MS) - prng.nextInt(1, WINDOW_DAYS);
  const seconds = prng.nextInt(7, 18) * 3600 + prng.nextInt(0, 59) * 60 + prng.nextInt(0, 59);
  return day * DAY_MS + seconds * 1000;
};

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** A person, drawn as the world's people are: a first name and a surname. */
const drawPerson = (prng: Prng): string => {
  const firstName = prng.pick(prng.pick(Object.values(FIRST_NAMES_BY_INITIAL)));
  return `${firstName} ${prng.pick([...SURNAMES.values()])}`;
};

const capitalised = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

/** The renderers a render's Exif names in a camera's place. Each part stands alone in a
 *  `strings` listing, as a camera's does. */
const RENDERERS: readonly { readonly make: string; readonly model: string }[] = [
  { make: 'Blender', model: 'Cycles' },
  { make: 'Luxion', model: 'KeyShot' },
  { make: 'Chaos', model: 'V-Ray' },
  { make: 'Autodesk', model: 'VRED Pro' },
];

const PROTOTYPE_RENDER: ItemSpec = {
  noun: 'prototype render',
  keepers: 'designers',
  pitches: [
    'Their new product launches next month. We would like to see it before the press does.',
    'That design is ours. Their lead designer drew it here before leaving us.',
    'We are bidding against them for the same retailer. We need to know what they are pitching.',
    'An investor asked us whether they are as far along as they claim. We would like to answer.',
  ],
  infiltratePitches: [],
  draw: (prng) => {
    const code = `${prng.pick(LETTERS)}${prng.pick(LETTERS)}${prng.nextInt(0, 9)}`;
    const stage = prng.pick(['final', 'v2', 'v3', 'approved', 'review']);
    const directory = prng.pick(['/srv/design', '/opt/cad/renders']);
    const { make, model } = prng.pick(RENDERERS);
    const takenAt = drawMoment(prng);
    const artist = drawPerson(prng);
    return {
      name: `${code}-render-${stage}.jpg`,
      directory,
      render: (secretPrng) =>
        renderDocument({ format: 'jpeg', make, model, takenAt, artist }, secretPrng),
    };
  },
};

const SITE_PHOTO: ItemSpec = {
  noun: 'site photo',
  keepers: 'surveyors',
  pitches: [
    'They swear the site was clean when the inspectors came. Their own photos will say otherwise.',
    'We are disputing their insurance claim. We want to see the damage as they saw it.',
    'They built on land we have a claim to. We need proof of when the work started.',
    'A buyer is asking about that site. We want to know what is really there before they do.',
  ],
  infiltratePitches: [],
  draw: (prng) => {
    const takenAt = drawMoment(prng);
    const { make, model } = prng.pick(CAMERAS);
    const directory = prng.pick(['/var/lib/uploads', '/srv/media/photos']);
    const date = new Date(takenAt);
    const day = `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
    const time = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
    return {
      name: `IMG_${day}_${time}.jpg`,
      directory,
      render: (secretPrng) =>
        renderDocument({ format: 'jpeg', make, model, takenAt, artist: null }, secretPrng),
    };
  },
};

const PROJECTS = [
  'harbour',
  'northgate',
  'riverside',
  'eastfield',
  'millbank',
  'westpier',
  'oakridge',
  'kingsway',
] as const;

const DEALS = ['bid', 'lease', 'merger', 'supply', 'nda'] as const;

/** How long after it was made a signed contract was last saved: the same afternoon. */
const LAST_SAVE_MS = 4 * 3600 * 1000;

const SIGNED_CONTRACT: ItemSpec = {
  noun: 'signed contract',
  keepers: 'lawyers',
  pitches: [
    'They undercut our bid by a margin nobody could make money on. We want to see the terms.',
    'Our partner signed with them behind our backs. We want the proof in writing.',
    'We think that deal breaks the exclusivity they promised us. We want to read it.',
    'Their lawyers are telling the court the deal never closed. The signed copy says it did.',
  ],
  infiltratePitches: [],
  draw: (prng) => {
    const project = prng.pick(PROJECTS);
    const deal = prng.pick(DEALS);
    const directory = prng.pick(['/srv/legal', '/var/archive/contracts']);
    const createdAt = drawMoment(prng);
    const modifiedAt = createdAt + prng.nextInt(0, LAST_SAVE_MS / 1000) * 1000;
    const title = `${capitalised(project)} ${deal === 'nda' ? 'NDA' : capitalised(deal)} (signed)`;
    const author = drawPerson(prng);
    return {
      name: `${project}-${deal}-signed.pdf`,
      directory,
      render: (secretPrng) =>
        renderDocument({ format: 'pdf', title, author, createdAt, modifiedAt }, secretPrng),
    };
  },
};

const FIRMWARE_IMAGE: ItemSpec = {
  noun: 'firmware image',
  keepers: 'engineers',
  pitches: [
    'Their new controller beat ours to market by a year. We would like to see how.',
    'We licensed them that firmware and they stopped paying. We want a copy of what they ship.',
    'Their update bricked our devices on a shared site. We need to know what it does.',
    'Our engineer left for their team, and our code went with them. We want to compare.',
  ],
  infiltratePitches: [
    'Their devices install whatever build sits on that server. We would like them to install ours.',
    'They shipped a controller copied from ours. Their next update will carry our build instead.',
    'We sell the fix for the fault our build brings. Their customers will be needing it soon.',
    'Their engineers trust that server. The next build they push should be one we wrote.',
  ],
  draw: (prng) => {
    const device = prng.pick(['ctl', 'plc', 'rtu', 'hmi', 'cam']);
    const version = [prng.nextInt(1, 5), prng.nextInt(0, 9), prng.nextInt(0, 20)].join('.');
    return {
      name: `${device}-fw-${version}.bin`,
      directory: prng.pick(['/opt/firmware', '/srv/releases']),
      render: headed(`FWIMG v${version} ${device}`),
    };
  },
};

const CUSTOMER_EXPORT: ItemSpec = {
  noun: 'customer export',
  keepers: 'salespeople',
  pitches: [
    'Their sales team keeps poaching our accounts. We want to know which ones are next.',
    'They are about to be bought, and their customer list is the price. We would like to know it first.',
    "We believe they are selling our customers' data. Their export will show whether our people are in it.",
    'A former employee took our client list to them. We want to see how much of it they kept.',
  ],
  infiltratePitches: [],
  draw: (prng) => {
    const month = new Date(drawMoment(prng));
    return {
      name: `customers-${pad(month.getUTCFullYear(), 4)}-${pad(month.getUTCMonth() + 1)}.dat`,
      directory: prng.pick(['/var/backups', '/srv/exports']),
      render: headed('CUSTDB01'),
    };
  },
};

const KEY_RING: ItemSpec = {
  noun: 'key ring',
  keepers: 'admins',
  pitches: [
    'Their admins sign every release with those keys. We would like to be able to as well.',
    'They locked us out of systems we paid for. Their key ring opens them again.',
    'We sold them hardware and they still owe us. Their keys are worth the debt to us.',
    'Someone inside asked us to audit them without telling their bosses. Bring us the keys.',
  ],
  infiltratePitches: [],
  draw: (prng, missionNumber) => ({
    name: 'keyring.dat',
    directory: prng.pick(['/root/.vault', `/etc/${missionTopology(missionNumber).stem}`]),
    render: headed('KEYRING v2'),
  }),
};

/** The six, in the order the item is drawn from. */
const ITEMS: readonly ItemSpec[] = [
  PROTOTYPE_RENDER,
  SITE_PHOTO,
  SIGNED_CONTRACT,
  FIRMWARE_IMAGE,
  CUSTOMER_EXPORT,
  KEY_RING,
];

/** On a stream of its own, so drawing the item moved nothing a number drew before. An
 *  infiltrate job slips in a firmware image. */
const itemSpecOf = (missionNumber: number): ItemSpec =>
  missionKind(missionNumber) === 'infiltrate'
    ? FIRMWARE_IMAGE
    : createPrng(`mission-file-item-${missionNumber}`).pick(ITEMS);

/** What the job asks for, as the board and the briefing name it. */
export const missionFileItem = (missionNumber: number): MissionFileItem => {
  const { noun, keepers, pitches, infiltratePitches } = itemSpecOf(missionNumber);
  return { noun, keepers, pitches, infiltratePitches };
};

const drawnFileOf = (missionNumber: number): DrawnFile =>
  itemSpecOf(missionNumber).draw(createPrng(`mission-file-${missionNumber}`), missionNumber);

/** The file's name, as the briefing gives it. */
export const missionFileName = (missionNumber: number): string => drawnFileOf(missionNumber).name;

/** Where the file sits on the target. */
export const missionFilePath = (missionNumber: number): string => {
  const { directory, name } = drawnFileOf(missionNumber);
  return `${directory}/${name}`;
};

const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The job's file rendered from an HMAC of `label` under the secret. */
const renderUnder = (missionNumber: number, secret: string, label: string): string => {
  const seed = bytesToHex(hmac(sha256, encodeUtf8(secret), encodeUtf8(label)));
  return drawnFileOf(missionNumber).render(createPrng(seed));
};

/** The file the server lays on the target, under this deployment's secret: every byte the
 *  secret's own stream draws, from an HMAC of the number. */
export const missionFileContent = (missionNumber: number, secret: string): string =>
  renderUnder(missionNumber, secret, `file:${missionNumber}`);

/** The file an infiltrate job's client sends to be put in place of the company's: the same
 *  item, name and header, its bytes drawn from an HMAC of its own, so it is never the company's
 *  file and nobody makes it without the briefing that carries it. */
export const missionPlantContent = (missionNumber: number, secret: string): string =>
  renderUnder(missionNumber, secret, `infiltrate:${missionNumber}`);
