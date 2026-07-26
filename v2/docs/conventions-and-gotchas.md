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
  ports). **Octet reservation**: `mergeLanOccupants` reserves the inner gateway/switch
  octets — a same-LAN occupant that collides with one is omitted from that viewer's `nmap`
  (your private depth entry outranks one occupant's visibility; the occupant stays
  attackable via its public IP). Depth is **single-player / per-player NPC**; cross-player /
  ESSID-shared depth + a fixed-IP mission catalog remain deferred (epic doc). Pivot
  **source-IP masking** is still deferred — see `plans/multiplayer-crossplayer-epic.md`.

- **Unique public-IP allocation ✅ COMPLETE (v0.87.0).** A network's WAN address is now
  **server-issued and stored**, not derived: `network_public_ips(essid PK, public_ip UNIQUE)`
  plus a server-only `allocatePublicIp(essid, deps)` (lazy allocate on an ESSID's first join →
  draw via `generatePublicIp` → `INSERT … ON CONFLICT (essid) DO NOTHING` to win-or-read →
  redraw on a `public_ip` 23505; permanent, no GC), wired into `registerNetwork` in place of the
  old `home-public-${essid}` PRNG derivation (which could birthday-collide across ESSIDs).
  `assignHomeNetwork` returns `{localIp, hostname}` only — **no client-side public IP remains**.
  Wire-check: `scripts/testPublicIpAllocation.ts`.

**Current version: 0.87.0.**

To pick up the next slice: read the relevant `plans/*.md` TOP BLOCK (live status +
as-built), then the cross-player architecture doc if the work touches cross-player paths.

**Next up — shared-network reconciliation** (epic doc item #5, grilled & resolved 2026-07-25,
no open questions): the ESSID becomes the seed for the whole LAN — one shared, contested AP
gateway per ESSID (the per-player router retires), an ESSID-seeded NPC population and depth,
DHCP-allocated occupant octets, and **`network_registry` deleted outright** (its content is
derivable or already in `network_public_ips` / `home_network_occupants`). **Note it retires the
"occupancy fallback" invariant in §7 below.** Sliced in
`plans/shared-network-reconciliation.md`: `tdd` governs the behaviour-changing slices;
`reduce-system-complexity` governs the registry-removal pair only. A follow-up item then makes
the ESSID space procedurally generated and large, and tunes the occupied-ESSID injector down.

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

**Do NOT run Stryker and the v2 dev server at the same time.** A concurrent `vercel:dev`
(vite/3100) makes Stryker report **false survivors** (verify by hand-mutating) and silently
reloads the live app mid-E2E (resetting `su` elevation). Stop one before the other.

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
  NOT reintroduce concurrent `runInput` — it races on a stale FS view.

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
- **Any cross-player by-`machine_id` resolver needs the occupancy fallback.** The
  `network_registry` PK is the ESSID-shared `public_ip` (last-writer-wins), so a shared-AP
  occupant can be evicted by a later joiner; resolvers fall back to `home_network_occupants`
  (PK `(essid, owner_key)`). See `project_v2_crossplayer_remote_command_availability` history
  / `cross-player-architecture.md`.
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

- **Story-7 reconciliation** — a **unique-public-IP allocation service** (v2's `public_ip`
  is ESSID-deterministic so shared-AP occupants collide under `network_registry`'s
  last-writer-wins; the by-`machine_id` resolvers survive it via the occupancy fallback, but
  the registry itself is unreconciled); DHCP host-octet collision-free allocation;
  shared-router-per-ESSID; ESSID-seeded shared NPCs; WiFi density; presence/TTL.
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
