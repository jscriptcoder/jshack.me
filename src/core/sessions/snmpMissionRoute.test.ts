import { describe, expect, it, vi } from 'vitest';
import { handleHydraCrack, type HydraCrackDeps } from './hydraCrack.js';
import { handleSnmpSet, type SnmpSetDeps } from './snmpSet.js';
import { handleSnmpWalk, type SnmpWalkDeps } from './snmpWalk.js';
import { generateIdentity } from '../identity/identity.js';
import { computeApGatewayId } from '../identity/router.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { derivedPublicIpByEssid } from '../logging/crossPlayerSourceIp.js';
import { SNMPD_LOG_PATH } from '../logging/snmpdLog.js';
import type { OwnerPatchRow } from '../network/materializeMachineFs.js';
import { LOOPBACK_IPV4 } from '../network/interfaces.js';
import { RULES_V4_PATH } from '../network/iptablesRules.js';
import type { AppendLog, MachineLogAppend } from '../patches/appendMachineLog.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import { SNMPD_CONF_PATH } from '../snmp/conf.js';
import { signRequest } from '../signedRequest/sign.js';
import { formatWordlist } from '../wordlist/defaultWordlist.js';
import { journalRow } from '../../test/factories/databaseRouteContract.js';
import {
  SNMP_ROUTE_ADDRESS,
  SNMP_ROUTE_ESSID,
  SNMP_ROUTE_KEY_BOX,
  SNMP_ROUTE_READ_ONLY_COMMUNITY,
  SNMP_ROUTE_READ_WRITE_COMMUNITY,
  SNMP_ROUTE_WORD,
} from '../../test/factories/snmpRouteContract.js';
import {
  missionFilesWithNoPools,
  servedMissionFiles,
} from '../../test/factories/webRouteContract.js';

/**
 * A contract on the snmp route, worked through the real doors over one journal: the silence a
 * default walk gets, the sweep, the walks that read the word, and the sets and edits that change
 * what the next visitor finds.
 *
 * A word is asserted on through a boolean: a failing `toContain` would print it.
 */

const HOME_ESSID = 'BEAN-THERE-WIFI';
const WORKSTATION = 'workstation';
const SILENCE = { status: 404, body: { error: 'host_unreachable' } };
const NO_SECRET = { status: 500, body: { error: 'mission_secret_missing' } };

type DoorDeps = SnmpWalkDeps & SnmpSetDeps & HydraCrackDeps;

/** One world with a live journal: what a set writes, the next request reads. */
const makeWorld = (
  over: {
    readonly findMissionFiles?: DoorDeps['findMissionFiles'];
    readonly standsOnKeyBox?: boolean;
  } = {},
) => {
  const journal: OwnerPatchRow[] = [];
  const appendLog = vi.fn<AppendLog>(async () => ({ error: null }));
  const deps: DoorDeps = {
    nonceStore: async () => ({ fresh: true }),
    now: () => Date.UTC(2026, 10, 3, 10, 0, 0),
    findPatches: async ({ machine_id: machineId }) => ({
      data: machineId === SNMP_ROUTE_KEY_BOX ? [...journal] : [],
      error: null,
    }),
    upsertPatch: async (row: PatchRow) => {
      journal.push(journalRow(row.path, row.content));
      return { error: null };
    },
    appendLog,
    findNetworkByPublicIp: async (publicIp) => ({
      data:
        publicIp === SNMP_ROUTE_ADDRESS
          ? { router_machine_id: computeApGatewayId(SNMP_ROUTE_ESSID), essid: SNMP_ROUTE_ESSID }
          : null,
      error: null,
    }),
    findPublicIpByEssid: derivedPublicIpByEssid,
    listOccupantsByEssid: async () => ({ data: [], error: null }),
    listLeasesByEssid: async () => ({ data: [], error: null }),
    findHomeNetworkByOwnerKey: async () => ({ data: null, error: null }),
    findActiveSession: async () => ({
      data:
        over.standsOnKeyBox === true
          ? { username: 'guest', userType: 'guest', essid: SNMP_ROUTE_ESSID }
          : null,
      error: null,
    }),
    findHomeVantage: async () => ({
      data: over.standsOnKeyBox === true ? null : { essid: HOME_ESSID, octet: 61 },
      error: null,
    }),
    findWorkstationLease: async () => ({ data: null, error: null }),
    listPathPatches: async () => ({ data: [], error: null }),
    findMissionFiles: over.findMissionFiles ?? servedMissionFiles,
  };
  return { deps, journal, appendLog };
};

const identity = generateIdentity();

const walk = (deps: DoorDeps, community: string) =>
  handleSnmpWalk(
    signRequest(identity, 'snmpWalk', {
      essid: HOME_ESSID,
      target_ip: SNMP_ROUTE_ADDRESS,
      community,
    }),
    deps,
  );

const set = (deps: DoorDeps, community: string, assignment: string) =>
  handleSnmpSet(
    signRequest(identity, 'snmpSet', {
      essid: HOME_ESSID,
      target_ip: SNMP_ROUTE_ADDRESS,
      community,
      assignment,
    }),
    deps,
  );

