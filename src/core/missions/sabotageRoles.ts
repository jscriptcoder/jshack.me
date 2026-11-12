/**
 * What a sabotage job's target is: the machine the client wants taken down for good. The role
 * names the box, so a contractor who lands on it can tell it is the one the briefing meant.
 *
 * Nothing here is secret: like the rest of a contract's shape it ships in the bundle, and says
 * nothing about which contracts exist without the address.
 */

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

const CCTV_RECORDER: SabotageRole = {
  noun: 'CCTV recorder',
  suffix: 'nvr',
  pitches: [
    'Their cameras caught our guy on Tuesday. The recorder goes down before anyone pulls the footage.',
    'Something happened in their car park last night that nobody wants on tape.',
    'Our client needs a week of their footage to have never existed.',
    'A delivery leaves their loading bay early next week. The cameras go first.',
  ],
};

/** The machine a sabotage job asks taken down. */
export const sabotageRole = (_missionNumber: number): SabotageRole => CCTV_RECORDER;

/** The suffix on the hostname of the box in a contract's key-box slot: the box holding the key
 *  or the records, or on a sabotage job the machine the client wants down, named for what it
 *  is. */
export const keyBoxSuffix = (missionNumber: number): string =>
  missionKind(missionNumber) === 'sabotage' ? sabotageRole(missionNumber).suffix : KEY_BOX_SUFFIX;
