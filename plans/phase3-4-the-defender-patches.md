# Plan: Phase 3 slice 4 — the defender patches

**Branch**: `feat/phase3-a-fix-is-visible` (4a), then `feat/phase3-the-defender-patches` (4b)
**Status**: Active
**Epic**: [`legacy-parity-epic.md`](./legacy-parity-epic.md) — Phase 3 slice 4. Decisions 1-35 are
locked; decisions 36-39 were settled at this planning session and are recorded in the epic. This
plan implements them and does not reopen them.
**Delivery**: TWO independent PRs against `main`, in order (decision 37). Behaviour change, TDD.
4b starts from merged trunk after 4a lands — not a stack.

## Goal

The loop closes. A player can see which of their own packages is exposed and when the fix lands,
install it, and watch an attacker's working exploit go inert — while inside the patch-delay window
they are told plainly that no fix exists yet.

## Decisions settled at this planning session

Continuing the epic's numbering. These four were open going in; everything else here is forced by
decisions 1-35 or is routine.

### 36. An off-timeline version resolves to its nearest known ancestor

The manifest is the version authority and it is root-writable, so a player can type a version the
world never published. Today that reads as clean everywhere — free immunity since slice 3, and
slices 3 and 4 were told to decide it rather than let it default.

The rule is total and has no carve-out: a version resolves to the newest timeline entry at or below
it; a version below the starting tuple, or one that is not a tuple at all, resolves to the starting
version. So `Version: 9.9.9` buys exactly what being fully patched buys and nothing more — lying
becomes **pointless** rather than punished — while `Version: banana` drops the box to birth
exposure. Decision 22's downgrade-pin is untouched, because the version an attacker pins to is a
real entry and resolves to itself.

The rejected alternatives were leaving it clean (one line in one file makes a box permanently
unexploitable and `apt upgrade` optional — the phase loses its pressure), and resolving every
unrecognised version to the starting tuple (harsher than honesty: typing a real future version
would backfire, which teaches the player that touching the file is dangerous rather than that it
is futile).

### 37. Slice 4 delivers as two PRs — a fix is visible, then the defender patches

4a ships the forward walk, the resolver and `apt list -u`: read-only, no writes, and the first time
a CVE appears on the player's OWN box rather than through a scan of somebody else's. 4b ships
`apt upgrade`, install through the same resolver, the manifest patch on install, and the live loop.

Each is independently valuable and deployable, and the pair mirrors slices 1 and 2 (a version is
visible, then a CVE is visible) for the same reason: a read surface is independently useful and
independently wrong-able. Slice 3 was one PR (decision 35) and this slice is larger than slice 3 —
two command surfaces, a rewritten derivation core, a write path and a wire-check rewrite.

Splitting at the walk instead was rejected: the walk alone renders nothing, which makes it a
horizontal slice with no observable.

### 38. The manifest's ten base-image packages become apt rows that apt never lays down

Slice 1 left the two namespaces disagreeing: the manifest emits `openssh-server`, `vsftpd` and the
eight library names, and `apt install` has never heard of any of them. `apt list -u` would print
rows a player cannot type back at apt.

They become catalog rows marked as shipped with the image. `apt install openssh-server` answers
*"openssh-server is already the newest version"* — which is **true on every box in the world**, so
it is not a fiction — while `apt upgrade` and `apt list -u` work on them normally. Apt never lays
down a binary or a `.so` for them, so no install path is invented for software that is already
everywhere.

This closes slice 1's check: every package name the manifest can emit is one apt knows, with
`firmware` as the single declared exception — it is synthetic by design (`packageVersions.ts` says
so in its own comment: a router is not apt-managed by the player) and slice 9 owns it.

The rejected alternatives were making them fully installable (libraries would need apt to write
`/lib/*.so`, and `binariesForService` would start matching `sshd` and `vsftpd`, shifting world
generation for no player-visible gain) and leaving the split (keeps the wart that
`apt upgrade openssh-server` works while `apt install openssh-server` denies the package exists).

### 39. `apt install pkg=<version>` pinning is deferred to the attacker slices

