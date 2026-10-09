# In-game tutorials — as built

A new player learns the world from inside it. A short `README` in their home folder walks them
from the first prompt onto a network and into `lynx`, and `lynx` takes them to `hackademy.io`,
an in-world site that teaches the world's concepts and tools in ten chapters. The site is an
ordinary machine: it can be found, scanned, rooted and defaced like any other, and the operator
restores it the way findit is restored.

Built 2026-10-09 in six PRs, v0.335.0–v0.340.0: #631 (the walking skeleton: the box, the
README, chapter 1, `restoreSite.ts`), #632 (findit lists it), #633–#635 (chapters 2–10 and the
example scripts), #636 (the fixes a close-out browser run found).

## The rules

These were settled before a line was written and every chapter keeps them. A change that
breaks one is a design change, not an edit.

1. **Two parts.** The `README` only bootstraps; the tutorials live on the site, read with
   `lynx`. Nothing else is planted in the home folder.
2. **The site is attackable like every machine.** No exemption, no read-only pages: it can be
   rooted, defaced, bricked and read. Its posture is findit's exactly — `sshd` + nginx, root
   from the uncrackable pool, falling only when a CVE window opens on the world clock. Its
   world-readable `access.log` shows newcomers' addresses to anyone with a shell there; that is
   the price of rule 2, accepted.
3. **Concepts and tools, practised on your own box.** Every runnable example targets the
   reader's own box (`localhost`, their own address, accounts and files) or hackademy.io
   itself. No example chains steps into a break-in on someone else. A tool that can only reach
   another box (`hydra`, `msfconsole`, `snmpwalk`, `scp`, `ftp`) is described and sent to
   `man`, never run.
4. **No warnings.** The chapters describe how things work, the dangers included, and never tell
   the reader what to fear or do about it. A player learns the hard way.
5. **No new verbs.** Every example runs a registered command (`world-content-architecture.md`
   rule 2). A rename or removal fails the build instead of silently rotting a page.
6. **Every example runs as written** on a new player's box: each chapter installs, with
   `# apt install …`, every tool it uses that a fresh box lacks, before its first example.
7. **findit is named once**, in prose in the web chapter — the world's only pointer to it.
8. **In-world voice.** The site is a fictional collective's wiki. No fourth wall; never the
   word "game".
9. **Each chapter ends in Practice**, a short list of things to try on your own box, and links
   on to the next chapter. The front page lists the chapters in order.

## The pieces

| Piece                                                                                                                                                              | Where                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| The `README` (`WELCOME_README`), planted in `/home/<username>/README` of the player's own box only, owned by the player                                            | `src/core/hackademy/readme.ts`, `generation/workstationFs.ts` |
| Every file the site serves (`HACKADEMY_PAGES`): the front page, ten chapters, `robots.txt`, `scripts/hello.js`, `scripts/failed.js`                                | `src/core/hackademy/pages.ts`                                 |
| The fixed-site table: hackademy.io and findit.io, names only (a leaf, to dodge an init cycle through `publisher`)                                                  | `generation/fixedSites.ts`                                    |
| The box: one machine that is its own gateway, the files of `HACKADEMY_PAGES` under `/var/www/html` (a key with a path, `scripts/hello.js`, lands in its directory) | `generation/fixedSiteFs.ts`                                   |
| findit's listing of a fixed site, under its domain                                                                                                                 | `findit/webIndex.ts` (see `discovery-architecture.md`)        |
| The operator's undo                                                                                                                                                | `scripts/restoreSite.ts <domain>`                             |

hackademy.io answers at `193.249.140.121`. The pages are part of the box's generated tree, so
a content change reaches the live site at once — unless a player has written over that page,
in which case the journal wins until a restore.

### The README

Seventeen lines, plain text. It names each step and explains none: get on a network
(`airmon-ng start wlan0`, `airodump-ng`, `aircrack-ng BSSID`, `airmon-ng stop wlan0`,
`nmcli connect ESSID PASSWORD`), then `su root` with the password the player chose,
`apt install lynx`, `lynx http://hackademy.io`. It walks the player online first because a
fresh box is on no network, and `apt` cannot work until it is. Placeholders are uppercase
words because the shell cannot parse `<bssid>`.

### The chapters

1. **Getting around** — files, users, `su`, `nano`, `apt`, `man`.
2. **Wifi** — monitor mode, `airodump-ng`, `aircrack-ng` (and the networks it cannot do),
   `nmcli`.
3. **Your box and its network** — the leased address, the `.1` gateway, the one public address
   a network shares, a gateway forward, a `deny` line in `rules.v4`.
4. **Looking around** — `ping`, `nmap`/`-sV` on your own address, `dig`/`nslookup` and `whois`
   on hackademy.io. A range scan is described and sent to `man nmap`.
