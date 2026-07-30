# v2 — conventions, gotchas & project state

Durable working knowledge for the v2 rewrite, graduated out of author-local `~/.claude`
memory so it survives and is shared. Pairs with [`cross-player-architecture.md`](./cross-player-architecture.md)
(as-built system) and the live plans in `plans/`. When this doc and the code disagree, the
code wins — fix the doc.

---

## 1. Project arc & current status

**We are rewriting the game from scratch in Solid.js under `/v2`; the legacy React app at
the repo root is FROZEN.** Why: legacy was single-player-first React with multiplayer
retrofitted (repeated deep scars) + pervasive React stale-closure bugs. The rewrite is
**multiplayer-first / server-authoritative**, Solid signals, with a **framework-agnostic
`core/`**. Design intent: [`rewrite-blueprint/`](./rewrite-blueprint/).

Shipped so far (each milestone is in git history + its as-built doc/plan):

- **Generator epic** (Stories 0–1.5) ✅ — world generation from the Ed25519 identity.
- **Multiplayer / cross-player epic** (Stories 1–7) ✅ COMPLETE (v0.71.0). As-built:
  [`cross-player-architecture.md`](./cross-player-architecture.md) (**read first** for any
  cross-player work). Full live loop:
  `crack → connect → nmap <A pub IP> → ssh guest@<A.publicIp> → (read/create/edit/rm) →
  su root → rm /boot/vmlinuz → reboot`, after which A is **permanently bricked** (a `/boot`
  tombstone on the shared journal — `core/boot/bootFiles.ts` `canBoot`, journal-derived, no
  recovery) and **dark to everyone**. Stories 5 (cross-player home NAT), 6 (scan/connect/su
  traces), 7 (same-wifi shared-LAN occupancy) all shipped. Deferred tail →
  `plans/multiplayer-crossplayer-epic.md` §"Remaining work / deferred follow-ups".
- **Story 5b — multi-layer generated networks ✅ COMPLETE (v0.85.0).** A home has a deep
  gateway **chain** behind its inner gateway: `inner → L2 → L3 …` (`seedNetworkDepth` 1–3,
  a max), keyed by the fronting gateway's `machine_id`. Each chain door is reachable
  (`ssh user@<inner>:<fwd>`), scannable (upstream + pivot), and player-configurable (L2
  write to its `rules.v4`/`acl.conf`). Chains mix **routers and switches** (a switch is a
  chain leaf that forwards nothing but ACL-filters its own downstream via `acl.conf`).
  **Deep-layer traces** log source = the fronting gateway's `<deep subnet>.1`: a deep ssh
  reach appends an `auth.log` line on the landed box (`Accepted`/`Failed password … from
  <.1>`); a pivot `nmap` fires a fire-and-forget `nmapScanDeep` (on `/api/patches`) that
  appends `kern.log` per touched deep host through the shared `core/scan/deepScanHosts`
  resolver (client render + server trace can't drift; a switch vantage records post-ACL
  ports). ⚠️ Two claims here were **superseded by shared-network reconciliation** (below):
  the **octet reservation** in `mergeLanOccupants` is gone (Slice 4), and depth is no longer
  per-player — chains are **ESSID-shared** (Slice 5), so the "cross-player depth deferred"
  note no longer applies. A fixed-IP mission catalog is still deferred (epic doc), as is
  pivot **source-IP masking** — see `plans/multiplayer-crossplayer-epic.md`.

- **Unique public-IP allocation ✅ COMPLETE (v0.87.0).** A network's WAN address is now
  **server-issued and stored**, not derived: `network_public_ips(essid PK, public_ip UNIQUE)`
  plus a server-only `allocatePublicIp(essid, deps)` (lazy allocate on an ESSID's first join →
  draw via `generatePublicIp` → `INSERT … ON CONFLICT (essid) DO NOTHING` to win-or-read →
  redraw on a `public_ip` 23505; permanent, no GC), wired into `registerNetwork` in place of the
  old `home-public-${essid}` PRNG derivation (which could birthday-collide across ESSIDs).
  `assignHomeNetwork` returns `{localIp, hostname}` only — **no client-side public IP remains**.
  Wire-check: `scripts/testPublicIpAllocation.ts`.

