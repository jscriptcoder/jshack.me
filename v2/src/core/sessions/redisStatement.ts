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
 * This handler writes NOTHING. Not the store, not a log line. Reads never append —
 * real Redis's behaviour and the database door's rule both — and against an open store
 * that silence is the defender's problem rather than an omission: the one arrival line
 * the connection left is their entire evidence that anything was read at all.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { reachServiceHost, type HandlerResponse, type ServiceHostLookup } from './serviceHost';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { storeIn } from '../redis/datadir';
import { runStatement } from '../redis/statements';
import { redisStoreSchema } from '../redis/types';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { PatchRow } from '../patches/upsertPatch';

export type RedisStatementDeps = ServiceHostLookup & {
  readonly nonceStore: NonceStore;
  /** Declared and deliberately unused while this door only reads. It is here because
   *  the write verbs land next and the dep set is what the wiring in `api/` hands over
   *  — and because a slice that quietly could not write would look identical to one
   *  that chose not to. */
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
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** A box running the daemon with no readable store is answered as an EMPTY one rather
 *  than as an error. That is the honest shape: `systemctl start redis` on a box that
 *  has never held anything is a real state, and a store somebody emptied with an editor
 *  is another. Both hold no keys, and `DBSIZE` saying zero is the true answer to what
 *  was asked. */
const EMPTY_STORE = redisStoreSchema.parse({ keys: {}, requirepassHash: null });

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

  const { output, failed } = runStatement({
    store: storeIn(reach.reached.hostFs) ?? EMPTY_STORE,
    line: payload.statement,
  });

  return { status: 200, body: { output, failed } };
};
