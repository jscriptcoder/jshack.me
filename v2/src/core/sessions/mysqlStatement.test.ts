import { describe, expect, it, vi } from 'vitest';
import { handleMysqlStatement, type MysqlStatementDeps } from './mysqlStatement';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { hostServices } from '../generation/remoteHostFs';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { asAbsPath } from '../types';
import { md5 } from '../generation/md5';
import {
  databaseOn,
  deepDatabaseFixture,
  knownDatabaseCredential,
  mysqlHostOn,
} from '../../test/factories/lanDatabase';
import { parseMysqlDatabase } from '../mysql/types';
import { MYSQL_LOG_PATH } from '../logging/mysqlLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleMysqlStatement` answers one statement against a box's real database.
 *
 * The credential is re-validated HERE, on every statement, because the connection
 * minted no session row to trust instead. That is not ceremony: it is what makes the
 * prompt hold nothing a server would have to honour, and it is why a datadir edited
 * between two statements takes effect on the second.
 *
 * What comes back is RENDERED TEXT and nothing else. A body carrying rows would hand
 * the client every row the account was not allowed to select, in a field the terminal
 * never draws and anyone watching the wire can read — so the whole-value assertions
 * below are the criterion, not hygiene.
 *
 * Nothing is written. The deps carry no way to write: a session of reads leaves the
 * target's `mysql.log` exactly as the login left it, and that is structural rather
 * than a rule somebody remembered to follow.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
const CLIENT_IP = '192.168.1.50';

const databaselessHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find((candidate) => {
    if (candidate.kind !== 'machine') return false;
    const services = hostServices(essid, candidate).map(({ spec }) => spec);
    return services.includes(SERVICE_CATALOG.ssh) && !services.includes(SERVICE_CATALOG.mysql);
  });
  if (host === undefined) throw new Error('every ssh host on LAN runs a database');
  return host;
};

const patchRow = (path: string, content: string | null): OwnerPatchRow =>
  ({
    path: asAbsPath(path),
    content,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-08-09T11:00:00.000Z',
    writer_key: 'b'.repeat(64),
  }) as OwnerPatchRow;

/** A fixed stamp, so a log line can be asserted whole rather than by the half of it
 *  that does not move. 2026-08-21T09:14:02Z, which is what the formatter renders. */
const STAMPED_AT = Date.UTC(2026, 7, 21, 9, 14, 2);

const makeDeps = (
  patches: readonly OwnerPatchRow[] = [],
  upsertResult: { readonly error: unknown } = { error: null },
  existingLog: string | null = null,
) => {
  const findPatches = vi.fn<MysqlStatementDeps['findPatches']>(async () => ({
    data: patches,
    error: null,
  }));
  const upsertPatch = vi.fn<MysqlStatementDeps['upsertPatch']>(async () => upsertResult);
  const readMysqlLog = vi.fn<MysqlStatementDeps['readMysqlLog']>(async () => ({
    data: { content: existingLog },
    error: null,
  }));
  const deps: MysqlStatementDeps = {
    nonceStore: freshStore,
    findPatches,
    upsertPatch,
    readMysqlLog,
    now: () => STAMPED_AT,
  };
  return { deps, findPatches, upsertPatch, readMysqlLog };
};

/** Every row the door wrote to the mysql log, in the order it wrote them. */
const loggedLines = (upsertPatch: { readonly mock: { readonly calls: readonly (readonly [PatchRow])[] } }) =>
  upsertPatch.mock.calls
    .map(([row]) => row)
    .filter((row) => row.path === MYSQL_LOG_PATH)
    .flatMap((row) => (row.content ?? '').split('\n').filter((line) => line.trim() !== ''));

const signedStatement = (
  identity: ReturnType<typeof generateIdentity>,
  request: {
    readonly essid?: string;
    readonly target_ip: string;
    readonly username: string;
    readonly password: string;
    readonly statement: string;
    readonly source_ip?: string | null;
    readonly port?: number;
  },
) =>
  signRequest(identity, 'mysqlStatement', {
    essid: request.essid ?? ESSID,
    target_ip: request.target_ip,
    port: request.port ?? SERVICE_CATALOG.mysql.defaultPort,
    username: request.username,
    password: request.password,
    statement: request.statement,
    source_ip: request.source_ip ?? CLIENT_IP,
  });

