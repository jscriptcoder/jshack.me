/**
 * handleMysqlConnect — the server-side gate for a database login.
 *
 * The fourth door, and the first that does not read `/etc/passwd`. `ssh`, `ftp` and
 * `scp` all ask the box who you are ON it; this asks the DATABASE who you are TO it,
 * from the datadir the daemon keeps at `/var/lib/mysql/data.json`. The two account
 * sets are drawn on separate streams, so a box's root password opens nothing here
 * and a database password opens no shell — two locks, two keys.
 *
 * Read from the box's REAL datadir: the journal replayed over the seeded base, the
 * same tree `cat` shows. The file is root-owned and root on a box is a tier a player
 * can reach, so an account somebody added by editing it is an account that logs in.
 * A gate that validated against a locally regenerated baseline would refuse a
 * credential the player can see sitting in the file.
 *
 * An unknown account and a wrong password return ONE response, byte for byte. The
 * datadir reader collapses them before this handler can tell them apart, because an
 * error that distinguished them would let a player enumerate the database's accounts
 * by typing names at it.
 *
 * NO session row is created, at any tier. A database connection has none to create:
 * the credential is re-validated on every statement instead, which is what makes
 * "this door reaches no filesystem" structural rather than a rule somebody enforces.
 * Reachability mirrors `authCreateSession` — unknown host, bricked box, daemon not
 * listening — so a dead machine is dark to this tool exactly as it is to the others.
 *
 * The attempt is TRACED on the target either way. An accepted connection names the
 * database it opened; a refusal cannot, because a client that never authenticated was
 * never told which database it would have reached — and that difference is the
 * defender's most useful signal.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { md5 } from '../generation/md5';
import { reachMysqlHost, type HandlerResponse, type MysqlHostLookup } from './mysqlHost';
import { credentialIn, databaseNameIn } from '../mysql/datadir';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { derivePid } from '../logging/syslog';
import { appendMachineLog } from '../patches/appendMachineLog';
import { asGameTime } from '../types';
import type { Directory } from '../filesystem/types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

export type MysqlConnectDeps = MysqlHostLookup & {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the mysql.log line. */
  readonly now: () => number;
  /** The TARGET's current `/var/log/mysql.log` — the read half of the trace, so a
   *  connection appends to the box's history instead of replacing it. */
  readonly readMysqlLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the one line this attempt leaves on the target). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type { HandlerResponse };

// Loose so the envelope fields (action/ts/nonce) pass through; the refine rejects a
// client-supplied player_key (the server stamps it from the verified signature).
// `password` may be empty — typing nothing is a real thing a player can do, and it
// is refused by the hash check like any other wrong answer rather than by the schema.
const mysqlConnectSchema = z
  .looseObject({
    action: z.literal('mysqlConnect'),
    essid: z.string().min(1),
    target_ip: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** Land the attempt on the target's own mysql.log. Best-effort, like every other
 *  door's trace: the auth result stands regardless of a logging failure, because a
 *  connection that really happened must not be undone by a write that did not. */
const recordAttempt = async (
  deps: MysqlConnectDeps,
  attempt: {
    readonly writerKey: string;
    readonly machineId: string;
    readonly hostname: string;
    readonly username: string;
    readonly fromIp: string;
    readonly hostFs: Directory;
    readonly opened: boolean;
  },
): Promise<void> => {
  const stamp = deps.now();
  const database = databaseNameIn(attempt.hostFs);
  const line = SERVICE_CATALOG.mysql.sweepLog.formatAttempt({
    outcome: attempt.opened ? 'success' : 'failure',
    user: attempt.username,
    fromIp: attempt.fromIp,
    hostname: attempt.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
    // Only an accepted connection has a database to name; the refusal formatter
    // never reads it.
    ...(database === undefined ? {} : { database }),
  });
  try {
    await appendMachineLog(
      { readLog: deps.readMysqlLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: attempt.writerKey,
        machineId: attempt.machineId,
        path: SERVICE_CATALOG.mysql.sweepLog.path,
        owner: SERVICE_CATALOG.mysql.sweepLog.owner,
        permissions: SERVICE_CATALOG.mysql.sweepLog.permissions,
      },
      line,
    );
  } catch {
    // best-effort: the connection's outcome stands regardless of a logging failure.
  }
};

export const handleMysqlConnect = async (
  body: unknown,
  deps: MysqlConnectDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, mysqlConnectSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // Shared with the statement door, so a login and the queries behind it can never
  // disagree about whether the box is up or the daemon is listening. A stopped
  // daemon's log stays exactly as this request found it.
  const reach = await reachMysqlHost(deps, {
    essid: payload.essid,
    targetIp: payload.target_ip,
  });
  if (!reach.ok) return reach.refusal;
  const { host, machineId, hostFs } = reach.reached;

  const credential = credentialIn(hostFs, payload.username);
  const opened = credential !== null && md5(payload.password) === credential.passwordHash;

  // The host is resolved by now, so the attempt CAN be recorded — the daemon writes
  // up accepted and refused connections alike. (A refusal above logs nothing: there
  // is no machine, or no daemon, to log on.)
  await recordAttempt(deps, {
    writerKey: publicKey,
    machineId,
    hostname: host.hostname,
    username: payload.username,
    fromIp: payload.source_ip ?? 'unknown',
    hostFs,
    opened,
  });

  if (!opened) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  // No session row, at any tier. There is nothing to insert and nothing to leak:
  // the credential is re-validated on the next statement instead.
  return { status: 200, body: { ok: true } };
};
