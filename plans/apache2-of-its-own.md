# Plan: apache2 of its own

**Status**: Grilled and planned 2026-10-08. Slices 1–2 built (v0.331.0 #625, v0.332.0 #626).
Next: slice 3 (planned, acceptance criteria confirmed).
Resolves the §9 follow-up "`apache2` is hollow, so a workstation is never born with it" in
`docs/conventions-and-gotchas.md` (owner-agreed 2026-10-07), widened by the owner to the
generated world. Where they disagree with this file, this file wins.

## Goal

`apache2` becomes a real second web server rather than a second name for nginx. Every tool that
looks at a box tells which of the two is running: `ps`, `systemctl`, `nmap -sV`, `curl`'s
`Server` header, `msfconsole` and the trace it leaves. apache2 gets a release history of its
own, so the world clock publishes holes in it on its own schedule. Then it goes back into a workstation's
birth pool 50/50 with nginx, and generated web hosts split between the two the same way.

## Where it starts from (facts, 2026-10-08)

- **One catalog row for the web.** `SERVICE_CATALOG.http` (`services/serviceCatalog.ts`) carries
  `package: 'nginx'`, `pidfile: 'nginx.pid'` and `formatExploit: syslogExploitLine('nginx')`.
  The `apache2` daemon (`commands/daemon.ts` `webServerDaemon`) binds that same row, so starting
  it writes `/var/run/nginx.pid`. Mutual exclusion is the shared pidfile; there is no generic
  port-in-use check.
- **Every reader keys on the row.** `ps` prints `daemonName(spec)`, the pidfile basename
  (`services/pidfile.ts`). `readOpenPorts` (nmap's version + CVE) and `exploitCreateSession`
  (server authorization) both look the version up in the manifest under `spec.package`.
  `curl.ts` hardwires its `Server` header from `SERVICE_CATALOG.http.pidfile`. So a running
  apache2 reports as nginx everywhere.
- **`systemctl` shares one unit on purpose.** `commands/systemctl.ts` resolves both `nginx` and
  `apache2` to a unit titled `nginx`, so a stop never claims apache2 ran when nginx did.
- **No release history.** `packages/packageVersions.ts` has no `apache2` template, so
  `startingVersionOf('apache2')` is undefined, no manifest row is written, and `nmap -sV` shows no
  version. `cve/exploitEffect.ts` has no `apache2` effect pool. CVE numbers 1–21 are taken.
- **apt sells it.** `packages/aptPackages.ts` has `{ name: 'apache2', daemons: ['apache2'] }`
  beside nginx's.
- **Birth leaves it out.** `boot/firstBoot.ts` draws the web slot as `nginx` only.
- **The generated world is nginx throughout.** `generation/pools/configFiles.ts` writes only
  nginx-style `httpd.conf` templates (its comment explains why apache2 is never handed out);
  `pools/webPages.ts`, `pools/cronMail.ts` and `pools/etcFiles.ts` name nginx; the boot syslog's
  unit description is keyed by service (`pools/logLines.ts` `SERVICE_UNIT_DESCRIPTIONS.http`).
  The access log is the neutral `/var/log/access.log`.

## Decisions (owner-confirmed 2026-10-08)

Grilled singly:

1. **One pidfile per program**, as on Debian: apache2 writes `/var/run/apache2.pid`, nginx
   `nginx.pid`, and both map to the one `http` service (port, `access.log`, served pages). Either
   start is refused while either pidfile exists: `apache2: web server already running on port 80`.
   A root player who hand-writes both gets two rows, as faking any pidfile already does. Rejected:
   one neutral `httpd.pid` whose line names the program, because it breaks "the pidfile name is the
   program" that every other reader relies on.
2. **Generated (NPC) web hosts split too**, not only workstations.

Accepted in bulk:

3. **`ps`** names the program for free (COMMAND is the pidfile basename).
4. **`systemctl` gets two real units**, `nginx` and `apache2`, as real systemd has.
   `systemctl stop nginx` while apache2 runs answers that nginx is inactive and stops nothing. This
   undoes the shared-unit design.
5. **`curl -i`'s `Server` header** names the running program (lynx prints no headers).
6. **The exploit trace** is tagged with the program that was hit (`apache2[pid]: …`).
7. **A release history:** package `apache2`, permanent CVE number **22**, `nmap -sV` display
   `Apache/2.4.62` (the `Server`-header style nginx's `nginx/1.26.0` uses), start tuple `2.4.62`.
   Its own timeline, CVE ids, `apt list -u` and `apt upgrade` rows.
8. **Its own effect pool**, the same size as nginx's, leaning a little more to file read and script
   execution so the two web servers fire differently.
9. **One version and CVE source:** `nmap -sV`, `msfconsole` (client render and server
   authorization) and the trace look up the package of the program that is RUNNING, never the
   catalog row's. On a box with both installed, the running one decides.
10. **Birth:** the web slot draws nginx or apache2 50/50, so the odds of a born web server do not
    change. The boot line uses each program's own systemd description: apache2's is
    `The Apache HTTP Server`; nginx keeps its current one.
11. **NPCs:** a generated host that rolls the web service gets apache2 or nginx 50/50, seeded on
    the box. An apache2 box agrees with itself: the `apache2` binary in `/usr/sbin`,
    `apache2.pid`, a manifest row at the start tuple, an Apache-style `httpd.conf` (filename
    unchanged), and admin histories and cron mail naming `apache2`. Router admin UIs, `findit.io`
    and the other fixed sites stay nginx.
12. **Slices, each shippable alone:**
    - **S1** apache2 is its own program (decisions 1, 3–5, and the boot-line half of 10).
    - **S2** its release history (6–9). Touches server-side exploit authorization, so it needs a
      wire-check.
    - **S3** back into the birth pool (the draw half of 10).
    - **S4** NPC web hosts (11).

    Two moves made while planning, both following from what can be observed when: the trace tag
    (6) moved to S2, because an apache2 door cannot be fired until it has a version, so nothing
    in S1 could show the tag. The boot line (10) moved to S1, because S1 gives each unit its
    systemd description anyway, and a player who installs apache2 and reboots would otherwise
    read nginx's line from S1 until S3.

## Slices

All four are a **behavior change**, one independent PR against `main` each, cut after the
previous one lands (`/continue`). Each loads `tdd`, `testing` and `refactoring` before code,
confirms its acceptance criteria with the owner before RED, bumps the version, and runs the
mutation gate once at PR readiness (json reporter, one file at a time, `conventions-and-gotchas.md`
§4). S2–S4 are planned in detail when their turn comes; the close-out (docs, the §9 entry,
retiring this file) is a `docs(v2):` commit on `main` after S4.

### Slice 1: apache2 runs as itself, and every tool that names the running web server says so

**Built**: v0.331.0, #625. The acceptance criteria were confirmed with `Server: Apache`. First
boot's "already started?" check still reads the default pidfile; slice 3 fixes it.

**Value**: a player who runs `apache2` sees apache2, not nginx, in `ps`, `systemctl`, `curl -i`
and the boot screen, and the two web servers are two units as on a real box.
**Path**: `apache2` / `systemctl start apache2` → `daemon.ts` `startDaemon` writes the
program's own pidfile → `pidfile.ts` `readRunningProcesses` maps either pidfile to the `http`
service and keeps the program → `ps` COMMAND, `systemctl` status/stop/restart, the boot screen
line, and `curl`'s `Server` header (LAN and hop paths client-side; across the network through
`network/resolveHttpFetch.ts`, which returns it).
**Shape to propose first** (the collapsed version): the `http` catalog row names its programs
(nginx, apache2), each with its own pidfile; every other row has exactly one. A running service
carries the program its pidfile named. No second catalog row, and no generic port-in-use check:
the web gate asks whether ANY of the row's pidfiles exists.
**Acceptance criteria (draft, to confirm before RED)**:
1. Root runs `apache2` on a box with it installed: `/var/run/apache2.pid` holds
   `apache2:port=80`, and `ps` shows COMMAND `apache2`.
2. `nginx` or `systemctl start nginx` while apache2 runs is refused with
   `nginx: web server already running on port 80`, and the reverse is the same.
3. `systemctl status apache2` shows `● apache2.service - The Apache HTTP Server` and
   `Active: active (running) on port 80`; `systemctl status nginx` at the same moment shows
   `○ nginx.service - A high performance web server and a reverse proxy server` and
   `Active: inactive (dead)`.
4. `systemctl stop nginx` while apache2 runs answers `nginx is not running.` and apache2 stays up;
   `systemctl stop apache2` closes the port.
5. `systemctl restart nginx` while apache2 runs is refused the same way as 2 and writes nothing
   (today restart skips the front-door gate, so it would open a second pidfile).
6. `nmap` still shows port 80 as `http` whichever program runs.
7. `curl -i` prints `Server: Apache` for apache2 and `Server: nginx` for nginx (the product's own
   token, still no version), on the own LAN, from a hop, and across the network.
8. The boot screen prints `[  OK  ] Started The Apache HTTP Server.` for a box running apache2.
9. Generated boxes are unchanged: still `nginx.pid`, still nginx everywhere.
**RED**: `systemctl.test.ts` and `ps.test.ts` through `runCommandLine` for 1–5; `curl.test.ts`
for the local and hop paths; `resolveHttpFetch.test.ts` for the server's answer; the boot line
in the boot-screen test. Live: extend `scripts/testHttpFetch.ts` with a box serving apache2 and
show it fails against the pre-slice handler.
**Watch for**: nine callers of `daemonName(spec)` and five of `pidfilePath(spec)` (generators,
`apt`'s base-image set, the manifest's installed-daemons read, `firstBoot`) assume one program
per row, so each needs the right program or the row's default; a box that started apache2 before
this slice holds `nginx.pid` and will read as nginx (pre-launch, no migration); `kill`'s
`isUnitName` already knows both names.

### Slice 2: apache2 has a release history, and every tool that dates or fires the web server reads the running program's

**Built**: v0.332.0, #626. The running program decides the scanned version, the fired CVE and
the trace tag; the release template and effect pool are pinned by exact-value lock tests. The
first-boot pidfile check (below) still reads nginx's default and is slice 3's to fix.

**Value**: a box running apache2 scans as `Apache/2.4.62` with apache2's own CVE, is fired at
through apache2's hole (not nginx's), and leaves an `apache2[pid]` line, so a defender patches
the package that is actually exposed.
**Path**: `packages/packageVersions.ts` gains the template → `packageTimeline` / `liveCve` /
`exploitOutcome` key on it with no change → `apt install apache2` writes the manifest row through
`newestReleaseOn` as any other package → `services/pidfile.ts` `readRunningProcesses` gives a
running service the PACKAGE its program belongs to → `readOpenPorts` (every `nmap -sV`: own box,
LAN, occupant, deep, public) and `sessions/exploitCreateSession.ts` (the server's version and
outcome, which is all `msfconsole` renders) read that package → the trace line carries the program.
**Shape to propose first** (the collapsed version):
- `otherPrograms` entries name their package: `otherPrograms: [{ name: 'apache2', package: 'apache2' }]`.
  A running service carries `package` next to `program` (the row's own `package` for its default
  program), and every reader that today says `running.spec.package` says `running.package`.
- The server finds the package of what holds the reached port by reading the running process on
  it (one helper beside `listenerOn`, which `webProgramOn` also folds onto), rather than going
  port → service name → catalog row, which loses the program.
- `ExploitEvent` carries the `program`, and `syslogExploitLine` drops its parameter and tags with
  it. sshd, snmpd and named write exactly what they write today; the three own-format formatters
  ignore it.
- Template: `apache2: { cveNumber: 22, displayPrefix: 'Apache/', startTuple: [2, 4, 62] }`.
- Pool (7, nginx's size; one full shell traded for script execution, file write for file read):
  `['shell_full', 'file_read', 'file_read', 'file_read', 'script_exec', 'script_exec', 'backdoor_port_open']`.
**Acceptance criteria (owner-confirmed 2026-10-08)**:
1. `apt install apache2` writes an `apache2` row into `/var/lib/dpkg/status` at the newest release
   the repo holds that day; before this slice it wrote none.
2. Root's own `nmap -sV localhost` on a box running apache2 shows port 80 `http`
   `Apache/<that version>`, and the CVE and severity live against it, when one is.
3. apache2's CVE ids carry its own number: `CVE-YYYY-22NNNNN`, never nginx's `02NNNNN`.
4. On a box with both packages installed, the RUNNING program decides: running apache2, the scan,
   the fire and the trace answer from the apache2 row even when the nginx row sits on a live hole,
   and the reverse.
5. `msfconsole` fired at a box running apache2 on a release with a live hole names apache2's CVE
   and grants that release's effect from apache2's pool; on a release with no live hole it is
   refused (`no known vulnerability`), whatever nginx's row says.
6. The defender's `auth.log` line reads `apache2[pid]: Remote exploit of CVE-… from …; shell opened
   as …` (and the `failed` line on a refusal); nginx still writes `nginx[pid]`; sshd, snmpd and
   named are byte-for-byte unchanged.
7. `apt list -u` lists `apache2` with its hole and its ETA wording, exactly as for nginx, and
   `apt upgrade apache2` moves the row forward; the scan then reads the new version.
8. The cross-player scan and fire (another player's box running apache2) agree with 2–6, through
   the server.
9. Generated boxes are unchanged: no NPC carries apache2 yet, so no CVE, scan or trace of theirs moves.
**RED**: `packageVersions` / `packageTimeline` tests for 3; `apt.test.ts` for 1 and 7;
`nmap.test.ts` (own box) for 2 and 4; `exploitCreateSession.test.ts` for 4–6; `exploitLog` /
catalog test that the three syslog rows are unchanged. Live: a wire-check on the
`testExploitCrossPlayer` harness (a sibling script, so a door search that moves never breaks the
other): B's box running apache2 on a release with a live root hole — A's scan reads `Apache/…` and
the CVE, A's fire opens the shell, B's `auth.log` gains `apache2[`; then B swaps to nginx on a clean
nginx release and the same fire is refused. Show it fails against the pre-slice handler.
**Watch for**: `packageManifest.ts` `installedPackages` maps `/usr/sbin` to packages by the row's
default daemon only, so a generated box with `apache2` in sbin would get no row; nothing generates
one until slice 4, which fixes it there with its test. The many `scripts/testExploit*.ts` that read
`spec.package` target generated nginx boxes and stay right. The pool drops `file_write` entirely;
the owner took it over the alternative that keeps it (`shell_full`, `file_read` ×2, `file_write`,
`script_exec` ×2, backdoor), which leans only to script execution.

### Slice 3: a workstation born with a web server runs nginx or apache2, 50/50

**Value**: a new player's box that is born with a web server runs nginx or apache2 with even odds,
and every tool that looks at it (`ps`, `systemctl`, the boot screen, `nmap -sV`, `curl -i`, the
exploit trace) already tells which, from slices 1–2. The draw is the only new behavior.
**Path**: `boot/firstBoot.ts` `startingServices` draws the web slot's program → `runFirstBoot`
installs it through `installNewest` and starts it through `startDaemon`, as any pool service.
**Shape to propose first** (the collapsed version):
- The pool keeps five slots; the web slot holds two programs (nginx, apache2). After `pickN` picks
  which slots a box gets, each slot picks its program. Every owner gets the same slots as before,
  so the odds of a born web server cannot move and a draw can never hold both.
- The "already started?" check reads whether ANY program of the service is up — `runningPort` in
  `commands/daemon.ts`, the one answer `systemctl` and the start gate already share — instead of
  the default pidfile. Reading only the drawn program's pidfile would still start apache2 beside an
  nginx the owner runs on an unborn box. Reading the default one, as today, also rewrites a running
  apache2's pidfile at the default port on a retry, losing the owner's port.
**Acceptance criteria (owner-confirmed 2026-10-08)**:
1. A workstation whose draw includes the web slot is born running exactly one web server, nginx or
   apache2, never both; across the sampled owners each is drawn 35–65% of the time.
2. The odds of being born with a web server are unchanged: the web slot is drawn about as often as
   each other service (each slot in 30–50% of draws, expected ~40%), so apache2 sneaking in as a
   sixth slot fails.
3. A box born with apache2 has it as `apt install apache2` lays it down that day: `/usr/sbin/apache2`,
   an `apache2` row in `/var/lib/dpkg/status` at that day's newest release, and
   `/var/run/apache2.pid` on port 80; no nginx pidfile and no nginx package.
4. A box born with apache2 scans clean that day: `Apache/<version>` with no live hole (test day 100
   is measured clean for apache2, `3.0.4`, as for the other five).
5. An unborn box already running apache2 on a port its owner chose finishes its birth on the next
   boot, its pidfile and port untouched.
6. An unborn box already running nginx when apache2 is drawn is born without a second web server:
   nginx stays on its port and no apache2 pidfile appears; and the reverse.
7. Nothing else moves: an already-born box is untouched, the 1/2/3 service counts hold, and
   generated (NPC) boxes are still all nginx (slice 4).
**RED**: `boot/firstBoot.test.ts` for 1–6. Its fixed pool list gains apache2, and the tests that read
pidfiles by the service's name (`pidfilePath(daemon.spec)`, `daemonName(running.spec)`) move to each
program's own pidfile, or nginx's checks would pass while apache2 went unchecked. No wire-check:
first boot runs in the client and writes through the journal like any command, and slice 2's
wire-check already covers how the server reads a box running apache2.
**Watch for**: `firstBoot.ts`'s comment explaining why apache2 is never drawn becomes false and is
rewritten. The existing "keeps the port" test covers sshd only, so the web-slot cases need 5–6.
