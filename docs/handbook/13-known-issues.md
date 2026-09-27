# 13. Known issues, open questions and drift

A snapshot of what a new maintainer should know is wrong, fragile, undecided or out of date, found
while writing this handbook against the code at v0.278.0 (commit `adc6ec9e`, 2026-09-27). **Delete an
entry when you fix or decide it.** Deliberately deferred features live in the backlog,
[`conventions-and-gotchas.md`](../conventions-and-gotchas.md) §9, not here.

## Time-sensitive

| Issue                                                | Detail                                                                                                                                                                                                                     | Action                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`WORLD_EPOCH` tripwire fails from 2027-01-08 UTC** | `src/core/cve/worldClock.test.ts` fails once the development epoch (2026-07-12) is `RUNWAY_DAYS` (180) days old. The test is intentional: it forces a decision. It was postponed once, on 2026-09-27, from 90 to 180 days. | Decide: re-stamp the epoch for launch, or postpone again by raising `RUNWAY_DAYS` (the world is untouched). Re-stamping re-dates all generated history and every vulnerability, and moves date-pinned tests. Delete the test at launch. |
| **Generation timing headroom may be thin**           | One run measured 1.61–1.83 ms per box against the 2 ms budget (docs say 0.86–1.67). The machine may have been loaded.                                                                                                      | Measure with a clean `npm run build`, three times, before the next content change.                                                                                                                                                      |

## Possible security gap (unverified)

**`listPatches` may expose rows the tier filter prunes.** `handleListPatches` checks only L1 (any
active session on the machine) and returns every writer's raw rows. The client calls it on a
cross-player hop (`acquireTree` → `refetchPatches`, and after every write). So a guest-tier visitor's
browser likely receives journal rows for files the owner created under `/root`, even though the
served tree from `resolveCrossPlayerFs` prunes them. That contradicts the rule "prune before the
response leaves the server". Prove it with a wire-check first; the fix is to filter `listPatches` by
tier for non-owners, or to skip the raw journal read on cross-player hops.

## Open design questions

| Question                                                                                                                                                                                                              | Where                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Should an `nc` backdoor shell survive a reload? It is a hop on the stack (`SHELL_KINDS`) but rehydration closes it (`HOP_KINDS` excludes it), and the `sessions` table has no `port` column to re-check its listener. | `ui/sessionRehydrate.ts`, `ui/activeRoot.ts`         |
| Should a reload in one tab end another open tab's live `ftp`/`nc` sessions? Today every non-fresh boot ends all non-hop rows.                                                                                         | `ui/state.ts` `rehydrateSessions`                    |
| Should `refetchPatches` keep the previous journal on a failed read, as `reloadActiveRoot` does? Today one transient failure hides the player's own edits until the next successful fetch.                             | `ui/state.ts`                                        |
| Should a skewed client clock get a hint? A clock more than 120 s off fails every request with a generic error.                                                                                                        | `core/signedRequest/verify.ts`, adapters             |
| Is "clear your site data" the intended answer for a bricked player? There is no in-game way out of the panic screen.                                                                                                  | `ui/screens/BootScreen.tsx`                          |
| `home_network_occupants.updated_at` is never refreshed on re-join (no trigger, not in the upsert), so "the player's current network" can resolve to an older one after A → B → A without a disconnect.                | `api/network.ts`, `findHomeNetworkByOwnerKey`        |
| Should a rooted deep terminal machine be writable? Writes to it fail closed today, although reads work.                                                                                                               | `core/patches/remoteWritePermission.ts` (backlog §9) |
| The intro screen says "Everything runs in your browser. No server, no tracking." The game now has a server.                                                                                                           | `ui/screens/Intro.tsx`                               |
| Backups and point-in-time recovery for `jshack-prod` are not documented.                                                                                                                                              | Supabase dashboard                                   |
| Vercel project settings (deployment protection, domains, overrides) are not recorded in the repo.                                                                                                                     | Vercel dashboard                                     |

## Latent bugs and sharp edges

