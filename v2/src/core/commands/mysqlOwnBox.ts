/**
 * The database door from your own chair — the whole conversation, client side.
 *
 * Every other target goes through the server, because a client asking about
 * somebody else's box must not be trusted to answer its own question. Your own box
 * has nothing to protect from you: you are root on it, the datadir is a file you can
 * open in an editor, and the credential you are typing is one you could read out of
 * that file first. So the round-trip buys nothing here and costs a request per line.
 *
 * What differs from an attacker's path is WHERE the decision runs, never what it
 * decides. The account list comes from `credentialIn`, the answer from
 * `runStatement`, the log lines from the same two formatters — all of them shared
 * with `handleMysqlConnect` and `handleMysqlStatement` rather than reimplemented, so
 * a rule that changes changes for both vantages at once.
 *
 * Both of those decisions are read off the machine as it stands RIGHT NOW rather than
 * off the tree this client is holding, and that is the one place the local vantage
 * cannot take the shortcut. A shell can trust its own copy because the player is the
 * only one editing it; these two files are not like that. A fellow occupant reaching
 * this box's daemon writes BOTH of them, under this owner's key, and nothing pushes
 * that here. Composing a whole-file write from the client's copy would not merely miss
 * their write, it would REVERT it — silently erasing an intruder's edits from the
 * datadir and their visit from the log, by the owner's own routine use of their own
 * box. So both entry points open on `env.fs.reload()`, which is the round trip the
 * paragraph above says this vantage saves, spent exactly where it buys correctness.
 *
 * Two writes reach the journal and nothing else does: the datadir a statement
 * changed, and the line the daemon records about it. Both are stamped root-owned
 * with the catalog's permissions REGARDLESS of the tier the player's shell sits at,
 * because they are the daemon's writes rather than theirs — mysqld running as root
 * is what makes the file it keeps unreadable to the box's ordinary user, and a
 * rewrite that inherited the shell's owner would hand that user the hashes a sweep
 * is supposed to have to work for.
 */

import { md5 } from '../generation/md5';
import { DATADIR_FILE } from '../generation/baseFs';
import {
  credentialIn,
  databaseIn,
  databaseNameIn,
  DATADIR_OWNER,
  DATADIR_PATH,
} from '../mysql/datadir';
import { runStatement } from '../mysql/statements';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import {
  formatMysqlStatementLine,
  MYSQL_LOG_OWNER,
  MYSQL_LOG_PATH,
  MYSQL_LOG_PERMISSIONS,
} from '../logging/mysqlLog';
import { derivePid } from '../logging/syslog';
import { asGameTime } from '../types';
import { connectedWlan0, LOOPBACK_IPV4, LOOPBACK_NAMES } from '../network/interfaces';
import type { Directory } from '../filesystem/types';
import type {
  CommandEnv,
  FsView,
  MysqlConnectParams,
  MysqlConnectResult,
  MysqlStatementParams,
  MysqlStatementResult,
} from './types';

/**
 * The address the daemon writes down for a connection the player made to their OWN
 * box, or null when `target` names some other machine — which is every address on
 * the LAN but one.
 *
 * Only the SOURCE comes back, because the destination is not in question: all three
 * names mean the one address the box was leased, and the caller is holding it
 * already. What the three names do disagree about is where the visitor came from — a
 * connection over loopback says so, as a real server's log does, and one addressed
 * to the leased address is written down as arriving there. The web door decides it
 * by the same rule, so one box's two logs describe one visitor the same way.
 */
export const ownBoxSource = ({
  target,
  ownIp,
}: {
  readonly target: string;
  readonly ownIp: string;
}): string | null => {
  if (LOOPBACK_NAMES.includes(target)) return LOOPBACK_IPV4;
  return target === ownIp ? ownIp : null;
};

/** Whether a connection already open is one to the player's own box. Re-derived from
 *  the address rather than remembered on the connection, because the address IS the
 *  claim: a player who has since been leased a different one is no longer holding a
 *  connection to anything they own, and the ordinary path answers that correctly. */
export const isOwnBoxConnection = (env: CommandEnv, connection: MysqlConnectParams): boolean => {
  const wlan0 = connectedWlan0(env.network);
  return wlan0 !== null && ownBoxSource({ target: connection.targetIp, ownIp: wlan0.ipv4 }) !== null;
};

/** Whether the player's own mysqld is holding `port` right now — read from the same
 *  pidfile `nmap` and `ps` print, so a door they were shown is a door that opens and
 *  a `systemctl stop` shuts this one too. */
export const ownDaemonListening = (fs: Directory, port: number): boolean =>
  readOpenPorts(fs).some(
    (open) => open.port === port && open.service === SERVICE_CATALOG.mysql.service,
  );

/**
 * Append one already-formatted line to the box's own `/var/log/mysql.log`.
 *
 * The read comes first and a read that FAILED writes nothing, exactly as the
 * server-side appender bails: replacing a box's history with one line is a worse
 * outcome than dropping the line. An absent file is not that failure — it is the
 * ordinary state of a box whose daemon has not had anything to say yet, and the
 * first line is what creates the file.
 *
 * The view is passed in rather than taken from `env` because it has to be the RELOADED
 * one: this file is the defender's evidence, and evidence a login of their own can
 * quietly shorten is none.
 */
