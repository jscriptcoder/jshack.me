# Plan: World Content Slices 0–1 — A Workstation Reads as Somebody's

**Epic:** `plans/world-content-epic.md` — slices 0 and 1. Grill record: the epic's "Locked
decisions" 1–25 (grilled 2026-09-21). **Decision 19 is amended by this plan** (see "Amended at
planning" below and in the epic) — measurement found its premise did not hold.

**Status:** Active — planned 2026-09-21. PR0 merged 2026-09-21 (#533). PR1 next.

**Delivery:** Two independent PRs, sequenced to trunk (NOT a stack), the convention every parity
slice used. PR1 branches from `main` after PR0 merges, because PR1 is the first PR that grows
content and PR0's guards exist to measure exactly that growth.
- **PR0** — no version bump (no player-visible change; precedent: parity D4 slice 0, #407).
- **PR1** — **v0.248.0**, bumped in both `v2/package.json` and `v2/package-lock.json`
  (`npm install --package-lock-only`).

**Branches (proposed):** PR0 `chore/world-content-budgets`, PR1 `feat/a-workstation-reads-as-somebodys`.

---

## Goal

A player who cracks their way into an NPC desktop or laptop finds a home that belongs to a person:
a history of what they did — including machines on this network that really answer — a git
identity with their name, and notes that sound like where they work or live. Before that content
arrives, the build guards that keep a growing world cheap are in place.

## Scope boundary

**In:** the two build guards (PR0); the network persona and the box inhabitant; home content for
NPC boxes whose hostname prefix is `desktop`, `laptop` or `workstation`, on every layer; the first
true-reference and variety property tests (PR1).

**Not built here, deliberately** (each has its own slice in the epic):
- `/etc` breadth, `/root`, `/home/guest`, `.ssh/` → slice 2.
- Rotated log history → slice 3. Web → 4. DB/Redis → 5/6. Mail → 7. `/srv` and metadata docs → 8.
- IoT overlays and prefix growth → 9. Gateways → 10.
- **Phones and tablets** (`android`, `iphone`, `tablet` — also the workstation role) → slice 11.
  Their homes stay EMPTY until then rather than carrying dotfiles a phone would never have.
- Player workstations: never (decision 6).

## Inherited locked decisions

| # | What it fixes for these slices |
|---|---|
| 2 | Nothing in a home pairs an in-game account with a working secret. A history may name a neighbour's USERNAME (`ssh mrodriguez@…`), never a password. |
| 3 | No new verbs. A history may show commands the game has no binary for (`git`, `vim`, `python3`) — that is content about a person, not a verb offered to the player. |
| 4 | Every host, IP, `.lan` name, port and path a home names is true. See "What 'true' means for a history" below. |
| 5 / 22 | Dates inside content fall inside the box's life, ending at `WORLD_EPOCH` (2026-07-12). A default bash history carries no timestamps, so only notes carry dates here. |
| 6 | NPC boxes only. `buildWorkstationBaseFsFromIdentity` is untouched. |
| 7 | Keyed by role + prefix overlay: this slice IS the `desktop|laptop|workstation` overlay of the workstation role. |
| 8 | Network persona (ESSID category) + box inhabitant (from the username). |
| 13 | Home files are user-tier; `HOME_DIR` already keeps guest out. |
| 14 | One account per box; `/etc/passwd` stays three rows. |
| 15 | Every new concern draws from a NEW stream. `host-fs-` gains no draw, so every pinned password stays pinned. |
| 16 | Pools authored fresh, static data. |
| 17 | The variety test starts here. |
| 18 | The bundle budget lands in PR0. |
| 20 | The inhabitant's email is `<username>@<lanZoneName(essid)>`. |

## Amended at planning (2026-09-21) — decision 19

Decision 19 said: memoize the base tree first, then add volume, because the tree is rebuilt on
every call with no memoization. **Measured at planning** (`tsx`, all 50 catalog networks, every
LAN host): **~0.13 ms per box to build, ~0.18 ms per `generatedBaseFsForMachineId` lookup** —
415 boxes, 21,249 files, ~55 ms total. A server `nmap` builds at most ~12 trees per request, so
today's whole-LAN cost is ~2 ms. Memoization would add a cache (a key scheme, a bound, a
per-serverless-instance lifetime, and a correctness argument that no caller mutates a shared tree)
to save time nobody can observe.

**Amended decision 19:** land the **build-time budget** first, and **memoize only when the budget
is breached**. The budget, not a cache, is what protects every rebuild site as content grows; if a
later slice breaks it, that slice adds memoization with a measured reason. The trees ARE safe to
share if that day comes (`applyPatches` copies every map it touches — `new Map(dir.entries).set`),
so the option stays cheap.

---

## What "true" means for a history (decision 4, made concrete)

- **The segment a box sees.** A LAN NPC's neighbours are the generated population of its ESSID
  (`generateHomeLan(essid).hosts` minus itself), gateways included. A DEEP NPC's neighbour set is
  **empty in this slice**: its layer's child gateway exists only when the layer `hangsChild`, and
  the deep NPC's tree must stay byte-stable either way (`deepHostBaseFsForMachineId` relies on
  that). So a deep desktop's history has no network lines yet. Whether a box is a LAN host is
  decided by membership in `generateHomeLan(essid).hosts`, inside the builder — no call site
  changes, and `buildDeepHostFs` needs nothing new.
