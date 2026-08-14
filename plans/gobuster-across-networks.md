# Plan: D1d — gobuster across networks

**Branch**: feat/gobuster-across-networks
**Status**: Active
**Epic**: [`legacy-parity-epic.md`](./legacy-parity-epic.md) — Phase 1, row D1d
**Version**: 0.129.0 → 0.130.0

## Goal

A player sweeps another player's public IP for paths nobody linked, and the box they swept
reads the whole run as one wall in its own access log.

## Why now

`gobuster` is the last web tool that refuses a stranger. `curl` reached across networks from
D1; D1b slice 7 gave `lynx` the same reach through `fetchPageAcrossNetwork`; `gobuster`
alone answers a public host with `NOT_ON_YOUR_NETWORK` (`gobuster.ts:208`). Closing it
finishes the web door's cross-player parity before the door order moves on to ftp (D3).

## Locked decisions

Taken during the 2026-08-14 grilling session, each against a shipped precedent rather than
from first principles. They are recorded here because every one of them was reversible until
it wasn't, and the reasons are not visible from the code that results.

### 1. The dirlist does not cross the wire — the server reads it from the journal

The first instinct was to post the 40 words. `hydra` says otherwise: it sends
`caller_machine_id` and the server reads `/usr/share/wordlists/passwords.txt` off that
machine's journal (`hydraCrackPublic.ts:149`). `dirlist.txt` has **identical provenance** —
`aptPackages.ts:76` is the only thing that writes it, so like the password list it exists
purely as a patch and never as part of a generated base tree.

Following hydra keeps the list the **sole gate** and puts the server in charge of enforcing
it: no crafted request sweeps with a list the player never grew. The costs are accepted: one
extra DB read per sweep, and the `[+] Words: N` header now renders after the round-trip
instead of before it.

### 2. One request per sweep, not one per word

Forty signed round-trips would mean forty nonce checks, forty full reachability chains, and
forty separate read-modify-writes of the same access-log row — scattering the sweep across
forty timestamps. `recordLanFetch` already settled this shape for the own-LAN twin: it takes
a **run** of paths and lands them as one append, for exactly these reasons
(`recordLanFetch.ts:11-15`). The cross-network form matches it.

### 3. The response carries sizes, never content

The server holds each hit's page while sweeping, and returning it would save a round-trip.
It would also turn the sweep into a bulk read: every found page delivered under the sweep's
own wall of 404s, with no line saying the attacker actually read them. Finding a path and
reading it stay **two acts**, and the second leaves its own line. gobuster prints nothing but
`[Size: N]` today, so nothing on screen changes.

### 4. The trace is vantage-aware, and that splits the web door for now

Authorizing `caller_machine_id` yields the caller's session, so `resolveVantageSourceIp`'s
two inputs both arrive for another reason. Using it means a sweep launched from a pivot box
traces to **that** network, as `hydraCrackPublic.ts:170` already does — honouring D2.4's
rule that a false address in a defender's log is worse than a refusal.

**Accepted consequence, not a bug**: `curl` and `lynx` still stamp the actor's home address
on the same handler, because neither sends `caller_machine_id`. Two source-IP rules live
inside the web door until they get one — their own slice, already parked in the epic
alongside `ssh` and `nmap`.

### 5. A remote sweep is paced like a local one

Own-LAN, gobuster walks the list at `PROBE_DELAY_MS` and prints hits as they land. That beat
is **already theatre** — probing a local tree is instant — so replaying a batched response at
the same beat introduces no new dishonesty and keeps the tool's identity wherever it is
pointed.

### 6. One PR, with the shared-door extraction inside it

`handleResolveHttpFetch`'s reachability chain has no second consumer until this handler
exists, so extracting it first would be structure nobody can observe. It lands as the
REFACTOR step of this slice instead.

## Acceptance Criteria

- [ ] A player runs `gobuster http://<another player's public IP>` and sees the paths that
      answered, with their sizes, in list order — where today the command refuses.
