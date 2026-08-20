import { describe, expect, it, vi } from 'vitest';
import { mysql } from './mysql';
import {
  mockCommandEnv,
  mockIdentity,
  mockMysqlApi,
  mockNetworkViewFromConnectivity,
  mockSession,
} from '../../test/factories/commandEnv';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { asEpochMs, asMachineId, asPlayerKeyHex } from '../types';
import type { CommandResult, MysqlApi } from './types';

/**
 * `mysql <host>` — the fourth door, and the first whose credential is not the box's
 * own. It authenticates against the DATABASE's accounts rather than `/etc/passwd`,
 * so a connection grants no filesystem access at all and mints no session row: the
 * credential is re-validated per statement instead.
 *
 * Reachability is settled LOCALLY from the deterministic generated FS before a
 * password is asked, as `ssh` and `ftp` both do. Roughly one machine in twelve runs
 * a database, so the common case is a box with no door — and taking a credential for
 * a daemon that is not there hands it over for nothing.
 */

const PUBKEY = 'a'.repeat(64);
const ESSID = 'BEAN-THERE-WIFI';
const NOW = 1700000000000;
/** The player's OWN address on this LAN — what the target's daemon sees the
 *  connection arrive from, and so what its refusal names. Never the target's. */
const LOCAL_IP = assignHomeNetwork(PUBKEY, ESSID).localIp;

const onlineConnectivity = (essid: string): ConnectivityState => {
  const cold = buildColdStartConnectivity(PUBKEY);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
  const { localIp } = assignHomeNetwork(PUBKEY, essid);
  return {
    interfaces: new Map(cold.interfaces).set('wlan0', {
      ...wlan0,
      association: { essid, bssid: 'AA:BB:CC:DD:EE:FF' },
      ipv4: localIp,
    }),
  };
};

/** A generated host running the database daemon, and one that runs SSH but no
 *  database. Only a small share of boxes roll `mysqld`, so both are ordinary members
 *  of the same LAN.
 *
 *  The second host must be running some OTHER door, and that is not fussiness. A box
 *  running nothing at all is refused whichever port the command looks at, so it
 *  cannot tell a door reading 3306 from one reading 22 — the blind spot that let the
 *  ftp row point at the wrong account file with every test still green. A box with
 *  ssh open and no database is where the two answers differ. */
const pickHosts = (): { readonly databaseHost: LanHost; readonly noDatabaseHost: LanHost } => {
  let databaseHost: LanHost | undefined;
  let noDatabaseHost: LanHost | undefined;
  for (const host of generateHomeLan(ESSID).hosts) {
    if (host.kind !== 'machine') continue;
    const services = readOpenPorts(buildRemoteHostFs(ESSID, host)).map((open) => open.service);
    const serves = services.includes(SERVICE_CATALOG.mysql.service);
    if (serves && databaseHost === undefined) databaseHost = host;
    if (!serves && services.includes(SERVICE_CATALOG.ssh.service) && noDatabaseHost === undefined) {
      noDatabaseHost = host;
    }
  }
  if (databaseHost === undefined || noDatabaseHost === undefined) {
    throw new Error('need a database host and an ssh-only host on the same LAN');
  }
  return { databaseHost, noDatabaseHost };
};

type EnvOver = {
  readonly prompt?: (opts: { message: string; masked: boolean }) => Promise<string>;
  readonly mysql?: Partial<MysqlApi>;
};

const mysqlEnv = (over: EnvOver = {}) =>
  mockCommandEnv({
    identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
    network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID)),
    session: mockSession({
      id: 'su-root-1',
      machineId: asMachineId('skylab-deadbeef'),
      username: 'alice',
      userType: 'root',
    }),
    now: () => asEpochMs(NOW),
    mysql: mockMysqlApi(over.mysql),
    // Distinct answers per prompt: a user and a password that read the same would
    // let the two be swapped without a test noticing.
    prompt: over.prompt ?? (async ({ masked }) => (masked ? 'hunter2' : 'readonly')),
  });

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return result;
};

const linesOf = (result: CommandResult): string =>
  sync(result)
    .lines.map((line) => line.content)
    .join('\n');

