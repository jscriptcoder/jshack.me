# Test Networks (DEV-ONLY)

> ⚠️ **DEV-ONLY FIXTURE — NOT SHIPPING WITH THE GAME.** This entire module is engineered as a removable graft. See [Release cleanup checklist](#release-cleanup-checklist) at the bottom.

A small infrastructure for spinning up shared test networks: full mission-style topologies where every player sees the same machine_ids. Lets us smoke-test cross-player visibility (PRs #80, #81) end-to-end without waiting for home-network instances to ship.

## Why this exists

The cross-player visibility chunk delivered:

- **PR #80** — server-side cross-player read path (`listPatchesForMachines`)
- **PR #81** — Supabase Realtime broadcast on every patch mutation; clients subscribe per-machine

Both were unit/integration-tested heavily but had no clean end-to-end smoke surface in shipped gameplay. Mission instances allocate unique IPs per player. Home networks aren't shared yet. localhost is per-player by design (player_key filter). Without a deliberately-shared machine, "two browsers see each other's writes live" couldn't be demonstrated.

`test_networks` is that surface. One row in the DB pins a `public_ip` + `seed`; every browser fetches the list, runs the existing mission generator with those exact inputs, and gets identical machine_ids. Cross-player visibility flows automatically through the existing plumbing.

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│  test_networks table (rows: public_ip, seed, name, description)  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼  (anon SELECT — RLS allows)
┌─────────────────────────────────────────────────────────────────┐
│  Browser: listTestNetworks() → useTestNetworks → App.tsx         │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼  (per row, run mission generator)
┌─────────────────────────────────────────────────────────────────┐
│  generateMissionNetwork(seed, undefined, { allocateIp:           │
│    async () => row.public_ip })                                  │
│  → identical machine_ids across players                          │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼  (merge into homeFileSystems)
┌─────────────────────────────────────────────────────────────────┐
│  FileSystemProvider — picks up test machines via the existing    │
│  machineIds computation (rehydration + Realtime subs)            │
└─────────────────────────────────────────────────────────────────┘
```

## Files

| File                 | Description                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `client.ts`          | `listTestNetworks()` — direct anon-key Supabase read (no Vercel function)                                     |
| `generate.ts`        | `generateTestNetworkFileSystems(rows, generator)` — runs the (injected) generator per row, merges fileSystems |
| `useTestNetworks.ts` | React hook — fetches at mount, generates, exposes the merged Record                                           |
| `types.ts`           | `TestNetwork` type                                                                                            |
| `*.test.ts`          | Unit tests                                                                                                    |
| `README.md`          | This file                                                                                                     |

Plus:

- `supabase/migrations/<timestamp>_test_networks.sql` — schema + seeded fixture
- 1 line in `App.tsx` calling `useTestNetworks()` and merging into `homeFileSystems`
- 1 tripwire test in `src/ipRegistry/allocate.test.ts` (allocator skips reserved test IPs)

## How to add a new test network

Write a new migration:

```sql
-- supabase/migrations/<timestamp>_my_new_test_network.sql

INSERT INTO public_ips (ip, kind, owner_key)
  VALUES ('203.0.113.43', 'test_network', NULL);

INSERT INTO test_networks (public_ip, seed, name, description)
  VALUES (
    '203.0.113.43',
    'test-medium-difficulty',
    'Medium Playground',
    'For testing scan-and-pivot scenarios.'
  );
```

Then:

- Local: `npm run db:reset` — re-applies all migrations from scratch.
- Cloud-dev (`jshack-dev` Supabase project): `npx supabase db push` — applies new migrations only. The previous test_networks rows survive.

Pick any IP in TEST-NET-3 (`203.0.113.0/24`), TEST-NET-1 (`192.0.2.0/24`), or TEST-NET-2 (`198.51.100.0/24`) — IETF-reserved for documentation, will never collide with real-world IPs.

The seed string drives the mission generator. Use seed-override prefixes like `easy-`, `medium-`, `hard-`, `forensics-`, `portforward-`, `shell-full-`, `script-exec-`, etc. (see `src/generation/parseSeedOverrides.ts` for the full grammar). E.g. `'medium-shell-full'` produces a medium-difficulty network with a guaranteed shell-full vulnerability.

## Manual smoke check

1. Open the deployed app in two browsers with different identities (clear localStorage between them, OR use one normal + one incognito).
2. Both should see machine `203.0.113.42` in `nmap` reach (e.g. `nmap 203.0.113.42`).
3. SSH into it from browser A using the credentials shown by `nmap`/`hydra`.
4. Write a file: `echo "hello from A" > /tmp/from-a.txt`.
5. In browser B, `cat /tmp/from-a.txt` — should show "hello from A" within ~1s without browser B refreshing.

Step 5 is the proof that PRs #80 + #81 + this PR all work end-to-end against shared persistent state.

## Release cleanup checklist

When the game is ready to ship and the playground should disappear:

**Pre-launch path** (no live data — recommended):

1. Delete `supabase/migrations/<timestamp>_test_networks.sql`
2. Delete the `src/testNetworks/` directory
3. Remove the import + hook call + `mergedHomeFileSystems` useMemo in `src/App.tsx`. Restore `homeFileSystems={activeNetwork?.fileSystems}` directly.
4. Remove the tripwire test in `src/ipRegistry/allocate.test.ts` ("skips test_network reserved IPs via PK conflict retry") — the existing "retries on conflict" test covers the mechanism.
5. `npm run db:reset` (local) and re-link / re-push the cloud-dev project.
6. Remove `'test_network'` from any consuming code (none expected — grep `test_network` to confirm).

**Post-launch path** (if data was persisted to production):

1. Write a cleanup migration:
   ```sql
   DROP TABLE test_networks;
   ALTER TABLE public_ips DROP CONSTRAINT public_ips_kind_check;
   ALTER TABLE public_ips ADD CONSTRAINT public_ips_kind_check
     CHECK (kind IN ('mission_instance', 'home_network', 'pivot', 'npc_faction', 'darknet_hub'));
   DELETE FROM patches WHERE machine_id IN (
     -- list of test IPs to clean orphans
   );
   ```
2. Same code-removal steps as the pre-launch path.

**Grep-friendly markers** for finding everything to delete:

```bash
grep -r "test_network\|testNetworks\|test-networks" src/ api/ supabase/
```

The whole module is engineered to be a removable graft. If a future grep returns surprises, those are real bugs (the module leaked).