- **Learning about a neighbour never builds its tree.** Box A's content needs B's username and
  services; building B's tree would build B's content, which reads A — unbounded recursion, and
  ~8× the cost. So neighbour facts come from the pure sub-derivations the builder already uses:
  services via `hostServices(essid, host)`, and the username via an extracted
  `npcUsername(essid, host)` — the FIRST draw of `host-fs-<essid>-<ip>` with `pickUsername`, which
  `buildRemoteHostFs` keeps drawing from its own stream in the same position so nothing re-rolls.
- **What each command may name:**
  - `ssh <user>@<target>` — only a neighbour whose services include `ssh`, as that neighbour's
    real uid-1000 username. A non-22 sshd port is spelled `-p <port>`.
  - `curl http://<target>/` — only a neighbour serving `http` (on its real port).
  - `ping <target>` and `nslookup <name>` — any neighbour.
  - **A network line is spelled the way v2's own command accepts it** (`ssh [-p port] user@host`,
    `curl <url>`, `ping <host>`, `nslookup <name>`), so a player can replay it verbatim — which is
    the acceptance run. Real `ping -c 3` would be refused by v2's `ping <host>` and read as a lie.
  - `<target>` is an IP, a bare hostname or `<hostname>.<essid-slug>.lan`. **Gateways are named
    by IP only**: two routers on one LAN can share a hostname (conventions §1, X1), so a router's
    name is not a unique reference.
  - Any `~/…` or absolute path a history line names exists on that box. Slice 1 creates
    `~/notes/…` and the dotfiles; `/etc/passwd`, `/var/log/auth.log` and `/tmp` already exist.
    A path the history itself `rm`s is exempt.
- **Things outside the game are fiction** — `github.com`, `pypi.org`, an `apt`-mirror host — and
  exempt (decision 4).

---

## Slices

**Required implementation skills:** PR0 — `testing` (a script with pass/fail output, not new
behaviour). PR1 — `tdd`, `testing` and `functional` throughout; `refactoring` for the ESSID-catalog
restructure; `mutation-testing` at PR readiness.

---

### PR0 — The world stays cheap to build and to ship

**Value**: Every later content slice is measured against two numbers — how long a box takes to
build and how many bytes the game ships — so "big pools" can never quietly make the game slower
or heavier. Maintenance value only; no player-visible change.
**Path**: `npm run build` → `postbuild` → `scripts/checkBudgets.ts` → gzip size of the main
chunk in `dist/assets/` + timed builds of every generated box on the 50 catalog networks → exit 0
or exit 1 with the number that broke.
**Class**: Operational / configuration change — the evidence is the script's own output, not a
behaviour test (none exists to write RED against).
**Delivery**: Independent PR against trunk.
**Decisions**: 18, amended 19.

**Acceptance criteria**
- [x] `npm run build` in `v2/` runs the budget check automatically (`postbuild`) and prints both
      measurements with their ceilings. **Corrected after merge:** it runs on local builds only.
      The Vercel project builds the frozen root app, so no deploy runs it (seen in #533's preview
      log, which showed `jshack-me@0.139.0`).
