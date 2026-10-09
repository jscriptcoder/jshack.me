# Plan: in-game tutorials

**Status**: S1 (v0.335.0, #631), S2 (v0.336.0, #632), S3 (v0.337.0, #633) and S4 (v0.338.0, #634)
built, 2026-10-09. Next: slice 5, chapters 8–10 (traces, databases and other services, scripting
with `node`, with the example scripts under `/scripts/`), to be planned in detail and its
acceptance criteria confirmed before RED.
Resolves the `docs/backlog.md` entry "Tutorials dropped into the player's home folder" (shape
still to be decided) and the `docs/project-status.md` note that in-game tutorials matter once
others playtest. Where they disagree with this file, this file wins.

## Goal

A new player learns the world from inside it. A short `README` in their home folder gets them
from the first prompt to `lynx`, and `lynx` takes them to `hackademy.io`, an in-world site that
teaches the world's concepts and tools chapter by chapter. The site is an ordinary machine:
it can be found, scanned, rooted and defaced like any other, and the operator restores it as
findit is restored.

## Where it starts from (facts, 2026-10-09)

- **A workstation's base tree is a pure function of its owner's identity**
  (`generation/workstationFs.ts`); the journal holds only what players changed. A file planted
  in the base tree updates with the code unless a player edited or removed it.
- **The player picks their own root password** on the intro form (`ui/screens/Intro.tsx`), so
  `su root` and `apt install lynx` on their own box cannot fail them.
- **`lynx` is not preinstalled**; `apt install lynx` (root-tier) ships it. It renders headings,
  lists, `<table>`, `<pre>` and numbered links, and submits forms.
- **`cat`, `man` and `help` exist; there is no pager.** A long file scrolls past.
- **findit.io is the precedent for a fixed site.** Its names lived in
  `generation/finditNetwork.ts` (a leaf, to dodge an init cycle through `publisher`; S1 turned it
  into `fixedSites.ts`); it is
  placed among the publishers in `generation/publisher.ts`, so world DNS resolves it and the
  index lists it. It is a real one-machine network: `sshd` + nginx, root from the uncrackable
  pool, falling only when a CVE window opens on the world clock.
- **`scripts/restoreFindit.ts` was the operator's undo** (S1 replaced it with
  `restoreSite.ts <domain>`), and a restore is a reboot in a
  load-bearing order: end every open session, delete the journal, write a fresh boot marker.
- **Redirection and `node` exist**: `curl … > file` saves a page, and `node x.js` runs a
  script whose output pipes and redirects like any command's.
- **Content may not add verbs** (`world-content-architecture.md` rule 2): tutorials describe
  only the shipped command surface.

## Decisions (owner-confirmed 2026-10-09)

Grilled singly:

1. **The split.** A short welcome file in the player's home folder bootstraps; the tutorials
   themselves live on an in-world website read with `lynx`. Rejected: home-folder-only (no
   links, long files scroll past, everything in a guest's reach) and web-only (needs a banner
   mechanism, and the bootstrap scrolls away).
2. **The site is attackable like every machine. No exceptions.** It can be rooted, defaced,
   bricked and read; the operator restores it as findit is restored. Rejected: an unharmable
   site served from code, and a half-measure whose pages cannot be defaced but whose box falls.
3. **Concepts and tools, practised on your own box.** Each chapter explains a part of the world
   and the tools that touch it; every example targets `localhost` or the player's own machine.
   The tutorials never chain steps into a break-in on someone else, and they describe the
   danger without warning anyone (no "you will be attacked, do this now"). Rejected: a guided
   first break-in (spoils the central discovery) and a reference-only `man` (teaches no model).

Accepted in bulk:

4. **`hackademy.io` is its own fixed one-machine network**, findit's shape: its names in a leaf
   module, placed among the publishers so DNS resolves it and findit indexes it.
5. **Its posture is findit's exactly**: `sshd` + nginx, root from the uncrackable pool, falling
   only on the world clock, no bespoke weakness. Its world-readable `access.log` shows
   newcomers' addresses to anyone with a shell there — accepted as the price of decision 2.
6. **One restore script, `scripts/restoreSite.ts <domain>`**, generalised from
   `restoreFindit.ts`, covering findit and hackademy.io — two real callers. It keeps the reboot
   order.
