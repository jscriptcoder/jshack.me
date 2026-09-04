/**
 * Finding a generated box that serves a database, and a credential that opens it.
 *
 * Both doors that speak to a database — the login and the statement behind it —
 * need the same two things, and they need them derived from the generator rather
 * than hand-written: a fixture that invents a host and a password proves the
 * handler agrees with the fixture, not that it agrees with the game.
 *
 * "Knowing" a password is not cracking one. The generator draws every password from
 * a fixed pool, so a test can recover the plaintext behind a stored hash by matching
 * the pool — which is a thing only a test standing outside the game can do.
 */

import { generateHomeLan, type LanHost } from '../../core/generation/generateHomeLan';
import { crackableEssidPool } from '../../core/generation/generateWifi';
import { generateDeepLayer, type DeepLayer } from '../../core/generation/generateDeepLayer';
import { buildDeepHostFs } from '../../core/generation/deepHostFs';
import { computeInnerGatewayId } from '../../core/identity/router';
import { hostMachineId } from '../../core/generation/remoteHostId';
import { databaseIn } from '../../core/mysql/datadir';
import { readOpenPorts } from '../../core/services/pidfile';
import { hostServices } from '../../core/generation/remoteHostFs';
import { resolveLanHostIdentity } from '../../core/generation/lanHostIdentity';
import { ALL_GENERATED_PASSWORDS } from '../../core/generation/passwordPools';
import { SERVICE_CATALOG } from '../../core/services/serviceCatalog';
import { md5 } from '../../core/generation/md5';
import { parseMysqlDatabase, type MysqlDatabase } from '../../core/mysql/types';
import { ownDatabase } from '../../core/mysql/ownDatabase';
import { materializeWorkstationFs } from '../../core/network/materializeWorkstationFs';
import type { NatOccupantRow } from '../../core/network/resolvePublicTarget';
import type { Directory } from '../../core/filesystem/types';

/** A LAN host running mysqld — the only kind with a database to open. */
export const mysqlHostOn = (essid: string): LanHost => {
  const host = generateHomeLan(essid).hosts.find(
    (candidate) =>
      candidate.kind === 'machine' &&
      hostServices(essid, candidate).some(({ spec }) => spec === SERVICE_CATALOG.mysql),
  );
  if (host === undefined) throw new Error(`no mysql-running host on ${essid}`);
  return host;
};

const fileOn = (
  essid: string,
  host: LanHost,
  segments: readonly string[],
): string | undefined => {
  const parent = segments.slice(0, -1).reduce<Directory | undefined>((node, segment) => {
    const next = node?.entries.get(segment);
    return next !== undefined && next.kind === 'directory' ? next : undefined;
  }, resolveLanHostIdentity(host, essid).baseFs);
  const leaf = parent?.entries.get(segments.at(-1) ?? '');
  return leaf !== undefined && leaf.kind === 'file' ? leaf.content : undefined;
};

/** The database a generated box serves, read back off its own seeded datadir. */
export const databaseOn = (essid: string, host: LanHost): MysqlDatabase => {
  const raw = fileOn(essid, host, ['var', 'lib', 'mysql', 'data.json']);
  const database = raw === undefined ? null : parseMysqlDatabase(raw);
  if (database === null) throw new Error(`no database on ${host.hostname}`);
  return database;
};

/** One database account with its real plaintext, recovered by matching the stored
 *  hash against the pool every generated password is drawn from. */
export const knownDatabaseCredentialIn = (
  database: MysqlDatabase,
  label: string,
): { readonly username: string; readonly password: string } => {
  const found = database.credentials.flatMap((credential) => {
    const password = ALL_GENERATED_PASSWORDS.find(
      (candidate) => md5(candidate) === credential.passwordHash,
    );
    return password === undefined ? [] : [{ username: credential.username, password }];
  });
  const credential = found[0];
  if (credential === undefined) throw new Error(`no recoverable database account on ${label}`);
  return credential;
};

