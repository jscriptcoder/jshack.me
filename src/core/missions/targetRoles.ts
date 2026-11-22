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
import { chainFinal, missionKind } from './missionShape.js';
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
  /** Why a client, speaking for the customer who owns it, wants an intruder's implant found on it
   *  and removed: a white-hat job, one of which opens a cleanup job's briefing. */
  readonly cleanupPitches: readonly string[];
  /** The account the machine's own service runs under, which the intruder's listener runs as on a
   *  cleanup target: an account like that running `nc` is out of place, a clue for a sharp eye. */
  readonly serviceAccount: string;
};

/** Every machine a client can want taken down, a way into or the root login of, each named for
 *  what it is and wanted for reasons of its own. */
const TARGET_ROLES: readonly TargetRole[] = [
  {
    noun: 'CCTV recorder',
    suffix: 'nvr',
    serviceAccount: 'recorder',
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
    cleanupPitches: [
      "Our customer's camera recorder has been sending footage somewhere it should not. They want it stopped.",
      "Someone has been watching our customer's cameras from outside. They want their recorder back to themselves.",
      'Our customer found their recorder talking to an address nobody there knows. They need it cleaned up.',
    ],
  },
  {
    noun: 'backup server',
    suffix: 'backup',
    serviceAccount: 'backup',
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
    cleanupPitches: [
      "Our customer's backup server is copying more than it should, to someone it should not. Make it stop.",
      "Every night someone reads our customer's backups from outside. They want the box clean again.",
      'Our customer thinks something got onto their backup server. Find it and get it out.',
    ],
  },
  {
    noun: 'monitoring station',
    suffix: 'mon',
    serviceAccount: 'nagios',
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
    cleanupPitches: [
      "Our customer's monitoring station is quietly reporting to somebody else. They want it reporting only to them.",
      "The box that watches our customer's network is being watched itself. Get rid of whoever is watching.",
      "Our customer's monitoring went quiet at odd hours last month. They think someone put something on it.",
    ],
  },
  {
    noun: 'build server',
    suffix: 'ci',
    serviceAccount: 'jenkins',
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
    cleanupPitches: [
      "Something on our customer's build server ships with every release, and they did not write it. Get it off.",
      "Our customer's builds have been calling out to an address nobody there recognises. Clean the box.",
      "A stranger has had a way into our customer's build server for weeks. They want it closed today.",
    ],
  },
  {
    noun: 'licence server',
    suffix: 'lic',
    serviceAccount: 'flexlm',
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
    cleanupPitches: [
      "Our customer's licence server has a visitor it never issued a seat to. Find it and remove it.",
      "Something on our customer's licence server answers to the outside world. They want it gone.",
      "Our customer's licence server keeps a door open that nobody there opened. Shut it for them.",
    ],
  },
  {
    noun: 'door-access controller',
    suffix: 'access',
    serviceAccount: 'doorctl',
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
    cleanupPitches: [
      "Our customer's doors have been opening on nobody's badge. Something is on their access controller.",
      "Someone outside can open our customer's doors. They want their access controller back in their own hands.",
      'Our customer found their door-access controller talking to a stranger. Make it stop talking.',
    ],
  },
  {
    noun: 'billing server',
    suffix: 'billing',
    serviceAccount: 'billing',
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
    cleanupPitches: [
      "Our customer's invoices are being read before they go out. Something is on their billing server.",
      "Somebody has a way into our customer's billing server, and they want it closed before month end.",
      "Our customer's billing server has been leaking their accounts to someone. Find the leak and close it.",
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

/** What a cleanup job asks for: an intruder's implant found on one machine and removed, and the
 *  port its listener holds, which the briefing names. */
export type CleanupJob = {
  readonly role: TargetRole;
  readonly port: number;
};

/** The machine a cleanup job's client wants cleaned up and the port the intruder's listener holds
 *  there, drawn on a stream of their own, the machine first, so nothing the contract drew before
 *  them moves. */
export const cleanupJob = (missionNumber: number): CleanupJob => {
  const prng = createPrng(`mission-cleanup-${missionNumber}`);
  const role = prng.pick(TARGET_ROLES);
  return { role, port: prng.pick(BACKDOOR_PORTS) };
};

/** What a chain job asks for: a listener left on the front box, on one port, and, when its last
 *  step takes it down, the machine behind it. */
export type ChainJob = {
  readonly role: TargetRole;
  readonly port: number;
};

/** The machine a chain job wants taken down, when its last step does, and the port its listener on
 *  the front box must hold, drawn on a stream of their own, the machine first, so nothing the
 *  contract drew before them moves. */
export const chainJob = (missionNumber: number): ChainJob => {
  const prng = createPrng(`mission-chain-${missionNumber}`);
  const role = prng.pick(TARGET_ROLES);
  return { role, port: prng.pick(BACKDOOR_PORTS) };
};

/** The suffix on the hostname of the box in a contract's key-box slot: the box holding the key,
 *  the file or the records, or on a sabotage, backdoor, credential, cleanup or portforward job, or a chain
 *  job whose last step takes it down, the machine the job is about, named for what it is. */
export const keyBoxSuffix = (missionNumber: number): string => {
  const kind = missionKind(missionNumber);
  if (kind === 'sabotage') return sabotageRole(missionNumber).suffix;
  if (kind === 'backdoor') return backdoorJob(missionNumber).role.suffix;
  if (kind === 'credential') return credentialRole(missionNumber).suffix;
  if (kind === 'cleanup') return cleanupJob(missionNumber).role.suffix;
  if (kind === 'chain') {
    // A chain job's file or records sit where a destroy or wipe job's do.
    return chainFinal(missionNumber) === 'sabotage'
      ? chainJob(missionNumber).role.suffix
      : KEY_BOX_SUFFIX;
  }
  if (kind === 'portforward') return portforwardJob(missionNumber).machine.suffix;
  return KEY_BOX_SUFFIX;
};