const openOn = (host: LanHost) => {
  const credential = knownDatabaseCredential(ESSID, host);
  return { identity: generateIdentity(), credential };
};

/**
 * A datadir carrying all three rungs, planted on a real generated box.
 *
 * Planted rather than found: the generator gives a read-only account to about half of
 * all databases and database root to roughly one box in eight, so a test that went
 * looking for a particular tier would pass or fail on which host the ESSID happened
 * to draw. Everything else about the box is its own — the tables, the name, the
 * filesystem the datadir sits in.
 */
const ROOT_PASSWORD = 'let-me-in';
const APP_PASSWORD = 'let-me-read';
const GUEST_PASSWORD = 'let-me-look';

const laddered = (host: LanHost) =>
  patchRow(
    '/var/lib/mysql/data.json',
    JSON.stringify({
      ...databaseOn(ESSID, host),
      credentials: [
        { username: 'dba', passwordHash: md5(ROOT_PASSWORD), userType: 'root' },
        { username: 'app_rw', passwordHash: md5(APP_PASSWORD), userType: 'user' },
        { username: 'readonly', passwordHash: md5(GUEST_PASSWORD), userType: 'guest' },
      ],
    }),
  );


/** The same box every deep-vantage test in this file runs against, and the forward
 *  that is the only way to name it. */
const DEEP = deepDatabaseFixture();
const FORWARD_PORT = 33306;

/** Journals per machine: the gateway's carries the forward, the deep box's carries
 *  whatever the test planted in its datadir. A mock answering the same rows for every
 *  id would give the deep box the gateway's forward table as well. */
const deepDeps = (deepPatches: readonly OwnerPatchRow[] = []) => {
  const rows: Readonly<Record<string, readonly OwnerPatchRow[]>> = {
    [DEEP.gatewayMachineId]: [
      patchRow('/etc/iptables/rules.v4', `forward ${FORWARD_PORT} to ${DEEP.layer.host.ip}:3306`),
    ],
    [DEEP.machineId]: deepPatches,
  };
  const upsertPatch = vi.fn<MysqlStatementDeps['upsertPatch']>(async () => ({ error: null }));
  const deps: MysqlStatementDeps = {
    nonceStore: freshStore,
    findPatches: vi.fn<MysqlStatementDeps['findPatches']>(async ({ machine_id }) => ({
      data: rows[machine_id] ?? [],
      error: null,
    })),
    upsertPatch,
    readMysqlLog: vi.fn<MysqlStatementDeps['readMysqlLog']>(async () => ({
      data: { content: null },
      error: null,
    })),
    now: () => STAMPED_AT,
  };
  return { deps, upsertPatch };
};

/** The three rungs on the DEEP box's datadir, planted for the same reason they are
 *  planted on a LAN box: which tiers a generated database carries is a roll. */
const deepLaddered = () =>
  patchRow(
    '/var/lib/mysql/data.json',
    JSON.stringify({
      ...DEEP.database,
      credentials: [
        { username: 'dba', passwordHash: md5(ROOT_PASSWORD), userType: 'root' },
        { username: 'app_rw', passwordHash: md5(APP_PASSWORD), userType: 'user' },
        { username: 'readonly', passwordHash: md5(GUEST_PASSWORD), userType: 'guest' },
      ],
    }),
  );

const deepStatement = async (
  username: string,
  password: string,
  statement: string,
  deps: MysqlStatementDeps,
) =>
  handleMysqlStatement(
    await signedStatement(generateIdentity(), {
      essid: DEEP.essid,
      target_ip: DEEP.gateway.ip,
      port: FORWARD_PORT,
      username,
      password,
      statement,
    }),
    deps,
  );

