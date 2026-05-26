# 4. Multiplayer Foundation

This section captures the server-authoritative multiplayer machinery that every other surface (filesystem, network, missions, CVEs) sits on top of. The rewrite MUST stand this layer up first; everything else assumes it works.

The model is **zero-trust client, ship-first**: clients are untrusted (Burp/ZAP/curl are part of the threat model), the security boundary is `Vercel function + Supabase RLS + shared permission walker`, and we explicitly accept a small set of forge-bypass gaps until an L3 "smart server" lands post-launch. Reads, writes, sessions, and Realtime broadcasts all route through signed Ed25519 envelopes verified server-side.

## 4.1 Identity (Ed25519 + computeWorkstationId)

The player is identified by a **32-byte Ed25519 keypair** generated on first launch and persisted in `localStorage` under the key `jshack.identity`:

```ts
type Identity = {
  readonly privateKey: Uint8Array; // 32 bytes — never leaves the device
  readonly publicKey: Uint8Array; // 32 bytes — the player's identifier
  readonly publicKeyHex: string; // 64-char lowercase hex
};
```

Library: `@noble/ed25519` v3 (sync API). SHA-512 is wired explicitly at module load (`ed.hashes.sha512 = sha512` from `@noble/hashes`). Sign/verify are pure synchronous functions; signing is deterministic per Ed25519 spec — same `(key, message)` always produces the same signature, no nonce randomness needed at sign time.

`getIdentity()` is the lazy singleton entry point: reads or generates on first call, caches for the page lifetime. `loadIdentity` is defensive — any malformed storage (missing fields, bad hex, wrong length) returns `null` rather than throwing, so `getOrCreateIdentity` falls back to `generateIdentity` instead of crashing on boot. Silent reset on corruption is intentional and documented in `project_multiplayer_identity_wallet_keys`.

### computeWorkstationId — the canonical machine_id for a player's own box

Under the eliminated-localhost model, the player's own workstation is stored everywhere (patches.machine_id, sessions.machine_id, Realtime channels, occupant.hostname) as:

```
workstation_id = `${workstationName}-${first-8-hex(sha256('ed25519:' + playerKeyHex))}`
```

The eight-hex suffix is the **identity-derived disambiguator**. Two players who choose the same workstation name (`skylab`) get different storage keys because their suffixes differ. The `'localhost'` literal is gone from storage but preserved as a CLI loopback alias.

### The `'ed25519:'` prefix is LOAD-BEARING

`deriveHostnameSuffix` computes `sha256(utf8('ed25519:' + playerKeyHex)).hex().slice(0, 8)`. Calling it with the raw `playerKeyHex` (no prefix) produces a divergent suffix and silently breaks every cross-player auth/L1/L2/lookup path. This bug surfaced as `su` returning 401 even with the right password (PR 2 in the cross-player base-FS chunk).

**Rule for the rewrite**: the only callable helper is `computeWorkstationId(workstationName, playerKeyHex)`. The `'ed25519:'` prefix is applied inside the helper. Callers MUST NOT compose the input themselves. The single source of truth lives in `src/homeNetworks/homeNetworkHelpers.ts` and is shared by:

- the client (prompt, /etc/hostname, machine_id storage)
- `regenWorkstationRows` (server-side base-FS regen)
- handler.ts `isOwnWorkstationOnServer` and the read-path filter's `isOwnWorkstation`
- every smoke script that needs to predict a machine_id

`parseWorkstationId(id)` is the inverse — returns `{ name, suffix }` or `undefined` if the input doesn't have workstation_id shape. Pattern: `/^(.+)-([0-9a-f]{8})$/`. The "last 8 hex" rule handles names with internal hyphens (e.g. `skylab-prime` → name `skylab-prime`, suffix `deadbeef`). Used by `getBaseFs` / `exploitRead` / `crackCredentials` to dispatch on machine type — non-workstation IDs return `400 unsupported_machine_type`.

### Identity reset

No in-game UI. Clear `localStorage` manually (devtools / new browser profile) to abandon identity. Deliberate friction — identity reset wipes reputation, darknet listings, messages.

### CLI surface

`identity` command prints `Identity: ed25519:<64 hex>\nFingerprint: <first 16 hex>`. Fingerprint is a UI convenience for cross-player recognition.

## 4.2 Wallet key (separate from identity)

The **wallet key** is a separate Ed25519 keypair that lives in the player's in-game virtual filesystem (a file under their home directory). Unlike the identity, the wallet key:

- Can be **stolen** by another player who cracks the box and exfiltrates the file.
- Is **lost on permadeath** (game restart wipes the FS).
- Has no fixed location — generators may place it differently per seed.

Identity defends "this is who I am" (cryptographic). Wallet defends "this is what I own" (gameplay). The wallet-defense premise depends on `/etc/passwd` and root-owned files NOT being readable by no-session callers (see §4.10 — without that, anyone with a signed envelope could pull the wallet hash without ever cracking the box).

## 4.3 Signed request envelope

Every authenticated POST to `/api/*` uses the same three-field envelope:

```ts
type SignedEnvelope = {
  readonly payload: string;     // JSON-stringified action object — the SIGNED BYTES
  readonly publicKey: string;   // 64-char hex Ed25519 pubkey
  readonly signature: string;   // 128-char hex Ed25519 signature over UTF-8 bytes of payload
};
```

### Key rule: sign the literal string, not a re-canonicalized object

The signed bytes are the **literal `payload` string the client produced**. The server never re-canonicalizes — it verifies the bytes as transmitted and parses them after. Eliminates the entire "different libraries serialize objects differently" bug class (key order, whitespace, number formatting, unicode normalization).

JSON-string-inside-JSON is ugly in logs but stays human-readable. Beats base64 for debugging the inevitable signature failures.

### Replay protection

Every payload includes:

- `ts`: client wall-clock at signing (`Date.now()`). Rejected if `|now - ts| > REPLAY_WINDOW_MS` (120s). Bidirectional rejection guards against future-timestamp attacks and absorbs ±60s clock skew.
- `nonce`: 16 random bytes (128 bits, hex-encoded, regex `/^[0-9a-f]{32}$/i`). Server records each nonce in Upstash Redis with a 120s TTL via atomic `SET NX EX`; duplicates rejected. Combined: an attacker can't replay an envelope after the window (ts rejection) or within it (nonce rejection).

Both are necessary. ts alone allows in-window replay; nonce alone needs unbounded storage.

### Server-side verification order (verify.ts)

Cheapest-checks-first to avoid hitting Upstash on garbage:

1. **Envelope structural shape** — regex + zod (sub-µs).
2. **Ed25519 signature verify** — ~50µs CPU.
3. **`JSON.parse`** the payload bytes.
4. **Base schema** (action / ts / nonce) + caller-provided action schema.
5. **Timestamp window** check.
6. **Nonce dedupe** — single Upstash round-trip, only if all above passed.

Returns `{ ok: true, publicKey, payload }` on success, or `{ ok: false, reason }`:

