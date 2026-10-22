# Plan: the guardian's rounds over the public web

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-22. Slice 1 is planned,
its choices and criteria confirmed; `feat/guardian-patch` is next.
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