- [ ] The swept box's `/var/log/access.log` gains **one append** covering every path the
      sweep asked about — hits and misses alike, in the order tried, under a single
      timestamp.
- [ ] A word naming a directory that holds an index is reported as the trailing-slash form,
      and the target's log records **both** forms it was asked for — the same two-request
      semantics an own-LAN sweep already has.
- [ ] A sweep launched from a box the player holds a session on is logged as coming from
      **that** network's public address; a sweep from their own workstation is logged as
      coming from their home address.
- [ ] A player standing on a machine they neither own nor hold a session on cannot sweep
      with it: the sweep is refused and the target's log gains nothing.
- [ ] A player with no `dirlist.txt` on the box they stand on is told to
      `apt install gobuster`, and the target's log gains nothing.
- [ ] A public address that answers nothing — dark, bricked, unforwarded, or serving no web
      — reports `Connection refused`, and nothing is logged anywhere.
- [ ] The sweep reports what exists without handing over what it holds: reading a found page
      still takes a `curl` or `lynx`, and leaves its own line.
- [ ] Own-LAN sweeps are unchanged, including the beat, the header, and the single append
      they already write.

## Slices

### Slice 1: A player sweeps a stranger's server for pages nobody linked

**Value**: Behavior change — a player pointed at another player's public IP gets the recon
`curl` cannot give them, and the defender gets the loudest page in their log as its price.
**Path**: `gobuster http://<public IP>` → client detects a public address → signed
`resolveHttpSweep` carrying the caller's machine → server authorizes the caller, reads their
dirlist from that machine's journal, resolves the target through the same chain `curl`'s
cross-network fetch uses, probes each word against the resolved tree, appends every asked
path to the target's `access.log` as one block, returns per-word status and size → client
replays the results at the shipped beat.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`
(the shared-door extraction is the REFACTOR step). `reduce-system-complexity` is `N/A` — no
net mechanism removal is claimed; the extraction is dedup inside one module, and the slice
adds a handler on balance.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A` — not a reduction slice.

**Acceptance criteria**: the plan-level list above, in full. Present to the human and get
confirmation before writing any code.

**RED or preservation baseline** — behavior tests first, in this order:

_Client (`gobuster.test.ts`, existing fake-env style):_
1. `gobuster http://<public IP>` reports the hits the remote seam returns, in list order,
   with sizes — currently refuses with `NOT_ON_YOUR_NETWORK`. **The headline RED.**
2. The remote seam reporting no dirlist yields the same `apt install gobuster` line an
   own-LAN sweep gives, and no findings.
3. An unreachable target reports `Connection refused`, matching `curl` and `lynx`.
4. An own-LAN sweep still resolves locally and never reaches the remote seam — the split is
   the address, and nothing else.

_Server (`resolveHttpSweep.test.ts`, handler + stub deps, the `resolveHttpFetch.test.ts`
pattern):_
5. A word naming a served file comes back 200 with the page's size; a word naming nothing
   comes back 404 with size 0.
6. A word naming a directory holding an index comes back as the trailing-slash form, and the
   log records both the bare path and the form it redirects to.
7. Every asked path lands in **one** append under **one** timestamp — asserted as the log's
   content, not as a count of calls.
8. The logged source IP is the standing network's public address when the caller holds a
   session on the machine they named, and their home address when they named their own
   workstation.
9. A caller with no session on the named machine is refused; nothing is swept and the
   target's log is untouched.
10. A caller whose named machine has no dirlist gets `dirlistFound: false`; the target's log
    is untouched, because nothing was asked.
11. A bricked gateway, a port routing nowhere, and a port serving something other than http
    each collapse to `host_unreachable` with nothing logged.
12. A traversal word is indistinguishable from a miss in the response, and is recorded
    verbatim in the target's log — the asymmetry `probe` already implements.
13. No response carries page content.

_Preservation, for the extraction:_ the existing `resolveHttpFetch.test.ts` and
`gobuster.test.ts` suites stay green untouched, which is what says the shared chain still
resolves `curl` and `lynx` the way it did.

