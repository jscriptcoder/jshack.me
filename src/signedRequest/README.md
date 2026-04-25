# Signed Request

Generic signed-envelope helpers for authenticated POSTs to Vercel functions. Used by every endpoint that needs to know "which identity made this request" — currently `/api/allocate-ip`, with sessions / patches / mission acceptance to follow.

The design is captured in `docs/technology-choices.md` ("Authenticated requests"). See also `project_multiplayer_security_model` memory.

## Files

| File            | Description                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `types.ts`      | `SignedEnvelope`, envelope + base payload zod schemas, `REPLAY_WINDOW_MS` constant.               |
| `sign.ts`       | Client-side: `signRequest(identity, action, fields)` → envelope. Adds nonce + ts internally.      |
| `verify.ts`     | Server-side: `verifySignedRequest(envelope, schema, deps)` → `{ok, publicKey, payload}` or error. |
| `nonceStore.ts` | Replay-protection store. Upstash adapter (atomic SET NX EX) + noop fallback.                      |
| `*.test.ts`     | Unit tests for each of the above.                                                                 |

## Envelope shape

Three fields, all transport-safe JSON strings:

```json
{
  "payload": "{\"action\":\"allocateIp\",\"nonce\":\"<32 hex>\",\"ts\":1714000000,\"kind\":\"mission_instance\"}",
  "publicKey": "<64 hex chars — Ed25519 public key>",
  "signature": "<128 hex chars — Ed25519 signature over UTF-8 bytes of payload>"
}
```

The signed bytes are the **literal `payload` string the client produced** — not a re-canonicalized object. This eliminates a whole class of "client and server stringify objects differently" bugs (key order, whitespace, number formatting, unicode normalization). The server never has to reproduce the canonical form: it verifies the bytes the client sent and parses them after.

JSON-string-inside-JSON is slightly ugly in logs but stays human-readable — preferable to base64 for debugging the inevitable signature failures.

## Replay protection

Every signed payload includes:

- `ts`: client wall-clock at signing time (`Date.now()`). Server rejects if `|now - ts| > REPLAY_WINDOW_MS` (120s). Rejecting both directions guards against future-timestamp attacks and absorbs ±60s of clock skew on either side.
- `nonce`: 16 random bytes (128 bits, hex-encoded). Server records each nonce in Upstash with a 120s TTL and rejects any duplicate. Combined with the ts window, an attacker can't replay a captured envelope after the window elapses (ts rejection) or within it (nonce rejection).

Both protections are necessary. ts alone allows in-window replay; nonce alone requires unbounded storage.

## Server-side flow (verify.ts)

Order is cheapest-checks-first to avoid hitting Upstash on garbage requests:

1. Envelope structural shape (regex + zod, sub-µs)
2. Ed25519 signature verify (~50µs CPU)
3. `JSON.parse` the payload bytes
4. Base schema (action/ts/nonce) + caller-provided action schema
5. Timestamp window check
6. Nonce dedupe — single Upstash round-trip, only if everything else passed

Returns `{ ok: true, publicKey, payload }` on success, or `{ ok: false, reason }` with one of:

| Reason              | HTTP status | Meaning                                                            |
| ------------------- | ----------- | ------------------------------------------------------------------ |
| `envelope_invalid`  | 400         | Wrapper shape wrong (missing fields, bad hex lengths, wrong types) |
| `signature_invalid` | 401         | Ed verify returned false (or @noble threw on malformed point)      |
| `payload_malformed` | 400         | Signed bytes weren't valid JSON                                    |
| `payload_invalid`   | 400         | JSON parsed but rejected by base or caller schema                  |
| `timestamp_skew`    | 401         | ts outside the 120s replay window                                  |
| `replay`            | 401         | nonce already seen within the window                               |

Auth-class problems (signature, replay, ts) get 401; structural problems get 400. The distinction matters for clients that retry — 401 means re-sign, 400 means the payload itself is malformed.

## Client-side flow (sign.ts)

```ts
const envelope = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
fetch('/api/allocate-ip', { method: 'POST', body: JSON.stringify(envelope) });
```

`signRequest` injects `action`, `ts`, `nonce` itself — caller-supplied versions of those fields are stripped, so a misbehaving caller can't backdoor a stale timestamp or pre-known nonce.

## Nonce store

`NonceStore` is an abstraction over "atomic set-if-not-exists with TTL":

- `createUpstashNonceStore(set)` wraps `redis.set(key, value, { ex: 120, nx: true })`. Returns `'OK'` on first write, `null` on duplicate — mapped to `{ fresh: true | false }`.
- `noopNonceStore` always reports fresh. Used for local dev when Upstash env vars aren't configured. Replay protection is effectively disabled in this mode (same caveat as `noopRateLimiter`).

The Vercel function adapter (`api/allocate-ip.ts`) builds a single `Redis` client and shares it across the rate limiter and nonce store — they don't conflict (different key prefixes: `allocate-ip:*` vs `nonce:*`).