| Reason              | HTTP | Meaning                                            |
| ------------------- | ---- | -------------------------------------------------- |
| `envelope_invalid`  | 400  | Wrapper shape wrong (missing fields, bad hex)      |
| `signature_invalid` | 401  | Ed verify returned false / malformed point         |
| `payload_malformed` | 400  | Signed bytes weren't valid JSON                    |
| `payload_invalid`   | 400  | JSON parsed but rejected by schema                 |
| `timestamp_skew`    | 401  | `ts` outside the 120s window                       |
| `replay`            | 401  | Nonce already seen within the window               |

Auth-class problems get 401; structural problems get 400.

### Client-side flow (sign.ts)

```ts
const envelope = signRequest(identity, 'allocateIp', { kind: 'mission_instance' });
fetch('/api/allocate-ip', { method: 'POST', body: JSON.stringify(envelope) });
```

`signRequest` injects `action`, `ts`, `nonce` itself — caller-supplied versions of those fields are stripped, so a misbehaving caller can't backdoor a stale timestamp or pre-known nonce.

### Constants

- `REPLAY_WINDOW_MS = 120_000` (120 seconds)
- `NONCE_HEX_LENGTH = 32` (16 random bytes)
- payload max length: 8192 chars
- publicKey: 64 hex chars; signature: 128 hex chars

### Nonce store abstraction

`NonceStore` is an interface over "atomic set-if-not-exists with TTL":

- `createUpstashNonceStore(setFn)` — wraps `redis.set(key, value, { ex: 120, nx: true })`. Returns `{ fresh: true }` on first write, `{ fresh: false }` on duplicate.
- `noopNonceStore` — always reports fresh. Used in local dev when Upstash env vars aren't set. Replay protection is effectively disabled in this mode (acceptable for dev).

A single `Redis` client is shared across the rate limiter (`prefix: 'allocate-ip'` / `'sessions'` / `'patches'` / `'register-workstation'` / `'join-home-network'` / `'lookup-home-network'`) and the nonce store (`prefix: 'nonce:*'`).

## 4.4 Database schema (Supabase Postgres)

All multiplayer state lives in seven tables. The **universal RLS posture** across every table: anon + authenticated denied by default; only `service_role` (used inside Vercel functions) reads/writes. The handful of `SELECT FOR anon` policies on `public_ips`, `home_networks`, `home_network_occupants`, `world_networks` exist because those rows are publicly discoverable in-game (nmap, WiFi scan) — there's no secrecy at the registry layer.

### 4.4.1 `public_ips`

Global unique registry of every allocated public IP across all network kinds. PRIMARY KEY on `ip` is the collision-prevention mechanism — concurrent allocations re-roll on PK conflict.

```sql
CREATE TABLE public_ips (
  ip             TEXT        PRIMARY KEY,
  kind           TEXT        NOT NULL CHECK (kind IN (
                              'mission_instance', 'home_network', 'pivot',
                              'npc_faction', 'darknet_hub', 'world_network'
                             )),
  owner_key      TEXT,
  instance_ref   TEXT,
  allocated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX public_ips_owner_key_idx ON public_ips (owner_key) WHERE owner_key IS NOT NULL;
CREATE INDEX public_ips_kind_idx ON public_ips (kind);
```

RLS: SELECT open to anon (IPs are public by nature — players nmap them); INSERT/UPDATE/DELETE no policies (service_role only).

### 4.4.2 `sessions`

Server-authoritative session registry. Each row = a player's presence on a machine with credentials. The L1 patch-validation gate consults this table on every mutating write.

```sql
CREATE TABLE sessions (
  session_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_key        TEXT        NOT NULL,                   -- hex Ed25519 pubkey
  machine_id        TEXT        NOT NULL,                   -- target machine IP / workstation_id
  credentials       JSONB       NOT NULL,                   -- { username, userType }
  parent_session_id UUID        REFERENCES sessions(session_id) ON DELETE CASCADE,
  source_ip         TEXT,                                   -- denormalized parent.machine_id
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  end_reason        TEXT,
  kind              TEXT        NOT NULL DEFAULT 'ssh'      -- session kind, see §4.6
);

CREATE INDEX sessions_active_by_player_idx ON sessions (player_key) WHERE ended_at IS NULL;
CREATE INDEX sessions_parent_idx           ON sessions (parent_session_id) WHERE parent_session_id IS NOT NULL;
```

RLS: ALL operations denied to anon + authenticated. service_role only.

`parent_session_id` forms a tree per the hop chain. `source_ip` denormalizes `parent.machine_id` so log-realism reads it directly without walking the chain. Cascade-end on parent end is **application-level recursion**, not FK action — we want UPDATE (ended_at + end_reason), not DELETE.

### 4.4.3 `patches`

Per-player journal of every FS mutation. Composite PK doubles as natural UPSERT key.

```sql
CREATE TABLE patches (
  player_key  TEXT        NOT NULL,
  machine_id  TEXT        NOT NULL,
  path        TEXT        NOT NULL,
  content     TEXT,                                       -- null = base-fs deletion marker
  owner       TEXT        NOT NULL,                       -- 'root' | 'user' | 'guest'
  permissions JSONB,                                      -- { read, write, execute }
  is_new      BOOLEAN     NOT NULL DEFAULT false,
  node_type   TEXT        NOT NULL DEFAULT 'file',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_key, machine_id, path)
);
```

RLS: ALL denied to anon + authenticated. service_role only.

The PK prefix scan serves `WHERE player_key = me` queries. Cross-player reads (`listPatchesForMachines`) hit the `machine_id` predicate.

### 4.4.4 `home_networks` + `home_network_occupants`

Cracked-WiFi LAN catalog. Two players who crack the same WiFi join the same LAN with separate occupant rows.

```sql
CREATE TABLE home_networks (
  public_ip       TEXT        PRIMARY KEY REFERENCES public_ips(ip) ON DELETE CASCADE,
  essid_template  TEXT        NOT NULL,
  density_tier    TEXT        NOT NULL CHECK (density_tier IN ('crowded','shared','solo')),
  max_slots       INT         NOT NULL CHECK (max_slots > 0),
  seed            TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX home_networks_template_tier_idx ON home_networks (essid_template, density_tier, created_at);

CREATE TABLE home_network_occupants (
  network_id    TEXT        NOT NULL REFERENCES home_networks(public_ip) ON DELETE CASCADE,
  player_key    TEXT        NOT NULL,
  lan_ip        TEXT        NOT NULL,
  hostname      TEXT        NOT NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (network_id, player_key),
  UNIQUE (network_id, lan_ip),
  UNIQUE (network_id, hostname)
);
CREATE INDEX home_network_occupants_player_idx ON home_network_occupants (player_key);
```

RLS: SELECT open to anon (schema is public game state — knowing a LAN exists doesn't leak occupancy beyond what in-LAN nmap reveals). INSERT/UPDATE/DELETE no policies — service_role only.

`(network_id, player_key)` PK enforces "one slot per player per LAN" for idempotent joins. `UNIQUE (network_id, lan_ip)` and `UNIQUE (network_id, hostname)` prevent slot collisions.

### 4.4.5 `world_networks`

Shared persistent themed networks (playground, findit.io, techparts.io, future: office, police, university, café). Ships content via SQL migration, not the API.

```sql
CREATE TABLE world_networks (
  public_ip   TEXT        PRIMARY KEY REFERENCES public_ips(ip) ON DELETE CASCADE,
  seed        TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  description TEXT,
  theme       TEXT        NOT NULL DEFAULT 'playground',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX world_networks_theme_idx ON world_networks (theme);
```

RLS: SELECT open to anon (world content is universally visible). INSERT/UPDATE/DELETE no policies — content curation via service_role + migrations.

Seed row: playground at `203.0.113.42` (TEST-NET-3 IETF docs range). Themed rows added via additional migrations (search-metadata, findit, techparts).

### 4.4.6 `workstations`

One row per player. Drives the L2 own-workstation base-FS backfill — without this, an intruder with a cracked session on Player A's workstation could forge envelopes that bypass L2 (no rows in `machine_filesystems` for A's machine_id → leaf-only fallback permits everything).

