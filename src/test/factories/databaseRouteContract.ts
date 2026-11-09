/**
 * A contract on the database route, as the doors a player works it through see it: its
 * number, its network, its key box, the account a sweep finds, the word in its table, and a
 * journal the doors can really write to.
 */

import { generateHomeLan } from '../../core/generation/generateHomeLan.js';
import { resolveLanHostIdentity } from '../../core/generation/lanHostIdentity.js';
import { buildMissionKeyBoxFs } from '../../core/generation/missionKeyBoxFs.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../../core/missions/missionNetwork.js';
import { missionShape } from '../../core/missions/missionShape.js';
import { databaseIn } from '../../core/mysql/datadir.js';
import type { OwnerPatchRow } from '../../core/network/materializeMachineFs.js';
import { asAbsPath } from '../../core/types.js';
import { plaintextFor } from '../passwords.js';

const firstDatabaseRouteNumber = (): number => {
  for (let candidate = 66051; candidate < 66051 + 5000; candidate += 1) {
    if (isMissionNumber(candidate) && missionShape(candidate).keyBox.route === 'mysql')
      return candidate;
  }
  throw new Error('no database route contract in the range');
};

export const DATABASE_ROUTE_NUMBER = firstDatabaseRouteNumber();
export const DATABASE_ROUTE_ESSID = missionEssid(DATABASE_ROUTE_NUMBER);
export const DATABASE_ROUTE_ADDRESS = missionAddressForNumber(DATABASE_ROUTE_NUMBER) ?? '';
export const DATABASE_ROUTE_WORD = plaintextFor(
  missionShape(DATABASE_ROUTE_NUMBER).keyBox.rootHash,
);

const keyBoxHost = generateHomeLan(DATABASE_ROUTE_ESSID).hosts.find(
  (host) => host.kind === 'machine',
);
if (keyBoxHost === undefined) throw new Error('a contract network has a key box');
export const DATABASE_ROUTE_KEY_BOX = resolveLanHostIdentity(
  keyBoxHost,
  DATABASE_ROUTE_ESSID,
).machineId;
export const DATABASE_ROUTE_KEY_BOX_IP = keyBoxHost.ip;

const applicationCredential = databaseIn(
  buildMissionKeyBoxFs(DATABASE_ROUTE_NUMBER),
)?.credentials.find((credential) => credential.userType === 'user');
if (applicationCredential === undefined) throw new Error('a database route has an account');

/** The login a sweep finds. */
export const DATABASE_ROUTE_ACCOUNT = applicationCredential.username;
export const DATABASE_ROUTE_ACCOUNT_PASSWORD = plaintextFor(applicationCredential.passwordHash);

/** One written file in the journal; `null` content is the file having been deleted. */
export const journalRow = (path: string, content: string | null): OwnerPatchRow =>
  ({
    path: asAbsPath(path),
    content,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-11-03T10:00:00.000Z',
    writer_key: 'c'.repeat(64),
  }) as OwnerPatchRow;
