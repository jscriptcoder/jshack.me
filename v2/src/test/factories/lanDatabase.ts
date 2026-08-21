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
import { hostServices } from '../../core/generation/remoteHostFs';
import { resolveLanHostIdentity } from '../../core/generation/lanHostIdentity';
import { ALL_GENERATED_PASSWORDS } from '../../core/generation/passwordPools';
import { SERVICE_CATALOG } from '../../core/services/serviceCatalog';
import { md5 } from '../../core/generation/md5';
import { parseMysqlDatabase, type MysqlDatabase } from '../../core/mysql/types';
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
export const knownDatabaseCredential = (
  essid: string,
  host: LanHost,
): { readonly username: string; readonly password: string } => {
  const found = databaseOn(essid, host).credentials.flatMap((credential) => {
    const password = ALL_GENERATED_PASSWORDS.find(
      (candidate) => md5(candidate) === credential.passwordHash,
    );
    return password === undefined ? [] : [{ username: credential.username, password }];
  });
  const credential = found[0];
  if (credential === undefined) {
    throw new Error(`no recoverable database account on ${host.hostname}`);
  }
  return credential;
};
