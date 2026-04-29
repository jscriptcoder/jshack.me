# Technology choices

This doc captures the non-obvious technology decisions made for JSHACK.ME's Phase 5 multiplayer rollout — what was chosen, why, what was rejected, and the trade-offs we accepted. Decisions that came with the React + Vite + TypeScript baseline (i.e. anything pre-Phase-5) aren't covered here unless Phase 5 changed them.

## Stack at a glance

| Layer                | Choice                                        | Status                                                                                                                                                                    |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend hosting     | Vercel                                        | Shipped (pre-Phase-5)                                                                                                                                                     |
| Serverless functions | Vercel Functions (Node runtime)               | Shipped                                                                                                                                                                   |
| Database + Realtime  | Supabase (Postgres + Realtime)                | Postgres shipped; Realtime planned                                                                                                                                        |
| Rate limiting        | Upstash Ratelimit (Redis over HTTPS)          | Shipped                                                                                                                                                                   |
| Input validation     | zod                                           | Shipped                                                                                                                                                                   |
| Identity             | Ed25519 keypair (browser localStorage)        | Key gen + storage + signed `/api/allocate-ip` + `/api/sessions` + `/api/patches` shipped                                                                                  |
| Sessions             | Server-authoritative `sessions` table         | Shipped — push/pop/listSessions wired through SessionContext; Realtime live-death deferred                                                                                |
| Patches              | Server-authoritative `patches` table          | Shipped — upsert/remove/list/clearTransient/clearOwned wired through FileSystemContext. **L1 validation (session-existence gate)** shipped; L2 (permission walk) deferred |
| Wallet               | Separate Ed25519 keypair (in-game filesystem) | Planned                                                                                                                                                                   |

---

## Backend: Supabase (Postgres + Realtime)

### Choice

A single Supabase project (Postgres + Realtime + Auth optional) is the canonical store for all Phase 5 server-authoritative state — public IP registry, mission instances, sessions, patches, etc.

### Why

- **Open-source + self-hostable**: Postgres is plain Postgres. Realtime is a separately-installable service. Supabase Auth uses standard JWT. If we ever need to leave Supabase, every piece is replaceable.
- **Mature + well-documented**: most Stack Overflow answers, biggest community, best LLM coverage.
- **Free tier sufficient**: 500MB DB, 200 concurrent Realtime connections, 50K monthly active users. Pre-launch and well into early launch, this covers everything.
- **One platform for several needs**: DB, Realtime, Auth, Storage, Edge Functions all in one dashboard. Reduces operational sprawl.

### Alternatives considered

- **Convex** — strong reactive-first DX, but proprietary backend; rejected on lock-in.
- **Firebase / Firestore** — battle-tested but Google-proprietary and NoSQL document model; rejected on lock-in + we want SQL.
- **Cloudflare Durable Objects** — interesting for per-player isolation, but turns this into a split-stack project (Cloudflare for backend, Vercel for frontend) and DO has a limited query model; rejected on operational complexity.
- **Self-hosted Postgres + Pusher/Ably for Realtime + custom auth** — most-portable-by-construction (each piece swappable independently), but high upfront wiring cost; rejected on solo-dev capacity.
- **AppWrite** — open-source BaaS with own document model; less SQL-pure than Supabase.
- **Nhost** — Hasura-based, GraphQL-first; valid but smaller community.

### Trade-offs

- Tied to Supabase's pace of API changes. Mitigated by keeping all access behind a thin client wrapper (`subscribeToNetwork(id, cb)`-style abstractions, planned).
- Realtime subscriptions are scoped to Postgres rows; complex query subscriptions need extra design.
- Free tier projects pause after 7 days of inactivity (real concern for low-traffic launch — bumping to Pro if it bites).

### Discipline rules to keep portability