7. **The pages are generated files** in the box's `/var/www/html`, built from content in code
   as part of its base tree: a content update reaches the live site unless that page was
   defaced, and a restore brings the current version. HTML only within what `lynx` renders
   (headings, paragraphs, lists, `<pre>`, links).
8. **The welcome file is `/home/<username>/README`**, plain text, in the player's own home only
   (not guest's, not root's, not any NPC box). It is a file on the box, so a visitor can tamper
   with it like any other. **Amended during S1 (owner, 2026-10-09):** a fresh box is on no
   network (only `lo` has an address), so `apt install lynx` cannot work from the first prompt.
   The README therefore walks the player online first — `airmon-ng start wlan0`, `airodump-ng`,
   `aircrack-ng BSSID`, `airmon-ng stop wlan0`, `nmcli connect ESSID PASSWORD` — then `su root`
   with the password they chose, `apt install lynx`, `lynx http://hackademy.io`. Each step named,
   none explained; at most 20 lines (17 as built). Placeholders are uppercase words because the
   shell cannot parse `<bssid>`. Rejected: a hint only (players stuck before ever reaching the
   tutorials) and command names without arguments.
9. **findit.io is named only on the site**, in the web chapter — the one in-world pointer to it.
10. **In-world voice**: written as a fictional collective's wiki. No fourth wall; never the word
    "game".
11. **Chapters**, each ending in a practice on your own box and pointing at `man` for syntax.
    WiFi moved from 8 to 2 with decision 8's amendment: it explains the first thing the README
    already had the player do.
    1. Getting around — files, users, `su`, `nano`, `apt`, `man`
    2. Wifi — monitor mode, `airodump-ng`, `aircrack-ng`, `nmcli`
    3. Your box and its network — LAN, gateway, public address, NAT forwards, `rules.v4`
    4. Looking around — `ping`, `nmap`, `-sV`, `dig`, `whois`
    5. Getting in — `ssh`, `ftp`, `scp`, `nc`; passwords with `hydra` and `john`
    6. Services, versions and CVEs — `systemctl`, `ps`, `apt upgrade`, `msfconsole`
    7. The web — nginx and apache2, `curl`, `lynx`, `gobuster`, `robots.txt`, findit
    8. Traces — `auth.log`, `kern.log`, `access.log`
    9. Databases and other services — `mysql`, `redis`, `snmp`
    10. Scripting with `node`
12. **Scripting examples are files on the site** (`curl http://hackademy.io/scripts/x.js > x.js`,
    then `node x.js`), exercising `curl`, redirection and `node`. Nothing beyond the `README` is
    planted in the home folder.
13. **No new verbs.** A test checks that every command example in the tutorials names a
    registered command, so a rename or removal fails the build instead of silently rotting a
    page. The pre-release argument-realism pass (`backlog.md`) rewrites the examples with it.
14. **Slice 1 is the walking skeleton**: the hackademy.io box, `restoreSite.ts`, the `README` and
    chapter 1 — `cat README` → `apt install lynx` → chapter 1. Later slices add chapters in
    groups. One browser run at close-out covers them all.

    One move made while planning: findit's index lists two kinds of site, an institution
    (gateway forwarding to its site server) and a player's network, and never a box that IS its
    own gateway. So "findit indexes it" (decision 4) needs a third kind of listing, and it gets
    its own slice (S2) instead of widening the walking skeleton.

## Slices

Every slice is a **behavior change** and its own PR against `main`, cut after the previous one
lands (`/continue`). Each loads `tdd`, `testing` and `refactoring` before code, confirms its
acceptance criteria with the owner before RED, bumps the version, and runs the mutation gate
once at PR readiness (json reporter, one file at a time, `conventions-and-gotchas.md`). Slices
after S1 are planned in detail when their turn comes. The close-out (as-built doc, backlog
entry, retiring this file) is a `docs(v2):` commit on `main`, after the one browser run.

- **S1** ✅ the walking skeleton: hackademy.io answers, the README points to it, chapter 1 is
  there.
