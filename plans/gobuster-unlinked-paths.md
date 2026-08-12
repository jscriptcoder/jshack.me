# Plan: D1c — a player finds the pages a server never linked

**Branch**: `feat/pages-nobody-linked` (slice 1); one branch per slice thereafter
**Status**: Active — planned 2026-08-12, no code written
**Epic**: [`legacy-parity-epic.md`](./legacy-parity-epic.md) row **D1c**, Phase 1
**Base version**: v0.122.0

## Goal

`gobuster <url>` walks a wordlist of paths against a web server, reports the ones that answer,
and leaves the defender a wall of 404s in `/var/log/access.log`.

## Scope decision — the content is NOT here (owner, 2026-08-12)

The obvious reading of decision 4 ("each door ships with its content generation") would put
generated unlinked pages in this plan, because **every web root in the game holds exactly one
file**: `buildRemoteHostFs` (`remoteHostFs.ts:161-178`) and `buildWorkstationBaseFs`
(`workstationFs.ts:166-168`) both stamp `/var/www/html/index.html` and stop.

**That content belongs to its own epic and is deliberately not built here.** Generated world
content — believable, varied per-box files, web trees beyond one page, and later MySQL schemas
and Redis keyspaces — is one design with one shape, and inventing a narrow version to unblock
one command is how a codebase ends up with two content systems. `webPages.ts:14` already
anticipates the real change (role-keyed buckets at D5b); this plan must not pre-empt it.

**What replaces it as evidence**: the player generates the content. `mkdir`, `touch`, `nano`
and `rm` all ship in `/bin` (`binaries.ts:57`), the workstation's `/var/www/html/index.html`
exists from boot, and `curl`/`gobuster` resolve the player's own address to their LIVE tree
(`curl.ts:98` `targetFs`). So a player can build an unlinked path by hand and sweep for it,
which proves the tool against real content and costs no content design:

```
su root
mkdir /var/www/html/hidden
nano /var/www/html/hidden/index.html
nginx
gobuster http://localhost
```

**Accepted consequences, stated so nobody rediscovers them as bugs:**

1. Against a generated NPC host, `gobuster` finds `/index.html` and nothing else, because that
   is all those boxes have. The tool is correct; the world is thin until the content epic lands.
2. The shipped **D1 defect stays live** — every page in `pools/webPages.ts` links `/admin/`,
   `/status`, `/server-status`, `/api/health` or `/metrics`, and `curl` 404s on all of them, so
   a player doing the recon the page invites is told the server lies. Recorded in
   [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §9 against the content
   epic; not fixed here.

## Acceptance criteria

- [ ] `apt install gobuster` puts a readable, editable path list on the box, and `gobuster`
      with no list installed says so and names the package that provides one.
- [ ] `gobuster http://<host>` reports the paths that answer and stays silent about the ones
      that do not.
- [ ] A path answers **iff it is a word in the file AND a file exists at it** — the list is the
      sole gate, exactly as `passwordSweep.ts` makes it for credentials. A path present on the
      box but absent from the list is not found; a word in the list naming nothing is not
      reported.
- [ ] The target's `/var/log/access.log` records **every probe**, hits and misses alike, in the
      order tried, as one append — the run of 404s with a 200 in it is the defender's tell.
- [ ] A player can append a path to the list with `nano` and a subsequent sweep finds something
      the shipped list missed.
- [ ] Proven live, end to end, by a player creating a directory and page by hand and sweeping
      for it — the journey above, recorded in `e2e-shared-network-verification.md`.

## What this reuses whole (do NOT rebuild)

| Piece | Where | Note |
|---|---|---|
| URL parsing | `network/http.ts:44` `parseHttpUrl` | Same parser `curl` uses — one interpretation of a URL |
| Document-root confinement | `network/http.ts:71` `resolveWebPath` | Normalizes, confines, resolves directory → `index.html` |
| Target resolution (own LAN) | `curl.ts:98` `targetFs` | Own address → LIVE tree; sibling → `buildRemoteHostFs` |
| Port check | `services/pidfile.ts` `readOpenPorts` | A host not serving http refuses, same as `curl` |
| Access-log format | `logging/accessLog.ts` | Already formats 404s and sizes; "a 404 is logged exactly like a 200" is in its docstring |
| The `extraFiles` seam | `commands/aptPackages.ts:29` | D2.1 built it; `gobuster` is already a catalog row (`aptPackages.ts:66`) with no `extraFiles` yet |
| Wordlist file discipline | `wordlist/defaultWordlist.ts` | `WORDLIST_PERMISSIONS`, `formatWordlist`, `parseWordlist` — the path list is the same kind of object |
| Sweep-rule shape | `wordlist/passwordSweep.ts` | The precedent to mirror: pure, no clock/journal/network, returns hits + the trace the target records |

## Slices

### Slice 1: A player finds a path nobody linked

**Class**: Behavior change.
**Value**: The player can discover what a server did not advertise — the first recon tool that
returns something `curl` cannot, because `curl` requires already knowing the path.
**Path**: `gobuster http://<host>` → `parseHttpUrl` → `targetFs` → port check → for each word
in the installed list, `resolveWebPath` + read → report the hits.
**Production path touched**: new `commands/gobuster.ts`; new pure path-sweep module (mirror
`passwordSweep.ts`); `aptPackages.ts` gains `extraFiles` on the existing `gobuster` row; a
`DEFAULT_DIRLIST` module beside `defaultWordlist.ts`.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before any code):
1. `gobuster http://<host>` against a host serving http prints the paths that answered.
2. A path that exists on the box but is **absent from the list** is NOT reported — the list is
   the sole gate, the same rule `passwordSweep.ts` enforces for passwords.