- **Plain SQL only** — no Supabase-specific extensions, no `pg_*` system tables in app code.
- **Wrap Realtime client** behind `subscribeToNetwork(id, cb)` so swapping the transport (Pusher, Ably, self-hosted) doesn't ripple.
- **Ed25519 signature verify in our Vercel function**, not Supabase Auth (we don't fit their email/OAuth model).
- **IP registry as a plain Postgres table** with a unique constraint — no Supabase-specific machinery.

---

## Hosting: Vercel

### Choice

Vercel hosts the static React app + serverless API functions. Already in place pre-Phase-5; reaffirmed for Phase 5.

### Why

- Static + serverless on the same domain — `/` serves the app, `/api/*` runs Node functions. No CORS headaches.
- Zero-config Node runtime in `api/` directory.
- Free tier covers hobby usage indefinitely.
- Per-environment env vars (Production / Preview / Development) — clean separation when paired with cloud Supabase.

### Alternatives considered

- **Cloudflare Pages + Workers** — ruled out earlier when discussing Cloudflare Durable Objects.
- **Netlify** — comparable but smaller serverless community.
- **AWS Amplify / S3 + Lambda** — most flexible, most operational overhead.

### Trade-offs

- Function execution timeout (300s on current plan) — fine for our IP allocator and any future patch-validation function.
- Cold starts on rarely-used endpoints — sub-second for our small functions.

---

## Rate limiting: Upstash Ratelimit

### Choice

Per-caller-IP sliding-window rate limit on `/api/allocate-ip`, backed by Upstash Redis over HTTPS, accessed via the `@upstash/ratelimit` npm package.

### Why

Vercel functions are stateless serverless — each invocation can run on a fresh process. A counter has to live **outside** the function. Of the available options:

| Store               | Latency                     | Atomic ops | Verdict                                                     |
| ------------------- | --------------------------- | ---------- | ----------------------------------------------------------- |
| In-memory `Map`     | 0ms                         | ✅         | ❌ Doesn't survive between invocations                      |
| Filesystem          | varies                      | ❌         | ❌ No shared filesystem in serverless                       |
| Postgres            | 5–50ms                      | ✅         | ⚠️ Works, but slow + couples rate-limit pressure to game DB |
| **Redis (Upstash)** | ~1ms                        | ✅         | ✅ Purpose-built for high-frequency small ops               |
| Cloudflare KV       | ~50ms eventually consistent | ❌         | ❌ Rate limits need strong consistency                      |

Plus: **Upstash exposes Redis over HTTPS**, so a stateless serverless function can `fetch(...)` it without TCP connection pooling. Plain Redis would need a persistent TCP socket — an awkward fit for serverless cold starts.

The Vercel Marketplace Upstash integration auto-provisions env vars, so there's zero infra to manage on our side.

### Alternatives considered

- **In-memory Map** — broken on serverless (above).
- **Postgres-based rate limit table** — works but adds query load on the same DB serving game data; conflates two concerns.
- **Cloudflare Workers + KV** — eventual consistency means a sufficiently fast attacker could blow past the limit before KV propagation; bad fit.
- **Vercel Edge Config** — read-only-fast, write-slow; not designed for this.
- **Vercel's own WAF/rate limit** — only on Pro tier; we're on Hobby.

### Trade-offs

- New external service in the dependency graph. Mitigated by `noopRateLimiter` fallback when env vars aren't set (game continues, just unrate-limited).
- Free tier: 10K commands/day. Comfortable headroom pre-launch; would exhaust under heavy multiplayer load. Plan: upgrade if we ever cross ~5K/day.
- Marketplace integration provisions env vars under the legacy Vercel KV namespace (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) rather than `UPSTASH_*`. Our function reads either name to stay flexible (see `api/allocate-ip.ts`).

### Algorithm: sliding window

`Ratelimit.slidingWindow(30, '1 m')` — at any moment, max 30 requests in the trailing 60 seconds per IP. Smoother than fixed-window (which has burst issues at boundaries).

---

## Input validation: zod

### Choice

zod for parsing untrusted input at API function boundaries. Strict schemas (`.strict()`) reject unknown fields.

### Why

- **Schema-first**: types come from the schema, not the other way around — single source of truth.
- **Strict mode** rejects unknown fields, preventing prototype pollution and mass-assignment attacks (e.g., a payload tries to inject `{ admin: true }`).
- **Type-narrowing**: after `safeParse()`, TypeScript knows the data is the validated shape.
- **Battle-tested**: widely used, fast, no runtime gotchas.
- Aligns with the security memory rule: "Strict input hygiene at the function boundary."

### Alternatives considered

- **Hand-written type guards** (the project's pre-Phase-5 pattern, e.g. `isValidPatch`) — fine for internal type narrowing, but less safe at the security boundary. Easy to forget a field check; no `.strict()` equivalent.
- **io-ts / runtypes** — comparable, smaller community.
- **Joi / yup** — less TypeScript-friendly.
- **TypeBox** — fast, JSON-Schema based, but more verbose and less ergonomic for our small schemas.

### Trade-offs

- Adds a runtime dependency (~50KB minified). Acceptable for the security guarantees.
- The existing project pattern of hand-written guards stays in place for _internal_ validation (filesystem patches, persisted state). zod is reserved for **external boundaries** — function bodies, future patch ingestion, etc.

---

## IP allocation: server-authoritative with PK uniqueness

### Choice

Public IPs for mission instances, home networks, and other shared-persistent network types are allocated by a Vercel function that INSERTs into a Postgres `public_ips` table with the IP as the primary key. On PK conflict, the function re-rolls and retries.

### Why

In multiplayer, two players can't end up on the same public IP — uniqueness has to be globally enforced, and the only authoritative location for "globally" is the server. The Postgres PK constraint **is** the enforcement mechanism — no app-level locking, no race conditions.

The retry-on-conflict pattern is simple and self-correcting: pick a candidate, try to claim, lose the race? roll again. With a 195M-IP pool (12 first octets × 254 × 254 × 253), conflict rate is microscopic for any realistic player population.

### Alternatives considered

- **Client-rolled IPs** — rolling per-player and trusting clients not to collide. Fails the moment two players boot at the same time without coordination.
- **Range partitioning per player** — give each player a slice of the IP pool. Wastes IPs, complicates "shared instance" cases like home networks.
- **Sequential allocation from a counter** — `nextval('public_ips_seq')`-style. Predictable IPs (security-adjacent: enumeration attacks), and no realism (real public IPs aren't sequential by allocation order).
- **Server-rolls vs. client-proposes** — we picked server-rolls so the client can't squat on "desirable" IPs.

### Trade-offs

- The IP pool is finite (~195M usable). For our scale, this is a non-issue. If the game grew to billions of networks, we'd need to expand `publicFirstOctets`.
- The function makes one DB round-trip per allocation. Mitigated by the rate limiter and by the fact that allocation is rare (once per crack / mission accept, not per-action).

### Why not assemble an IP from a hash

Considered hashing `(seed, salt)` to produce a deterministic IP. Rejected because:

- Two seeds could hash to the same IP — same race condition, just shifted.
- We want IPs to be allocated, not derived. Allocation lets us track "who owns what" for billing / cleanup / orphaning.

---

## Identity: Ed25519 keypair

### Choice

Each player gets an Ed25519 keypair, generated client-side on first launch and stored in browser `localStorage`. Public key is the player's identity on the server. All write operations (patches, session creation, etc.) are signed by the private key; the server verifies signatures before accepting.

### Why

- **No accounts**: no email, no password, no OAuth flow. Just open the page and play.
- **Tamper-proof**: signed payloads can't be forged without the private key.
- **Server-side verify is fast**: Ed25519 is the fastest mainstream signature scheme (~50µs to verify on commodity hardware).
- **Compact**: 32-byte keys, 64-byte signatures — comfortably fit in DB rows and HTTP headers.
- **Standardized**: every language has a library; nothing exotic to maintain.
- **No PII**: the public key is opaque to anyone who hasn't seen it before.

### How Ed25519 works (in brief)

A digital signature scheme — turns a message into a small, unforgeable proof that the holder of a specific private key endorsed that exact message.

**The objects involved:**

- **Private key** (32 bytes) — random secret. Never leaves the owner.
- **Public key** (32 bytes) — derived from the private key. Safe to share. Acts as the owner's identity.
- **Signature** (64 bytes) — produced by `sign(privateKey, message)`. Verified by `verify(publicKey, signature, message) → boolean`.

**The three guarantees we depend on:**

1. **Unforgeability** — no one without the private key can produce a signature that verifies under the matching public key. (Cryptographic assumption: the discrete log problem on Curve25519 is hard.)
2. **Message-binding** — change one bit of the signed bytes and verification fails. The signature is bound to the exact payload.
3. **Public-key safety** — knowing the public key tells you nothing useful about the private key. Public keys can sit in DB rows visible to everyone.

**Why it's small and fast:**

- Built on **Curve25519**, an elliptic curve over the prime field 2²⁵⁵−19 (hence "25519"). Edwards form (hence "Ed").
- Keys are 32 bytes, signatures 64 bytes — vs RSA's 256+ byte keys for similar security.
- Verify is ~50 µs on commodity hardware: roughly 20× faster than RSA, 3× faster than ECDSA on P-256.
- **Deterministic signing** — the signature for a given (key, message) pair is fixed. No randomness needed at sign time. This eliminates a class of bugs that has historically broken ECDSA implementations (a leaked nonce reveals the private key — see Sony PS3, 2010).
- **Constant-time arithmetic** by construction → resistant to timing-based side-channel attacks.

**How we use it in JSHACK.ME:**

1. Player loads the game → `getOrCreateIdentity()` either reads the keypair from `localStorage` (under e.g. `jshack.identity`) or generates a fresh one and saves it.
2. The public key is the player's identity on the server — stored in DB rows like `mission_instances.owner_key`, `home_network_occupants.player_key`, etc.
3. When the player submits any mutation (patch, session creation, etc.), the client signs the canonicalized payload bytes with the private key and sends `{ payload, signature, publicKey }` to the Vercel function.
4. Server: looks up the row by `owner_key`, calls `verify(publicKey, signature, canonicalize(payload))`. If true, the request is authentic; then the server checks authorization (does this player own this resource?) before applying the mutation.

The server never has to trust a client's claim about identity. Only signature verification matters.

**Library choice**: `@noble/ed25519` — pure JS, audited, ~10KB. Avoids Web Crypto API browser-version inconsistencies (Safari only added Ed25519 support in 17+; @noble works in every browser back to ES2020).

### Alternatives considered

- **Email/password accounts** — requires password reset flow, email delivery, account recovery, GDPR considerations. Too much surface for a hobby project.
- **OAuth (Google / GitHub / etc.)** — adds dependency on third-party identity, requires per-provider config, leaks identity to a third party.
- **Sign in with Vercel** — interesting, but ties identity to a Vercel account.
- **JWT-based session tokens** — orthogonal; we'd still need _something_ generating the tokens. Ed25519-signed payloads are simpler.

### Trade-offs

- **No password recovery**. Lose the device → lose the identity → lose the player's social graph and reputation. Documented as a deliberate gameplay choice. Recovery mechanisms (Shamir-style, multisig) deferred.
- **localStorage isn't bulletproof** — clearing browser data wipes the identity. Acceptable for this player demographic (hacker-literate). See [identity vs wallet keys memory](../.claude/projects/...) for the manual-recovery escape hatch.

### Wallet key separation

A **second** Ed25519 keypair lives in the in-game filesystem (`/home/<user>/.wallet/priv.key` or similar — exact path TBD). Loss conditions are different:

- Identity key — lost only via real-world events (clearing browser data, device loss).
- Wallet key — lost on in-game permadeath or via theft (another player breaks in and reads the file).

Defending the wallet key is gameplay; defending the identity key is the player's OPSEC.

---

## Authenticated requests (signed envelopes)

### Choice

Every Vercel function that mutates server state takes a **signed envelope**: `{ payload, publicKey, signature }`. The signed bytes are the literal `JSON.stringify(payload)` the client produced — not a re-canonicalized object. Replay protection is built into the payload itself (`nonce` + `ts`).

First user: `/api/allocate-ip` (shipped). Sessions, patches, mission acceptance follow the same shape.

### Why

The big decision was **what gets signed**. Three options were on the table:

1. Sign a canonical form of the object (RFC 8785 JCS, sorted keys, etc.). Both client and server have to implement identical canonicalization forever; subtle disagreements (number formatting, unicode normalization, undefined-vs-missing keys) break signing silently.
2. Sign the bytes of `JSON.stringify(payload)` directly, then ship the stringified payload alongside the signature. The server never reproduces the canonical form — it verifies the bytes the client sent and parses them after.
3. Same as (2) but base64-encode the payload string. Marginally more uniform, but makes log inspection require an extra decode step.

We picked **(2)**. There's only one byte sequence in flight, so reordering / re-escaping is impossible by construction. JSON-string-inside-JSON is slightly ugly in logs but stays human-readable, which matters during the inevitable "why did the signature fail" debugging session.

This is essentially how JWS compact serialization works, minus the base64 step.

### Replay protection

Every payload carries:

- **`ts`** — client wall-clock at signing time. Server rejects if `|now - ts| > 120s`. Both directions matter: bounded future-timestamp attacks, and accommodates ±60s of clock skew either way.
- **`nonce`** — 16 random bytes (128 bits, hex). Server records each in Upstash with a 120s TTL; duplicates are rejected.

Both protections are necessary. `ts` alone allows in-window replay; `nonce` alone needs unbounded storage. Together they give finite storage with bounded replay risk.

### Server-side check order (verify.ts)

Cheapest checks first, so floods of garbage envelopes don't burn Upstash budget:

1. Envelope structural shape (regex + zod, sub-µs)
2. Ed25519 signature verify (~50µs CPU)
3. `JSON.parse` the payload bytes
4. Base + caller-provided action schemas
5. Timestamp window check
6. Nonce dedupe — single Upstash round-trip, only if everything else passed

### Server-side trust model

The server stamps `owner_key = ed25519:<verified pubkey>` itself. Clients can't claim ownership in someone else's name — even a custom Burp/curl client gets the verified pubkey, not whatever they put in the payload. The strict zod schemas reject unknown payload fields (including a client-supplied `owner_key`) with a 400 before allocation runs.

Rate limiting is keyed on the verified public key, not the request IP. This is a deliberate switch — shared NAT (school networks, mobile carriers) made IP-based rate limiting collateral-damage prone, and a single attacker can no longer burn through someone's budget by rotating IPs.

### Alternatives considered

- **HMAC with a shared secret** — requires distributing the secret to the client. localStorage is no safer than the existing private key, and HMAC doesn't give us public verification (the server has to know the secret too).
- **Vercel session cookies / JWTs** — adds a session layer we don't need yet. The Ed25519 signature _is_ the auth.
- **Pre-canonicalize before signing** — see "Why" above. Reproducing canonical form on both sides is a deceptively-ongoing maintenance burden.

### Trade-offs

- The `payload` field is JSON-inside-JSON, which looks ugly when logging. Explicit choice — it's still grep-able and `jq`-friendly with one extra parse.
- Schemas are duplicated: an action schema (e.g. `allocateIpSignedPayloadSchema`) needs `action`/`ts`/`nonce` declared alongside the action's own fields. We could merge schemas internally, but the explicit shape makes type narrowing trivial.
- Nonce store needs Upstash. In local dev without Upstash configured we fall back to `noopNonceStore` and replay protection is effectively disabled — same caveat as `noopRateLimiter`. Production must have Upstash.

---

## Sessions: server-authoritative with cascade-end

### Choice

A `sessions` table on Supabase records each player's "presence on a machine" — every SSH-into, `su`-on, or post-exploit-shell push creates a row, every `exit` / mission-abort / cascade-end marks one ended. Clients call `/api/sessions` (single endpoint, action-dispatched: `createSession` / `endSession` / `listSessions`) via signed envelopes. The server is the single source of truth for "does player X have an active session on machine Y?".

`SessionContext.pushSession` / `popSession` / `popAllSessions` round-trip through this endpoint. On `SessionProvider` mount, `listSessions` rehydrates the local stack from server state — `sessionStorage` is a UI cache, server is the truth.

### Why

The session table is load-bearing for multiplayer — every patch validation will need to read it ("is this player allowed to delete this file? — yes if they have an active session on the target machine with sufficient credentials"). The reasoning to land it now (Phase 1+3 compressed):

- **Cheap to deploy alongside identity-signed allocate-ip** — same `signedRequest` machinery, same RLS pattern, same Vercel function shape. Marginal cost is one migration + one handler module.
- **Builds the muscle for patch validation** — once patches land, they'll cite `sessions` for authorization. Having sessions live first means patches integrate cleanly without retrofitting.
- **Cross-tab consistency**: `listSessions` on mount means a refresh in one tab reflects what other tabs did. Without server truth, refresh would resurrect dead sessions from `sessionStorage`.

### Cascade-end strategy: app-level recursion

When a player ends a session, all active descendants (the hop chain below them) must also end. Three options:

1. **Recursive CTE in raw SQL** — atomic, but supabase-js doesn't expose recursive UPDATE. Would need a stored procedure + `.rpc()` call.
2. **App-level recursion** — end the named session, fetch active children, recurse for each. N+1 round-trips but plain TypeScript.
3. **Postgres stored procedure** — atomic, fast, but introduces a new precedent (stored procs to maintain).

Picked **(2)**. Tree depth is bounded in practice (1-3 hops typical); N+1 is fine. Race window where new child sessions created mid-cascade can be orphaned is acceptable for pre-launch scale — the orphan is a still-valid session, and a future periodic sweeper or upgrade to (3) fixes it without touching the adapter interface. Stored procs would be the right answer at production scale, but premature now.

### Server-stamped `player_key` + cascade `end_reason`

- Every write stamps `player_key` from the verified Ed25519 pubkey, never from a client claim. Strict zod schemas reject any client-supplied `player_key` field with 400.
- Cascaded children end with `end_reason='cascade'`; the named session ends with the caller's reason (`'user_exit'` / `'pop_all'` / etc.). This audit trail will eventually feed kill-vs-exit distinction in `access.log` realism and player-facing "session terminated by …" UX.

### Lossy rehydration

Server stores `machine_id` + `credentials` but **not** `hostname`, `currentPath`, or the start `reason`. On rehydration we synthesize:

- `hostname`: undefined (UI falls back to `machine`)
- `currentPath`: `'/root'` for root, `'/home/<username>'` otherwise
- `reason` (snapshot only): defaulted to `'ssh'` — affects exit-message UX (`'Connection closed.'` for everything) but not chain integrity

The cosmetic loss is acceptable for Phase 1+3. A later migration could add `start_reason` and persist `hostname`/`currentPath` if they become important.

### What's deferred

- **Realtime session-death**: when another player kills your session (or NAT removes a port-forward), you don't see it until your next interaction triggers a server call. Phase 2 PR adds a Supabase Realtime subscription on `sessions WHERE player_key = me` with cascade-handling on the client.
- **Patch authorization integration**: patches will look up `sessions` to authorize file/process mutations. Phase 4 PR.
- **Multi-tab session reconciliation**: currently `listSessions` returns all of a player's active sessions; we reconstruct the linear chain by `created_at` order, which is correct for single-tab single-chain. Multi-tab edge case (multiple chains) is deferred.

---

## Patches: server-authoritative with two-call deletion

### Choice

A `patches` table on Supabase records every player's filesystem mutations — every file write, create, deletion, and permission change. Composite PK `(player_key, machine_id, path)` doubles as the natural-key for UPSERT and lets multiple authors keep their own row per file. Clients call `/api/patches` (single endpoint, action-dispatched: `upsertPatch` / `removePatch` / `listPatchesForMachines` / `clearTransientPatches` / `clearOwnedPatches`) via signed envelopes. Server is the single source of truth for "what's everyone's view of the filesystem on machine X?".

`FileSystemContext.broadcastAndRecordPatch` fires-and-forgets the right server call alongside its existing local-state update + IndexedDB cache write. On `FileSystemProvider` mount, `listPatchesForMachines(machine_ids)` rehydrates the cross-player view for the machines in scope (localhost + home + mission keysets), skipped if local writes happened during the mount window — those upserts are already in flight, the next mount reconciles. The server orders by `updated_at ASC` so the client-side `applyPatches` reduce-order yields last-write-wins per `(machine_id, path)` automatically. IndexedDB stays as a sync-readable cache for fast initial paint.

### Why

Patches are the second multiplayer-load-bearing piece (after sessions): cross-device sync depends on them, future shared-network gameplay (mission instances, persistent darknet hubs) reads them, and patch validation against the `sessions` table is the actual security boundary protecting other players' filesystems.

- **Cross-device sync** out of the box — write a file on device A, see it on device B after `listPatchesForMachines` rehydration.
- **Cross-player visibility** on shared persistent networks — Player A's writes on machine X are visible to Player B via the same rehydration. The world is one shared persistent state, not per-player overlays.
- **Patch validation (L1)** shipped in PR #78 — the Vercel function consults `sessions` to authorize each upsert, so an attacker can't tamper with files on machines they don't have a session on. `/var/log/*` writes bypass the gate (ambient log appends from recon don't require a session).
- **Foundation for Realtime fanout** (later PR) — the same row mutations stream as `postgres_changes` events to other clients on shared machines, eliminating the next-page-reload wait.

### Two-call deletion strategy

The client decides per case which server calls to fire:

| Local action                               | Server                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| Write/create (`content !== null`)          | `upsertPatch`                                                                  |
| Delete a file the player created via patch | `removePatch` (one round-trip; handles descendants via `path_prefix`)          |
| Delete a base-fs file/directory            | `removePatch` THEN `upsertPatch` (descendants gone, then null marker recorded) |

The two-call sequence is for the rare "rm -rf a base directory you've been modifying" case. Three options were considered:

1. **Single `applyPatch` action that branches server-side** — server queries `existing.is_new` first, then upserts or deletes. Simpler client, more server complexity.
2. **Single `upsertPatch` that also deletes descendants when content=null** — couples two responsibilities in one action.
3. **Client orchestrates two calls in the corner case** — extra round-trip in the rare path; keeps each server action single-purpose.

Picked **(3)**. Server actions stay clean and orthogonal. The corner case is rare enough that one extra round-trip doesn't matter, and the client already has all the information needed to decide.

### Reset wipes "owned" patches, not "all" patches

`reset confirm` fires `clearOwnedPatches` (`DELETE WHERE player_key = me AND machine_id = 'localhost'`), NOT a blanket wipe of every row keyed by the player. The semantic is: **reset wipes my own state, not my actions in the shared world**.

Concrete: if Player A roots Player B's machine and `rm`s a file there, that's a row `(player_key=A, machine_id=B's IP, content=null)`. A's reset must NOT remove that row — undoing A's gameplay actions against B is wrong. A's reset only wipes A's localhost.

Currently "owned" = localhost only. As more ownership concepts arrive (home network slots per the home-network model memory, mission instances per the mission-instances memory), the WHERE clause grows but the principle stays the same.

The reload waits for `clearOwnedPatches` to settle via `Promise.all` before triggering `window.location.reload()` — earlier fire-and-forget timing let the page navigation abort the in-flight DELETE. There's a regression test pinning the new ordering in `reset.test.ts`.

### Mount-window race mitigation

`listPatchesForMachines` resolves ~hundreds of ms after mount. If the user types into a file before that resolves, the rehydration would clobber the local write. `FileSystemContext` tracks a `localWritesSinceMount` flag — if true when the response lands, server-truth replacement is skipped. The local upsert is already on its way to the server fire-and-forget; the next mount sees the merged truth.

Tradeoff: cross-device sync is slightly delayed in this case (one extra round-trip on the next mount). Strictly worse than blocking the user's first write on a server response, but acceptable.

### LIKE wildcard caveat in descendant removal

`removePatch` issues `.like('path', '${prefix}%')` for descendants. SQL LIKE treats `_` as a single-char wildcard, so a path containing `_` could match siblings (e.g. `/etc/my_dir/` would also match `/etc/myXdir/foo`). Acceptable for v1; future PR can switch to a `.gte/.lt` range query if it bites.

### What's deferred

- ~~**Patch validation against `sessions`**: this PR records authoritatively but does NOT yet enforce "is this player allowed to mutate this path?".~~ **L1 (session existence) shipped in PR #78** — see "Patch validation: L1 session-existence gate" section below.
- **Mission-instance / shared-network scoping**: `machine_id` is the only scope today. When mission instances ship, `instance_id` (or similar) joins the natural key.
- **Realtime fanout**: `postgres_changes` subscription on `patches WHERE player_key = me` for cross-tab/cross-device live updates. Phase later.
- **IndexedDB removal**: still kept as a sync-readable cache for fast initial paint. Pruning happens once we're confident the server pipe handles every entry point.

---

## Patch validation: L1 session-existence gate, L2 permission-walk deferred

### Choice

`/api/patches`'s `upsertPatch` and `removePatch` consult the `sessions` table before recording a mutation: if `machine_id != 'localhost'` and the verified player has no active session row on that machine, return `403 no_session`. This is **the actual security boundary** for filesystem mutations.

### Why

Before this layer, an attacker with a legit Ed25519 keypair could sign a patch claiming to write to any machine and the server would accept it. The signature only proved "this came from key X", not "key X has access to machine Y". Now the server cross-references the `sessions` table — the player must have established an active session via the legitimate auth flow (SSH password, `su`, exploit shell, FTP login, mysql / redis login, scp transient, snmpset transient, or a one-shot exploit effect) to mutate any non-localhost machine.

### Layered defense (L1 / L2 / L3)

This PR ships **L1** only:

| Layer  | Checks                                                                | Status                                                                     |
| ------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **L1** | active session row exists for `(player_key, machine_id)`              | ✅ Shipped (PR #78)                                                        |
| **L2** | session credentials have write permission on the target path          | Deferred — needs server-side FS state (deterministic regen + patch replay) |
| **L3** | game-logic re-run ("smart server") — was the CVE published-by-now etc | Way later                                                                  |

L1 alone catches ~90% of the threat surface — an attacker can no longer write to machines they haven't legitimately accessed. L2 closes privilege-escalation within a session (a guest-session player can still ask the server to delete root-owned files; only the client-side `canWrite` check stops them today). L3 is the "smart server" principle from `project_multiplayer_security_model`.

### Bucket-C audit + 9-kind plumb

Adding L1 broke every client write path that wasn't already pushing a session — FTP `put`, scp upload, mysql UPDATE, redis SET, snmpset, msfconsole one-shot effects (`file_write` / `password_reset` / `backdoor_port_open`), script_exec daemon writes (sshd / vsftpd / nc -l). Each was audited and fixed by either:

1. **Login-style push** (FTP / mysql / redis): `enterXMode` pushes a session; `exitXMode` ends it.
2. **Transient one-shot wrap** (scp / snmp / msfconsole effects): `withTransientSession(...)` helper pushes, runs body, ends in `finally`.

`sessions.kind` (added to disambiguate categories) is a `TEXT` enum across nine values: `ssh` / `su` / `exploit` for shell-class (go on the SessionContext snapshot stack, rehydrated on mount), `ftp` / `mysql` / `redis` for protocol logins, `scp` / `snmp` / `effect_one_shot` for transient one-shots. Rehydration filters to shell-class kinds before reconstructing the linear chain — protocol/transient sessions don't pollute the SSH stack.

### What's deferred

- **L2 (permission walking)**: server doesn't yet check whether the session's credentials have write permission on the target path. A guest-session player could ask the server to delete root-owned files; the client's `canWrite` check is the only thing stopping them. Fixing this requires server-side FS state — either deterministic regen (run the same generator as the client, replay patches) or persisted base FS rows. Future PR.
- **`openBackdoorForwards.writeIptables`**: writes iptables config on gateway IPs for NAT-forward chaining. These would need per-gateway sessions for strict L1 correctness. Currently flagged as risky-but-gated (the exploit chain typically presupposes the player has gone through the gateways), but not enforced. Follow-up PR.
- **Race between session-end and mid-flight upsert**: player ends FTP, but a buffered `put` upsert lands at the server right after the `endSession`. Currently 403's. Tolerable for v1.

---

## Async generation pipeline

### Choice

The whole network-generation pipeline (`generateTopology`, `generateNetwork`, `generateMissionNetwork`, `generateHomeNetwork`) returns `Promise<T>` and uses `await` internally, so any step can do server I/O without restructuring everything.

### Why

The IP-allocator step needs a server round-trip (`await allocatePublicIp(kind)`). Rather than bolt async I/O into a previously-synchronous codebase, we made the entire generation pipeline async in advance, so the actual wiring of `allocatePublicIp` is a one-line change later.

### Alternatives considered

- **Pre-allocate IPs and pass into generation synchronously** — works for missions (one IP per accept), but home networks generate multiple in a loop where each could need a fresh allocation. Awkward.
- **Sync facade with internal async** — wrap the async call in `deasync` or similar. Hacky, anti-pattern.

### Trade-offs

- React hooks (`useHomeNetworks`, `useMissionState`) became `useState + useEffect` instead of `useMemo`. Slight UX shift: the network is briefly empty before the async generation resolves. Today (pre-server-allocator), this resolves in ~0ms (Promises are still synchronous under the hood). When server allocation is wired in, there's a real ~100-300ms window where the player sees "loading" — needs a small UX touch but not blocking.
- All ~30 generation tests had to be migrated to `async/await`. One-time cost.

---

## Local dev env files: `.env.local` vs `.env.development.local`

### Choice

Two-file split for local development:

- **`.env.local`** — managed by `vercel env pull`. Holds Vercel-side dev env vars (Upstash via Marketplace, OIDC token, etc.).
- **`.env.development.local`** — manually maintained. Holds local-only overrides (local Docker Supabase URL/keys).

The `npm run vercel:dev` script loads both via `dotenv-cli`:

```
"vercel:dev": "dotenv -e .env.local -e .env.development.local -- vercel dev"
```

### Why

`vercel env pull` overwrites the entire target file. If everything lived in `.env.local`, every pull would wipe our manually-set local Supabase keys. Splitting means:

- `.env.local` is auto-managed; pulls are safe.
- `.env.development.local` is hand-managed; never touched by pulls.
- Both are loaded at dev time; later file overrides earlier (matches Next.js / Vite convention).

### Alternatives considered

- **One file, manual re-paste after every pull** — works but error-prone; easy to forget a key.
- **Manage local Supabase keys in `.env.local` and skip `vercel env pull`** — gives up the convenience of the Vercel-side workflow.
- **Dynamic env-var loading at runtime** — overkill for a hobby project.

### Trade-offs

- Two files to track. The naming convention is standard (Next.js, Vite) so there's no confusion for someone familiar with the ecosystem.
- The `vercel:dev` script is the only thing that knows to load both — direct invocation of `vercel dev` only loads its own resolution path. Scripted via `npm run` to make this invisible.

---

## Production gotchas

### Always use `.js` extensions in relative imports inside the `api/ → src/` chain

**Convention**: any TypeScript file that the Vercel function (`api/*.ts`) loads — directly or transitively — must use `.js` extensions on its relative imports.

```ts
// ✅ Correct (works in dev AND prod)
import { createPrng } from '../src/generation/prng.js';
import type { Prng } from './prng.js';

// ❌ Incorrect (works in dev, ERR_MODULE_NOT_FOUND in prod)
import { createPrng } from '../src/generation/prng';
import type { Prng } from './prng';
```

**Why this is needed:**

1. **`package.json` declares `"type": "module"`** — the whole project is ESM.
2. **Node's ESM resolver is strict** — it requires the literal file extension (`./prng.js`), unlike CommonJS which probes (`./prng` → finds `./prng.js`).
3. **TypeScript doesn't add extensions** — `moduleResolution: "bundler"` (our tsconfig setting) assumes a downstream bundler will resolve extension-less imports. The compiler emits the path as-is.
4. **Local `vercel dev` is forgiving** — it uses Vite's resolution, which handles missing extensions and `.ts → .js` mapping. Production deploys to raw Node ESM, which doesn't.

So the hierarchy is:

| Environment                     | Bundler / resolver        | Tolerates missing `.js`? |
| ------------------------------- | ------------------------- | ------------------------ |
| Vite build (browser app)        | Rollup / esbuild          | Yes                      |
| `vitest`                        | Vite                      | Yes                      |
| `vercel dev` (local serverless) | Vite (for the dev server) | Yes                      |
| **Vercel production functions** | **Raw Node ESM**          | **No**                   |

The browser app and tests stay clean either way. It's only the production Vercel function where strict ESM bites.

**Why we don't just enable bundling on the function:** `@vercel/node` can use ncc to inline transitive imports, but with our `"type": "module"` + relative-path-into-`../src/` setup, ncc's behavior is fragile. Adding `.js` is a one-character-per-import fix that works deterministically, no build-config gymnastics required.

**Files currently subject to this rule** (the chain reachable from `api/allocate-ip.ts`):

- `api/allocate-ip.ts`
- `src/generation/prng.ts` _(no relative imports yet)_
- `src/generation/ip.ts`
- `src/ipRegistry/{handler,allocate,supabaseInsert,rateLimit,types}.ts`

When adding a new Vercel function or extending the chain, audit any new `from './...'` or `from '../...'` and add `.js`.

---

## What's not yet decided

These are flagged but not yet committed:

- **Sessions table schema** — server-authoritative session state (player_key, machine_id, hop chain). Memory captures the design; not implemented.
- **Patch storage + Realtime fanout** — server-authoritative filesystem mutation log. Foundation for all multiplayer interaction.
- **Rate-limit-per-Ed25519-key** — once identity exists, rate limit by player key (more meaningful than IP). Currently IP-only.
- **Wallet key recovery** — explicit "no recovery" for now; revisit if real players accumulate funds.
- **Two-Supabase-project split (`jshack-dev` + `jshack-prod`)** — single project for now; revisit at multiplayer announce.
- **Two-Upstash-project split** — same reasoning as Supabase.

See `.claude/projects/.../memory/MEMORY.md` for the full design backlog.
