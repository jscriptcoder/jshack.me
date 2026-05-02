# Session Registry

Server-authoritative session-existence registry. Backs `/api/sessions` — the Vercel function that records each player's "presence on a machine with credentials" across nine session kinds (SSH-into-X-as-Y, `su`-on-X-to-Z, post-exploit shell, FTP/mysql/redis/scp/snmp logins, msfconsole one-shot effects).

The DB tree mirrors the player's hop chain via `parent_session_id`. The server is the single source of truth for "does player X have an active session on machine Y?" — **the L1 patch-validation gate in `/api/patches` consults this table on every mutating write**, hop-chain realism in `access.log` reads it, and cross-player visibility all flows from it.

See `docs/technology-choices.md` (Authenticated requests + Backend) and the `project_multiplayer_sessions` memory for the broader design.

## Files

| File                    | Description                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`              | zod schemas (createSession / endSession / listSessions, action-discriminated), `SESSION_KINDS` enum, `SessionRow`, `SessionSummary`.                                                                                                             |
| `handler.ts`            | Single endpoint with action-dispatch: verify → rate-limit → branch into create/end/list. server-stamps `player_key` and defaults `kind: 'ssh'`.                                                                                                  |
| `supabaseInsert.ts`     | `INSERT INTO sessions ... RETURNING session_id` adapter (kind included in the row).                                                                                                                                                              |
| `supabaseUpdate.ts`     | `UPDATE sessions SET ended_at = NOW(), end_reason = ...` with WHERE filter, plus app-level cascade-end recursion.                                                                                                                                |
| `supabaseSelect.ts`     | `SELECT ... WHERE player_key = ... AND ended_at IS NULL ORDER BY created_at ASC` adapter for listSessions; returns kind in each row.                                                                                                             |
| `supabaseFindActive.ts` | `SELECT session_id, credentials FROM sessions WHERE player_key=me AND machine_id=X AND ended_at IS NULL LIMIT 1` — feeds both L1 (existence) and L2 (verified credentials → walker). Strict zod parse on the JSONB; mis-shapen rows fail closed. |
| `client.ts`             | Browser-side `createSession` / `endSession` / `listSessions` wrappers — sign envelope, POST, parse response.                                                                                                                                     |
| `*.test.ts`             | Unit tests for each module.                                                                                                                                                                                                                      |

## Action dispatch (`handler.ts`)

A single Vercel function (`/api/sessions`) handles three logical actions, discriminated by the `action` field of the signed payload:

```ts
sessionsSignedPayloadSchema = z.discriminatedUnion('action', [
  createSessionSignedPayloadSchema, // 'createSession'
  endSessionSignedPayloadSchema, // 'endSession'
  listSessionsSignedPayloadSchema, // 'listSessions'
]);
```

The handler verifies once (envelope shape, signature, schema, ts window, nonce dedupe), rate-limits once (per verified pubkey), then branches:

```
verify → rate-limit → switch (action):
  createSession  → INSERT sessions (server-stamps player_key) → 200 { session_id }
  endSession     → UPDATE + cascade child UPDATE             → 200 / 404 (not found / not yours / already ended — collapsed)
  listSessions   → SELECT active rows                         → 200 { sessions: SessionSummary[] }
```

URL-based dispatch (REST shape) was considered and rejected — every action POSTs (signed bodies require POST), so a single URL with action-dispatch saves on duplication of the verify+rate-limit boilerplate.

## Schema

```sql
CREATE TABLE sessions (
  session_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_key        TEXT NOT NULL,                                   -- hex Ed25519 pubkey
  machine_id        TEXT NOT NULL,                                   -- target machine IP
  credentials       JSONB NOT NULL,                                  -- { username, userType }
  parent_session_id UUID REFERENCES sessions(session_id) ON DELETE CASCADE,
  source_ip         TEXT,                                            -- denormalized parent.machine_id
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  end_reason        TEXT
);
```

RLS is enabled with **no policies** — anon/authenticated denied by default; only `service_role` (used by the Vercel function) can read/write. Mirrors `public_ips`.

`kind` (added in this PR) distinguishes nine session categories so consumers can filter:

- **Shell-class** — `'ssh'`, `'su'`, `'exploit'` — go on the SessionContext snapshot stack and rehydrate on mount.
- **Protocol** — `'ftp'`, `'mysql'`, `'redis'` — live in their own client-side state field (`FtpSession`, `MysqlSession`, `RedisSession`); pushed/ended on login/logout.
- **Transient one-shot** — `'scp'`, `'snmp'`, `'effect_one_shot'` — pushed via `withTransientSession` for the duration of a single patch fire, then ended.

Rehydration filters to shell-class kinds before reconstructing the linear shell chain. The L1 patch-validation gate (`/api/patches`) doesn't care which kind — it only asks "does any active session row exist for `(player_key, machine_id)`?".

## Cascade-end (`supabaseUpdate.ts`)

When a player ends a session, all active descendants (children, grandchildren, etc.) are also marked ended with `end_reason='cascade'`. Implemented as **app-level recursion** via the same UPDATE adapter rather than a Postgres recursive CTE — simpler to reason about, easy to test, no stored proc to maintain.

```
end(parent):
  UPDATE parent → mark ended_at + caller's reason
  if affected > 0:
    findChildren(parent)
    for each active child:
      UPDATE child → mark ended_at + 'cascade'
      recurse into child's subtree
```

Trade-off: small race window where new child sessions created mid-cascade can be orphaned (parent ended, child still active). The orphan is a still-valid session — a future periodic sweeper or upgrade to atomic-via-RPC fixes it without changing the adapter interface. Documented in the module header.

## Client wrappers (`client.ts`)

Three thin browser-side functions, all sign via `signedRequest.signRequest` and POST to `/api/sessions`:

```ts
createSession(identity, { machine_id, credentials, parent_session_id?, source_ip? }) → Promise<string> // session_id
endSession(identity, { session_id, reason }) → Promise<void>
listSessions(identity) → Promise<ReadonlyArray<SessionSummary>>
```

All throw on non-2xx with the status code in the error message; consumers wrap in try/catch if specific codes (404 / 429 / 401) need different handling.

## Hop chain semantics

Each session's `parent_session_id` points to the session it was opened _from_:

- SSH from localhost to machine A: A.parent = null (localhost is implicit, never tracked).
- SSH from A to B: B.parent = A.session_id.
- `su` on A from `alice` to `root`: new session row with parent = A's session_id; same `machine_id`, different `credentials`.

`source_ip` denormalizes the parent's `machine_id` so future access-log realism (which records the immediate hop, not the originating player) reads it directly without walking the chain.

## Server-stamped `player_key`

Every write stamps `player_key` from the verified Ed25519 pubkey, never from a client claim. Strict zod schemas reject any client-supplied `player_key` field (400 `payload_invalid`). Even a malicious Burp/curl client can only register sessions in their own name.

## Why a separate module from `ipRegistry`

Both modules use the same `signedRequest` machinery and the same handler skeleton (verify → rate-limit → DB), but the action sets are disjoint and the DB tables are separate. Keeping them in distinct directories means future signed endpoints (patches, mission acceptance, etc.) follow the same per-feature module pattern without dragging session-specific machinery along.

The duplicated boilerplate (`STATUS_BY_VERIFY_REASON`, the verify+rate-limit prelude) is a candidate for extraction once a 3rd handler lands.