```sql
CREATE TABLE workstations (
  player_key       TEXT        PRIMARY KEY,
  workstation_name TEXT        NOT NULL,
  username         TEXT        NOT NULL,
  seed             TEXT        NOT NULL,                  -- added later for /etc/passwd hash regen
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

RLS: ALL denied to anon + authenticated. service_role only.

Idempotency: `INSERT ... ON CONFLICT (player_key) DO NOTHING` + read-back select. Same `(workstation_name, username)` → 200; mismatch → 409 (silent overwrite would change workstation_id and orphan every dependent `machine_filesystems` row).

Stored fields are intentionally minimal — only what's needed to regenerate the workstation FS deterministically server-side. `rootPassword` is **not** persisted; `/etc/passwd` hash is dual-written into `machine_filesystems.content` at registration time and lives there.

### 4.4.7 `machine_filesystems`

Server-side projection of current FS state. Used by L2 to walk permissions. Per-machine (not per-player) — last-write-wins is a property of the projection, not the journal.

```sql
CREATE TABLE machine_filesystems (
  machine_id  TEXT        NOT NULL,
  path        TEXT        NOT NULL,
  owner       TEXT        NOT NULL,
  permissions JSONB       NOT NULL,
  content     TEXT,                                       -- nullable; populated only for paths in FS_PROJECTED_CONTENT_PATHS
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (machine_id, path)
);
CREATE INDEX machine_filesystems_path_prefix_idx ON machine_filesystems (machine_id, path text_pattern_ops);
```

RLS: ALL denied to anon + authenticated. service_role only.

`text_pattern_ops` supports `LIKE 'prefix%'` index scans even under non-C UTF-8 collations (cascade-delete path needs prefix-range queries). `content` is selectively populated — see §4.16.

### Dual-write SQL functions

Two plpgsql functions wrap patch + projection writes in a single Postgres transaction. The Vercel function (`api/patches.ts`) issues exactly one RPC and the database guarantees atomicity:

- `upsert_patch_with_fs(p_player_key, p_machine_id, p_path, p_content, p_owner, p_permissions, p_is_new, p_node_type, p_dual_write, p_project_fs_content) RETURNS VOID` — writes the `patches` row; if `p_dual_write AND p_permissions IS NOT NULL`, also writes the `machine_filesystems` row (`content` filled when `p_project_fs_content` is true, NULL otherwise).
- `remove_patches_with_fs(p_player_key, p_machine_id, p_path, p_path_prefix, p_dual_write) RETURNS TABLE (deleted_path TEXT)` — deletes from `patches` (exact + descendants via LIKE 'prefix%') and, if `p_dual_write`, cascades to `machine_filesystems`.

Execution is locked down: `REVOKE EXECUTE ... FROM PUBLIC` + `GRANT EXECUTE ... TO service_role`. Anon + authenticated cannot bypass RLS via the function.

## 4.5 Server endpoints (`api/`)

Every endpoint is a Vercel function following the same shape: `method guard → env var lookup → Supabase + Upstash client construction → handleXRequest(req.body, deps)`. The handler is **pure** and unit-tested separately; the file in `api/` is glue only.

Common middleware: `verifySignedRequest` (envelope + signature + replay), then `rateLimiter` (per-pubkey sliding window via `@upstash/ratelimit`), then dispatch on `payload.action`. Distinct rate-limit prefixes per endpoint (`allocate-ip`, `sessions`, `patches`, `register-workstation`, `join-home-network`, `lookup-home-network`) keep budgets independent.

### 4.5.1 `/api/register-workstation`

Once-per-game endpoint. Records `(player_key, workstation_name, username, seed)` in `workstations` and populates `machine_filesystems` with the workstation's base FS via `regenWorkstationRows` (calls `generateLocalhost` deterministically, then `bulkInsertMachineFs` with `ON CONFLICT DO NOTHING`).

- 201 `inserted: true` on fresh insert.
- 200 `inserted: false` on idempotent repeat (same name + username).
- 409 `already_registered` on mismatch (different workstation_name for same player_key).
- 401 `signature_invalid` on tampered signature.

Rate limit: 5/min per pubkey. Populate is best-effort — failure logs but doesn't fail the request; `scripts/backfillWorkstationBaseFs.ts` catches misses idempotently.

### 4.5.2 `/api/allocate-ip`

Mints a new public IP under one of six `kind` values (mission_instance / home_network / pivot / npc_faction / darknet_hub / world_network). PK conflict on `public_ips(ip)` triggers re-roll. Fresh PRNG per allocation (seeded with `randomUUID()`) so allocations are non-deterministic across requests on the same process.

Rate limit: 30/min per pubkey.

### 4.5.3 `/api/join-home-network`

Idempotent: existing occupant row for `(essid_template, density_tier, player_key)` short-circuits and returns the existing slot. Otherwise:

1. Find a network with free slots for the (template, tier).
2. If none, allocate a new public_ip via `allocateIp({kind:'home_network'})` and INSERT a new `home_networks` row.
3. On new-network insert, fire `populateBaseFsBestEffort` — `regenHomeNetworkRows({seed, publicIp})` + bulk insert with `ON CONFLICT DO NOTHING`.
4. Pick a LAN IP via `pickRandomLanIp` excluding (a) NPC octets (deterministic from `getReservedLanOctets`) and (b) existing occupant octets on this LAN.
5. INSERT `home_network_occupants` row.
6. Broadcast occupant change via Realtime REST API.

Rate limit: 30/min per pubkey.

### 4.5.4 `/api/lookup-home-network`

Read endpoint for the cross-LAN seed-regen resolver. Fetches a foreign `home_networks` row by `public_ip`. RLS keeps anon SELECT off the table directly; this signed-envelope endpoint is the read boundary.

Rate limit: 120/min per pubkey.

### 4.5.5 `/api/sessions`

Single endpoint, action-dispatched. Four actions, all sharing the verify+rate-limit prelude:

- **`createSession`** — for kinds with envelope-trusted tier (`exploit`, `effect_one_shot`, `nc` legacy path). Server-stamps `player_key`. Performs **server-side userType validation** against `/etc/passwd` projection: if `findEtcPasswdContent` returns content and the username appears, `deriveUserTypeFromEtcPasswd` must match the claimed `userType` (else 400 `usertype_mismatch`). No-op cases (no projection / no matching user) **permit the claim** — kinds reaching this validation use synthetic placeholders (`'msf'`, shell-effect names, pidfile sentinels) by design. Auth-required kinds (ssh/scp/su/ftp/mysql/redis/snmp) sent here return 403 `use_authcreatesession`.
- **`authCreateSession`** — server-authoritative auth + session creation for auth-required kinds. Each kind reads its credential file from `machine_filesystems.content` and validates:
  - `ssh`/`scp`/`su` → `/etc/passwd` (password or savedKey fingerprint = `md5(username:targetIp:hash)`)
  - `ftp` → `/etc/vsftpd/virtual_users.conf` overlay; `/etc/passwd` fallback; userType always from `/etc/passwd`; password-only (savedKey rejected)
  - `mysql` → `/var/lib/mysql/data.json` (multi-user JSON; userType from the entry)
  - `redis` → `/etc/redis/redis.conf` requirepass (shared secret; sentinel `username:'redis'`, `userType:'root'`); no requirepass directive = open access
  - `snmp` → `/etc/snmp/snmpd.conf` rwcommunity (shared secret; sentinel `username:'snmp'`, `userType:'root'`)
  - `nc` → `/var/run/nc-<port>.pid` (method:`'pidfile'` only; credentials parsed from `nc:port=X,user=Y,userType=Z,home=W`; server-derived, never trusted from envelope)
  - All failure modes collapse to **401 `invalid_credentials`** (no info leak about machine state or username existence).
- **`endSession`** — UPDATE filter `player_key + ended_at IS NULL`. Cascade-ends all active descendants with `end_reason='cascade'` via app-level recursion. Three failure cases (not exists / not yours / already ended) collapse to **404 `session_not_found`**.
- **`listSessions`** — caller's active sessions only, ordered `created_at ASC`. Returns `SessionSummary[]` including `kind` for client-side rehydration filtering.

Rate limit: 60/min per pubkey. Insert with explicit `kind` (required since the migration — no server default).

### 4.5.6 `/api/patches`

Single endpoint, action-dispatched. Seven actions:

- **`upsertPatch`** — L1 + L2 gate (§4.8, §4.9), then RPC `upsert_patch_with_fs`. Realtime hint broadcast on success.
- **`removePatch`** — L1 + L2 gate, then RPC `remove_patches_with_fs`. Realtime hint broadcast.
- **`listPatchesForMachines`** — cross-player read; runs the three-tier read filter (§4.10).
- **`clearOwnedPatches`** — DELETE `WHERE player_key=me AND machine_id=$workstation_id`. Both filters load-bearing.
- **`getBaseFs`** — cross-player workstation FS replication (§4.11).
- **`exploitRead`** — single-path file_read / dir_list CVE effect (§4.12).
- **`crackCredentials`** — batched hydra (§4.13).

Rate limit: 120/min per pubkey.

## 4.6 Session model (kinds, userType validation contract)

A session row = `(player_key, machine_id, credentials{username, userType}, kind)` + parent/source-IP hop-chain + lifecycle timestamps.

### Ten kinds, three categories

**Shell-class** (go on the SessionContext snapshot stack; rehydration filters to these for linear-chain reconstruction):
- `ssh` — SSH login
- `su` — user switch on same machine (parent_session_id = previous session; same machine_id)
- `exploit` — post-exploit shell (`shell_full` CVE effect)

**Protocol** (live in dedicated client-side state; pushed/ended on login/logout):
- `ftp`, `mysql`, `redis`, `nc`

**Transient one-shot** (pushed via `withTransientSession` for a single patch fire, then ended):
- `scp`, `snmp`, `effect_one_shot`

The L1 patch-validation gate doesn't care which kind — it only asks "does any active session row exist for `(player_key, machine_id)`?". `kind` matters at rehydration (SessionContext filters to `('ssh','su','exploit')` before reconstructing the linear chain — protocol sessions don't go on the stack).

### Server-side userType validation contract

`createSession` reads `/etc/passwd` content from `machine_filesystems` (the projected-content overlay; `/etc/passwd` is in `FS_PROJECTED_CONTENT_PATHS`). If the file is projected AND the claimed username has a matching entry, the server derives the canonical userType and rejects mismatches with **400 `usertype_mismatch`**.

### Relaxed `usertype_underivable` rule (2026-05-11)

Earlier defense-in-depth rejected ANY claim where userType couldn't be derived. This broke legitimate cross-player CVE flows — the kinds that REACH `createSession` (`effect_one_shot`, `exploit`, `nc` legacy) use synthetic placeholder usernames (`'msf'`, shell-effect names, pidfile sentinels) that don't appear in `/etc/passwd` by design.

**Current rule**: only actual mismatches reject. No-projection / no-matching-entry cases **permit the envelope-trusted tier**. Sabotage-via-garble (attacker who CVE'd `/etc/passwd` into mush) is still enforced — but via `authCreateSession`, which IS the path real player logins take. Garble breaks login; it doesn't (and shouldn't) break CVE effects, which bypass auth by definition.

Auth-required kinds (ssh/scp/su/ftp/mysql/redis/snmp) cannot reach `createSession` at all — they're blocked at the dispatch gate with **403 `use_authcreatesession`**.

### Hop chain semantics

- SSH from localhost to A: `A.parent = null` (localhost implicit, never tracked).
- SSH from A to B: `B.parent = A.session_id`.
- `su` on A from alice to root: new row with `parent = A.session_id`, same `machine_id`, different `credentials`.
- `source_ip` denormalizes parent's `machine_id` so access-log realism reads it directly without walking.

### Server-stamped `player_key`

Every write stamps `player_key` from the verified Ed25519 pubkey, never from a client claim. Strict zod schemas reject any client-supplied `player_key` field (400 `payload_invalid`).

## 4.7 Patch model

A patch row encodes a single FS mutation in the canonical journal:

```ts
type PatchRow = {
  readonly player_key: string;      // server-stamped
  readonly machine_id: string;
  readonly path: string;
  readonly content: string | null;  // null = base-fs deletion marker
  readonly owner: 'root' | 'user' | 'guest';
  readonly permissions?: FilePermissions;
  readonly is_new?: boolean;        // true = file/dir created via patch
  readonly node_type?: 'file' | 'directory';
};
```

### Client API surface

```ts
upsertPatch(identity, patch: FileSystemPatch) → Promise<void>
removePatch(identity, { machineId, path }) → Promise<void>
listPatchesForMachines(identity, machine_ids: string[]) → Promise<FileSystemPatch[]>
clearOwnedPatches(identity, workstation_id) → Promise<void>
getBaseFs(identity, machine_id) → Promise<{baseFs: FileNode|null}>
exploitRead(identity, { machine_id, path, kind }) → Promise<{content|entries}>
crackCredentials(identity, { machine_id, service, candidate_hashes, user_filter? })
  → Promise<{hits: {username, matched_hash}[], attempts: number}>
