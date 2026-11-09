import { describe, expect, it, vi } from 'vitest';
import { handleHydraCrack, type HydraCrackDeps } from './hydraCrack.js';
import { handleSnmpWalk, type SnmpWalkDeps } from './snmpWalk.js';
import { generateIdentity } from '../identity/identity.js';
import { computeApGatewayId } from '../identity/router.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { derivedPublicIpByEssid } from '../logging/crossPlayerSourceIp.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity.js';
import { buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { databaseIn } from '../mysql/datadir.js';
import type { AppendLog } from '../patches/appendMachineLog.js';
import { parseSnmpdConf, readSnmpdConf } from '../snmp/conf.js';
import { signRequest } from '../signedRequest/sign.js';
import { DEFAULT_WORDLIST, formatWordlist } from '../wordlist/defaultWordlist.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../missions/missionNetwork.js';
import { missionShape, type MissionDecoy } from '../missions/missionShape.js';
import { plaintextFor } from '../../test/passwords.js';
import { servedMissionFiles } from '../../test/factories/webRouteContract.js';

/**
 * A decoy worked through the real doors: it lets a player in as far as the real door of its kind
 * would, and what is behind it is the box as it generates, with no word and no key.
 */

const HOME_ESSID = 'BEAN-THERE-WIFI';
const WORKSTATION = 'workstation';
const SILENCE = { status: 404, body: { error: 'host_unreachable' } };

/** The first contract running `decoy` as a decoy whose route is not that kind's own and whose
 *  key is not kept in a database, so the door is the decoy's alone. */
const decoyContract = (decoy: MissionDecoy) => {
  for (let candidate = 66051; candidate < 66051 + 5000; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (!shape.keyBox.decoys.includes(decoy) || shape.storage === 'database') continue;
    const essid = missionEssid(candidate);
    const keyBoxHost = generateHomeLan(essid).hosts.find((host) => host.kind === 'machine');
    if (keyBoxHost === undefined) throw new Error('a contract network has a key box');
    return {
      missionNumber: candidate,
      essid,
      address: missionAddressForNumber(candidate) ?? '',
      keyBox: resolveLanHostIdentity(keyBoxHost, essid).machineId,
    };
  }
  throw new Error(`no ${decoy} decoy in the range`);
};

type Contract = ReturnType<typeof decoyContract>;
type DoorDeps = SnmpWalkDeps & HydraCrackDeps;

const makeWorld = (contract: Contract): DoorDeps => ({
  nonceStore: async () => ({ fresh: true }),
  now: () => Date.UTC(2026, 10, 9, 10, 0, 0),
  findPatches: async () => ({ data: [], error: null }),
  appendLog: vi.fn<AppendLog>(async () => ({ error: null })),
  findNetworkByPublicIp: async (publicIp) => ({
    data:
      publicIp === contract.address
        ? { router_machine_id: computeApGatewayId(contract.essid), essid: contract.essid }
        : null,
    error: null,
  }),
  findPublicIpByEssid: derivedPublicIpByEssid,
  listOccupantsByEssid: async () => ({ data: [], error: null }),
  listLeasesByEssid: async () => ({ data: [], error: null }),
  findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
  findActiveSession: async () => ({ data: null, error: null }),
  findHomeVantage: async () => ({ data: { essid: HOME_ESSID, octet: 61 }, error: null }),
  findWorkstationLease: async () => ({ data: null, error: null }),
  listPathPatches: async () => ({ data: [], error: null }),
  findMissionFiles: servedMissionFiles,
});

const identity = generateIdentity();

const walk = (contract: Contract, community: string) =>
  handleSnmpWalk(
    signRequest(identity, 'snmpWalk', {
      essid: HOME_ESSID,
      target_ip: contract.address,
      community,
    }),
    makeWorld(contract),
  );

/** A sweep with every word a player starts with. The door is handed no `findMissionFiles`, as on
 *  a deployment. */
const sweep = (contract: Contract, service: string) => {
  const { findMissionFiles: _notForASweep, ...deps } = makeWorld(contract);
  return handleHydraCrack(
    signRequest(identity, 'hydraCrack', {
      essid: HOME_ESSID,
      target_ip: contract.address,
      service,
      caller_machine_id: computeWorkstationId(WORKSTATION, identity.publicKeyHex),
    }),
    {
      ...deps,
      listPathPatches: async () => ({
        data: [
          {
            content: formatWordlist(DEFAULT_WORDLIST),
            updated_at: '2026-11-09T10:00:00.000Z',
            writer_key: 'the-caller',
          },
        ],
        error: null,
      }),
    },
  );
};

describe('an snmp decoy', () => {
  const contract = decoyContract('snmp');
  const guessable =
    parseSnmpdConf(readSnmpdConf(buildMissionKeyBoxFs(contract.missionNumber))).roCommunity ?? '';

  it('answers public with silence, as the snmp route does', async () => {
    expect(await walk(contract, 'public')).toEqual(SILENCE);
  });

  it('answers its guessable community at the read-only tier, with an ordinary contact', async () => {
    const response = await walk(contract, guessable);

    expect(response.status).toBe(200);
    expect(response.body['tier']).toBe('read-only');
    expect((response.body['identity'] as { readonly sysContact: string }).sysContact).toBe(
      'netops@corp.local',
    );
  });

  it('gives a sweep no read-write community, so nobody shuts the route through it', async () => {
    const response = await sweep(contract, 'snmp');

    expect(response.status).toBe(200);
    expect(response.body['cracked']).toEqual([]);
  });
});

describe('a database decoy', () => {
  it('gives a sweep its application account, onto a database holding no word and no key', async () => {
    const contract = decoyContract('mysql');
    const database = databaseIn(buildMissionKeyBoxFs(contract.missionNumber));
    const account = database?.credentials[1];

    const response = await sweep(contract, 'mysql');

    expect(response.body['cracked']).toEqual([
      { username: account?.username, password: plaintextFor(account?.passwordHash ?? '') },
    ]);
    expect(Object.keys(database?.tables ?? {})).not.toContain('settings');
  });
});
