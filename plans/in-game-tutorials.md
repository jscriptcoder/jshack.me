# Plan: in-game tutorials

**Status**: Grilled and planned 2026-10-09. Next: slice 1 (acceptance criteria to confirm before
RED).
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
- **findit.io is the precedent for a fixed site.** Its names live in
  `generation/finditNetwork.ts` (a leaf, to dodge an init cycle through `publisher`); it is
  placed among the publishers in `generation/publisher.ts`, so world DNS resolves it and the
  index lists it. It is a real one-machine network: `sshd` + nginx, root from the uncrackable
  pool, falling only when a CVE window opens on the world clock.
- **`scripts/restoreFindit.ts` is the operator's undo**, and a restore is a reboot in a
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
   (not guest's, not root's, not any NPC box). About ten lines: `help`, `man`, `ls`/`cat`,
   `su root` with the password they chose, `apt install lynx`, `lynx http://hackademy.io`. It is a
   file on the box, so a visitor can tamper with it like any other.
9. **findit.io is named only on the site**, in the web chapter — the one in-world pointer to it.
10. **In-world voice**: written as a fictional collective's wiki. No fourth wall; never the word
    "game".
11. **Chapters**, each ending in a practice on your own box and pointing at `man` for syntax:
    1. Getting around — files, users, `su`, `nano`, `apt`, `man`
    2. Your box and its network — LAN, gateway, public address, NAT forwards, `rules.v4`
    3. Looking around — `ping`, `nmap`, `-sV`, `dig`, `whois`
    4. Getting in — `ssh`, `ftp`, `scp`, `nc`; passwords with `hydra` and `john`
    5. Services, versions and CVEs — `systemctl`, `ps`, `apt upgrade`, `msfconsole`
    6. The web — nginx and apache2, `curl`, `lynx`, `gobuster`, `robots.txt`, findit
    7. Traces — `auth.log`, `kern.log`, `access.log`
    8. Wifi
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

- **S1** the walking skeleton: hackademy.io answers, the README points to it, chapter 1 is there.
- **S2** findit lists hackademy.io, so a search for it finds it.
- **S3** chapters 2–4: your box and its network, looking around, getting in.
- **S4** chapters 5–7: services and CVEs, the web (the one pointer to findit), traces.
- **S5** chapters 8–10: wifi, databases and other services, scripting, with the example
  scripts under `/scripts/` (decision 12).

### Slice 1: a new player gets from `cat README` to reading chapter 1 on hackademy.io

**Value**: a player on a fresh box reads the README, becomes root, installs `lynx`, and reads
hackademy.io's front page and chapter 1. Like findit, the site is a real machine that can be
scanned, logged into and restored.
**Path**: `cat ~/README` (a file in the workstation's generated base tree) → `lynx
http://hackademy.io` → world DNS (`publisher.ts` `siteAddress`) → the address in the placeless
block (`world.ts`) → `resolveHttpFetch` → `resolvePublicTarget`'s gateway arm, where the
"gateway" is the hackademy box (`routerFs.ts` `apGatewayFs`) → `/var/www/html/index.html` and
the chapter 1 page, read like any other served file, with an `access.log` line written on the
box. `nmap`, `ssh`, `whois` and the restore reach it through the same arms findit uses.
**Shape to propose first** (the collapsed version): today findit is special-cased by
`essid === FINDIT_NETWORK` in eight places (`world.ts` address and drawn-name reservation,
`publisher.ts` DNS, `persona.ts`, `routerFs.ts`, `resolvePublicTarget.ts` hostname and fronted
segment, `whois.ts`), and the restore script is findit-only. With a second site, the leaf
`finditNetwork.ts` becomes `fixedSites.ts`: one table of fixed sites (`key`, `domain`,
`hostname`, `place`) and a lookup. Every check that means "a box that is its own gateway" asks
the table, and the one that means findit's search (`resolveHttpFetch`'s query) stays findit's.
`buildFinditFs` becomes `buildFixedSiteFs(site, webRoot)`: the same box (sshd and nginx, root
from the pool that can't be cracked, on the CVE timeline), with each site supplying its own
document root. hackademy.io takes the next placeless index after the corporations, so no address
that exists today moves. No second copy of any branch.
**Acceptance criteria (draft, to confirm before RED)**:
1. A fresh workstation has `/home/<username>/README`, owned by the player, which `cat` prints:
   about ten lines naming `help`, `man`, `ls`/`cat`, `su root` (the password chosen at the
   start), `apt install lynx` and `lynx http://hackademy.io`. `guest` and `root` homes are
   unchanged, and no NPC box has it.
2. `lynx http://hackademy.io` from any network renders the front page: the site's name, a short
   in-world welcome, and a numbered link to chapter 1. It lists only chapters that exist.
3. Following that link renders chapter 1, "Getting around": files and directories, users and
   `su`, `nano`, `apt`, `man`, ending in a practice on your own box. Every example targets the
   reader's own machine, and the page never names findit.
4. `curl http://hackademy.io/` returns the same HTML raw, and the visit appends a line to the
   hackademy box's `/var/log/access.log` under the visitor's address.
5. `nmap` on hackademy.io's address shows `22` and `80` open; `ssh root@hackademy.io` asks for a
   password and a wrong one is refused and logged in its `auth.log`.
6. `whois` on its address answers with the record `HACKADEMY-IO` / `hackademy.io`.
7. No drawn business takes the name hackademy, and every address the world held before this
   slice is unchanged.
8. findit.io behaves exactly as before: same address, front page, search, whois record and
   restore.
9. Every command example in the README and in hackademy's pages (each `$ ` / `# ` line of a
   `<pre>` block, every stage of a pipeline) names a registered command. Renaming one fails the
   test.
10. `scripts/restoreSite.ts hackademy.io` restores a defaced hackademy (sessions ended, journal
    emptied, a fresh boot marker), `scripts/restoreSite.ts findit.io` does what
    `restoreFindit.ts` did, and an unknown domain exits 2 without touching anything.
    `restoreFindit.ts` is gone, and the docs that name it name `restoreSite.ts`.
**RED**: `workstationFs.test.ts` for 1; `world.test.ts` / `publisher.test.ts` for the address,
DNS and name reservation (7); `whois.test.ts` (6); `resolvePublicTarget.test.ts` for the
hostname and no fronted segment; `resolveHttpFetch.test.ts` for 2–4 server-side; `lynx.test.ts`
for following the chapter link; a new `hackademy/pages.test.ts` for 3 and 9. findit's existing
tests are the guard for 8. Live: `scripts/testRestoreFindit.ts` becomes
`scripts/testRestoreSite.ts`, run once per domain, and a new `scripts/testHackademy.ts` fetches
`/` and chapter 1, scans `22`/`80` and checks the `access.log` line; both shown failing against
the pre-slice server first.
**Watch for**: the leaf exists to break an init cycle through `publisher` (its header says why),
so the table stays names-only and the box builders stay in the generator; `finditNetwork.ts`'s
importers (`whois`, `persona`, `publisher`, `world`, the scripts) all move to the table; the
generated web's cold-build budget (`checkBudgets`) must not move; the README adds bytes to every
workstation's base tree, so check any size budget that covers it; the chapter text is written
by me in the in-world voice and reviewed by the owner in the PR.
