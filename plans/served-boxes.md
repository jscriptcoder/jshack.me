# Plan: every box that isn't yours is served

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-12. Slice 1 is built
and waiting on its PR; slice 2 is next. Where another doc disagrees with this file, this file
wins until the close-out moves its content into `docs/`.

## Goal

Nothing a player's tier cannot read on a machine leaves the server for that player. Today a
session holder is handed the machine's whole journal: every file anybody wrote there, at any
permission. After this epic a player reads any box that is not their own workstation as a tree
the server builds and prunes to the tier their session holds, and only the owner of a
workstation ever reads a raw journal.

## Where it starts from (facts, 2026-10-12)

Measured or read in the code on this date. Anything marked "by reading" was not run live.

- **`listPatches` handed a session holder every row on the machine.** `handleListPatches`
  checked only that the caller held a session and returned `select('*')`. Reproduced on the live
  stack: a `guest` session on another player's workstation received the content of a root-only
  `/root/secret.txt`.
- **A wallet key is such a row.** `wallet init` writes `.wallet/wallet.dat` in the home of the
  account that ran it, on whatever box that is, so keys live on generated machines as well as on
  workstations.
- **Two read paths exist.** Another player's workstation and the access point's gateway are
  *served*: `resolveCrossPlayerFs` rebuilds the box, replays its journal, prunes the tree to the
  caller's tier and ships it. Every machine a network generates (a LAN host, an inner gateway, a
  switch, a deep chain door, a deep host) is *rebuilt*: the client generates the base from the
  ESSID and replays the raw journal it pulled with `listPatches`.
- **The client never read the journal of a served box.** `patches()` is read in one place
  (`ui/state.ts`, `activeRoot`), after the served tree has already been returned. The request
  still went out on every hop and after every write.
- **The game already runs on a pruned tree.** On a served box every command works off what the
  server sent. The two paths differ at three command-level sites: `su` (answered by the server),
  firing an exploit in `msfconsole`, and `standsOnAnotherPlayersBox` in `shell/runLine.ts`. The
  rest is where `ui/state.ts` sources the tree (`activeRoot`, `ftpRoot`, `scpTargetTree`,
  `refreshServedRoot`).
- **Machinery reads the tree as the box, past the session's tier.** About 80 client call sites
  do it: `fs.root()` in 23 files and `fs.stat()` in 21. On a rebuilt machine they see the whole
  tree. On a served one they see the pruned tree.
- **`su` on a rebuilt machine reads `/etc/passwd` at root privilege** through `fs.stat`
  (`commands/su.ts`). `/etc/passwd` is readable by `root` and `user`, never `guest`, and
  exploits rewrite the hash in it.
- **A local `su` on a generated machine is never recorded on the server (by reading).**
  `pushSession` persists a session only when the machine is the player's own workstation, and
  `createSession` refuses any other machine. So the server keeps judging that player's writes at
  the tier of the login they arrived with. `suElevate` resolves only players' workstations and
  answers 404 `host_unreachable` for anything else.
- **A session holder below root can be served less than a stranger.** A caller with no session
  gets the externally-observable list (`EXTERNALLY_OBSERVABLE_ALLOWLIST`: pidfiles, the boot id,
  `rules.v4`, `snmpd.conf`, `acl.conf`, `/var/www`, the dpkg manifest). A session holder gets
  what their tier can read, and `rules.v4` and `acl.conf` are root-only.
- **A scan of the layer behind a switch reads `acl.conf` off the shell's own tree**
  (`commands/nmap.ts`, `resolveLayerScan`). Gateways and switches carry only a `root` account,
  so a lower tier there comes only from an exploit that grants one.
- **Pidfiles are world-readable** since v0.143.0, so `ps` and `kill` work at any tier on a
  served box.
- **The local database doors run only at home.** `mysqlOwnBox` and `redisOwnBox` are reached
  only when the target is the player's own box from their own login.
- **A reboot is learned from the boot-id marker in the box's tree.** On a served workstation an
  ended session falls to the no-session view, which carries the marker. On a rebuilt machine the
  refused journal comes back as an empty one, so no marker appears (by reading).
- **`env.fs.reload()` does not re-read a served box.** It re-pulled the journal, which a served
  box never reads, and returned the tree fetched at the start of the line. `chmod`, `gpg`,
  `wallet`, the scripting `fs` and the `>>` redirect call it before composing a whole-file
  write.
- **Generated machines are cheap to serve.** Over 50 hosts on 5 networks a serialised tree is
  20 to 102 KB (median 36 KB), 2.5 to 19 KB gzipped (median 5.7 KB), and takes 1 to 4 ms to
  build and serialise. A player's workstation is 15 KB raw.
- **The generators ship in the client bundle.** `nmap`, `ssh` and the scans rebuild machines the
  player holds no session on, so any client can compute a generated machine's seeded content
  from the ESSID.
- **The server has 39 actions over four endpoints** (`network` 12, `patches` 9, `sessions` 17,
  `wallet` 1). Besides `listPatches`, the responses found carrying file content are the served
  tree, the web fetches, and what an exploit reveals at the tier it grants. Not every response
  body has been read.

