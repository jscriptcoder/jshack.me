# Plan: Redis Service & `rediscli` Command

**Branch**: feature/redis-service-rediscli
**Status**: Active

## Goal

Add Redis as an interactive service on database-role machines with a `rediscli()` command for key-value exploration, following the MySQL command pattern.

## Design Decisions

### Port 6379 opening — PRNG roll on database machines

Port 6379 already exists in the database role port template (closed by default). During filesystem generation, a PRNG roll determines whether Redis opens on each database machine (~35% chance). This is done at the same stage as MySQL database generation — before credential leak placement.

### Authentication — mostly unauthenticated

Real-world Redis is notoriously left open without a password. Most generated Redis instances will be unauthenticated (connect and go). A PRNG roll (~25%) sets a `requirepass` in `/etc/redis/redis.conf`, requiring `AUTH password` after connecting. The password comes from the mission passwords pool.

When auth is required:

- Connecting shows `(error) NOAUTH Authentication required.` until `AUTH password` is sent
- `hydra(ip, "redis")` brute-forces the requirepass password
- Wrong AUTH returns `(error) ERR invalid password`

### Data model — key-value store

Redis data stored at `/var/lib/redis/data.json` as a flat JSON object mapping keys to values. Key naming follows Redis conventions with colon-delimited namespaces:

- `sess:<token>` — session data (JSON strings with username, IP, role)
- `app:config` — application config (JSON with database URLs, API endpoints)
- `cache:user:<id>` — cached user profiles (JSON with email, role, last_login)
- `queue:jobs` — pending job count (integer string)
- `stats:requests` — request counter (integer string)
- `api:key:<name>` — API tokens (plain strings)

Data is generated deterministically per machine via `generateRedisData(prng, users)`, producing 8-15 keys. No cross-machine credentials (separate future feature).

### Command syntax

```
rediscli("10.0.1.5")              // connect (no auth)
rediscli("10.0.1.5", "password")  // connect with auth
```

### Supported Redis commands

Interactive `redis>` prompt supports:

- `KEYS *` / `KEYS pattern` — list keys (supports `*` glob)
- `GET key` — get string value
- `SET key value` — set string value
- `DEL key` — delete key
- `TYPE key` — return "string" (all values are strings)
- `TTL key` — return -1 (no expiry, simulated)
- `DBSIZE` — return number of keys
- `INFO` — server info summary (version, connected clients, used memory)
- `AUTH password` — authenticate (when requirepass is set)
- `PING` — return "PONG"
- `QUIT` / `EXIT` — disconnect

Mutations (SET, DEL) persist back to `/var/lib/redis/data.json`.

### Apt package

Package name: `redis-tools` (real Debian package). Installs `rediscli` binary to `/usr/bin/`.

## Acceptance Criteria

- [ ] Database machines have ~35% chance of Redis port 6379 being open
- [ ] Open Redis port generates `/var/lib/redis/data.json` with 8-15 key-value pairs
- [ ] Redis config at `/etc/redis/redis.conf` with optional `requirepass`
- [ ] `rediscli(ip)` connects to Redis, enters `redis>` prompt
- [ ] `rediscli(ip, password)` authenticates inline
- [ ] All supported Redis commands work (KEYS, GET, SET, DEL, TYPE, TTL, DBSIZE, INFO, AUTH, PING)
- [ ] Mutations persist to filesystem
- [ ] `redis-tools` apt package installs `rediscli` binary
- [ ] `hydra(ip, "redis")` brute-forces requirepass
- [ ] Redis auth logged to `/var/log/redis.log`
- [ ] Existing tests pass; new tests cover Redis generation, command, and session

## Steps — PR 1: Redis Data Generation

Opens port 6379 on some database machines, generates Redis data and config files.

### Step 1: Open Redis port 6379 via PRNG roll during filesystem generation

**Test**: Write test that across 100 seeds, some database machines have port 6379 open and some don't (~35% rate, test for at least 15% and at most 55%).
**Implementation**:

- In `generateFileSystems.ts` (the `buildMachineConfig` function or the pipeline), add a PRNG roll for database-role machines: ~35% chance to open port 6379
- The roll must happen in the generation pipeline where ports can still be modified (in `generateNetwork.ts` or `generateFileSystems.ts`, after topology but before filesystem creation)
- Always consume the PRNG call for sequence stability
  **Done when**: Database machines sometimes have port 6379 open, PRNG-deterministic.

### Step 2: Generate Redis data for machines with open Redis port

**Test**: Write `generateRedisData.test.ts`:

1. Returns 8-15 keys
2. Keys follow namespace conventions (`sess:`, `app:`, `cache:`, etc.)
3. Values are strings (JSON-encoded for structured data)
4. Deterministic for same seed
5. Different data for different seeds

**Implementation**:

- Create `src/generation/generateRedisData.ts` with `generateRedisData(prng, users): RedisData`
- `RedisData` type: `{ readonly keys: Readonly<Record<string, string>>; readonly requirepass: string | null }`
- Generate key-value pairs from templates using PRNG
- ~25% chance of `requirepass` (password from mission passwords pool)
- Return the data structure
  **Done when**: Redis data generator produces realistic key-value data.

### Step 3: Place Redis data and config on filesystem

**Test**: Write test that a database machine with open Redis port gets `/var/lib/redis/data.json` and `/etc/redis/redis.conf`.
**Implementation**:

