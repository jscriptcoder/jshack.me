# Plan: D1c — a player finds the pages a server never linked

**Status**: **Slice 1 SHIPPED** (v0.123.0, commit `72c33d0`, [PR #378](https://github.com/jscriptcoder/jshack.me/pull/378) — open, awaiting merge). **Slice 2 is next and has not been started.**
**Branch**: slice 1 was `feat/pages-nobody-linked`; cut a fresh branch off merged `main` for slice 2.
**Epic**: [`legacy-parity-epic.md`](./legacy-parity-epic.md) row **D1c**, Phase 1
**Base version**: v0.122.0 → **v0.123.0** after slice 1

> **Picking this up cold?** Read "Scope decision" (why there is no generated content here),
> then "Slice 1 — as built", then start at **Slice 2**. Everything above Slice 2 is done.

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

- [x] `apt install gobuster` puts a readable, editable path list on the box, and `gobuster`
      with no list installed says so and names the package that provides one.
- [x] `gobuster http://<host>` reports the paths that answer and stays silent about the ones
      that do not.
- [x] A path answers **iff it is a word in the file AND a file exists at it** — the list is the
      sole gate, exactly as `passwordSweep.ts` makes it for credentials. A path present on the
      box but absent from the list is not found; a word in the list naming nothing is not
      reported.
- [ ] The target's `/var/log/access.log` records **every probe**, hits and misses alike, in the
      order tried, as one append — the run of 404s with a 200 in it is the defender's tell.
      **← SLICE 2, not started**
- [x] A player can append a path to the list with `nano` and a subsequent sweep finds something
      the shipped list missed.
- [ ] Proven live, end to end, by a player creating a directory and page by hand and sweeping
      for it — the journey above, recorded in `e2e-shared-network-verification.md`.
      **← close-out, not started**

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

### Slice 1: A player finds a path nobody linked — ✔ SHIPPED (v0.123.0, `72c33d0`, PR #378)

All eight acceptance criteria met. 2427 tests green, `tsc -b` and `eslint` clean.

**What it built**
- `core/commands/gobuster.ts` — the command. Own-LAN only.
- `core/network/defaultDirlist.ts` — `DIRLIST_PATH` (`/usr/share/wordlists/dirlist.txt`),
  `DIRLIST_PERMISSIONS`, `DEFAULT_DIRLIST` (40 entries), `formatDirlist`, `parseDirlist`.
- `aptPackages.ts` — `extraFiles` on the existing `gobuster` row, so `apt install gobuster`
  ships the list. Second consumer of the seam D2.1 built.
- `registry.ts` — registered.

**Decisions taken, and why they are not free to re-open casually**

1. **A word naming a DIRECTORY that holds an index is a hit**, reported with a trailing slash.
   The slice turned on this: without it, a player who makes a folder and puts a page in it
   cannot find it — and that journey is this plan's whole evidence, since there is no
   generated content. A directory with no index is not a hit.
2. **The list module lives in `core/network/`, not `core/wordlist/`.** These are HTTP request
   paths and `http.ts` owns how a request path resolves to a file; `core/wordlist/` is
   credential-domain and its docstrings say so.
3. **Cross-network sweeps are refused BY NAME**, not dressed as a connect failure. A player
   whose sweep is unsupported must not spend the evening believing a live box was down.
4. **The shipped list deliberately contains `admin`, `status`, `server-status`, `api/health`,
   `metrics`** — the paths every generated page already links and nothing serves. They 404
   today; keeping them means a default sweep starts finding them the moment the content epic
   grows those pages, with no change to the list. There is a test pinning this.
5. **~15 lines of `curl`'s target resolution are REPEATED, not extracted** (`targetFs`,
   `LOOPBACK_NAMES`, the port check, `connectError`). Owner decision 2026-08-12: leave it for
   **D1b (lynx)**, the third consumer, which "reuses D1 whole". A shape named at three callers
   beats one named at two. **If you are doing lynx, this is the extraction to make** — and the
   divergence risk is real, so do not let a fourth consumer arrive first.

**Two known-equivalent mutants, documented in `gobuster.ts` in place** so a re-run is not a
mystery (same convention as hydra's): dropping the `is_directory` guard only makes a
`not_found` take a retry that fails identically, and the `indexPath === null` check is
unreachable — a path that escaped the document root already returned — but is what narrows the
nullable for the type. Everything else in the logic is killed.

**What mutation testing found, worth remembering because the pattern recurs**: asserting a
generated file's content by calling the very function that generates it
(`content: formatDirlist(DEFAULT_DIRLIST)`) compares the function against itself and can never
catch it breaking. `formatDirlist`'s `join('\n')` → `join('')` survived that way, and
`DIRLIST_PERMISSIONS` had the identical hole. The apt/extraFiles test shape invites this — check
any future `extraFiles` consumer for it.

**TDD honesty note for the reviewer**: RED was genuine for the gate and for both wiring pieces.
The port check, install hint, traversal handling and public-IP refusal were written during GREEN
ahead of tests demanding them; those tests postdate the code, and mutation testing is their
evidence rather than test ordering.

---

### Slice 2: The defender sees the sweep — ← **START HERE**, not started

**Why it matters more than it sounds**: as of v0.123.0 a sweep is **silent on the target**.
`curl` writes an access-log line per fetch and gobuster writes nothing at all, so right now the
loudest thing a player can do to a web server is the quietest thing in the game. hydra had the
same gap between D2.1 and D2.3 and it was fine, but it is live on `main` once #378 merges.

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