describe('mysql', () => {
  it('refuses a host running no database before asking for anything', async () => {
    const { noDatabaseHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');
    const env = mysqlEnv({ prompt });

    const result = await mysql.execute(env, [noDatabaseHost.ip], new Map());

    // The claim is the SILENCE, not the wording: a prompt here would take a
    // credential for a daemon that is not listening and hand it over for nothing.
    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toContain(
      `ERROR 2003 (HY000): Can't connect to MySQL server on '${noDatabaseHost.ip}:3306' (Connection refused)`,
    );
    expect(sync(result).exitCode).toBe(1);
  });

  it('asks for a credential when the box really is running one', async () => {
    const { databaseHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');
    // Refused at the daemon, which is beside the point here: this box HAS a door, and
    // the claim is only that the door was knocked on.
    const env = mysqlEnv({ prompt, mysql: { connect: async () => ({ ok: false }) } });

    await mysql.execute(env, [databaseHost.ip], new Map());

    // The other half of the refusal: a guard that turned every box away would
    // satisfy the test above and leave the door permanently shut.
    expect(prompt).toHaveBeenCalled();
  });

  it('reports no route to an address that is no host on this LAN', async () => {
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(mysqlEnv({ prompt }), ['192.168.99.99'], new Map());

    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toContain(
      "ERROR 2003 (HY000): Can't connect to MySQL server on '192.168.99.99:3306' (No route to host)",
    );
  });

  it('refuses before prompting when the interface is associated with nothing', async () => {
    const { databaseHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUBKEY) }),
      network: mockNetworkViewFromConnectivity(buildColdStartConnectivity(PUBKEY)),
      prompt,
    });

    const result = await mysql.execute(env, [databaseHost.ip], new Map());

    // A box that IS running a database, unreachable for the other reason — so the
    // refusal cannot be coming from the door being shut.
    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toContain('(Network is unreachable)');
  });

  it('refuses a bad credential without saying which half of it was wrong', async () => {
    const { databaseHost } = pickHosts();
    const connect = vi.fn(async () => ({ ok: false as const }));

    const result = await mysql.execute(mysqlEnv({ mysql: { connect } }), [databaseHost.ip], new Map());

    // Two substitutions away from a sentence about a different machine: the account
    // NAMED is the one typed rather than the session's, and the address is the
    // player's own rather than the target they aimed at.
    expect(linesOf(result)).toBe(
      `ERROR 1045 (28000): Access denied for user 'readonly'@'${LOCAL_IP}' (using password: YES)`,
    );
    expect(sync(result).exitCode).toBe(1);
  });

  it('hands the daemon exactly what was typed', async () => {
    const { databaseHost } = pickHosts();
    const connect = vi.fn(async () => ({ ok: false as const }));

    await mysql.execute(mysqlEnv({ mysql: { connect } }), [databaseHost.ip], new Map());

    // Whole-value: a field dropped, swapped or quietly added is the same defect as a
    // wrong one, and the password is the field with the most to lose.
    expect(connect).toHaveBeenCalledWith({
      essid: ESSID,
      targetIp: databaseHost.ip,
      username: 'readonly',
      password: 'hunter2',
      sourceIp: LOCAL_IP,
    });
  });

  it('takes the account from the command line without asking for one', async () => {
    const { databaseHost } = pickHosts();
    const connect = vi.fn(async () => ({ ok: false as const }));
    const prompt = vi.fn(async () => 'hunter2');

    await mysql.execute(mysqlEnv({ mysql: { connect }, prompt }), [databaseHost.ip, 'root'], new Map());

    // A named account is not a secret, so it skips its prompt — but the password
    // never may, which is why exactly ONE prompt is still owed.
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith({ message: 'Enter password: ', masked: true });
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ username: 'root' }));
  });

  it('aborts holding nothing when the account prompt is interrupted', async () => {
    const { databaseHost } = pickHosts();
    const connect = vi.fn(async () => ({ ok: false as const }));
    const interrupted = async () => {
      throw new Error('aborted');
    };

    const result = await mysql.execute(
      mysqlEnv({ mysql: { connect }, prompt: interrupted }),
      [databaseHost.ip],
      new Map(),
    );

    // Ctrl-C means the player decided not to, and a command that still sent what it
    // had would hand the credential over at precisely that moment.
    expect(connect).not.toHaveBeenCalled();
    expect(sync(result).lines).toEqual([]);
    expect(sync(result).exitCode).toBe(130);
  });

  it('aborts holding nothing when the password prompt is interrupted', async () => {
    const { databaseHost } = pickHosts();
    const connect = vi.fn(async () => ({ ok: false as const }));
    const prompt = vi.fn(async ({ masked }: { message: string; masked: boolean }) => {
      if (masked) throw new Error('aborted');
      return 'readonly';
    });

    const result = await mysql.execute(
      mysqlEnv({ mysql: { connect }, prompt }),
      [databaseHost.ip],
      new Map(),
    );

    // The SECOND prompt: by then an account name HAS been typed, so a command that
    // guarded only the first has something to send and would send it.
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(connect).not.toHaveBeenCalled();
    expect(sync(result).lines).toEqual([]);
    expect(sync(result).exitCode).toBe(130);
  });

  it('names its own usage when no host is given', async () => {
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(mysqlEnv({ prompt }), [], new Map());

    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toBe('usage: mysql [-p port] <host> [user]');
  });
});