```

Wrappers handle camelCase ↔ snake_case translation defensively — callers only see `FileSystemPatch`.

### Two-call deletion

`broadcastAndRecordPatch` decides per case:

| Case                              | Server calls                                       |
| --------------------------------- | -------------------------------------------------- |
| Write/create (`content !== null`) | `upsertPatch`                                      |
| Delete isNew file                 | `removePatch`                                      |
| Delete base-fs file               | `removePatch` THEN `upsertPatch` (null marker)     |

### Last-write-wins ordering

`listPatchesForMachines` orders `updated_at ASC`. Client-side `applyPatches` reduces in array order, so the latest write per `(machine_id, path)` wins automatically.

### Reset semantics: `clearOwnedPatches`, not `clearAllPatches`

`reset confirm` wipes `WHERE player_key = me AND workstation_id = me`. Does NOT wipe the player's mutations on OTHER players' machines — those are gameplay actions in the shared world. Concrete scenario: A roots B's box and `rm`s a file. A resets → A's local game starts over, but B's view of the deleted file stays deleted.

### Defensive content sanitization

Postgres TEXT columns reject NUL bytes (`U+0000`, error 22P05). Mock binary contents (e.g. `/usr/bin/nmap`'s `'\x7fELF\0\0\0...'` placeholder) carry them. `sanitizeContent` replaces with `U+FFFD` REPLACEMENT CHARACTER before the upsert adapter. Done at the handler (not the client wrapper) as defense-in-depth — any signed envelope, including hand-crafted ones, gets cleaned.

## 4.8 L1 validation + ambient log allowlist

Every mutating action on a remote machine MUST be backed by an active session row for this player on that machine. The player's own workstation is exempt (`isOwnWorkstationOnServer` short-circuit — suffix match against `deriveHostnameSuffix('ed25519:' + playerKey)`).

```
verify → rate-limit → if (not own workstation AND not ambient log path):
                        findActiveSession(player_key, machine_id)
                          - DB error           → 500 session_lookup_failed
                          - no row             → 403 no_session
                          - active row exists  → proceed to L2
                      ... existing action logic
