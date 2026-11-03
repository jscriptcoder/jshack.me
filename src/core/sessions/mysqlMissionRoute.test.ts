import { describe, expect, it, vi } from 'vitest';
import { handleHydraCrack, type HydraCrackDeps } from './hydraCrack.js';
import { handleMysqlConnect, type MysqlConnectDeps } from './mysqlConnect.js';
import { handleMysqlStatement, type MysqlStatementDeps } from './mysqlStatement.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { derivedPublicIpByEssid } from '../logging/crossPlayerSourceIp.js';
import { MYSQL_LOG_PATH } from '../logging/mysqlLog.js';
import { DATADIR_PATH } from '../mysql/datadir.js';
import type { OwnerPatchRow } from '../network/materializeMachineFs.js';
import { computeApGatewayId } from '../identity/router.js';
import { LOOPBACK_IPV4 } from '../network/interfaces.js';
import type { AppendLog, MachineLogAppend } from '../patches/appendMachineLog.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { signRequest } from '../signedRequest/sign.js';
import { formatWordlist } from '../wordlist/defaultWordlist.js';
import {
  DATABASE_ROUTE_ACCOUNT,
  DATABASE_ROUTE_ACCOUNT_PASSWORD,
  DATABASE_ROUTE_ADDRESS,
  DATABASE_ROUTE_ESSID,
  DATABASE_ROUTE_KEY_BOX,
  DATABASE_ROUTE_WORD,
  journalRow,
} from '../../test/factories/databaseRouteContract.js';
import {
  missionFilesWithNoPools,
  servedMissionFiles,
} from '../../test/factories/webRouteContract.js';

/**
 * A contract on the database route, worked through the real doors over one journal: the sweep
 * that finds the account, the login, the statements that read the word, and the writes that
 * change what the next visitor finds.
 *
 * A word is asserted on through a boolean: a failing `toContain` would print it.
 */

const HOME_ESSID = 'BEAN-THERE-WIFI';
const WORKSTATION = 'workstation';
const DATABASE_PORT = SERVICE_CATALOG.mysql.defaultPort;

type DoorDeps = MysqlConnectDeps & MysqlStatementDeps & HydraCrackDeps;

