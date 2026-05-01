# Patch Registry

Server-authoritative filesystem patch registry. Backs `/api/patches` — the Vercel function that records each player's filesystem mutations (file writes, creates, deletions, permission changes) on every machine they've touched.

The DB row is keyed on `(player_key, machine_id, path)`. The server is the source of truth for "what patches has player X applied to machine Y at path Z?" — cross-device sync, cross-player visibility on shared networks (mission instances, home networks, persistent darknet hubs), and pre-reload ghost-rehydration defense all flow from this table. Reads at the rehydration boundary go through `listPatchesForMachines(machine_ids[])`, which returns rows from any author for the supplied machines (ordered `updated_at ASC` so client-side `applyPatches` reduce-order yields last-write-wins per `(machine_id, path)`).

See `docs/technology-choices.md` (Patches: server-authoritative with two-call deletion) and the `project_multiplayer_security_model` memory for the broader design.

## Files

| File                         | Description                                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`                   | zod schemas (4-action discriminated union: upsertPatch / removePatch / listPatchesForMachines / clearOwnedPatches), `PatchRow`, `PatchSummary`.                                                                                |
| `handler.ts`                 | Single endpoint with action-dispatch: verify → rate-limit → branch into one of four action handlers. Server-stamps `player_key` on every write.                                                                                |
| `supabaseUpsert.ts`          | `INSERT ... ON CONFLICT (player_key, machine_id, path) DO UPDATE` adapter for upsertPatch.                                                                                                                                     |
| `supabaseDelete.ts`          | DELETE adapters for removePatch (exact + descendant prefix) and clearOwnedPatches (`machine_id = 'localhost'`).                                                                                                                |
| `supabaseSelectByMachine.ts` | `SELECT ... WHERE machine_id IN (...) ORDER BY updated_at ASC` adapter for listPatchesForMachines (cross-player read); returns the per-row `PatchSummary` shape.                                                               |
| `broadcast.ts`               | Server-side `publishPatchChange` — fires a Supabase Realtime HINT broadcast (`patches:<machine_id>` channel, `patch_change` event, `{ machine_id, originator_key }` payload) after every successful mutation. Fire-and-forget. |
| `realtime.ts`                | Client-side `subscribeToMachine` wrapper + lazy anon-key Supabase client. Receives hints, converts wire shape (snake_case) to `PatchHint` (camelCase), hands them to the caller's `onHint`.                                    |
| `client.ts`                  | Browser-side wrappers — sign envelope, POST, parse response. Handle camelCase ↔ snake_case translation so callers see `FileSystemPatch`.                                                                                       |
| `*.test.ts`                  | Unit tests for each module.                                                                                                                                                                                                    |

## Action dispatch (`handler.ts`)

A single Vercel function (`/api/patches`) handles four logical actions, discriminated by the `action` field of the signed payload:

```ts
patchesSignedPayloadSchema = z.discriminatedUnion('action', [
  upsertPatchSignedPayloadSchema, // 'upsertPatch'
  removePatchSignedPayloadSchema, // 'removePatch'
  listPatchesForMachinesSignedPayloadSchema, // 'listPatchesForMachines'
  clearOwnedPatchesSignedPayloadSchema, // 'clearOwnedPatches'
]);
```

The handler verifies once (envelope shape, signature, schema, ts window, nonce dedupe), rate-limits once (per verified pubkey), then branches:

```
verify → rate-limit → switch (action):
  upsertPatch            → UPSERT (server-stamps player_key)                      → 200 {}
  removePatch            → DELETE exact + descendants                             → 200 { affected }
  listPatchesForMachines → SELECT WHERE machine_id IN (...) ORDER BY updated_at   → 200 { patches: PatchSummary[] }
  clearOwnedPatches      → DELETE WHERE machine_id = 'localhost'                  → 200 { affected }