describe('a statement on a database behind a forward', () => {
  it('answers from the deep box the forward leads to', async () => {
    const { deps } = deepDeps([deepLaddered()]);

    const response = await deepStatement('readonly', GUEST_PASSWORD, 'SHOW TABLES', deps);

    // The tables are the DEEP box's own. Answering from anywhere else — the gateway,
    // a regenerated baseline — would render a database this box does not hold.
    const rendered = JSON.stringify(response.body);
    expect(response.status).toBe(200);
    for (const table of Object.keys(DEEP.database.tables)) {
      expect(rendered).toContain(table);
    }
  });

  it('refuses a write at the same tier as it would on the caller own LAN', async () => {
    const { deps } = deepDeps([deepLaddered()]);
    const table = Object.keys(DEEP.database.tables)[0] ?? 'orders';

    const response = await deepStatement(
      'readonly',
      GUEST_PASSWORD,
      `DROP TABLE ${table}`,
      deps,
    );

    // The address is the one NAT showed the box, not the one the caller claimed:
    // through a forward the daemon has never seen a 192.168.x address in its life.
    expect(response).toEqual({
      status: 200,
      body: {
        output: [
          `ERROR 1142 (42000): DROP command denied to user 'readonly'@'${DEEP.natIp}' for table '${table}'`,
        ],
        failed: true,
      },
    });
  });

  it('answers from the datadir as the JOURNAL holds it, not as the box was seeded', async () => {
    const cloned = Object.values(DEEP.database.tables)[0];
    if (cloned === undefined) throw new Error('the deep database holds no table to clone');
    const planted = {
      ...DEEP.database,
      tables: { ...DEEP.database.tables, planted_ledger: cloned },
      credentials: [{ username: 'dba', passwordHash: md5(ROOT_PASSWORD), userType: 'root' }],
    };
    const { deps } = deepDeps([patchRow('/var/lib/mysql/data.json', JSON.stringify(planted))]);

    const response = await deepStatement('dba', ROOT_PASSWORD, 'SHOW TABLES', deps);

    // The deep box is the one hop of the chain whose journal nothing used to replay.
    // Left unread, every change a player makes down here is written and never seen.
    expect(JSON.stringify(response.body)).toContain('planted_ledger');
  });

  it('files a change against the deep box, not the gateway it was reached through', async () => {
    const { deps, upsertPatch } = deepDeps([deepLaddered()]);
    const table = Object.keys(DEEP.database.tables)[0] ?? 'orders';

    await deepStatement('dba', ROOT_PASSWORD, `DROP TABLE ${table}`, deps);

    // The gateway forwarded the packet; it did not run the statement. A write filed
    // against it would answer Query OK while the change lands on no database at all.
    const datadirWrites = upsertPatch.mock.calls
      .map(([row]) => row)
      .filter((row) => row.path === asAbsPath('/var/lib/mysql/data.json'));
    expect(datadirWrites.map((row) => row.machine_id)).toEqual([DEEP.machineId]);
  });

  it('reaches the datadir and the daemon own log on the deep box, and nothing else', async () => {
    const { deps, upsertPatch } = deepDeps([deepLaddered()]);
    const table = Object.keys(DEEP.database.tables)[0] ?? 'orders';

    const response = await deepStatement('dba', ROOT_PASSWORD, `DROP TABLE ${table}`, deps);

    // Over EVERY path written, and both halves of each address. The gateway carried
    // the packet and ran nothing, so a line filed against it sends a defender reading
    // the wrong box's history — and NAT itself keeps no record to find.
    expect(response.status).toBe(200);
    expect(upsertPatch.mock.calls.map(([row]) => [row.machine_id, row.path])).toEqual([
      [DEEP.machineId, asAbsPath('/var/lib/mysql/data.json')],
      [DEEP.machineId, MYSQL_LOG_PATH],
    ]);
  });

  it('names the address NAT showed the box in the line it leaves behind', async () => {
    const { deps, upsertPatch } = deepDeps([deepLaddered()]);
    const table = Object.keys(DEEP.database.tables)[0] ?? 'orders';

    await deepStatement('readonly', GUEST_PASSWORD, `DROP TABLE ${table}`, deps);

    // The refusal the player read and the evidence the defender finds have to be the
    // same address. Written from the caller's claim instead, the trace would name an
    // attacker at a 192.168.x address this daemon has never been able to see.
    expect(loggedLines(upsertPatch)).toEqual([
      `2026-08-21T09:14:02.000000Z	6000 Denied	DROP command denied to user 'readonly'@'${DEEP.natIp}' for table '${table}'`,
    ]);
  });

  it('drops a player whose daemon was stopped between two statements', async () => {
    const { deps } = deepDeps([deepLaddered(), patchRow('/var/run/mysqld.pid', null)]);

    const response = await deepStatement('dba', ROOT_PASSWORD, 'SHOW TABLES', deps);

    // Reachability is re-checked per statement because there is no session to
    // invalidate and no push channel — so the next statement is the only place a
    // stopped daemon can surface. The client turns this into `Lost connection`.
    expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
  });

  it('drops a player whose forward was pulled between two statements', async () => {
    const { deps } = deepDeps([deepLaddered()]);

    const response = await handleMysqlStatement(
      await signedStatement(generateIdentity(), {
        essid: DEEP.essid,
        target_ip: DEEP.gateway.ip,
        port: FORWARD_PORT + 1,
        username: 'dba',
        password: ROOT_PASSWORD,
        statement: 'SHOW TABLES',
      }),
      deps,
    );

    // The forward is re-resolved per statement rather than held open, so a rule the
    // gateway no longer carries reaches nothing — exactly as if it never had.
    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });
});