/** One world with a live journal: what a statement writes back, the next request reads. */
const makeWorld = (
  over: { readonly findMissionFiles?: DoorDeps['findMissionFiles']; readonly standsOnKeyBox?: boolean } = {},
) => {
  const journal: OwnerPatchRow[] = [];
  const appendLog = vi.fn<AppendLog>(async () => ({ error: null }));
  const deps: DoorDeps = {
    nonceStore: async () => ({ fresh: true }),
    now: () => Date.UTC(2026, 10, 3, 10, 0, 0),
    findPatches: async ({ machine_id: machineId }) => ({
      data: machineId === DATABASE_ROUTE_KEY_BOX ? [...journal] : [],
      error: null,
    }),
    upsertPatch: async (row: PatchRow) => {
      journal.push(journalRow(row.path, row.content));
      return { error: null };
    },
    appendLog,
    findNetworkByPublicIp: async (publicIp) => ({
      data:
        publicIp === DATABASE_ROUTE_ADDRESS
          ? {
              router_machine_id: computeApGatewayId(DATABASE_ROUTE_ESSID),
              essid: DATABASE_ROUTE_ESSID,
            }
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
          ? { username: 'guest', userType: 'guest', essid: DATABASE_ROUTE_ESSID }
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

type Login = { readonly username?: string; readonly password?: string };

const connect = (deps: DoorDeps, login: Login = {}) =>
  handleMysqlConnect(
    signRequest(identity, 'mysqlConnect', {
      essid: HOME_ESSID,
      target_ip: DATABASE_ROUTE_ADDRESS,
      port: DATABASE_PORT,
      username: login.username ?? DATABASE_ROUTE_ACCOUNT,
      password: login.password ?? DATABASE_ROUTE_ACCOUNT_PASSWORD,
    }),
    deps,
  );

const statement = (deps: DoorDeps, line: string) =>
  handleMysqlStatement(
    signRequest(identity, 'mysqlStatement', {
      essid: HOME_ESSID,
      target_ip: DATABASE_ROUTE_ADDRESS,
      port: DATABASE_PORT,
      username: DATABASE_ROUTE_ACCOUNT,
      password: DATABASE_ROUTE_ACCOUNT_PASSWORD,
      statement: line,
    }),
    deps,
  );

const outputOf = (response: { readonly body: Record<string, unknown> }): string =>
  String(response.body['output']);

const logLines = (appendLog: {
  readonly mock: { readonly calls: readonly (readonly [MachineLogAppend])[] };
}): readonly string[] =>
  appendLog.mock.calls
    .map(([append]) => append)
    .filter((append) => append.path === MYSQL_LOG_PATH)
    .flatMap((append) => append.text.split('\n').filter((line) => line.trim() !== ''));

/** The sweep door is handed no `findMissionFiles`, as it is on a deployment: the accounts it
 *  attacks are in the database as generated, so it reads no word and needs no pools. */
const sweep = ({ findMissionFiles: _notForASweep, ...deps }: DoorDeps, words: readonly string[]) =>
  handleHydraCrack(
    signRequest(identity, 'hydraCrack', {
      essid: HOME_ESSID,
      target_ip: DATABASE_ROUTE_ADDRESS,
      service: 'mysql',
      caller_machine_id: computeWorkstationId(WORKSTATION, identity.publicKeyHex),
    }),
    {
      ...deps,
      listPathPatches: async () => ({
        data: [
          {
            content: formatWordlist(words),
            updated_at: '2026-11-03T10:00:00.000Z',
            writer_key: 'the-caller',
          },
        ],
        error: null,
      }),
    },
  );

describe('sweeping the database on a database route', () => {
  it('finds the application account and leaves a line for each try', async () => {
    const { deps, appendLog } = makeWorld();

    const response = await sweep(deps, [DATABASE_ROUTE_ACCOUNT_PASSWORD]);

    expect(response.status).toBe(200);
    expect(response.body['cracked']).toEqual([
      { username: DATABASE_ROUTE_ACCOUNT, password: DATABASE_ROUTE_ACCOUNT_PASSWORD },
    ]);
    expect(logLines(appendLog).length).toBeGreaterThan(0);
  });

  it('finds no database root with the word on the list', async () => {
    const { deps } = makeWorld();

    const response = await sweep(deps, [DATABASE_ROUTE_WORD]);

    expect(response.status).toBe(200);
    expect(response.body['cracked']).toEqual([]);
  });

  it('reads a datadir a root removed as nothing to attack', async () => {
    const { deps, journal } = makeWorld();
    journal.push(journalRow(DATADIR_PATH, null));

    const response = await sweep(deps, [DATABASE_ROUTE_ACCOUNT_PASSWORD]);

    expect(response.body['cracked']).toEqual([]);
  });
});

describe('logging in to the database on a database route', () => {
  it('opens to the swept account and leaves a line', async () => {
    const { deps, appendLog } = makeWorld();

    const response = await connect(deps);

    expect(response.status).toBe(200);
    expect(logLines(appendLog).some((line) => line.includes(DATABASE_ROUTE_ACCOUNT))).toBe(true);
  });

  it('refuses a wrong password', async () => {
    const { deps } = makeWorld();

    expect((await connect(deps, { password: 'nope' })).status).toBe(401);
  });

  it('refuses the word as database root, which is a different lock', async () => {
    const { deps } = makeWorld();

    const response = await connect(deps, { username: 'root', password: DATABASE_ROUTE_WORD });

    expect(response.status).toBe(401);
  });
});

describe('reading the table on a database route', () => {
  it('lists settings beside the generated tables', async () => {
    const { deps } = makeWorld();

    const response = await statement(deps, 'SHOW TABLES');

    expect(response.status).toBe(200);
    expect(outputOf(response)).toContain('settings');
    expect(outputOf(response)).toContain('users');
  });

  it('shows the word, and nothing in the table says whose it is', async () => {
    const { deps } = makeWorld();

    const output = outputOf(await statement(deps, 'SELECT * FROM settings'));

    expect(output.includes(DATABASE_ROUTE_WORD)).toBe(true);
    expect(output.includes('admin_pass')).toBe(true);
    expect(/root/i.test(output)).toBe(false);
  });

  it('reads the same table from a guest shell on the box, over localhost', async () => {
    const { deps } = makeWorld({ standsOnKeyBox: true });

    const response = await handleMysqlStatement(
      signRequest(identity, 'mysqlStatement', {
        essid: DATABASE_ROUTE_ESSID,
        target_ip: LOOPBACK_IPV4,
        port: DATABASE_PORT,
        username: DATABASE_ROUTE_ACCOUNT,
        password: DATABASE_ROUTE_ACCOUNT_PASSWORD,
        statement: 'SELECT * FROM settings',
        caller_machine_id: DATABASE_ROUTE_KEY_BOX,
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(outputOf(response).includes(DATABASE_ROUTE_WORD)).toBe(true);
  });
});

describe('changing the database on a database route', () => {
  it('lets the account delete the row, and the next visitor no longer finds it', async () => {
    const { deps } = makeWorld();

    const deleted = await statement(deps, "DELETE FROM settings WHERE name = 'admin_pass'");
    expect(deleted.body['failed']).toBe(false);

    const output = outputOf(await statement(deps, 'SELECT * FROM settings'));
    expect(output.includes(DATABASE_ROUTE_WORD)).toBe(false);
    expect(output.includes('admin_pass')).toBe(false);
    expect(output.includes('site_mode')).toBe(true);
  });

  it('keeps settings when a statement changes another table', async () => {
    const { deps, journal } = makeWorld();

    const changed = await statement(deps, "UPDATE users SET role = 'editor'");
    expect(changed.body['failed']).toBe(false);
    expect(journal.map((row) => row.path)).toEqual([DATADIR_PATH]);

    const output = outputOf(await statement(deps, 'SELECT * FROM settings'));
    expect(output.includes(DATABASE_ROUTE_WORD)).toBe(true);
  });

  it('refuses the account once a root has removed the datadir', async () => {
    const { deps, journal } = makeWorld();
    journal.push(journalRow(DATADIR_PATH, null));

    expect((await connect(deps)).status).toBe(401);
  });
});

describe('a database route whose deployment has lost its pools', () => {
  it('answers a login 500 rather than a database with no word in it', async () => {
    const { deps } = makeWorld({ findMissionFiles: missionFilesWithNoPools });

    expect(await connect(deps)).toEqual({
      status: 500,
      body: { error: 'mission_secret_missing' },
    });
  });

  it('answers a statement 500 and serves no row', async () => {
    const { deps } = makeWorld({ findMissionFiles: missionFilesWithNoPools });

    expect(await statement(deps, 'SELECT * FROM users')).toEqual({
      status: 500,
      body: { error: 'mission_secret_missing' },
    });
  });
});
