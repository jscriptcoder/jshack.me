import { describe, expect, it, vi } from 'vitest';
import { handleMysqlStatement, type MysqlStatementDeps } from './mysqlStatement';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { hostServices } from '../generation/remoteHostFs';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { asAbsPath } from '../types';
import { md5 } from '../generation/md5';
import { databaseOn, knownDatabaseCredential, mysqlHostOn } from '../../test/factories/lanDatabase';
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

const makeDeps = (patches: readonly OwnerPatchRow[] = []) => {
  const findPatches = vi.fn<MysqlStatementDeps['findPatches']>(async () => ({
    data: patches,
    error: null,
  }));
  const deps: MysqlStatementDeps = { nonceStore: freshStore, findPatches };
  return { deps, findPatches };
};

const signedStatement = (
  identity: ReturnType<typeof generateIdentity>,
  request: {
    readonly essid?: string;
    readonly target_ip: string;
    readonly username: string;
    readonly password: string;
    readonly statement: string;
    readonly source_ip?: string | null;
  },
) =>
  signRequest(identity, 'mysqlStatement', {
    essid: request.essid ?? ESSID,
    target_ip: request.target_ip,
    username: request.username,
    password: request.password,
    statement: request.statement,
    source_ip: request.source_ip ?? CLIENT_IP,
  });

const openOn = (host: LanHost) => {
  const credential = knownDatabaseCredential(ESSID, host);
  return { identity: generateIdentity(), credential };
};

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
    const host = mysqlHostOn(ESSID);
    const { identity, credential } = openOn(host);
    const { deps } = makeDeps();

    const response = await handleMysqlStatement(
      await signedStatement(identity, {
        target_ip: host.ip,
        username: credential.username,
        password: credential.password,
        statement: 'DROP TABLE users',
        source_ip: '10.9.9.9',
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      failed: true,
      output: [
        `ERROR 1142 (42000): DROP command denied to user '${credential.username}'@'10.9.9.9' for table 'users'`,
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
  const APP_PASSWORD = 'let-me-read';
  const GUEST_PASSWORD = 'let-me-look';

  const laddered = (host: LanHost) =>
    patchRow(
      '/var/lib/mysql/data.json',
      JSON.stringify({
        ...databaseOn(ESSID, host),
        credentials: [
          { username: 'app_rw', passwordHash: md5(APP_PASSWORD), userType: 'user' },
          { username: 'readonly', passwordHash: md5(GUEST_PASSWORD), userType: 'guest' },
        ],
      }),
    );

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