describe('answering a statement against a real box', () => {
  it('renders the box own tables and returns nothing but the rendering', async () => {
    const host = mysqlHostOn(ESSID);
    const { identity, credential } = openOn(host);
    const { deps } = makeDeps();

    const response = await handleMysqlStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        username: credential.username,
        password: credential.password,
        statement: 'SHOW TABLES',
      }),
      deps,
    );

    const database = databaseOn(ESSID, host);
    // Whole-value: an added field fails. The rendering is checked in detail at the
    // engine; what matters here is that the body is the rendering and only that.
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      failed: false,
      output: expect.arrayContaining([`| Tables_in_${database.name} |`]),
    });
    expect(Object.keys(response.body).sort()).toEqual(['failed', 'output']);
  });

  it('reads the datadir the box actually has, not the one it was generated with', async () => {
    // The sharpest claim here. A handler that regenerated the baseline would answer
    // from a database the player can see is no longer on the box — and the datadir
    // is root-owned on a box a player can reach as root, so editing it is a move
    // the game intends.
    const host = mysqlHostOn(ESSID);
    const { identity, credential } = openOn(host);
    const edited = {
      ...databaseOn(ESSID, host),
      tables: { ledger: { columns: [{ name: 'id', type: 'INT', nullable: false }], rows: [] } },
    };
    const { deps } = makeDeps([
      patchRow('/var/lib/mysql/data.json', JSON.stringify(edited)),
    ]);

    const response = await handleMysqlStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        username: credential.username,
        password: credential.password,
        statement: 'SHOW TABLES',
      }),
      deps,
    );

    const rendered = String(response.body['output']);
    const generated = Object.keys(databaseOn(ESSID, host).tables)[0];
    expect(rendered).toContain('| ledger');
    // And the tables it WAS generated with are gone, which is the half that proves
    // the answer came from the journal rather than from a regenerated baseline.
    expect(rendered).not.toContain(`| ${generated}`);
  });

  it('carries the connecting account into the statement it runs', async () => {
    // The username and the address are re-sent with every statement precisely
    // because no session row holds them; a denial naming somebody else would mean
    // the credential being checked is not the credential the prompt is holding.
    //
    // The account list is the statement to ask it with: it is the one write refused
    // at every tier, so what comes back is about the identity being carried and not
    // about which rung this box happened to hand out.
    const host = mysqlHostOn(ESSID);
    const { identity, credential } = openOn(host);
    const { deps } = makeDeps();

    const response = await handleMysqlStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        username: credential.username,
        password: credential.password,
        statement: 'DROP TABLE credentials',
        source_ip: '10.9.9.9',
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      failed: true,
      output: [
        `ERROR 1142 (42000): DROP command denied to user '${credential.username}'@'10.9.9.9' for table 'credentials'`,
      ],
    });
  });
});