- [x] **Bundle:** the check fails when the gzipped main chunk exceeds **284,975 bytes** — the
      baseline re-measured at PR0 (134,975, default gzip level; the planning figure of 134,282
      had moved) plus decision 18's 150,000 allowance.
- [x] **Build time:** building every box of the 50 catalog networks — the AP gateway directly,
      then LAN hosts, chain gateways and deep NPCs through `generatedBaseFsForMachineId` (615
      boxes) — averages **≤ 2 ms per box** after one warm-up pass (measured 0.146 ms). Fails
      with the measured average; a lookup that resolves nothing throws rather than timing fast.
- [x] Shown to fail: a temporary **3 ms** busy-loop in `buildRemoteHostFs` (2.267 ms/box, exit 1)
      and a bundle ceiling lowered to 100,000 (exit 1) each turn the check red; both reverted.
      The planned 1 ms loop did NOT fail it — it slows only NPC trees, not gateways, so the
      average reached 0.959 ms: the ceiling catches a ~10× regression, not a +1 ms one.
- [x] `conventions-and-gotchas.md` §3 names the check as a gate and says what to do when it
      fails (memoize with a measured reason — amended decision 19; or trim pools — decision 18).

**Why a script and not a vitest test:** Stryker runs the WHOLE vitest suite under
instrumentation (`stryker.config.json` has no test filter), several times slower, and its initial
dry run aborts on any failing test — a wall-clock assertion in the suite would break mutation runs
for reasons unrelated to the code under mutation.
**Mutation**: `N/A` — a build script, outside `mutate: src/core/**`. Alternate evidence: the two
induced failures above.
**Wire-check**: `N/A` — no `api/` change.
**PR-ready when**: criteria met; typecheck, lint, `test:run` and `build` green; commit approved.

---

### PR1 — A workstation reads as somebody's

**Value**: A player who gets a user-tier shell on an NPC desktop, laptop or workstation — on any
network, at any depth — finds a home with a history, a git identity and notes that fit the person
and the place, and following a machine the history names reaches a machine that answers.
**Path**: `hydra <host> ssh` → `ssh <user>@<host>` → `ls -a ~` / `cat ~/.bash_history` →
`buildRemoteHostFs` (client `activeRoot`, server session handlers — the same pure builder) →
`networkPersona(essid)` + `inhabitant(essid, host, username)` → home content → `ssh`/`curl`/`ping`
the named neighbour → it answers.
**Class**: Behavior change.
**Delivery**: Independent PR against trunk, after PR0.
**Decisions**: 2, 3, 4, 5, 7, 8, 13, 15, 16, 17, 20, 22.

**Acceptance criteria**
- [ ] **A home, not a directory.** An NPC box whose prefix is `desktop`, `laptop` or
      `workstation` has, under `/home/<user>/`, owned by that user and at user tier: `.bashrc`,
      `.profile`, `.bash_logout`, `.bash_history`, `.gitconfig`, and a `notes/` directory holding
      2–5 notes. `android`/`iphone`/`tablet` homes and every other role's home are still empty.
- [ ] **Guest sees none of it.** `ls /home/<user>` as `guest` is refused exactly as today.
- [ ] **The inhabitant is one person.** `.gitconfig` names the inhabitant — a full name consistent
      with the username (`mrodriguez` → a first name starting with M, surname Rodriguez; a role
      name like `developer` or `admin` gets a drawn full name) — and an email
      `<username>@<essid-slug>.lan`. The same name signs every note that carries a signature.
- [ ] **The place shows.** On a corporate-parody network the notes read as work at that
      organisation (its name, derived from the ESSID, appears); on a café network as a café; on
      residential, university, public, IoT-default and hacker-scene networks, as those places. An
      ESSID outside the catalog gets a seeded category — it still has a persona.
- [ ] **Every reference is true** (property test over all 50 catalog networks plus a spread of
      non-catalog ESSIDs, every qualifying box): each IP, hostname and `.lan` name in a home file
      resolves on that network (`resolveLanName` / the generated population); each `ssh` target
      runs `ssh` on the port the line uses and has the account the line names; each `curl` target
      serves `http`; each path named exists on the box. Gateways appear by IP only.