- **Shared-network reconciliation 🔨 IN PROGRESS (sharing work DONE at v0.94.0; only the registry removal remains)** (epic doc item #5, grilled & resolved
  2026-07-25). The ESSID becomes the seed for the whole LAN. Merged so far:
  - **Slice 1 (v0.88.0)** — one shared, contested AP gateway per ESSID; the per-player router
    retires. `computeApGatewayId(essid)`, ESSID-seeded hostname + admin password.
  - **Slice 2 (v0.89.0)** — a bricked AP gateway is dark on every interface, not just the WAN.
  - **Slice 3a (v0.90.0)** — occupant LAN addresses are **leased**, not derived:
    `network_lan_leases(essid, owner_key PK, octet, UNIQUE (essid, octet))` +
    `core/network/allocateLanLease.ts` (read-first → offer the derived octet → redraw on a
    `(essid, octet)` 23505 → bounded exhaustion), allocated in `registerNetwork` before any
    write. The first candidate is the octet the old derivation issued, so existing occupants
    lease the address they already hold and nobody is relocated. Leases are **permanent and
    outlive occupancy** (no GC) — reconnecting returns you to your address. Wire-check:
    `scripts/testLanLeaseAllocation.ts` (includes a genuinely concurrent colliding join).
  - **Slice 3b-i (v0.91.0)** — every address the SERVER resolves comes from the lease.
    `core/network/lanAddress.ts` holds the split: the `/24` stays ESSID-derived (it belongs to
    the AP), the host octet is the lease. `resolveOccupants` / `authCreateSessionSameLan` /
    `nmapScan` take one `listLeasesByEssid` read behind the LAN-boundary gate;
    `resolvePublicScan` / `authCreateSessionPublic` take a single-row `readLease` and
    `buildWorkstationResolver` now TAKES `lanIp` rather than deriving it, so the NAT-forward
    gate and the same-LAN path can never disagree on where a box is. ⚠️ The public half was
    **superseded at v0.99.0** (below): those two now take the ESSID-wide `listLeasesByEssid`
    like their same-LAN siblings, and `buildWorkstationResolver` is gone.
  - **Slice 3b-ii (v0.92.0, `879dcc4`)** — the player's OWN address is the leased one, and the client
    stops deriving addresses entirely. `registerNetwork` RETURNS the leased `local_ip`, so
    the join is what issues an address; `generateHomeLan` no longer places the player at all
    (it emits NPC filler only, still holding the derived octet vacant because the allocator
    offers that octet first), and the own view appends the player at the address `wlan0`
    holds via `withSelfHost`. **Offline posture**: `lanLeaseCache` remembers the issued
    address per ESSID — written by `persistConnection` (the ONE writer, so every path that
    addresses `wlan0` is covered), read by `restoreConnection` and by `joinHomeNetwork`'s
    fallback. A reconnect to an already-leased network works with the server down; a FIRST
    join to a new ESSID with the server unreachable now FAILS (`nmcli` reports it, `wlan0`
    stays clear) rather than silently addressing the player. `env.homeNetwork.join` returns
    `HomeNetworkAssignment | null` and both unwired fallbacks return null — nothing in the
    client allocates an address any more.
  - **Slice 4 (v0.93.0, `6733821`)** — every occupant of an ESSID sees the SAME LAN. `generateHomeLan`
    takes only the ESSID (no identity at all) and reads `lanSubnetPrefix` directly, so one
    population stands on the AP's `/24` for everybody. The L1 gateway devices moved with it:
    `computeInnerGatewayId` / `buildInnerGatewayBaseFs` / `buildSwitchBaseFs` /
    `seedInnerGatewayHostname` / `seedInnerGatewayAdminPw` are now keyed `(essid, octet)`, so
    two occupants reach ONE inner gateway with one journal and one root password. So are the
    NPC boxes themselves — `buildRemoteHostFs` / `hostServices` / `buildDeepHostFs` are keyed
    `(essid, ip)`: sharing a `machine_id` is not enough, because the journal replays over the
    base tree, and a per-viewer tree meant one occupant's write landed on a machine the other
    did not have. This closes the `hostMachineId` **aliasing bug** (two occupants' same-octet
    NPCs collided onto one id from a 6-name pool roughly 1 in 6 draws, quietly sharing a
    journal between boxes that were not the same box). Two rules died with it: the
    **gateway-octet reservation** in `mergeLanOccupants` (an occupant is never hidden now —
    the occupant wins over any generated host, whatever kind) and the **reserved-octet
    vacancy** in the generator. Both were only ever workarounds for a population no allocator
    could see; `allocateLanLease` now takes the ESSID's NPC octets as an **exclusion set**
    covering the preferred octet AND every redraw, with `drawLanOctet` drawing from the
    allowed pool so an exclusion never costs an attempt. Exclusion governs what may be
    ISSUED, not what is held: an existing lease is returned untouched.
  - **Slice 5 (v0.94.0, `2f79349`)** — the deep chain is shared too, so an ESSID's whole world is one
    world. `seedNetworkDepth(essid)`, `generateDeepLayer(essid, fronting, options)`,
    `computeDeepGatewayId(parent, octet)`, `seedDeepGatewayAdminPw(parent, octet)` and the deep
    base filesystems all dropped the owner key; **no generator in `core/` takes an identity any
    more**. Nothing gained an ESSID parameter it lacked — the parent id is ESSID-derived up to
    the inner gateway, so the chain inherits network separation rather than restating it, and
    `parentMachineId + octet` remains the whole anti-aliasing discriminator. Two names went with
    the concept: `ownLanBaseFsForMachineId` → `lanBaseFsForMachineId`, and
    `ownChainBaseFsForMachineId` → **`generatedBaseFsForMachineId`** — that one is the
    cross-player discriminator, and what it separates is now boxes the NETWORK generates from
    the only machine that genuinely belongs to a person, another player's workstation.
    `enforceRemoteWriteL2` lost its `publicKey` (identity is L1's question), which moved the
    shared-write evidence up to `handleUpsertPatch` where a verified signer still exists.
  - **Slices 6a + 6b** — the registry table is **gone**. 6a re-homed every cross-player lookup
    onto `network_public_ips` + `home_network_occupants` and fixed the bug that fell out of it
    (a machine that had left the WiFi stayed readable AND writable); 6b dropped the table, its
    index, and its write, swapping the reverse-lookup index onto `home_network_occupants`.
    `reduce-system-complexity` governed the pair, `tdd` the behaviour-changing slices before
    them. A follow-up item then makes the ESSID space procedurally generated and large, and
    tunes the occupied-ESSID injector down.

- **Every occupant of a shared AP is forward-reachable ✅ (v0.99.0).** The last piece of item #5's
  decision 1 ("the gateway's ports are its own `sshd` ∪ EVERY occupant's forwards"), deliberately
  left out of the registry reduction so that stayed behaviour-preserving. `ApNetworkLookup` is now
  just `{ router_machine_id, essid }` — the AP itself — and both public paths
  (`resolvePublicScan`, `authCreateSessionPublic`) resolve a forward's `internalIp` by matching it
  against `lanAddressesByOwner(essid, leases)` over the ESSID's current occupants. The shared pure
  half moved to `core/network/natHosts.ts` (`bootableOccupantFs` + `natPortResolver`), replacing
  the single-host `workstationPortResolver`. Two forced consequences: the ownerless gateway's own
  `kern.log`/`auth.log` rows now key on a STABLE writer (`core/logging/apGatewayLogWriter.ts` —
  the lowest octet leased on the ESSID) instead of the most recent joiner, which was silently
  truncating those logs every time somebody joined; and a forwarded-port login now logs under the
  key of the box it actually reached.

- **An editor save never destroys unseen content ✅ (v0.101.0 server, v0.102.0 confirm).** Closes
  the write-wipe found by the v0.99.0 Act 4 run. `PatchApi.write` takes the content the caller was
  SHOWN; the adapter fingerprints it (`core/patches/contentHash.ts`, shared by both ends so they
  cannot drift) and sends `base_hash`. `handleUpsertPatch` compares it against
  `orderPatchesForReplay(rows for that path).at(-1)` — the row a READER materializes, `writer_key`
  tiebreak included, or the guard would reject saves that raced nothing — and answers `409
  modified_since_open`. Three placement decisions are load-bearing: the check runs **after** the
  L1/L2 gates (a caller who may not write the path must not learn somebody is editing it); the dep
  is **path-scoped**, not the machine-wide L2 list, because own-box writes bypass L2 entirely and
  the list is not already on that path; and an **absent** fingerprint is an unconditional write, so
  `>`/`touch`/`apt`/sshd are exempt by construction rather than by a special case. Nano turns the
  409 into GNU nano's own `(y/n)` question, takes the textarea read-only while it stands, and `y`
  re-sends with **no** fingerprint. A landed save advances the base to what it wrote (`^O` keeps
  the editor open); a refused one leaves it alone. Wire-check `scripts/testModifiedSinceOpen.ts`;
  three-player browser verification in `e2e-shared-network-verification.md` §6.

**Current version: 0.102.0.**

**Next epic — legacy parity, NOT STARTED:** `plans/legacy-parity-epic.md` — every remaining
way into a machine (doors → discovery → CVE vulnerabilities), grilled to nine locked
decisions. The ship gate is legacy parity **minus missions**; missions are a post-ship epic.

To pick up the next slice: read the relevant `plans/*.md` TOP BLOCK (live status +
as-built), then the cross-player architecture doc if the work touches cross-player paths.

---

## 2. Working conventions (process + code)

(TDD, functional style, strict TypeScript, and the skill routing live in the root
`.claude/CLAUDE.md` — these are the project-specific additions.)

- **No backward-compat burden — until launch.** No live players, so freely rename / reshape
  / break schema, generators, IDs. **This rule SUNSETS at multiplayer announce** — after
  launch, schema/patches/CVEs/generators need migration discipline.
- **Ship-first on multiplayer security.** L1 (active-session gate) + targeted L3
  (gameTime / wallet / hop-chain) is enough to launch. Don't gold-plate L2 or a full
  smart-server. Scope creep kills indie multiplayer faster than security holes.
- **Shared world-state mutation is fine, not a tradeoff.** Defacement / bricking of shared
  networks is gameplay-renewable; don't gold-plate isolation/protection in shared-world
  systems.
- **No single-letter variable names.** Name lambda/predicate/reducer params after what they
  represent (`candidate`, `port`, `vuln`, `machine`), never `c`/`p`/`v`/`m`. Classic loop
  indices `i`/`j`/`k` are fine.
- **No Story/Slice/decision-number tags in code or test comments** (nor in `describe`/`it`
  titles). "Story 7.3" / "(D9)" / "slice 7.2a" rot into dangling refs once plans are
  deleted — state the WHY directly. When editing, clean only the refs in *your* change.
- **Don't reference `plans/` or memory files from committed code.** Plans are deleted on
  completion; memory is author-local. Inline the WHY in comments; for longer-form context
  that must survive, link an in-repo `v2/docs/` doc (those code-comment links are allowed).
- **Bump the version on feature changes**, in BOTH `v2/package.json` and
  `v2/package-lock.json` (the latter via `npm install --package-lock-only`). The ASCII
  banner reads the version from `package.json` via Vite's `define`.
- **Command `flags` keys are dashed** — `'-p'`, never bare `p`. Hand-built flag-Map tests
  bypass `bindFlags` and hide the drift.
- **v2 command ports must match the legacy CLI interface.** When porting a command, read the
  legacy `src/commands/` FIRST; preserve its flag set + behaviours + error shape. Don't add
  or drop flags without explicit user opt-in.
- **Consolidate small related helpers** into one `<topic>Helpers.ts` (and a matching test
  file), not file-per-helper.
- **Minimize API projections** — drop fields no client call site consumes, even
  safe-to-expose ones (e.g. public keys).
- **Grep all call sites when replacing a pattern.** A plan that says "fix X in function Y"
  surfaces ONE site; sibling functions usually need the same fix. Grep the pattern shape
  codebase-wide before scoping.
- **Real network latency over fake delays.** When real server round-trips replace fake
  `setTimeout` pacing, take them; don't stack fake on top of real.
- **A command that does slow work streams its progress.** If the work takes real time (a
  server round-trip) — or its real-world counterpart does — the command returns
  `kind: 'async'` and announces each step BEFORE doing it, so the announcement paints while
  the work is pending instead of narrating work already finished. A line ending in `...`
  means "happening now"; the arrival of the NEXT line is what reports it finished; the last
  step is reported by the prompt coming back. **No `Done` / completion marker on the
  in-flight line** — real `apt` gets away with `Reading package lists... Done` only because
  it rewrites the line it already printed, and a terminal that only appends can't. Pace the
  steps with `env.sleep` (abort-aware, so Ctrl-C unwinds mid-sequence). Build the result with
  `streamedResult` from `core/commands/streaming.ts`: it forwards an
  `AsyncGenerator<TerminalLine, number>` and captures the generator's RETURN as the exit code,
  which a bare `for await` would throw away. Where a gate sits decides its shape — a refusal
  that never reached the slow work (apt's root/offline checks) stays `kind: 'sync'` with no
  preamble, while a failure only discoverable AFTER the work started (an unknown package)
  lands beneath the announcements the player has already seen.
- **No `/etc/shadow`.** In-game passwords live inline in `/etc/passwd`. `/etc/shadow` does
  not exist in this game — don't reference it in design or code.
- **Prefer fire-and-forget server calls** alongside existing optimistic state setters over
  making a sync state method async (the `wrapWithRefetch` shape).

---

## 3. Build / test / type gates

- **Type gate = `npm run typecheck` (= `tsc -b`)**, run from `v2/`. It covers `src/`,
  `api/`, AND `scripts/`. A plain `tsc --noEmit` is a NO-OP (root tsconfig has `files: []`)
  — do not use it.
- **`api/*.ts` Vercel functions are NOT typechecked locally and ESLint doesn't flag broken
  imports there.** Only `vercel dev` / deploy catches their type errors, and DB-column /
  constraint correctness needs a **wire-check** (§6). Keep `api/` handlers thin; push logic
  into the typechecked `src/core/`.
- **Format/lint gate = `npm run lint`** (ESLint). **v2 has NO Prettier** — `npm run format`
  only exists at the legacy root and errors inside `v2/`.
- **v2 UI tests = jsdom + `@solidjs/testing-library`, NOT Browser Mode.** E2E =
  `agent-browser` vs `vercel dev` (port 3100).
- **E2E (Playwright/agent-browser) is reserved for browser-only behaviour** Vitest can't
  reach (keyboard/focus, the nano editor, full UI flows). Don't duplicate unit/integration
  coverage there.
- **E2E-test new primitives through the UI before calling them "done".** Unit tests prove
  layers in isolation; integration seams (effect → session → patch → L1 → DB) drift
  silently. Watch the network tab.
- **No metadata-existence tests** (`expect(cmd.name).toBe('foo')`). DO test metadata
  *preservation* through wrappers/HOFs and *consumption* by other commands (help/man).
- **A streamed (`kind: 'async'`) command is LAZY — `await command.execute(...)` performs
  NOTHING.** Its body doesn't start until something consumes the lines, so a test that
  executes and then asserts on `patches.write` calls sees an empty spy and passes or fails
  for the wrong reason. Drain the stream first. In the game every consumer already drains
  (the terminal renders each line as it arrives; a pipe or redirect collects them first), so
  this bites only in tests. The upside: pulling just the FIRST line leaves the command
  suspended mid-flight, which is how "the announcement is out before the work happens" is
  provable at all.
- **A `makeDeps(over)` helper must RETURN the mock that actually landed in `deps`.** The
  common shape — build default `vi.fn`s, then `{...defaults, ...over}` — returns the *default*
  mock even when `over` replaced it. A later `ctx.someDep.mockImplementation(...)` then
  retargets an orphan and the test passes vacuously. Resolve the override BEFORE building
  `deps` and return that value, or take the variation as a typed option on the helper.
- **A test that asserts an ABSENCE ("nothing was written / nobody was traced") is the easiest
  one to pass for the wrong reason.** Mutation testing is what catches it — a guard that
  survives deletion usually means the path was never reached. Before trusting such a test,
  prove the setup reaches the code by asserting the matching PRESENCE with the same inputs.

---

## 4. Mutation testing conventions

Provably-equivalent mutant classes — accept (don't chase) when they recur:

- **Type-narrowing defensive checks** — e.g. `raw === true` against a `string | true |
  undefined` Map value is unkillable.
- **Stryker static load-throw** — a mutant that throws at module load (`Map([undefined])`)
  makes the Vitest runner report "no tests ran" → Stryker counts SURVIVED. Verify the throw
  by hand, then accept as tooling-equivalent.
- **No-op type-re-narrowing `.filter(typeGuard)`** added only to satisfy types after a guard
  already guarantees the kind. Prefer reduce-append; else keep the imperative early-return
  loop.
- Plus per-slice equivalents documented in the relevant plan (e.g. discriminant-by-exclusion
  arms, a default value washed out downstream).

**An injected fake can hide the real collaborator completely.** The lease allocator's tests
inject `redrawOctet`, so `drawLanOctet`'s NPC-exclusion `.filter(...)` — the entire point of
the change — could be DELETED with the whole suite green. Mutation was the only thing that
found it. Whenever a dep is faked in every test of its consumer, the real implementation needs
its own direct test, or it is effectively unverified.

**Assert over the whole record when a field is drawn from a small pool.** "A different seed
re-rolls the credentials" compared ONE `root` hash out of a ten-word password pool, so it
failed roughly one ESSID pair in ten — a real flake dressed up as a regression. Comparing the
whole `/etc/passwd` makes the same claim with three independent draws behind it. Any golden
pinned to a single pick from a short pool has this problem.

**A test that mints a RANDOM identity and asserts against SEEDED world state is flaky by
construction.** `generateIdentity()` draws fresh keys every run, while the world (NPC accounts,
LAN octets, hostnames) is seeded from the ESSID. Wherever those two spaces can collide, the test
fails at a rate set by the smaller one:

- guest passwords come from an **8-word** pool, so two random identities share one about **1 run
  in 8** — which broke "Bob's password is refused on Alice's box": on a collision it was not a
  wrong password at all.
- a player's LAN octet is drawn from their pubkey while ~10 of 253 octets hold generated hosts,
  so **~1 run in 25** puts a real NPC at the "self" address — which broke `nmapScan`'s
  self-exclusion count (`hostsLogged: 1`, not 0).

Fix by **drawing again** — recurse until the candidate identity does not collide — so the
failure mode is gone by construction rather than merely rarer. That is different from the
small-pool remedy below, which widens the ASSERTION; here the nondeterminism is in the fixture.
Both instances above passed 8-10 consecutive isolated runs, so treat "it passes now" as no
evidence. Other files mint identities the same way (`resolvePublicScan`, `natHosts`,
`authCreateSessionSameLan`, `createSession`) and are latent until an assertion depends on the
draw; at least one further instance has been observed in a full-suite run without being
pinned to a file.

**A survivor masked by a LATER call is untested, not equivalent.** `withSelfHost`'s sort
survived because `mergeLanOccupants` re-sorts downstream — the mutant is invisible through
the consumer, but the module's own documented invariant (`HomeLan` = ascending octet order)
is real. Kill it with a direct test of that invariant rather than deleting the sort or
waving it through.

**A guard clause duplicated by an EARLIER guard also survives — and its test lies.** An added
`wlan0.ipv4 === null` check looked covered, but `env.network.isOnline()` had already rejected
that state, so the test passed via the wrong branch. Sibling of the vacuous-absence trap in
§5: construct the state that reaches ONLY the new guard (here: another interface addressed, so
the machine is online while `wlan0` is not).

**`stryker run --mutate <file>:<lines>` leaves STALE statuses in
`reports/stryker-incremental.json`** for the untouched mutants in that file — a range-scoped
run reported survivors that a full run had killed. After a scoped run, confirm any survivor by
hand-mutating the line and running the test file.

**Do NOT run Stryker and the v2 dev server at the same time.** A concurrent `vercel:dev`
(vite/3100) makes Stryker report **false survivors** (verify by hand-mutating) and silently
reloads the live app mid-E2E (resetting `su` elevation). Stop one before the other.

**Do not EDIT source while a Stryker run is in flight either** — same family as the rule
above. A run whose dry run overlapped an edit died with `There were failed tests in the
initial test run` naming a test that passes cleanly on its own. Treat a dry-run failure whose
test passes standalone as tooling noise from a moving tree, not a real regression: leave the
tree alone and re-run.

**"Unreachable in the product" is not the same as equivalent.** `deniedPortsFor`'s
`vantage.kind === 'switch'` survived because a router's tree carries no `acl.conf` in
practice, so always reading it changes nothing. But the discriminant is a real rule — a router
FORWARDS rather than filters — and a test can state it directly by handing a router vantage a
tree that does carry the file. Prefer stating the rule over arguing the input can't occur.

---

## 5. Operational gotchas

- **3100 `vercel dev` squatter (recurs).** Killing the `npm run vercel:dev` background task
  does NOT kill its child vite/function process → it orphans on 3100 (502) → a fresh
  `vercel:dev` sees "port in use" and silently falls back to **vite-only on 3101** (no API →
  wire-checks hang on 502). Before restarting, kill the squatter:
  ```powershell
  Get-NetTCPConnection -LocalPort 3100,3101 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }
  ```
  Then `npm run vercel:dev`, and confirm `/api/<fn>` returns non-502 (a 400 to an empty
  `{}` body = serving).
- **A same-arity signature change is INVISIBLE to `tsc`.** Re-keying
  `computeInnerGatewayId(ownerKey, octet)` to `(essid, octet)` still typechecks at every call
  site, because a key and an ESSID are both `string`. The compiler is a reliable sweep only for
  arity changes; for a same-arity re-key, grep every call site — otherwise the wrong argument
  silently computes a wrong id, and the failure surfaces as ~35 unrelated-looking test
  failures. The same trap sits in the `scripts/` wire-checks, which `tsc -b` does cover but
  cannot help with here.
- **Don't run Stryker and `npm run lint` / `vercel dev` at the same time.** The in-flight
  `.stryker-tmp/sandbox-*` is inside the lint root, so `npm run lint` reports hundreds of
  `@ts-nocheck` errors from generated code that vanish when the run finishes; the same sandbox
  churn can crash `vercel dev`'s functions (`exit code 3221225794` = Windows
  `STATUS_DLL_INIT_FAILED`). Both clear up on their own — re-check before believing either.
- **`vercel dev` injects cloud-scoped env vars at runtime.** If a local function sees cloud
  values despite `.env.development.local`, suspect Vercel's "Development" scope first — uncheck
  Development on local-only vars so `vercel dev` doesn't inject them.
- **Supabase local CLI uses `sb_publishable` / `sb_secret` keys**, not legacy
  anon/service_role JWTs. Function code reads them under the existing `SUPABASE_*_KEY` env
  names; `@supabase/supabase-js` accepts either format.
- **Prod shares the dev Supabase until launch** (legacy note — v2 has its own Supabase
  project). DB resets affect prod until a dedicated prod project is cut over at launch.
- **Windows case-only `git mv` clobbers import edits.** A case-only rename + same-change
  import edits can ship a PascalCase filename with lowercase imports; `tsc`/tests pass on
  Windows but break on Linux/Vercel. Grep-verify import casing after any case rename.
- **The terminal runs commands SERIALLY** (`runInput` → `commandChain` in `ui/state.ts`). Do
  NOT reintroduce concurrent `runInput` — it races on a stale FS view. Since the busy bar
  landed, the prompt input is UNMOUNTED for the whole of `executeLine`, so type-ahead is no
  longer reachable from the UI at all; `commandChain` stays as the guarantee for programmatic
  submissions (and for the microtask between submit and execute).
- **A command is still running after its last output line paints.** `executeLine` streams the
  final line, then awaits `exitCode()` — so a Terminal test that submits the next command
  straight after `findByText(<last line>)` now hits the busy bar instead of an input and fails
  with "unable to find role textbox". Await the prompt's RETURN as well (`awaitPrompt()` in
  `Terminal.test.tsx`), and await it AFTER the output line — called immediately after
  `runCommand` it resolves against the prompt the command has not taken over yet.
- **A wire-check clean-slate must clear PERMANENT tables, not just the per-session ones.**
  `network_lan_leases` and `network_public_ips` deliberately outlive occupancy, so a script
  that only deletes `home_network_occupants` leaves a lease holding an octet forever. Every
  re-run then either fails its `UNIQUE (essid, octet)` insert (silently — the scripts don't
  check insert errors) or forces the allocator to redraw, which moves an address the script
  hard-coded. Symptom: a script passes alone and fails in the full sweep, or passes once and
  fails on the second run. Delete the lease rows in BOTH setup and teardown.
- **A wire-check that seeds occupancy directly must seed the lease too.** A real join
  allocates the lease BEFORE writing the occupancy row, so occupancy-without-lease is a state
  the server never produces — and since 3b-i the handlers refuse it (`not_an_occupant`: you
  hold no address here). Scripts that join through the real endpoint should read the issued
  lease back rather than re-deriving an address.
- **`nmap` scan targets: `X.Y.Z.1-254`, not `X.Y.Z.0/24`.** CIDR is not a parsed target form —
  `parseScanTarget` returns not-ok, the handler quietly logs nothing, and a test asserting
  "nothing was traced" passes for the wrong reason. If a scan test asserts an ABSENCE, first
  prove the target parses by asserting a presence with the same string.

---

## 6. Wire-check infrastructure

`api/` runtime correctness (DB columns, constraints, the signed-envelope path) is not
caught by `tsc`, so each `api/` path has a `scripts/test*.ts` wire-check that drives the
real endpoints against `vercel dev` + local supabase.

- Prereqs: local supabase (`http://localhost:54321`) + `vercel dev` (port 3100) both up
  (see the 3100 gotcha above). "Serving" = an empty `{}` POST returns 400 (not 502/000).
- Run: `npx dotenv -e .env.development.local -- npx tsx scripts/<name>.ts` (from `v2/`).
  Exits 0 on all-pass.
- The script seeds the DB via the service-role client, drives the endpoints, asserts, and
  cleans up. Examples: `testDeepChainReach.ts`, `testDeepSwitchChain.ts`,
  `testSameLanConnect.ts`, `testRouterBrick.ts`.

Live browser E2E (agent-browser vs `vercel dev`) is covered by the project skill
**`v2-e2e`** (`.claude/skills/v2-e2e/SKILL.md`) — load it before writing any agent-browser
command. It holds the preflight, recipes for reaching a given in-game state (fresh player →
connected with nmap; a shell on the AP gateway; the two-identity cross-player loop), the
terminal/nano DOM quirks, and how to derive seeded secrets offline. Add a recipe whenever a
state costs you more than one wrong attempt.

---

## 7. Architecture invariants

- **The wire IS the threat surface.** The trust boundary is the Vercel function + Supabase
  RLS, never the client (Burp/ZAP/a custom client are all the same threat). Patch validation
  is zero-trust; identity is proven by a **signed Ed25519 envelope** on every request, and a
  client never claims its own identity (the server uses the verified pubkey). Defense layers:
  **L1** (caller holds an active session on the target), **L2** (the session's tier may
  write the path — the server regenerates the target FS and asks the shared walker), **L3**
  (server-side game-logic re-run — mostly deferred).
- **Framework-agnostic `core/`.** `core/` has zero framework imports; `CommandEnv` is the
  only seam; the FS walker is shared client + server. This is the rule the whole
  architecture exists for — keep `core/` pure and push framework/IO to the edges
  (`adapters/`, `api/`, `ui/`). Commands stay JS-callable (`execute(env, args, flags) →
  CommandResult`) for a future `node` command.
- **`workstation_id` MUST go through `computeWorkstationId`** — suffix =
  `sha256('ed25519:' + playerKeyHex)[0..8]`. The `ed25519:` prefix is load-bearing; a
  raw-playerKey derivation diverges and silently breaks auth/L1/L2. Routers/gateways have
  their own prefixed namespaces (`ed25519-router:` / `ed25519-inner-gw:` /
  `ed25519-deep-gw:`).
- **Two separate keypairs.** Identity (Ed25519) in browser localStorage, never auto-wiped
  (identity reset = an explicit "new game"). The wallet key lives in the in-game filesystem,
  lost on permadeath or theft — wallet defense is gameplay, not crypto.
- **Game time is a SERVER authority** (ADR D13). A signed event is stamped with the server's
  own UTC clock; there is no forgeable client `gameTime()`. Future CVE eligibility gates on
  game time, so it must be unforgeable.
- **Being on a WiFi is what makes a machine reachable — not whether a player is playing.**
  A box joined to an ESSID is running and attackable around the clock; closing the browser,
  logging out, or simply going away changes nothing. The ONLY thing that takes a machine off
  a network is an explicit in-game `nmcli disconnect` (or `reboot`, which disconnects on the
  way down), and a machine on no network is unreachable by every path — there is no "power
  off" mechanic to distinguish. This is why the defender role works: a player hardens their
  box (`rules.v4`, service state, `/etc/passwd`) and that hardening keeps standing while they
  are away, because the patch journal is never cleaned up on disconnect and the LAN lease is
  permanent. `home_network_occupants` is therefore the source of truth for reachability —
  its rows mean "on this WiFi", not "currently at the keyboard", and no identity or
  reachability lookup may gate on player presence.
- **`home_network_occupants` is the single source for "whose machine is this, and is it
  reachable".** Every cross-player by-`machine_id` resolver reads it and nothing else — there
  is no registry to consult first and no fallback to arbitrate. Its row means "this machine is
  on that WiFi", which is exactly the reachability test, so a machine with no row fails closed
  everywhere. **AP gateways are the one exception, and they need no lookup at all**: a gateway
  has no occupant (it belongs to the access point), its id is a pure function of the ESSID, and
  the only way to touch one is to hold a session on it — so it is resolved from
  `sessions.essid`, which also prevents reaching another network's gateway by claiming its id.
  Note `lanBaseFsForMachineId` deliberately skips octet `.1`, so the gateway always needs its
  own arm rather than falling out of the LAN walk. The table's PK is `(essid, owner_key)`,
  which cannot serve that reverse lookup — `home_network_occupants_workstation_machine_id_idx`
  exists for it and must survive any future reshaping of the table.
  See `cross-player-architecture.md`.
- **Known deferred gap (L3 smart-server):** a client with a valid keypair can mint an
  `effect_one_shot`/root session via `createSession` and call `exploitRead` directly,
  skipping the in-game CVE flow. Accepted per the security model; real fix = server-side
  game-logic re-run.

---

## 8. PR / git conventions

- **Squash-merge:** `gh pr merge <#> --squash --delete-branch`.
- **Conventional Commits** with scoped prefixes (`feat(v2):`, `fix(v2):`, `docs(v2):`,
  `test(v2):`). The `(#N)` suffix is appended automatically on squash.
- Commit messages end with the `Co-Authored-By` trailer; PR bodies end with the Claude Code
  generation trailer (see root `.claude/CLAUDE.md` harness rules).
- Cut a branch per slice off `main`; never commit straight to `main` for code.

---

## 9. Deferred backlog & future content ideas

Forward-looking direction not yet built (preserved as pointers; design when actually built).

**Story-5b / multiplayer deferred** (detail in `plans/multiplayer-crossplayer-epic.md`
§"Remaining work"):

- **Story-7 reconciliation** — DONE except WiFi density and presence/TTL, which stay deferred.
  Shipped v0.88.0 → v0.96.0: unique per-ESSID public-IP allocation, collision-free LAN leases,
  one shared AP gateway per ESSID, ESSID-seeded shared NPCs and deep chains, and the removal of
  the store whose last-writer-wins PK caused the collisions. As-built in §7 and
  `cross-player-architecture.md`; the plan file was deleted on close-out.
- **Wire-checks are not in CI** — all 27 run only by hand against a local `vercel dev` +
  supabase, and they are the ONLY thing that proves `api/` runtime correctness (`tsc` cannot
  see DB columns or constraints). A regression there ships green. Raised repeatedly and
  deliberately not taken on yet; it needs a CI supabase + a way to boot the functions
  headlessly, which is a piece of work in its own right rather than a config tweak.
- ~~**A NAT forward reaches only ONE occupant of a shared AP**~~ — **FIXED at v0.99.0.** The
  public paths no longer resolve "the box behind the NAT" at all: a forward's `internalIp` is
  matched against the ESSID's `network_lan_leases` + `home_network_occupants`, so it lands on
  whoever actually leases that address. Every occupant is forward-reachable, two forwards on one
  gateway reach two different boxes with two different credentials, and each is gated on its own
  target's liveness. As-built in `cross-player-architecture.md` §3; wire-check
  `scripts/testSharedApForwards.ts`.
- ~~**Saving a shared file deletes another occupant's edits**~~ — **FIXED at v0.101.0 (server
  refusal) + v0.102.0 (the y/n confirm).** An editor save carries a sha256 of the content it was
  SHOWN; the server compares it against the row a reader materializes and answers `409
  modified_since_open`, and nano asks GNU nano's own question rather than reporting an error.
  Last-writer-wins is preserved on purpose — a deliberate clobber is one keystroke, a blind one
  is impossible. An absent fingerprint means an unconditional write, so `>`, `touch`, `apt` and
  the sshd pidfile are exempt by construction. As-built in §1; repro, the fix and the three-player
  re-verification in `e2e-shared-network-verification.md` §6.