- **S2** ✅ findit lists hackademy.io, so a search for it finds it.
- **S3** ✅ chapters 2–4: wifi, your box and its network, looking around.
- **S4** ✅ chapters 5–7: getting in, services and CVEs, the web (the one pointer to findit).
- **S5** chapters 8–10: traces, databases and other services, scripting, with the example
  scripts under `/scripts/` (decision 12).

### Slice 1 ✅: a new player gets from `cat README` to reading chapter 1 on hackademy.io

**Built** v0.335.0, #631 (squash `0d6fa0ab`), 2026-10-09. All ten acceptance criteria met, with
AC1 amended as decision 8 records (the README walks the player online first).

**As built**:
- **One table of fixed sites.** `generation/fixedSites.ts` (the old `finditNetwork.ts` leaf,
  names only) holds `FIXED_SITES` (`key`, `domain`, `hostname`, `place`) and `fixedSite(key)`.
  Every check meaning "a box that is its own gateway" asks it: `world.ts` (drawn-name
  reservation), `publisher.ts` (DNS), `persona.ts`, `routerFs.ts`, `resolvePublicTarget.ts`
  (hostname, no fronted segment), `whois.ts` (netname `HACKADEMY-IO`). findit keeps its own
  `FINDIT_*` names because its search is the one thing only it does. Landed first as a pure
  refactor: the same 2,751 tests green before and after.
- **The box.** `generation/fixedSiteFs.ts` `buildFixedSiteFs(site)` (was `findit.ts`
  `buildFinditFs`), with each site's document root in a `WEB_ROOTS` map beside it, not in the
  table, because the table must stay names-only. Each site seeds its own root password.
- **The address.** hackademy.io answers at `193.249.140.121`, the next placeless index after the
  corporations; a before/after dump of all 613 network addresses differs only by that line.
- **The content.** `src/core/hackademy/readme.ts` (`WELCOME_README`, planted by
  `workstationFs.ts`, owned by the player, `HOME_FILE` permissions) and
  `src/core/hackademy/pages.ts` (`index.html`, `getting-around.html`). `hackademy.test.ts` reads
  the pages off the box: front-page links, chapter 1's tools and closing Practice, no page naming
  findit, no example naming another host, and every `$ `/`# ` example (README included) running
  only registered commands.
- **Restore.** `scripts/restoreSite.ts <domain>` replaced `restoreFindit.ts`; an unknown domain
  exits 2 before touching anything. Docs and the e2e skill name it.
- **Wire-checks.** New `scripts/testHackademy.ts` (6/6: pages byte-for-byte, the access.log line,
  a scan finding 22 and 80, a wrong root password refused and logged).
  `scripts/testRestoreSite.ts <domain>` (was `testRestoreFindit.ts`): hackademy 13/13, findit
  14/14. It had been failing on `main` since `exploitCreateSession` started requiring
  `caller_machine_id`; it passes one now. Not shown failing against the pre-slice server.
- **Mutation.** `fixedSites.ts` 20/20. `fixedSiteFs.ts` 31 killed / 8 survived after three new
  tests; the 8 are carried-over findit builder lines (root's gecos and home, the `/usr/bin` and
  `/usr/sbin` tool lists), deferred. Survivors in `resolvePublicTarget.ts` and `publisher.ts`
  were killed by the wider related suite when hand-mutated; the whois regex and the `.io`
  name reservation are equivalent.

### Slice 2 ✅: a search on findit finds hackademy.io

**Built** v0.336.0, #632 (squash `263aa756`), 2026-10-09. All seven acceptance criteria met, with
the recommended description.

**As built**:
- **A third kind of listing.** `findit/webIndex.ts` lists publishers, player networks and now
  fixed sites: every entry in `FIXED_SITES` except findit, which a searcher is already on. Each is
  listed under its domain, and its one box joins the batch journal read. Untouched, it is
  listed from the generated web. Touched, it is rebuilt from its journal:
  - its own nginx answering (`router`) is listed from `siteOn(box)`;
  - a forward elsewhere is fetched through `siteAt`;
  - dark, or shut out by `robots.txt`, is not listed.
  `publisherMachineIds` became `siteMachineIds` and includes the fixed site's box.
  `generatedEntry` builds the kept listing for publishers and fixed sites alike.
