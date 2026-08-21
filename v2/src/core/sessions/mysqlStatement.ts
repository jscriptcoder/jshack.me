/**
 * handleMysqlStatement — one statement, answered against a box's real database.
 *
 * The credential arrives again here, with every statement, because the connection
 * minted no session row to trust instead. That is the mechanism behind decision 8
 * rather than an inefficiency: there is no row to leak, no row to authorize a
 * filesystem read with, and no row for `authorizeMachineAccess` to need a carve-out
 * for. It also means a datadir edited between two statements takes effect on the
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
 * Nothing is written. These deps carry no way to write, so a session of reads leaves
 * the target's `mysql.log` exactly as the login left it: one line, whatever the
 * player goes on to type.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { md5 } from '../generation/md5';
import { reachMysqlHost, type HandlerResponse, type MysqlHostLookup } from './mysqlHost';
import { credentialIn, databaseIn } from '../mysql/datadir';
import { runStatement } from '../mysql/statements';
import type { NonceStore } from '../signedRequest/nonceStore';

export type MysqlStatementDeps = MysqlHostLookup & {
  readonly nonceStore: NonceStore;
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
  const { payload } = verified;

  const reach = await reachMysqlHost(deps, {
    essid: payload.essid,
    targetIp: payload.target_ip,
  });
  if (!reach.ok) return reach.refusal;
  const { hostFs } = reach.reached;

  const credential = credentialIn(hostFs, payload.username);
  if (credential === null || md5(payload.password) !== credential.passwordHash) return INVALID;

  // A box whose credential just validated has a database by construction — the
  // account came out of it. Reading it again rather than threading it out of the
  // check keeps the door's one reader the one that answers.
  const database = databaseIn(hostFs);
  if (database === null) return INVALID;

  const { output, failed } = runStatement({
    database,
    line: payload.statement,
    username: payload.username,
    sourceIp: payload.source_ip ?? 'unknown',
  });

  return { status: 200, body: { output, failed } };
};
