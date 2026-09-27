/**
 * Nonce dedupe contract — used by verifySignedRequest to reject replays.
 * `{ fresh: true }` = first time we've seen this nonce; `{ fresh: false }` =
 * replay.
 *
 * Only the interface lives here. Concrete stores (Upstash-backed atomic
 * SET NX EX, and a noop dev fallback) land with the first server endpoint that
 * needs them — keeping speculative, unconsumed code out of the core.
 */

export type NonceStore = (nonce: string) => Promise<{ readonly fresh: boolean }>;
