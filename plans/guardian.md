# Plan: the guardian's rounds over the public web

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-22. Slice 1 shipped in
#725 (v0.425.0), slice 2 in #726 (v0.426.0). Slice 3 is planned, its choices and criteria
confirmed; `feat/guardian-report` is next.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

Players have started using the game, and every public website in it is open to them for good.
The owner wants to be the valley's guardian: on rounds they choose to make, look over the public
web, patch it as a root `apt upgrade` would, and restore the boxes players have tampered with. The
rounds are run by a skill the owner invokes, which drives one operator script against prod.

## Where it starts from (facts, 2026-10-22)

- **Every NPC box freezes at its start tuple forever** (`vulnerability-architecture.md`, "What a
  box sits on"). Each package's first CVE publishes on day 3–14 and stays live, so from about day
  14 every NPC service and library has a permanent live hole. The doc calls this a placeholder for
  "planned NPC maintainer actors"; the guardian is that actor, run by hand. The rejected
  alternative it names (a seeded per-box patch lag that makes the version a pure function of game
  time) stays rejected: a guardian's patch is stored state, a journal row like a player's.
- **A box's versions are its `/var/lib/dpkg/status`**, base tree plus journal replay. `apt upgrade`
  moves each row to its newest installable release through one resolver (`upgradeStatusFor` /
  `newestReleaseOn`, `core/cve/packageTimeline.ts`, used by `core/commands/apt.ts`). A fix is
  installable 1–2 game days after its CVE publishes, and a package's next CVE comes 3–14 days after
  the last. A patched box with about ten packages (eight libraries plus its services) usually has a
  new live hole within a few days.
- **`apt upgrade` closes doors and evicts no one.** Only a router's firmware flash reboots the
  box. An upgrade writes no `dpkg.log` line; `core/logging/dpkgLog.ts` logs only a downgrade.
- **`scripts/restoreSite.ts <name>`** restores the 9 fixed boxes (`FIXED_BOXES`,
  `generation/fixedSites.ts`): it ends every open session on the box, deletes its whole journal
  and writes one fresh boot marker. No `kern.log` line, because the operator has no in-world
  address. **Deleting the journal also deletes any upgraded `dpkg/status`**, so today a restore
  puts a box back on its vulnerable start tuple. `scripts/testRestoreSite.ts`, `testChainit.ts`,
  `testTalkit.ts` and `testHiremeBoardRoot.ts` run it as a child process. It is named in
  `.claude/skills/e2e/references/fixed-sites.md`, `backlog.md`, `project-status.md`, the
  `*-architecture.md` docs of every fixed site, and the handbook (`03`, `08`, `12`, glossary).
- **The public web** (`world-in-numbers.md`, v0.424.0): 9 fixed boxes and 357 network websites. A
  network declares its site as `site: { domain, name }` (`generation/world.ts`) and is served by
  one box, `siteServer(essid)` (`generation/siteServer.ts`). Measured on the declared world: 42
  networks of category `government` or `public` publish a site: 27 `government` (each of the 11
  towns' council `{town}.gov` and police `{town}pd.gov`, and the 5 courthouses
  `{town}courts.gov` of the towns bigger than a village), and 15 `public` (the 11 towns'
  `{town}library.org`, and four Ridgemont landmarks: `ridgemontparks.gov`, `ridgemontmetro.gov`,
  `flyridgemont.com`, `ridgemontcentral.org`). With the 9 fixed boxes, the patrol is **51 boxes**.
- **Not every journal row is tampering.** A visit appends rows too: a `curl` adds an `access.log`
  line, an `nmap` a scan trace. "The box has rows" is true of nearly every box.
- **Prod access** (owner's local setup): `.env.production.local` (gitignored) holds prod's
  `SUPABASE_URL` and a dedicated, revocable secret key named `valleynews`, used as
  `SUPABASE_SERVICE_ROLE_KEY`. `.claude/settings.local.json` allows exactly one prod command,
  `npx dotenv -e .env.production.local -- npx tsx scripts/valleynews.ts *` (Bash and
  PowerShell), run from the repo root with no `cd` prefix. Any other prod access is blocked.

## Decisions (owner-confirmed 2026-10-22)

1. **The patrol is the fixed boxes plus the town institutions**: the 9 fixed boxes and the site
   server of every `government` and `public` network that publishes a site, 51 boxes. Shops,
   cafes, offices, clinics and homes stay unattended, a large and realistically neglected
   playground. Rejected: fixed boxes only (leaves the civic web a new player meets first wide
   open); every network website (a round of 366 boxes, and the whole web closed).
2. **Any public website can be named by its domain**, the patrol list and every other network's
   site server alike (`boards.hireme.io` by its key, its only name). Naming boxes narrows a round
   to them; with no name, a round covers the patrol. Rejected: the patrol list only (no way to look
   after one shop's site); any machine in the world (players defend their own boxes, which is the
   game's "patch or die", and a box behind a gateway has no domain to name it by).
3. **A patch is exactly an in-world root `apt upgrade`** of every service and library, through
   the same resolver. A CVE whose fix is not out yet stays open until a later round, and a patch
   evicts nobody. Rejected: the guardian installing a fix before its release (it breaks the world's
   clock, and `apt list -u` would show versions that cannot exist yet).
4. **A restore always ends patched**, like reinstalling from current media and then upgrading.
   Rejected: restore and patch as separate acts, which leaves a hand-run restore reopening every
   hole on the box.
5. **Restore covers any public website by domain**, the same set a patch can name, and acts on
   the site server only: it ends every session on that box, deletes its journal, writes a fresh
   boot marker and patches. The gateway and every other box on that network keep what they hold,
   so an intruder who owns them keeps that foothold. Rejected: fixed boxes only (a defaced council
   site has no way back); resetting the whole network (a far bigger act on NPC boxes outside the
   patrol).
6. **A round reports and the owner decides.** For each box the report shows **behind** (packages
   with an installable fix) and **tampered** (a write outside the box's own logs, an open session
   held by a player, or a brick). The owner picks which tampered boxes to restore, and every other
   box is patched. The exact tampered test is the plan's, from the fact that a visit's log rows are
   not tampering. Rejected: restoring every tampered box automatically (a defaced page standing
   for a while is part of the story, and the owner may want to read the intruder's trail first); a
   round that never restores.
7. **No new trace.** A patch is visible only as moved versions, the same as a player's own
   upgrade; a restore leaves only its boot marker, as now. Players learn the guardian's rhythm by
   finding a door closed between two scans. Rejected: a `dpkg.log` upgrade line or a history line
   naming the operator (a log shape only the operator would ever produce).
8. **Claude runs the round against prod**, through one more allow rule naming the guardian
   script, on the existing `.env.production.local` and its `valleynews` key. The report and the
   patch run freely when the owner invokes the skill; a restore runs only on the owner's pick.
   Rejected: a second dedicated key in its own env file (it only buys separate revocation, at the
   cost of a second file); the owner running the commands with the skill only printing them.
9. **One script, `scripts/guardian.ts`**, with `report [domain…]`, `patch [domain…]` and
   `restore <domain…>`. With no domain, `report` and `patch` cover the patrol; `restore` always
   names its boxes. `restoreSite.ts` folds into it and is deleted, and every doc, skill reference
   and wire-check that names it moves to the guardian. Rejected: `restoreSite.ts` beside a new
   patch script (two files sharing the patch step, the domain resolution and the prod client, and
   two allow rules).
10. **Rounds are manual only.** A round happens when the owner invokes the skill, and never
    otherwise; an unpredictable rhythm gives players no day to time an exploit to. A scheduled
    guardian goes into `backlog.md`, to revisit once the owner knows which rhythm feels right.
    Rejected: a schedule from the start (it also needs prod credentials in a cloud routine).

### Defaults Claude filled in, accepted with the record

- **A bricked box is never patched.** `apt` cannot run on a dead box, so `patch` skips it and
  the report says it needs a restore to come back.
- **The skill is checked in** at `.claude/skills/guardian/SKILL.md`, beside `e2e`, and the owner
  invokes it as `/guardian`.
- **The script is proven against dev first** by a wire-check (`scripts/testGuardian.ts`) against
  `vercel dev` and local supabase, before it ever runs on prod.

## Slices

1. **The guardian patches.** `scripts/guardian.ts patch [domain…]`: the patrol list, any public
   website resolved by its domain, apt's upgrade decision shared with the script, a bricked box
   skipped, and a `scripts/testGuardian.ts` wire-check.
2. **The guardian restores.** `restore <domain…>` on the same script, for any public website,
   ending patched; `restoreSite.ts` deleted, and its wire-checks, docs and skill reference moved
   to the guardian.
3. **The guardian reports, and the round is a skill.** `report [domain…]` (behind and tampered),
   the checked-in `/guardian` skill that runs a round, the prod allow rule, and the scheduled
   guardian in `backlog.md`.

Patch comes first because a restore ends with one (decision 4), so slice 2 reuses it rather than
building it twice. The first round on prod, with the owner choosing, closes out the work after
slice 3.

## Slice 1 plan: the guardian patches

**Shipped** in #725 (v0.425.0), 2026-10-22: every criterion below met; `testGuardian.ts` passed
12 of 12 live.

**Branch**: `feat/guardian-patch` · **Version**: 0.424.0 → 0.425.0 · **Class**: behaviour change
· **Delivery**: one PR against `main`; no migration.

**Value.** The operator runs `patch`, and every box on the patrol (or only the ones named) moves
each package with a shipped fix onto it, exactly as a root's `apt upgrade` would. A door that
fired before the round is shut after it, for every player.

**Path.** `scripts/guardian.ts patch [domain…]` → `core/guardian/` resolves each name to its box
(machine id, generated base tree, the network key its logs accrete under) → the script reads the
box's journal with the service role and materializes it → `canBoot` decides a brick → the shared
upgrade decision rewrites the manifest for today's game day → one `patches` upsert of
`/var/lib/dpkg/status` → every reader (`nmap -sV`, `msfconsole`, `apt`, the server's exploit
authorization) replays it like any other row.

### Facts read while planning (2026-10-22)

- **apt's decision lives in `core/commands/apt.ts`**: `exposureOf(pkg, version, gameDay)` pairs
  `upgradeStatusFor` with `liveCve`; `applyUpgrades` turns the exposed rows into upgrades (fix
  shipped) and warnings (no fix yet), and folds the upgrades into the manifest with
  `withPackageVersion` (`core/packages/dpkgStatus.ts`). It writes `DPKG_STATUS_PATH` with
  `DPKG_STATUS_OWNER` / `DPKG_STATUS_PERMISSIONS` restated. None of that decision is reachable from
  a script today.
- **Every patrol box carries 11 packages and no firmware**: `openssh-server`, a web server
  (`nginx` on a fixed box, `nginx` or `apache2` on a site server), `vsftpd`, and the eight
  libraries (findit.io and millbrook.gov's `portal-58`, measured). No firmware row, so a patch never
  takes the flash-reboot path.
- **A public website resolves already**: `core/findit/webIndex.ts` derives `PUBLISHERS` (each
  declared network with a `site`: its key, domain, `siteServer`, and the server's machine id from
  `resolveLanHostIdentity`) and the fixed listings (`computeApGatewayId(site.key)`). Both are
  module-private. `FIXED_BOXES` includes `boards.hireme.io`, which findit does not list.
- **A box's network key** is `apGatewayLogWriterKey(key)` = `ap:<key>`: the writer every log line
  on a site server lands under when no player's workstation owns it (`rebootSequence.ts`
  `resolveLogWriterKey`), and the one `restoreSite.ts` writes its boot marker under.
- **Replay takes the newest row** per path (`orderPatchesForReplay`: `updated_at`, then
  `writer_key`), and a trigger stamps `updated_at` on every write
  (`patches_shared_journal.sql`). A guardian row written after a root's hand edit wins; a root's
  later `apt` write, read against the old content, is refused by `handleUpsertPatch`'s
  `base_hash` check, as any stale write is.
- **A brick** is the `/boot` tombstone in the journal; `canBoot(root)` (`core/boot/bootFiles.ts`)
  reads it off a materialized tree.
- **A game day is a real day** (`gameDayAt(now)`); on 2026-10-22 the world is about 102 days old,
  so every start tuple is long exposed and most fixes have shipped.

### Choices made while planning (owner-confirmed 2026-10-22)

- **apt's decision moves to one shared function**, `planUpgrade(manifest, gameDay)` in
  `core/packages/`, returning the upgrades, the held packages (no fix yet, with their hole and
  ETA) and the rewritten manifest. `apt upgrade` and the guardian both call it, so the two cannot
  disagree (decision 3). A pure refactor, done first, under apt's existing tests.
- **The public-box lookup moves out of `webIndex.ts`** into `core/guardian/` (or a shared
  `generation/` module), and findit's index reuses it: one derivation of "the box a domain is
  served from", not two.
- **The guardian's manifest row is written under the box's network key** (`ap:<key>`), the same
  writer as its logs and a restore's boot marker. No new writer shape, so nothing about the row
  marks it as the operator's (decision 7).
- **Names are refused as a whole order.** An unknown domain, a repeated one, or missing env exits
  2 naming it, before anything is read or written. A domain is matched case-insensitively.
- **One line per box**, after a header naming the database host:
  - `millbrook.gov: 3 upgraded (nginx 1.26.0 → 1.26.2, libssl 3.2.1 → 3.2.4, vsftpd 3.0.6 → 3.0.8), 1 held (libpam: no fix yet — ETA ~2 days)`
  - `millbrook.gov: up to date` when nothing moved (and nothing is written)
  - `millbrook.gov: bricked — restore it to bring it back` (nothing is written)

  Then a total: `Patched 51 boxes: 38 upgraded, 11 up to date, 2 bricked.`
- **Exit 0** when the round ran (bricked boxes included), **1** on a database error (the boxes
  already patched stay patched; the line says which box failed), **2** on a refused order.
- **The patrol** is `FIXED_BOXES` plus every publisher whose network's category is `government`
  or `public`: 51 boxes, in that order.
- **Bundle**: `planUpgrade` moves bytes inside apt; the guardian and the lookup are script-side.
  Measured at the refactor; a growth is raised with the owner.

### Acceptance criteria

1. `apt upgrade` and `apt list -u` print exactly what they print today, on every case apt's tests
   hold.
2. `guardian.ts patch` with no domain names the 51 patrol boxes, each with one line, then the
   total.
3. `guardian.ts patch millbrook.gov findit.io` patches only those two. Any public website can be
   named: a shop's site (`*.com`) and `boards.hireme.io` both resolve.
4. After a patch, every package on the box either sits on the newest release `upgradeStatusFor`
   offers today, or is held with its ETA. The manifest row is owned `root`, keeps its
   permissions, and is written under `ap:<key>`.
5. A second patch the same day prints `up to date` and writes nothing.
6. A root's hand edit of the manifest (a downgrade) is upgraded from the version it claims, as
   apt would.
7. A bricked box is reported and left untouched.
8. A patch ends no session on the box.
9. The CVE that fired against a site server's web service before the patch is refused after it.
10. An unknown or repeated domain, or missing env, exits 2 having read and written nothing.
11. findit lists every site it listed before, by the same box.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **`planUpgrade`** (pure refactor): extracted from `apt.ts` under apt's existing tests, plus its
   own tests; criterion 1.
2. **The public-box lookup**: moved out of `webIndex.ts`, reused by it, and the patrol list;
   criteria 2, 3 and 11 at the function.
3. **The guardian's patch decision** (`core/guardian/`): one box's materialized tree and today's
   day → the row to write or the reason not to, and the box's line and the total; criteria 4–7
   and 10 at the function.
4. **The script and the wire-check**: `scripts/guardian.ts patch`; a new `scripts/testGuardian.ts`
   that runs the real script as the operator would against `vercel dev` + local supabase and checks
   criteria 3–10 live (its rows on the chosen boxes deleted before and after).
5. **Docs and version 0.425.0**: the handbook's codebase map, glossary and operate chapter;
   `vulnerability-architecture.md` (the guardian patches the patrol, so a patrol box is no longer
   frozen at its start tuple); `docs/project-status.md`.

### Evidence

- Unit tests under `npm test`; `npm run typecheck`; `npm run lint`; the bundle check.
- Wire-check `scripts/testGuardian.ts` against `vercel dev` + local supabase.
- Mutation gate at PR readiness over `core/guardian/` and `planUpgrade`.
- No browser run: one at the close-out round.

## Slice 2 plan: the guardian restores

**Shipped** in #726 (v0.426.0), 2026-10-22: every criterion below met; `testGuardian.ts` passed
21 of 21 live, and the five fixed-site wire-checks passed through `guardian.ts restore`.

**Branch**: `feat/guardian-restore` · **Version**: 0.425.0 → 0.426.0 · **Class**: behaviour change
· **Delivery**: one PR against `main`; no migration.

**Value.** The operator runs `restore millbrook.gov`, and a council site a player defaced, rooted
or bricked comes back as generated, already on today's fixes, with every player on it thrown
off. Until now only the 9 fixed boxes could come back, and they came back on their vulnerable
start tuple.

**Path.** `scripts/guardian.ts restore <domain…>` → the same name resolution as `patch`
(`boxesNamed`, but an empty order is refused) → for each box: end every open session on the site
server, and every chain standing on them → delete its whole journal → write the patched manifest
and a fresh boot marker, both under `ap:<key>` → every reader replays the clean box.

### Facts read while planning (2026-10-22)

- **`restoreSite.ts` ends only the sessions on the box.** An in-world reboot
  (`core/sessions/rebootSequence.ts`, used by `reboot` and a firmware flash) also ends every
  session stacked above the closed ones, as `upstream_lost`, through `endChainsAbove`
  (`core/sessions/upstreamLost.ts`). So a player who hopped from a restored site onto another box
  keeps that hop open today, standing on a session that no longer exists.
- **A site server keeps no state outside `patches` and `sessions`.** The other machine-keyed
  tables (`hireme_boards`, `news_stories`, `talkit_*`, `wallet_*`, `email_*`) belong to fixed
  sites, and a restore has never touched them; nothing changes there.
- **Five wire-checks spawn `restoreSite.ts`**: `testRestoreSite.ts`, `testHiremeBoardRoot.ts`,
  `testChainit.ts`, `testTalkit.ts` and `testValleynews.ts`. Two of them
  (`testRestoreSite.ts`, `testHiremeBoardRoot.ts`) assert the journal holds the boot marker and
  nothing else, which stops being true once a restore ends patched.
- **On game day 102 a restored box always gets a manifest row**: every patrol box moves all 11–12
  packages off its start tuple (measured in slice 1). A box with nothing to install would get only
  the marker.
- **`decidePatch` on an empty journal is exactly "a reinstalled box, then upgraded"**, so the
  restore reuses it rather than deciding the manifest a second way.

### Choices made while planning (owner-confirmed 2026-10-22)

- **A restore is a reboot, all the way up.** It ends every open session on the box as
  `rebooted`, and every chain standing on those as `upstream_lost`, through the same
  `endChainsAbove` an in-world reboot uses: two kinds of reboot that end sessions differently
  would be a bug. Rejected: keeping today's machine-only end.
- **Order**: end the sessions (and chains) → delete the journal → write the manifest and the
  marker in one upsert. Sessions close first, as today, so a shell standing on the old box can
  write nothing that survives onto the clean one.
- **One line per box, after a header naming the database host**:
  - `millbrook.gov: restored (2 sessions closed, 23 rows removed), 11 upgraded (nginx 1.26.0 → 1.27.4, …), 1 held (libpam: no fix yet — ETA ~2 days)`
  - `findit.io: restored (0 sessions closed, 4 rows removed), up to date`

  The part after the brackets is the patch line's own wording. Then a total:
  `Restored 2 boxes.` The boot id isn't printed; nothing reads it.
- **`restore` always names its boxes.** With no name it exits 2 (`restore names the boxes it
  restores`) before reading anything. An unknown or repeated name, or missing env, exits 2 as
  `patch` does. Usage: `Usage: guardian.ts patch [name…] | restore <name…>`.
- **Exit 1 on a database error**, naming the box and the step that failed. The boxes restored
  before it stay restored, and a restore is safe to run again on the one that failed.
- **A restored box always boots.** A unit test holds every public box's generated tree to
  `canBoot`, so a restore can never end on a brick.
- **The wire-checks**: `testGuardian.ts` gains the restore of a patrol site server (the new
  ground: a network's site, not a fixed box). `testRestoreSite.ts` keeps its name and its story (a
  fixed site falls and comes back), spawns `guardian.ts restore`, and expects the marker plus the
  patched manifest. The other four spawn `guardian.ts restore` instead, and
  `testHiremeBoardRoot.ts` expects the manifest too.
- **Docs move with the script**: every place listed under "Where it starts from" names
  `guardian.ts restore` instead, and `vulnerability-architecture.md` says a restore ends patched.
  `restoreSite.ts` is deleted.

### Acceptance criteria

1. `guardian.ts restore millbrook.gov` on a council site that a player defaced, holds a root
   shell on, and has rolled a package back on: the front page is generated again, every package
   sits on today's fix or is held, the journal holds exactly the manifest and one fresh boot
   marker, both under `ap:<key>`, and the player's session is closed as `rebooted`.
2. A session the player stacked on top of the one on the site is closed as `upstream_lost`.
3. A session the player holds on that network's gateway stays open (decision 5).
4. The CVE that opened the shell before the restore is refused after it.
5. A bricked site server comes back booting and patched.
6. The 9 fixed boxes restore as before, now ending patched: `testRestoreSite.ts` (findit.io and
   hackademy.io), `testHiremeBoardRoot.ts`, `testChainit.ts`, `testTalkit.ts` and
   `testValleynews.ts` all pass against `guardian.ts restore`, with their tables untouched.
7. Restoring a box twice runs clean both times and leaves the same two rows.
8. `restore` with no name, an unknown or repeated name, or missing env exits 2 having read and
   written nothing.
9. `restoreSite.ts` is gone, and nothing in the repo names it outside this plan and the git
   history.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The restore decision** (`core/guardian/`): one box and today's day → the rows a restore
   writes after the wipe (the patched manifest when anything moves, and the marker), the box's
   line and the total, and the order that refuses an empty name list; the "every public box
   boots" guard. Criteria 5, 7 and 8 at the function.
2. **The script and its wire-check**: `guardian.ts restore`, with the chain end; the restore
   checks in `testGuardian.ts`, run live. Criteria 1–5, 7 and 8.
3. **The fixed boxes move over**: the five wire-checks spawn `guardian.ts restore`, run live;
   `restoreSite.ts` deleted. Criteria 6 and 9.
4. **Docs and version 0.426.0**: the handbook (03, 08, 12, glossary), every fixed site's
   architecture doc, `discovery-`, `email-`, `wallet-`, `tutorials-`, `talkit-`, `hireme-` and
   `valleynews-architecture.md`, `vulnerability-architecture.md`, the e2e skill's
   `fixed-sites.md`, `backlog.md` and `project-status.md`.

### Evidence

- Unit tests under `npm test`; `npm run typecheck`; `npm run lint`; the bundle check (no change
  expected: everything new is script-side).
- Wire-checks against `vercel dev` + local supabase: `testGuardian.ts`, `testRestoreSite.ts`
  (findit.io and hackademy.io), `testHiremeBoardRoot.ts`, `testChainit.ts`, `testTalkit.ts`,
  `testValleynews.ts`.
- Mutation gate at PR readiness over `core/guardian/`.
- No browser run: one at the close-out round.

## Slice 3 plan: the guardian reports, and the round is a skill

**Branch**: `feat/guardian-report` · **Version**: 0.426.0 → 0.427.0 · **Class**: behaviour change
· **Delivery**: one PR against `main`; no migration and no `api/` change.

**Value.** The owner types `/guardian`, and Claude looks the patrol over on prod. It shows which
boxes are behind and which players have tampered with, asks which to restore, restores those and
patches the rest. Until now a round meant the owner knowing the commands, and nothing told them
which boxes needed a restore.

**Path.** `/guardian [name…]` (`.claude/skills/guardian/SKILL.md`) → `guardian.ts report
[name…]` on prod → for each box, its journal and its open sessions read with the service role →
`core/guardian/report.ts` decides behind (through `decidePatch`) and tampered → one line per box
and a total, with nothing written → the owner picks → `restore <picked…>` → `patch [name…]`.

### Facts read while planning (2026-10-22)

- **A visit writes only under the box's own key.** Every log line on a public website lands
  under `ap:<key>`, all of them under `/var/log/` (`access.log`, `auth.log`, `kern.log`,
  `vsftpd.log` and the rest; `core/patches/appendMachineLog.ts`, the scan's `kern.log` trace). A
  daemon a visitor talks to also writes its own data under that key: `mysql` and `redis` their
  datadir, `snmpset` the file its OID names (`core/sessions/mysqlStatement.ts`,
  `redisStatement.ts`, `snmpSet.ts`). No patrol box runs any of the three (openssh, a web server,
  vsftpd), but a shop's site server named by its domain may.
- **A player's own write lands under the player's key**: a root shell's edit or `rm`
  (`upsertPatch`, `removePatch`), an `ftp put`, every file an exploit drops (the written file,
  `/etc/passwd`, a listener's pidfile; `exploitCreateSession.ts`, `exploitLocalElevate.ts`), a
  brick's `/boot` tombstone, and an in-world reboot's boot marker (under the caller's key,
  `api/sessions.ts`, `api/patches.ts`). A root wiping their trail out of a log writes a
  player-keyed row under `/var/log/`.
- **The guardian's own rows are two paths under the box's key**: the manifest
  (`/var/lib/dpkg/status`) a patch or a restore writes, and the boot marker (`/var/run/boot-id`)
  a restore writes.
- **An open session may be stale, and is still a foothold.** A session ends on `exit`, on a
  reboot, or as `abandoned` when the player's next boot finds it still open
  (`core/sessions/endSession.ts`). A player who closed the tab keeps the row open, and their next
  boot rebuilds the hop on it. The row carries the account it was opened as
  (`credentials.username`).

### Choices made while planning (owner-confirmed 2026-10-22)

- **A box is tampered** when any of these holds:
  1. a player holds an open session on it;
  2. its journal holds a row that is not the box's own. A row is the box's own when it is written
     under `ap:<key>` and is either a log under `/var/log/` or one of the guardian's two files.
     Everything else is a write somebody made: every player-keyed row, logs included, and a
     daemon's datadir rewritten through its port;
  3. it is bricked (which always comes with its player-keyed `/boot` tombstone).

  A visit's log lines, however many, are not tampering. Rejected: every player-keyed row and
  nothing else (it misses a database rewritten through its port, which lands under the box's
  key); a path list without the key (a root's wipe of `auth.log` would read as a visit).
- **Behind** is the number of packages a patch would move today, from the same `decidePatch`, so
  a report and the patch after it cannot disagree. The report gives the count; the patch prints
  the versions.
- **A report writes nothing.** One line per box, after a header naming the database host:
  - `findit.io: 11 packages behind`
  - `flyridgemont.com: up to date`
  - `millbrook.gov: 11 packages behind, tampered (2 open sessions: root, www-data; 3 paths written: /etc/passwd, /var/log/auth.log, /var/www/html/index.html)`
  - `ridgemontparks.gov: bricked, tampered (1 path written: /boot)`

  Every path written is listed, each once, sorted; the session accounts come in the order they
  were opened. Header `Looking over 51 boxes on <host>`, then a total:
  `Looked over 51 boxes: 49 behind, 2 tampered, 1 bricked.`
- **The order works as `patch`'s does**: with no name, the patrol; an unknown or repeated name,
  or missing env, exits 2 before anything is read. Exit 1 on a database error, naming the box and
  the read that failed. Usage: `Usage: guardian.ts report [name…] | patch [name…] | restore
  <name…>`.
- **The skill** (`.claude/skills/guardian/SKILL.md`, invoked as `/guardian [name…]`) runs one
  round:
  1. `report` on prod, for the names given or the patrol, checking the header names prod's host;
  2. shows the owner every tampered box with its reasons, and the behind and bricked totals;
  3. asks which tampered boxes to restore, "none" being an answer;
  4. `restore` the boxes picked, only those, and nothing when none is;
  5. `patch` the report's scope (a box just restored prints `up to date`);
  6. gives the owner the three totals.

  It runs no other prod command, never prints any part of the key, and stops on a non-zero exit
  with the line that says why. Reading a defaced page before choosing is done in the game (a
  `curl`), not by the skill.
- **The prod allow rule**: `.claude/settings.local.json` (gitignored, the owner's local setup)
  gains `npx dotenv -e .env.production.local -- npx tsx scripts/guardian.ts *`, for Bash and
  PowerShell, beside the valleynews rule. It goes in last, once the wire-check is green on dev.
- **Backlog**: a "Scheduled guardian" entry in `backlog.md`: rounds on a timer, and what that
  needs (prod credentials in a cloud routine, and a rule for restores with nobody there to pick),
  to revisit once the owner knows which rhythm feels right.

### Acceptance criteria

1. `guardian.ts report` with no name prints the 51 patrol boxes, one line each, then the total.
2. A box that was only visited (curled, scanned, logged into and out of) reports
   `N packages behind` or `up to date`, never `tampered`.
3. A box a player holds an open session on reports it, with the account.
4. A box a player wrote to (a defaced page, `/etc/passwd`, an edited log) reports every path
   written.
5. A bricked box reports `bricked, tampered`.
6. A box's `N packages behind` is the number a `patch` run right after it moves.
7. A report writes nothing: the box's journal and sessions are the same after it.
8. A box just restored reports `up to date` and untampered.
9. An unknown or repeated name, or missing env, exits 2 having read nothing.
10. `/guardian` runs a round as above, restores only the boxes the owner picked, and patches the
    rest.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The report decision** (`core/guardian/report.ts`): one box's journal, its open sessions and
   the day → behind and tampered; the line, the header and the total. Criteria 2–6 and 8 at the
   function.
2. **The script and its wire-check**: `guardian.ts report`; report checks in `testGuardian.ts`,
   run live. Criteria 1–9.
3. **The skill, docs and version 0.427.0**: `SKILL.md`; the handbook (03, 12, glossary);
   `backlog.md`'s scheduled guardian; `project-status.md`. Then the allow rule, locally.

### Evidence

- Unit tests under `npm test`; `npm run typecheck`; `npm run lint`; the bundle check (no change
  expected: everything new is script-side).
- Wire-check `scripts/testGuardian.ts` against `vercel dev` + local supabase.
- Mutation gate at PR readiness over `core/guardian/report.ts`.
- Criterion 10 at the close-out: the first `/guardian` round on prod, with the owner picking. The
  browser run comes with it.
