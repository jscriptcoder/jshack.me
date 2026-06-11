# Plan: Remote access via SSH

**Status**: Active — Slices 1–2 SHIPPED. Slice 3 PRs 3a–3c SHIPPED (#221, #222, #223). NEXT: PR 3d
(failures + `exit` + refresh survival), then 3e (writable remote).
**Type**: New epic on top of the pidfile "running services" primitive. Absorbs generator-epic
**Story 3** (enter a generated machine + browse its FS), and — per the locked decisions — the
cross-machine **session-auth** and **writable-remote (L1+L2)** spine of the multiplayer model.

> The `story-splitting` skill is not installed here; this split follows the `planning` skill's
> vertical-slice rules manually. Every PR is independently mergeable and (from PR 3c on) observable
> through the real terminal path.

## Goal

Let a player `ssh user@host` into a generated remote machine, authenticating **server-side** against
that machine's real `/etc/passwd`, landing in its filesystem, and operating it (read AND write) with
the tier their login grants — all on the pidfile "running services" model where `/var/run/*.pid` is
the source of truth for open ports, and the server-authoritative `sessions` table is the source of
truth for "who is present on which machine".

## The model (the spine every slice rides on)

`/var/run/sshd.pid` (`sshd:port=22`) is the source of truth for "ssh up / port open" — built in
Slices 1–2. Slice 3 adds the **session + cross-machine authz** spine, ported faithfully from legacy
(`src/sessionRegistry/handler.ts`, `api/patches.ts`) and adapted to v2's pure-generation model:

```
ssh user@host
  └─► authCreateSession (server)        ◄── legacy `authCreateSession`, NOT plain createSession
        server REGENERATES the remote FS:  fs = buildRemoteHostFs(verifiedPubkey, essid, ip)
        userType = deriveUserType(fs '/etc/passwd', username)     // 401 unknown user
        md5(password) === passwd hash ?                            // 401 bad password
        insert sessions row { player_key, machine_id(server-derived), credentials{user,userType},
                              kind:'ssh', source_ip, parent_session_id, essid, target_ip }
  └─► pushSession(remote)  → env.fs dispatches to the remote tree → prompt + ls/cat/echo>…
```

**v2 vs legacy (the one deliberate divergence):** legacy read `/etc/passwd` (and L2 perms) from a
stored `machine_filesystems` projection. v2 generates host FSes **purely**, so the server
**regenerates** `buildRemoteHostFs(pubkey, essid, ip)` on demand — no projection table. This is why
the session row must persist `essid` + `target_ip`: they are the regeneration key the server needs
later for L1/L2 (the server cannot invert the coordinate-derived `machine_id` suffix back to an IP).

## Decisions locked

### Session 1 (Slices 1–2, shipped)
- Source of truth = literal planted pidfiles; sshd-only first; walking skeleton = local `sshd`;
  `ssh`/`sshd` pre-installed (not apt-gated). Generator: pure-probability ~40% placement, mostly
  :22, pidfile-only per-host FS.

### Session 2 (Slice 3 — this grill round)
- **Persist the ssh session server-side in Slice 3** (not a throwaway client-only step). Build the
  cross-machine session path properly now — consistent with the server-authoritative-hop-chain
  principle.
- **Remote host `machine_id` = coordinate-derived suffix**: `${hostname}-${sha256('host:'+essid+':'+ip)[0..8]}`
  — a DISTINCT namespace from the player's `'ed25519:'` workstation suffix, so `isOwnWorkstation`
  naturally returns false. Same host ⇒ same id across reloads; forward-compatible with shared LANs
  (Model B): the seed is the host's network coordinates, not the viewer's pubkey. (Trade-off: the id
  is not invertible to an IP — hence `target_ip` is stored on the session row, and the CLIENT
  recovers the host by regenerating the current LAN and matching suffixes.)
- **Server-side auth via legacy-faithful `authCreateSession`** (NOT envelope-trust). Plain
  `createSession` keeps rejecting `kind:'ssh'`. The server regenerates the remote FS, derives
  `userType` from its `/etc/passwd` (never a client claim), and validates `md5(password)`. Bad
  password / unknown user → 401, no row. This is the **targeted-L3 hop-chain** the ship-first
  security memory explicitly endorses.
- **`listSessions` scopes by `player_key` alone** (drop the `.eq(machine_id)` filter) → returns the
  whole active hop chain spanning machines (su + ssh hops together), ordered by `created_at`. The
  own-workstation gate in `handleListSessions` is removed (player_key scoping IS the boundary).
- **Password collection = interactive masked prompt** (`env.prompt({ masked: true })`), exactly the
  `su` precedent. Real ssh has no positional password; inline `ssh user@host pw` stays deferred
  (no `node` command yet). The plaintext password travels in the signed envelope; the server md5's
  it (legacy did `md5(auth.password)` — plaintext on the wire, over HTTPS + signed).
- **`source_ip` = the player's current LAN IP** (`wlan0.ipv4`) for a same-LAN ssh — matches legacy
  `resolveLogSourceIP` (same-subnet ⇒ localIP). Cross-subnet/public-IP nuance is deferred with
  multi-LAN hops.
- **Remote `/etc/passwd` reuses the existing `generatePasswd` primitive** (built NPC-agnostic for
  exactly this). Mirror the workstation: `root` + a generated `user` + `guest`, passwords seeded
  from a weak wordlist (deterministic now, crackable later). **How the player OBTAINS a remote
  password stays parked** (hydra/wordlist epic) — Slice 3 tests/verifies with a seed-known password.
- **Writable remote FS (chosen over read-only):** once ssh'd in, `ls/cat` AND `echo>…/nano/mkdir/rm`
  work on the remote tree, gated by the player's session tier on THAT machine. This pulls the
  **write-to-remote (L1+L2)** path into the epic — built from scratch in v2 (the endpoint is
  own-workstation-only today). Sequenced LAST (PR 3e) so the read-path headline ships first.

### Open decisions still parked (settle at the PR that needs them — they don't block earlier PRs)
- **PR 3e L2 strategy**: server-side **regeneration** (`applyPatches(buildRemoteHostFs(...), priorPatches)`
  then walk perms) vs a legacy-style **`machine_filesystems` projection** (dual-write). Regeneration
  is more v2-idiomatic (no projection table) but must apply prior patches over a regenerated base
  server-side. Decide when PR 3e starts.
- ~~**Exact new `sessions` columns** for regeneration~~ — RESOLVED (PR 3b): the migration adds **only
  `essid`**. `target_ip` is redundant — the server recovers the host from `(essid, machine_id)` via
  `hostForMachineId` (the coordinate suffix can't be inverted to an IP, but a LAN regeneration +
  suffix match finds it). `source_ip` already existed on the table.
- ~~Distinct "unknown user" message~~ — RESOLVED (PR 3b): ssh auth failures COLLAPSE to one 401
  `invalid_credentials` (unknown-user and wrong-password indistinguishable — real ssh / no
  enumeration). The client shows a generic "Permission denied". `su` keeps its distinct messages
  (different real-tool behaviour).
- Multi-LAN hops (ssh from inside one host to another subnet), saved-key/fingerprint auth, `scp`,
  cross-player reachability — all later epics.

## Acceptance Criteria (epic-level)
- [x] Root `sshd` writes `/var/run/sshd.pid`; the open port is observable. (Slice 1)
- [x] `nmap` reports `22/tcp open ssh` for a host with the pidfile; the generator plants it
      deterministically on a seeded subset. (Slices 1–2)
- [x] `ssh user@host` against a host running sshd validates the password **server-side** against
      that machine's `/etc/passwd` and, on success, lands the player in the remote FS. (PR 3c)
- [ ] Auth/connection failures (bad password, unknown user, port closed, host down) are reported
      with realistic messages and push no session.
- [ ] An `ssh` hop survives a browser refresh via the `sessions` rehydrate path (player_key-scoped,
      remote-FS resolved on boot).
- [ ] A user operating a remote host writes files there only at the tier their login grants
      (root anywhere; user/guest per the file's perms); a write without a valid session is refused.

---

## Slices

Slices 1–2 SHIPPED (PRs #219, #220). Slice 3 is the sequence below. Each PR: RED-GREEN-MUTATE-KILL-
REFACTOR; load `tdd`/`testing`/`mutation-testing`/`refactoring` before code; `npm run lint` +
`test:run` + `build` green (v2 has no Prettier); live agent-browser verification; version bump.

### ✅ Slice 1 — `sshd` brings up the local ssh service (PR #219, v0.42.0)
### ✅ Slice 2 — generator plants sshd on remote hosts; `nmap <remote>` shows ports (PR #220, v0.43.0)

### Slice 3 — `ssh user@host`: connect, server-auth, land, operate

Re-specified into five dependency-ordered PRs. PRs 3a–3b are foundation (generator + server, unit-
tested in isolation); 3c is the UI-observable headline; 3d closes failures + refresh; 3e adds
writable-remote.

#### PR 3a — Remote host grows a full base FS + machine_id identity ✅ (PR #221, v0.44.0)
**Value**: an NPC host is a real machine — `/etc/passwd` (root+user+guest, seeded weak passwords via
`generatePasswd`), `/home/<user>`, `/root`, `/tmp` with faithful perms — and has a stable
`machine_id`. Foundation for auth (3b) and browse (3c).
**Scope**: grow `buildRemoteHostFs` from pidfile-only to the full skeleton (reuse `generatePasswd`,
`PASSWD_FILE`/`HOME_DIR`/`ROOT_DIR`/`TMP_DIR` perm constants — factor shared bits out of
`workstationFs.ts` if it adds value). Add `hostMachineId(essid, ip)` (coordinate suffix) + a reverse
resolver `hostForMachineId(pubkey, essid, machineId)` that regenerates the LAN and matches the
suffix. No command/server change.
**Tests**: determinism; passwd shape/accounts/perms; home/root/tmp presence + perms; machine_id
namespace distinct from workstation; reverse-resolver round-trips and returns null off-LAN.

#### PR 3b — `authCreateSession` server action ✅ (PR #222, v0.45.0)
**Value**: the server can mint a *validated* ssh session on a foreign host.
**Scope (as shipped)**: new `authCreateSession` action on `/api/sessions` + `core/sessions/authCreateSession.ts`:
verify envelope → resolve the target on the caller's regenerated LAN (404 `host_unreachable` if the IP
is not a real host) → `buildRemoteHostFs(verifiedPubkey, essid, host)` → read `/etc/passwd`,
server-derive `userType` → `md5(password)===hash` → insert row with `kind:'ssh'`, server-derived
`userType`, `source_ip`, `parent_session_id`, `essid`. Migration adds **only `essid`** (see resolved
decision). The own-workstation gate does NOT apply (foreign host); the passwd check IS the gate.
**Tests**: handler — happy insert (exact row shape, server-derived userType for root/user/guest),
401 bad password, 401 unknown user (same code — no enumeration), 404 host_unreachable, 400 on
missing-field/forged-player_key, 401 tampered signature, 500 insert fail.
**Resequenced out of 3b** (each moves to its consumer): the client `authCreateServerSession` *adapter*
→ **PR 3c** (the `ssh` command consumes it); the `listSessions` player_key-scoping → **PR 3d** (the
rehydrate consumes it). The plain-`createSession` `use_authcreatesession` reject was dropped as
unneeded — its `kind: z.literal('su')` schema already rejects `'ssh'`, and our client never routes
ssh through it.

#### PR 3c — the `ssh` command + client wiring (the headline) ✅ (PR #223, v0.46.0) — READ-ONLY remote
**Value**: `ssh user@host` connects, authenticates, and drops you into the remote FS to browse.
**Shipped extras** (the live E2E surfaced them): the `ssh` command supports `-p <port>`; reachability
(host on LAN? sshd on that port?) is checked LOCALLY from the generated FS before prompting; the seam
is `env.ssh.authenticate` (commands stay adapter-free); the FS dispatch is the pure, tested
`resolveActiveRoot`; and **`promptHost` now reflects the active session's machine** (own box vs the
remote host's name, both parsed from the session `machine_id`) — the E2E caught that the prompt still
showed `skylab` after an ssh hop. Live-verified end to end: connect → `ssh root@<host>` → password →
`root@<remotehost>:/root#` → `cat /etc/passwd` shows the REMOTE host's accounts → `exit` pops back;
a wrong password → `Permission denied (password).`, no session.
**Scope**: `core/commands/ssh.ts` (pre-installed `/bin/ssh` stub already exists) — parse `user@host`
(+ optional port), check the host's `sshd.pid` (port open? else "connection refused"), connect
animation via `env.sleep`, masked `env.prompt` for the password, call `authCreateServerSession`; on
200 `pushSession` the server-returned session (server-derived userType) and `setCwd` to the remote
home. **Adds the `authCreateServerSession` adapter** (signs + posts the authCreateSession action,
returns `{ ok, userType }` | error — resequenced here from 3b). Client: `env.fs` `root` dispatches on
active `session.machineId` — own → patched workstation FS (today); remote → `buildRemoteHostFs` for the
host resolved via `hostForMachineId`. Guard `pushSession`'s `createServerSession` so it does NOT fire
for ssh (the ssh command already created the row via authCreateSession). Remote is READ-ONLY this PR
(writes deferred to 3e).
**Tests**: command — refused when no pidfile, prompt+auth happy path pushes session + lands home,
401 surfaces "Permission denied" (no push); env.fs resolves remote tree for an active remote session.
**Live**: `su root`→`sshd` on a known remote (or generated), `ssh root@<host>`, type the seed-known
password, `ls`/`cat` the remote tree.

#### PR 3d — failures + `exit` + refresh survival
**Value**: every failure is realistic and pushes no session; leaving and reloading behave.
**Scope (re-checked at start, 2026-06-11)**: the failure messages AND `exit`+`endServerSession`
turned out to ship in 3c/#218 (all tested). What remains: **the `listSessions` player_key-scoping**
(drop the `.eq(machine_id)` filter + own-workstation gate so the cross-machine chain rehydrates —
resequenced here from 3b; without it an ssh row is NEVER returned and a refresh silently drops the
hop) + ssh-chain rehydrate coverage (`rehydrateSessionStack` is already kind-agnostic — pin it with
behavior tests). The **ssh auth.log line moved to 3e** (decision below): it lands on the REMOTE
host's auth.log, unobservable until 3e's remote patch read path; `source_ip` itself already ships
on the session row (3c).
**Tests**: listSessions returns the whole cross-machine chain scoped by player_key alone (no 403
gate, no machine_id in payload/query); rehydrate rebuilds an ssh hop and lands in the remote home.
**Live**: ssh in, refresh, still on the remote host; `exit` pops back; failure messages spot-check.

#### PR 3e — writable remote FS (L1 + L2)
**Value**: operate the remote host — write files at the tier your login grants.
**Scope**: replace `handleUpsertPatch`/`handleRemovePatch`'s `isOwnWorkstation` gate with **L1**
(own-workstation bypass; else require an active `sessions` row for `(player_key, machine_id)`) + **L2**
(reconstruct the path's perms — see the parked regeneration-vs-projection decision — and
`canWrite(session.userType, perms)`). Client: patches target the active `session.machineId`; ambient
log paths (`/var/log/auth.log` etc.) bypass L1/L2 (recon side-effects). Port the permission walker
(`canWrite`) + active-session adapter.
Also lands here (moved from 3d, decided 2026-06-11): the **ssh auth.log line** on the REMOTE host
(`sshd: Accepted/Failed password for <user> from <source_ip>`) — it needs this PR's remote patch
read path to be observable, so it ships with its consumer.
**Tests**: write to remote as root (allowed), as user/guest per perms (allowed/denied), without a
session (403 no_session); ambient-log bypass; L2 perm matrix.
**Live**: `ssh root@host` then `echo pwned > /tmp/x` + `cat` it back; a user-tier login denied on a
root-only path.

---

## Parking lot (later epics — NOT in scope)
`ps`/`kill` reading pidfiles; other services (nginx/mysql/redis) + pidfiles; `sshd` stop/restart/
status; multi-LAN hops + foreign-subnet depth (generator Story 4); saved-key/fingerprint auth; `scp`;
how a player OBTAINS remote creds (hydra/wordlist); cross-player "be reachable" (multiplayer); CVEs;
missions.

## Pre-PR Quality Gate (each PR)
1. Mutation testing — report reviewed, survivors addressed/documented.
2. Refactoring assessment.
3. `npm run lint` + `test:run` + `build` green (v2 — no Prettier).
4. Live agent-browser verification through the real UI.
5. Version bump (`package.json` + `package-lock.json`).

---

_Delete this file when the epic's PRs are all shipped. If `plans/` is empty, delete the directory._