- **A shared-file view is still stale, deliberately.** The fix above stops the *destruction*, not
  the staleness: a session on a foreign machine still never learns of a foreign write, because
  the `patches-changed` channel remains workstation-scoped. So refusals are ROUTINE, not rare —
  a co-edited gateway will ask most times. Two cheaper-looking fixes were considered and left:
  a refetch when an editor OPENS a foreign file (narrow — does not help a concurrent save), and
  a machine-scoped invalidation channel (needs Supabase Realtime plus a publish-authorization
  model that does not exist). Revisit if the asking becomes annoying in play.
- **`echo x > rules.v4` is still an unguarded wipe vector.** A redirect carries no base
  fingerprint by design — it truncates by definition, and the player was never shown the
  content — so it overwrites a co-occupant's rules with no question asked. Deliberate by nature
  and arguably correct (that is what `>` means), but it is the one remaining way to destroy
  another occupant's edit without being told. Left open rather than fixed, because guarding it
  would mean `>` no longer means truncate.
- **Two journal fetches for the SAME machine can still land out of order.** Fixed at v0.98.0:
  `refetchPatches` drops a late answer for a machine the player has LEFT, so a hop no longer
  paints the box you came from over the box you are on. What the machine-scoped guard does not
  cover is two in-flight fetches for one machine — a cross-tab `patches-changed` hint racing a
  write's own reconciliation — where the older answer landing last leaves `patches()` one write
  behind until the next refetch. Own-box only (the sync channel is workstation-scoped) and
  self-healing, so it was left. The obvious fix — a monotonic "newest issued fetch wins"
  counter — is NOT a drop-in: it would also discard the reconciliation `wrapWithRefetch`
  awaits, breaking the documented promise that a command's write is visible to the next line it
  runs. Any fix has to keep that one.
