# Plan: apache2 of its own

**Status**: Grilled. Decisions confirmed by the owner 2026-10-08; slices not yet planned.
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
    - **S1** apache2 is its own program (decisions 1, 3–6).
    - **S2** its release history (7–9). Touches server-side exploit authorization, so it needs a
      wire-check.
    - **S3** back into the birth pool (10).
    - **S4** NPC web hosts (11).