/** The sweep door is handed no `findMissionFiles`, as it is on a deployment: what it attacks is
 *  on the box as generated, so it reads no word and needs no pools. */
const sweep = (
  { findMissionFiles: _notForASweep, ...deps }: DoorDeps,
  request: { readonly service: string; readonly port?: number; readonly words: readonly string[] },
) =>
  handleHydraCrack(
    signRequest(identity, 'hydraCrack', {
      essid: HOME_ESSID,
      target_ip: SNMP_ROUTE_ADDRESS,
      service: request.service,
      ...(request.port === undefined ? {} : { port: request.port }),
      caller_machine_id: computeWorkstationId(WORKSTATION, identity.publicKeyHex),
    }),
    {
      ...deps,
      listPathPatches: async () => ({
        data: [
          {
            content: formatWordlist(request.words),
            updated_at: '2026-11-03T10:00:00.000Z',
            writer_key: 'the-caller',
          },
        ],
        error: null,
      }),
    },
  );

const crackedPasswords = (response: { readonly body: Record<string, unknown> }): readonly string[] =>
  (response.body['cracked'] as readonly { readonly password: string }[]).map(
    (entry) => entry.password,
  );

const contactOf = (response: { readonly body: Record<string, unknown> }): string =>
  String((response.body['identity'] as { readonly sysContact: string }).sysContact);

const logLines = (appendLog: {
  readonly mock: { readonly calls: readonly (readonly [MachineLogAppend])[] };
}): readonly string[] =>
  appendLog.mock.calls
    .map(([append]) => append)
    .filter((append) => append.path === SNMPD_LOG_PATH)
    .flatMap((append) => append.text.split('\n').filter((line) => line.trim() !== ''));

describe('walking the agent on an snmp route without its community', () => {
  it.each(['public', 'private', 'nope'])(
    'answers %s with silence, and leaves a failure in the log',
    async (community) => {
      const { deps, appendLog } = makeWorld();

      expect(await walk(deps, community)).toEqual(SILENCE);
      expect(logLines(appendLog).some((line) => line.includes('Authentication failure'))).toBe(true);
    },
  );
});

