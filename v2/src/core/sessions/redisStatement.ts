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
import { storeIn, DATADIR_OWNER, DATADIR_PATH } from '../redis/datadir';
import { DATADIR_FILE } from '../generation/baseFs';
import { runStatement } from '../redis/statements';
import { redisStoreSchema } from '../redis/types';
import { derivePid } from '../logging/syslog';
import { formatRedisMutationLine } from '../logging/redisLog';
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

/** Land one line on the target's own redis.log. Best-effort, like every other door's
 *  trace: the answer stands regardless of a logging failure, because a password that
 *  really was judged, or a key that really was set, must not be undone by a write to a
 *  different file that did not land.
 *
 *  No line here names an account, because the store has none: its secret belongs to the
 *  service, and its keys belong to whoever reached the port. What a line can say is who
 *  was there, and what they did. */
const recordOnTarget = async (
  deps: RedisStatementDeps,
  target: { readonly writerKey: string; readonly machineId: string },
  line: string,
): Promise<void> => {
  const { sweepLog } = SERVICE_CATALOG.redis;

  try {
    await appendMachineLog(
      { readLog: deps.readRedisLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: target.writerKey,
        machineId: target.machineId,
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

  const { output, failed, attempt, store, logged } = runStatement({
    store: storeIn(reach.reached.hostFs) ?? EMPTY_STORE,
    line: payload.statement,
    ...(payload.password === undefined ? {} : { password: payload.password }),
  });

  const { hostname, machineId, sourceIp, writerKey } = reach.reached;
  // The TARGET's key once the box has an owner: the system owns its files, so every
  // visitor's changes and lines accrete into one row rather than a row each. The owner's
  // own edits land there too, which is what puts a defender's changes and an intruder's
  // in the same file rather than in two that disagree.
  const targetWriterKey = writerKey ?? publicKey;
  // The ROUTE decides the address every line is written up as: through a forward the box
  // has only ever seen the fronting gateway, so what the player is told and what the
  // defender finds are one string.
  const fromIp = sourceIp ?? payload.source_ip ?? 'unknown';
  const stamp = deps.now();

  // The store goes back whole, because that is what a store is here: one JSON file the
  // daemon reads in full. Owner and permissions are re-stated rather than inherited, so a
  // rewrite through the port cannot quietly widen the one file on the box that holds a
  // hash a sweep has to work for.
  //
  // Persisted BEFORE anything is recorded about it: a line saying a key was set, filed
  // beside a store that never took the change, would send a defender after an intruder
  // who changed nothing — and would tell the player OK about the same nothing.
  if (store !== undefined) {
    const { error } = await deps.upsertPatch({
      writer_key: targetWriterKey,
      machine_id: machineId,
      path: DATADIR_PATH,
      content: JSON.stringify(store),
      owner: DATADIR_OWNER,
      permissions: DATADIR_FILE,
      node_type: 'file',
    });
    if (error) return { status: 500, body: { error: 'datadir_write_failed' } };
  }

  // Only a password actually weighed leaves a mark of its own.
  if (attempt !== undefined) {
    await recordOnTarget(
      deps,
      { writerKey: targetWriterKey, machineId },
      SERVICE_CATALOG.redis.sweepLog.formatAttempt({
        outcome: attempt,
        user: '',
        fromIp,
        hostname,
        time: asGameTime(stamp),
        pid: derivePid(stamp),
      }),
    );
  }

  // And only a statement that actually changed something. The detail arrives already
  // rendered by the verb table, which is the side that knows what a value may be.
  if (logged !== undefined) {
    await recordOnTarget(
      deps,
      { writerKey: targetWriterKey, machineId },
      formatRedisMutationLine({ detail: logged, fromIp, time: asGameTime(stamp), pid: derivePid(stamp) }),
    );
  }

  // The judgement itself does not cross. What the target recorded is the target's; the
  // client is told what a terminal prints and nothing beside it.
  return { status: 200, body: { output, failed } };
};
