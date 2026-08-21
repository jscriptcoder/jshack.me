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
import { isInnerGateway } from '../generation/lanHostIdentity';
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

/** An open port on `host` that some OTHER daemon holds. `-p` naming it must still be
 *  refused: the flag addresses a port, and a port is not a door until the right daemon
 *  is behind it. Derived rather than written as 22, so a re-roll of the fixture's
 *  services cannot leave this asserting against a port nothing listens on. */
/** The LAN's inner gateway — the one kind of host where a port addresses something
 *  BEHIND it rather than the box itself. */
const innerGatewayOn = (essid: string): LanHost => {
  const gateway = generateHomeLan(essid).hosts.find(isInnerGateway);
  if (gateway === undefined) throw new Error('no inner gateway on this LAN');
  return gateway;
};

/** Deliberately neither 3306 nor the gateway's own 22: this is the port a player
 *  opened on their gateway, and what it reaches is the gateway's business. */
const FORWARD_PORT = 33306;

const otherServicePortOn = (host: LanHost): number => {
  const port = readOpenPorts(buildRemoteHostFs(ESSID, host)).find(
    (open) => open.service !== SERVICE_CATALOG.mysql.service,
  );
  if (port === undefined) throw new Error('need a second daemon on the database host');
  return port.port;
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
    const env = mysqlEnv({ prompt, mysql: { connect: async () => ({ ok: false, reason: 'denied' as const, fromIp: LOCAL_IP }) } });

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
    const connect = vi.fn(async () => ({ ok: false as const, reason: 'denied' as const, fromIp: LOCAL_IP }));

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
    const connect = vi.fn(async () => ({ ok: false as const, reason: 'denied' as const, fromIp: LOCAL_IP }));

    await mysql.execute(mysqlEnv({ mysql: { connect } }), [databaseHost.ip], new Map());

    // Whole-value: a field dropped, swapped or quietly added is the same defect as a
    // wrong one, and the password is the field with the most to lose.
    expect(connect).toHaveBeenCalledWith({
      essid: ESSID,
      targetIp: databaseHost.ip,
      port: 3306,
      username: 'readonly',
      password: 'hunter2',
      sourceIp: LOCAL_IP,
    });
  });

  it('takes the account from the command line without asking for one', async () => {
    const { databaseHost } = pickHosts();
    const connect = vi.fn(async () => ({ ok: false as const, reason: 'denied' as const, fromIp: LOCAL_IP }));
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
    const connect = vi.fn(async () => ({ ok: false as const, reason: 'denied' as const, fromIp: LOCAL_IP }));
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
    const connect = vi.fn(async () => ({ ok: false as const, reason: 'denied' as const, fromIp: LOCAL_IP }));
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

  it('greets and hands the player the prompt when the credential opens', async () => {
    const { databaseHost } = pickHosts();
    const enter = vi.fn();
    const env = mysqlEnv({
      mysql: { connect: async () => ({ ok: true, hostname: databaseHost.hostname }), enter },
    });

    const result = await mysql.execute(env, [databaseHost.ip], new Map());

    // Whole-value, because what is ABSENT is the claim. The catalog bans version
    // strings, and the real monitor's greeting is one -- the same reason this door's
    // `nc` banner is the bad-handshake error rather than a banner. A connection id
    // is missing for a second reason: the box's listener pid is per-BOX, so printing
    // it would be the same number two logins apart.
    expect(sync(result).lines).toEqual([
      { kind: 'text', content: `Connected to ${databaseHost.hostname}.` },
      { kind: 'text', content: 'Welcome to the MySQL monitor. Commands end with ;' },
    ]);
    expect(sync(result).exitCode).toBe(0);
    // The greeting alone would be a command that prints two lines and ends.
    expect(enter).toHaveBeenCalled();
  });

  it('greets with the name the box ANSWERED with, not one looked up here', async () => {
    const { databaseHost } = pickHosts();
    // Deliberately not this box's real name, and not its address either. Only the
    // server can name a box reached through a forward, because a deep address is
    // absent from the generated LAN — so the name has to come back with the answer.
    const env = mysqlEnv({ mysql: { connect: async () => ({ ok: true, hostname: 'records-186' }) } });

    const result = await mysql.execute(env, [databaseHost.ip], new Map());

    expect(linesOf(result)).toContain('Connected to records-186.');
    expect(linesOf(result)).not.toContain(databaseHost.ip);
    expect(linesOf(result)).not.toContain(databaseHost.hostname);
  });

  it('keeps the whole credential, because every statement re-sends it', async () => {
    const { databaseHost } = pickHosts();
    const enter = vi.fn();
    const env = mysqlEnv({ mysql: { connect: async () => ({ ok: true, hostname: 'db-fixture' }), enter } });

    await mysql.execute(env, [databaseHost.ip], new Map());

    // Whole-value again, and the password is the load-bearing field: there is no
    // session row to name, so a prompt that dropped it after the login could never
    // ask the daemon anything again.
    expect(enter).toHaveBeenCalledWith({
      essid: ESSID,
      targetIp: databaseHost.ip,
      port: 3306,
      username: 'readonly',
      password: 'hunter2',
      sourceIp: LOCAL_IP,
    });
  });

  it('opens no prompt when the credential is refused', async () => {
    const { databaseHost } = pickHosts();
    const enter = vi.fn();
    const env = mysqlEnv({ mysql: { connect: async () => ({ ok: false, reason: 'denied' as const, fromIp: LOCAL_IP }), enter } });

    const result = await mysql.execute(env, [databaseHost.ip], new Map());

    // The refusal already has its own test; what is new is that nothing was held.
    // A door that greets on the way to refusing leaves the player at a `mysql>` no
    // credential is behind.
    expect(enter).not.toHaveBeenCalled();
    expect(sync(result).exitCode).toBe(1);
  });

  it('documents -p as the port, which is not what the real client means by it', async () => {
    const documented = mysql.manual?.arguments?.find((argument) => argument.name === '-p');

    // The real client reads `-p` as the PASSWORD and `-P` as the port. This door
    // reads it as the port, because `ftp` and `hydra` already do and a player who
    // learned it once should not have to unlearn it here. A manual that copied the
    // real one would send them to type their password onto the command line, which
    // is the one thing this door refuses to accept there.
    expect(documented?.description).toContain('PORT');
    expect(mysql.manual?.synopsis).toBe('mysql [-p port] <host> [user]');
  });

  it('connects on the port it was handed, when that is the one the daemon holds', async () => {
    const { databaseHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');
    // Refused at the daemon, which is beside the point: the claim is that naming the
    // right port explicitly reaches the same door as naming none.
    const env = mysqlEnv({ prompt, mysql: { connect: async () => ({ ok: false, reason: 'denied' as const, fromIp: LOCAL_IP }) } });

    await mysql.execute(env, [databaseHost.ip], new Map([['-p', '3306']]));

    expect(prompt).toHaveBeenCalled();
  });

  it('refuses a port the daemon is not on, rather than quietly using the one it is', async () => {
    const { databaseHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(
      mysqlEnv({ prompt }),
      [databaseHost.ip],
      new Map([['-p', '9999']]),
    );

    // The port the PLAYER typed is the one refused. A flag that fell back to 3306
    // would connect here and never say it had ignored the number.
    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toContain(
      `ERROR 2003 (HY000): Can't connect to MySQL server on '${databaseHost.ip}:9999' (Connection refused)`,
    );
  });

  it('refuses a port another daemon holds — an open port is not this door', async () => {
    const { databaseHost } = pickHosts();
    const taken = otherServicePortOn(databaseHost);
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(
      mysqlEnv({ prompt }),
      [databaseHost.ip],
      new Map([['-p', String(taken)]]),
    );

    // This box really is listening there — on ssh or ftp. Checking that SOMETHING is
    // open would admit it, and the player would be asked for a database credential to
    // hand to a file server.
    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toContain(
      `ERROR 2003 (HY000): Can't connect to MySQL server on '${databaseHost.ip}:${taken}' (Connection refused)`,
    );
  });

  it('carries the port into the refusal for an address no host holds', async () => {
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(
      mysqlEnv({ prompt }),
      ['192.168.99.99'],
      new Map([['-p', '9999']]),
    );

    // Both refusals name the port, or one of them tells the player about a connection
    // to 3306 they never asked for.
    expect(linesOf(result)).toContain(
      "ERROR 2003 (HY000): Can't connect to MySQL server on '192.168.99.99:9999' (No route to host)",
    );
  });

  it('refuses a -p that is not a port instead of choosing one for the player', async () => {
    const { databaseHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(
      mysqlEnv({ prompt }),
      [databaseHost.ip],
      new Map([['-p', 'abc']]),
    );

    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toBe('usage: mysql [-p port] <host> [user]');
  });

  it('refuses port zero, which no daemon can be listening on', async () => {
    const { databaseHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(
      mysqlEnv({ prompt }),
      [databaseHost.ip],
      new Map([['-p', '0']]),
    );

    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toBe('usage: mysql [-p port] <host> [user]');
  });

  it('refuses a port with a fraction, which is a number but not a port', async () => {
    const { databaseHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(
      mysqlEnv({ prompt }),
      [databaseHost.ip],
      new Map([['-p', '3306.5']]),
    );

    // Deliberately a fraction of the RIGHT port. Checking only that the number is
    // positive lets this through, and the player is then refused for being on a port
    // no daemon could hold rather than told they typed one that is not a port.
    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toBe('usage: mysql [-p port] <host> [user]');
  });

  it('refuses a bare -p, which named no port at all', async () => {
    const { databaseHost } = pickHosts();
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(
      mysqlEnv({ prompt }),
      [databaseHost.ip],
      new Map([['-p', true]]),
    );

    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toBe('usage: mysql [-p port] <host> [user]');
  });

  describe('a database behind a forward', () => {
    it('sends a forwarded port on to the gateway instead of looking for the box here', async () => {
      const gateway = innerGatewayOn(ESSID);
      const prompt = vi.fn(async () => 'hunter2');
      const connect = vi.fn(async () => ({
        ok: false as const,
        reason: 'denied' as const,
        fromIp: LOCAL_IP,
      }));

      await mysql.execute(
        mysqlEnv({ prompt, mysql: { connect } }),
        [gateway.ip],
        new Map([['-p', String(FORWARD_PORT)]]),
      );

      // Nothing here can answer whether that port leads anywhere: the forward table
      // lives in the gateway's server-side journal. Pre-flighting it against this LAN
      // would refuse every deep connection, because no deep box has a LAN address.
      expect(prompt).toHaveBeenCalled();
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({ targetIp: gateway.ip, port: FORWARD_PORT }),
      );
    });

    it('holds the port it opened on, so every statement re-resolves the same forward', async () => {
      const gateway = innerGatewayOn(ESSID);
      const enter = vi.fn();
      const env = mysqlEnv({
        mysql: { connect: async () => ({ ok: true, hostname: 'records-186' }), enter },
      });

      await mysql.execute(env, [gateway.ip], new Map([['-p', String(FORWARD_PORT)]]));

      // Dropped from the held connection, the first statement would go to 3306 on the
      // GATEWAY — and a forward pulled mid-session could never drop the player either.
      expect(enter).toHaveBeenCalledWith(
        expect.objectContaining({ targetIp: gateway.ip, port: FORWARD_PORT }),
      );
    });

    it('reports a box that was not there as a connection failure, not a bad credential', async () => {
      const gateway = innerGatewayOn(ESSID);
      const env = mysqlEnv({
        mysql: { connect: async () => ({ ok: false, reason: 'unreachable' as const }) },
      });

      const result = await mysql.execute(env, [gateway.ip], new Map([['-p', String(FORWARD_PORT)]]));

      // Nothing refused the credential, because nothing was there to hear it. Saying
      // "Access denied" would tell the player their password was wrong when the truth
      // is that the port they opened forwards nowhere.
      expect(linesOf(result)).toBe(
        `ERROR 2003 (HY000): Can't connect to MySQL server on '${gateway.ip}:${FORWARD_PORT}' (No route to host)`,
      );
    });

    it('tells a stopped daemon apart from a forward that leads nowhere', async () => {
      const gateway = innerGatewayOn(ESSID);
      const env = mysqlEnv({
        mysql: { connect: async () => ({ ok: false, reason: 'refused' as const }) },
      });

      const result = await mysql.execute(env, [gateway.ip], new Map([['-p', String(FORWARD_PORT)]]));

      // The box is there and the forward is good; the daemon is not running. A player
      // who has just stopped one should read that, not "no route".
      expect(linesOf(result)).toBe(
        `ERROR 2003 (HY000): Can't connect to MySQL server on '${gateway.ip}:${FORWARD_PORT}' (Connection refused)`,
      );
    });

    it('refuses at the address the DAEMON saw, which is not the player own', async () => {
      const gateway = innerGatewayOn(ESSID);
      const env = mysqlEnv({
        mysql: {
          connect: async () => ({ ok: false, reason: 'denied' as const, fromIp: '10.42.7.1' }),
        },
      });

      const result = await mysql.execute(env, [gateway.ip], new Map([['-p', String(FORWARD_PORT)]]));

      // Behind NAT the box never saw the player's address at all, so the line it wrote
      // down names the fronting gateway's `.1`. Rendering the player's own here would
      // put the error they read and the evidence they left in disagreement.
      expect(linesOf(result)).toContain("'readonly'@'10.42.7.1'");
      expect(linesOf(result)).not.toContain(LOCAL_IP);
    });
  });

  it('names its own usage when no host is given', async () => {
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(mysqlEnv({ prompt }), [], new Map());

    expect(prompt).not.toHaveBeenCalled();
    expect(linesOf(result)).toBe('usage: mysql [-p port] <host> [user]');
  });
});
