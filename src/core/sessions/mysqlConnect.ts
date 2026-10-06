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
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { md5 } from '../generation/md5.js';
import { reachServiceHost, type HandlerResponse, type ServiceHostLookup } from './serviceHost.js';
import { resolveCallerVantageOn, type CallerVantageDeps } from './callerVantage.js';
import { credentialIn, databaseNameIn } from '../mysql/datadir.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { derivePid } from '../logging/syslog.js';
import { appendMachineLog } from '../patches/appendMachineLog.js';
import { asGameTime } from '../types.js';
import type { Directory } from '../filesystem/types.js';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

export type MysqlConnectDeps = ServiceHostLookup &
  CallerVantageDeps & {
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
    port: z.number().int().positive(),
    username: z.string().min(1),
    password: z.string(),
    // The box the shell stands on — the server reads WHERE the caller is from it and
    // derives the source address itself. Absent means the caller's own workstation.
    caller_machine_id: z.string().min(1).optional(),
    // Still accepted so an older caller does not 400, but never read: the source address
    // is the vantage's, never a claim.
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

  // Where the caller is STANDING, derived from the session they hold on the box they
  // name (or their own occupancy when they name none) — never from a claim. A login
  // naming a network the caller is not on is refused before anything is reached.
  const vantage = await resolveCallerVantageOn(
    deps,
    publicKey,
    payload.caller_machine_id,
    payload.essid,
  );
  if (!vantage.ok) return { status: vantage.status, body: { error: vantage.error } };

  // Shared with the statement door, so a login and the queries behind it can never
  // disagree about whether the box is up or the daemon is listening. A stopped
  // daemon's log stays exactly as this request found it.
  const reach = await reachServiceHost(deps, {
    essid: vantage.essid,
    targetIp: payload.target_ip,
    callerMachineId: payload.caller_machine_id,
    ownLanSourceIp: vantage.sourceIp,
    port: payload.port,
    service: SERVICE_CATALOG.mysql.service,
    actorKey: publicKey,
  });
  if (!reach.ok) return reach.refusal;
  const { hostname, machineId, hostFs, sourceIp, writerKey } = reach.reached;

  const credential = credentialIn(hostFs, payload.username);
  const opened = credential !== null && md5(payload.password) === credential.passwordHash;

  // The host is resolved by now, so the attempt CAN be recorded — the daemon writes
  // up accepted and refused connections alike. (A refusal above logs nothing: there
  // is no machine, or no daemon, to log on.)
  // The address the box saw, server-derived at the vantage: the hop's own LAN address,
  // the layer address down a chain, the gateway's `.1` through a forward, or the hop
  // network's public IP across the world. ONE value, used for both the line written here
  // and the refusal handed back, so what the player reads and what the defender finds
  // cannot be different addresses for the same attempt.
  const fromIp = sourceIp ?? 'unknown';

  await recordAttempt(deps, {
    // The TARGET's key once the box has an owner: the system owns its logs, so every
    // attacker's lines accrete into one row on the defender's box rather than a row
    // each, where the newest would erase the rest on replay. A box nobody owns takes the
    // ESSID's own stable key for the same reason — it is shared by every occupant, so
    // the caller's key would be stable for one player and different for the next.
    writerKey,
    machineId,
    hostname,
    username: payload.username,
    fromIp,
    hostFs,
    opened,
  });

  if (!opened) {
    return { status: 401, body: { error: 'invalid_credentials', from: fromIp } };
  }

  // The name comes back because through a forward it is unknowable any other way: a
  // deep box's address is absent from the generated LAN, so the client greets with what
  // actually answered rather than with what it guessed.
  //
  // No session row, at any tier. There is nothing to insert and nothing to leak:
  // the credential is re-validated on the next statement instead.
  return { status: 200, body: { ok: true, hostname } };
};