```

### Ambient log path allowlist (AMBIENT_LOG_FILES)

Recon actions (nmap, curl, hydra, gobuster, ssh-failure logging) leave trail logs on the target machine without the actor having a session there. L1 was designed for "I logged in, I'm mutating" mutations; ambient log writes are a different class — the network records the probe as a side effect; cross-player visibility on those logs gives defenders agency.

Hard-coded allowlist (exhaustive — every entry has a real writer in the codebase):

| File                  | Writers                                |
| --------------------- | -------------------------------------- |
| `/var/log/auth.log`   | ssh, scp, su, hydra-ssh                |
| `/var/log/access.log` | curl, gobuster, HTTP CVEs              |
| `/var/log/kern.log`   | nmap                                   |
| `/var/log/vsftpd.log` | ftp, hydra-ftp, FTP CVEs               |
| `/var/log/mysql.log`  | mysql, hydra-mysql, MySQL CVEs         |
| `/var/log/redis.log`  | redis, hydra-redis, Redis CVEs         |
| `/var/log/mail.log`   | mail CVEs                              |
| `/var/log/syslog`     | nc, hydra-telnet, generic CVE fallback |

**Allowlist (not `/var/log/` prefix)** so a forged envelope can't plant arbitrary files anywhere under `/var/log/` on a machine the actor doesn't own (e.g. `/var/log/payload.sh`, `/var/log/.ssh/config`). Adding a new logger means adding an entry — bypass is intentionally append-only and code-controlled.

**Bypass applies ONLY to `upsertPatch`**. `removePatch` on an allowlisted log path still requires a session — covering tracks needs real access. Predicate runs on the verified `payload.path`; client cannot spoof.

## 4.9 L2 validation (shared walker, machine_filesystems projection, Pattern A)

After L1 (or ambient log / own-workstation bypass), L2 confirms the active session's credentials have permission for the requested mutation on the target path.

```
fetchSessionCredentials(player_key, machine_id)
  → Credentials | own-workstation bypass | 500
  → if no bypass:
      findMachineFs(machine_id, path)
        → row     → canWrite({userType, target: row.permissions, parentChain: []})
                      → deny  → 403 permission_denied
                      → allow → proceed to dual-write RPC
        → no row  → permit (leaf-only fallback)
        → error   → 500 fs_lookup_failed