describe('what a statement cannot reach', () => {
  it('refuses a wrong password and an unknown account with one answer, byte for byte', async () => {
    const host = mysqlHostOn(ESSID);
    const { identity, credential } = openOn(host);
    const { deps } = makeDeps();

    const wrongPassword = await handleMysqlStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        username: credential.username,
        password: 'not-the-password',
        statement: 'SHOW TABLES',
      }),
      deps,
    );
    const unknownAccount = await handleMysqlStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        username: 'nobody_here',
        password: credential.password,
        statement: 'SHOW TABLES',
      }),
      deps,
    );

    // Same refusal as the login door's, and for the same reason: an answer that told
    // them apart would enumerate the database's accounts to anyone typing names.
    expect(wrongPassword).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(unknownAccount).toEqual(wrongPassword);
  });

  it('refuses a box that is not running a database', async () => {
    // The pidfiles are the truth about what is listening, so a daemon stopped
    // between two statements stops answering them.
    const host = databaselessHostOn(ESSID);
    const { deps } = makeDeps();

    const response = await handleMysqlStatement(
      await signedStatement(generateIdentity(), {
        target_ip: host.ip,
        username: 'root',
        password: 'anything',
        statement: 'SHOW TABLES',
      }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'service_not_running' } });
  });

  it('refuses a bricked box before asking it anything', async () => {
    const host = mysqlHostOn(ESSID);
    const { identity, credential } = openOn(host);
    const { deps } = makeDeps([patchRow('/boot/vmlinuz', null)]);

    const response = await handleMysqlStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        username: credential.username,
        password: credential.password,
        statement: 'SHOW TABLES',
      }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });

  it('refuses an address that is on no host of the caller own LAN', async () => {
    const { deps } = makeDeps();

    const response = await handleMysqlStatement(
      await signedStatement(generateIdentity(), {
        target_ip: '203.0.113.9',
        username: 'root',
        password: 'anything',
        statement: 'SHOW TABLES',
      }),
      deps,
    );

    expect(response).toEqual({ status: 404, body: { error: 'host_unreachable' } });
  });

  it('never consults the journal for a host it cannot resolve', async () => {
    const { deps, findPatches } = makeDeps();

    await handleMysqlStatement(
      await signedStatement(generateIdentity(), {
        target_ip: '203.0.113.9',
        username: 'root',
        password: 'anything',
        statement: 'SHOW TABLES',
      }),
      deps,
    );

    expect(findPatches).not.toHaveBeenCalled();
  });
});

/**
 * Which tier a statement runs at, and where that tier comes from.
 *
 * From the credential the statement just validated against — the datadir's own record
 * of the account — and from nowhere else. A client that could name its own tier would
 * be naming its own permissions, and there is no session row anywhere holding a tier
 * that was decided earlier and could be trusted now.
 *
 * The datadir here is PLANTED rather than found. The generator gives a read-only
 * account to about half of all databases, so a claim that needs the bottom rung has to
 * arrange one instead of hoping the box it picked has one.
 */
describe('the tier a statement runs at', () => {
  const ask = async (
    host: LanHost,
    identity: ReturnType<typeof generateIdentity>,
    login: { readonly username: string; readonly password: string },
    extra: Record<string, unknown> = {},
  ) => {
    const { deps } = makeDeps([laddered(host)]);
    return handleMysqlStatement(
      await signRequest(identity, 'mysqlStatement', {
        essid: ESSID,
        target_ip: host.ip,
        port: SERVICE_CATALOG.mysql.defaultPort,
        username: login.username,
        password: login.password,
        statement: 'SELECT * FROM credentials',
        source_ip: CLIENT_IP,
        ...extra,
      }),
      deps,
    );
  };

  it('refuses the account list to a read-only account, and leaks no hash doing it', async () => {
    const host = mysqlHostOn(ESSID);
    const response = await ask(host, generateIdentity(), {
      username: 'readonly',
      password: GUEST_PASSWORD,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      failed: true,
      output: [
        `ERROR 1142 (42000): SELECT command denied to user 'readonly'@'${CLIENT_IP}' for table 'credentials'`,
      ],
    });
    // Shape-independent, and that is the point: whatever fields the body grows, no
    // stored hash appears anywhere in it. A whole-value check only catches a leak in
    // a field somebody thought to look at; this catches one down a path added later
    // by someone who never read this test.
    for (const hash of [md5(APP_PASSWORD), md5(GUEST_PASSWORD)]) {
      expect(JSON.stringify(response.body)).not.toContain(hash);
    }
  });

  it('serves the same account list to the application account', async () => {
    // The refusal above belongs to the tier, not to the table being unreadable by
    // everyone — otherwise `credentials` would be a table nobody can use and the rung
    // below would have nothing to climb toward.
    const host = mysqlHostOn(ESSID);
    const response = await ask(host, generateIdentity(), {
      username: 'app_rw',
      password: APP_PASSWORD,
    });

    expect(response.status).toBe(200);
    expect(String(response.body['output'])).toContain(md5(GUEST_PASSWORD));
    expect(response.body['failed']).toBe(false);
  });

  it('takes the tier from the datadir account, not from anything the client sends', async () => {
    // The envelope is loose enough to carry this field and the signature covers it,
    // so it arrives intact and correctly signed — and is still never read. The tier
    // is a property of the account, and the account is a row on the target's disk.
    const host = mysqlHostOn(ESSID);
    const response = await ask(
      host,
      generateIdentity(),
      { username: 'readonly', password: GUEST_PASSWORD },
      { user_type: 'root' },
    );

    expect(response.body).toEqual({
      failed: true,
      output: [
        `ERROR 1142 (42000): SELECT command denied to user 'readonly'@'${CLIENT_IP}' for table 'credentials'`,
      ],
    });
  });
});

