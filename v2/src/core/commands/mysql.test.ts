import { describe, expect, it, vi } from 'vitest';
import { mysql } from './mysql';
import {
  mockCommandEnv,
  mockFsViewFromTree,
  mockIdentity,
  mockMysqlApi,
  mockNetworkViewFromConnectivity,
  mockPatchApi,
  mockScanApi,
  mockSession,
} from '../../test/factories/commandEnv';
import type { OccupantProjection } from '../network/resolveOccupants';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { isInnerGateway } from '../generation/lanHostIdentity';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { assignHomeNetwork } from '../network/homeNetwork';
import { buildColdStartConnectivity, type ConnectivityState } from '../network/interfaces';
import { runMysqlLine } from './mysqlShell';
import { applyPatches } from '../filesystem/applyPatches';
import { md5 } from '../generation/md5';
import { parseMysqlDatabase, type MysqlDatabase } from '../mysql/types';
import {
  formatMysqlAttemptLine,
  formatMysqlConnectLine,
  formatMysqlStatementLine,
  MYSQL_LOG_OWNER,
  MYSQL_LOG_PATH,
  MYSQL_LOG_PERMISSIONS,
} from '../logging/mysqlLog';
import { derivePid } from '../logging/syslog';
import { buildWorkstationBaseFs } from '../generation/workstationFs';
import { DATADIR_FILE } from '../generation/baseFs';
import { DATADIR_OWNER, DATADIR_PATH } from '../mysql/datadir';
import { ownDatabase } from '../mysql/ownDatabase';
import { formatPidfileContent, PIDFILE_PERMISSIONS, pidfilePath } from '../services/pidfile';
import {
  asAbsPath,
  asEpochMs,
  asGameTime,
  asMachineId,
  asNetworkAddress,
  asPlayerKeyHex,
  type AbsPath,
  type UserType,
} from '../types';
import type { Directory, FilePermissions } from '../filesystem/types';
import type { CommandResult, FsView, MysqlApi, MysqlConnectParams, PatchApi } from './types';

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

const onlineConnectivity = (essid: string, pubkey: string = PUBKEY): ConnectivityState => {
  const cold = buildColdStartConnectivity(pubkey);
  const wlan0 = cold.interfaces.get('wlan0');
  if (wlan0 === undefined || wlan0.kind !== 'wireless') throw new Error('no wlan0');
  const { localIp } = assignHomeNetwork(pubkey, essid);
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
  /** Fellow occupants of the ESSID. Defaults to none, so every own-LAN test keeps
   *  seeing the generated world exactly as it did. */
  readonly occupants?: readonly OccupantProjection[];
};

