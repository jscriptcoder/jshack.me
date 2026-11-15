/**
 * What a file job asks brought back: the item, the file's name and where it sits on the target,
 * and the bytes the client checks.
 *
 * SERVER ONLY by discipline, as the terms and the key are. The name and the directory are drawn
 * from the number, as the key's path is, and kept off the wire for the same reason: a player
 * holding the bundle would otherwise read where the file sits before rooting the box. The bytes
 * are drawn from the deployment's secret, so nobody can make the file without taking it.
 *
 * The file is a firmware image: a readable header `strings` finds, then noise. The noise is
 * Latin-1 above the range `strings` keeps, as the world's documents are made of
 * (`documentFormats.ts`), so the file survives the signed write and the TEXT column a copy goes
 * through, character for character.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createPrng } from '../generation/prng.js';

/** One kind of file a client can want, as the board and the briefing name it. */
export type MissionFileItem = {
  /** What the board calls it: "firmware image". */
  readonly noun: string;
  /** Why a client wants it, in the two moral lights the other kinds' reasons are. */
  readonly pitches: readonly string[];
};

/** The one item a file job asks for, so far. */
export const FIRMWARE_IMAGE: MissionFileItem = {
  noun: 'firmware image',
  pitches: [
    'Their new controller beat ours to market by a year. We would like to see how.',
    'We licensed them that firmware and they stopped paying. We want a copy of what they ship.',
    'Their update bricked our devices on a shared site. We need to know what it does.',
    'Our engineer left for their team, and our code went with them. We want to compare.',
  ],
};

/** The devices a firmware image is built for, as its name starts. */
const DEVICES = ['ctl', 'plc', 'rtu', 'hmi', 'cam'] as const;

/** Where a firmware image is kept on the target. */
const DIRECTORIES = ['/opt/firmware', '/srv/releases'] as const;

/** The job's file as the briefing and the box name it: its name, its directory and its
 *  version, the header inside it carrying the version too. */
type FileName = {
  readonly name: string;
  readonly directory: string;
  readonly device: string;
  readonly version: string;
};

const fileNameOf = (missionNumber: number): FileName => {
  const prng = createPrng(`mission-file-${missionNumber}`);
  const device = prng.pick(DEVICES);
  const version = [prng.nextInt(1, 5), prng.nextInt(0, 9), prng.nextInt(0, 20)].join('.');
  return {
    name: `${device}-fw-${version}.bin`,
    directory: prng.pick(DIRECTORIES),
    device,
    version,
  };
};

/** The file's name, as the briefing gives it. */
export const missionFileName = (missionNumber: number): string => fileNameOf(missionNumber).name;

/** Where the file sits on the target. */
export const missionFilePath = (missionNumber: number): string => {
  const { directory, name } = fileNameOf(missionNumber);
  return `${directory}/${name}`;
};

/** Latin-1 from `¡` (0xA1) to `ÿ` (0xFF), less the soft hyphen, which reads as nothing: the
 *  characters the world's binaries are drawn from. */
const NOISE_CHARACTERS: readonly string[] = Array.from({ length: 0xff - 0xa1 + 1 }, (_, index) =>
  String.fromCharCode(0xa1 + index),
).filter((character) => character !== '\u00ad');

/** How long the noise after the header runs. */
const NOISE_LENGTH = { min: 1000, max: 3000 } as const;

const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The file the server lays on the target, under this deployment's secret: the header, then
 *  noise whose length and every character come from an HMAC of the number. */
export const missionFileContent = (missionNumber: number, secret: string): string => {
  const { device, version } = fileNameOf(missionNumber);
  const seed = bytesToHex(hmac(sha256, encodeUtf8(secret), encodeUtf8(`file:${missionNumber}`)));
  const prng = createPrng(seed);
  const length = prng.nextInt(NOISE_LENGTH.min, NOISE_LENGTH.max);
  const noise = Array.from({ length }, () => prng.pick(NOISE_CHARACTERS)).join('');
  return `FWIMG v${version} ${device}${noise}`;
};