- **OPEN DESIGN QUESTION: an established session is never re-validated against its route.**
  Reachability is decided once, at connect time; from then on `authorizeMachineAccess` only
  asks "does this player hold an active session on this machine?", never "does the path still
  exist?". The gateway's `canBoot` gate is consulted by scans but not by live sessions.
  Observed 2026-07-28 in the browser E2E: an OUTSIDER (joined to a different ESSID) entered an
  occupant's box through the AP's NAT forward, and an occupant then bricked that AP gateway.
  The outsider kept the shell, ran commands, watched the public IP go dark from the inside, and
  the session row closed with `end_reason = user_exit` — the brick never touched it. Same shape
  as `nmcli disconnect`, which removes occupancy (new reach fails) without tearing down a
  session already open on the departing box: topology changes govern NEW connections only.
  **This is a design decision, not merely a defect** — "you are already inside, the door closing
  behind you doesn't eject you" is defensible. But it costs the defender their most natural
  panic move: bricking your own router when you notice an intruder currently does nothing to
  them, and hands them a foothold nobody outside can scan or reach. If it is taken, the data
  needed is already persisted: `sessions.source_ip` outside the target's `/24` identifies a
  session that arrived through the NAT, and `parent_session_id` gives the hop chain for the
  deep-chain case. Three shapes: leave it; evict off-LAN-sourced sessions when the tombstone
  lands; or re-validate lazily on the next authorized action (preferred — server-authoritative,
  no fan-out or background job, and it matches how the public scan already asks `canBoot` at
  scan time rather than precomputing darkness). Decide the behaviour before writing RED.