/**
 * Where a change lands, once an account is allowed to make one.
 *
 * This is the door's first write, and the guarantee it spends is a real one: until
 * now these deps carried no way to write at all, so "a statement changes nothing on
 * the target" held by construction. It is a rule now, and the last two tests here are
 * what hold it.
 *
 * The datadir is written as a WHOLE file rather than edited in place, because that is
 * what a database is here — one JSON document a daemon reads back. What matters is
 * that what lands still parses and still carries everything it carried before: the
 * reader collapses "unparseable" into "this box has no database", so a bad write
 * would shut the door on everyone, the player who made it included.
 */
describe('where a write lands', () => {
  const DATADIR = '/var/lib/mysql/data.json';

  const write = async (
    login: { readonly username: string; readonly password: string },
    statement: string,
    upsertResult: { readonly error: unknown } = { error: null },
  ) => {
    const host = mysqlHostOn(ESSID);
    const identity = generateIdentity();
    const { deps, upsertPatch } = makeDeps([laddered(host)], upsertResult);
    const response = await handleMysqlStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        username: login.username,
        password: login.password,
        statement,
      }),
      deps,
    );
    return { host, identity, response, upsertPatch };
  };

  const APP = { username: 'app_rw', password: APP_PASSWORD };
  const DBA = { username: 'dba', password: ROOT_PASSWORD };
  const READONLY = { username: 'readonly', password: GUEST_PASSWORD };

  it('reaches the datadir and the daemon own log on the named box, and nothing else', async () => {
    // Over EVERY path the door wrote, not "one of them was the datadir". Two paths are
    // allowed to it and this names both, so a door that touched a third fails here
    // rather than passing a check that only looked where it expected something.
    //
    // The machine is half the address and the easier half to get wrong: a change filed
    // against the wrong box vanishes silently, and the player is told Query OK over
    // rows that will not have moved when they look again.
    const { host, response, upsertPatch } = await write(APP, "UPDATE orders SET id = '1'");
    const machine = resolveLanHostIdentity(host, ESSID).machineId;

    expect(response.status).toBe(200);
    expect(upsertPatch.mock.calls.map(([row]) => [row.machine_id, row.path])).toEqual([
      [machine, DATADIR],
      [machine, String(MYSQL_LOG_PATH)],
    ]);
  });

  it('writes it back as the root-only file it was', async () => {
    // The datadir holds the hashes a sweep has to work for. A write that widened its
    // permissions would hand the answer key to every tier on the box — and it would
    // do it quietly, since nothing about the statement would look different.
    const { upsertPatch } = await write(APP, "UPDATE orders SET id = '1'");
    const [row] = upsertPatch.mock.calls[0] ?? [];

    expect(row).toMatchObject({
      path: DATADIR,
      owner: 'root',
      node_type: 'file',
      permissions: { read: ['root'], write: ['root'], execute: [] },
    });
  });

  it('records the change under the key of the player who made it', async () => {
    const { identity, upsertPatch } = await write(APP, "UPDATE orders SET id = '1'");
    const [row] = upsertPatch.mock.calls[0] ?? [];

    expect(row?.writer_key).toBe(identity.publicKeyHex);
  });

  it('is what the next occupant of the LAN reads, not just its author', async () => {
    // The claim that makes a database a shared object rather than a private one: the
    // journal is the machine's, so somebody else's next statement meets the change.
    const first = await write(DBA, 'DROP TABLE orders');
    const [written] = first.upsertPatch.mock.calls[0] ?? [];
    expect(written?.content).toBeDefined();
    if (written?.content === undefined || written.content === null) return;

    const { deps } = makeDeps([patchRow(DATADIR, written.content)]);
    const second = await handleMysqlStatement(
      await signedStatement(generateIdentity(), {
        target_ip: first.host.ip,
        username: APP.username,
        password: APP.password,
        statement: 'SHOW TABLES',
      }),
      deps,
    );

    expect(String(second.body['output'])).not.toContain('orders');
  });

  it('writes back a whole database that still reads as one', async () => {
    // A datadir that stopped parsing would read as "no database on this box" — the
    // reader deliberately cannot tell those apart — and the door would close on
    // everyone. So the account list has to survive a statement about tables.
    const { host, upsertPatch } = await write(DBA, 'DROP TABLE orders');
    const [row] = upsertPatch.mock.calls[0] ?? [];
    const written = parseMysqlDatabase(row?.content ?? '');

    expect(written).not.toBeNull();
    expect(written?.name).toBe(databaseOn(ESSID, host).name);
    expect(written?.credentials.map((credential) => credential.username)).toEqual([
      'dba',
      'app_rw',
      'readonly',
    ]);
    expect(Object.keys(written?.tables ?? {})).not.toContain('orders');
  });

  it('tells the player nothing landed when the write could not be recorded', async () => {
    // The write IS the statement here, not a note about one. Answering Query OK while
    // nothing persisted would show the player old rows on their next statement and
    // read as the game losing writes.
    const { response, upsertPatch } = await write(APP, "UPDATE orders SET id = '1'", {
      error: new Error('journal unreachable'),
    });

    expect(upsertPatch).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ status: 500, body: { error: 'datadir_write_failed' } });
  });

  it('writes nothing at all for a read', async () => {
    for (const statement of ['SHOW TABLES', 'DESCRIBE orders', 'SELECT * FROM orders']) {
      const { upsertPatch } = await write(DBA, statement);
      expect(upsertPatch, statement).not.toHaveBeenCalled();
    }
  });

  it('changes no datadir for a write it refused', async () => {
    // A refusal still reaches the daemon's log — recording those is the point — so the
    // claim is about the datadir specifically rather than about the door being silent.
    const datadirWrites = (calls: readonly (readonly [PatchRow])[]) =>
      calls.map(([row]) => row.path).filter((path) => path === DATADIR);

    for (const login of [READONLY, APP]) {
      const { upsertPatch } = await write(login, 'DROP TABLE orders');
      expect(datadirWrites(upsertPatch.mock.calls), login.username).toEqual([]);
    }
    const { upsertPatch } = await write(DBA, "UPDATE credentials SET password_hash = 'x'");
    expect(datadirWrites(upsertPatch.mock.calls)).toEqual([]);
  });
});