```

### Shared walker

`canWrite` / `canRead` live in `src/filesystem/permissionWalker.ts` — a single **pure module that the client also imports**. Both sides agree on allow/deny by construction. The walker takes `{ userType, target: FilePermissions, parentChain: FilePermissions[] }` and returns `{ allowed: boolean, reason?: string }`. Today's L2 write wiring is leaf-only (empty parentChain); the read filter (§4.10) uses the full ancestor chain.

### Pattern A: eager denormalization

Every successful patch dual-writes to `machine_filesystems` in the same Postgres transaction via the RPC. Base FS for shared networks is bulk-populated at provision time:

| Network               | Coverage today                                                                       |
| --------------------- | ------------------------------------------------------------------------------------ |
| Workstation (own-box) | Bypassed for owner writes; full for non-owner access via `register-workstation` populate + backfill |
| Home network LANs     | Full — populated at create time (Step 7 in `join-home-network`) + idempotent backfill |
| World networks        | Full — populated via `scripts/backfillWorldNetworkBaseFs.ts` (re-run after each new themed-network migration) |
| Mission machines      | Leaf-only — blocked on `mission_instances` (decided 2026-04-23)                      |

"Leaf-only" means only paths that have ever been patched have rows in `machine_filesystems`. L2 enforces forever on those; permissive on truly-untouched paths. As soon as anyone touches a path once, L2 takes over for it.

### Why dual-write through SQL functions

Atomicity. The plpgsql functions wrap both writes in one transaction so a `patches` row never exists without its `machine_filesystems` projection (when applicable). A two-call JS approach would either need an explicit transaction (Supabase JS doesn't expose one cleanly) or risk skew on partial failure.

### Multi-player overlap caveat

`machine_filesystems` is shared per machine; `patches` is per-player. If two players hold patches at the same path and one deletes, the projection row goes away even though the other player's patch still exists. L2 falls back to "absence → permit" (under-permissions until the remaining player's next write re-projects). Acceptable for v1 — a future reconcile step (recompute `machine_filesystems` from surviving patches) closes the gap.

## 4.10 Read-path privacy filter (3 tiers)

`listPatchesForMachines` runs a **per-row filter** before returning. Without this, anyone who can sign a request and name a discoverable machine_id could pull `/root/*`, wallet keys, and `/etc/passwd` hashes — breaking the wallet-defense gameplay premise.

For each row in the SQL result:

1. **Owner of the workstation** (suffix-match on requester's `player_key`) → keep. Workstation-only — never fires for other players' workstations or non-workstation machines.
2. **Has active session on the machine** → walker `canRead` with the **full ancestor chain** (`ancestorPaths(path).map(fsLookup)`). Drop if denied. Leaf-only fallback (`target === null → permit`) keeps parity with L2 writes.
3. **No session** → keep only if path matches `READ_ALLOWLIST` glob patterns; default-deny otherwise.

```ts
export const READ_ALLOWLIST: readonly string[] = [
  '/var/run/*.pid',
  '/etc/iptables/rules.v4',
  '/etc/snmp/snmpd.conf',
  '/etc/switch/acl.conf',
  '/var/www/**',
  '/var/lib/dpkg/status',
];
```

The patterns describe files **observable from outside the box** via simulated network protocols (port banners, HTTP, nmap -sV, firewall probing). Leaking them through the patch stream mirrors what an off-box observer can already gather; excluding them would make the simulation inconsistent for no-session callers.

Files NOT on this list (`/etc/passwd`, `/root/*`, `/home/<user>/*`, wallet keys, shell history, `/var/log/*`) drop through default-deny. `/etc/passwd` specifically excluded — passwords live inline in `/etc/passwd` in this game; letting no-session callers fetch the hash list would enable offline cracking without ever establishing presence on the box.

### Performance

Two extra round-trips (`findMachineFsBatch` + `findActiveSessionsBatch`) run in **parallel** after the SQL select. Single SQL call each. Distinct 500 error codes (`session_lookup_failed` / `fs_lookup_failed`) so callers can tell what broke.

### Universality

The filter applies uniformly to every machine type (workstations, home-net, world-net, mission). Only tier 1 is workstation-specific (the suffix match).

## 4.11 Cross-player base FS replication (`getBaseFs`)

When player A establishes a session on player B's workstation, A's client fires `getBaseFs(B's workstation_id)` once and the server returns the tier-walked base FS. Subsequent patches are layered via `listPatchesForMachines`.

```
parseWorkstationId(machine_id) → 400 unsupported_machine_type if not workstation shape
findWorkstationsByName(parsed.name) → 404 workstation_not_found if no matching row
                                       (matching row's computeWorkstationId must equal payload.machine_id)

regen = generateLocalhost({seed: row.seed, workstationName, username,
                          rootPassword: GET_BASE_FS_SENTINEL_ROOT_PASSWORD}, machine_id)

collectProjectedPathsFromTree(regen) → list of paths in FS_PROJECTED_CONTENT_PATHS
findFsContentBatch(machine_id, projectedPaths) → Map<path, content>  (real /etc/passwd hash etc.)
overlaid = overlayProjectedContent(regen, contentMap)

tier dispatch:
  Owner (suffix-match)              → return baseFs: overlaid (unfiltered)
  Has active session                 → walker-filter via filterFileNodeForRead at user_type → return baseFs: filtered
  No session                         → return baseFs: null (defense in depth)
```

### Why a placeholder rootPassword

The real `rootPassword` isn't persisted server-side (decision #2 in the L2 plan — minimal storage). `generateLocalhost` needs *some* string to hash for `/etc/passwd`'s placeholder; the sentinel value's md5 is `md5('GET_BASE_FS_SENTINEL')` which is useless for cracking. The **overlay** step then replaces `/etc/passwd` content with what's actually stored in `machine_filesystems.content` — so the FS A receives matches the FS the server's auth path validates against.

### Non-workstation routing

NPC home / world / mission machines aren't routed here. A regenerates them identically from seed locally (the seed is in `home_networks.seed` / `world_networks.seed`, fetched via `/api/lookup-home-network` for cross-LAN). Workstations are the only machine type that needs server-side regen because the player's identity-derived `workstation_id` doesn't appear in any catalog the foreign LAN can read.

## 4.12 `exploitRead` endpoint

Cross-player single-path read for `file_read` and `dir_list` CVE effects. msfconsole's wiring wraps the call in `withTransientSession(kind='effect_one_shot')` at the CVE-granted tier, then signs the envelope.

```
parseWorkstationId → 400 if not workstation shape
findWorkstationsByName + match → 404 if missing
regen + overlay (same as getBaseFs)

tier dispatch:
  Owner suffix match → effectiveUserType = 'root'
  Else: findActiveSession → 403 no_session if absent (FORGE GUARD)
        effectiveUserType = sessionRow.credentials.userType

listPatchesForMachines (cross-player) → applyPatches onto overlaid tree
                                        (so post-NEW-GAME files like /root/secret.txt are visible)

resolveNodeAndParentChain(merged, path)
  if kind === 'file_read':
    if !node || node.type !== 'file' → return { content: null }
    canRead({userType, target, parentChain}) → if denied: { content: null }
    else: { content: node.content ?? '' }
  if kind === 'dir_list':
    if !node || node.type !== 'directory' → return { entries: null }
    canRead → if denied: { entries: null }
    else: { entries: Object.keys(children).sort() }
```

### Tier source: the session row's `user_type`

The tier comes from the **active `effect_one_shot` session row's `user_type`** (minted by `withTransientSession` on the client at the CVE-granted userType). NEVER read from the wire envelope — the schema explicitly rejects a `tier` field. This makes the trust source identical to `writeRemoteFile + upsertPatch`, which already establishes that an attacker can mint any tier via `createSession`. That's the documented L3 gap (§4.17).

## 4.13 `crackCredentials` endpoint (batched hydra)

Pre-auth batched brute-force for SSH/FTP. Caller sends md5(plaintext) candidate hashes for a wordlist batch (1..200 entries); server reads B's projected credential files and returns matching `{username, matched_hash}` pairs.

```
parseWorkstationId → 400 if not workstation shape
findWorkstationsByName + match → 404 if missing

paths = service === 'ftp' ? ['/etc/passwd', '/etc/vsftpd/virtual_users.conf'] : ['/etc/passwd']
findFsContentBatch(machine_id, paths) → contentByPath

build userHashes from /etc/passwd (lines split on ':', username:hash pairs)
if service === 'ftp' and virtual_users.conf has content:
  parseVirtualUsersConf(vu) overlays vu.passwordHash onto userHashes  (overlay precedence)

apply optional user_filter (drop everyone except named user)

candidateSet = lowercase(payload.candidate_hashes)
for (username, hash) of effectiveUsers:
  if candidateSet.has(hash.toLowerCase()) → hits.push({username, matched_hash: hash})

attempts = effectiveUsers.size * candidate_hashes.length
return { hits, attempts }
```

### Trust model — pre-auth by design

No session check. Hydra is the **PRE-auth tool**. Raw stored hashes never cross the wire — candidate md5s are values an attacker could compute themselves from any wordlist, so server-side hash matching leaks no more than offline brute-force already does. Natural per-batch RTT paces STATUS lines; `SERVER_MAX_HYDRA_BATCH_SIZE = 200` caps per-request work.

### Why skip regen + applyPatches (unlike `exploitRead`)

Credential paths are in `FS_PROJECTED_CONTENT_PATHS`, so every patch that mutates them dual-writes the new content to `machine_filesystems.content` (`upsert_patch_with_fs` honors `p_project_fs_content`). `findFsContentBatch` therefore returns the post-patch state directly. `password_reset` rolls land here naturally because the patch's content arrives via the same dual-write path.

### Validation rejections

zod rejects (400 `payload_invalid`): oversized batch (>200), empty `candidate_hashes`, non-hex hash, unsupported service. Unsupported `machine_id` → 400 `unsupported_machine_type`. Missing workstation row → 404 `workstation_not_found`.

## 4.14 Realtime channels (hint-only broadcasts)

After every successful `upsertPatch` / `removePatch`, the handler fires a **fire-and-forget** broadcast to a per-machine channel:

```
verify → rate-limit → mutate → if ok:
  broadcast(`patches:${machine_id}`, 'patch_change', { machine_id, originator_key })
```

Server-to-Realtime path: `api/patches.ts` POSTs directly to `${SUPABASE_URL}/realtime/v1/api/broadcast` with the `service_role` key. Direct fetch beats opening a WebSocket per Vercel function invocation — these functions are short-lived. The REST endpoint is one-shot, idiomatic for server-side publish.

### Hint, not payload

The payload is `{ machine_id, originator_key }` — **not the full patch**. Subscribers (`subscribeToMachine` in `realtime.ts`, wired into `FileSystemContext`):

1. **Skip the hint** if `originator_key === own_pubkey` (local optimistic apply + BroadcastChannel cross-tab fan-out already covered same-identity writes).
2. **Otherwise**, accumulate `machine_id` into a debounced (~150ms) refetch set.
3. **On debounce flush**, fire `listPatchesForMachines([...affectedMachineIds])` against the signed endpoint and splice the authoritative result into local `patches` state. Pending in-flight local writes (tracked in a `Map<key, FileSystemPatch>`) are replayed on top so a cross-player refetch doesn't clobber what the user just typed.

Result: cross-player writes appear within ~300-500ms (debounce + round-trip), with zero risk of forged content corrupting local state.

### Trust model — closed by hint architecture

The Realtime broadcast channel is anon-publishable from the browser bundle (the anon key ships in the bundle by design), so any client can call `channel.send()`. Under the prior full-payload design, a malicious player could forge a `patch_change` event with fake content; the local view diverged from server truth until the next page reload.

Hint-only defangs this architecturally:

- There's no content / path / owner in the broadcast — **nothing to inject**.
- Forged hints just trigger a refetch via the signed endpoint, which returns server truth.
- Spamming forged hints with `originator_key = victim_pubkey` makes the victim skip ONE refetch per forgery; authentic hints from real writers (different `originator_key`) still trigger refetches. Net effect: harmless DoS-style noise, no data corruption.

The earlier attempt to close the vector via Supabase Realtime authorization rules (`private: true` channels + RLS on `realtime.messages`) was reverted — the new `sb_publishable_*` key format and unspecified `setAuth()` requirements made the configuration brittle. See `project_realtime_publish_authorization` for the post-mortem.

### Client subscription wrapper

`subscribeToMachine(supabase, machine_id, onHint)` returns an `unsubscribe` cleanup function. Must be called on component unmount / view-keyset change — channels leak across React Strict Mode's double-effect cycle and across mid-session network transitions. Wire-shape (snake_case) → client-shape (camelCase) translation lives in `realtime.ts`.

Lazy singleton anon-key Supabase client (`getRealtimeClient`): reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` from build-time env. Returns `null` if either missing — `FileSystemContext` degrades to no live updates rather than crashing.

## 4.15 BroadcastChannel cross-tab sync

`BroadcastChannel('jshack.patches')` fans patch writes across all open tabs of the same browser (same identity). Pairs with Realtime for cross-device — same identity in two tabs of the same browser gets the BroadcastChannel path (cheaper); same identity across browsers / devices gets the Realtime path.

Same `applyExternalPatch` handler is shared by both paths.

### Decision: keep both for now

After Realtime ships, BroadcastChannel cross-tab sync is technically redundant. Decision 2026-04-30: keep both, share `applyExternalPatch`. Revisit deletion post-launch when Realtime reliability is measured. See `project_broadcast_channel_vs_realtime`.

## 4.16 Selective FS content projection (`FS_PROJECTED_CONTENT_PATHS`)

`machine_filesystems.content` is selectively populated for a TS-allowlisted set of paths:

```ts
export const FS_PROJECTED_CONTENT_PATHS: readonly string[] = [
  '/etc/passwd',
  '/etc/vsftpd/virtual_users.conf',
  '/var/lib/mysql/data.json',
  '/etc/redis/redis.conf',
  '/etc/snmp/snmpd.conf',
  '/var/run/*.pid',
];

export const shouldProjectFsContent = (path: string): boolean =>
  matchesAnyGlobPattern(path, FS_PROJECTED_CONTENT_PATHS);
```

### Why these paths and not others

The bulk of patched files (logs, configs, scripts) keeps `content = NULL` in `machine_filesystems` — the `patches` table is the canonical content store, per-player. The original storage concern that motivated the column drop (20260503210309) is preserved for everything else.

These specific paths are projected because **the server needs to read them server-side** to make auth decisions on cross-player flows:

- `/etc/passwd` — `createSession` userType validation; `authCreateSession` ssh/scp/su; `crackCredentials`.
- `/etc/vsftpd/virtual_users.conf` — `authCreateSession` ftp overlay; `crackCredentials` ftp.
- `/var/lib/mysql/data.json` — `authCreateSession` mysql.
- `/etc/redis/redis.conf` — `authCreateSession` redis.
- `/etc/snmp/snmpd.conf` — `authCreateSession` snmp; also in `READ_ALLOWLIST` (snmpwalk sessionless read).
- `/var/run/*.pid` — `authCreateSession` nc pidfile auth; also in `READ_ALLOWLIST` (port-scan visibility).

### Adding a new path

A one-line change here. The dual-write SQL function (`upsert_patch_with_fs`) checks `p_project_fs_content` on every call and stores content only when the path matches this allowlist. Adding a new entry → re-run the relevant backfill script (`backfillHomeNetworkBaseFs.ts`, `backfillWorldNetworkBaseFs.ts`, `backfillWorkstationBaseFs.ts`) for existing rows.

### Projected paths force own-workstation dualWrite

Normal rule: own-workstation patches skip the `machine_filesystems` dual-write (player owns their own box; L2 not applicable for self-writes). **Exception**: paths in `FS_PROJECTED_CONTENT_PATHS` MUST dual-write even on own-workstation, because cross-player auth flows (nc-pidfile, SSH/FTP login from another player) read those paths server-side. Skipping projection for self-writes leaves the row absent → server returns 401 `invalid_credentials` when another player tries to nc / ssh / ftp in.

Handler logic in `upsertPatch`:

```ts
const isOwn = isOwnWorkstationOnServer(machine_id, publicKey);
const dualWrite = !isOwn || shouldProjectFsContent(path);
```

Same exception applies to `removePatch` — own-workstation removes of `/etc/passwd`, `/var/run/*.pid`, etc. must dual-delete or the cross-player projection lingers stale.

## 4.17 Known forge bypasses (accepted L3 gap)

The threat model accepts that any client with a valid Ed25519 keypair can forge envelopes the in-game UI would never send. Per `project_multiplayer_security_model` and `project_multiplayer_ship_first`, real mitigation is L3 game-logic re-run server-side — explicitly deferred until post-launch.

### `exploitRead` forge bypass

Any client can:

1. Sign `createSession` with `kind: 'effect_one_shot'`, claiming arbitrary `userType` (e.g. `'root'`) and a synthetic placeholder username not in `/etc/passwd` (so userType validation no-ops).
2. Get back a `session_id` at the forged tier.
3. Call `exploitRead` directly with `machine_id = victim's workstation_id`, `path = '/root/wallet.key'`, `kind = 'file_read'`.
4. Server walks at the forged-tier `userType`, reads the file, returns the content.

The entire in-game CVE flow is skipped. The active session row exists (server-stamped from the envelope), so the L1 `no_session` guard doesn't fire; the userType in the row is what the attacker claimed.

### `password_reset` inherits the same gap

`password_reset` reads `/etc/passwd` at root tier regardless of the CVE's declared tier (hardcoded — see `project_password_reset_read_tier`). Mint a root-tier `effect_one_shot` session → call `exploitRead` for `/etc/passwd` → `upsertPatch` new content. No CVE port required.

### Why we ship anyway

L3 game-logic re-run is multi-month work (replicate CVE eligibility, port resolution, NAT chain, gameTime publication check, wallet ownership, etc. server-side). Indie multiplayer dies of scope creep faster than security holes. The accepted threat model is: scripted forge bypasses exist, real defenses (gameTime / wallet / hop-chain validation) ship layer by layer post-launch. See `project_multiplayer_ship_first`.

## 4.18 Threat model & layered defense (L1, L2, L3 boundary)

| Layer       | What it checks                                                                                                                    | Status                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| L0 (transport) | Ed25519 signature + replay window + nonce dedupe                                                                              | Shipped                                                                                                          |
| L1          | Active session exists on `machine_id` for `player_key`                                                                            | Shipped (PR #78)                                                                                                 |
| L2 (writes) | Session credentials have write permission on target path (walker against `machine_filesystems`)                                   | Shipped — full on home + world + own-workstations; leaf-only on missions                                         |
| L2 (reads)  | Three-tier read filter on `listPatchesForMachines`: owner / session+walker / no-session+allowlist. Universal across machine types | Shipped                                                                                                          |
| L2 (auth)   | Server-authoritative auth + userType derivation in `authCreateSession`; userType validation against `/etc/passwd` in `createSession` | Shipped (PR #122 + relaxation 2026-05-11)                                                                     |
| L3 (game-logic) | Re-run CVE eligibility, port resolution, gameTime publication, wallet ownership, hop-chain validity server-side                | Post-launch — accepted scoped gaps documented (§4.17)                                                            |

### Boundary

The security boundary is **`Vercel function + Supabase RLS + shared permission walker on stored perms`**, NOT the client. Burp / ZAP / curl / hex-edited browser bundle are all the same threat. Smoke tests (§4.19) explicitly forge envelopes to verify this.

### What's closed by L1 + L2 today (on covered networks)

- Cross-player escalation: a guest with a legit session on machine X cannot overwrite root-owned files on X.
- Within-session escalation on patched paths: once a path is touched once, L2 enforces forever.
- Burp/ZAP/custom-client bypass on writes — RLS-backed boundary.
- No-session read of /etc/passwd hashes — three-tier filter drops them (wallet-defense premise restored).
- Forged Realtime broadcasts — hint-only architecture defangs.
- userType promotion via createSession lie — server validates against /etc/passwd projection.
- ssh/scp/su forge — auth-required kinds blocked from createSession; must go through authCreateSession which validates credentials.

### What's still open (deferred to L3)

- `exploitRead` / `password_reset` forge (mint effect_one_shot session at arbitrary tier).
- Mission machine untouched-path attacks (need server-side `mission_instances` + base-FS backfill).
- CVE eligibility re-run (was the CVE leading to this session published-by-now? did the target port match? was the attacker's gameTime advanced enough?).
- Wallet-ownership validation (server doesn't yet refuse to transfer to a non-existent wallet, etc.).
- Hop-chain realism (source_ip is currently denormalized from parent; not yet validated against the parent's session machine).

## 4.19 Smoke test catalog (`scripts/test*.ts`, `scripts/verify*.ts`)

Wire-payload smoke scripts that forge signed envelopes against a real `vercel:dev` server. Each verifies an integration seam unit tests can't cover (signed envelope → handler → SQL → wire response). All self-cleaning, idempotent — re-runnable.

| Script                            | Purpose                                                                                          | Scenarios |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | --------- |
| `testL2Bypass.ts`                 | Forge `upsertPatch` against a generic machine. Proves L2 fires on cross-player attempts.         | 3 (no_session 403 / guest permission_denied 403 / root 200) |
| `testL2BypassWorkstation.ts`      | Same as above, scoped to a freshly-registered workstation. Closes the own-workstation chunk.     | 3         |
| `testReadPathPrivacy.ts`          | Forge `listPatchesForMachines`. Three-tier filter on wire payload.                               | 3 (no-session / guest-session / owner) |
| `testGetBaseFs.ts`                | Cross-player base-FS replication endpoint.                                                       | 7 (owner full / no_session null / guest filter / user with /etc/passwd overlay / root full / 400 unsupported / 404 missing) |
| `testExploitRead.ts`              | Cross-player file_read / dir_list CVE-effect endpoint.                                            | 11 (owner content+entries / no_session 403 / tier-walked file_read+dir_list at guest/user/root / projected /etc/passwd / missing path null / file-as-directory null / 400 unsupported / 404 missing) |
| `testCrackCredentials.ts`         | Batched hydra endpoint.                                                                          | 12 (ssh hit/miss / user_filter / ftp overlay precedence / /etc/passwd fallback / 400 unsupported / 404 missing / oversized / empty / non-hex / unsupported service / pre-auth no-session hit) |
| `testCreateSessionUserType.ts`    | Server-side userType validation in createSession.                                                 | 4 (usertype_mismatch 400 / synthetic placeholder 200 / legitimate match 200 / mission stand-in no-op 200) |
| `testRegisterWorkstation.ts`      | End-to-end `/api/register-workstation`.                                                          | 8 (fresh 201 / idempotent 200 / conflicting 409 / tampered signature 401 / missing seed 400 + DB-side row + machine_filesystems count + /etc/passwd presence) |
| `testAmbientLogAllowlist.ts`      | L1 ambient-log-path allowlist on `upsertPatch`.                                                   | 14 (8 allowlisted log files → 200 bypass / 6 non-allowlisted /var/log/ paths → 403 no_session) |
| `testLookupHomeNetwork.ts`        | `/api/lookup-home-network` for cross-LAN seed-regen resolver.                                     | Coverage of public_ip lookups |
| `testServerAuth.ts`               | `authCreateSession` arms (ssh/scp/su/ftp/mysql/redis/snmp/nc).                                    | Per-kind credential matrix |
| `verifyDualWrite.ts`              | L2 dual-write SQL functions (upsert/remove with own-workstation bypass).                          | DB-direct verification of dual_write flag + project_fs_content + own-bypass |
| `verifyMachineFilesystemsRls.ts`  | RLS posture on `machine_filesystems` table.                                                      | 5 probes (anon INSERT 42501, anon SELECT empty, service_role INSERT ok, service_role SELECT ok, anon still empty post-write) |
| `verifyWorkstationsRls.ts`        | RLS posture on `workstations` table (same shape).                                                | 5 probes |

### Prerequisites for smoke runs

- Local Supabase up (`npm run supabase:start; npm run db:reset`).
- Relevant backfill ran (`scripts/backfillWorldNetworkBaseFs.ts` after every new themed-network migration; `scripts/backfillHomeNetworkBaseFs.ts` for home rows; `scripts/backfillWorkstationBaseFs.ts` for workstations).
- `vercel:dev` running (`npm run vercel:dev`) — `/api/*` endpoints are Vercel functions; `npm run dev` alone won't expose them.
- `.env.development.local` pointing at the dev Supabase project + Upstash (or noop adapters will trigger via missing env vars).

### Why smoke matters more than unit tests for this layer

Past Phase 4 effects shipped with green unit tests but multiple latent bugs that surfaced only in Phase 5 wire-payload testing. The rule (per `feedback_e2e_test_new_primitives`): unit tests prove layers in isolation; integration seams (effect → session → patch → L1 → DB) drift silently. Watch the network tab. Smoke first; then declare a chunk shipped.