- **Pivot / operate-from-a-hop** beyond what 5b shipped; ssh-from-a-pivot.
- **Replay/nonce store** — built then REVERTED (ship-first): narrow value in this threat
  model (TLS wire + player holds the key → just re-signs with a fresh nonce; only blocks
  byte-identical resubmit; idempotency + per-request authz carry the real guarantee). Keep
  `noopNonceStore` everywhere; revisit at multiplayer-hardening (design preserved in the
  epic).

**Game-design / content ideas** (same game; may carry to v2):

- **Library-CVE privilege escalation** — `/lib/*.so` libs as a privesc vector (library CVE
  → `msfconsole --local` → root). Build the binary/availability/library model so
  versions/CVEs bolt on without rework.
- **Player-driven service patching (defender role)** — root-tier `apt upgrade` mutates
  `Port.serviceVersion` → a CVE goes inert game-wide; a blue-team mechanic.
- **Wordlist progression** — hydra as progression: a weak default wordlist, harvest
  passwords to expand coverage.
- **Themed persistent networks** — `world_networks` infra + a findit.io directory;
  office/police/university/café as drop-in additions; handler+generator registries dispatch
  on `theme`. CVE-eligible themed ports need `Port.owner` stamped; pages must be well-formed
  HTML; CVE pickers constrain INITIAL state only (not post-`apt upgrade`).
- **Player-hosted websites** — apache2/nginx daemons shipped (legacy); remaining: mutable
  router NAT, findit.io registration/crawl.
- **Workstation daemon expansion** — when mysqld/redis land on workstations, extending
  cross-player hydra is ~10 LOC.
- **Multi-target NAT forwarding** — distribute public-port forwards across multiple
  outer-layer machines.
- **Mission template vs instance model** — catalog templates + per-acceptance instances;
  public IP is the instance key; instances permanent + shareable.

**Realism notes** — same-LAN scans log the LAN IP, cross-network log the public IP (the
same-LAN-IP leak is load-bearing for defender gameplay). `nmap <router.1>` from inside the
LAN shows a merged view real PREROUTING wouldn't — a known realism gap.