Decision 22's apt surface includes downgrade-only pinning, and the slice spine does not name it
here. It stays out. This slice is the DEFENDER's loop and is already the phase's biggest; pinning
is pure attacker persistence with no defender value, so it does nothing for the playtest slice 4
exists to enable. It also needs its own surface — `pkg=version` parsing, downgrade-only
validation, and a refusal for a version the world has not published yet.

Owed to slice 5 or 6, recorded in the epic. It gets the resolver this slice builds for free.

## Acceptance Criteria

**4a — a fix is visible**

- [ ] A package's timeline walks FORWARD: each entry bumps the tuple (80% patch / 15% minor / 5%
      major) and accumulates a 3-14 day gap, exactly as legacy's walker does.
- [ ] **Nothing already published moves.** Slice 2's four golden CVE pins, and every CVE id, day,
      severity and effect a box on its starting version currently derives, are byte-identical after
      the walk lands.
- [ ] A box on a later version gets that version's OWN CVE — a different id and an independently
      rolled severity from the one its starting version had.
- [ ] A version the world never published resolves to its nearest known ancestor; a version below
      the starting tuple, or one that is not a tuple, resolves to the starting version (decision
      36). The resolution is total — every string gets an answer.
- [ ] `apt list -u` (and `--upgradable`) reads the CURRENT box's manifest and prints one row per
      package that needs action: `[upgradable → <version>]` when the fix is out, or
      `[vulnerable, no fix yet — ETA ~N days]` when the CVE published and its fix has not.
- [ ] The ETA counts down: it is the days remaining until that fix is released, not an average.
- [ ] A box with nothing exposed says so in one line rather than printing an empty list.
- [ ] `apt list -u` is online-gated and needs no root, like `apt list` beside it.
- [ ] Every package name the manifest can emit is one apt knows, `firmware` excepted (decision 38),
      and `apt install openssh-server` answers "already the newest version".
- [ ] `man apt` documents the new operation.
- [ ] `scripts/testExploitOwnLan.ts`'s door-closing case is rewritten to close the door with a REAL
      later version — under decision 36 its `9.9.9-never-shipped` fixture now proves the opposite.
- [ ] Version bumped in `v2/package.json` **and** `v2/package-lock.json`.

**4b — the defender patches**

- [ ] `apt upgrade <package>` on a vulnerable package with a released fix writes the new version to
      `/var/lib/dpkg/status` and says what it did.
- [ ] Bare `apt upgrade` covers every exposed package on the box at once, and reports the ones
      still inside their patch-delay gap as warnings rather than upgrading them.
- [ ] **The loop closes**: after the upgrade, `nmap -sV` reports the new version with no CVE, and
      the exploit that worked a moment ago refuses — proven live against `vercel dev` + supabase.
- [ ] A live session opened through the old hole SURVIVES the patch (decision 19). Upgrading is not
      an eviction tool.
- [ ] `apt upgrade` refuses without root and without a network, in apt's own words; refuses a
      package the box does not have; and says "0 upgraded" on a box with nothing exposed.
- [ ] `apt install` resolves its version through the SAME resolver (decision 7): a fresh install is
      born at the current latest-safe version, and inside a patch-delay gap falls back to the newest
      published version, so installing into a window leaves you exposed exactly as everyone is.