3. A word in the list naming nothing is not reported.
4. With no list installed, `gobuster` says so and names `apt install gobuster` — matching
   `john.ts:143`'s shape for a missing wordlist.
5. A host not serving http refuses the connection rather than reporting zero hits, so "nothing
   there" and "unreachable" stay distinguishable (`curl.ts:12`).
6. The sweep reads the list from **the machine the player is standing on** — "tools run where
   you stand", the owner principle D2.5 locked and the hydra gate-lift shipped.
7. A path appended with `nano` is found on the next run.
8. A path that climbs out of the document root is not reported, and is not distinguishable
   from a miss — `resolveWebPath` already returns null and `curl` already withholds the tell
   ("telling a caller their traversal was SPOTTED is itself a hint worth withholding").

**RED**: A sweep against a tree carrying a hand-made unlinked page asserting it is reported,
and that a path present on the box but absent from the list is not.
**GREEN**: The pure sweep + the command + the `extraFiles` row.
**MUTATE**: The gate condition (`in the list AND exists`) is the mutation target that matters —
flipping either conjunct must fail a test. Criteria 2 and 3 exist to kill exactly that pair.
**REFACTOR**: Assess whether the path sweep and `passwordSweep` share a shape worth naming.
Default is NO — two sweeps over different domains are not yet a duplication, and structure
nobody can observe has no test that can fail.
**Done when**: criteria met, gates green, human approves the commit.

---

### Slice 2: The defender sees the sweep

**Class**: Behavior change.
**Value**: The attack acquires its cost. A sweep is the loudest thing a player can point at a
web server, and the defender can only tell a typo from a walk of the document root if the
misses are written down (`accessLog.ts` says exactly this, and nothing yet produces the volume).
**Path**: the sweep's probes → one batched append → the target's `/var/log/access.log`.
**Production path touched**: `api/patches.ts` `recordLanFetch` gains a batched form (or a
sibling action), `core/network/recordLanFetch.ts`, `commands/types.ts` `LogApi`, `ui/state.ts`
wiring.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**⚠️ This slice changes `api/` — it needs a `scripts/test*.ts` wire-check against `vercel dev`
+ supabase before it can be called proven.** `tsc` cannot see DB columns or constraints, and
wire-checks are not in CI, so a regression here ships green.

**Acceptance criteria** (confirm before any code):
1. Every probe is recorded — 404s and 200s alike, in the order tried.
2. The whole sweep is **one append**, not one round-trip per word. D2.3 settled the parallel
   for hydra ("volume is the behaviour", ~110 lines as a single append); a sweep making N
   signed requests would be a different kind of expensive.
3. The server still resolves status and size **itself** and never trusts the client's claim —
   `AccessLogFetch`'s docstring locks this ("a crafted request can never author a line claiming
   something was served that never was"), and a batched form is precisely where that guarantee
   could be lost.
4. A sweep that never reached the box writes nothing at all (D2.3's rule for auth.log).
5. The defender reading `/var/log/access.log` sees the run of 404s with the hit inside it.
6. A wire-check proves 1-4 live against `vercel dev` + supabase.

**RED**: A test asserting one sweep produces one append carrying a line per probe, with the
non-existent paths present as 404s.
**GREEN**: The batched action and its wiring.
**MUTATE**: The status/size derivation is the survivor risk — a mutant logging every probe as
200 must fail a test.
**Done when**: criteria met, wire-check passes live, gates green, human approves the commit.

---

### Close-out: prove it the way a player would

Not a slice — the confirmation step before the epic row is marked shipped. Load the `v2-e2e`
skill and drive the journey in "Scope decision" live against `vercel dev` + supabase: create the
directory and page by hand, start the server, sweep, then read the box's own `access.log` and
see the probe list. Record it in `e2e-shared-network-verification.md`, as D1 did in §7.

This is what stands in for generated content as evidence, so it is not optional.

## Deferred — named, not planned

- **Generated world content** — the epic this plan deliberately does not do. See
  [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §9.
- **Cross-player gobuster** against a public IP. `curl` already has `fetchAcrossNetwork`
  (`curl.ts:130`) and the server-side resolution behind it, so the shape exists — but hydra's
  equivalent took five slices (D2.4) and this deserves its own. Until then `gobuster` is
  own-LAN, exactly as `hydra` was after D2.1.
- **Vhost/DNS modes and extension enumeration** — the epic's D1c row defers both.
- **`AvailabilityRule` is still inert** — `gobuster` will declare one like every other command
  and nothing will read it. Not this plan's job; the backlog entry stands.

## Pre-PR quality gate (per slice)

1. Mutation testing where meaningful; otherwise an explicit `N/A` plus proportionate evidence
2. Refactoring/reduction assessment; `N/A` when neither applies
3. `npm run typecheck` (`tsc -b`) and `npm run lint` — from `v2/`
4. Version bumped in `v2/package.json` **and** `v2/package-lock.json`
   (`npm install --package-lock-only`)
5. Slice 2 only: the wire-check run live and its output shown
6. No Story/Slice/decision tags in code or test comments; no references to this file from
   committed code

---
*Delete this file on close-out; graduate the as-built into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1.*
