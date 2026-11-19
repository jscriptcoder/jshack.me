/**
 * What a sabotage, backdoor, credential or chain job's target is: the machine the client wants taken
 * down for good, wants a way into that stays open, wants the root login of, or wants taken down
 * once a listener holds the front box before it. The role names the box,
 * so a contractor who lands on it can tell it is the one the briefing meant. The three kinds share
 * the machines, so a hostname alone never says which job a box is; each brings its own reasons.
 *
 * Nothing here is secret: like the rest of a contract's shape it ships in the bundle, and says
 * nothing about which contracts exist without the address.
 */

import { createPrng } from '../generation/prng.js';
import { missionKind } from './missionShape.js';
import { portforwardJob } from './portforwardJob.js';
import { KEY_BOX_SUFFIX } from './pools.js';

/** A machine a client can want taken down, want a way into, or want the root login of. */
export type TargetRole = {
  /** What the machine is, as the board and the briefing name it. */
  readonly noun: string;
  /** The suffix on the target's hostname, after the target company's stem. */
  readonly suffix: string;
  /** Why a client wants it down, one of which opens the briefing. */
  readonly sabotagePitches: readonly string[];
  /** Why a client wants a way into it that stays open, one of which opens a backdoor job's
   *  briefing. */
  readonly backdoorPitches: readonly string[];
  /** Why a client wants its root login, one of which opens a credential job's briefing. */
  readonly credentialPitches: readonly string[];
};

/** Every machine a client can want taken down, a way into or the root login of, each named for
 *  what it is and wanted for reasons of its own. */
const TARGET_ROLES: readonly TargetRole[] = [
  {
    noun: 'CCTV recorder',
    suffix: 'nvr',
    sabotagePitches: [
      'Their cameras caught our guy on Tuesday. The recorder goes down before anyone pulls the footage.',
      'Something happened in their car park last night that nobody wants on tape.',
      'Our client needs a week of their footage to have never existed.',
      'A delivery leaves their loading bay early next week. The cameras go first.',
    ],
    backdoorPitches: [
      'We want to see who comes and goes from their building, every day, for as long as it takes.',
      'Our client wants eyes on their loading bay without ever setting foot near it.',
      'Something leaves their warehouse at night. We want to watch it happen.',
    ],
    credentialPitches: [
      'Whoever holds that recorder login decides which footage exists. Our client wants to be that person.',
      'Our client needs the password to their camera system, and nobody there can know it is gone.',
      'A login to their recorder is worth more to our client than any one night of footage.',
    ],
  },
  {
    noun: 'backup server',
    suffix: 'backup',
    sabotagePitches: [
      'Our client wants them to have nothing to restore from.',
      'When their main systems go down next week, they should find the backups already gone.',
      'They keep every old version of everything. Some of those versions need to stop existing.',
    ],
    backdoorPitches: [
      'Every file they own passes through that box at night. We want to look whenever we like.',
      'Our client wants a copy of everything they keep, every week, without asking twice.',
      'When they delete something, the backup still has it. We want to read what they regret.',
    ],
    credentialPitches: [
      'Every copy of everything they own answers to one root password. We want it.',
      'Our client wants the login to their backups before the audit starts.',
      'Their backup server trusts one password. Our client would like to know it too.',
    ],
  },
  {
    noun: 'monitoring station',
    suffix: 'mon',
    sabotagePitches: [
      'Something is going to happen on their network this weekend. Nobody should be watching when it does.',
      'Their monitoring wakes someone up at 3am for anything odd. Our client needs a quiet night.',
      'Their alerts caught our last contractor. Not this time.',
    ],
    backdoorPitches: [
      'Their monitoring sees every machine they run. We want to see what it sees.',
      'Our client wants to know the moment their network has a bad night.',
      'That box knows which of their machines are weak. We would like to know too.',
    ],
    credentialPitches: [
      'Whoever logs in there decides what their admins get woken up for. Our client wants that login.',
      'Their monitoring answers to one root password. Bring it to us and we will do the rest.',
      'Our client wants to sign in to the box that watches all the others.',
    ],
  },
  {
    noun: 'build server',
    suffix: 'ci',
    sabotagePitches: [
      "They ship a release on Friday that undercuts our client. It doesn't ship if it can't build.",
      'Their launch is next week. Our client would like it to slip.',
      'Every update they push goes through that box. Our client wants a long pause.',
    ],
    backdoorPitches: [
      'Every release they ship is built on that box. Our client wants a look at each one before it goes out.',
      'Their source code passes through it every day. We want to read it at our leisure.',
      'Our client wants to know what they are building long before they announce it.',
    ],
    credentialPitches: [
      'With root on that box, our client can sign in whenever a release is being built.',
      'One password stands between our client and everything they ship. We want that password.',
      'Their engineers share the root login for that box. Our client would like a share of it.',
    ],
  },
  {
    noun: 'licence server',
    suffix: 'lic',
    sabotagePitches: [
      'Their whole office runs on software that checks in with that box every morning. Make the check fail.',
      'Our client wants them locked out of their own tools for a week.',
      'No licences, no seats. Their staff should find nothing opens on Monday.',
    ],
    backdoorPitches: [
      'That box knows every product they run and how many seats they paid for. Our client wants to keep count.',
      'Our client sells against them and wants to see what their office runs, month by month.',
      'Their licence server talks to every desk in the office each morning. A way in there is a way in everywhere.',
    ],
    credentialPitches: [
      'Our client wants to sign in to that box and hand out seats of its own.',
      'That password decides who in their office gets to work. Our client wants it.',
      'One login runs every licence they own. Our client means to hold it.',
    ],
  },
  {
    noun: 'door-access controller',
    suffix: 'access',
    sabotagePitches: [
      'Somebody needs to walk through their front door on Thursday without a badge.',
      "With that box down their doors fail open. That's all our client needs.",
      'A meeting happens in their building next week that the badge logs should never record.',
    ],
    backdoorPitches: [
      "Our client wants to open their doors on our own schedule, not on a badge's.",
      'Every badge swipe in their building lands on that box. We want to read them as they happen.',
      'A door that opens for us whenever we choose is worth more than any stolen badge.',
    ],
    credentialPitches: [
      'Whoever holds that login holds every door in the building. Our client wants to hold it.',
      'Our client wants the password behind their badge system, and wants it quietly.',
      'A stolen badge gets you through one door. That login gets you through all of them.',
    ],
  },
  {
    noun: 'billing server',
    suffix: 'billing',
    sabotagePitches: [
      'Their invoices go out on the first. Our client would like them not to.',
      "Month end is in a week. Without that box they can't charge anyone.",
      "Our client is their biggest customer, and this quarter's invoice should go missing.",
    ],
    backdoorPitches: [
      'We want to read every invoice they send, the day they send it.',
      'Our client wants to know who their customers are and what each one pays.',
      'Their prices change every quarter. Our client wants to see the new ones first.',
    ],
    credentialPitches: [
      'Our client wants to sign in to their billing whenever the invoices go out.',
      "The root password to their billing is worth a year of our client's margin.",
      'One login sits over every account they bill. Bring it to us.',
    ],
  },
];

