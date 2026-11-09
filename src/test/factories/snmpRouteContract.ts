/**
 * A contract on the snmp route, as the doors a player works it through see it: its number, its
 * network, its key box, the two communities its agent answers to, and the word in its config.
 */

import { generateHomeLan } from '../../core/generation/generateHomeLan.js';
import { resolveLanHostIdentity } from '../../core/generation/lanHostIdentity.js';
import { md5 } from '../../core/generation/md5.js';
import { missionLeakFile } from '../../core/missions/missionLeak.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../../core/missions/missionNetwork.js';
import { missionShape } from '../../core/missions/missionShape.js';
import { parseSnmpdConf } from '../../core/snmp/conf.js';
import { DEFAULT_WORDLIST } from '../../core/wordlist/defaultWordlist.js';
import { plaintextFor } from '../passwords.js';
import { DEPLOYMENT_SECRETS } from './webRouteContract.js';

const firstSnmpRouteNumber = (): number => {
  for (let candidate = 66051; candidate < 66051 + 5000; candidate += 1) {
    if (isMissionNumber(candidate) && missionShape(candidate).keyBox.route === 'snmp')
      return candidate;
  }
  throw new Error('no snmp route contract in the range');
};

export const SNMP_ROUTE_NUMBER = firstSnmpRouteNumber();
export const SNMP_ROUTE_ESSID = missionEssid(SNMP_ROUTE_NUMBER);
export const SNMP_ROUTE_ADDRESS = missionAddressForNumber(SNMP_ROUTE_NUMBER) ?? '';
export const SNMP_ROUTE_WORD = plaintextFor(missionShape(SNMP_ROUTE_NUMBER).keyBox.rootHash);

const keyBoxHost = generateHomeLan(SNMP_ROUTE_ESSID).hosts.find((host) => host.kind === 'machine');
if (keyBoxHost === undefined) throw new Error('a contract network has a key box');
export const SNMP_ROUTE_KEY_BOX = resolveLanHostIdentity(keyBoxHost, SNMP_ROUTE_ESSID).machineId;

/** The community a walk can guess, which only the server's config names. */
export const SNMP_ROUTE_READ_ONLY_COMMUNITY =
  parseSnmpdConf(missionLeakFile(SNMP_ROUTE_NUMBER, DEPLOYMENT_SECRETS)?.content ?? '')
    .roCommunity ?? '';

/** The community a sweep finds on the list every player starts with. */
export const SNMP_ROUTE_READ_WRITE_COMMUNITY =
  DEFAULT_WORDLIST.find(
    (word) => md5(word) === missionShape(SNMP_ROUTE_NUMBER).keyBox.communityHash,
  ) ?? '';