- **Probable bug: generated-box logs are split across writer keys.** The own-LAN login handler
  (`core/sessions/authCreateSession.ts`, `logLoginAttempt`) writes `auth.log`/`vsftpd.log` on a
  generated box under the **caller's** key, and `resolveTraceProvenance`
  (`core/patches/traceProvenance.ts`, used by the FTP-transfer and downgrade traces) does the same for
  any unowned box, as does the zone-transfer trace (`named.log`, in `api/patches.ts`). `hydraCrack.ts`, the shared
  reach in `serviceHost.ts` and `rebootMachine.ts` use the access point's key (`ap:<essid>`). Because
  replay keeps only the newest row per path, lines from the other rows vanish from what the defender
  sees. `hydraCrack.ts` itself documents why the keys must agree. Confirm with a wire-check (an
  own-LAN `ssh` login and a `hydra` sweep on the same box, then `cat /var/log/auth.log`).
- **`removePatch` deletes descendants with SQL `LIKE '<path>/%'`.** `_` and `%` in a path are
  wildcards and would over-match (only the caller's own rows).
- **The edit-conflict check is not atomic** with the upsert: two saves from the same base within one
  request's time can both pass.
- **Session ids are client-minted** (`ssh-<user>-<ms>`, `nc-<port>-<ms>`, `exploit-<port>-<ms>`, …)
  and a global primary key; a collision is
  possible and unhandled.
- **Error lines from an early pipeline stage are silently dropped when the last stage streams**
  (`withCarried` in `core/shell/runLine.ts` handles only a `sync` final result, and that branch is
  untested).
- **An interrupted redirect (`cmd > file` then Ctrl-C) is silent.**
- **A script's `fs.appendFile` does not preserve the target's owner and permissions** (backlog §9).
- **Large generated files cannot be carried home**: a single signed write is capped at 8,192
  characters; some generated logs and datadirs are larger (backlog §9).
- **Replay order ties**: SQL `ORDER BY writer_key` (database collation) and the core sort (code points)
  can disagree on same-microsecond ties; the L2 path relies on SQL order alone.

## Quality and process debt

- **No CI.** Only Vercel's build (types + bundle budget) runs automatically. Lint, tests, wire-checks
  and mutation testing are manual.
- **`npm run format:check` fails** on hundreds of files and is not a gate. Either format once and gate
  it, or drop the script.
- **55 of 79 wire-checks ignore seed-insert errors**, against the project's own rule; a suspicious pass
  may mean an unbuilt fixture.
- **Most `makeDeps` test helpers return the default spies**, not the ones that landed in `deps`.
- **`src/ui/screens/Terminal.test.tsx`** stubs `fetch` in two tests (the `airodump-ng` and `mysql`
  ones) without restoring it, and no global `unstubGlobals` setting catches it.
- **`scripts/testSharedApForwards.ts` is flaky** (about 1 run in 17).
- **No committed runner for wire-checks**, no committed world-diff script, no direct `prng` test.
- **Mutation testing covers `src/core` only**; `src/ui` and `src/adapters` have never been mutated.

## Documentation drift

The code is correct in every case below; the text needs updating.

### In `docs/`

| Where                                                            | Says                                                                                                                                                                                                        | Actually                                                                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conventions-and-gotchas.md` §3                                  | `api/*.ts` is not type-checked locally                                                                                                                                                                      | `tsconfig.node.json` includes `api/`; `tsc -b` checks it. Only SQL column names go unchecked.                                                                     |
| `conventions-and-gotchas.md` §3                                  | 50 catalog networks                                                                                                                                                                                         | 57                                                                                                                                                                |
| `conventions-and-gotchas.md` §4                                  | `timeoutMS: 30000`; ESLint does not ignore `.stryker-tmp`; "3400+ tests"                                                                                                                                    | 120000; it does; 6,464 tests                                                                                                                                      |
| `conventions-and-gotchas.md` §5                                  | There is no `vercel.json`; production shares the dev Supabase                                                                                                                                               | `vercel.json` exists (`regions: ["fra1"]`); production uses `jshack-prod`                                                                                         |
| `conventions-and-gotchas.md` §6                                  | 45 wire-checks                                                                                                                                                                                              | 79                                                                                                                                                                |
| `conventions-and-gotchas.md` §7                                  | Gateway ids use `ed25519-router:`-style namespaces; nothing reserves NPC octets; `SERVICE_CATALOG[...].daemons`; rehydration keeps `ssh`/`su`                                                               | `ap-gw:`, `inner-gw:`, `deep-gw:`; the lease allocator excludes NPC octets at issue time; the daemon list is on apt packages; rehydration also keeps `exploit`    |
| `cross-player-architecture.md` §1, §2, §4, §5, §6, §8, key files | The registry (`findRegistryByMachineId`, `RegistryMachine`, `FindRegistryByOwnerKey`), `computeRouterId(owner_key)`, `isOwnRouter`, an owner-keyed router; a directory patch on an existing path is a no-op | The registry was dropped; the gateway is ESSID-keyed and ownerless; occupants come from `home_network_occupants`; a directory patch with permissions is a `chmod` |
| `e2e-shared-network-verification.md`                             | `cd v2`; test and wire-check counts                                                                                                                                                                         | The repository root is v2; counts have roughly tripled                                                                                                            |

### In code comments

| File                                                                 | Stale statement                                                                                                                                                                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ui/seed.ts`                                                     | "IndexedDB-persisted patches"                                                                                                                                                                       |
| `src/ui/state.ts`                                                    | "The boot gate (`main.tsx`) calls `startGame`" (it is `App.tsx`); "`OverlayMode` is pinned to the two" (three); `wrapWithRefetch`: "the workstation id is constant" (it follows the active session) |
| `src/ui/screens/App.tsx`                                             | "plain `<Show>`s" (uses `Switch`/`Match`)                                                                                                                                                           |
| `src/ui/theme/applyTheme.ts`, `src/core/theme/themes.ts`             | "eight properties" / "a ninth value" (ten tokens)                                                                                                                                                   |
| `src/core/boot/bootMessages.ts`                                      | refers to `ui/screens/boot.tsx` (`BootScreen.tsx`)                                                                                                                                                  |
| `src/ui/env.ts` header                                               | most seams are "loud stubs until a command needs them" (nearly all are wired)                                                                                                                       |
| `src/core/generation/prng.ts`, `src/core/gameConfig/gameConfig.ts`   | the player's key is the world seed (the shared world is ESSID-keyed)                                                                                                                                |
| `src/core/generation/routerFs.ts`, `gatewayHostname.ts`              | `router-admin-`/`router-host-` namespaces seeded from an owner key (`ap-gw-*`, ESSID)                                                                                                               |
| `src/core/generation/pools/essidCatalog.ts`                          | appending keeps scans stable (any length change re-rolls which networks a scan offers)                                                                                                              |
| `src/core/generation/remoteHostId.ts`                                | `hostForMachineId` is exported and tested but unused in production                                                                                                                                  |
| `api/patches.ts` header                                              | "three signed actions"; the read filter "is still a later plan" (11 actions; it shipped)                                                                                                            |
| `api/sessions.ts`                                                    | "the ten actions" (20)                                                                                                                                                                              |
| `api/network.ts`                                                     | "Nothing reads these leases yet"; story and decision tags in comments                                                                                                                               |
| `api/*.ts`, `core/signedRequest/nonceStore.ts`                       | the no-op nonce store is "local" and a real store "lands later" (no-op is the production decision)                                                                                                  |
| `src/adapters/patchApi.ts`                                           | `machineId` is "the player's own workstation"; `is_new` decides delete-versus-tombstone (removal is always a tombstone)                                                                             |
| `src/core/patches/listPatches.ts`                                    | serves "the OWN workstation's" journal (any machine passing L1)                                                                                                                                     |
| `src/core/patches/appendMachineLog.ts`                               | `writerKey` is "the acting player" (usually the owner or network key)                                                                                                                               |
| `src/core/patches/recordFtpTransfer.ts`, `recordPackageDowngrade.ts` | refer to `resolveProvenance` (it is `resolveTraceProvenance`)                                                                                                                                       |
| `src/core/network/resolveCrossPlayerFs.ts`                           | replay "scoped to `owner_key`" (machine-scoped, every writer)                                                                                                                                       |
| `src/ui/sessionRehydrate.ts`                                         | groups `nc` with parallel sessions (it pushes a hop)                                                                                                                                                |
| `src/adapters/crossTabSync.ts`                                       | implies same-workstation hints (the sender broadcasts any active machine)                                                                                                                           |
| `src/adapters/networkApi.ts`                                         | two stacked doc comments above `resolveSameLan`                                                                                                                                                     |