/** The machine a sabotage job asks taken down, drawn on its own stream so nothing the
 *  contract drew before it moves. */
export const sabotageRole = (missionNumber: number): TargetRole =>
  createPrng(`mission-sabotage-role-${missionNumber}`).pick(TARGET_ROLES);

/** The machine a credential job wants the root login of, drawn on its own stream so nothing the
 *  contract drew before it moves. */
export const credentialRole = (missionNumber: number): TargetRole =>
  createPrng(`mission-credential-role-${missionNumber}`).pick(TARGET_ROLES);

/** The classic ports a backdoor job's client names for its listener. No service runs on any of
 *  them by default, so the target never already holds the one named. */
const BACKDOOR_PORTS = [1337, 4444, 5555, 6666, 7777, 9001, 12345, 31337] as const;

/** What a backdoor job asks for: a listener left on one machine, and the port it must hold. */
export type BackdoorJob = {
  readonly role: TargetRole;
  readonly port: number;
};

/** The machine a backdoor job wants a way into and the port its listener must hold, drawn on a
 *  stream of their own, the machine first, so nothing the contract drew before them moves. */
export const backdoorJob = (missionNumber: number): BackdoorJob => {
  const prng = createPrng(`mission-backdoor-${missionNumber}`);
  const role = prng.pick(TARGET_ROLES);
  return { role, port: prng.pick(BACKDOOR_PORTS) };
};

/** What a chain job asks for: a listener left on the front box, on one port, and the machine
 *  behind it taken down. */
export type ChainJob = {
  readonly role: TargetRole;
  readonly port: number;
};

/** The machine a chain job wants taken down and the port its listener on the front box must hold,
 *  drawn on a stream of their own, the machine first, so nothing the contract drew before them
 *  moves. */
export const chainJob = (missionNumber: number): ChainJob => {
  const prng = createPrng(`mission-chain-${missionNumber}`);
  const role = prng.pick(TARGET_ROLES);
  return { role, port: prng.pick(BACKDOOR_PORTS) };
};

/** The suffix on the hostname of the box in a contract's key-box slot: the box holding the key
 *  or the records, or on a sabotage, backdoor, credential, portforward or chain job the machine the
 *  job is about, named for what it is. */
export const keyBoxSuffix = (missionNumber: number): string => {
  const kind = missionKind(missionNumber);
  if (kind === 'sabotage') return sabotageRole(missionNumber).suffix;
  if (kind === 'backdoor') return backdoorJob(missionNumber).role.suffix;
  if (kind === 'credential') return credentialRole(missionNumber).suffix;
  if (kind === 'chain') return chainJob(missionNumber).role.suffix;
  if (kind === 'portforward') return portforwardJob(missionNumber).machine.suffix;
  return KEY_BOX_SUFFIX;
};