/**
 * What a statement leaves in the daemon's own log.
 *
 * The file already holds every connection this box accepted and every one it turned
 * away. It gains the two things a defender actually needs from it: what CHANGED, and
 * who was told they could not change it. Nothing else — a file that logged every
 * SELECT would bury those two lines under a session's worth of noise, and a player who
 * could read what everyone else read would learn more from the log than the database.
 */
describe('what a statement leaves in the log', () => {
  const say = async (
    login: { readonly username: string; readonly password: string },
    statement: string,
    upsertResult: { readonly error: unknown } = { error: null },
  ) => {
    const host = mysqlHostOn(ESSID);
    const { deps, upsertPatch, readMysqlLog } = makeDeps([laddered(host)], upsertResult);
    const response = await handleMysqlStatement(
      await signedStatement(generateIdentity(), {
        target_ip: host.ip,
        username: login.username,
        password: login.password,
        statement,
      }),
      deps,
    );
    return { response, upsertPatch, readMysqlLog };
  };

  const APP = { username: 'app_rw', password: APP_PASSWORD };
  const DBA = { username: 'dba', password: ROOT_PASSWORD };
  const READONLY = { username: 'readonly', password: GUEST_PASSWORD };

  it('writes one Query line naming the statement that changed something', async () => {
    // mysql's own stamp, its own tab-delimited columns, and the statement as the
    // engine read it. A defender reading this file learns what actually changed,
    // which is what makes a compromised box recoverable rather than merely lost.
    const { upsertPatch } = await say(APP, "UPDATE orders SET id = '1'");

    expect(loggedLines(upsertPatch)).toEqual([
      "2026-08-21T09:14:02.000000Z\t6000 Query\tUPDATE orders SET id = '1'",
    ]);
  });

  it('writes one Denied line for a write the account was not allowed to run', async () => {
    const { upsertPatch } = await say(READONLY, 'DROP TABLE orders');

    expect(loggedLines(upsertPatch)).toEqual([
      `2026-08-21T09:14:02.000000Z\t6000 Denied\tDROP command denied to user 'readonly'@'${CLIENT_IP}' for table 'orders'`,
    ]);
  });

  it('appends to the history rather than replacing it', async () => {
    // The read half is what makes this an append. A door that only wrote would erase
    // every connection the box had recorded, which is the one thing a trace file
    // cannot survive.
    const host = mysqlHostOn(ESSID);
    const earlier = '2026-08-21T09:00:00.000000Z\t4400 Connect\tapp_rw@10.0.0.1 on x using TCP/IP';
    const { deps, upsertPatch } = makeDeps([laddered(host)], { error: null }, `${earlier}\n`);

    await handleMysqlStatement(
      await signedStatement(generateIdentity(), {
        target_ip: host.ip,
        username: APP.username,
        password: APP.password,
        statement: "UPDATE orders SET id = '1'",
      }),
      deps,
    );

    expect(loggedLines(upsertPatch)).toEqual([
      earlier,
      "2026-08-21T09:14:02.000000Z\t6000 Query\tUPDATE orders SET id = '1'",
    ]);
  });

  it('writes the log as the root-owned, world-readable file it is', async () => {
    // Readable by any account once you are on the box — getting on the box is the
    // gate. Root-only to WRITE, because the daemon's append models a system write and
    // a visitor must never be able to edit away the record of their visit.
    const { upsertPatch } = await say(READONLY, 'DROP TABLE orders');
    const row = upsertPatch.mock.calls.map(([entry]) => entry).find((entry) => entry.path === MYSQL_LOG_PATH);

    expect(row).toMatchObject({
      owner: 'root',
      node_type: 'file',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
    });
  });

  it('writes nothing to the log for any read, refused or not', async () => {
    for (const statement of ['SHOW TABLES', 'DESCRIBE orders', 'SELECT * FROM orders']) {
      const { upsertPatch, readMysqlLog } = await say(DBA, statement);
      expect(loggedLines(upsertPatch), statement).toEqual([]);
      // Not even the read half: a door that read the log on every SELECT would cost a
      // round trip per statement to decide it had nothing to say.
      expect(readMysqlLog, statement).not.toHaveBeenCalled();
    }
    const refusedRead = await say(READONLY, 'SELECT * FROM credentials');
    expect(loggedLines(refusedRead.upsertPatch)).toEqual([]);
  });

  it('writes nothing to the log for a write that never became one', async () => {
    for (const statement of ['UPDATE orders SET', "UPDATE ghosts SET id = '1'"]) {
      const { upsertPatch } = await say(DBA, statement);
      expect(loggedLines(upsertPatch), statement).toEqual([]);
    }
  });

  it('records no change it could not persist', async () => {
    // The line says a change happened. If the datadir write failed, none did — and a
    // log claiming otherwise would send a defender looking for an edit nobody made.
    const { response, upsertPatch } = await say(APP, "UPDATE orders SET id = '1'", {
      error: new Error('journal unreachable'),
    });

    expect(response.status).toBe(500);
    expect(loggedLines(upsertPatch)).toEqual([]);
  });
});
