/**
 * A contract on the web route, as every door a player reaches it through sees it: the
 * number, the network it makes, its key box, and the server's lay-in over the deployment's
 * real pools.
 */

import { generateHomeLan } from '../../core/generation/generateHomeLan.js';
import { resolveLanHostIdentity } from '../../core/generation/lanHostIdentity.js';
import { computeApGatewayId } from '../../core/identity/router.js';
import { missionFilesForBox, missionLeakPath } from '../../core/missions/missionLeak.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../../core/missions/missionNetwork.js';
import { missionShape } from '../../core/missions/missionShape.js';
import {
  COMMON_PASSWORDS,
  CRACKABLE_PASSWORDS,
  plaintextFor,
  UNCRACKABLE_PASSWORDS,
  WIFI_PASSWORDS,
} from '../passwords.js';

export const DEPLOYMENT_SECRETS = JSON.stringify({
  UNCRACKABLE_PASSWORDS,
  CRACKABLE_PASSWORDS,
  COMMON_PASSWORDS,
  WIFI_PASSWORDS,
});

const KEY_SECRET = 'test-mission-secret';

const firstWebRouteNumber = (): number => {
  for (let candidate = 66051; candidate < 66051 + 5000; candidate += 1) {
    if (isMissionNumber(candidate) && missionShape(candidate).route === 'web') return candidate;
  }
  throw new Error('no web route contract in the range');
};

export const WEB_ROUTE_NUMBER = firstWebRouteNumber();
export const WEB_ROUTE_ESSID = missionEssid(WEB_ROUTE_NUMBER);
export const WEB_ROUTE_ADDRESS = missionAddressForNumber(WEB_ROUTE_NUMBER) ?? '';
export const WEB_ROUTE_GATEWAY = computeApGatewayId(WEB_ROUTE_ESSID);
/** The file's name under the document root, as a request asks for it. */
export const WEB_ROUTE_LEAK_PATH = missionLeakPath(WEB_ROUTE_NUMBER) ?? '';
export const WEB_ROUTE_LEAK_REQUEST = WEB_ROUTE_LEAK_PATH.replace('/var/www/html', '');
export const WEB_ROUTE_WORD = plaintextFor(missionShape(WEB_ROUTE_NUMBER).keyBoxRootHash);

const keyBoxHost = generateHomeLan(WEB_ROUTE_ESSID).hosts.find((host) => host.kind === 'machine');
if (keyBoxHost === undefined) throw new Error('a contract network has a key box');
export const WEB_ROUTE_KEY_BOX = resolveLanHostIdentity(keyBoxHost, WEB_ROUTE_ESSID).machineId;
export const WEB_ROUTE_KEY_BOX_IP = keyBoxHost.ip;

/** The server's lay-in, on a deployment holding its secrets. */
export const servedMissionFiles = (query: {
  readonly essid: string;
  readonly machine_id: string;
}): ReturnType<typeof missionFilesForBox> =>
  missionFilesForBox(query, { keySecret: KEY_SECRET, rawSecrets: DEPLOYMENT_SECRETS });

/** The server's lay-in, on a deployment whose `JSHACK_SECRETS` is unset. */
export const missionFilesWithNoPools = (query: {
  readonly essid: string;
  readonly machine_id: string;
}): ReturnType<typeof missionFilesForBox> =>
  missionFilesForBox(query, { keySecret: KEY_SECRET, rawSecrets: undefined });
