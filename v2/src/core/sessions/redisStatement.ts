/**
 * handleRedisStatement — one question, answered against a box's real key-value store.
 *
 * Nothing is re-sent here but the question. The database door re-sends its whole
 * credential with every statement because no session row holds it; this door has no
 * credential to re-send at all, so what is re-established per statement is the REACH —
 * is the box still there, does it still boot, is the daemon still holding the port.
 * That repeat is the entire eviction mechanism: with no session row to invalidate, a
 * player who has been shut out can only find out by asking again.
 *
 * The store is read from the box's REAL filesystem — journal replayed over the seeded
 * base, the same file `cat` shows to root — so a key somebody removed by editing
 * `/var/lib/redis/data.json` is a key this door no longer answers with.
 *
 * A LOCKED store discloses nothing through here. Not the key, not the value, not the
 * count, and not whether a key exists: one refusal for all of them, because an answer
 * that varied would let a player map a store they cannot open.
 *
 * What goes back is RENDERED TEXT and nothing else. A body carrying the store would
 * hand this client every value the caller never asked for, in a field the terminal
 * never draws and anyone watching the wire can read — so the rendering happens here, on
 * the side that can see the whole store, and only its output crosses.
 *
 * This handler writes for exactly ONE line: an `AUTH` a store with a secret judged.
 * Reads never append — real Redis's behaviour and the database door's rule both — and
 * against an open store that silence is the defender's problem rather than an omission:
 * the one arrival line the connection left is their entire evidence that anything was
 * read at all. A store with no secret records no attempt either, because nothing was
 * weighed; a line there would tell a defender somebody tried a lock their box lacks.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { reachServiceHost, type HandlerResponse, type ServiceHostLookup } from './serviceHost';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { storeIn } from '../redis/datadir';
import { runStatement } from '../redis/statements';
import { redisStoreSchema } from '../redis/types';
import { derivePid } from '../logging/syslog';
import { appendMachineLog } from '../patches/appendMachineLog';
import { asGameTime } from '../types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from '../patches/upsertPatch';

export type RedisStatementDeps = ServiceHostLookup & {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps an attempt line. */
  readonly now: () => number;
  /** The TARGET's current `/var/log/redis.log` — the read half of the trace, so a guess
   *  accretes onto the box's history instead of replacing it. */
  readonly readRedisLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch. Today that is the one line a judged `AUTH` leaves on the target;
   *  the write verbs will use the same seam for the store itself. */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type { HandlerResponse };

const redisStatementSchema = z
  .looseObject({
    action: z.literal('redisStatement'),
    essid: z.string().min(1),
    target_ip: z.string().min(1),
    port: z.number().int().positive(),
    /** The line exactly as the player typed it. Parsed on the server, so an unknown
     *  verb is the daemon's answer rather than the client's guess — and so a prompt
     *  whose box has died discovers it instead of politely correcting their spelling. */
    statement: z.string(),
    /** What the caller is holding, re-sent with EVERY statement. There is no session
     *  row to hold it instead, so a connection that has been let in proves it again on
     *  each line — and a store whose secret changed under one refuses it on the next. */
    password: z.string().optional(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** A box running the daemon with no readable store is answered as an EMPTY one rather
 *  than as an error. That is the honest shape: `systemctl start redis` on a box that
 *  has never held anything is a real state, and a store somebody emptied with an editor
 *  is another. Both hold no keys, and `DBSIZE` saying zero is the true answer to what
 *  was asked. */
const EMPTY_STORE = redisStoreSchema.parse({ keys: {}, requirepassHash: null });

/** Land a judged password on the target's own redis.log. Best-effort, like every other
 *  door's trace: the answer stands regardless of a logging failure, because a password
 *  that really was judged must not be un-judged by a write that did not land.
 *
 *  It names no account, because the store has none — the secret belongs to the service.
 *  What the line can say is who tried and whether they got in, which is why the field
 *  the other doors fill with a username is empty here and read by nobody. */
const recordAttempt = async (
  deps: RedisStatementDeps,
  attempt: {
    readonly outcome: 'success' | 'failure';
    readonly writerKey: string;
    readonly machineId: string;
    readonly hostname: string;
    readonly fromIp: string;
  },
): Promise<void> => {
  const stamp = deps.now();
  const { sweepLog } = SERVICE_CATALOG.redis;
  const line = sweepLog.formatAttempt({
    outcome: attempt.outcome,
    user: '',
    fromIp: attempt.fromIp,
    hostname: attempt.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  });

  try {
    await appendMachineLog(
      { readLog: deps.readRedisLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: attempt.writerKey,
        machineId: attempt.machineId,
        path: sweepLog.path,
        owner: sweepLog.owner,
        permissions: sweepLog.permissions,
      },
      line,
    );
  } catch {
    // best-effort: the answer stands regardless of a logging failure.
  }
};

export const handleRedisStatement = async (
  body: unknown,
  deps: RedisStatementDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, redisStatementSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // Shared with the connect door, so a connection and the reads behind it can never
  // disagree about whether the box is up or the daemon is listening.
  const reach = await reachServiceHost(deps, {
    essid: payload.essid,
    targetIp: payload.target_ip,
    port: payload.port,
    service: SERVICE_CATALOG.redis.service,
    actorKey: publicKey,
  });
  if (!reach.ok) return reach.refusal;

  const { output, failed, attempt } = runStatement({
    store: storeIn(reach.reached.hostFs) ?? EMPTY_STORE,
    line: payload.statement,
    ...(payload.password === undefined ? {} : { password: payload.password }),
  });

  // Only a password actually weighed leaves a mark. The ROUTE decides the address it is
  // written up as, exactly as the arrival line's is: through a forward the box has only
  // ever seen the fronting gateway.
  if (attempt !== undefined) {
    const { hostname, machineId, sourceIp, writerKey } = reach.reached;
    await recordAttempt(deps, {
      outcome: attempt,
      // The TARGET's key once the box has an owner: the system owns its logs, so every
      // visitor's lines accrete into one row rather than a row each.
      writerKey: writerKey ?? publicKey,
      machineId,
      hostname,
      fromIp: sourceIp ?? payload.source_ip ?? 'unknown',
    });
  }

  // The judgement itself does not cross. What the target recorded is the target's; the
  // client is told what a terminal prints and nothing beside it.
  return { status: 200, body: { output, failed } };
};