- **The front page describes itself.** `hackademy/pages.ts` `page()` takes an optional
  description, which the front page gives: *"Tutorials for newcomers: how boxes, networks and the
  tools that touch them work, a chapter at a time, tried on your own box."* `hackademy`,
  `tutorial` and `newcomer` all find it.
- **Tests.** `webIndex.test.ts` has 13 new tests under "a site that is its own gateway".
  "Never lists findit" now also checks the domain `findit.io`. Chapter 1's title test checks
  `<title>` as well as the `<h1>`.
- **Wire-checks.** `testHackademy.ts` is 9/9. Its 3 new search checks run before any visit and
  again once the log has rows: following the result reaches the front page, and `tutorial`
  finds it. They fail against the pre-slice index. `testFindit` is 19/19 before and after.
- **Carried risk, measured.** `testFindit`'s COST line read about 2.9 s per search before and
  after, against about 2.2 s for one fetch, so the uncapped access-log journal goes nowhere for
  now. COST's journal-row count prints `?`, on `main` too, so that count query is broken.
- **Mutation.** 162 killed / 106 survived over `webIndex.ts` and `pages.ts`, mostly tutorial text
  and pre-existing index lines. Hand-applied on the changed lines:
  - **Killed:** the findit exclusion (a module-load mutant Stryker mis-scores) and a chapter's
    `<head>` (killed by the new title check).
  - **Equivalent:** the generated-web cache (a miss rebuilds the same page), a junk entry that
    would not typecheck, and the `<html>`/`<body>` literals.
  - **Deferred:** chapters gaining `<meta content="undefined">`; findit reads only front pages.

### Slice 3 ✅: chapters 2–4, wifi, your box and its network, looking around

**Built** v0.337.0, #633 (squash `a17bda39`), 2026-10-09. All seven acceptance criteria met.

**As built**:
- **Three chapters on `hackademy/pages.ts`.** `WIFI` (`wifi.html`), `YOUR_NETWORK`
  (`your-network.html`) and `LOOKING_AROUND` (`looking-around.html`) join `HACKADEMY_PAGES`
  after chapter 1. The front page lists all four in order; each chapter links back and on to
  the next through a small `next(href, title)` helper, chapter 1 now reaching chapter 2 and
  chapter 4 ending the chain.
  - **Wifi**: monitor mode on/off, `airodump-ng`'s table, `aircrack-ng` on a BSSID (and the
    networks it can't do — WPA3, weak signal, hidden ESSID), `nmcli connect`/`status`.
  - **Your box and its network**: the leased address and the `.1` gateway off `ifconfig`; the
    one public address the whole network shares and that every visited site logs, which no
    command on the box prints; a gateway `forward` line shown as file content, not a command;
    a `deny` line the player writes under `su root` + `mkdir -p /etc/iptables` + `nano`.
  - **Looking around**: `ping ADDRESS`, `nmap`/`-sV ADDRESS`, `dig`/`nslookup hackademy.io`,
    `whois hackademy.io`. Range scans and pinging the gateway are described in prose and sent
    to `man nmap`, never run, since they would target boxes that are not the reader's.
  Uppercase `ADDRESS`/`BSSID`/`ESSID`/`PASSWORD` placeholders, as the README uses, because
  `nmap`/`ping` take no `localhost`. Two possessive apostrophes written `&#39;` to match
  chapter 1's ASCII body; em-dashes left raw, as the command manuals have them. `DOMParser`
  decodes both in the lynx renderer.
- **Tests.** `hackademy.test.ts` folds chapter 1's three tests into one `describe.each` table
  over the four chapters — title in `<title>` and `<h1>`, each chapter's tools shown in a
  prompted example, Practice the last `<h2>`, the onward link exactly the next chapter (none
  for the last) — plus the front page's ordered chapter list. 23 tests, 14 of them RED first.
  The S1 site-wide rules (reachable, local links served, findit unnamed, no foreign host,
  registered commands only) covered the new pages with no change.
- **Wire-checks.** `testHackademy.ts` now loops `HACKADEMY_PAGES`, serving every page
  byte-for-byte, and checks the front page links to every chapter: 12/12 live. `testFindit`
  19/19, untouched by the slice. vercel dev stopped; supabase left running.