/** A box on a hidden layer that really serves a database, and the gateway fronting it.
 *
 *  Searched for rather than named, because both facts are per-network rolls: a twelfth
 *  of layers run a database at all, and only some of those carry an account whose
 *  plaintext a test can recover. Naming one essid would leave this passing on a fixture
 *  and failing on a re-roll.
 *
 *  Everything here is the generator's: the layer's subnet, the box's services, its own
 *  database. What the tests supply is the forward that exposes it, which is the one
 *  thing a player has to do by hand. */
export type DeepDatabaseFixture = {
  readonly essid: string;
  /** The Layer-1 inner gateway whose forward table is the only door to the layer. */
  readonly gateway: LanHost;
  readonly gatewayMachineId: string;
  readonly layer: DeepLayer;
  readonly machineId: string;
  /** The box's SEEDED tree — no journal replayed, which is exactly what the chain
   *  resolver hands back and why the door has to materialize on top of it. */
  readonly fs: Directory;
  /** The only address NAT ever shows this box: the fronting gateway's downstream `.1`. */
  readonly natIp: string;
  readonly database: MysqlDatabase;
};

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

const innerGatewayOn = (essid: string): LanHost | undefined =>
  generateHomeLan(essid).hosts.find(
    (host) => (host.kind === 'router' || host.kind === 'switch') && octetOf(host) !== 1,
  );

const deepDatabaseOn = (essid: string): DeepDatabaseFixture | null => {
  const gateway = innerGatewayOn(essid);
  if (gateway === undefined || gateway.kind !== 'router') return null;
  const gatewayMachineId = computeInnerGatewayId(essid, octetOf(gateway));
  const layer = generateDeepLayer(essid, { machineId: gatewayMachineId, kind: 'router' });
  const fs = buildDeepHostFs(essid, layer.host);
  const database = databaseIn(fs);
  if (database === null) return null;
  if (!readOpenPorts(fs).some((open) => open.service === SERVICE_CATALOG.mysql.service)) return null;
  const recoverable = database.credentials.some((credential) =>
    ALL_GENERATED_PASSWORDS.some((word) => md5(word) === credential.passwordHash),
  );
  if (!recoverable) return null;
  return {
    essid,
    gateway,
    gatewayMachineId,
    layer,
    machineId: hostMachineId(layer.host, essid),
    fs,
    natIp: `${layer.subnet}.1`,
    database,
  };
};

export const deepDatabaseFixture = (): DeepDatabaseFixture => {
  const essid = crackableEssidPool.find((candidate) => deepDatabaseOn(candidate) !== null);
  const fixture = essid === undefined ? null : deepDatabaseOn(essid);
  if (fixture === null) throw new Error('no network fronts a deep database');
  return fixture;
};

export const knownDatabaseCredential = (
  essid: string,
  host: LanHost,
): { readonly username: string; readonly password: string } =>
  knownDatabaseCredentialIn(databaseOn(essid, host), host.hostname);

/** A PLAYER's box that serves a database: the box rebuilt from the occupancy row the
 *  server holds, and the database `apt install mysql` writes onto it — drawn from their
 *  own key, so no two players hold the same one.
 *
 *  Derived rather than hand-written for the same reason everything else here is. A
 *  fixture that invented a player's accounts would prove the door agrees with the
 *  fixture; this proves it agrees with what the game actually puts on the box. */
export const playerDatabaseOn = (
  occupant: NatOccupantRow,
): {
  readonly database: MysqlDatabase;
  readonly credential: { readonly username: string; readonly password: string };
} => {
  const database = ownDatabase({
    ownerKeyHex: occupant.owner_key,
    hostname: occupant.workstation_machine_name,
    fs: materializeWorkstationFs(occupant, []),
  });
  return {
    database,
    credential: knownDatabaseCredentialIn(database, occupant.workstation_machine_name),
  };
};