- [ ] **A deep desktop has a home and names nothing.** A deep-layer NPC with a qualifying prefix
      gets the same home, with no network references, and its tree is byte-identical whether or
      not its layer hangs a child.
- [ ] **Variety.** Within any one network, no two qualifying boxes share a byte-identical
      `.bash_history`, `.gitconfig` or note. Across the 50 catalog networks, ≥ 98% of
      `.bash_history` bodies and ≥ 90% of note bodies are distinct. (`.profile` and
      `.bash_logout` are stock Debian skeleton — identical everywhere, as on real boxes — and
      are exempt.)
- [ ] **Nothing already seeded moves.** Every existing hash-for-hash pin (passwords, services,
      pages, configs, DB, Redis, zones) passes unchanged; `crackableEssidPool` keeps its exact
      order, so every ESSID a scan offers is unchanged.
- [ ] **Deterministic both ends.** Two builds of one box are byte-identical; content comes only
      from new streams (`network-persona-<essid>`, `inhabitant-<essid>-<ip>`,
      `home-content-<essid>-<ip>`).
- [ ] **No version, no secret, one calendar.** No home file carries a software version; none pairs
      an in-game account with a password; every date in a note is ≤ 2026-07-12 and within the
      box's life.
- [ ] **Played, not just tested** (browser, `v2-e2e`): crack and `ssh` into an NPC desktop on a
      real network, `cat ~/.bash_history`, pick a neighbour it names, and reach it with the same
      command the history used.
- [ ] PR0's budgets still pass.

**RED**: build an NPC desktop's tree on a catalog network and assert `/home/<user>/.bash_history`
exists and names at least one neighbour that `generateHomeLan(essid)` contains; fails today
because the home is `dir({}, HOME_DIR, username)`.
**GREEN**, increment by increment (each its own RED first):
1. `ESSID_CATALOG` — the seven categories as data; `crackableEssidPool` derived from it in the
   CURRENT order (refactor, preservation evidence: existing `generateWifi` tests + an order
   assertion).
2. `networkPersona(essid)` — category (catalog, else seeded), organisation name, `lanZoneName`.
3. `inhabitant(…)` — full name from the username, email.
4. `npcUsername(essid, host)` extracted; `buildRemoteHostFs` still takes the same first draw.
5. Skeleton dotfiles + `.gitconfig`.
6. Notes per category.
7. `.bash_history` with neighbour references; the true-reference property test.
8. The variety test; widen pools until it passes.
Add a `HOME_FILE` permission constant beside `HOME_DIR` (read/write root + user).
**REFACTOR**: assess whether `buildRemoteHostFs` should delegate the whole `home` subtree to one
function, and whether persona code wants its own `generation/persona/` directory — only if it
reads better; no speculative per-category module split.
**Pool sizing** (decision 16, targets the variety test will hold to): ≥ 150 history-line
templates across personal, work-by-category and network kinds; ≥ 12 note templates per category
(≥ 84 total) with slots from both personas; a first-name pool large enough that every initial in
the workstation username pool has ≥ 5 names.
**PRE-PR MUTATION**: once, over the new persona and home-content modules plus the touched part of
`remoteHostFs.ts`, via the repo's throwaway-config recipe with the **json reporter** (a timeout
counts as killed — conventions §4). Expect survivors in pool DATA (untested table rows are the
recurring shape); kill the ones in selection logic, not in text.
**Wire-check**: `N/A` — no `api/` change. The server reaches this content through the same pure
builder the unit tests drive; the browser run above covers the client.
**PR-ready when**: all criteria met; typecheck, lint, `test:run`, `build` (with PR0's budgets)
green; the browser run recorded; version bumped; commit approved.

---

## Pre-PR quality gate (both PRs)

1. Implementation complete; refactoring assessed.
2. Mutation or its recorded `N/A` + alternate evidence.
3. `npm run typecheck` and `npm run lint` (from `v2/`).
4. `npm run test:run` — full, non-watch (~198 files / ~4200 tests is the v2 tell; the root app's
   counts mean the shell is in the wrong directory).
5. `npm run build`, which now runs the budgets.
6. PR1 only: the browser run.

---
*Retire into `plans/world-content-epic.md` on close-out (as-built into the epic's slice table and
status log) and delete this file, as every parity slice plan was.*