- **Mutation.** The only new structural logic is `next()` and the chapter-list / page-map
  wiring; the rest is prose, reviewed in the PR (AC5). Hand-applied, all killed by the table
  tests: `next()` → empty and → fixed href, a chapter dropped from `HACKADEMY_PAGES`, a front
  page `<li>` removed, a mis-titled chapter, a renamed Practice heading. Prose-string
  survivors are the accepted norm, as in S1 and S2.

**Weakest calls, carried** (owner-flagged at planning, unchanged):
- **"Looking around" shows no LAN range scan and no `ping` of the gateway** — both target
  boxes that are not the reader's (decision 3); the prose points at `man nmap` for the range.
- **Only an example's command is checked, never its output.** The close-out browser run walks
  the chapters.

### Slice 4 ✅: chapters 5–7, getting in, services and CVEs, the web

**Built** v0.338.0, #634 (squash `68a1d2a5`), 2026-10-09. All seven acceptance criteria met.

**As built**:
- **Three chapters on `hackademy/pages.ts`.** `GETTING_IN` (`getting-in.html`), `SERVICES`
  (`services.html`) and `THE_WEB` (`the-web.html`) join `HACKADEMY_PAGES` after chapter 4. The
  front page lists all seven in order; chapter 4 now links on to chapter 5 through the existing
  `next(href, title)` helper, and chapter 7 ends the chain until S5.
  - **Getting in**: `ssh`/`ftp`/`scp` as the doors, pointed at `localhost` (the box you stand
    on); `nc` connecting to a port and holding one open with `-l`; and the credential tools —
    `john /etc/passwd` on the reader's own accounts (no network, no log), the wordlist arriving
    with `apt install hydra`. `hydra` is described and sent to `man hydra`, not run: it knocks on
    a live service and lands in that box's logs, a break-in on someone else (decision 3).
  - **Services, versions and CVEs**: `ps` and `systemctl status`/`start`/`stop` for what runs,
    `apt update`/`list --upgradable`/`upgrade` for the reader's own exposed packages. The CVE
    model — a version, a published fix, a window on the world clock — is taught without an attack
    or a warning; the console (`msfconsole`) is described and sent to `man`, not run.
  - **The web**: `curl` and `lynx` reading hackademy.io; `apt install nginx` + `systemctl start`
    + `curl http://localhost/` running the reader's own server; `gobuster http://localhost`
    sweeping it; `robots.txt`; and findit named in prose — the one in-world pointer (decision 9),
    never a runnable example, so the foreign-host rule stays green.
  `localhost`/`SERVICE`/`USERNAME`/`PORT` placeholders keep every example on the reader's own box
  or hackademy.io; `&#39;` possessives as in the earlier chapters.
- **Tests.** `hackademy.test.ts` gains three rows in the `describe.each` table (seven chapters
  now) and a `WEB_CHAPTER` constant; the old `never names findit` rule becomes "names findit only
  in the web chapter". 35 tests, 14 of them RED first. The S1 site-wide rules (reachable, local
  links served, registered commands only, no foreign host) covered the new pages with no change.
- **Wire-checks.** `testHackademy.ts` serves every page byte-for-byte (15/15) and now checks the
  front page links to all seven chapters; `testFindit` 19/19, untouched. vercel dev stopped;
  supabase left running.
- **Mutation.** The only new structural logic is the three constants and the page-map /
  front-page / onward-link / findit-rule wiring; the rest is prose (AC-reviewed). Hand-applied,
  all 8 killed: a page dropped from the map, chapter 4's onward link removed and mis-pointed,
  each new chapter mis-titled, the web chapter ceasing to name findit, a front-page entry
  removed. Prose-string survivors are the accepted norm, as in S1–S3.

**Weakest calls, carried**:
- **`hydra` and `msfconsole` are described, not run** — both aim at a box that is not the
  reader's (decision 3); the prose points at `man`, the same line "Looking around" drew for a
  LAN range scan.
- **The web build-time budget is timing-flaky on the build machine** — samples 878–1137 ms
  against a 1000 ms ceiling; the pre-slice baseline breaches it too (685–1075 ms on the same
  loaded machine), so the slice adds no regression (site count unchanged at 358, three static
  strings on one site). ~550–800 ms when the machine is quiet, where S3 measured it.
- **Only an example's command is checked, never its output.** The close-out browser run walks
  the chapters.
