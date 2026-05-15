# Plan: techparts.io time-gated CVE

**Branch**: feat/techparts-time-gated-cve
**Status**: Active

## Goal

Move techparts.io's port 80 from a hand-authored day-0 CVE (`Apache/2.4.49`, CVE-2024-9001, `shell_limited:user`) onto a Layer-2 procedural Apache version, so the site appears safe at game start and becomes exploitable some days into the game via the existing walker `publishedAt` mechanism.

## Background

`src/themedNetworks/generators/techpartsNetwork.ts:122-135` currently hardcodes `Apache/2.4.49` on port 80 plus a `www-data:user` owner stamp. That version matches a hand-authored entry in `src/generation/pools/vulnerabilities.ts` whose `publishedAt=0` (Layer-1 invariant from `mkTemplate`), so msfconsole succeeds from universe day 0.

The Layer-2 procedural timeline (`src/generation/timeline/walker.ts`) walks forward from each service's starting tuple, accumulating randomized 3–14 day gaps between CVEs (`CVE_TIMING_CONFIG`). `findVulnForService` gates Layer-2 vulns on `publishedAt > gameTime`. The Apache template starts at `[2,4,60]` — confirmed by `src/generation/timeline/walker.test.ts:76` (`expect(first?.version).toBe('Apache/2.4.60')`). The first procedural CVE therefore drops somewhere between day 3 and day 14.

Effect is rolled deterministically per `(service, index)` via `buildGeneratedVuln` → `pickEffect`. The http effect pool is `[shellFull×2, fileRead×2, fileWrite, scriptExec, backdoorPortOpen]` × `[guest, user, root]`. We narrow this to `shell_full` at `user` tier only so:

- the gameplay payoff stays "get a shell on the reseller site" — consistent with the current `shell_limited:user` arc, just rolled procedurally
- damage ceiling stays at defacement of `/var/www/html` — `www-data` cannot touch `/etc/passwd`, `/etc/findit`, or system libs
- recovery is straightforward: re-run the generator and `DELETE FROM patches WHERE machine_id = '198.51.100.80' AND path LIKE '/var/www/html/%'`
- root tier is excluded — a root shell on techparts.io would let a player brick the box (wipe `/etc/passwd`, corrupt CVE flow), and the hand-authored content in `content/techparts/pages.ts` is the actual asset worth protecting
- `backdoor_port_open` is avoided because of its sticky-port artefact on a shared machine
- `file_read` / `file_write` / `script_exec` are excluded because the cosmetic site has no interesting recon payoff and the shell narrative is more techparts-flavoured

`shell_limited` is not in the http effect pool (`src/generation/timeline/effectPicker.ts:46`), so the only "shell" effect that can roll for http is `shell_full`. The allowlist matches roughly `2/7 × 1/3 ≈ 9.5%` of timeline entries — over a ~100-entry walk budget that yields ~9-10 viable matches.

The picker walks the procedural timeline and returns the first `(version, index)` entry whose rolled effect satisfies the allowlist. Owner is always `www-data` (only user-tier matches survive the filter), so the per-tier `ownerFor` helper from Step 2 collapses to a constant.

Port 443 (`nginx/1.20.1`) stays inert: `service: 'https'` has no Layer-1 entry and the `https` template starts at `nginx/1.26.0` (no Layer-2 match for 1.20.1). No change needed.

`apt upgrade` cannot currently reach techparts.io (no ssh port → no shell session → no apt invocation), and even if it could, today's `handleUpgrade` only mutates `/var/lib/dpkg/status` — it does not rewrite `Port.serviceVersion`. The player-driven service-patching feature (see memory `project_player_driven_service_patching`) is not in scope here.

## Acceptance Criteria

Behavioural — observable through `findExploitableCve` + `msfconsole` semantics, not internals:

- [ ] At `gameTime=0`, `msfconsole techparts.io 80` reports "no known vulnerability" (port 80 has a serviceVersion but no live CVE)
- [ ] By `gameTime=30` (well past the worst-case first-CVE window of 14 days), `msfconsole techparts.io 80` returns a hit — the procedural CVE is live
- [ ] The hit's `effect.kind` is `shell_full`
- [ ] The hit's `effect.tier` is `user`
- [ ] Port 80's `owner.userType` is `user` (msfconsole's owner check at `msfconsole.ts:172/216` keeps passing) and `owner.username` is `www-data`
- [ ] Port 443 remains inert across all game times (no behavioural change)
- [ ] `npm run test:run`, `npm run lint`, `npm run build` all pass
- [ ] `src/themedNetworks/README.md` table reflects time-gated CVE on port 80
- [ ] `package.json` + `package-lock.json` bumped from `0.130.0` → `0.131.0`

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test.