- In `generateFileSystems.ts`, after MySQL database generation block, add similar block for Redis:
  - Check `hasOpenRedisPort` (port 6379, service 'redis', open)
  - Call `generateRedisData(prng, users)`
  - Place `/var/lib/redis/data.json` with `JSON.stringify(redisData.keys)`
  - Place `/etc/redis/redis.conf` with bind, port, and optional `requirepass`
- Follow same `/var/lib/` merge pattern as MySQL
  **Done when**: Filesystem tests pass; dump scripts show Redis data on database machines.

## Steps — PR 2: `rediscli` Command & Session

### Step 4: Add Redis prompt type and session

**Test**: Write test that `RedisPromptData` type exists and `isRedisPrompt` type guard works.
**Implementation**:

- Add `RedisPromptData` to `src/components/Terminal/types.ts` (like `MysqlPromptData`)
- Add `RedisQuitOutput` type
- Add to `AsyncFollowUp` and `SpecialOutput` unions
- Add `isRedisPrompt` type guard
- Add `RedisSession` to `src/session/SessionContext.tsx`
- Add `enterRedisMode`, `exitRedisMode`, `isInRedisMode` to session
- Add `redis>` prompt display
  **Done when**: TypeScript compiles with new types, session mode works.

### Step 5: Create `rediscli` command

**Test**: Write `rediscli.test.ts`:

1. `rediscli("10.0.1.5")` connects to machine with open Redis port, returns async output
2. `rediscli("10.0.1.5")` throws when port 6379 is not open
3. `rediscli("10.0.1.5")` throws when machine doesn't exist
4. No args throws usage error
5. Returns `RedisPromptData` via `onComplete`

**Implementation**:

- Create `src/commands/rediscli.ts` with `createRediscliCommand(context)` — mirrors `mysql.ts`
- Validates host, resolves IP, checks port 6379 open
- Returns `AsyncOutput` with connect delay, then `RedisPromptData`
- Optional second arg for inline password
  **Done when**: Command tests pass.

### Step 6: Create Redis command parser and executor

**Test**: Write `src/commands/redis/parser.test.ts` and `src/commands/redis/executor.test.ts`:

1. Parser: `KEYS *`, `GET key`, `SET key value`, `DEL key`, `AUTH pass`, `PING`, `QUIT` all parse correctly
2. Parser: unknown commands return error
3. Executor: `KEYS *` returns all keys
4. Executor: `KEYS sess:*` returns only matching keys
5. Executor: `GET` existing key returns value, missing key returns `(nil)`
6. Executor: `SET` creates/updates key, returns `OK`
7. Executor: `DEL` removes key, returns count
8. Executor: `AUTH` with correct password returns `OK`, wrong returns error
9. Executor: `DBSIZE` returns key count
10. Executor: `INFO` returns server summary
11. Executor: `PING` returns `PONG`

**Implementation**:

- Create `src/commands/redis/` directory with `parser.ts`, `executor.ts`, `types.ts`, `formatter.ts`
- Parser: split input on whitespace, match first token to command enum
- Executor: operate on `Record<string, string>` data, return read or mutation results
- Formatter: format output strings (Redis CLI style — no table formatting, just plain values)
  **Done when**: Parser and executor tests pass.

### Step 7: Create `useRedisCommands` hook and wire Terminal integration

**Test**: Integration test that Redis prompt mode routes input to executor and persists mutations.
**Implementation**:

- Create `src/hooks/useRedisCommands.ts` — mirrors `useMysqlCommands.ts`
- Reads `/var/lib/redis/data.json`, parses commands, executes, writes back mutations
- Handles AUTH state (if requirepass is set, reject commands until AUTH succeeds)
- Wire into `Terminal.tsx`:
  - Handle `isRedisPrompt()` in async follow-up
  - Route `redis>` mode input to `redisExecute`
  - Handle quit output
- Add Redis auth to `useAuthentication.ts` — `connectRedis`, `validateRedisPassword`, `authenticateRedisInline`
  **Done when**: Full interactive Redis session works in terminal.

### Step 8: Register command and apt package

**Test**: Write test that `rediscli` is in apt packages and requires install.
**Implementation**:

- Add `redis-tools` to `APT_INSTALLABLE` and `APT_PACKAGES` in `availability.ts` with `binaries: ['rediscli']`
- Add `'rediscli'` to `APT_TOOL_NAMES`
- Register `rediscli` in `useNetworkCommands.ts` with wifi/bricked guards
  **Done when**: `apt install redis-tools` enables `rediscli`; `help()` shows it.

### Step 9: Add hydra Redis brute-force and auth logging

**Test**: Write test that `hydra(ip, "redis")` cracks requirepass password.
**Implementation**:

- Add `'redis'` to `VALID_SERVICES` in `hydra.ts`
- Add Redis attack function: reads `/etc/redis/redis.conf` for requirepass hash, tries passwords from pool
- Add `formatRedisAuth` and `formatRedisAuthDenied` to `src/logging/formatters.ts`
- Add `onRedisAuth` callback in Terminal.tsx, log to `/var/log/redis.log`
  **Done when**: Hydra cracks Redis passwords; auth events logged.

### Step 10: End-to-end verification and docs

**Test**: Manual verification with debug scripts and live testing.
**Implementation**:

- Run `npm run build`, `npm run lint`, `npm run format`, `npm run test:run`
- Update docs: CLAUDE.md, architecture.md, README.md, module READMEs
- Bump version
  **Done when**: All checks green, docs updated, PR ready.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — run `mutation-testing` skill
2. Refactoring assessment — run `refactoring` skill
3. `npm run build` — typecheck passes
4. `npm run lint` — no lint errors
5. `npm run format` — formatting clean
6. `npm run test:run` — all tests pass

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
