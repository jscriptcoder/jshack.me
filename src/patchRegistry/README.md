# Patch Registry

Server-authoritative filesystem patch registry. Backs `/api/patches` — the Vercel function that records each player's filesystem mutations (file writes, creates, deletions, permission changes) on every machine they've touched.

The DB row is keyed on `(player_key, machine_id, path)`. The server is the source of truth for "what patches has player X applied to machine Y at path Z?" — cross-device sync, eventual cross-player visibility on shared networks (mission instances, persistent darknet hubs), and pre-reload ghost-rehydration defense all flow from this table.

See `docs/technology-choices.md` (Patches: server-authoritative with two-call deletion) and the `project_multiplayer_security_model` memory for the broader design.

## Files

| File                | Description                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`          | zod schemas (5-action discriminated union: upsertPatch / removePatch / listPatches / clearTransientPatches / clearAllPatches), `PatchRow`, `PatchSummary`. |
| `handler.ts`        | Single endpoint with action-dispatch: verify → rate-limit → branch into one of five action handlers. Server-stamps `player_key` on every write.            |
| `supabaseUpsert.ts` | `INSERT ... ON CONFLICT (player_key, machine_id, path) DO UPDATE` adapter for upsertPatch.                                                                 |
| `supabaseDelete.ts` | DELETE adapters for removePatch (exact + descendant prefix), clearTransientPatches (`machine_id <> 'localhost'`), and clearAllPatches.                     |
| `supabaseSelect.ts` | `SELECT ... WHERE player_key = ...` adapter for listPatches; returns the per-row `PatchSummary` shape.                                                     |
| `client.ts`         | Browser-side wrappers — sign envelope, POST, parse response. Handle camelCase ↔ snake_case translation so callers see `FileSystemPatch`.                   |
| `*.test.ts`         | Unit tests for each module.                                                                                                                                |

## Action dispatch (`handler.ts`)

A single Vercel function (`/api/patches`) handles five logical actions, discriminated by the `action` field of the signed payload:

```ts
patchesSignedPayloadSchema = z.discriminatedUnion('action', [
  upsertPatchSignedPayloadSchema, // 'upsertPatch'
  removePatchSignedPayloadSchema, // 'removePatch'
  listPatchesSignedPayloadSchema, // 'listPatches'
  clearTransientPatchesSignedPayloadSchema, // 'clearTransientPatches'
  clearAllPatchesSignedPayloadSchema, // 'clearAllPatches'
]);
```

The handler verifies once (envelope shape, signature, schema, ts window, nonce dedupe), rate-limits once (per verified pubkey), then branches:

```
verify → rate-limit → switch (action):
  upsertPatch           → UPSERT (server-stamps player_key)        → 200 {}
  removePatch           → DELETE exact + descendants               → 200 { affected }
  listPatches           → SELECT all rows for player_key           → 200 { patches: PatchSummary[] }
  clearTransientPatches → DELETE WHERE machine_id <> 'localhost'   → 200 { affected }
  clearAllPatches       → DELETE WHERE player_key = me             → 200 { affected }
```

Action-dispatch over URL-shape REST mirrors `/api/sessions` — every action POSTs (signed bodies require POST), so a single URL avoids duplicating the verify+rate-limit prelude.

## Schema

```sql
CREATE TABLE patches (
  player_key  TEXT        NOT NULL,                 -- hex Ed25519 pubkey
  machine_id  TEXT        NOT NULL,                 -- target machine IP
  path        TEXT        NOT NULL,                 -- file path on that machine
  content     TEXT,                                 -- null = base-file deletion marker
  owner       TEXT        NOT NULL,                 -- 'root' | 'user' | 'guest'
  permissions JSONB,                                -- { read, write, execute }
  is_new      BOOLEAN     NOT NULL DEFAULT false,   -- true = file/dir created via patch
  node_type   TEXT        NOT NULL DEFAULT 'file',  -- 'file' | 'directory'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_key, machine_id, path)
);
```

The composite PK doubles as the natural-key for UPSERT — no extra UNIQUE constraint. Partial index on `(player_key) WHERE machine_id <> 'localhost'` accelerates `clearTransientPatches`.

RLS is enabled with **no policies** — anon/authenticated denied by default; only `service_role` (used by the Vercel function) can read/write. Mirrors `sessions` and `public_ips`.

## Two-query removePatch

`removePatch` deletes the exact path AND any patches under it (directory descendants). The wiring layer issues two `.delete()` calls:

```sql
DELETE FROM patches WHERE player_key=$me AND machine_id=$mid AND path = $path;
DELETE FROM patches WHERE player_key=$me AND machine_id=$mid AND path LIKE $prefix || '%';
```

The adapter computes `path_prefix` once (`path.endsWith('/') ? path : path + '/'`) so the two arms have consistent semantics. Two queries avoid PostgREST `.or()` quoting fragility and keep the SQL plain.

LIKE caveat: `_` is a single-char SQL wildcard. A path containing `_` could match siblings (e.g. `/etc/my_dir/` → `/etc/myXdir/foo`). Acceptable for v1; if it bites we'll switch to a `.gte/.lt` range query.

## Two-call deletion (client side)

The `broadcastAndRecordPatch` flow in `FileSystemContext` decides per case:

| Case                              | Server calls                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Write/create (`content !== null`) | `upsertPatch`                                                                  |
| Delete isNew file                 | `removePatch` (handles descendants in one shot)                                |
| Delete base-fs file               | `removePatch` THEN `upsertPatch` (descendants gone, then null marker recorded) |

The two-call sequence handles the rare "rm -rf a base directory you've been modifying" case where children patches need cleanup AND a deletion marker. Adds one extra round-trip in a corner case; keeps the server's `upsertPatch` action simple and single-purpose.

## Client wrappers (`client.ts`)

Five thin browser-side functions. All sign via `signedRequest.signRequest` and POST to `/api/patches`:

```ts
upsertPatch(identity, patch: FileSystemPatch) → Promise<void>
removePatch(identity, { machineId, path }) → Promise<void>
listPatches(identity) → Promise<ReadonlyArray<FileSystemPatch>>
clearTransientPatches(identity) → Promise<void>
clearAllPatches(identity) → Promise<void>
```

The wrappers handle camelCase ↔ snake_case translation in both directions so callers only ever see `FileSystemPatch`. `listPatches` converts wire→client defensively:

- `permissions: null` → omit (`FileSystemPatch.permissions` is optional)
- `is_new: false` → omit (`FileSystemPatch.isNew` is the literal `?: true`)
- `node_type: 'file'` → omit (the implicit default)

All throw on non-2xx with the status code in the error message.

## Server-stamped `player_key`

Every write stamps `player_key` from the verified Ed25519 pubkey, never from a client claim. Strict zod schemas reject any client-supplied `player_key` field (400 `payload_invalid`). Even a malicious Burp/curl client can only register patches in their own name.

## Why a separate module from `sessionRegistry` / `ipRegistry`

All three modules use the same `signedRequest` machinery and the same handler skeleton (verify → rate-limit → DB), but the action sets and DB tables are disjoint. Keeping each in its own directory means future signed endpoints (mission acceptance, wallet transfers, etc.) follow the same per-feature module pattern without dragging unrelated machinery along.

The duplicated boilerplate (`STATUS_BY_VERIFY_REASON`, the verify+rate-limit prelude, the `postEnvelope` helper) is now triplicated. Extraction to a shared `signedRequest/handlerKit.ts` is a candidate for the next signed-endpoint PR — at that point the abstraction has 4 consumers and the right shape is obvious.
