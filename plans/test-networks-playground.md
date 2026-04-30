# Plan: Test Networks Playground (dev-only fixture)

**Branch**: feat/test-networks-playground
**Status**: Active

## Goal

Build a dev-only mechanism for spinning up shared test networks — full mission-style topologies where every player sees the same machine_ids. Lets us smoke-test cross-player visibility (PRs #80, #81) end-to-end and exercise multiplayer features under realistic conditions before launch.

**Not for production**. Removed entirely at game release.

## Acceptance Criteria

- [ ] A `test_networks` table holds `(public_ip, seed, name, description)` rows
- [ ] Test IPs are registered in `public_ips` with `kind='test_network'`, so the IP allocator never hands them out for missions/homes (the PK conflict retry naturally skips them)
- [ ] At least one seeded test network in the migration (more later via additional migrations)
- [ ] `GET /api/test-networks` returns the list (anon-readable; no auth needed — these are public test fixtures)
- [ ] Client fetches the list at boot and merges each generated network into `FileSystemProvider.homeFileSystems`
- [ ] Two browsers with different identities both see the test network, can write to it, see each other's writes live (proves PR #80 + #81 working end-to-end)
- [ ] Removing the playground at release: drop the migration, drop the endpoint, drop the client fetcher. Patches rows for those machine_ids become orphaned but harmless.

## Out of scope

- Dev-only `POST /api/test-networks` endpoint to create networks at runtime — for now, devs add via migrations + db:reset. Tier-2 enhancement if migration friction proves real.
- Removing test networks at runtime — same.
- Auth on `GET /api/test-networks` — these are dev fixtures, public is fine.
- Visibility rules for test-network reads — same model as PR #80: knowing the machine_id is the gate. The whole point of the playground is everyone shares it.

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR.

### Step 1: Migration — `test_networks` table + extend `public_ips.kind` + seed

**Acceptance criteria**: New SQL migration file. Creates `test_networks` table with `(public_ip PRIMARY KEY, seed, name, description, created_at)`. Foreign key from `test_networks.public_ip` to `public_ips.ip` so the relationship is enforced. Adds `'test_network'` to the `public_ips.kind` CHECK constraint. Seeds at least one test network (basic playground: simple SSH-accessible machine). RLS enabled on `test_networks` with anon-readable policy.
**RED**: N/A — this is a SQL migration. The test is `npm run db:reset` succeeds and the test_networks row is queryable.
**GREEN**: Write the migration. Include INSERT for one seed network.
**Done when**: `npm run db:reset` clean, `SELECT * FROM test_networks` returns the seed row, `SELECT * FROM public_ips WHERE kind='test_network'` matches.

### Step 2: Allocator skip behavior is verified

**Acceptance criteria**: A test (or property test) confirms that `allocateIp` never returns an IP that's reserved as `kind='test_network'`. Existing PK-conflict-retry logic should already deliver this — Step 2 is just a tripwire so a future allocator refactor can't accidentally hand out test IPs.
**RED**: Add a test where insertIp first returns 'conflict' for the test-reserved IP, then 'ok'. Assert `allocateIp` returns the second IP.
**GREEN**: Likely no production code change (existing behavior already handles this).
**Done when**: Test passes, locks the contract.

### Step 3: Client wrapper that reads `test_networks` directly via the anon-key Supabase client

**Acceptance criteria**: New module `src/testNetworks/client.ts` exports `listTestNetworks() → Promise<ReadonlyArray<TestNetwork>>`. Uses the existing anon-key Supabase client from `src/patchRegistry/realtime.ts` (`getRealtimeClient()`) to query `test_networks` directly — RLS already allows anon SELECT. No new Vercel function. Failures degrade gracefully (logged, returns empty array, app continues).

This skips the traditional endpoint pattern because the data is intentionally public (RLS-allowed for anon), the table is dev-only (deleted at release), and adding a server function would just be a pass-through wrapper. The "direct anon read from client" pattern is honest about what test_networks actually is.

**RED**: Wrapper test — mock Supabase client, verify select call shape, verify return type, verify error handling (logs + returns []).
**GREEN**: New file `src/testNetworks/client.ts` with the wrapper. Plus `src/testNetworks/types.ts` for the `TestNetwork` shape.
**Done when**: tests green, mutation report clean, human approves commit.

### Step 5: Generate each test network and merge into FileSystemProvider

**Acceptance criteria**: For each test network, run `generateMissionNetwork(seed, public_ip)` — reuses the existing generator. Resulting filesystems merge into `App.tsx`'s prop to `FileSystemProvider` (alongside `homeFileSystems`). Test networks appear in the player's view automatically — `nmap`, `ssh`, `curl` work against them.
**RED**: Integration test (or App test) — mount with a mocked test network, assert the network's machines show up in `getNode` for the right machine_id.
**GREEN**: Wire the generation + merge in App.tsx.
**Done when**: tests green, manual smoke pass (two browsers, write, see each other live).

### Step 6: Pre-PR quality gate

**Acceptance criteria**: build/lint/format/test green. Manual smoke confirms cross-player visibility on the seed test network. README + technology-choices.md note the playground (clearly marked as dev-only).

## Pre-PR Quality Gate

1. Mutation testing on new code
2. Refactoring assessment
3. Typecheck and lint pass
4. Manual smoke (two browsers, see each other write live on a test network machine)
5. Docs updated

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