**GREEN or preservation change**: the minimum that satisfies the above —

- `core/network/resolveHttpSweep.ts`: the new handler. Verify → `authorizeMachineAccess` →
  `listPathPatches(caller_machine_id, DIRLIST_PATH)` → `wordlistOn` → `parseDirlist` →
  resolve target → probe each word → one `appendMachineLog` → per-word results.
- `core/network/resolveHttpFetch.ts`: extract the target resolution (lines ~270-314 — network
  lookup, gateway materialize, boot gate, port routing, forward-or-gateway arm, http
  liveness) so both handlers enter through one door. `handleResolveHttpFetch` keeps its
  behavior exactly.
- The probe definition moves out of `gobuster.ts` into core so client and server share one
  reading of what a word finds. Two readings would mean a path found by a local sweep and
  missed by a remote one.
- `api/network.ts`: a `resolveHttpSweep` branch alongside `resolveHttpFetch`, wiring the same
  supabase-backed deps plus `findActiveSession` and `listPathPatches`. **Nothing new goes in
  `api/` as a module** — every `api/*.ts` file is published as an endpoint.
- `commands/types.ts`: a `sweepPublic` method on the remote seam, returning
  `{ dirlistFound, results }`.
- `gobuster.ts`: the public branch, replayed at `PROBE_DELAY_MS`.

**MUTATE or alternate evidence**: Stryker over the new handler, the extracted resolution, and
gobuster's changed branch. Plus the mandatory **wire-check** — `api/` changes and `tsc`
cannot see DB columns or constraints, so `scripts/testGobusterCrossPlayer.ts` runs live
against `vercel dev` + local supabase: seed a target with a hand-built web tree
(`seedCrossPlayerTarget.ts`), post a signed sweep, assert the per-word results, then read the
target's patch rows back and assert one append, N lines, one timestamp, and the expected
source IP.

**KILL MUTANTS**: address survivors in the authorization gate, the directory retry, the
one-append boundary, and the source-IP branch — these carry the slice's whole meaning. Ask
before killing a survivor whose only death is a test asserting internal shape; the existing
`probe` already carries two documented known-equivalent guards
(`gobuster.ts:113-124`) and the extraction must not turn them into new noise.

**REFACTOR**: the shared-door extraction is the refactor, assessed against the same standard
D1b slice 3 met — one definition of reaching a web host, one of what a word finds. Do not
extract the access-log line builder that `recordLanFetch` and the new handler both resemble
unless it falls out for free; three near-identical loops is evidence, two is a coincidence.

**Done when**: every acceptance criterion above holds, mutation survivors are addressed or
recorded, the wire-check passes live, `npm run typecheck` and `npm run lint` pass from `v2/`,
and the version is bumped in both `v2/package.json` and `v2/package-lock.json`.

**Live close-out** (required, not a smoke test — the same bar D1c and D1b met): two players,
one hand-builds a tree under `/var/www/html` with `mkdir`/`nano` and runs `nginx`; the other
sweeps their public IP, finds the unlinked directory, `curl`s it, and the owner reads the
wall of 404s plus the two 200s back out of their own log. Written up as an Act in
[`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md).
Against a **generated** NPC host the sweep still finds only `/index.html` until the content
epic lands — the tool is correct, the world is thin, exactly as accepted at D1c.

## Pre-PR Quality Gate

1. Mutation evidence — Stryker over the changed files; survivors killed or recorded with
   reasons.
2. Wire-check — `scripts/testGobusterCrossPlayer.ts` green against `vercel dev` + supabase.
   An `api/` change is unproven until this runs.
3. Refactoring assessment — the shared door landed, or a recorded reason it did not.
4. `npm run typecheck` and `npm run lint` from `v2/`.
5. Version bumped in `v2/package.json` + `v2/package-lock.json`
   (`npm install --package-lock-only`).
6. DDD glossary check — `N/A`, this project does not use DDD.

---

_Delete this file when the plan is complete, folding the as-built into
`conventions-and-gotchas.md` §1 and the close-out into the epic's "Next action"._
