# 10. The server and the database

This chapter is the reference for the server side: the three Vercel Functions in `api/`, every
action they accept, how requests are authorized, and the Supabase Postgres schema. Read it before
adding an API action, a table, or a migration.

## The shape in one paragraph

The server is **three Node functions** (`api/network.ts`, `api/patches.ts`, `api/sessions.ts`), each a
single `POST` endpoint that multiplexes many **actions** on the payload's `action` field. Each file is
a thin adapter: reject non-POST, build a service-role Supabase client, route on the action, call a
pure `handle*` function in `src/core/`, passing database reads and writes in as closures, and write
`res.status(status).json(body)`. **All logic, validation and authorization live in `src/core/`**,
where they are unit- and mutation-tested and shared with the client. Only the SQL shapes live in
`api/`, and only the wire-check scripts prove them.

## Key files

| Path                                         | What it does                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/network.ts`                             | `POST /api/network`: joining networks, occupancy, scans, web fetches, cross-player tree reads. 11 actions; fallthrough `registerNetwork`.    |
| `api/patches.ts`                             | `POST /api/patches`: the file journal and server-written traces. 11 actions; fallthrough `upsertPatch`.                                      |
| `api/sessions.ts`                            | `POST /api/sessions`: sessions, every login door, `su`, exploits, `hydra`, databases, SNMP, reboot. 20 actions; fallthrough `createSession`. |
| `src/core/signedRequest/`                    | Envelope schema, signing, verification, status mapping (chapter 9).                                                                          |
| `src/core/patches/authorizeMachineAccess.ts` | The L1 gate.                                                                                                                                 |
| `src/core/patches/remoteWritePermission.ts`  | The L2 gate.                                                                                                                                 |
| `src/core/patches/readFilter.ts`             | The three-tier read filter.                                                                                                                  |
| `supabase/migrations/*.sql`                  | The schema, as 12 forward-only migrations.                                                                                                   |
| `supabase/config.toml`                       | Local stack configuration (project `jshack-me`, non-default ports).                                                                          |
| `vercel.json`                                | `regions: ["fra1"]` (plus the `$schema` key) and nothing else.                                                                               |

## Every file in `api/` is an endpoint

Vercel deploys **every file directly in `api/`** as a function. A shared helper module dropped there
would publish a bogus endpoint. Shared server code goes in `src/core/` (imported as
`../src/core/<x>.js`) or at module scope inside an endpoint file (the `*Via` query factories in
`api/sessions.ts`).

Vercel runs these files as plain Node ESM, which does not guess file extensions. **Every relative
import must end in `.js`**; ESLint enforces it. Vite, Vitest, `tsx` and `vercel dev` all forgive a
missing extension, so only a deploy would notice. The first deploy of `api/` failed exactly this way.

## Behaviour common to all three endpoints

- **Method.** Only `POST`; anything else is `405 {"error":"method_not_allowed"}`.
- **Configuration.** If `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing, every request is
  `500 {"error":"not_configured"}`.
- **Client.** `createClient(url, serviceRoleKey, {auth: {persistSession: false, autoRefreshToken:
false}})`, per request. The service role bypasses row-level security.
- **Body.** A signed envelope `{payload, publicKey, signature}` (chapter 9).
- **Routing.** `actionOf(req.body)` parses the **unverified** payload to read `action`. That is safe
  because every handler re-verifies with a schema whose `action` is a literal. An unknown action falls
  through to the endpoint's default handler, whose schema rejects it with `400 payload_invalid`.
- **Responses.** Success is `200` with `{ok: true, ...}` (a few actions omit `ok`). Domain failures
  are `4xx`/`5xx` with `{error: "<snake_case>"}`. Database errors are logged with
  `console.error('[network|patches|sessions] <label> error:', err)` and mapped to `500 <thing>_failed`.
- **Clocks.** The adapter passes `now: () => Date.now()` and the current game day. The client never
  supplies time.

## Authorization vocabulary

| Term       | Meaning                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SIG**    | The signature verified. The caller is whoever holds the key. Every action requires it.                                                                                              |
| **OWN**    | `isOwnWorkstation(machine_id, key)`: only your own workstation. Otherwise `403 no_session`.                                                                                         |
| **L1**     | `authorizeMachineAccess`: your own workstation, or you hold an active `sessions` row on that machine. Otherwise `403 no_session`. Yields the session's user, tier and ESSID.        |
| **L2**     | `enforceRemoteWriteL2` (remote writes only): rebuild the target, replay its journal, ask the shared walker whether the session's tier may write. Otherwise `403 permission_denied`. |
| **OCC**    | You hold an occupancy row on the payload's ESSID (the same-WiFi login also requires your lease). Otherwise `403 not_an_occupant`.                                                   |
| **REACH**  | The target is resolved on the server from the address (chapter 7). No box, or a box that cannot boot → `404 host_unreachable` (scans instead answer `200` with `found: false`).     |
| **PASSWD** | The password is checked against the target's rebuilt `/etc/passwd`. Unknown user and wrong password are both `401 invalid_credentials`.                                             |

## Action reference

### `POST /api/network`

| Action                      | Purpose                                                                                                 | Auth             |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| `registerNetwork` (default) | Join a WiFi network: lease your LAN address, write occupancy. Returns `local_ip`.                        | SIG              |
| `unregisterOccupant`        | Leave a network (delete your occupancy row; the lease stays).                                           | SIG              |
| `resolveOccupiedEssids`     | Names of networks anyone is connected to (discovery).                                                   | SIG              |
| `resolveOccupants`          | Fellow players on your network, with their LAN addresses.                                               | SIG + OCC        |
| `resolveOccupantScan`       | `nmap` a fellow player's box.                                                                           | SIG + OCC        |
| `resolveSameLanScan`        | `nmap` a generated machine on your LAN (journal-aware).                                                 | SIG              |
| `resolveInnerGatewayScan`   | `nmap` an inner gateway from outside.                                                                   | SIG              |
| `resolvePublicScan`         | `nmap` a public IP; writes a `kern.log` trace on the target gateway.                                    | SIG + REACH      |
| `resolveHttpFetch`          | `curl`/`lynx` a public web server (and findit.io search); writes `access.log`.                          | SIG + REACH      |
| `resolveHttpSweep`          | `gobuster` against a public server; the path list is read from the caller's box.                        | SIG + L1 + REACH |
| `resolveCrossPlayerFs`      | Another player's (or the access point's) tree, pruned to your tier.                                     | SIG, tiered      |

### `POST /api/patches`

| Action                           | Purpose                                                                     | Auth               |
| -------------------------------- | --------------------------------------------------------------------------- | ------------------ |
| `upsertPatch` (default)          | Write a file or directory (optional `base_hash` conflict check → `409`).    | SIG + L1 + L2      |
| `listPatches`                    | A machine's full journal.                                                   | SIG + L1           |
| `removePatch`                    | Delete: remove your own rows at and under the path, then write a tombstone. | SIG + L1 + L2      |
| `appendAuthLog`, `appendKernLog` | Append to your own box's `auth.log` / `kern.log` (server stamps time).      | SIG + OWN          |
| `recordFtpTransfer`              | Trace an FTP transfer in `vsftpd.log`.                                      | SIG + L1 (session) |
| `recordPackageDowngrade`         | Trace a package downgrade in `dpkg.log`.                                    | SIG + L1           |
| `recordZoneTransfer`             | Trace a DNS zone transfer in `named.log`.                                   | SIG                |
| `recordLanFetch`                 | Trace a LAN web fetch in `access.log`.                                      | SIG                |
| `nmapScan`                       | Trace a LAN or deep scan: one `kern.log` line per scanned host.             | SIG                |

### `POST /api/sessions`

| Action                                                     | Purpose                                                                                   | Auth                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `createSession` (default)                                  | Persist an `su` on your own box.                                                          | SIG + OWN                                                             |
| `listSessions`                                             | Your open sessions (for rehydration).                                                     | SIG (scoped to your key)                                              |
| `endSession`                                               | End one of your sessions (`user_exit` or `abandoned`).                                    | SIG (scoped to your key)                                              |
| `rebootMachine`                                            | End every session on a machine (all players), write a new boot id, trace it.              | SIG + L1; root if not your box                                        |
| `authCreateSession`                                        | Log into a generated machine on your LAN (`ssh`, `ftp`, `scp`, `nc`).                     | SIG + REACH + PASSWD                                                  |
| `authCreateSessionSameLan`                                 | Log into a fellow player's box on your WiFi.                                              | SIG + OCC + REACH + PASSWD                                            |
| `authCreateSessionPublic`                                  | Log in through a public IP.                                                               | SIG + REACH + PASSWD (+ L1 on the optional `caller_machine_id`)       |
| `authCreateSessionInnerGateway`                            | Log into a deep machine through an inner gateway's forward.                               | SIG + REACH + PASSWD                                                  |
| `suElevate`                                                | Cross-player `su` on another player's box.                                                | SIG + PASSWD                                                          |
| `exploitCreateSession`                                     | Remote exploit; the server recomputes the outcome from the target's manifest and the day. | SIG + REACH                                                           |
| `exploitLocalElevate`                                      | Local exploit on another player's box you already stand on.                               | SIG + your active session on that box (none → `404 host_unreachable`) |
| `mysqlConnect`, `mysqlStatement`                           | Database login and per-statement execution (no session row).                              | SIG + REACH + datadir account                                         |
| `redisConnect`, `redisStatement`                           | Key-value store connection and statements (no session row).                               | SIG + REACH                                                           |
| `snmpWalk`, `snmpSet`                                      | SNMP read and reconfigure (a wrong community reads like an absent device).                | SIG + REACH + community                                               |
| `hydraCrack`, `hydraCrackPublic`, `hydraCrackInnerGateway` | Server-side password sweep per vantage (no session row).                                  | SIG + L1 (vantage) + REACH                                            |

Each handler lives in `src/core/<area>/<action>.ts` with its schema just above the `handle*` export
(one exception: `suElevate` is handled by `src/core/sessions/authElevateSession.ts`).

## The database

Postgres 17 (local), everything in the `public` schema. All five tables have **row-level security
enabled and no policies**, so only the service role (inside the functions) can read or write. There
are no RPCs, no views, no seed data, and no Realtime use.

### `patches`: the shared file journal

| Column                     | Type        | Notes                                                                                     |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `machine_id`               | TEXT        | Primary key part 1.                                                                       |
| `path`                     | TEXT        | Primary key part 2.                                                                       |
| `writer_key`               | TEXT        | Primary key part 3: verified key, or `ap:<essid>`.                                        |
| `content`                  | TEXT NULL   | `NULL` = tombstone.                                                                       |
| `owner`                    | TEXT        | In-game owner.                                                                            |
| `permissions`              | JSONB NULL  | Tier lists.                                                                               |
| `is_new`                   | BOOLEAN     | Default false.                                                                            |
| `node_type`                | TEXT        | Default `'file'`; `'file'` or `'directory'`.                                              |
| `created_at`, `updated_at` | TIMESTAMPTZ | Default `NOW()`; trigger `patches_set_updated_at` re-stamps `updated_at` on every update. |

### `sessions`: the hop chain

`session_id` (TEXT primary key, client-minted), `player_key`, `machine_id`, `credentials` (JSONB
`{username, userType}`), `parent_session_id`, `source_ip`, `kind`, `essid`, `created_at`, `ended_at`
(null = active), `end_reason` (`user_exit`, `abandoned`, `rebooted`). `source_ip` is the address the
login came from as the server derived it (what the box's `auth.log` names), never the client's;
`su` and a local exploit inherit their shell's, and a reboot's `kern.log` line reads it back. Partial index on
`(player_key, machine_id, created_at) WHERE ended_at IS NULL`.

### `home_network_occupants`: who is on which WiFi

Primary key `(essid, owner_key)`. Also `workstation_machine_id` (indexed), `workstation_username`,
`workstation_machine_name`, `workstation_root_hash` (MD5, computed in the browser; the server never
sees the plaintext), `created_at`, `updated_at`. The row's existence **is** reachability; it is
deleted on `nmcli disconnect`.

### `network_lan_leases`: permanent LAN addresses

Primary key `(essid, owner_key)`, unique `(essid, octet)`, `octet SMALLINT CHECK (2..254)`. The lease
outlives occupancy, so reconnecting returns the same address. The allocator excludes octets the
network's generated machines use, prefers the player's derived octet, and redraws on conflict.

### Query and index fit

Most queries use a primary-key prefix. A few scan whole tables, fine at current scale and worth
revisiting at launch: `rebootMachine`'s update of all sessions on a machine, finding a player's
current network by `owner_key`, `resolveOccupiedEssids` (every occupancy row).

### Migration history

| Migration                                                | What changed and why                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `20260529000000_patches.sql`                             | First `patches` table (per viewer).                                                                                    |
| `20260607000000_sessions.sql`                            | `sessions`, so `su` survives a refresh.                                                                                |
| `20260611000000_sessions_essid.sql`                      | `sessions.essid`, so the server can rebuild a remote host.                                                             |
| `20260613000000_network_registry.sql`                    | `network_registry` for public-IP discovery (later dropped).                                                            |
| `20260614000000_workstation_identity.sql`                | Workstation identity columns, so the server can rebuild a player's box.                                                |
| `20260614120000_network_registry_machine_id_idx.sql`     | An index for the cross-player reverse lookup.                                                                          |
| `20260614130000_patches_shared_journal.sql`              | **Destructive** re-create of `patches` as the shared journal keyed `(machine_id, path, writer_key)`, plus the trigger. |
| `20260617000000_drop_network_registry_forward_table.sql` | Forwards now live only in the router's `rules.v4` file.                                                                |
| `20260621120000_home_network_occupants.sql`              | Same-WiFi occupancy.                                                                                                   |
| `20260625000000_network_public_ips.sql`                  | A collision-free public IP per network (later dropped).                                                                |
| `20260726000000_network_lan_leases.sql`                  | Leased LAN addresses.                                                                                                  |
| `20260727000000_drop_network_registry.sql`               | Index occupants by machine id, then drop `network_registry`.                                                           |
| `20260929000000_drop_network_public_ips.sql`             | Drop `network_public_ips`: every network's public IP is derived from its place in the world.                           |

Migrations are forward-only; there are no down migrations. The files moved from `v2/supabase/` to the
repository root when v2 became the whole repo.

## Rules you must not break

1. **Only endpoints live in `api/`.**
2. **The adapter is thin; the logic is in `src/core/`**, with database access injected.
3. **One spelling per query.** A column name is a string `tsc` cannot check; reuse the existing `*Via`
   query factories instead of pasting queries.
4. **Identity is never a client claim.** Source IPs in cross-network traces are derived on the server
   too; only on the caller's own LAN does the server take the address the client states.
5. **Replay order belongs to the server** (`updated_at` via default and trigger).
6. **Allocation by constraint**: claim with `ON CONFLICT DO NOTHING` plus a unique constraint; a
   `23505` means "taken, redraw"; no row back means "already mine".
7. **New tables get row-level security with no policies.**
8. **The nonce store is a deliberate no-op everywhere.**
9. **No backward-compatibility burden until launch.** Destructive migrations are acceptable today. This
   rule ends at the multiplayer announcement; after that, migrations need data discipline.

## How to…

### Add an API action

1. Pick the endpoint by domain (network and reachability; the journal and traces; sessions and doors).
   Do not create a new file in `api/` unless you really want a new endpoint.
2. Write the core handler first (test first) at `src/core/<area>/<action>.ts`: a `Deps` type with
   `nonceStore` and each database access as a function; a `looseObject` schema with
   `action: z.literal('<action>')` that refuses identity fields; `verifySignedRequest`; the right gate;
   `500 <thing>_failed` for database errors; `appendMachineLog` for traces.
3. Route it in `api/<endpoint>.ts` **before** the fallthrough:
   `if (actionOf(req.body) === '<action>') { const {status, body} = await handleX(req.body, {nonceStore: noopNonceStore, ...deps}); res.status(status).json(body); return; }`.
   Import with `.js` extensions and reuse the existing query factories.
4. Add the client call in `src/adapters/<x>Api.ts` and parse its response with zod.
5. Add a wire-check `scripts/test<Feature>.ts` (chapter 11) and run it against `npm run vercel:dev`.
6. Run the gates, bump the version, open a PR.

### Add a migration

1. `npx supabase migration new <name>` creates `supabase/migrations/<timestamp>_<name>.sql`. Start with
   a header comment: what, why, security posture.
2. New table: `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` with no policies, and an index for every
   new query shape. Copy the `patches_set_updated_at` trigger if ordering must be server-owned.
3. Apply locally: `npx supabase migration up`, or `npx supabase db reset` to replay everything (this
   wipes local data).
4. Update the adapter selects and inserts, then run the wire-checks for the touched tables. Nothing
   else validates column names.
5. Push to the cloud, **dev first, then prod**, one project at a time (chapter 12).
6. Order against code: the code that reads a new column deploys after that project's push; for a drop,
   deploy the code that stops reading it first.

## Deeper reading

- [`cross-player-architecture.md`](../cross-player-architecture.md) §1, §4, §5: storage, authorization
  and the read filter (note the stale registry references listed in
  [known issues](./13-known-issues.md)).
- [Chapter 12](./12-build-deploy-operate.md): environments, deployment and operations.
