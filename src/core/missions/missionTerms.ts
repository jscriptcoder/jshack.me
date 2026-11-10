/**
 * A contract's terms — who is hiring, against whom, why, what the key opens and what it
 * pays — a pure function of its number, as the network's shape is.
 *
 * SERVER ONLY by discipline: the offers, the briefing and the client handles are the
 * server's prose and never ship in the bundle. Only the server's fetch handler, emailit's
 * sign-up and `scripts/` import this module.
 *
 * The terms are drawn on a stream of their own, so adding a pool here never shifts the
 * network a number generates. The target company is the one exception: it is named after
 * the shape's stem, so a briefing against "Halden Logistics" leads to `halden-gw` and
 * `halden-files`, and the company and the hostnames read as one business.
 *
 * A client writes from a throwaway emailit.io handle of its own. Every handle in the pool
 * is reserved from sign-up, so no player can register as a client, and each fits the
 * handle alphabet, since the proof of a job is mailed to it and `mail` sends only to a
 * valid handle.
 */

import { createPrng } from '../generation/prng.js';
import { missionTopology } from './missionShape.js';

export type MissionClient = {
  readonly company: string;
  readonly handle: string;
};

export type MissionTerms = {
  readonly client: MissionClient;
  /** The company owning the network, named after the stem its boxes carry. */
  readonly targetCompany: string;
  /** The kind of job, as an offer names it. */
  readonly kind: string;
  /** One line of why the client wants it. */
  readonly pitch: string;
  /** What the key gives its holder, as the briefing names it. */
  readonly keyOpens: string;
  /** In JSC, a multiple of 50. */
  readonly pay: number;
};

const CLIENTS: readonly MissionClient[] = [
  { company: 'Copper Systems', handle: 'copper-ops' },
  { company: 'Bellwether Group', handle: 'bellwether-desk' },
  { company: 'Ashgrove Capital', handle: 'ashgrove-it' },
  { company: 'Greyline Consulting', handle: 'greyline-jobs' },
  { company: 'Marlowe Freight', handle: 'marlowe-ops' },
  { company: 'Orchard Labs', handle: 'orchard-sec' },
  { company: 'Redfern Media', handle: 'redfern-contracts' },
  { company: 'Saltmarsh Energy', handle: 'saltmarsh-it' },
  { company: 'Wexley Partners', handle: 'wexley-desk' },
  { company: 'Pinecrest Health', handle: 'pinecrest-it' },
];

/** Every client handle, for emailit.io to keep from sign-up. */
export const CLIENT_HANDLES: readonly string[] = CLIENTS.map((client) => client.handle);

/** The client writing from this handle, or null for a handle no client holds. */
export const clientByHandle = (handle: string): MissionClient | null =>
  CLIENTS.find((client) => client.handle === handle) ?? null;

/** What a target company does, after its stem: "Halden Logistics". */
const TARGET_TRADES: readonly string[] = [
  'Logistics',
  'Holdings',
  'Records',
  'Analytics',
  'Medical',
  'Engineering',
  'Insurance',
  'Telecom',
];

/** The same mechanics in two moral lights: black-hat (a rival has it) and grey (it is
 *  ours, or near enough, and we cannot get at it). */
const PITCHES: readonly string[] = [
  'A rival is sitting on something of ours. We want the key to it.',
  'They outbid us on a contract they cannot deliver. We would like to see their books.',
  'A competitor is about to undercut us. We need to know by how much.',
  'Our admin quit and took the only copy. The box is theirs now, the data is not.',
  'We sold the company and kept the obligations. The new owners stopped answering.',
  'An old supplier holds our records hostage over an invoice we already paid.',
];

const KEY_OPENS: readonly string[] = [
  'the billing API',
  'the payroll export',
  'the backup vault',
  'the customer records',
  'the source repository',
  'the admin console',
];

/** What each template's job is, and what it pays, in JSC quoted to the nearest 50 as a
 *  freelance quote is. A key kept behind a second box is harder work, so the board names it
 *  and its pay starts where a single-hop job's tops out. */
const SINGLE_HOP = { kind: 'retrieve an access key', minPay: 500, maxPay: 2000 } as const;
const TWO_HOP = { kind: 'retrieve an internal access key', minPay: 2000, maxPay: 4000 } as const;

const PAY_STEP = 50;

const capitalised = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export const missionTerms = (missionNumber: number): MissionTerms => {
  const prng = createPrng(`mission-terms-${missionNumber}`);
  const { stem, frontBoxOctet } = missionTopology(missionNumber);
  const job = frontBoxOctet === null ? SINGLE_HOP : TWO_HOP;
  return {
    client: prng.pick(CLIENTS),
    targetCompany: `${capitalised(stem)} ${prng.pick(TARGET_TRADES)}`,
    kind: job.kind,
    pitch: prng.pick(PITCHES),
    keyOpens: prng.pick(KEY_OPENS),
    // The last draw on the stream, so a template's own range moves nothing drawn before it.
    pay: prng.nextInt(job.minPay / PAY_STEP, job.maxPay / PAY_STEP) * PAY_STEP,
  };
};