/** A fellow occupant of this ESSID, as the signed occupant read hands them back. */
const occupantAt = (localIp: string): OccupantProjection => ({
  workstation_machine_id: 'alice-rig-cafef00d',
  localIp: asNetworkAddress(localIp),
  machineName: 'alice-rig',
});

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
    scan: mockScanApi({ resolveOccupants: async () => over.occupants ?? [] }),
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

  it('asks the server about a public address rather than refusing it locally', async () => {
    // A public address names somebody else's access point, and which box sits behind
    // which forward lives in that gateway's server-side journal. The client can see
    // none of it, so pre-flighting the way it does on its own LAN would refuse every
    // cross-player database in the game before the player finished typing.
    const connect = vi.fn(async () => ({ ok: false as const, reason: 'denied' as const, fromIp: LOCAL_IP }));

    await mysql.execute(mysqlEnv({ mysql: { connect } }), ['203.0.113.9'], new Map([['-p', '43306']]));

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ targetIp: '203.0.113.9', port: 43306 }),
    );
  });


  it('asks the server about a fellow occupant rather than refusing them locally', async () => {
    const connect = vi.fn(async () => ({ ok: false as const, reason: 'denied' as const, fromIp: LOCAL_IP }));
    const occupant = occupantAt('192.168.29.42');

    await mysql.execute(mysqlEnv({ mysql: { connect }, occupants: [occupant] }), [occupant.localIp], new Map());

    // A fellow player's box is absent from the generated world, so pre-flighting
    // against it would refuse every neighbour in the game before the player finished
    // typing. What is behind their address is theirs to answer.
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ targetIp: occupant.localIp, port: 3306 }),
    );
  });

  it('asks the server even where a generated sibling stands on the occupant address', async () => {
    const { noDatabaseHost } = pickHosts();
    const connect = vi.fn(async () => ({ ok: false as const, reason: 'denied' as const, fromIp: LOCAL_IP }));
    const occupant = occupantAt(noDatabaseHost.ip);

    await mysql.execute(mysqlEnv({ mysql: { connect }, occupants: [occupant] }), [occupant.localIp], new Map());

    // The seeded box runs no database and would be refused out of hand. A real
    // occupant beats it on that octet — the precedence `nmap` renders — so the
    // question goes to the server rather than being answered from a world the player
    // has already been shown is out of date.
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ targetIp: occupant.localIp, port: 3306 }),
    );
  });

  it('still answers for its own LAN when the neighbour is at another address', async () => {
    const { noDatabaseHost } = pickHosts();
    const connect = vi.fn(async () => ({ ok: false as const, reason: 'denied' as const, fromIp: LOCAL_IP }));
    const prompt = vi.fn(async () => 'hunter2');

    const result = await mysql.execute(
      mysqlEnv({ mysql: { connect }, prompt, occupants: [occupantAt('192.168.29.42')] }),
      [noDatabaseHost.ip],
      new Map(),
    );

    // Somebody being on the WiFi is not somebody being at THIS address. The generated
    // box standing here runs no database, and the player is told so before typing a
    // password rather than after a round trip.
    expect(prompt).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(linesOf(result)).toContain('Connection refused');
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
      { kind: 'text', content: 'Welcome to the MySQL monitor. Type help for commands.' },
    ]);
    expect(sync(result).exitCode).toBe(0);
    // The greeting alone would be a command that prints two lines and ends.
    expect(enter).toHaveBeenCalled();
  });

  it('never tells the player a statement has to end with a semicolon', async () => {
    // The real monitor's banner says commands end with `;`, and this door's parser
    // does not care either way -- so printing it would be the greeting inventing a
    // rule nothing enforces, and a player who trusts it types one every time.
    const { databaseHost } = pickHosts();
    const env = mysqlEnv({
      mysql: { connect: async () => ({ ok: true, hostname: databaseHost.hostname }) },
    });

    const result = await mysql.execute(env, [databaseHost.ip], new Map());

    expect(sync(result).lines.map((line) => line.content).join(' ')).not.toContain('end with ;');
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

/**
 * The same door, from your own chair.
 *
 * Everything above reaches somebody else's box, and the server decides what happens
 * there because the client asking must not be trusted with another player's data.
 * Your own box has nothing to protect from you: you are root on it and can open the
 * datadir in an editor. So the whole conversation stays here, and what differs from
 * an attacker's path is where the decision runs, never what it decides — the same
 * `credentialIn`, the same `runStatement`, the same log formatters.
 *
 * These tests drive the real command and the real prompt over a real workstation tree
 * carrying the datadir `apt install mysql` lays down and the pidfile `mysqld` writes,
 * so a door that opens here is one the player really bought and really started. The
 * server seam is left unimplemented throughout: a statement that took the cross-network
 * path throws instead of quietly passing.
 */
describe('the database on your own box', () => {
  const OWN_CONFIG = { machineName: 'workstation', username: 'alice', rootPassword: 'hunter2' };

  /** An owner whose database draws all three rungs. Roughly half of them do, and the
   *  bottom one cannot be demonstrated on a database that has no read-only account —
   *  so this is a fixture choice, asserted below rather than assumed. */
  const LADDER_KEY = '2'.repeat(64);

  /** The server door, deliberately unreachable. A statement against your own box that
   *  took the cross-network path would throw here rather than quietly pass. */
  const NOT_WIRED = () => {
    throw new Error('own-box mysql must not reach the server');
  };

  /** The same drawn accounts under a password the test can type. ONLY the hash moves:
   *  the usernames and the tiers stay the generator's, because the tier is the thing
   *  the ladder is read from and inventing one would prove nothing. */
  const typeable = (database: MysqlDatabase): MysqlDatabase => ({
    ...database,
    credentials: database.credentials.map((credential) => ({
      ...credential,
      passwordHash: md5(OWN_CONFIG.rootPassword),
    })),
  });

  /** The box after buying a database and starting the daemon. Both files come from the
   *  production code that writes them rather than being typed here, so a change to
   *  either format arrives in this fixture instead of drifting past it. */
  const runningDatabaseBox = (
    opts: { readonly ownerKey?: string; readonly database?: MysqlDatabase } = {},
  ): Directory => {
    const ownerKey = opts.ownerKey ?? PUBKEY;
    const base = buildWorkstationBaseFs(ownerKey, OWN_CONFIG);
    const database =
      opts.database ??
      ownDatabase({ ownerKeyHex: ownerKey, hostname: OWN_CONFIG.machineName, fs: base });
    return applyPatches(base, [
      {
        path: DATADIR_PATH,
        content: JSON.stringify(database),
        owner: DATADIR_OWNER,
        permissions: DATADIR_FILE,
      },
      {
        path: pidfilePath(SERVICE_CATALOG.mysql),
        content: formatPidfileContent(SERVICE_CATALOG.mysql, SERVICE_CATALOG.mysql.defaultPort),
        owner: 'root',
        permissions: PIDFILE_PERMISSIONS,
      },
      // The box's own sshd, up as it is on any workstation. A second daemon is not
      // decoration: a door that only counted OPEN ports would open a database prompt
      // onto 22, and a box running nothing else could never show it.
      {
        path: pidfilePath(SERVICE_CATALOG.ssh),
        content: formatPidfileContent(SERVICE_CATALOG.ssh, SERVICE_CATALOG.ssh.defaultPort),
        owner: 'root',
        permissions: PIDFILE_PERMISSIONS,
      },
    ]);
  };

  /** A box whose filesystem changes under a command mid-run, the way a real one does:
   *  `env.fs` reads live signals, so a `systemctl stop` or an edit in another tab is
   *  visible to the very next read rather than at the next command. */
  const liveBox = (initial: Directory, userType: UserType = 'user') => {
    let tree = initial;
    const view = () => mockFsViewFromTree(tree, { userType, cwd: () => asAbsPath('/') });
    return {
      become: (next: Directory) => {
        tree = next;
      },
      fs: {
        cwd: () => asAbsPath('/'),
        read: (path: AbsPath) => view().read(path),
        list: (path: AbsPath) => view().list(path),
        stat: (path: AbsPath) => view().stat(path),
        canWrite: (path: AbsPath) => view().canWrite(path),
        root: () => tree,
        // Re-reading this box reaches whatever it has become, which is the whole point
        // of the seam: the machine is the authority, not a copy taken on the way in.
        reload: async () => view(),
      } satisfies FsView,
    };
  };

  /** Bought but never started: the datadir is there and the door is not. */
  const boughtButNotStarted = (): Directory =>
    applyPatches(buildWorkstationBaseFs(PUBKEY, OWN_CONFIG), [
      {
        path: DATADIR_PATH,
        content: JSON.stringify(databaseOf(PUBKEY)),
        owner: DATADIR_OWNER,
        permissions: DATADIR_FILE,
      },
    ]);

  /** The drawn account at one rung of the ladder. Thrown for rather than skipped: a
   *  database missing a rung has to fail here, not quietly test two thirds of one. */
  const accountAt = (database: MysqlDatabase, tier: UserType): string => {
    const credential = database.credentials.find((each) => each.userType === tier);
    if (credential === undefined) throw new Error(`the fixture database has no ${tier} account`);
    return credential.username;
  };

  /** The database this box serves, drawn the way the box's own datadir was. */
  const databaseOf = (ownerKey: string): MysqlDatabase =>
    ownDatabase({
      ownerKeyHex: ownerKey,
      hostname: OWN_CONFIG.machineName,
      fs: buildWorkstationBaseFs(ownerKey, OWN_CONFIG),
    });

  type WriteCall = {
    readonly path: string;
    readonly content: string;
    readonly options:
      | {
          readonly isNew?: boolean;
          readonly owner?: string;
          readonly permissions?: FilePermissions;
        }
      | undefined;
  };

  type OwnEnvOpts = {
    readonly ownerKey?: string;
    readonly tree?: Directory;
    /** A filesystem that answers differently as the run goes on, for the races a
     *  fixed tree cannot show. */
    readonly fs?: FsView;
    readonly userType?: UserType;
    readonly prompt?: (opts: { message: string; masked: boolean }) => Promise<string>;
    readonly onEnter?: (connection: MysqlConnectParams) => void;
    readonly write?: PatchApi['write'];
  };

  /** An env standing on the player's own box, with a `patches.write` spy — the only
   *  thing this path may reach beyond the terminal. */
  const ownEnv = (opts: OwnEnvOpts = {}) => {
    const ownerKey = opts.ownerKey ?? PUBKEY;
    const userType = opts.userType ?? 'user';
    const tree = opts.tree ?? runningDatabaseBox({ ownerKey });
    const writes: WriteCall[] = [];
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(ownerKey) }),
      hostname: OWN_CONFIG.machineName,
      network: mockNetworkViewFromConnectivity(onlineConnectivity(ESSID, ownerKey)),
      session: mockSession({ username: OWN_CONFIG.username, userType }),
      now: () => asEpochMs(NOW),
      fs: opts.fs ?? mockFsViewFromTree(tree, { userType, cwd: () => asAbsPath('/') }),
      patches: {
        ...mockPatchApi(),
        write:
          opts.write ??
          (async (path, content, options) => {
            writes.push({ path, content, options });
            return { ok: true };
          }),
      },
      mysql: {
        connect: NOT_WIRED,
        enter: opts.onEnter ?? (() => undefined),
        leave: () => undefined,
        run: NOT_WIRED,
      },
      prompt:
        opts.prompt ?? (async ({ masked }) => (masked ? OWN_CONFIG.rootPassword : 'root')),
    });
    return { env, writes };
  };

  /** Open the door and hand back the prompt, so a statement test starts where a player
   *  starts: at `mysql>` holding whatever the connect step really held. */
  const atPrompt = async (opts: OwnEnvOpts & { readonly account?: string } = {}) => {
    const held: MysqlConnectParams[] = [];
    const { env, writes } = ownEnv({ ...opts, onEnter: (connection) => held.push(connection) });
    const opened = await mysql.execute(env, ['localhost', opts.account ?? 'root'], new Map());
    const connection = held[0];
    if (connection === undefined) throw new Error(`never opened: ${linesOf(opened)}`);
    // The connect line is the story of the test above; a statement test starts from a
    // clean sheet so what it asserts about is only what its own statement wrote.
    writes.length = 0;
    return {
      env,
      writes,
      run: (line: string) => runMysqlLine(env, line, connection),
    };
  };

  /** What every kind of eviction reads as at the prompt: the box gone, the daemon
   *  stopped, the credential no longer valid. One condition from where the player is
   *  sitting, and telling them apart would report on their own tampering. */
  const LOST_CONNECTION = 'ERROR 2013 (HY000): Lost connection to MySQL server during query';

  /** At `mysql>` on a box that can still change underneath the prompt. `become` takes
   *  either a whole datadir or the bytes to leave in its place. */
  const atLivePrompt = async ({
    database,
    account,
  }: {
    readonly database: MysqlDatabase;
    readonly account: string;
  }) => {
    const box = liveBox(runningDatabaseBox({ ownerKey: LADDER_KEY, database }));
    const held: MysqlConnectParams[] = [];
    const { env } = ownEnv({
      ownerKey: LADDER_KEY,
      fs: box.fs,
      onEnter: (connection) => held.push(connection),
    });
    const opened = await mysql.execute(env, ['localhost', account], new Map());
    const connection = held[0];
    if (connection === undefined) throw new Error(`never opened: ${linesOf(opened)}`);
    return {
      become: (datadir: MysqlDatabase | string) =>
        box.become(
          applyPatches(runningDatabaseBox({ ownerKey: LADDER_KEY, database }), [
            {
              path: DATADIR_PATH,
              content: typeof datadir === 'string' ? datadir : JSON.stringify(datadir),
              owner: DATADIR_OWNER,
              permissions: DATADIR_FILE,
            },
          ]),
        ),
      run: (line: string) => runMysqlLine(env, line, connection),
    };
  };

  const logWrites = (writes: readonly WriteCall[]) =>
    writes.filter((write) => write.path === MYSQL_LOG_PATH);

  const lastLogLine = (writes: readonly WriteCall[]): string => {
    const written = logWrites(writes).at(-1);
    if (written === undefined) throw new Error('nothing was written to mysql.log');
    return written.content.trimEnd().split('\n').at(-1) ?? '';
  };

  it('opens the database when you name your own box by any of its names', async () => {
    for (const name of ['localhost', '127.0.0.1', LOCAL_IP]) {
      const { env } = ownEnv();

      const result = await mysql.execute(env, [name, 'root'], new Map());

      // One leased address under three names, exactly as the web door reads them — a
      // box that answered to `localhost` but not to the address it was given would be
      // two machines to its own owner.
      expect(linesOf(result)).toContain(`Connected to ${OWN_CONFIG.machineName}.`);
    }
  });

  it('holds the connection under the address it was leased, not the name typed', async () => {
    const held: MysqlConnectParams[] = [];
    const { env } = ownEnv({ onEnter: (connection) => held.push(connection) });

    await mysql.execute(env, ['localhost', 'root'], new Map());

    // One machine under one name. `localhost` names no machine to anybody but us, so a
    // prompt that kept the word rather than the address would be holding a connection
    // that means something different from the line the daemon just wrote down — and
    // the statements after it would be resolving a different question each time.
    expect(held[0]?.targetIp).toBe(LOCAL_IP);
    expect(held[0]?.sourceIp).toBe('127.0.0.1');
  });

  it('refuses before asking for anything when the daemon is not running', async () => {
    const prompt = vi.fn(async () => OWN_CONFIG.rootPassword);
    const { env, writes } = ownEnv({ tree: boughtButNotStarted(), prompt });

    const result = await mysql.execute(env, ['localhost'], new Map());

    expect(linesOf(result)).toBe(
      "ERROR 2003 (HY000): Can't connect to MySQL server on 'localhost:3306' (Connection refused)",
    );
    // The same silence a stranger's shut door earns, and for the same reason: a
    // credential typed at a daemon that is not there is a credential given away.
    expect(prompt).not.toHaveBeenCalled();
    // And nothing to read afterwards. A refusal decided before the daemon exists is
    // not the daemon's to record.
    expect(writes).toEqual([]);
  });

  it('refuses a port its own daemon is not holding', async () => {
    const prompt = vi.fn(async () => OWN_CONFIG.rootPassword);
    const { env } = ownEnv({ prompt });

    const result = await mysql.execute(env, ['localhost'], new Map([['-p', '3307']]));

    // The door is open on 3306 and this is not 3306. Your own box is no more lenient
    // about which port a daemon holds than anyone else's.
    expect(linesOf(result)).toContain("on 'localhost:3307' (Connection refused)");
    expect(prompt).not.toHaveBeenCalled();
  });

  it('records the connection it accepted in its own log, sourced from loopback', async () => {
    const { env, writes } = ownEnv();

    await mysql.execute(env, ['localhost', 'root'], new Map());

    // A daemon that recorded strangers but not its owner would be one that knows which
    // is which — and the defender's skill is telling `127.0.0.1` from an address that
    // is not theirs, which is worth less if the file arrives pre-filtered.
    expect(lastLogLine(writes)).toBe(
      formatMysqlConnectLine({
        user: 'root',
        fromIp: '127.0.0.1',
        time: asGameTime(asEpochMs(NOW)),
        pid: derivePid(NOW),
        database: databaseOf(PUBKEY).name,
      }),
    );
  });

  it('records the LAN address when that is the one they typed', async () => {
    const { env, writes } = ownEnv();

    await mysql.execute(env, [LOCAL_IP, 'root'], new Map());

    // Three names for one box, two sources: a connection that came in over loopback
    // says so, and one addressed to the leased address is written down as arriving
    // there — the same split `curl` makes on the same box.
    expect(lastLogLine(writes)).toContain(`root@${LOCAL_IP} on `);
  });

  it('records a refused credential without naming the database it did not reach', async () => {
    const { env, writes } = ownEnv({ prompt: async () => 'not-the-password' });

    const result = await mysql.execute(env, ['localhost', 'root'], new Map());

    expect(linesOf(result)).toBe(
      "ERROR 1045 (28000): Access denied for user 'root'@'127.0.0.1' (using password: YES)",
    );
    // A client that never authenticated was never told which database it would have
    // reached, so the refusal cannot name one. That difference is the signal: a wall of
    // denials followed by one Connect naming a database is a sweep that landed.
    expect(lastLogLine(writes)).toBe(
      formatMysqlAttemptLine({
        outcome: 'failure',
        user: 'root',
        fromIp: '127.0.0.1',
        hostname: OWN_CONFIG.machineName,
        time: asGameTime(asEpochMs(NOW)),
        pid: derivePid(NOW),
      }),
    );
    expect(lastLogLine(writes)).not.toContain(databaseOf(PUBKEY).name);
  });

  it('creates the log root-owned with the catalog permissions, whatever tier you are', async () => {
    // A user-tier shell: the write is the DAEMON's, and mysqld runs as root. A line
    // that inherited the shell's owner would hand the box's ordinary user a file the
    // world is supposed to have to get root for.
    const { env, writes } = ownEnv({ userType: 'user' });

    await mysql.execute(env, ['localhost', 'root'], new Map());

    expect(logWrites(writes)).toEqual([
      {
        path: MYSQL_LOG_PATH,
        content: expect.any(String),
        // Marked new because a workstation is seeded without one: the file does not
        // exist until the daemon has something to say.
        options: {
          isNew: true,
          owner: MYSQL_LOG_OWNER,
          permissions: MYSQL_LOG_PERMISSIONS,
        },
      },
    ]);
  });

  it('appends to the log it already has rather than replacing it', async () => {
    const earlier = '2026-01-01T00:00:00.000000Z\t1 Connect\tsomebody@10.0.0.9 on main using TCP/IP';
    const withHistory = applyPatches(runningDatabaseBox(), [
      {
        path: MYSQL_LOG_PATH,
        content: `${earlier}\n`,
        owner: MYSQL_LOG_OWNER,
        permissions: MYSQL_LOG_PERMISSIONS,
      },
    ]);
    const { env, writes } = ownEnv({ tree: withHistory });

    await mysql.execute(env, ['localhost', 'root'], new Map());

    const written = logWrites(writes).at(-1);
    expect(written?.content.split('\n').filter(Boolean)).toHaveLength(2);
    expect(written?.content).toContain(earlier);
    // An existing file is not a new one, so the row keeps whatever `is_new` it had —
    // and a later `rm` of the log does the right thing about the base tree.
    expect(written?.options?.isNew).toBeUndefined();
  });

  /** A client holding a STALE copy of its own box. Another occupant has written to the
   *  machine since this client last pulled its journal, so what the machine holds and
   *  what this client can see have diverged — which is the ordinary state of a box
   *  somebody else is standing on, because nothing pushes their writes here. */
  const staleClient = (
    client: Directory,
    machine: Directory,
    userType: UserType = 'user',
  ): FsView => {
    const view = (tree: Directory) =>
      mockFsViewFromTree(tree, { userType, cwd: () => asAbsPath('/') });
    return { ...view(client), reload: async () => view(machine) };
  };

  /** The line an intruder's connection left on this box while the player was typing. */
  const INTRUDER_LOG_LINE =
    '2026-01-01T00:00:00.000000Z\t7\tConnect\tapp_rw@192.168.1.9 on ops_prod using TCP/IP';

  const boxWithIntruderLogLine = (): Directory =>
    applyPatches(runningDatabaseBox(), [
      {
        path: MYSQL_LOG_PATH,
        content: `${INTRUDER_LOG_LINE}\n`,
        owner: MYSQL_LOG_OWNER,
        permissions: MYSQL_LOG_PERMISSIONS,
      },
    ]);

  it('records a connect on the log the MACHINE holds, not on the copy this client pulled', async () => {
    const { env, writes } = ownEnv({
      fs: staleClient(runningDatabaseBox(), boxWithIntruderLogLine()),
    });

    await mysql.execute(env, ['localhost', 'root'], new Map());

    // The intruder's line was written while the player was typing their password. A
    // daemon that composed from the client's copy would replace the file with a
    // history the intrusion is missing from — and this file IS the defender's
    // evidence, so losing it to their own login is the worst way to lose it.
    expect(logWrites(writes).at(-1)?.content).toContain(INTRUDER_LOG_LINE);
  });

  it('records a statement on the log the MACHINE holds, not on the copy this client pulled', async () => {
    const { writes, run } = await atPrompt({
      fs: staleClient(runningDatabaseBox(), boxWithIntruderLogLine()),
    });

    await run("UPDATE users SET role='auditor' WHERE id='1';");

    expect(logWrites(writes).at(-1)?.content).toContain(INTRUDER_LOG_LINE);
  });

  /** The same database with one row changed by somebody else — the write this client
   *  never saw, and the one its own next write is in a position to erase. */
  const withIntruderRow = (database: MysqlDatabase): MysqlDatabase => {
    const users = database.tables.users;
    if (users === undefined) throw new Error('the fixture database has no users table');
    if (users.rows.length < 2) throw new Error('the fixture users table has too few rows');
    return {
      ...database,
      tables: {
        ...database.tables,
        users: {
          ...users,
          rows: users.rows.map((row, index) =>
            index === 1 ? { ...row, role: 'intruder' } : row,
          ),
        },
      },
    };
  };

  it('composes a write over the datadir the MACHINE holds, not the copy this client pulled', async () => {
    const ownerKey = LADDER_KEY;
    const database = typeable(databaseOf(ownerKey));
    const { writes, run } = await atPrompt({
      ownerKey,
      account: accountAt(database, 'user'),
      fs: staleClient(
        runningDatabaseBox({ ownerKey, database }),
        runningDatabaseBox({ ownerKey, database: withIntruderRow(database) }),
      ),
    });

    await run("UPDATE users SET role='auditor' WHERE id='1';");

    // Both edits stand. The datadir is one document several people are editing, and a
    // write composed against a stale copy does not merely lose the other edit — it
    // silently REVERTS it, which reads to the intruder as the game losing their work
    // and to the owner as nothing having happened at all.
    const rows = parseMysqlDatabase(writes.find((write) => write.path === DATADIR_PATH)?.content ?? '')
      ?.tables.users?.rows;
    expect(rows?.[0]?.role).toBe('auditor');
    expect(rows?.[1]?.role).toBe('intruder');
  });

  it('answers a read without writing anything down', async () => {
    const { writes, run } = await atPrompt();

    const result = await run('SELECT * FROM users;');

    expect(sync(result).exitCode).toBe(0);
    expect(linesOf(result)).toContain('rows in set');
    // Reads are the one thing this file stays quiet about: a log that recorded every
    // SELECT would bury the two events a defender is actually looking for.
    expect(writes).toEqual([]);
  });

  it('lets the application account change a row, and writes the datadir back as root', async () => {
    const ownerKey = LADDER_KEY;
    const database = typeable(databaseOf(ownerKey));
    const { writes, run } = await atPrompt({
      ownerKey,
      tree: runningDatabaseBox({ ownerKey, database }),
      account: accountAt(database, 'user'),
      userType: 'user',
    });

    const result = await run("UPDATE users SET role='auditor' WHERE id='1';");

    expect(linesOf(result)).toContain('Query OK, 1 row affected');
    const datadir = writes.find((write) => write.path === DATADIR_PATH);
    // Root's, and it has to STAY root's through a rewrite: this is the file holding the
    // hashes a sweep has to work for, and a write that widened it would hand every tier
    // on the box the answer key with nothing about the statement looking different.
    expect(datadir?.options).toEqual({
      owner: DATADIR_OWNER,
      permissions: DATADIR_FILE,
    });
    expect(parseMysqlDatabase(datadir?.content ?? '')?.tables.users?.rows[0]?.role).toBe('auditor');
  });

  it('records a change as a Query line naming the statement that made it', async () => {
    const ownerKey = LADDER_KEY;
    const database = typeable(databaseOf(ownerKey));
    const { writes, run } = await atPrompt({
      ownerKey,
      tree: runningDatabaseBox({ ownerKey, database }),
      account: accountAt(database, 'user'),
    });

    await run("UPDATE users SET role='auditor' WHERE id='1';");

    expect(lastLogLine(writes)).toBe(
      formatMysqlStatementLine({
        time: asGameTime(asEpochMs(NOW)),
        pid: derivePid(NOW),
        tag: 'Query',
        detail: "UPDATE users SET role='auditor' WHERE id='1'",
      }),
    );
  });

  it('refuses the read-only account a write, and records the refusal', async () => {
    const ownerKey = LADDER_KEY;
    const database = typeable(databaseOf(ownerKey));
    // The fixture's whole point: without a guest account the bottom rung is untested
    // and this would read as passing.
    expect(accountAt(database, 'guest')).toBe('readonly');
    const { writes, run } = await atPrompt({
      ownerKey,
      tree: runningDatabaseBox({ ownerKey, database }),
      account: accountAt(database, 'guest'),
      // Root on the BOX and read-only in the DATABASE at the same time. The ladder is
      // the datadir's, never the shell's — the two are separate locks.
      userType: 'root',
    });

    const result = await run("UPDATE users SET role='auditor' WHERE id='1';");

    expect(sync(result).exitCode).toBe(1);
    expect(linesOf(result)).toContain('command denied');
    // Nothing changed, so nothing is written back — and the refusal is recorded, which
    // is the line that tells a defender somebody was pushing at the ladder.
    expect(writes.some((write) => write.path === DATADIR_PATH)).toBe(false);
    expect(lastLogLine(writes)).toContain('Denied');
  });

  it('keeps DROP TABLE for the database root, on your box as on anyone else', async () => {
    const ownerKey = LADDER_KEY;
    const database = typeable(databaseOf(ownerKey));
    const asApplication = await atPrompt({
      ownerKey,
      tree: runningDatabaseBox({ ownerKey, database }),
      account: accountAt(database, 'user'),
    });

    const refused = await asApplication.run('DROP TABLE users;');

    expect(sync(refused).exitCode).toBe(1);
    expect(asApplication.writes.some((write) => write.path === DATADIR_PATH)).toBe(false);

    const asRoot = await atPrompt({
      ownerKey,
      tree: runningDatabaseBox({ ownerKey, database }),
      account: 'root',
    });

    const dropped = await asRoot.run('DROP TABLE users;');

    // The other half: a ladder that refused everyone would pass the assertion above
    // and leave the top rung unreachable.
    expect(sync(dropped).exitCode).toBe(0);
    const datadir = asRoot.writes.find((write) => write.path === DATADIR_PATH);
    expect(parseMysqlDatabase(datadir?.content ?? '')?.tables.users).toBeUndefined();
  });

  it('drops the prompt when the daemon is stopped underneath it', async () => {
    const held: MysqlConnectParams[] = [];
    const { env } = ownEnv({ onEnter: (connection) => held.push(connection) });
    const opened = await mysql.execute(env, ['localhost', 'root'], new Map());
    const connection = held[0];
    if (connection === undefined) throw new Error(`never opened: ${linesOf(opened)}`);
    // `systemctl stop mysqld` while the prompt is open: same box, same datadir, no
    // pidfile. There is no session row to invalidate and no push channel, so the next
    // statement is the only thing that can discover it.
    const stopped = ownEnv({ tree: boughtButNotStarted() }).env;

    const result = await runMysqlLine(stopped, 'SELECT * FROM users;', connection);

    expect(linesOf(result)).toBe(LOST_CONNECTION);
  });

  it('tells the player nothing changed when the change could not be recorded', async () => {
    const ownerKey = LADDER_KEY;
    const database = typeable(databaseOf(ownerKey));
    const { run } = await atPrompt({
      ownerKey,
      tree: runningDatabaseBox({ ownerKey, database }),
      account: accountAt(database, 'user'),
      write: async () => ({ ok: false, error: 'network_error' }),
    });

    const result = await run("UPDATE users SET role='auditor' WHERE id='1';");

    // A write that cannot be recorded is a write that did not happen. `Query OK` over a
    // journal that never took it would show them their old rows on the next statement
    // and read as the game losing writes.
    expect(linesOf(result)).toBe(LOST_CONNECTION);
  });

  it('refuses a port another daemon on the box is holding', async () => {
    const prompt = vi.fn(async () => OWN_CONFIG.rootPassword);
    const { env } = ownEnv({ prompt });

    const result = await mysql.execute(
      env,
      ['localhost'],
      new Map([['-p', String(SERVICE_CATALOG.ssh.defaultPort)]]),
    );

    // A port is not a door until the right daemon is behind it. The box's own sshd is
    // listening there, and a check that only counted open ports would open a database
    // prompt onto it.
    expect(linesOf(result)).toContain(
      `on 'localhost:${SERVICE_CATALOG.ssh.defaultPort}' (Connection refused)`,
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it('refuses an account the database never had in the same words as a wrong password', async () => {
    const { env, writes } = ownEnv();

    const result = await mysql.execute(env, ['localhost', 'nobody'], new Map());

    // Byte for byte the refusal a wrong password earns. An error that told them apart
    // would let anyone standing at this prompt enumerate the account list by typing
    // names at it — and on your own box that is a rehearsal for somebody else's.
    expect(linesOf(result)).toBe(
      "ERROR 1045 (28000): Access denied for user 'nobody'@'127.0.0.1' (using password: YES)",
    );
    expect(lastLogLine(writes)).toContain(
      "Access denied for user 'nobody'@'127.0.0.1' (using password: YES)",
    );
  });

  it('does not open a door that was closed while the password was being typed', async () => {
    const box = liveBox(runningDatabaseBox());
    const { env, writes } = ownEnv({
      fs: box.fs,
      // `systemctl stop mysqld` in another tab, after this client checked the door and
      // before the player finished typing. The pre-flight is not a promise.
      prompt: async ({ masked }) => {
        if (masked) box.become(boughtButNotStarted());
        return OWN_CONFIG.rootPassword;
      },
    });

    const result = await mysql.execute(env, ['localhost', 'root'], new Map());

    expect(linesOf(result)).toBe(
      "ERROR 2003 (HY000): Can't connect to MySQL server on 'localhost:3306' (Connection refused)",
    );
    // And nothing written down: the daemon that would have recorded the attempt is the
    // one that is no longer running.
    expect(writes).toEqual([]);
  });

  it('drops the prompt when the account is deleted from the datadir under it', async () => {
    const database = typeable(databaseOf(LADDER_KEY));
    const account = accountAt(database, 'user');
    const { become, run } = await atLivePrompt({ database, account });

    // Root editing their own datadir — the same file `cat` shows them. There is no
    // session row remembering who logged in, so the next statement is where it bites.
    become({
      ...database,
      credentials: database.credentials.filter((each) => each.username !== account),
    });
    const result = await run('SELECT * FROM users;');

    expect(linesOf(result)).toBe(LOST_CONNECTION);
  });

  it('drops the prompt when the account password is changed under it', async () => {
    const database = typeable(databaseOf(LADDER_KEY));
    const account = accountAt(database, 'user');
    const { become, run } = await atLivePrompt({ database, account });

    become({
      ...database,
      credentials: database.credentials.map((each) =>
        each.username === account ? { ...each, passwordHash: md5('a-different-password') } : each,
      ),
    });
    const result = await run('SELECT * FROM users;');

    // The credential travels with every statement precisely so this can happen: what
    // was accepted a moment ago is re-checked rather than remembered.
    expect(linesOf(result)).toBe(LOST_CONNECTION);
  });

  it('drops the prompt when the datadir stops being a database at all', async () => {
    const database = typeable(databaseOf(LADDER_KEY));
    const { become, run } = await atLivePrompt({
      database,
      account: accountAt(database, 'user'),
    });

    // `echo nonsense > /var/lib/mysql/data.json`, which root on their own box can do.
    // A daemon that carried on answering out of what it read at login would be serving
    // a database the box no longer holds.
    become('not a database at all');
    const result = await run('SELECT * FROM users;');

    expect(linesOf(result)).toBe(LOST_CONNECTION);
  });

  it('drops the line rather than clobbering a log it could not read', async () => {
    // `mkdir /var/log/mysql.log` — a real thing root can do to their own box, and the
    // one case where the read fails without the file being absent.
    const occupied = applyPatches(runningDatabaseBox(), [
      {
        path: MYSQL_LOG_PATH,
        content: null,
        owner: 'root',
        permissions: MYSQL_LOG_PERMISSIONS,
        nodeType: 'directory',
      },
    ]);
    const { env, writes } = ownEnv({ tree: occupied });

    const result = await mysql.execute(env, ['localhost', 'root'], new Map());

    // The connection still stands — logging must never break the thing it records —
    // but replacing whatever is there with one line is worse than saying nothing.
    expect(linesOf(result)).toContain(`Connected to ${OWN_CONFIG.machineName}.`);
    expect(writes).toEqual([]);
  });
});
