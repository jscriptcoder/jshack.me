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
import { sabotageRole } from './sabotageRoles.js';
import {
  missionAction,
  missionSetting,
  type RecordAction,
  type RecordSetting,
} from './missionRecords.js';

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
  | ({ readonly job: 'tamper' } & CommonTerms)
  | ({ readonly job: 'sabotage' } & CommonTerms);

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

/** What a tamper job pays: a record changed is a riskier ask than a key fetched, so it pays
 *  more on either hop count, and a record behind a second box starts where a single-hop one
 *  tops out. A record asked gone pays as one asked changed: the work and the check are as
 *  strict. */
const TAMPER_PAY = {
  singleHop: { minPay: 1000, maxPay: 2500 },
  twoHop: { minPay: 2500, maxPay: 5000 },
} as const;

/** What a setting's target is called after its stem ("Halden Academy"), what the board calls
 *  its records, and why a client wants one changed or gone, in the same two moral lights as a
 *  key job's. A setting that asks nothing gone has no erase pitches. */
type SettingTerms = {
  readonly institution: string;
  readonly noun: string;
  readonly pitches: Readonly<Record<RecordAction, readonly string[]>>;
};

const SETTING_TERMS: Readonly<Record<RecordSetting, SettingTerms>> = {
  school: {
    institution: 'Academy',
    noun: 'school',
    pitches: {
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
    },
  },
  police: {
    institution: 'Police Dept',
    noun: 'police',
    pitches: {
      change: [
        'Our client cannot cross a border with a warrant hanging over them. Close it.',
        'The warrant was served months ago and nobody updated the file. We will.',
        'A job offer depends on a background check coming back clean.',
        'Our client settled the matter in court. The police records never heard.',
      ],
      erase: [
        'An old warrant keeps turning up at traffic stops. Our client wants it gone for good.',
        'The warrant names the wrong person, and the department will not admit it.',
        'Our client is moving abroad next week. That warrant cannot follow them.',
      ],
    },
  },
  payroll: {
    institution: 'Holdings',
    noun: 'payroll',
    pitches: {
      change: [
        'Our client was promised a raise in writing. The payroll never got the memo.',
        'A mortgage application needs a bigger salary than our client is paid.',
        'Our client does twice the work of the person beside them, for less. Fix the number.',
        'A bonus was agreed and quietly forgotten. Put it in the salary.',
      ],
      erase: [],
    },
  },
  dmv: {
    institution: 'Motor Registry',
    noun: 'motor registry',
    pitches: {
      change: [
        'One more set of points and our client loses their licence. Bring them to zero.',
        'Our client drives for a living, and the points on their licence are costing work.',
        'An insurance renewal is due, and the premium follows the points.',
      ],
      erase: [
        'Our client was never behind the wheel that day. The offence should not be on record.',
        'A delivery job needs a clean licence by Monday. One offence has to go.',
        'The camera caught the wrong car. Our client wants the offence gone.',
      ],
    },
  },
  tournament: {
    institution: 'Esports League',
    noun: 'tournament',
    pitches: {
      change: [
        'A sponsor signs whoever tops the ladder. Our client needs a few hundred more points.',
        'The final seedings close tonight, and our client is one bracket short.',
        'A lag spike cost our client the match. The score should show what they earned.',
      ],
      erase: [
        'A rival is one score ahead of our client on the ladder. Take theirs off the board.',
        'That score was set with a cheat. The league will not act, so we will.',
        'Our client loses a sponsorship to one entry on that ladder. Make it vanish.',
      ],
    },
  },
  admissions: {
    institution: 'University',
    noun: 'admissions',
    pitches: {
      change: [
        'Our client was rejected by one vote. The decision should go the other way.',
        'A family has paid for a place that the admissions office will not give.',
        'The rejection was a clerical error, and the deadline to appeal has passed.',
      ],
      erase: [
        'There is one place on the course and two people after it. Our client wants the other gone.',
        'A rival applicant is ahead of our client in the queue. They should not be in it.',
        'One application stands between our client and a place. Remove it.',
      ],
    },
  },
  club: {
    institution: 'Members Club',
    noun: 'club',
    pitches: {
      change: [
        'Our client wants into the club before their birthday. The age on file says no.',
        'A member is a few years too young for the bar. The list should say otherwise.',
        'The door checks the members list, not the passport. Make the list agree.',
      ],
      erase: [
        'Our client was banned over a misunderstanding. The ban should not exist.',
        'A ban keeps our client out of the one room where the deals are made.',
        'The owner banned our client to settle a grudge. Take the ban off the list.',
      ],
    },
  },
  registry: {
    institution: 'Vehicle Registry',
    noun: 'vehicle registry',
    pitches: {
      change: [
        'A car changed hands for cash and the paperwork never followed. Fix the owner.',
        'Our client bought a car the registry still says belongs to someone else.',
        'An inheritance dispute is holding up a car our client already owns.',
      ],
      erase: [
        'Our client bought that car in good faith. The stolen flag is not their problem.',
        'A stolen flag on a car our client is selling has stopped the sale.',
        'The car was recovered weeks ago. Nobody took the flag off, so we will.',
      ],
    },
  },
};

/** The board line for a tamper job: what it does to which setting's records, and `internal`
 *  for one behind a second box. */
const tamperKind = (action: RecordAction, noun: string, singleHop: boolean): string => {
  const verb = action === 'erase' ? 'erase' : 'alter';
  if (!singleHop) return `${verb} an internal ${noun} record`;
  return `${verb} ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun} record`;
};

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
    const { institution, noun, pitches } = SETTING_TERMS[missionSetting(missionNumber)];
    return {
      job: 'tamper',
      client: prng.pick(CLIENTS),
      targetCompany: `${capitalised(stem)} ${institution}`,
      kind: tamperKind(action, noun, singleHop),
      // One draw from any list, so every setting's pay is drawn where the school's was.
      pitch: prng.pick(pitches[action]),
      pay: payFrom(prng, TAMPER_PAY[singleHop ? 'singleHop' : 'twoHop']),
    };
  }
  const job = singleHop ? SINGLE_HOP : TWO_HOP;
  if (missionKind(missionNumber) === 'sabotage') {
    const { noun, pitches } = sabotageRole(missionNumber);
    return {
      job: 'sabotage',
      client: prng.pick(CLIENTS),
      targetCompany: `${capitalised(stem)} ${prng.pick(TARGET_TRADES)}`,
      kind: `take down ${singleHop ? 'a' : 'an internal'} ${noun}`,
      pitch: prng.pick(pitches),
      // The work is a key job's, finding the way in and rooting the box, so the pay is too.
      pay: payFrom(prng, job),
    };
  }
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
