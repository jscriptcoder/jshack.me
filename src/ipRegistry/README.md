# IP Registry

Server-authoritative public-IP allocation. Backs `/api/allocate-ip` — the Vercel function that hands out globally-unique public IPs for mission instances, home networks, pivots, and other shared addressable game objects.

The DB-side guarantee is the primary key on `public_ips.ip` (see `supabase/migrations/`). This module pairs a random IP roll with INSERT-or-retry until one wins.

See `docs/infrastructure-design.md` for how public IPs fit into the broader network model, and `docs/technology-choices.md` (Authenticated requests + Backend) for the rationale.

## Files

| File                | Description                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `types.ts`          | `IP_KINDS` enum, `IpRow`, `AllocateIpRequest` (internal), `allocateIpSignedPayloadSchema` (external). |
| `allocate.ts`       | Pure allocator: rolls IP + retries on PK conflict, returns `{ok, ip}` or error. No I/O details.       |
| `handler.ts`        | Request pipeline: verify signed envelope → rate-limit on pubkey → stamp owner_key → call allocator.   |
| `client.ts`         | Browser-side `allocatePublicIp(identity, request, fetch?)` — signs the envelope and POSTs.            |
| `supabaseInsert.ts` | Adapter from Supabase's `{ error }` insert result to the allocator's `'ok' \| 'conflict' \| 'error'`. |
| `rateLimit.ts`      | `RateLimiter` abstraction. Upstash adapter (sliding window) + noop fallback for local dev.            |
| `*.test.ts`         | Unit tests for each module.                                                                           |

## Allocator pattern (`allocate.ts`)

```
loop up to MAX_ALLOCATION_ATTEMPTS (10):
  ip = rollIp()                        // random in the public space
  result = insertIp({ ip, kind, ... }) // PK enforces uniqueness
  if result === 'ok':       return { ok: true, ip }
  if result === 'conflict': continue   // PK collision, re-roll
  if result === 'error':    return { ok: false, error: 'insert_failed' }
return { ok: false, error: 'exhausted' }
```

Two seams (`AllocateIpDeps`):

- `rollIp(): string` — produces a candidate IP. In production: `generatePublicIp(createPrng(randomUUID()))` for fresh entropy per request. In tests: a deterministic stub.
- `insertIp(row): Promise<'ok' | 'conflict' | 'error'>` — attempts one INSERT. Production wires through `createSupabaseInsertIp` which maps Supabase's `{ error }` into the three-state outcome.

Retries are bounded so a degenerate state (DB hostile, all IPs taken) returns a 500 rather than spinning forever. 10 attempts × ~14M public IPs of headroom = effectively unbounded room until the registry is millions of rows deep.

## Request pipeline (`handler.ts`)

```
verifySignedRequest(envelope, allocateIpSignedPayloadSchema)
  → reject early on bad envelope / signature / ts skew / replay
rateLimiter(verified.publicKey)
  → 429 + Retry-After if exceeded
build AllocateIpRequest:
  - kind:        from verified payload
  - owner_key:   server-stamped as `ed25519:<verified pubkey>` (NOT client-trusted)
  - instance_ref: passed through if present
allocateIp(request, deps)
  → 200 + ip on success, 500 on exhausted/insert_failed
```

**Owner key is server-stamped, not client-supplied.** A malicious client (Burp / custom curl) can put anything in their payload, but the strict schema rejects unknown fields, and the server overwrites `owner_key` with the verified public key. Players can't allocate IPs in someone else's name.

## Schema split: external vs internal

- `allocateIpSignedPayloadSchema` (zod, strict) — the **external** schema. What clients POST. Includes the `signedRequest` base fields (`action`/`ts`/`nonce`) and the allocator-specific fields (`kind`, optional `instance_ref`). Notably **no `owner_key`** — server derives it.
- `AllocateIpRequest` (TS type) — the **internal** shape between handler and `allocateIp()`. Includes `owner_key` because by then it has been stamped from the verified pubkey.

This split was a deliberate choice: clients shouldn't be able to declare ownership, only prove identity.

## IP kinds

Defined in `IP_KINDS`. Currently:

- `mission_instance` — per-acceptance mission target (player-owned)
- `home_network` — player's home LAN router (player-owned)
- `pivot` — player-controlled relay machine (player-owned)
- `npc_faction` — world-owned NPC infrastructure (admin-only allocation, future)
- `darknet_hub` — world-owned darknet entry points (admin-only allocation, future)

Adding a new kind: extend `IP_KINDS`, then **also** extend the `kind` CHECK constraint in the `public_ips` migration. The DB rejects unknown kinds independently of the application schema — defense in depth.

## Rate limiting

`RateLimiter` is a thin abstraction over Upstash Ratelimit's `limit(identifier)`. Returns `{ allowed: true }` or `{ allowed: false, retryAfterSeconds }`. The handler stamps the `Retry-After` header from this when returning 429.

The rate-limit identifier is the **verified public key**, not the request IP. Switched in the signed-allocate-ip work — shared NAT made IP-based limiting collateral-damage prone, and per-pubkey limiting follows the actor regardless of network.

`noopRateLimiter` is used in local dev when Upstash env vars aren't configured. Production must have Upstash.

## Why a separate module from `signedRequest`

`signedRequest` is generic — any signed Vercel endpoint will use it. `ipRegistry` is the first user of that abstraction, plus all the allocator-specific glue (PK retry, kind enum, Supabase insert adapter). Keeping them separate means future signed endpoints (sessions, patches, mission acceptance) reuse `signedRequest` without dragging IP-allocation code along.
