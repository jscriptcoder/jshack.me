# World Networks

Persistent shared networks visible to every player. Production world content that uses one shared `public_ip` per network — every browser generates the same machines from the same seed, so cross-player visibility (PRs #80, #81) flows automatically through the existing patches infrastructure.

Used today for the multiplayer **playground** (smoke-test surface). Designed to scale to themed locales like office networks, police stations, universities, internet cafés, and other discoverable world content. New networks ship as content rows in the `world_networks` migration table — adding one is `INSERT INTO world_networks (...)` plus a corresponding `INSERT INTO public_ips (...)`.

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│  world_networks table (rows: public_ip, seed, name, theme, ...)  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼  (anon SELECT — RLS allows)
┌─────────────────────────────────────────────────────────────────┐
│  Browser: listWorldNetworks() → useWorldNetworks → App.tsx       │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼  (per row, run mission generator with
                             │   a fake allocator pinning row.public_ip)
┌─────────────────────────────────────────────────────────────────┐
│  generateMissionNetwork(seed, undefined, { allocateIp:           │
│    async () => row.public_ip })                                  │
│  → identical machine_ids across players                          │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  FileSystemProvider: merge fileSystems into homeFileSystems       │
│    → cross-player visibility plumbing (rehydration + Realtime)    │
│  NetworkProvider: pass full networks via worldNetworks prop       │
│    → nmap / ssh / curl can resolve world IPs                      │
└─────────────────────────────────────────────────────────────────┘
```

## Files

| File                  | Description                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.ts`           | `listWorldNetworks()` — direct anon-key Supabase read of the `world_networks` table.                                                                                                |
| `generate.ts`         | `generateWorldNetworks(rows, generator)` — runs the (injected) mission generator per row with a fake allocator pinning each row's `public_ip`. Returns the full `MissionNetwork[]`. |
| `useWorldNetworks.ts` | React hook — fetches at mount, generates, exposes `ReadonlyArray<MissionNetwork>`.                                                                                                  |
| `types.ts`            | `WorldNetwork` row shape.                                                                                                                                                           |
| `*.test.ts`           | Unit tests.                                                                                                                                                                         |
| `README.md`           | This file.                                                                                                                                                                          |

Plus:

- `supabase/migrations/<timestamp>_world_networks.sql` — schema + seeded playground row at `203.0.113.42`
- 1 tripwire test in `src/ipRegistry/allocate.test.ts` (allocator skips reserved world IPs)
- `NetworkProvider` extension in `src/network/NetworkContext.tsx` + helpers in `src/network/networkUtils.ts` (`collectWorldGatewayIps`, `buildWorldRouterRemoteViews`, `findMachineInWorldNetworks`)
- 5-line wiring in `src/App.tsx`

## How to add a new world network

Write a new migration:

```sql
INSERT INTO public_ips (ip, kind, owner_key)
  VALUES ('203.0.113.43', 'world_network', NULL);

INSERT INTO world_networks (public_ip, seed, name, description, theme)
  VALUES (
    '203.0.113.43',
    'office-template-1',
    'ACME Corp HQ',
    'Standard enterprise LAN — workstations, file servers, internal wiki.',
    'office'
  );
```

Then:

- Local: `npm run db:reset` — re-applies all migrations from scratch.
- Cloud-dev (`jshack-dev` Supabase project): `npx supabase db push` — applies new migrations only.

Pick any IP in TEST-NET-3 (`203.0.113.0/24`), TEST-NET-1 (`192.0.2.0/24`), or TEST-NET-2 (`198.51.100.0/24`) — IETF-reserved for documentation, will never collide with real-world IPs. (Long-term, themed networks will likely move to plausible "fake real" IP ranges via the IP registry's normal allocation; for now docs IPs keep the dev/prod boundary clear.)

The `seed` string drives the mission generator. Use seed-override prefixes like `easy-`, `medium-`, `hard-`, `forensics-`, `portforward-`, `shell-full-`, `script-exec-`, etc. (see `src/generation/parseSeedOverrides.ts` for the full grammar) to control difficulty + vulnerability shape.

## Themes

The `theme` column is a free-form string tag. Current values:

- `playground` — multiplayer smoke-test surface (the default seeded row at `203.0.113.42`)

Planned/future themes (each is a content addition, not a code change):

- `office` — corporate LAN with workstations, file servers, internal wiki
- `police` — government-tier hardening, surveillance systems, secure comms
- `university` — sprawling LAN with mixed security (research labs vs admin vs student wifi)
- `cafe` — public wifi + a few rentable terminals, transit hub vibe

See memory `project_themed_persistent_networks.md` for the broader design direction.

## Manual smoke check

For the playground row (`203.0.113.42`):

1. Open the deployed app in two browsers with different identities (clear localStorage between them, OR use one normal + one incognito).
2. Both should see machine `203.0.113.42` in `nmap` reach (e.g. `nmap 203.0.113.42`).
3. SSH into it from browser A using credentials shown by `nmap`/`hydra`.
4. Write a file: `echo "hello from A" > /tmp/from-a.txt`.
5. In browser B, `cat /tmp/from-a.txt` — should show "hello from A" within ~1s without browser B refreshing.

This proves the cross-player visibility chunk (PRs #80, #81) plus the world networks integration all work end-to-end.