## Decisions (owner-confirmed 2026-10-12)

All grilled singly.

1. **Every box that isn't yours is served.** Generated machines are read the way a player's
   workstation is: a tree the server builds and prunes. `listPatches` becomes owner-only and the
   client stops rebuilding the box it stands on. Rejected: keeping the rebuilt path and filtering
   journal rows by tier (two read paths stay, the filter needs invented rules for tombstones and
   for a row another writer superseded, and machinery above the tier reads the stale seeded file
   instead of nothing, so `su` would accept an old password). Also rejected earlier in the same
   conversation: dropping only rows beneath a directory the tier cannot enter (leaves a
   root-only file in an enterable directory exposed), and leaving generated machines as they
   are.
2. **A session holder is served their tier's view plus the externally-observable list.** Holding
   a session never shows less than holding none. Nothing new leaves the server, since a caller
   with no session already gets those files, and the client still refuses to `cat` one the tier
   cannot read. Rejected: a server-side answer for each piece of machinery that needs one of
   those files, and leaving a lower-tier shell on a switch to render its scans unfiltered.
3. **Seeded content stays computable, and that is the limit of this epic.** What the world was
   generated with can be rebuilt by any client from the ESSID. The epic hides everything written
   to a machine afterwards: players' files, wallet keys, changed passwords, logs. Rejected:
   moving world generation server-only (rewrites `nmap`, the `ssh` preflight, the scans and
   every local resolver; a separate epic several times this size).
4. **The refusal ships first, on its own.** A visitor is refused the journal of another player's
   workstation and of the access point's gateway now; the rule tightens to owner-only when
   generated machines are served. Rejected: holding it until the whole change is ready.
5. **After a session ends, the caller is served the no-session view from their own row.** The
   server reads the network off the caller's most recent row on that machine, ended or not, and
   serves the externally-observable view, which carries the boot marker. Nothing is claimed by
   the client and no wire field is added. Rejected: the caller naming the ESSID in the request,
   and serving nothing so the client has to infer a closed connection from a missing tree.
6. **One audit, of client readers and server responses.** A read-only slice lists every client
   call site that reads past the session's tier on a box that is not the player's, and every
   server action's response body, and marks each one. Each defect becomes its own fix slice.
   Rejected: auditing the client only, and no audit at all.

## What follows from the decisions

Forced by the above; none of these was a separate choice.

- **`su` is answered by the server on every box that isn't the player's.** `suElevate` has to
  resolve generated machines, and the client stops reading `/etc/passwd` locally on a hop.
- **`resolveCrossPlayerFs` builds generated machines**, from the network recorded on the
  caller's session row and never from a network the caller names.
- **`env.fs.reload()` on a served box re-pulls the served tree.**
- **ftp and scp targets on generated machines read the served tree.**
- **The wire-checks that read a generated machine back through `listPatches` as a visitor**
  (`testFtpRemoteRead`, `testFtpPut`, `testFtpTransferTrace`) move to the served tree, and
  check 7 of `testJournalRefusedToVisitors` flips to a refusal.

## Left as it is

- **The tree is re-pulled before each line**, with no conditional fetch, as players' boxes
  already do.
- **When a player holds several sessions on one machine the newest row sets the tier**, as the
  write check already does.
- **The player's own workstation stays local**: its journal, its `su`, its database doors.
- **One browser run at close-out** covers every slice.

## Done when

- A `guest` session on any machine that is not the caller's workstation cannot obtain, from any
  response, the content of a file its tier cannot read that was written after the machine was
  generated.
- Only the owner of a workstation gets rows from `listPatches`.
- `su`, the scans, `chmod`, ftp, scp and the redirects behave on a generated machine as they do
  on a player's workstation at the same tier.
- The audit table is in the handbook with no row left marked as a defect.
- The seeded-content limit is written down where the read filter is documented.

## Out of scope

- Hiding seeded content (decision 3).
- A conditional or cached tree fetch.
- Choosing a tier other than the newest row's when several sessions are held.
- Anything on the player's own workstation.

## Slices

One PR per slice, each cut from `main` after the one before it merges. A behaviour-changing
slice starts from a failing test; its acceptance criteria are confirmed with the owner before
any code. Slices 3 and 4 must merge before slice 5: once generated machines are served, `su`
has to be on the server already, and the switch scan needs the externally-observable list.

Reading note for whoever does the audit and the `su` work: read the session, exploit and scan
code directly, and give any helper agent only a narrow fact to check.

### Slice 1: a visitor is refused the journal of a box the server serves (v0.369.0)

**Value**: a player holding a session on another player's workstation, or on the access point's
gateway, can no longer read files above their tier off the journal.
**Path**: `listPatches` → `core/patches/handleListPatches`; `ui/state.ts` `refetchPatches` and
`reloadActiveRoot`.
**Branch**: `fix/list-patches-journal-leak`.
**Acceptance criteria**:

- A visitor holding a session on a machine that the session's network does not generate gets
  403 `permission_denied` from `listPatches`, whatever tier the session carries, and the
  journal is not read.
- That covers another player's workstation, the access point's gateway, and a generated machine
  asked for by a session opened on a different network. The network is the one on the session
  row.
- The owner's own read is unchanged. A visitor on a machine their session's network generates
  still gets the rows (slice 5 removes this).
- No session at all is still 403 `no_session`.
- The client asks for no journal on a served box: not on the hop, not after a write, and not
  from `env.fs.reload()`.

**First failing test**: a visitor with a session on another player's workstation is refused.
**Wire-check**: `scripts/testJournalRefusedToVisitors.ts`, 11 checks. Against the handler before
the change it fails 5 of them, one of which is the root-only file's text arriving in the answer.
`testLogWipeSticks` and `testHopChain` read a gateway's `auth.log` back through the journal as
a visitor, so they read the served tree instead.
**Left for the PR**: the version bump, and the backlog and handbook entries that describe the
leak (`docs/backlog.md`, `docs/handbook/13-known-issues.md`, `docs/handbook/01-architecture.md`,
the `listPatches.ts` row in the handbook's stale-comment table).

### Slice 2: the audit (docs only)

**Value**: the owner can see every place a response or a client reader reaches past a session's
tier, and which of them are defects.
**Output**: one table in the handbook. One row per client call site that reads the tree past
the session's permissions on a box that is not the player's (`fs.root()`, `fs.stat()`, and any
helper handed a `Directory`), and one row per server action's response body. Each row names the
file or field, who can read it, and a verdict: fine, covered by the externally-observable list,
answered by the server, or a defect.
**Already classified in the grill**: `su` (slice 3), the switch layer scan (slice 4),
`env.fs.reload` and `listPatches` (slice 5), pidfiles (fine), the local database doors (home
only, fine). **Known open row**: `chmod` maps the `u` in a mode to the owner's tier by reading
`/etc/passwd`, and falls back to `guest` when the file is not in the tree.
**Done when**: every one of the roughly 80 client sites and 39 actions has a row, and each
defect has a slice in this file. A defect that needs a rule goes to the owner as a question
first.
**No code, no version bump.**

### Slice 3: `su` on a generated machine is answered by the server

**Value**: a player who switches user on a generated machine holds that tier on the server too,
so their writes are judged at it and the shell survives a refresh.
**Path**: `su` → `env.su.elevate` → `suElevate` on `api/sessions` →
`core/sessions/authElevateSession`, resolving a generated machine from the network on the
caller's session row → a session row at the new tier.
**Measure first**: confirm on the live stack that a local `su` on a generated machine leaves no
row and that a root-only write after it is refused. The plan records this by reading only.
**First failing test**: a caller holding a `guest` session on a generated machine elevates to
`root` with the box's password and gets a row at `root`.
**Wire-check**: the script that covers `suElevate` today, extended to a generated machine.

### Slice 4: a session holder is served the externally-observable list as well

**Value**: a lower-tier shell on a router or switch is served the files its own machinery reads,
so a scan from it shows what the box really filters.
**Path**: `resolveCrossPlayerFs`, the active-session branch: the tier's view together with the
externally-observable view of the same tree.
**First failing test**: a `guest` session on a gateway is served `rules.v4`, with the file's own
root-only permissions intact.
**Wire-check**: the cross-player read script, with a lower-tier session on a gateway.

### Slice 5: generated machines are served, and only the owner reads a journal

**Value**: a player on a generated machine receives nothing its tier cannot read.
**Path**: server, `resolveCrossPlayerFs` builds a generated machine from the network on the
caller's row, and serves the no-session view from an ended row; `handleListPatches` refuses
every caller but the owner. Client, `activeRoot`, `ftpRoot`, `scpTargetTree`,
`refreshServedRoot` and `su` treat every machine that is not the player's own workstation as
served, and `reloadActiveRoot` re-pulls the served tree.
**Note**: `standsOnAnotherPlayersBox` in `runLine.ts` asks a different question (can the box
leave its network) and keeps its meaning.
**First failing test**: a caller with a `guest` session on a generated machine is served a tree
without a root-only file somebody wrote there.
**Wire-check**: `testJournalRefusedToVisitors` (check 7 becomes a refusal, plus a root-only file
on a generated machine served to `root` and pruned for `guest`); `testFtpRemoteRead`,
`testFtpPut` and `testFtpTransferTrace` read back through the served tree.
**Size**: plan it as server half then client half if one PR is too much to review. The server
half is safe to merge alone, since nothing calls it for a generated machine until the client
half lands.

### Slice 6 onward: one fix per audit defect

Planned when slice 2 lists them.

### Last slice: close-out

- `docs/cross-player-architecture.md`, the handbook chapters on architecture, persistence, the
  server and known issues, and the glossary's read-filter entry describe one served path.
- The seeded-content limit (decision 3) is written where the read filter is documented.
- `docs/backlog.md` loses the `listPatches` entry and gains anything deferred here.
- One browser run with the `e2e` skill covers every slice.
- This file is deleted.
