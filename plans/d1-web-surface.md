# Plan: D1 — the web surface (serve a page, a stranger reads it)

**Branch**: `feat/web-http-surface`
**Status**: Active — **slice 1 of 4 SHIPPED** (v0.104.0, #344, squashed to `c54caa7`).
**Slice 2 is next, not started.**
**Epic**: [`legacy-parity-epic.md`](./legacy-parity-epic.md) Phase 1, slice D1 (the first slice of
the whole epic)

## Goal

A machine can serve HTTP, and anyone who can reach it can read the page — **with no session and
no credential** — while its owner sees the hit in `access.log`.

## Why this is the epic's first slice

Web is the only **credential-free** door: `/var/www/**` is already in the tier-3
`EXTERNALLY_OBSERVABLE_ALLOWLIST` (`readFilter.ts:61`), so no authorization work is needed. It
is the cheapest complete instance of the chain every later door repeats — catalog row →
generation places the service → pidfile opens the port → `nmap` shows it → client connects →
generated content renders — with no auth to entangle it (epic decision 5).

## Grounding (verified before planning)

| Fact | Where | Consequence for this plan |
|---|---|---|
| `/bin/curl` + `/bin/ping` already stamped on every machine | `generation/binaries.ts:39` (`SYSTEM_UTILITY_NAMES`) | **No binary work.** The commands are simply unregistered |
| `/var/www/**` already tier-3 readable | `patches/readFilter.ts:61` | No read-filter or allowlist change |
| `SERVICE_CATALOG` has one row (`ssh`) with `placement`/`altPorts`/`altPortChance` | `services/serviceCatalog.ts` | An `http` row is the designed extension point — "adding a service is ONE row" |
| `sshd` is the daemon pattern: root gate → already-running gate → port parse → streamed pidfile write | `commands/sshd.ts` | `nginx`/`apache2` mirror it; `WRITE_ERROR` map and `streamedResult` reused |
| `natHosts.ts` already resolves (public IP, port) → the occupant box behind a forward, boot-gated | `network/natHosts.ts` | Slice 3's handler is assembled from this, not invented |
| `appendMachineLog` + owner-keyed writer + server-derived source IP | `patches/appendMachineLog.ts`, `logging/crossPlayerSourceIp.ts` | Slice 4 is the Story-6 pattern applied to a new log file |

### ⚠️ Correction to the epic's framing

The epic says the cross-player read path "needs no work". That is true of the **filter**, not the
**routing**: `resolveCrossPlayerFs` resolves its target by `machine_id`, which the caller only
obtains from a **login**. `curl` has no login and knows only a public IP. Slice 3 therefore adds
a genuine new server handler — resolve-by-(public IP, port, path) — reusing `natHosts.ts`. The
epic will be amended on close-out.

## Open branch settled (approved 2026-07-29)

**`lynx` and `gobuster` do NOT ride along with D1.**

- **`lynx`** → its own slice after D1. It is a full overlay browser screen (legacy carried
  `LynxBrowser.tsx` + `lynx/render.ts` + `lynx/fetch.ts`), which is UI work of a different kind
  and size from anything here.
- **`gobuster`** → rides with **D2**, not D1. It is gated by `dirlist.txt`, which needs the same
  `apt install` → `extraFiles` mechanism that D2 builds to ship `passwords.txt`. Doing it here
  would mean building that seam twice or building it early with one consumer.

D1 ships `curl` as the HTTP client. That is enough to prove the surface.

## As-built after slice 1 (read this before slice 2)

What shipped, and the four things that differ from the plan below:

1. **The web-root confinement moved to the HTTP layer.** `resolveWebPath` normalizes and returns
   `null` on escape. The traversal test PASSED on first write, which was the finding: `fsView.read`
   walks via `segmentsOf` and never normalizes, so `..` was a literal directory name that never
   existed — but `resolveAbsPath` normalizes everywhere else. The web root was protected only by
   which helper happened to be on the read path. Now an invariant in
   `conventions-and-gotchas.md` §7. **Slice 3's handler must reuse this function, not re-derive it.**
2. **No `Date:` header** (the plan asked for one). It needs an authoritative clock; game time is
   server-side and an own-LAN fetch has no round-trip, so any date would be the client inventing
   game time. `Server:` carries **no version** — that belongs to `nmap -sV`/V1.
3. **`serviceCatalog.ts` generates ZERO mutants** (data-only `as const`), so the `http` row's
   evidence is behavioural only. Mutation score will silently ignore every future service row.
4. **Two pre-existing flakes fixed** en route, class recorded in §4 of the conventions doc.

Residual mutants deliberately left (all classified): `wlan0.kind !== 'wireless'` and
`wlan0.ipv4 === null` in `curl`/`ping` are type-narrowing clauses for states the game cannot
construct (a null `ipv4` already fails the `isOnline` gate); the `parseHttpUrl` regex-group guard
is unreachable; `{ userType: 'root' }` → `{}` is equivalent because served pages are
world-readable.

**Known duplication, deliberately not yet extracted:** `curl`, `ping` and `nmap` each open with
the same online → `wlan0` → essid preamble (three copies). Every remaining door needs it. Extract
once ~4 real callers exist so the seam is shaped by them, as its own behaviour-preserving commit.

## Acceptance Criteria

- [x] A generated host on the player's LAN runs an HTTP service, visible as `:80` in `nmap`, and
      `curl http://<its LAN IP>` returns its generated page
- [x] `ping <host>` reports reachability for a host that exists and failure for one that does not
- [ ] A player can start `nginx` (or `apache2`) as root on their own machine; it refuses if
      already running, refuses a non-root caller, and refuses a port below 1024 without root
- [ ] After starting it, the player's own `/var/www/html/index.html` is served over `curl`, and
      editing that file with `nano` changes what `curl` returns
- [ ] Another player who has forwarded `:80` is readable cross-network: `curl http://<their
      public IP>` returns their page **with no session and no credential**
- [ ] A target that is dark, bricked, or has no forward returns a connection failure, not a page,
      and leaks nothing
- [x] Nothing outside `/var/www` is reachable over HTTP — a path traversal or a request for
      `/etc/passwd` returns 404, not file content *(own-LAN; slice 3 must hold the same line
      server-side)*
- [ ] The owner of a fetched page reads the hit in `/var/log/access.log`, with the requester's
      server-derived source IP and the requested path
- [ ] All gates green: `npm run typecheck`, `npm run lint`, full test suite; version bumped in
      `v2/package.json` + `package-lock.json`

## Slices

Four slices, each one PR. Every slice is a **behavior change** — RED-GREEN with mutation
evidence, per the epic's per-slice contract.

---

### ✅ Slice 1 (SHIPPED v0.104.0): A player reads a web page served by a host on their LAN

**Delivered**: `SERVICE_CATALOG.http` row; `buildRemoteHostFs` stamps `/var/www/html/index.html`
only on hosts that rolled the service (absence is the protection — the tier-3 allowlist covers
`/var/www/**`); `generation/pools/webPages.ts` with its own PRNG draw so it cannot re-roll
accounts and ports; `core/network/http.ts`; `curl [-i]`; `ping <host> [count]`; both registered.
Mutation 97.63% (235 killed / 6 classified survivors), 2072 tests green.

**Original plan for reference:**

**Actor / trigger / outcome**: player → `curl http://<LAN IP>` → the generated page prints.
**Value**: real recon content on day one, and it proves the whole service chain end-to-end with
zero authorization surface.
**Path**: `curl` → URL parse → resolve LAN host (the existing own-LAN generation path) → read
`/var/www/html<path>` from the host's generated FS → render response.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`; `refactoring` assessed
at green.

**Includes**:
- `SERVICE_CATALOG.http` row (pidfile `nginx.pid`, default port 80, `runUser`, `placement`,
  `altPorts` e.g. 8080/8000, `altPortChance`)
- Generation: `buildRemoteHostFs` stamps the pidfile **and** `/var/www/html/index.html` for hosts
  that roll the http service — content from a seeded page pool (legacy `pools/web.ts` is the
  reference)
- `curl <url>` command: URL parsing (scheme/host/port/path/query), own-LAN host resolution,
  static-file read, HTTP-shaped response (status line, `Server`/`Date`/`Content-Length` headers
  under `-i`, body otherwise)
- **404 semantics**: only `/var/www/html<path>` is reachable — traversal and absolute paths
  outside the web root return 404
- `ping <host> [count]` folds in here (shares LAN-host resolution; `/bin/ping` already stamped)

**Defers**: the player's own web server (slice 2), cross-player (slice 3), `access.log` (slice 4),
POST, HTTPS specifics, request handlers, `lynx`/`gobuster`.

**RED**: a behavior test that a generated host rolling the http service exposes `:80` via
`readOpenPorts`, and that `curl http://<that host>` returns its seeded page body — failing
because no `http` catalog row, no page generation, and no `curl` command exist.
**GREEN**: the catalog row, the generation stamp, and the smallest `curl` that parses a URL and
reads the static file.
**MUTATE**: run Stryker on the changed files. Expect survivors around port defaulting (80 vs
parsed), the 404 boundary, and header formatting — kill each.
**REFACTOR**: assess whether URL parsing belongs in `core/network/http.ts` (a pure module) from
the start, so slice 3's server handler shares it rather than duplicating.
**Done when**: ACs 1–2 pass, mutation report clean, human approves the commit.

---

### ⏭ Slice 2 (NEXT — not started): A player runs their own web server

**Start here.** Client-only, no `api/`, no wire-check. Reuse: `sshd.ts` for the daemon shape,
`resolveWebPath` for anything path-related, and the `webPages.ts` pool if the default page should
be drawn rather than fixed. Note slice 1 did NOT teach `curl` to resolve the player's own address
— it resolves through `generateHomeLan` only, deliberately, because the own box's FS is
`env.fs.root()` rather than a generated tree, and pointing the generator at your own IP would
FABRICATE a page. Wiring that self case is part of this slice.

**Actor / trigger / outcome**: player → `nginx` → their own `:80` opens and serves their page.
**Value**: the defender half — exposure becomes a deliberate choice, and it creates the target
slice 3 needs.
**Path**: `nginx`/`apache2` command → root + already-running + port gates → streamed pidfile
write → `readOpenPorts` sees `:80` → `curl` (slice 1) reads `/var/www/html/index.html` from the
own FS.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`; `refactoring` assessed.

**Includes**:
- `nginx [port]` and `apache2 [port]` commands, mirroring `sshd.ts` exactly (root gate,
  already-running gate reading the pidfile via `fs.stat`, port validation, streamed startup,
  `WRITE_ERROR` mapping)
- **Ports below 1024 require root** (Unix rule; legacy's stated behaviour)
- `/var/www/html/index.html` with a default page in the **workstation** base FS
  (`buildWorkstationBaseFs`), owned appropriately so the player can `nano` it
- Both daemons share one pidfile/service identity so they cannot both bind `:80`
- `apt install nginx` / `apache2` availability (both already in `APT_PACKAGES`)

**Defers**: `systemctl stop` (that is D4), multi-port/multi-line pidfiles, HTTPS on 443.

**RED**: a behavior test that a non-root caller is refused, that a root caller's `nginx` writes
the pidfile and opens `:80`, that a second `nginx` refuses, and that `curl` then returns the
player's own page.
**GREEN**: the two commands + the base-FS web root.
**MUTATE**: Stryker on the changed files. Expect survivors on the 1024 boundary and the
already-running short-circuit — kill both.
**REFACTOR**: if `sshd.ts` and the new daemons share more than their gates, extract the common
daemon-start shape; only if it genuinely reduces duplication.
**Done when**: ACs 3–4 pass, mutation report clean, human approves the commit.

---

### Slice 3: A stranger reads a player's page across the network

**Actor / trigger / outcome**: player B → `curl http://<A's public IP>` → A's page, with **no
session and no credential**.
**Value**: the credential-free cross-player door — the first cross-player capability that needs
no authorization at all.
**Path**: `curl` detects a public IP → signed request → **new server handler**: public IP →
essid → AP gateway → `machineServing(port)` → forward → occupant via `network_lan_leases` +
`home_network_occupants` → materialize that box → **tier-3 allowlist filter** → return the file
at `/var/www/html<path>` → client renders.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`; `refactoring` assessed.
**Wire-check**: **required** — `scripts/testHttpFetch.ts` against `vercel dev` + supabase
(`tsc` cannot see DB columns or constraints).

**Includes**:
- The new handler, assembled from `natHosts.ts` (`bootableOccupantFs` + `natPortResolver`) so
  scan, ssh, and http can never disagree about which box is behind a forward
- Boot/dark gating **before** any read (a bricked or disconnected target returns unreachable)
- Tier-3 filter applied server-side so **only** `/var/www` content can ever cross the wire
- A no-forward / no-service target returns a connection failure that leaks nothing

**Defers**: `access.log` (slice 4), POST bodies, request handlers, HTTPS.

**RED**: a behavior test that B (no session on A) fetches A's page through the forward; that a
bricked A, a disconnected A, an unforwarded port, and a request for `/etc/passwd` each return
failure or 404 rather than content.
**GREEN**: the handler + client routing for public IPs.
**MUTATE**: Stryker. Expect survivors around the gate ordering (dark-check before read) and the
allowlist application — both are security-load-bearing, so kill them and keep the tests.
**REFACTOR**: assess sharing the URL/target resolution with slice 1's pure module.
**Done when**: ACs 5–7 pass, mutation report clean, wire-check green, human approves the commit.

---

### Slice 4: A defender sees who fetched their page

**Actor / trigger / outcome**: player A → `cat /var/log/access.log` → B's source IP and the path
B requested.
**Value**: closes the attacker/defender loop for the web surface — recon stops being silent.
**Path**: the slice-3 handler, after a successful resolve → `appendMachineLog` on the TARGET
under the **owner's** `writer_key` → A reads it from the local journal, a third player via the
tier-2 served tree.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`; `refactoring` assessed.
**Wire-check**: extend `scripts/testHttpFetch.ts` to assert the log line lands.

**Includes**:
- `/var/log/access.log` in the base FSs with the same permissions posture as `auth.log`/`kern.log`
  (tier-2 readable, tier-3 hidden — you must get inside to read it)
- A combined-log-style formatter in `core/logging/`
- **Owner-keyed writer** (the Story-6 keystone — lines accrete into ONE row; the requester's
  identity lives in the line content, never in `writer_key`)
- **Server-derived source IP** via `resolveCrossPlayerSourceIp`; a client-supplied source is
  ignored
- Best-effort: a logging failure never breaks or fabricates the fetch

**Defers**: own-LAN curl logging (decide at planning — likely symmetric, following `nmap`'s
own-LAN pattern), log rotation.

**RED**: a behavior test that a cross-player fetch appends one line under the owner's key with the
server-derived IP and requested path; that a failed/unreachable fetch logs nothing; that a
no-session reader cannot read the log.
**GREEN**: the formatter + the append call in the handler.
**MUTATE**: Stryker. Expect survivors on the writer-key choice (owner vs caller) — that one is the
keystone, so it must die.
**REFACTOR**: assess whether the three log formatters now warrant a shared shape.
**Done when**: AC 8 passes, mutation report clean, wire-check green, human approves the commit.

---

## Pre-PR Quality Gate (every slice)

1. Mutation testing run and survivors addressed (or reviewed `N/A` with alternate evidence)
2. Refactoring assessment recorded (`N/A` if it adds no value)
3. `npm run typecheck` + `npm run lint` green, full suite passing
4. Version bumped in `v2/package.json` **and** `package-lock.json`
   (`npm install --package-lock-only`)
5. Slices 3–4: wire-check run live against `vercel dev` + supabase
6. Browser confirmation for the player-facing behaviour (`v2-e2e` skill) before D1 closes

## On D1 close-out

- Add the `lynx` slice to the epic's Phase 1 table (it is named in D1's *Defers* but has no row
  of its own yet)
- Run the browser confirmation (`v2-e2e` skill) — **still outstanding from slice 1**. Deferred to
  close-out rather than per-slice because it needs the game up, and a live dev server makes
  Stryker report false survivors (§5 of the conventions doc), so it wants its own pass.
- Extract the shared online → `wlan0` → essid preamble (see "Known duplication" above) as a
  separate behaviour-preserving commit
- Update `conventions-and-gotchas.md` §1 with the D1 completion, then delete this plan file

(The routing correction and the `lynx`/`gobuster` placement are already written into the epic.)

---
*Delete this file when the plan is complete.*
