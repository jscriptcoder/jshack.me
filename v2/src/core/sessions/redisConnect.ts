/**
 * handleRedisConnect — the server-side gate for opening a key-value store.
 *
 * The fifth door, and the first with no credential to gate on at all. `ssh`, `ftp` and
 * `scp` ask the box who you are ON it; the database door asks who you are TO it; this
 * one asks nothing. A store answers to a single secret or to none, and the secret
 * belongs to the SERVICE rather than to a person — so there is no account to name and
 * nothing here that can refuse a caller for being who they are.
 *
 * A LOCKED store opens too, and that is deliberate rather than an oversight. The lock
 * sits on every question asked through the door, not on the door itself: the real
 * client connects, and the first statement is what comes back `NOAUTH`. Refusing the
 * connection instead would tell a scanner which stores hold a secret without their
 * ever sending a statement.
 *
 * What CAN refuse a caller is the box — gone, dark, or not running this daemon. That
 * check is `reachServiceHost`'s, shared with the database door, so a store and a
 * database on one machine can never disagree about whether it boots.
 *
 * NO session row is created, at any tier, and here the reason is sharper than the
 * database door's: that door at least validated a credential first. A row minted for a
 * connection that proved nothing would hand `listPatches` and `upsertPatch` to anyone
 * who can reach port 6379.
 *
 * The arrival is TRACED on the target, and against an open store this one line is the
 * defender's entire evidence: there is no credential to get wrong, so there is no wall
 * of failed attempts to notice. One line naming an address is all a theft leaves.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { reachServiceHost, type HandlerResponse, type ServiceHostLookup } from './serviceHost';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { derivePid } from '../logging/syslog';
import { appendMachineLog } from '../patches/appendMachineLog';
import { asGameTime } from '../types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

export type RedisConnectDeps = ServiceHostLookup & {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the redis.log line. */
  readonly now: () => number;
  /** The TARGET's current `/var/log/redis.log` — the read half of the trace, so a
   *  connection appends to the box's history instead of replacing it. */
  readonly readRedisLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the one line this arrival leaves on the target). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type { HandlerResponse };

// Loose so the envelope fields (action/ts/nonce) pass through; the refine rejects a
// client-supplied player_key (the server stamps it from the verified signature).
// No username and no password, alone among the doors — there is no credential in this
// handshake to carry.
const redisConnectSchema = z
  .looseObject({
    action: z.literal('redisConnect'),
    essid: z.string().min(1),
    target_ip: z.string().min(1),
    port: z.number().int().positive(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** Land the arrival on the target's own redis.log. Best-effort, like every other
 *  door's trace: the connection stands regardless of a logging failure, because a
 *  connection that really happened must not be undone by a write that did not.
 *
 *  ONE line, where the database door writes two. That door sends its credential in the
 *  handshake, so the socket opening and the credential being judged are one event; here
 *  nothing was attempted, and a second line would record something that did not happen.
 *  The attempt line this log also knows how to write belongs to `AUTH`. */
const recordArrival = async (
  deps: RedisConnectDeps,
  arrival: {
    readonly writerKey: string;
    readonly machineId: string;
    readonly fromIp: string;
  },
): Promise<void> => {
  const stamp = deps.now();
  const { sweepLog } = SERVICE_CATALOG.redis;
  const line = sweepLog.formatArrival?.({
    fromIp: arrival.fromIp,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  });
  if (line === undefined) return;

  try {
    await appendMachineLog(
      { readLog: deps.readRedisLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: arrival.writerKey,
        machineId: arrival.machineId,
        path: sweepLog.path,
        owner: sweepLog.owner,
        permissions: sweepLog.permissions,
      },
      line,
    );
  } catch {
    // best-effort: the connection's outcome stands regardless of a logging failure.
  }
};

export const handleRedisConnect = async (
  body: unknown,
  deps: RedisConnectDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, redisConnectSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // Shared with the statement door, so a connection and the reads behind it can never
  // disagree about whether the box is up or the daemon is listening. A stopped daemon's
  // log stays exactly as this request found it.
  const reach = await reachServiceHost(deps, {
    essid: payload.essid,
    targetIp: payload.target_ip,
    port: payload.port,
    service: SERVICE_CATALOG.redis.service,
    actorKey: publicKey,
  });
  if (!reach.ok) return reach.refusal;
  const { hostname, machineId, sourceIp, writerKey } = reach.reached;

  // The ROUTE decides the address whenever it can: through a forward the box has only
  // ever seen the fronting gateway's `.1`, whoever is behind it, so echoing the caller's
  // claim would write a line no daemon could have produced. On the caller's own LAN the
  // route knows nothing and the claim stands.
  await recordArrival(deps, {
    // The TARGET's key once the box has an owner: the system owns its logs, so every
    // visitor's lines accrete into one row on the defender's box rather than a row
    // each, where the newest would erase the rest on replay.
    writerKey: writerKey ?? publicKey,
    machineId,
    fromIp: sourceIp ?? payload.source_ip ?? 'unknown',
  });

  // The name comes back because through a forward it is unknowable any other way: a
  // deep box's address is absent from the generated LAN, so the client greets with what
  // actually answered rather than with what it guessed. Whether the store is LOCKED is
  // deliberately not part of this answer — finding that out costs one statement, exactly
  // as it does with the real client.
  return { status: 200, body: { ok: true, hostname } };
};
