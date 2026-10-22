# Plan: the guardian's rounds over the public web

**Status**: Grilled. Decisions confirmed by the owner 2026-10-22. No slice is planned yet; the
slice plan is next.
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