describe('walking the agent on an snmp route with its read-only community', () => {
  it('answers at the read-only tier with the word as the contact', async () => {
    const { deps } = makeWorld();

    const response = await walk(deps, SNMP_ROUTE_READ_ONLY_COMMUNITY);

    expect(response.status).toBe(200);
    expect(response.body['tier']).toBe('read-only');
    expect(contactOf(response).includes(SNMP_ROUTE_WORD)).toBe(true);
  });

  it('says nothing about whose the word is', async () => {
    const { deps } = makeWorld();

    const response = await walk(deps, SNMP_ROUTE_READ_ONLY_COMMUNITY);

    expect(/root/i.test(contactOf(response))).toBe(false);
  });

  it('leaves a success in the log', async () => {
    const { deps, appendLog } = makeWorld();

    await walk(deps, SNMP_ROUTE_READ_ONLY_COMMUNITY);

    expect(logLines(appendLog).some((line) => line.includes('Authentication succeeded'))).toBe(true);
  });

  it('answers the same from a guest shell on the box, over localhost', async () => {
    const { deps } = makeWorld({ standsOnKeyBox: true });

    const response = await handleSnmpWalk(
      signRequest(identity, 'snmpWalk', {
        essid: SNMP_ROUTE_ESSID,
        target_ip: LOOPBACK_IPV4,
        community: SNMP_ROUTE_READ_ONLY_COMMUNITY,
        caller_machine_id: SNMP_ROUTE_KEY_BOX,
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(contactOf(response).includes(SNMP_ROUTE_WORD)).toBe(true);
  });
});

describe('sweeping the agent on an snmp route', () => {
  it('finds the read-write community and leaves lines in the log', async () => {
    const { deps, appendLog } = makeWorld();

    const response = await sweep(deps, {
      service: 'snmp',
      words: ['wrong', SNMP_ROUTE_READ_WRITE_COMMUNITY],
    });

    expect(crackedPasswords(response)).toEqual([SNMP_ROUTE_READ_WRITE_COMMUNITY]);
    expect(logLines(appendLog).length).toBeGreaterThan(0);
  });

  it('never finds the read-only community, which is not what a sweep attacks', async () => {
    const { deps } = makeWorld();

    const response = await sweep(deps, {
      service: 'snmp',
      words: [SNMP_ROUTE_READ_ONLY_COMMUNITY],
    });

    expect(crackedPasswords(response)).toEqual([]);
  });

  it('opens a walk at the read-write tier with what it found, which shows the word too', async () => {
    const { deps } = makeWorld();

    const response = await walk(deps, SNMP_ROUTE_READ_WRITE_COMMUNITY);

    expect(response.body['tier']).toBe('read-write');
    expect(contactOf(response).includes(SNMP_ROUTE_WORD)).toBe(true);
  });
});

describe('the word from an snmp route, at the door it opens', () => {
  it('lets a sweep find root on :2222 once it is on the list', async () => {
    const { deps } = makeWorld();

    const response = await sweep(deps, { service: 'ssh', port: 2222, words: [SNMP_ROUTE_WORD] });

    expect(
      (response.body['cracked'] as readonly { readonly username: string }[]).map(
        (entry) => entry.username,
      ),
    ).toEqual(['root']);
  });
});

describe('setting the agent on an snmp route', () => {
  it('refuses the read-only community as not writable, and writes nothing', async () => {
    const { deps, journal } = makeWorld();

    const response = await set(deps, SNMP_ROUTE_READ_ONLY_COMMUNITY, 'inputPort.22=deny');

    expect(response.status).toBe(200);
    expect(response.body['ok']).toBe(false);
    expect((response.body['refusal'] as { readonly reason: string }).reason).toBe('notWritable');
    expect(journal).toEqual([]);
  });

  it('answers a community it does not hold with silence', async () => {
    const { deps, journal } = makeWorld();

    expect(await set(deps, 'public', 'inputPort.22=deny')).toEqual(SILENCE);
    expect(journal).toEqual([]);
  });

  it('closes :2222 on a deny of the box own sshd, and opens it again on a permit', async () => {
    const { deps, journal } = makeWorld();
    const sweepSsh = () => sweep(deps, { service: 'ssh', port: 2222, words: [SNMP_ROUTE_WORD] });

    const denied = await set(deps, SNMP_ROUTE_READ_WRITE_COMMUNITY, 'inputPort.22=deny');
    expect(denied.body['ok']).toBe(true);
    expect(journal.map((row) => row.path)).toEqual([RULES_V4_PATH]);
    expect((await sweepSsh()).status).toBe(404);

    await set(deps, SNMP_ROUTE_READ_WRITE_COMMUNITY, 'inputPort.22=permit');
    expect((await sweepSsh()).status).toBe(200);
  });

  it('silences later walks on a deny of the agent own port', async () => {
    const { deps } = makeWorld();

    await set(deps, SNMP_ROUTE_READ_WRITE_COMMUNITY, 'inputPort.161=deny');

    expect(await walk(deps, SNMP_ROUTE_READ_ONLY_COMMUNITY)).toEqual(SILENCE);
    expect(await walk(deps, SNMP_ROUTE_READ_WRITE_COMMUNITY)).toEqual(SILENCE);
  });
});

describe('a root changing the agent on an snmp route', () => {
  it('takes the word out of later walks when the contact changes', async () => {
    const { deps, journal } = makeWorld();
    journal.push(
      journalRow(
        SNMPD_CONF_PATH,
        `rocommunity ${SNMP_ROUTE_READ_ONLY_COMMUNITY}\nsyscontact nobody\n`,
      ),
    );

    const response = await walk(deps, SNMP_ROUTE_READ_ONLY_COMMUNITY);

    expect(response.status).toBe(200);
    expect(contactOf(response)).toBe('nobody');
  });

  it('silences the read-only community when the config goes, and not the read-write one', async () => {
    const { deps, journal } = makeWorld();
    journal.push(journalRow(SNMPD_CONF_PATH, null));

    expect(await walk(deps, SNMP_ROUTE_READ_ONLY_COMMUNITY)).toEqual(SILENCE);

    const readWrite = await walk(deps, SNMP_ROUTE_READ_WRITE_COMMUNITY);
    expect(readWrite.status).toBe(200);
    expect(contactOf(readWrite).includes(SNMP_ROUTE_WORD)).toBe(false);
  });

  it('silences every walk when the agent stops', async () => {
    const { deps, journal } = makeWorld();
    journal.push(journalRow('/var/run/snmpd.pid', null));

    expect(await walk(deps, SNMP_ROUTE_READ_ONLY_COMMUNITY)).toEqual(SILENCE);
    expect(await walk(deps, SNMP_ROUTE_READ_WRITE_COMMUNITY)).toEqual(SILENCE);
  });
});

describe('an snmp route whose deployment has lost its pools', () => {
  it('answers a walk 500 and shows no word', async () => {
    const { deps } = makeWorld({ findMissionFiles: missionFilesWithNoPools });

    expect(await walk(deps, SNMP_ROUTE_READ_ONLY_COMMUNITY)).toEqual(NO_SECRET);
  });

  it('answers a set 500 and writes nothing', async () => {
    const { deps, journal } = makeWorld({ findMissionFiles: missionFilesWithNoPools });

    expect(await set(deps, SNMP_ROUTE_READ_WRITE_COMMUNITY, 'inputPort.22=deny')).toEqual(NO_SECRET);
    expect(journal).toEqual([]);
  });

  it('still sweeps, since what a sweep attacks is on the box as generated', async () => {
    const { deps } = makeWorld({ findMissionFiles: missionFilesWithNoPools });

    const response = await sweep(deps, {
      service: 'snmp',
      words: [SNMP_ROUTE_READ_WRITE_COMMUNITY],
    });

    expect(crackedPasswords(response)).toEqual([SNMP_ROUTE_READ_WRITE_COMMUNITY]);
  });
});