### Step 1: Add `pickApacheCveVersion()` helper as a pure function

**Acceptance criteria**: A pure helper, exported from `src/themedNetworks/generators/techpartsNetwork.ts` (local to this generator until a second themed network needs the same shape), returns a `{ version, effect }` pair such that:

- `version` is a Layer-2 procedural Apache version string (matches `findGeneratedVersion('http', version, ∞)`)
- `effect.kind` is `shell_full`
- `effect.tier` is `user`
- Deterministic — same inputs always produce the same result
- Falls back to the timeline's entry 0 (with whatever effect it rolled) if no allowlist match is found within the walk budget

**RED**: Add a new `describe('pickApacheCveVersion')` block to `src/themedNetworks/generators/techpartsNetwork.test.ts` (or a sibling test file if the generator test file grows past readability). Failing assertions:

- Returned `version` starts with `Apache/`
- Returned `version` is locatable via `findGeneratedVersion('http', version, 10_000, CVE_TIMING_CONFIG)`
- Returned `effect.kind` is `shell_full`
- Returned `effect.tier` is `user`
- Two consecutive calls return the same `{ version, effect }` (determinism)

**GREEN**: Implement `pickApacheCveVersion()` walking the procedural timeline via `buildTimeline('http', WALK_BUDGET_DAYS, CVE_TIMING_CONFIG)`, computing each entry's effect via `buildGeneratedVuln('http', entry).effect`, and returning the first match. Walk budget ≈ `CVE_TIMING_CONFIG.maxSafeWindowDays * 100` (year+). Fallback path triggers when the filter empties — return `{ version: timeline[0].version, effect: buildGeneratedVuln('http', timeline[0]).effect }`.

**MUTATE**: Run `mutation-testing` skill on the new helper. Produce a report covering: allowlist set membership, walk budget bound, fallback branch, determinism (no PRNG re-seeding bug).

**KILL MUTANTS**: Add tests for any surviving mutants. Likely candidates: off-by-one on walk budget, allowlist short-circuit logic, fallback branch unreachable in normal cases (may need a targeted test with an empty allowlist via parametrization or a synthetic service template stub).

**REFACTOR**: Assess whether `pickApacheCveVersion` should generalise to `pickProceduralVersion({ service, allowedKinds, allowedTiers, walkBudgetDays })` — defer unless a second themed network's plan immediately needs it (YAGNI per project's "no premature abstraction" rule).

**Done when**: Picker tests pass, mutation report reviewed, helper is exported from the generator module.

### Step 2: Wire `pickApacheCveVersion()` into the generator + update existing port tests

**Acceptance criteria**: `generateTechpartsNetwork`'s port 80 declaration is built from the picker's result. Existing `techpartsNetwork.test.ts` port assertions are updated to match new behaviour. `findExploitableCve` returns undefined at `gameTime=0` for port 80, and returns a vuln (with allowlisted effect) at `gameTime=30`.

**RED**: Update `src/themedNetworks/generators/techpartsNetwork.test.ts`:

- Replace the `Apache/2.4.49` assertion with: "port 80 serviceVersion comes from the Apache procedural timeline" (assert via `findGeneratedVersion('http', port.serviceVersion, 10_000, CVE_TIMING_CONFIG)` is defined)
- Keep the `www-data` owner assertion intact — owner is always www-data because only user-tier matches survive the picker's filter
- Add: "port 80 is not exploitable at gameTime=0" — assert `findExploitableCve(remoteMachine, port80, 0) === undefined`
- Add: "port 80 is exploitable by gameTime=30 with a shell_full:user effect" — assert `findExploitableCve(remoteMachine, port80, 30)` returns a vuln whose `effect.kind === 'shell_full'` and `effect.tier === 'user'`
- Keep "port 443 has no owner / no CVE" assertions untouched (port 443 unchanged)
- Drop assertions tied to `Apache/2.4.49` / `CVE-2024-9001` specifically

These assertions fail against the current hardcoded port 80 — picker isn't wired in yet.

**GREEN**: In `techpartsNetwork.ts`:

