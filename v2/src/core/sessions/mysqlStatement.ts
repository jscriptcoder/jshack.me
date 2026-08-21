/**
 * handleMysqlStatement — one statement, answered against a box's real database.
 *
 * The credential arrives again here, with every statement, because the connection
 * minted no session row to trust instead. That is the whole mechanism rather than an
 * inefficiency: there is no row to leak, no row to authorize a filesystem read with,
 * and no row for `authorizeMachineAccess` to need a carve-out for. It also means a datadir edited between two statements takes effect on the
 * second — the account list is re-read, not remembered.
 *
 * Reachability is the login door's, shared: same LAN resolution, same boot check,
 * same pidfiles. Checking it per statement is what lets a daemon stopped mid-session
 * drop the player, since there is no session to invalidate.
 *
 * What goes back is RENDERED TEXT and nothing else. A body carrying rows would hand
 * the client every row the account was not allowed to select, in a field the terminal
 * never draws and anyone watching the wire can read — so the rendering happens here,
 * on the side that can see the whole database, and only its output crosses.
 *
 * A statement that CHANGES the database writes the datadir back and nothing else.
 * These deps carry exactly one way to write for exactly that, and the engine decides
 * when it is used: only a statement that produced a new database gets persisted, so a
 * session of reads still leaves the box precisely as the login left it. That used to
 * be structural and is now a rule, which is why there are tests standing on it.
 *
 * A write that cannot be recorded is a write that did not happen, and the player is
 * told so. The datadir write IS the statement here rather than a note about one:
 * answering `Query OK` over a failed journal write would show them their old rows on
 * the next statement and read as the game losing writes.
 *
 * The mysql.log line is the opposite kind of write — a note ABOUT the statement — so
 * it is best-effort, the way the login door's line is. It comes last for the same
 * reason: a line saying something changed, written over a change that did not land,
 * would send a defender looking for an edit nobody made.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { md5 } from '../generation/md5';
import { reachMysqlHost, type HandlerResponse, type MysqlHostLookup } from './mysqlHost';
import { credentialIn, databaseIn, DATADIR_OWNER, DATADIR_PATH } from '../mysql/datadir';
import { runStatement } from '../mysql/statements';
import { DATADIR_FILE } from '../generation/baseFs';
import { appendMachineLog, type MachineLogReadQuery, type MachineLogReadResult } from '../patches/appendMachineLog';
import {
  formatMysqlStatementLine,
  MYSQL_LOG_OWNER,
  MYSQL_LOG_PATH,
  MYSQL_LOG_PERMISSIONS,
} from '../logging/mysqlLog';
import { derivePid } from '../logging/syslog';
import { asGameTime } from '../types';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from '../patches/upsertPatch';

export type MysqlStatementDeps = MysqlHostLookup & {
  readonly nonceStore: NonceStore;
  /** Write a patch — the datadir a statement changed, and the line the daemon records
   *  about having changed it. Kept to those two paths by the caller below rather than
   *  by the shape of this type, so the test that names every path the door writes is
   *  the thing holding it. */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** The server's wall clock, epoch-ms (UTC) — stamps the mysql.log line. */
  readonly now: () => number;
  /** The TARGET's current `/var/log/mysql.log`. The read half of an append: without
   *  it the daemon would replace the box's history with one line every time it had
   *  something to say. */
  readonly readMysqlLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
};

export type { HandlerResponse };

// Loose so the envelope fields (action/ts/nonce) pass through; the refine rejects a
// client-supplied player_key. `statement` may be any string the player typed — it is
// answered by the engine, including with a syntax error, rather than filtered here.
const mysqlStatementSchema = z
  .looseObject({
    action: z.literal('mysqlStatement'),
    essid: z.string().min(1),
    target_ip: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
    statement: z.string(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** The same refusal the login door gives, byte for byte. An answer that separated a
 *  wrong password from an account the database never held would enumerate its
 *  accounts for anyone willing to type names at it — and it would do so on every
 *  statement, which is a far larger surface than the login alone. */
const INVALID: HandlerResponse = { status: 401, body: { error: 'invalid_credentials' } };

export const handleMysqlStatement = async (
  body: unknown,
  deps: MysqlStatementDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, mysqlStatementSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { payload, publicKey } = verified;

  const reach = await reachMysqlHost(deps, {
    essid: payload.essid,
    targetIp: payload.target_ip,
  });
  if (!reach.ok) return reach.refusal;
  const { hostFs, machineId } = reach.reached;

  const credential = credentialIn(hostFs, payload.username);
  if (credential === null || md5(payload.password) !== credential.passwordHash) return INVALID;

  // A box whose credential just validated has a database by construction — the
  // account came out of it. Reading it again rather than threading it out of the
  // check keeps the door's one reader the one that answers.
  const database = databaseIn(hostFs);
  if (database === null) return INVALID;

  const { output, failed, database: changed, logged } = runStatement({
    database,
    line: payload.statement,
    username: payload.username,
    // From the credential that just validated, never from the payload. A client that
    // named its own tier would be naming its own permissions.
    userType: credential.userType,
    sourceIp: payload.source_ip ?? 'unknown',
  });

  if (changed !== undefined) {
    // The whole document goes back, because that is what a database is here: one JSON
    // file a daemon reads in full. The owner and permissions are re-stated rather than
    // inherited, so a rewrite cannot quietly widen the one file on the box that holds
    // the hashes a sweep has to work for.
    const { error } = await deps.upsertPatch({
      writer_key: publicKey,
      machine_id: machineId,
      path: DATADIR_PATH,
      content: JSON.stringify(changed),
      owner: DATADIR_OWNER,
      permissions: DATADIR_FILE,
      node_type: 'file',
    });
    if (error) return { status: 500, body: { error: 'datadir_write_failed' } };
  }

  if (logged !== undefined) {
    const stamp = deps.now();
    try {
      await appendMachineLog(
        { readLog: deps.readMysqlLog, upsertPatch: deps.upsertPatch },
        {
          writerKey: publicKey,
          machineId,
          path: MYSQL_LOG_PATH,
          owner: MYSQL_LOG_OWNER,
          permissions: MYSQL_LOG_PERMISSIONS,
        },
        formatMysqlStatementLine({
          time: asGameTime(stamp),
          pid: derivePid(stamp),
          tag: logged.tag,
          detail: logged.detail,
        }),
      );
    } catch {
      // best-effort: the statement's outcome stands regardless of a logging failure.
    }
  }

  return { status: 200, body: { output, failed } };
};
