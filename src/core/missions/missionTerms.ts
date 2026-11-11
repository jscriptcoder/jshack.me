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
import { missionKind, missionTopology } from './missionShape.js';
import { missionAction, type RecordAction } from './missionRecords.js';

export type MissionClient = {
  readonly company: string;
  readonly handle: string;
};

/** What every contract's terms say, whatever the job. */
type CommonTerms = {
  readonly client: MissionClient;
  /** The company owning the network, named after the stem its boxes carry. */
  readonly targetCompany: string;
  /** The kind of job, as an offer names it. */
  readonly kind: string;
  /** One line of why the client wants it. */
  readonly pitch: string;
  /** In JSC, a multiple of 50. */
  readonly pay: number;
};

/** A key job's terms name what the key opens; a tamper job's promise no key at all. The
 *  record a tamper job asks changed or gone is drawn with its records, not here. */
export type MissionTerms =
  | ({ readonly job: 'key' } & CommonTerms & {
        /** What the key gives its holder, as the briefing names it. */
        readonly keyOpens: string;
      })
  | ({ readonly job: 'tamper' } & CommonTerms);

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

/** What a template's job is called on the board and the range its pay is drawn from. */
type JobTerms = { readonly kind: string; readonly minPay: number; readonly maxPay: number };

/** A record changed is a riskier ask than a key fetched, so it pays more on either hop count,
 *  and a record behind a second box starts where a single-hop one tops out. A record asked gone
 *  pays as one asked changed: the work and the check are as strict. */
const TAMPER_JOBS: Readonly<Record<RecordAction, { singleHop: JobTerms; twoHop: JobTerms }>> = {
  change: {
    singleHop: { kind: 'alter a school record', minPay: 1000, maxPay: 2500 },
    twoHop: { kind: 'alter an internal school record', minPay: 2500, maxPay: 5000 },
  },
  erase: {
    singleHop: { kind: 'erase a school record', minPay: 1000, maxPay: 2500 },
    twoHop: { kind: 'erase an internal school record', minPay: 2500, maxPay: 5000 },
  },
};

/** Why a client wants a school's record changed or gone, in the same two moral lights as a key
 *  job's: a grade raised, or a failing grade that should not exist at all. */
const SCHOOL_PITCHES: Readonly<Record<RecordAction, readonly string[]>> = {
  change: [
    'A scholarship hangs on one grade. Our client would like it to hang the other way.',
    'A parent is paying well for a report card that reads better than the truth.',
    'One failing grade keeps our client off the team. It should not be failing.',
    'An admissions offer depends on a transcript that is one grade short.',
    'A teacher marked our client down out of spite. We are correcting that.',
    'The grade was entered wrong and the school will not fix it. We will.',
  ],
  erase: [
    'One failing grade stands between our client and graduation. It should not be there.',
    'A failed exam our client never sat is on their record. We want it gone.',
    'Our client needs a clean transcript by the end of the month. One line has to go.',
    'A failing mark is costing our client a place on the course. Make it disappear.',
  ],
};

/** What a school is called, after its stem: "Halden Academy". */
const SCHOOL_NAME = 'Academy';

const PAY_STEP = 50;

const payFrom = (
  prng: ReturnType<typeof createPrng>,
  job: { readonly minPay: number; readonly maxPay: number },
): number => prng.nextInt(job.minPay / PAY_STEP, job.maxPay / PAY_STEP) * PAY_STEP;

const capitalised = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export const missionTerms = (missionNumber: number): MissionTerms => {
  const prng = createPrng(`mission-terms-${missionNumber}`);
  const { stem, frontBoxOctet } = missionTopology(missionNumber);
  const singleHop = frontBoxOctet === null;
  if (missionKind(missionNumber) === 'tamper') {
    const action = missionAction(missionNumber);
    const job = TAMPER_JOBS[action][singleHop ? 'singleHop' : 'twoHop'];
    return {
      job: 'tamper',
      client: prng.pick(CLIENTS),
      targetCompany: `${capitalised(stem)} ${SCHOOL_NAME}`,
      kind: job.kind,
      // One draw from either list, so an erase job's pay is drawn where a change job's is.
      pitch: prng.pick(SCHOOL_PITCHES[action]),
      pay: payFrom(prng, job),
    };
  }
  const job = singleHop ? SINGLE_HOP : TWO_HOP;
  return {
    job: 'key',
    client: prng.pick(CLIENTS),
    targetCompany: `${capitalised(stem)} ${prng.pick(TARGET_TRADES)}`,
    kind: job.kind,
    pitch: prng.pick(PITCHES),
    keyOpens: prng.pick(KEY_OPENS),
    // The last draw on the stream, so a template's own range moves nothing drawn before it.
    pay: payFrom(prng, job),
  };
};