- Call `pickApacheCveVersion()` once at the top of `generateTechpartsNetwork`
- Build port 80 from the result: `serviceVersion: picked.version`, `owner: WWW_DATA_OWNER` (a const ServiceOwner since only user-tier survives the picker's filter)
- Update the inline comment block (`// Port 80 ships Apache/2.4.49 — Layer-1 hand-authored CVE...`) to describe the new time-gated procedural picker and the user-tier-only safety rationale
- Drop the hardcoded `Apache/2.4.49` literal — `serviceVersion` is now derived

**MUTATE**: Run `mutation-testing` skill on the generator changes. Focus on: the picker call site, the gameTime-gated test expectations, and the owner constant.

**KILL MUTANTS**: Address survivors. The picker call must actually execute (a test that asserts deterministic re-runs produce the same port 80 shape catches a stale memoization mistake). The owner constant must be the right user identity (the `www-data` user is what /etc/passwd ships).

**REFACTOR**: Assess whether `WWW_DATA_OWNER` deserves to live alongside `pickApacheCveVersion` as a co-located pair (they're conceptually linked: picker's tier filter justifies the owner constant). Otherwise leave inline.

**Done when**: All techpartsNetwork tests green, mutation report reviewed, comments updated, no leftover `Apache/2.4.49` literal in the generator's port-construction block.

### Step 3: Update docs + version bump

**Acceptance criteria**:

- `src/themedNetworks/README.md` table for techparts row reflects the new behaviour: replace "CVE-eligible on port 80" with "Time-gated CVE on port 80 (procedural, drops day ~3-14)"
- Same README's `generators/techpartsNetwork.ts` table row replaces "Ports 80 (Apache/2.4.49) + 443 open" with a version-agnostic description ("Ports 80 (procedural Apache via timeline) + 443 (nginx, decorative) open")
- `package.json` version: `0.130.0` → `0.131.0`
- `package-lock.json` synced via `npm install --package-lock-only` per `MEMORY.md` user preference
- `npm run format` run on `src/themedNetworks/README.md` per `CLAUDE.md` "Verification After Changes" rule

**RED**: No test — pure documentation + metadata change. The acceptance check is a manual grep:

- `grep -n "Apache/2.4.49" src/themedNetworks/` returns no hits (techparts.io scope only — leave general fixtures in other tests alone)
- `grep -n "CVE-eligible on port 80" src/themedNetworks/README.md` returns no hits

**GREEN**: Edit the README table rows. Run `npm version 0.131.0 --no-git-tag-version` (or hand-edit + `npm install --package-lock-only`).

**MUTATE / KILL MUTANTS**: N/A (no logic changed).

**REFACTOR**: Skim the README rendered output (in-editor preview or `npm run format` then visual check) — table alignment intact.

**Done when**: README diffs look right, version bumped in both files, format pass clean.

## Smoke Verification Path

After Step 2 lands locally (before commit):

```bash
# Day 0 — no CVE
npx tsx scripts/simulateExploit.ts mission techparts 198.51.100.80 80 --gameTime 0
# Expect: "no known vulnerability" or equivalent inert output

# Day 30 — CVE active
npx tsx scripts/simulateExploit.ts mission techparts 198.51.100.80 80 --gameTime 30
# Expect: CVE id (CVE-2026-XXXXXXX format), effect.kind = shell_full, effect.tier = user
```

`scripts/simulateExploit.ts` uses the world-network generation path the same way the browser does (see `scripts/README.md`), so a green smoke here matches in-game behaviour.

Two-browser cross-player smoke is not required — no cross-player surface changes (no /etc/passwd projection delta, no new dual-write paths, no new effects). The procedural CVE is computed identically across all players.

## Memory Updates (post-merge)

Update the MEMORY.md "Active theme (2026-05-12)" entry:

- Drop: "CVE-2024-9001 (day-0 exploitable, www-data owner stamped)"
- Add: "Time-gated procedural CVE on port 80 (Apache picked from Layer-2 walker, constrained to shell_full at user tier only — damage ceiling = /var/www/html defacement, no root brick path; first CVE drops day ~3-14 per walker default cadence)"

No new memory entries needed — the existing `project_themed_network_cve_port_owner` rule still applies (owner stamping is load-bearing; picker just derives the tier dynamically).

## Pre-PR Quality Gate

Before opening the PR:

1. Mutation testing — run on `pickApacheCveVersion` + the generator port-80 construction site
2. Refactoring assessment — `refactoring` skill on the new helper + ownerFor split
3. `npm run build`, `npm run lint`, `npm run test:run`, `npm run format` all green
4. Smoke commands above produce expected output at gameTime=0 and gameTime=30
5. No DDD glossary check needed (project doesn't use DDD terms in this surface)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