- [ ] `apt install` writes a manifest row alongside the binary (slice 1's debt), so a bought daemon
      carries a version a scan can read and a CVE it can catch. A package with no version template
      installs exactly as it does today and writes no row.
- [ ] Version bumped in `v2/package.json` **and** `v2/package-lock.json`.

## Slices

### Slice 4a: a player sees which of their own packages is exposed, and when the fix lands

**Value**: The defender gets sight before they get a tool. Until now a CVE is something a player
reads about somebody else's box through `nmap -sV`; this is the first time the game tells you about
your own, and the first time it tells you a fix is coming but not here yet — which is the state the
whole patch-delay mechanic exists to create.
**Path**: `apt list -u` → `env.fs` reads `/var/lib/dpkg/status` → `parseDpkgVersions` →
`upgradeStatusFor(pkg, version, gameDay)` → `packageTimeline` + `findLatestSafeVersion` → rendered
rows.
**Class**: Behaviour change.
**Delivery**: Independent PR against trunk. No stack.
**Required implementation skills**: `tdd`, `testing`, `characterisation-tests` (the golden pins and
`binariesForService` must be locked BEFORE the derivation and the catalog move); `refactoring` if
the timeline earns its own module once written — it should; `mutation-testing` at PR readiness.
**Reduction program**: N/A.
**Transition/terminal evidence**: N/A.

**Acceptance criteria**: the 4a list above, in full. **Confirmed with the owner before any code.**

**RED**: Seven increments, each failing first. The load-bearing ones are a later entry having its
own id and severity, the nearest-ancestor resolution being total, the patch-delay gap producing a
counting-down ETA rather than an upgrade target, and the namespace check.
**GREEN**: The minimum for each increment. No write path, no `apt upgrade`, no pinning.
**REFACTOR**: `liveCve.ts` should not also own a walker. Assess splitting the timeline into its own
module under `core/cve/` once the walk is written and green.
**PRE-PR MUTATION**: One Stryker run over `src/core/cve/liveCve.ts`, the new timeline module, and
`src/core/commands/apt.ts`. Conventions §4: `npm run encode` first, scope the RUNNER not just
`--mutate`, `--reporters json,progress`, read `reports/mutation/mutation.json`, and **read the
timeout column** — a timeout counts as killed and inflates the score.
**Expect `exploitEffect.ts`'s score to CLIMB on its own** as the effect index widens past the first
entry, and do not "fix" it with a test that restates the pool table. The epic's slice 3 close-out
accounts for all 45 of those survivors as currently-unreachable pool entries.
**PR-ready when**: every 4a criterion is met, the mutation gate is run and its valuable survivors
addressed, `npm run typecheck` and `npm run lint` pass, the complete non-watch suite is green, and
the rewritten `testExploitOwnLan.ts` passes live. Owner approves the commit.
**Slice complete when**: the PR lands.

### Slice 4b: the defender patches, and the exploit goes inert

**Value**: The first move a defender has. Everything in the phase so far makes the world worse at
the player; this is the answer, and it is the slice that makes the phase playtestable — the attack
→ patch → inert cycle can be run end to end and the treadmill's pace judged against real play.
**Path**: `apt upgrade [pkg]` → root + online gates → `upgradeStatusFor` per manifest row →
`env.patches.write` over `/var/lib/dpkg/status` on the CURRENT machine → the existing patches
endpoint → journal replay → the server's own `parseDpkgVersions` on the next exploit attempt.
**Class**: Behaviour change.
**Delivery**: Independent PR against trunk, cut after 4a merges. No stack.
**Required implementation skills**: `tdd`, `testing`; `refactoring` if the shared resolver wants
extracting once install and upgrade both call it; `mutation-testing` at PR readiness.
**Reduction program**: N/A.
**Transition/terminal evidence**: N/A.

**Acceptance criteria**: the 4b list above, in full. **Confirmed with the owner before any code.**

**RED**: Seven increments, each failing first. The load-bearing ones are the manifest patch landing
on the right machine, the in-gap package being warned about rather than upgraded, install being
born at the latest safe version, and the session surviving the patch.
**GREEN**: The minimum for each increment. No pinning (decision 39), no library meta-packages, no
`apt remove`.
**REFACTOR**: Assess whether install and upgrade share one target resolver or two call sites of the
same function — decision 7 requires one function, not one shape copied twice.
**PRE-PR MUTATION**: One Stryker run over `src/core/commands/apt.ts` and the resolver module.
Same §4 rules.
**PR-ready when**: every 4b criterion is met, the mutation gate is run and its valuable survivors
addressed, `npm run typecheck` and `npm run lint` pass, the complete non-watch suite is green, and
the extended `testExploitOwnLan.ts` proves the loop live. Owner approves the commit.
**Slice complete when**: the PR lands.

## Increments

### 4a (RED → GREEN order inside the one PR)

1. **Lock what must not move.** Characterisation locks BEFORE any derivation change: slice 2's four
   golden CVE pins, plus a pin on every catalog service's starting-version id, publication day,
   severity and rolled effect. No RED of their own — they pass today and exist to fail if the walk
   disturbs entry 0. The same pass locks `binariesForService` for `ssh` and `ftp`, which the
   catalog rows in increment 6 could otherwise shift silently.
2. **The forward walk.** `packageTimeline(key, uptoDay)` ported from legacy `timeline/walker.ts`:
   per step, draw the gap then the bump type from the one `timeline:${key}` stream, with
   `patchDelay` on its own `timeline:${key}:patchDelay` side stream and the runaway cap. *RED*: a
   later entry publishes strictly after an earlier one; the tuple bumps by weight; entry 0's gap is
   the first draw of the stream, so `publicationDayOf`'s current answer is the walk's entry 0.
3. **Each entry owns its CVE.** `cveIdOf` takes the index. *RED*: two consecutive entries have
   different ids and independently rolled severities. **The id stream must be drawn FORWARD rather
   than re-seeded per index** — entry 0's serial is the first draw of `cve-id:${key}` and slice 3's
   traces have already written entry-0 ids into real journal rows.
4. **A version resolves to an entry** (decision 36). *RED*: an exact version resolves to itself;
   `9.9.9` resolves to the newest published entry; `banana` and a below-start tuple resolve to
   entry 0; `liveCve` past entry 0 returns that entry's CVE and is clean before its publication day.
5. **The upgrade target and the gap.** `findLatestSafeVersion(key, gameDay)` ported, plus the
   shared `upgradeStatusFor(key, version, gameDay)` returning up-to-date / a target / an in-gap ETA
   / no-timeline. *RED*: a vulnerable package with an elapsed delay resolves to the next version;
   inside the gap it resolves to no target; the ETA is the days remaining and counts down; a
   package with no template (`firmware`) returns no-timeline rather than throwing.
6. **`apt list -u`.** Reads the current box's manifest, one row per package needing action. *RED*:
   an exposed package prints its target; one in the gap prints the ETA status; a clean box prints
   one "up to date" line rather than nothing; `-u` and `--upgradable` are the same flag; offline
   refuses in `apt list`'s own words; no root needed.
7. **The namespace closes** (decision 38). The ten base-image rows, and the check slice 1 asked
   for. *RED*: every package the manifest can emit is one apt knows, `firmware` excepted; a
   base-image row lays down no binary; `apt install openssh-server` answers "already the newest
   version". Then `man apt`, the rewritten wire-check case, and the version bump.

### 4b (RED → GREEN order inside the one PR)

1. **`apt upgrade <pkg>` writes the manifest.** The happy path only: root, online, vulnerable, fix
   released. *RED*: the row's version changes and every other row is left byte-identical; the patch
   lands on the machine the player is STANDING on.
2. **Bare `apt upgrade`.** Every exposed package at once, mixed outcomes. *RED*: two exposed
   packages both move; one in its gap is reported as a warning and NOT moved; the counts line adds
   up.
3. **The refusals.** *RED*: non-root gets apt's lock-file error; offline gets apt's fetch error; a
   package the box does not carry is refused by name; a box with nothing exposed says "0 upgraded"
   rather than nothing.
4. **Install through the resolver** (decision 7). *RED*: a fresh install is born at the current
   latest-safe version, not at the starting tuple; inside a patch-delay gap it falls back to the
   newest published version; install and upgrade resolve through ONE function.
5. **Install writes a manifest row** (slice 1's debt). *RED*: after `apt install redis`, the
   manifest names `redis` at the installed version and `nmap -sV` shows it; a package with no
   version template writes no row and installs exactly as before.
6. **The patch does not evict** (decision 19). *RED*: a session opened through the old hole still
   answers after its package is upgraded.
7. **The loop, live.** `scripts/testExploitOwnLan.ts` extended: exploit lands → the target's
   manifest moves to the next real version → the same exploit refuses → the defender's log holds
   both the break-in and the bounce. Then the version bump.

## Forced rather than chosen (planning should not re-litigate)

- **`apt upgrade` needs root and a network**, because `apt install` already does and an upgrade is
  a repo fetch plus a dpkg write. `apt list -u` needs neither root nor a credential — the manifest
  is world-readable and tier-3 allowlisted, so gating the view would hide nothing a `cat` would not
  hand over.
- **The upgrade writes to the box you are standing on**, through `env.patches.write` like every
  other write in the game. This is the rule that lifted `hydra`'s own-machine gate and kept
  `msfconsole` free of a `withoutTty` at slice 3: tools run where you stand.
- **No `api/` change is needed for the loop to close.** The upgrade is an ordinary journal patch
  over `/var/lib/dpkg/status` on the existing patches endpoint, and the server's exploit path
  already reads the version off the materialised filesystem rather than off the template table —
  slice 1 made the manifest the authority for exactly this moment.
- **A package's CVE never expires.** Once an entry's day arrives, a box sitting on that entry is
  vulnerable until it MOVES. That is what makes decision 4's frozen NPC boxes permanently
  exploitable and what makes upgrading the only defence.
- **The walk must extend past today**, because a player who has just upgraded is sitting on a
  version whose own CVE has not published yet. Legacy's `findGeneratedVersion` walk cap ports with
  the walker.
- **`up to date` means not exposed, not "on the newest version".** The treadmill only asks a player
  to move when they are actually vulnerable, which is legacy's own rule and keeps a quiet box quiet.

## Folded in as routine (recorded so they are not re-decided)

- **The ETA is the true days remaining, where legacy showed the config midpoint.** The timeline is
  deterministic and the client already recomputes it, so an average would be the game withholding a
  number it has already handed over. A true countdown also makes "come back tomorrow" a plan rather
  than a guess.
- **`apt list -u` prints only rows that need action**, as real `apt list --upgradable` does, with a
  single "All packages are up to date." line when there are none. Legacy listed every package with
  an `[up to date]` row; on a v2 box that is seven services plus eight libraries of mostly noise,
  and a clean box saying so in one line is a better reward than a wall of green.
- **A manifest row whose package has no timeline is skipped by `list -u` and `upgrade`.** Today
  that is `firmware` alone. It has no upgrade target to offer and slice 9 gives it its own axis;
  inventing a sentinel version for it now would put a lie in the one file the whole phase trusts.
- **`apache2` is the one apt daemon with no version template.** It installs as it does today and
  writes no manifest row. Flagged for the content pass rather than fixed here — giving it a
  template is a world-data decision, not this slice's.
- **Legacy's library meta-packages, `apt remove <library>` and the 730-day forward walk stay
  dropped** (decision 22). Nothing here reintroduces them.

## Risks this slice carries

- **Entry 0 must not move, and two of the four streams are one edit away from moving it.** The id
  stream has no index today and the walk interleaves draws that currently do not happen. The
  characterisation locks in increment 1 are what make this safe, and they go in FIRST — before the
  walker exists.
- **A shipped wire-check inverts under decision 36.** `testExploitOwnLan.ts` closes its door with
  `9.9.9-never-shipped`; that string now resolves to the starting version and leaves the door OPEN.
  It is rewritten in 4a, not 4b, because the rule lands in 4a — and the rewrite makes it a stronger
  check than the one it replaces.
- **The catalog rows can shift world generation.** `binariesForService` matches on package name and
  daemon name, so an `openssh-server` or `vsftpd` row starts matching where nothing matched before.
  Characterised in increment 1, and the rows must lay down nothing.
- **`apt upgrade` is the first thing that makes an off-timeline version ordinary rather than
  exotic.** Every path that resolves a version — the scan, the exploit, apt itself — now meets
  versions past entry 0 routinely, and the server must agree with the client about every one of
  them. The wire-check is the only thing that can prove it does.

---
*Retire this plan into [`legacy-parity-epic.md`](./legacy-parity-epic.md) when both PRs have landed,
and delete the file — as D3-D10, X1 and slices 1, 2 and 3 each were.*
