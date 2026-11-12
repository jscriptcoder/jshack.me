/**
 * What a sabotage job's target is: the machine the client wants taken down for good. The role
 * names the box, so a contractor who lands on it can tell it is the one the briefing meant.
 *
 * Nothing here is secret: like the rest of a contract's shape it ships in the bundle, and says
 * nothing about which contracts exist without the address.
 */

import { createPrng } from '../generation/prng.js';
import { missionKind } from './missionShape.js';
import { KEY_BOX_SUFFIX } from './pools.js';

/** A machine a client can want taken down. */
export type SabotageRole = {
  /** What the machine is, as the board and the briefing name it. */
  readonly noun: string;
  /** The suffix on the target's hostname, after the target company's stem. */
  readonly suffix: string;
  /** Why a client wants it down, one of which opens the briefing. */
  readonly pitches: readonly string[];
};

/** Every machine a client can want taken down, each named for what it is and wanted down for
 *  reasons of its own. */
const SABOTAGE_ROLES: readonly SabotageRole[] = [
  {
    noun: 'CCTV recorder',
    suffix: 'nvr',
    pitches: [
      'Their cameras caught our guy on Tuesday. The recorder goes down before anyone pulls the footage.',
      'Something happened in their car park last night that nobody wants on tape.',
      'Our client needs a week of their footage to have never existed.',
      'A delivery leaves their loading bay early next week. The cameras go first.',
    ],
  },
  {
    noun: 'backup server',
    suffix: 'backup',
    pitches: [
      'Our client wants them to have nothing to restore from.',
      'When their main systems go down next week, they should find the backups already gone.',
      'They keep every old version of everything. Some of those versions need to stop existing.',
    ],
  },
  {
    noun: 'monitoring station',
    suffix: 'mon',
    pitches: [
      'Something is going to happen on their network this weekend. Nobody should be watching when it does.',
      'Their monitoring wakes someone up at 3am for anything odd. Our client needs a quiet night.',
      'Their alerts caught our last contractor. Not this time.',
    ],
  },
  {
    noun: 'build server',
    suffix: 'ci',
    pitches: [
      "They ship a release on Friday that undercuts our client. It doesn't ship if it can't build.",
      'Their launch is next week. Our client would like it to slip.',
      'Every update they push goes through that box. Our client wants a long pause.',
    ],
  },
  {
    noun: 'licence server',
    suffix: 'lic',
    pitches: [
      'Their whole office runs on software that checks in with that box every morning. Make the check fail.',
      'Our client wants them locked out of their own tools for a week.',
      'No licences, no seats. Their staff should find nothing opens on Monday.',
    ],
  },
  {
    noun: 'door-access controller',
    suffix: 'access',
    pitches: [
      'Somebody needs to walk through their front door on Thursday without a badge.',
      "With that box down their doors fail open. That's all our client needs.",
      'A meeting happens in their building next week that the badge logs should never record.',
    ],
  },
  {
    noun: 'billing server',
    suffix: 'billing',
    pitches: [
      'Their invoices go out on the first. Our client would like them not to.',
      "Month end is in a week. Without that box they can't charge anyone.",
      "Our client is their biggest customer, and this quarter's invoice should go missing.",
    ],
  },
];

/** The machine a sabotage job asks taken down, drawn on its own stream so nothing the
 *  contract drew before it moves. */
export const sabotageRole = (missionNumber: number): SabotageRole =>
  createPrng(`mission-sabotage-role-${missionNumber}`).pick(SABOTAGE_ROLES);

/** The suffix on the hostname of the box in a contract's key-box slot: the box holding the key
 *  or the records, or on a sabotage job the machine the client wants down, named for what it
 *  is. */
export const keyBoxSuffix = (missionNumber: number): string =>
  missionKind(missionNumber) === 'sabotage' ? sabotageRole(missionNumber).suffix : KEY_BOX_SUFFIX;
