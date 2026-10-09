# Plan: the login doors reach your own box

**Status**: Grilled. Decisions confirmed by the owner 2026-10-09. Slice (a) built (#637,
v0.341.0); slice (b) next.

**As built — slice (a):** `commands/ssh.ts` `executeOwnBoxLogin`, taken when the session stands
at home (`essid === null`) and `ownBoxSource` names the target (its `ownIp` now accepts null, so
loopback answers offline). The trace is `appendAuthLog`'s `doorLogin` kind (`door: 'ssh'`,
`from_ip` an IPv4), formatted through `SERVICE_CATALOG[SERVICE_BY_DOOR[door]].sweepLog` — slice
(b) widens `door` to `ftp`/`scp`. `createSession` accepts `kind: 'ssh'` for an own-box row; without
it `lostLegs` pops the shell on the next line. Wire-check: `scripts/testOwnBoxLogin.ts`.
Resolves the `backlog.md` item "`ssh`, `scp` and `ftp` cannot reach your own box", found by the
tutorials' close-out browser run. Where they disagree with this file, this file wins.

## Goal

`ssh guest@localhost`, `scp f guest@localhost:/tmp/` and `ftp localhost` do what they do on a real
box: knock on the box the shell stands on. At home that is the player's own workstation; on a hop
it is the hop. `localhost` means the box the shell stands on, for every door.

## Where it starts from (facts, 2026-10-09)

- **The three doors have no own-box route.** `commands/ssh.ts`, `scp.ts` and `ftp.ts` each route a
  target as public IP → deep layer → fellow occupant → generated LAN host, and anything else is
  `No route to host`. `localhost` is never turned into an address, so it fails at home AND on a hop.
- **The server excludes the caller's own box on purpose.** `authCreateSessionSameLan.ts` matches a
  fellow occupant "self excluded: your own LAN IP is the own-LAN path" — a path that was never built.
- **Own-box `su` is client-side.** `commands/su.ts` reads the own box's `/etc/passwd`, checks
  `md5`, and pushes a session on the same machine; only a cross-player `su` asks the server. The
  own-box write path is the own-workstation bypass, so no session row is needed.
- **Home vs hop is `session.essid`.** `network/vantage.ts`: a session with `essid === null` stands
  at home. An `su` copies the essid beneath it, so it never moves the shell.
- **The server already resolves loopback from a hop.** `handleAuthCreateSession` maps a
  `target_ip` of `127.0.0.1` to the address the caller's vantage places the hop at, for every door
  kind (`DOOR_KINDS`: ssh, ftp, scp, nc) — `nc`'s `knockOwnBox` is its one current caller.
- **Every door logs through its catalog `sweepLog`** (sshd → `auth.log`, vsftpd → its own log), in
  `authCreateSession.ts` `logLoginAttempt`. The own-box `auth.log` endpoint
  (`patches/appendAuthLog.ts`) knows only `suSwitch` and `sessionOpened`.
- **Tutorials forbid the examples.** `hackademy.test.ts` "never aim ssh, scp or ftp at localhost";
  `tutorials-architecture.md` says to delete that rule and restore chapter 5's own-box examples
  when the doors gain an own-box path.

## Decisions (owner-confirmed 2026-10-09)

Grilled singly:

1. **A real login.** The door must be running on the asked port, the password is checked against
   the box's own `/etc/passwd`, and a session lands on the box as that user.
2. **Home and hop.** `localhost` works from a hop too, not only at home.

Accepted in bulk:

3. **The home path is client-side, like own-box `su`.** Read the own box's pidfile for the door
   (nothing on the port → `Connection refused`), check `md5` against own `/etc/passwd`, push a
   session of the door's kind on the own machine with the `essid` beneath it (so the shell stays
   at home), `exit` steps back. No new server login endpoint.
4. **An account with no password cannot log in over a door** — sshd's `PermitEmptyPasswords no`.
   The player's own login has none, so `ssh <me>@localhost` is `Permission denied`; `guest` and
   `root` work with their passwords. Same rule as the cross-player doors.
5. **The trace is the door's own line on the own box**, sourced from the address the box was
   reached BY: `127.0.0.1` for `localhost`, the leased IP if that was typed. One new `appendAuthLog`
   event kind, a door login, formatted server-side through the door's catalog `sweepLog` so the
   server stamps the time. An `api/` change, so a wire-check.
6. **Offline:** `localhost` works with the WiFi down (loopback needs no network); the leased
   address needs you online, since offline you hold none.
7. **scp and ftp follow the same rule.** `scp` copies within the own box at the tier the login
   bought; `ftp localhost` opens the `ftp>` shell on the own vsftpd.
8. **From a hop, `localhost` is sent on as `127.0.0.1`** for the server to resolve to the hop's
   box. On a hop that is another player's workstation it goes through the same-LAN door at that
   box's lease.
9. **Tutorials:** put chapter 5's own-box `ssh`/`scp`/`ftp` examples back; delete the rule in
   `hackademy.test.ts` and in `tutorials-architecture.md`.
10. **Out of scope:** `nc localhost` at home keeps refusing (planting is local, by design).
11. **Slices**, each shippable alone, one browser run at close-out:
    - **(a)** `ssh` at home — the own-box route, the door-login auth-log event, its wire-check.
    - **(b)** `scp` and `ftp` at home.
    - **(c)** `localhost` from a hop, all three doors.
    - **(d)** tutorials restored, backlog item closed.