```

`clearTransientPatches` (DELETE WHERE machine_id <> 'localhost') was removed in v0.112.0 along with the mission-transition wipe in `FileSystemContext`. Mission instances are permanent (per `project_multiplayer_mission_instances` memory — once accepted, the seed retires but the instance and its patches persist forever for anyone who can route to it). Home networks and world networks are shared persistent infrastructure. Cross-player writes on shared machines are part of the shared world. So no patch on a non-localhost machine should ever be wiped server-side.

Action-dispatch over URL-shape REST mirrors `/api/sessions` — every action POSTs (signed bodies require POST), so a single URL avoids duplicating the verify+rate-limit prelude.

## Realtime hint broadcasts

After every successful `upsertPatch` / `removePatch`, the handler fires a fire-and-forget `publishPatchChange` to a per-machine Supabase Realtime broadcast channel. The payload is a HINT — just `{ machine_id, originator_key }` — not the full patch:

```
verify → rate-limit → mutate → if ok: broadcast(`patches:${machine_id}`, 'patch_change', { machine_id, originator_key })
```

Subscribers (`subscribeToMachine` in `realtime.ts`, wired into `FileSystemContext`) receive the hint and:

1. Skip the hint if `originator_key === own_pubkey` (the local optimistic apply + cross-tab `BroadcastChannel` already covered same-identity writes).
2. Otherwise, accumulate `machine_id` into a debounced (~150ms) refetch set.
3. On debounce flush, fire `listPatchesForMachines([...affectedMachineIds])` against the signed `/api/patches` endpoint and splice the authoritative result into local `patches` state. Pending in-flight local writes (tracked in a `Map<key, FileSystemPatch>`) are replayed on top so a cross-player refetch doesn't clobber what the user just typed.

Result: cross-player writes appear within ~300-500ms (debounce + round-trip), with zero risk of forged content corrupting local state.

### Trust model — closed by hint architecture

The Realtime broadcast channel is anon-publishable from the browser bundle (the anon key ships in the bundle by design), so any client can call `channel.send()`. Under the prior design (full `PatchSummary` payload), a malicious player could forge a `patch_change` event with fake content; the local view diverged from server truth until the next page reload's `listPatchesForMachines` call.

Hint-only payload defangs this architecturally:

- There's no content / path / owner in the broadcast — nothing to inject.
- Forged hints just trigger a refetch via the signed endpoint, which returns server truth.
- Spamming forged hints with `originator_key = victim_pubkey` makes the victim skip ONE refetch per forgery; authentic hints from real writers (different `originator_key`) still trigger refetches. Net effect: harmless DoS-style noise, no data corruption.

The previous attempt to close the vector via Supabase Realtime authorization rules (`private: true` channels + RLS on `realtime.messages`) was reverted — the new `sb_publishable_*` key format and unspecified `setAuth()` requirements made the configuration brittle. See `project_realtime_publish_authorization` memory for the post-mortem.

Server-to-Realtime path: `api/patches.ts` POSTs directly to `${SUPABASE_URL}/realtime/v1/api/broadcast` with the `service_role` key. Direct fetch beats opening a WebSocket per Vercel function invocation — these functions are short-lived.

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

The composite PK doubles as the natural-key for UPSERT — no extra UNIQUE constraint. There's a partial index on `(player_key) WHERE machine_id <> 'localhost'` that was created to accelerate the now-removed `clearTransientPatches` action; it's harmless dead weight and can be dropped in a follow-up migration.

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

Four thin browser-side functions. All sign via `signedRequest.signRequest` and POST to `/api/patches`:

```ts
upsertPatch(identity, patch: FileSystemPatch) → Promise<void>
removePatch(identity, { machineId, path }) → Promise<void>
listPatchesForMachines(identity, machine_ids: ReadonlyArray<string>) → Promise<ReadonlyArray<FileSystemPatch>>
clearOwnedPatches(identity) → Promise<void>
```

The wrappers handle camelCase ↔ snake_case translation in both directions so callers only ever see `FileSystemPatch`. `listPatchesForMachines` converts wire→client defensively:

- `permissions: null` → omit (`FileSystemPatch.permissions` is optional)
- `is_new: false` → omit (`FileSystemPatch.isNew` is the literal `?: true`)
- `node_type: 'file'` → omit (the implicit default)

All throw on non-2xx with the status code in the error message.

## Reset semantics: `clearOwnedPatches`, not `clearAllPatches`

`clearOwnedPatches` (fired by `reset confirm`) wipes patches `WHERE player_key = me AND machine_id = 'localhost'`. It does NOT wipe patches the player applied to **other** players' machines — those are gameplay actions in the shared world, and undoing them on personal reset would be wrong.

Concrete scenario: Player A roots Player B's box and `rm`s a file there. That creates a row `(player_key=A, machine_id=<B's IP>, content=null)`. If A resets, B's view of the deleted file MUST stay deleted — A's local game starts over, but A's actions in B's world persist.

Currently the only "owned" machine is `localhost`. As more ownership concepts arrive (home network slots per the home-network model memory, mission instances per the mission-instances memory), the WHERE clause grows — but the semantic stays: "wipe machines I own, not the world I've touched".

The reset flow in `src/commands/reset.ts` AWAITS the `clearOwnedPatches` Promise before triggering `window.location.reload()`. Earlier fire-and-forget timing let the page navigation abort the in-flight DELETE; the await + 500ms timer ordering ensures the request lands.

## L1 patch-validation gate (PR #78)

`upsertPatch` and `removePatch` now consult the `sessions` table before recording a mutation:

```
verify → rate-limit → if (machine_id != 'localhost'):
                        find active session for (player_key, machine_id)
                          - DB error           → 500 session_lookup_failed
                          - no row             → 403 no_session
                          - active row exists  → proceed
                      ... existing handler logic
```

The gate is the **actual security boundary** for filesystem mutations. Before PR #78, an attacker with a legit Ed25519 keypair could record patches on any machine. After PR #78, they can only record patches on machines where they've established an active session via the legitimate auth flow (SSH/su/exploit/FTP/mysql/redis/scp/snmp/effect — all 9 kinds count).

`localhost` is exempt — the player always owns their own box.

Reads and the bulk clear (`listPatchesForMachines`, `clearOwnedPatches`) are NOT gated. `listPatchesForMachines` is a cross-player read — knowing the `machine_id` is the gate, since the world is one shared persistent state (see `project_multiplayer_cross_player_visibility` memory). `clearOwnedPatches` scopes to the player's own localhost rows by `player_key`. Neither depends on per-machine session ownership.

### `localhost` exception in `listPatchesForMachines`

Every player's workstation uses the literal string `'localhost'` as its `machine_id`, so the cross-player read would otherwise leak Player A's localhost mutations into Player B's view. The wiring SQL applies a guard:

```sql
WHERE machine_id IN (...)
  AND (machine_id <> 'localhost' OR player_key = $verified_pubkey)
```

Localhost rows are filtered to the calling player's writes; every other machine still gets the multi-author read. Future shared surfaces (home networks, mission instances) use unique IDs per player allocated by the IP registry, so they don't need this special case.

### Ambient log-path bypass

`upsertPatch` writes to paths under `/var/log/` bypass L1 entirely (no session required). Recon actions like `nmap`, `curl`, `hydra`, `gobuster`, and ssh-failure logging trigger log appends on the target machine without the actor having a session there — the network records the probe as a side effect, that's the gameplay. L1 was designed for "I logged in, I'm mutating this machine" mutations; ambient log writes are a different class.

The bypass is path-prefix based and server-controlled — the client cannot opt out of L1 by spoofing a non-log path; the predicate runs on the verified `payload.path`. Bypass applies ONLY to `upsertPatch`. `removePatch` on a `/var/log/...` path still requires a session (covering tracks needs real access to the box).

This bypass exists to keep the gate compatible with the **cross-player log visibility** rule that ships with multiplayer (see `project_multiplayer_cross_player_visibility` memory). Future hardening: a dedicated server-composed event stream (forgery-resistant), at which point this bypass goes away.

### Layered defense (L1 / L2 / L3)

This PR ships **L1** only. The full validation cake:

| Layer | What it checks                                                                                                       | Status                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| L1    | Active session exists on `machine_id` for `player_key`                                                               | ✅ shipped (PR #78)                                                                                          |
| L2    | Session credentials have write permission on the target path (Unix permission walk on the target's filesystem state) | Deferred — needs server-side FS state (deterministic regen + patch replay, OR a `machine_filesystems` table) |
| L3    | Game-logic re-run ("smart server") — was the CVE leading to this session published-by-now, etc.                      | Way later                                                                                                    |

L2 closes privilege-escalation within a session (e.g., a guest-session player asking the server to delete root-owned files). L1 alone limits attackers to "legitimate access" but trusts the client's permission check.

## Server-stamped `player_key`

Every write stamps `player_key` from the verified Ed25519 pubkey, never from a client claim. Strict zod schemas reject any client-supplied `player_key` field (400 `payload_invalid`). Even a malicious Burp/curl client can only register patches in their own name.

## Why a separate module from `sessionRegistry` / `ipRegistry`

All three modules use the same `signedRequest` machinery and the same handler skeleton (verify → rate-limit → DB), but the action sets and DB tables are disjoint. Keeping each in its own directory means future signed endpoints (mission acceptance, wallet transfers, etc.) follow the same per-feature module pattern without dragging unrelated machinery along.

The duplicated boilerplate (`STATUS_BY_VERIFY_REASON`, the verify+rate-limit prelude, the `postEnvelope` helper) is now triplicated. Extraction to a shared `signedRequest/handlerKit.ts` is a candidate for the next signed-endpoint PR — at that point the abstraction has 4 consumers and the right shape is obvious.