5. **Getting in** — `ssh root@hackademy.io` (a real prompt; a wrong password is refused and
   lands in the site's `auth.log`), `scp`/`ftp` described, `nc` on your own box, `john` on your
   own `/etc/passwd` with the wordlist `hydra` ships. `hydra` is described.
6. **Services, versions and CVEs** — `ps`, `systemctl status`/`start`/`stop`, `apt update`/
   `list --upgradable`/`upgrade`; the CVE model without an attack; `msfconsole` described.
7. **The web** — `curl` and `lynx` on hackademy.io and its `robots.txt`, your own nginx on
   `localhost`, `gobuster http://localhost`; findit named.
8. **Traces** — `auth.log`, `kern.log` (every port scan, restart and crash) and `access.log`,
   read with `cat`/`tail`/`grep`. That a root can rewrite a log is said plainly.
9. **Databases and other services** — your own `mysql` and `redis` (both opened by your own
   root password) on `localhost`; `snmp` installed, `snmpwalk` described.
10. **Scripting with node** — `curl http://hackademy.io/scripts/hello.js > hello.js`, then
    `node`; `failed.js` tallies the failed logins in your own `auth.log` by address.

The two scripts are not linked from any page; the chapter's `curl` examples are the way to
them. `robots.txt` asks search engines to leave `/scripts/` alone (findit reads front pages
only, so it changes nothing there).

## How it is tested

`src/core/hackademy/hackademy.test.ts` reads every page off the box the way a visitor's
browser gets it, through `resolveWebPath` and the box's own tree, and checks the rules:

- **The front page** lists the chapters in order and links only to files the site serves.
- **Each chapter** (a `describe.each` table): titled for what it teaches in `<title>` and
  `<h1>`, its tools shown in prompted examples, Practice its last `<h2>`, and its only chapter
  link the next one (none for the last).
- **Every page**: reachable from the front page; findit named only in the web chapter; no
  example names another host (an IPv4 address or a domain other than hackademy.io).
- **Every example** — a `<pre>` line starting at a `$ ` or `# ` prompt, on the site and in the
  README:
  - runs only registered commands (rule 5);
  - runs only programs a fresh workstation has, or one an `apt install` earlier in the same
    text provides (rule 6);
  - never aims `ssh`, `scp` or `ftp` at `localhost`, since those doors reach other boxes only;
  - fetches only hackademy.io addresses the site serves;
  - runs a script with `node` only after an earlier example saved it from the site.
- **The scripts** are served under `/scripts/` and run through the real `node` command and
  registry on a new player's generated box with an `auth.log` of failed logins.

`scripts/testHackademy.ts` is the live wire-check against `vercel dev` + supabase: every file
served byte for byte at the site's address, the visit in its `access.log`, a scan finding 22
and 80, a wrong root password refused and logged, findit listing it before and after it has
been visited, and the front page linking every chapter. `scripts/testRestoreSite.ts
hackademy.io` checks the restore.

## Adding a chapter or a script

1. Write the page in `pages.ts` with `page(title, body)`, ending in a `Practice` section,
   `next(href, title)` and `BACK`; give the previous chapter a `next()` to it; add it to the
   front page's `<ol>` and to `HACKADEMY_PAGES`.
2. Add its row to `CHAPTERS` in `hackademy.test.ts`, and the chapter name to the front-page
   list in `scripts/testHackademy.ts`.
3. Read each command's implementation before writing an example for it: whether it reaches
   `localhost` is a fact of its code (`ownBoxSource` in `network/interfaces.ts` is the shared
   own-box resolver), and the browser run found a chapter that assumed otherwise.
4. Write prose straight into the file, as HTML `lynx` renders: headings, paragraphs, lists,
   `<pre>`, links. Escape `>` and `<` in examples (`&gt;`, `&lt;`) and possessives as `&#39;`.
   Use uppercase placeholders (`ADDRESS`, `SERVICE`, `PASSWORD`). Lines typed inside another
   prompt (`mysql>`, `redis>`) carry that prompt and are not checked as commands.
5. A script goes in `HACKADEMY_PAGES` under `scripts/`, with an example that saves it
   (`curl … > name.js`) before one that runs it.

## Operating it

`npx dotenv -e .env.development.local -- npx tsx scripts/restoreSite.ts hackademy.io` ends every
session on the box, deletes its journal (a defacement, a planted file, its logs) and writes a
fresh boot marker — a reboot into the current generated site. It is safe to run twice; with no
`SUPABASE_*` env it exits 2 without touching anything.

## Accepted gaps

- **Only an example's command is checked, never its arguments.** A bare `systemctl status`
  shipped that way and was caught only by the browser run. The pre-release argument-realism
  pass (`backlog.md`) rewrites the examples with the commands.
- **The `ssh`/`scp`/`ftp`-at-`localhost` rule encodes a fact of the commands.** If those doors
  ever gain an own-box path, delete the rule and put the own-box examples back in chapter 5.
- **The install rule reads a fresh box**, so a chapter installs its tools even when a reader in
  order already has them from an earlier chapter.
- **`failed.js` has not tallied a real outside knock in a browser.** The close-out run could not
  put two players on one network (which networks a player sees is drawn from their identity).
  The tally is unit-proven through the real `node`, `grep` and auth-log format, and outside
  failed logins landing in `auth.log` are wire-proven.
- **Prose is reviewed, not tested.** Mutation runs on these files leave the prose strings as
  survivors by design; the structure (the map, the chain, titles, the rules above) is killed.
