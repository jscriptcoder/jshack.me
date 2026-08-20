import { describe, expect, it, vi } from 'vitest';
import { mysql } from './mysql';
import {
  mockCommandEnv,
  mockIdentity,
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
import type { CommandResult } from './types';

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
    const env = mysqlEnv({ prompt });

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

  it('names its own usage when no host is given', async () => {
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(mysqlEnv({ prompt }), [], new Map());

    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toBe('usage: mysql [-p port] <host> [user]');
  });
});
