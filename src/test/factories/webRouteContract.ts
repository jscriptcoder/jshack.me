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
import { DEPLOYMENT_SECRETS, plaintextFor } from '../passwords.js';

export { DEPLOYMENT_SECRETS };

const KEY_SECRET = 'test-mission-secret';

const firstWebRouteNumber = (): number => {
  for (let candidate = 66051; candidate < 66051 + 5000; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    // One hop: the gateway forwards straight onto the key box this reaches. A key job, so the
    // box is a key box whatever later kinds take over the numbers around it.
    const { keyBox, frontBox, kind } = missionShape(candidate);
    if (kind === 'key' && keyBox.route === 'web' && frontBox === null) return candidate;
  }
  throw new Error('no web route contract in the range');
};

export const WEB_ROUTE_NUMBER = firstWebRouteNumber();
export const WEB_ROUTE_ESSID = missionEssid(WEB_ROUTE_NUMBER);
export const WEB_ROUTE_ADDRESS = missionAddressForNumber(WEB_ROUTE_NUMBER) ?? '';
export const WEB_ROUTE_GATEWAY = computeApGatewayId(WEB_ROUTE_ESSID);
/** The file's name under the document root, as a request asks for it. */
export const WEB_ROUTE_LEAK_PATH =
  missionLeakPath({ missionNumber: WEB_ROUTE_NUMBER, role: 'key' }) ?? '';
export const WEB_ROUTE_LEAK_REQUEST = WEB_ROUTE_LEAK_PATH.replace('/var/www/html', '');
export const WEB_ROUTE_WORD = plaintextFor(missionShape(WEB_ROUTE_NUMBER).keyBox.rootHash);

const keyBoxHost = generateHomeLan(WEB_ROUTE_ESSID).hosts.find((host) => host.kind === 'machine');
if (keyBoxHost === undefined) throw new Error('a contract network has a key box');
export const WEB_ROUTE_KEY_BOX = resolveLanHostIdentity(keyBoxHost, WEB_ROUTE_ESSID).machineId;
export const WEB_ROUTE_KEY_BOX_IP = keyBoxHost.ip;

/** When every contract's offer was posted, as its row holds it: a forensics box's trail is
 *  dated from it, and no other box asks. */
const POSTED_AT_NOON = async () => ({ data: Date.UTC(2026, 10, 20, 12, 0, 0), error: null });

/** The server's lay-in, on a deployment holding its secrets. */
export const servedMissionFiles = (query: {
  readonly essid: string;
  readonly machine_id: string;
}): ReturnType<typeof missionFilesForBox> =>
  missionFilesForBox(query, {
    keySecret: KEY_SECRET,
    rawSecrets: DEPLOYMENT_SECRETS,
    readPostedAt: POSTED_AT_NOON,
  });

/** The server's lay-in, on a deployment whose `JSHACK_SECRETS` is unset. */
export const missionFilesWithNoPools = (query: {
  readonly essid: string;
  readonly machine_id: string;
}): ReturnType<typeof missionFilesForBox> =>
  missionFilesForBox(query, {
    keySecret: KEY_SECRET,
    rawSecrets: undefined,
    readPostedAt: POSTED_AT_NOON,
  });