const appendOwnLog = async (env: CommandEnv, view: FsView, line: string): Promise<void> => {
  const existing = view.read(MYSQL_LOG_PATH);
  if (!existing.ok && existing.error !== 'not_found') return;

  const current = existing.ok ? existing.content : '';
  await env.patches.write(MYSQL_LOG_PATH, `${current}${line}\n`, {
    owner: MYSQL_LOG_OWNER,
    permissions: MYSQL_LOG_PERMISSIONS,
    ...(existing.ok ? {} : { isNew: true }),
  });
};

/** Land the attempt on the box's own log — accepted and refused alike. A daemon that
 *  recorded strangers but not its owner would be one that knows which is which, and
 *  the defender's skill is reading the file, not being handed it pre-filtered. */
const recordAttempt = async (
  env: CommandEnv,
  attempt: {
    readonly view: FsView;
    readonly username: string;
    readonly fromIp: string;
    readonly opened: boolean;
  },
): Promise<void> => {
  const stamp = env.now();
  const database = databaseNameIn(attempt.view.root());
  await appendOwnLog(
    env,
    attempt.view,
    SERVICE_CATALOG.mysql.sweepLog.formatAttempt({
      // Only `success` is ever inspected — the formatter reads the refusal off the
      // absence of it — so the two labels are not symmetric and never will be.
      outcome: attempt.opened ? 'success' : 'failure',
      user: attempt.username,
      fromIp: attempt.fromIp,
      hostname: env.hostname,
      time: asGameTime(stamp),
      pid: derivePid(stamp),
      // Only an accepted connection has a database to name; the refusal formatter
      // never reads it.
      ...(database === undefined ? {} : { database }),
    }),
  );
};

/**
 * Open your own database — the local half of `env.mysql.connect`, answering in the
 * same shape so the command above it renders one greeting and one refusal.
 *
 * The daemon is re-checked here rather than trusted from the caller's pre-flight,
 * because a `systemctl stop` between the two is a door that closed while the player
 * was typing their password, and it must not open anyway.
 */
export const connectOwnDatabase = async (
  env: CommandEnv,
  params: MysqlConnectParams,
): Promise<MysqlConnectResult> => {
  const view = await env.fs.reload();
  const fs = view.root();
  if (!ownDaemonListening(fs, params.port)) return { ok: false, reason: 'refused' };

  const credential = credentialIn(fs, params.username);
  const opened = credential !== null && md5(params.password) === credential.passwordHash;

  await recordAttempt(env, { view, username: params.username, fromIp: params.sourceIp, opened });

  // Denied names the address the daemon saw, which on your own box is the address you
  // reached it by — the same string the line above it just recorded.
  return opened
    ? { ok: true, hostname: env.hostname }
    : { ok: false, reason: 'denied', fromIp: params.sourceIp };
};

/**
 * Answer one statement against your own database — the local half of
 * `env.mysql.run`.
 *
 * Everything is re-read per statement, as the server re-reads it: the daemon, the
 * account list, the database itself — and re-read from the MACHINE, so it is not only
 * a datadir edited in another tab and a daemon stopped mid-prompt that bite on the
 * next line, but a row an occupant of this WiFi changed a moment ago. Re-reading the
 * client's own copy would answer the first two and quietly overwrite the third.
 *
 * A write that could not be recorded is a write that did not happen. `lost` is what
 * the prompt shows for it — the same answer the server path gives when its datadir
 * write fails — because answering `Query OK` over a write that never landed would
 * show the player their old rows on the next statement.
 */
export const runOwnStatement = async (
  env: CommandEnv,
  params: MysqlStatementParams,
): Promise<MysqlStatementResult> => {
  const view = await env.fs.reload();
  const fs = view.root();
  if (!ownDaemonListening(fs, params.port)) return { kind: 'lost' };

  // ONE read, with the account taken out of what it returned rather than looked up
  // again through `credentialIn`. Asking twice would put an unreachable branch in the
  // middle of this — a box whose credential validates has a database by construction,
  // because the account came out of it.
  //
  // The datadir going away IS reachable, though, and it is reachable exactly here:
  // this is root's own file on root's own box, and between two statements they can
  // delete it, truncate it, or paste something into it that is not a database.
  const database = databaseIn(fs);
  if (database === null) return { kind: 'lost' };

  const credential = database.credentials.find((each) => each.username === params.username);
  if (credential === undefined || md5(params.password) !== credential.passwordHash) {
    return { kind: 'lost' };
  }

  const { output, failed, database: changed, logged } = runStatement({
    database,
    line: params.statement,
    username: params.username,
    // From the credential that just validated, never from anything the prompt holds:
    // the tier is the datadir's answer about this account, and an account edited down
    // a tier is edited down on the next statement.
    userType: credential.userType,
    sourceIp: params.sourceIp,
  });

  if (changed !== undefined) {
    const written = await env.patches.write(DATADIR_PATH, JSON.stringify(changed), {
      owner: DATADIR_OWNER,
      permissions: DATADIR_FILE,
    });
    if (!written.ok) return { kind: 'lost' };
  }

  // Last, and only about a statement that really landed: a line saying something
  // changed, written over a change that did not, sends a defender looking for an edit
  // nobody made.
  if (logged !== undefined) {
    const stamp = env.now();
    await appendOwnLog(
      env,
      view,
      formatMysqlStatementLine({
        time: asGameTime(stamp),
        pid: derivePid(stamp),
        tag: logged.tag,
        detail: logged.detail,
      }),
    );
  }

  return { kind: 'answered', output, failed };
};
