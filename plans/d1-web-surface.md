# Plan: D1 — the web surface (serve a page, a stranger reads it)

**Branch**: `feat/own-lan-access-log` (cut off `main` at `2030004` for slice 4b).
**Status**: Active — **slices 1–4 of 5 SHIPPED** (v0.104.0 #344 → `c54caa7`; v0.105.0 #345 →
`9b05f6f`; v0.106.0 #346 → `c408fb2`; v0.107.0 #347 → `2030004`). **Slice 4b is next, not
started — it is the LAST slice.** It was added 2026-07-30 when the own-LAN logging question was
settled (see slice 4) — a real slice, not a deferral.
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

## As-built after slice 1

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
is unreachable. ~~`{ userType: 'root' }` → `{}` is equivalent because served pages are
world-readable~~ — **that classification was WRONG and slice 2 killed the mutant; see below.**

**Known duplication, deliberately not yet extracted:** `curl`, `ping` and `nmap` each open with
the same online → `wlan0` → essid preamble (three copies). Every remaining door needs it. Extract
once ~4 real callers exist so the seam is shaped by them, as its own behaviour-preserving commit.

## As-built after slice 2

**Shipped** (v0.105.0, #345 → `9b05f6f`): `commands/webServer.ts` exporting `nginx` + `apache2`
(both registered); `/var/www/html/index.html` in `buildWorkstationBaseFs`; `WEB_PAGE_FILE` in
`baseFs.ts`; `curl`'s own-address resolution. Mutation: `webServer.ts` 100%,
`workstationFs.ts` 100%, `curl.ts` 95.42%. 2114 tests green.

What differs from the plan, and what slice 3 must know:

1. **The "ports below 1024 need root" rule is DROPPED, not deferred.** The root gate refuses every
   non-root caller before the port is parsed, so the rule was an unreachable branch and an
   unkillable mutant. Root or nothing. Do not reintroduce it for another daemon without first
   giving that daemon a reason to admit a non-root caller at all.
2. **The two programs are ONE identity, enforced by the shared pidfile.** `apache2` over a running
   `nginx` is refused with `web server already running on port N` — naming the conflict, because
   `apache2: already running` would be false. Both write `/var/run/nginx.pid`, so the player sees
   nginx's pidfile even if they started apache2: accepted, and the `Server:` header says `nginx`
   for the same reason.
3. **The default page is FIXED, not drawn from `pools/webPages.ts`.** Those pages leak invented
   versions and paths as recon material; on the player's own box that would be a lie, and would
   hand their attackers hints the box does not have. The page names its own path, since nothing
   else in the game tells the player which file to edit.
4. **`curl` resolves the own address to `env.fs.root()` — the LIVE tree** (`targetFs` in
   `curl.ts`), never a generated one. Their box is the only host on the network whose files are
   real; generating one would fabricate a page for a box that may publish nothing. This is also
   what makes a `nano` edit visible: same tree.
5. **A mutation classification EXPIRED.** Slice 1 called `{ userType: 'root' }` → `{}` equivalent
   because served pages are world-readable. Own-box pages break that: a file created under the web
   root is created BY root, and `patchApi.write` stamps the creating tier's defaults
   (`defaultFilePermissions('root')` → `read: ['root']`), so reading as the CALLER would 404 a page
   the player had just published. **Slice 3's server-side read must be the server's too**, not the
   requester's — the requester has no account on that box at all. Now a §4 convention.

**Deliberately not built:** `curl http://localhost` / `127.0.0.1` does not resolve — only the
box's LAN address does. A player will type it; no AC asked for it. Cheap to add whenever it
annoys someone (`targetFs` is the one place that needs to know).

**Still nothing consumes `Command.availability` or `Command.tier`** (verified by grep). Both are
declarative, so their mutants survive and a test asserting them pins data rather than behaviour —
one such test was written for `nginx` and then deleted. The observable gate is the binary's FS
presence, proven through the registry.

## Acceptance Criteria

- [x] A generated host on the player's LAN runs an HTTP service, visible as `:80` in `nmap`, and
      `curl http://<its LAN IP>` returns its generated page
- [x] `ping <host>` reports reachability for a host that exists and failure for one that does not
- [x] A player can start `nginx` (or `apache2`) as root on their own machine; it refuses a
      non-root caller, refuses if already running (reporting the running port), and refuses an
      invalid port
- [x] After starting it, the player's own `/var/www/html/index.html` is served over `curl`, and
      editing that file with `nano` changes what `curl` returns
- [x] Another player who has forwarded `:80` is readable cross-network: `curl http://<their
      public IP>` returns their page **with no session and no credential**
- [x] A target that is dark, bricked, or has no forward returns a connection failure, not a page,
      and leaks nothing
- [x] Nothing outside `/var/www` is reachable over HTTP — a path traversal or a request for
      `/etc/passwd` returns 404, not file content *(own-LAN AND server-side, through the one
      `resolveWebPath`)*
- [x] The owner of a fetched page reads the hit in `/var/log/access.log`, with the requester's
      server-derived source IP and the requested path
- [ ] A fetch on the player's OWN LAN is logged too — on a generated host's `access.log` (readable
      once the player gets in) and on the player's own box when they fetch themselves
- [ ] All gates green: `npm run typecheck`, `npm run lint`, full test suite; version bumped in
      `v2/package.json` + `package-lock.json`

## Slices

Five slices, each one PR. Every slice is a **behavior change** — RED-GREEN with mutation
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

### ✅ Slice 2 (SHIPPED v0.105.0): A player runs their own web server

**Delivered**: `commands/webServer.ts` (`nginx` + `apache2`, one identity behind
`/var/run/nginx.pid`, root-only, streamed startup); the web root in `buildWorkstationBaseFs` with
a fixed default page; `WEB_PAGE_FILE` shared out of `baseFs.ts`; `curl`'s own-address resolution
against the live tree. See "As-built after slice 2" above for the five deviations.

**Original plan for reference:**

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
- **Root or nothing** — the "ports below 1024 require root" rule this plan originally carried is
  DROPPED (decided 2026-07-30). `sshd`'s root gate fires before the port is even parsed, so a
  non-root caller can never reach a port check; mirroring `sshd` and keeping the rule would have
  written an unreachable branch and an unkillable mutant. A high port is refused for the same
  reason as a low one: you are not root
- `/var/www/html/index.html` with a default page in the **workstation** base FS
  (`buildWorkstationBaseFs`), owned appropriately so the player can `nano` it
- Both daemons share one pidfile/service identity so they cannot both bind `:80`
- `apt install nginx` / `apache2` availability (both already in `APT_PACKAGES`)

**Defers**: `systemctl stop` (that is D4), multi-port/multi-line pidfiles, HTTPS on 443.

**RED**: a behavior test that a non-root caller is refused, that a root caller's `nginx` writes
the pidfile and opens `:80`, that a second `nginx` refuses, that `apache2` cannot start over a
running `nginx` (the shared identity), and that `curl` then returns the player's own page.
**GREEN**: the two commands + the base-FS web root + `curl`'s self-address case.
**MUTATE**: Stryker on the changed files. Expect survivors on the port bounds (`1`/`65535`), the
already-running short-circuit, and the self-vs-LAN routing branch in `curl` — kill each.
**REFACTOR**: if `sshd.ts` and the new daemons share more than their gates, extract the common
daemon-start shape; only if it genuinely reduces duplication.
**Done when**: ACs 3–4 pass, mutation report clean, human approves the commit.

---

### ✅ Slice 3 (SHIPPED v0.106.0): A stranger reads a player's page across the network

**Delivered**: `core/network/resolveHttpFetch.ts` (the handler) + its route in `api/network.ts`;
`RemoteApi.fetchPublic` on the command env, wired adapter → `ui/env.ts` → `ui/state.ts`;
`curl`'s `isPublicIp` branch; `scripts/testHttpFetch.ts` (**12/12 live**). 2160 tests green.
Mutation: `networkApi.ts` 100%, `resolveHttpFetch.ts` 98.35%, `curl.ts` 82.17% (see deviation 5).

All three reuses above held as planned. What differs, and what slice 4 must know:

1. **`host_unreachable` vs `not_found` is the security split, and it is deliberate.** Every
   connect-level cause collapses into `host_unreachable` (unknown IP, bricked gateway, bricked
   occupant, forward to an unleased address, occupant off the WiFi, no forward, nothing serving
   the web) so a prober cannot tell which gate stopped it. `not_found` is the reached server's
   404 — it admits a web server is there, which answering the port admits anyway. **Do not
   collapse these further, and do not add a third.**
2. **The liveness check is SERVICE-specific, and hoisted to cover both arms.** Reaching a
   listening daemon is not reaching a web server: a forward onto `sshd`, or the gateway's own
   `:22`, refuses exactly like a closed port. `authCreateSessionPublic` checks "any service on
   that port" inside its forward arm; this handler checks "the **http** service" once, after
   resolving either arm.
3. **The gateway arm is REAL and tested, not dead.** An AP gateway's base FS has no `/var/www`
   at all, but a root session on it can publish one via the journal — so `machineServing` →
   `router` serves the GATEWAY's own page, and a router-own port beats a forward on the same
   port (the same rule ssh routes by). Mutation testing is what proved this arm was previously
   indistinguishable from the forward arm.
4. **The payload carries the RAW url path, and `path` is required.** The server resolves it
   through `resolveWebPath`; a client never names a file on another player's box. Requiring the
   field is load-bearing — defaulting it would let a caller omit the one field the confinement
   is applied to.
5. **`curl.ts`'s mutation score FELL to 82.17% without its logic changing** — its timeouts
   collapsed 29 → 2, so ~27 previously-"killed by timeout" mutants ran to completion and
   survived. Every survivor is in the `Command` metadata block or the two classified slice-1
   narrowing clauses; **none in slice 3's code**. Now a §4 convention.
6. **The tier-3 allowlist is deliberately NOT applied here.** The plan asked for it as
   defence-in-depth, but with `resolveWebPath` confining the path server-side there is no input
   that reaches the read outside `/var/www/html` — so the allowlist could never change an
   answer, and its mutants could never die. One tested confinement beats two, one of which is
   unfalsifiable machinery. Revisit only if the server ever returns a TREE rather than one file.

**Found en route, for slice 4:** `LogApi.appendAccessLog(target, line)` already exists
(`core/commands/types.ts`) and is stubbed in `ui/state.ts` with **no caller anywhere** — dead
speculative surface predating this epic. Slice 4 either uses it or deletes it.

**Original plan for reference:**

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

### ✅ Slice 4 (SHIPPED v0.107.0): A defender sees who fetched their page

**Delivered**: `core/logging/accessLog.ts` (Apache Combined formatter + the `ACCESS_LOG_*`
storage identity); `MONTHS` exported out of `syslog.ts`; `access.log` seeded empty from boot in
`buildWorkstationBaseFs` and `buildRouterFs`; four new deps (`now`, `readLog`, `upsertPatch`,
`findHomeNetworkByOwnerKey`) threaded into `resolveHttpFetch` and its `api/network.ts` route;
`scripts/testHttpFetch.ts` extended to **17/17 live** (was 12). 2179 tests green. Mutation:
`accessLog.ts` **100%**, `resolveHttpFetch.ts` **97.92%**.

What differs from the plan, and what slice 4b must know:

1. **The gateway arm's lease read is deliberately BEST-EFFORT, unlike the forward arm's.** Slice
   3's hand-off said the gateway arm "must start reading leases, or skip logging". It reads them
   — but a failed read yields `logWriterKey: null` and the fetch still serves the page. The
   forward arm's occupant lookup is load-bearing (no occupant ⇒ no target ⇒ no page); the
   gateway's is only asking *whose row to write into*, and losing a log line is not a reason to
   fail a request the server can answer. `apGatewayLogWriterKey` returning `null` on an unleased
   ESSID is the same posture: **the AP simply keeps no log**.
2. **A path traversal is logged VERBATIM, as requested, not as resolved.** `resolveWebPath`
   returns `null` and the fetch 404s, but the line records `/../../etc/passwd` exactly as the
   caller typed it. That is the whole value of the field to a defender: the resolved path would
   say nothing happened.
3. **Three surviving mutants are provably equivalent, not unaudited.** All are
   `X.data ?? []` → `X.data ?? ["Stryker was here"]`. Each consumer reads a field off the element
   (`.octet`, `.owner_key`); a junk string yields `undefined` for that field, so the computed
   answer is byte-identical. Recorded here so nobody re-litigates them at the next mutation run.
4. **A fixed test clock hid a real gap, and mutation found it.** `accessLog.ts` first came back
   78.95% with four `padStart(2, '0')` → `padStart(2, "")` survivors: the whole suite used
   `13:55:36` on the 30th, where every component is two digits, so the padding was never
   exercised. A single-digit hour would have rendered `4:07:09` and no test would have noticed.
   **General lesson for any formatter test: pick a clock whose fields need padding.**
5. **The refactor was assessed and DECLINED.** The three log formatters share only the syslog
   line shape, which is already extracted; `accessLog` is Apache CLF — structurally different
   knowledge that would evolve independently. The identical permission triples are each
   independently justified. Slice 4b's REFACTOR step should re-ask about the two
   LAN-regenerating *handlers*, which is a different question.

**Original plan for reference:**

What slice 3 handed it:

| Hand-off | Detail |
|---|---|
| The append site | `handleResolveHttpFetch` in `core/network/resolveHttpFetch.ts`, **after** a successful resolve — the point where a target is known reachable. Every `host_unreachable` above it logs nothing, matching `authCreateSessionPublic` (no reachable machine ⇒ nothing to log on) |
| Whose key | The **owner's** — the reached occupant's `owner_key`, already in scope in `resolveForwardTarget`. For the GATEWAY arm there is no owner: reuse `apGatewayLogWriterKey(leases)`, as the ssh gate does (and note the gateway arm currently reads no leases — deviation 2 of slice 3 — so it must start, or skip logging) |
| Source IP | `resolveCrossPlayerSourceIp(findHomeNetworkByOwnerKey, publicKey)` — the handler currently destructures only `payload`; it needs `publicKey` too |
| New deps | `now`, `readLog`, `upsertPatch`, `findHomeNetworkByOwnerKey` — copy the shapes from `AuthCreateSessionPublicDeps` and their `api/network.ts` adapters verbatim |
| Dead surface to resolve | `LogApi.appendAccessLog` — **belongs to 4b, and its signature is WRONG.** It is typed `(target: MachineId, line: string)`: a client-composed LINE would let the caller dictate the timestamp and the source IP, which is exactly what this slice forbids. `AuthLogEvent` (`types.ts:225`) carries no timestamp for that reason. 4b replaces it with an event-shaped seam; slice 4 leaves it alone |
| Wire-check | EXTEND `scripts/testHttpFetch.ts`; its `seed()` helper already fails loudly, keep it that way |

**Settled 2026-07-30 — own-LAN `curl` DOES log, in slice 4b.** The question was answered from
realism: an access log belongs to the SERVER, not the network path. nginx writes a line for every
request it serves — localhost, LAN peer, or the far side of the internet; the origin only decides
what lands in the source-IP field. So all three cases log, and "no server round-trip" was never a
reason not to: `nmap` fires `scan.record` (`nmap.ts:291`) from a scan that resolved entirely
client-side, and the server regenerates the LAN to stamp each host. `curl` does the same.

Split across two slices because they are different work, not because one is optional:

- **Slice 4 (this one)**: the cross-player fetch. An append inside a handler that has already
  resolved its target.
- **Slice 4b**: own-LAN — both a generated NPC host AND the player's own box. Needs a NEW signed
  action, handler, adapter and wire-check, mirroring `handleNmapScan` end to end.

**Also settled: a 404 IS logged.** A reached server that answers "no such page" still answered —
realistically that is the most interesting line in the file, because a wall of them is what a
directory brute-force looks like. `gobuster` arrives in D2 and its whole defender-side tell is
404s in this file, so the formatter carries the STATUS from the start. Only a target that was
never reached (every `host_unreachable` cause) leaves no line.

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
- A **status code** in the line (200 and 404 both log; see the settled decision above)
- Best-effort: a logging failure never breaks or fabricates the fetch

**Defers**: own-LAN curl logging (**slice 4b**, not a deferral of the question — the question is
settled), log rotation.

**RED**: a behavior test that a cross-player fetch appends one line under the owner's key with the
server-derived IP and requested path; that a failed/unreachable fetch logs nothing; that a
no-session reader cannot read the log.
**GREEN**: the formatter + the append call in the handler.
**MUTATE**: Stryker. Expect survivors on the writer-key choice (owner vs caller) — that one is the
keystone, so it must die.
**REFACTOR**: assess whether the three log formatters now warrant a shared shape.
**Done when**: AC 8 passes, mutation report clean, wire-check green, human approves the commit.

---

### ⏭ Slice 4b (IN FLIGHT — `feat/own-lan-access-log`): An own-LAN fetch is logged too

**Built, gates green, wire-check pending.** `core/network/recordLanFetch.ts`
(`handleRecordLanFetch`, action `recordLanFetch`) + its route in `api/patches.ts` beside
`nmapScan`; `recordLanFetch` in `adapters/patchApi.ts`; `LogApi.appendAccessLog` reshaped to take
an `AccessLogFetch`; `access.log` seeded on http-rolling generated hosts; `curl`'s own-LAN branch
fires it fire-and-forget. 130 files / 2210 tests green. Mutation: `recordLanFetch.ts` **97.94%**,
`remoteHostFs.ts` **100%**, `curl.ts` **98.74%**.

Four things worth recording while they are fresh:

1. **The dangerous confusion this slice can produce is occupant-vs-address, and mutation is what
   surfaced it.** The caller is usually a registered occupant WITH a workstation, so the occupancy
   lookup will happily hand back their own box for a fetch of a neighbour. Two mutants lived in
   that gap: dropping the "is this address mine?" lease check entirely, and
   `.find(row => row.owner_key === callerKey)` → `.find(() => true)` — the latter survived only
   because every self-fetch test listed exactly ONE occupant. On a two-player LAN it would file
   the line on the wrong player's box. Both are now covered.
2. **`curl.ts`'s mutation score RECOVERED to 98.74%** from slice 3's 82.17%, without its logic
   being touched beyond the new call site. Slice 3 recorded the fall as timeouts collapsing 29 → 2
   and unmasking metadata-block survivors; the new tests re-cover them. The only two left are the
   slice-1 classified type-narrowing clauses.
3. **An errored read is not trusted for the rows it also returned.** The three guards
   (`leases.error` / `occupants.error` / `patches.error`) are unkillable against a store that
   returns `data: null` on error — `?? []` reaches the same answer — so each test now returns rows
   AND an error, which is the claim actually worth making.
4. **The same two `?? []` equivalent mutants as slice 4 remain**, for the same reason: a
   `"Stryker was here"` element yields `undefined` for whichever field the consumer reads
   (`.owner_key`, `.octet`), so the computed answer is identical to the empty array's.

**Original plan for reference. What slice 4 handed it:**

| Hand-off | Detail |
|---|---|
| The formatter | `formatAccessLogLine(AccessLogEvent)` in `core/logging/accessLog.ts` — done, 100% mutation, and event-shaped already (no client timestamp, no client source IP). 4b composes it server-side exactly as slice 4 does; it writes no new formatter |
| The storage identity | `ACCESS_LOG_PATH` / `ACCESS_LOG_OWNER` / `ACCESS_LOG_PERMISSIONS`, shared by the boot seed and the appender so they cannot drift |
| **Missing seed** | `buildRemoteHostFs` has **no `access.log`** — deliberately left for this slice, since nothing wrote to a generated NPC host until now. Workstation and router already have it. Adding it there is 4b's first change |
| The append primitive | `appendMachineLog` — a FAILED read bails without writing, so a log that merely failed to read is never clobbered |
| Source IP | NOT `resolveCrossPlayerSourceIp` — that resolves a *cross-player* public IP. On the caller's own LAN the source is their **LAN** address, which the server already regenerates; `handleNmapScan` is the model |
| Dead surface to kill | `LogApi.appendAccessLog(target: MachineId, line: string)` — still present in `core/commands/types.ts:235`, stubbed in `ui/state.ts:619` + `test/factories/commandEnv.ts:104` + two test files, **no caller anywhere**. Its `line` parameter is the wrong shape (see slice 4's rationale). Replacing it is part of this slice |

**Actor / trigger / outcome**: player → `curl http://<a LAN host>` → breaks into that host later →
`cat /var/log/access.log` and finds their own earlier fetch. And `curl http://<own IP>` → the line
lands on their own box, where they can read it immediately.
**Value**: the log stops being a cross-player-only artefact. It is the same file wherever you read
it, which is the point of it being the *server's* log. It also gives the player the one place they
can see what an access log looks like **before** anyone attacks them.
**Path**: `curl`'s own-LAN branch (`targetFs`, `curl.ts:91`) → fire-and-forget signed action →
**new handler**: regenerate the caller's LAN from the verified pubkey + essid → resolve the target
IP to either the caller's own workstation (via their `network_lan_leases` address) or a generated
NPC host (via `resolveLanHostIdentity`) → `appendMachineLog`.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`; `refactoring` assessed.
**Wire-check**: **required** — a new `scripts/` check, or an extension of `testHttpFetch.ts`.

**This slice is `handleNmapScan` again, with a different line.** Read `core/scan/nmapScan.ts`
before starting; it answers most of the design questions already, and its module doc explains why.

**Acceptance criteria — confirmed 2026-07-30, before RED:**

1. **The NPC case.** `curl http://<a LAN host serving http>` appends exactly ONE line to *that
   host's* `/var/log/access.log`, under the **caller's** writer key, carrying the caller's LAN IP
   and the requested path. Observable when the player later gets into that host and `cat`s it.
2. **The self case.** `curl http://<own LAN IP>` appends the line to the caller's OWN workstation,
   readable immediately with `cat /var/log/access.log` — no break-in. This is the player's only
   way to see what an access log looks like *before* anyone attacks them.
3. **A 404 logs**, with status `404` and size `0`; a traversal logs the path **verbatim as
   requested**, not as resolved (slice 4's rule, unchanged).
4. **Only a reached server logs.** A LAN host that resolves but is not serving http leaves no
   line; a host that does not resolve leaves none. The SERVER re-checks this against the tree it
   resolved — it does not take the client's word that something answered.
5. **The client dictates nothing but the target.** No machine id, no timestamp, no status and no
   size cross the wire. The server resolves which machine the line lands on (own workstation from
   the verified pubkey, NPC host via `resolveLanHostIdentity`), reads the tree, and computes
   status and size itself.
6. **Best-effort.** `curl`'s output is byte-identical whether the log write succeeds, fails, or
   the seam is unwired.
7. **`LogApi.appendAccessLog(target, line)` is deleted** and replaced by the event-shaped seam,
   along with all four stubs.
8. **`/var/log/access.log` seeded** in `buildRemoteHostFs`, http-rolling hosts only.
9. **Gates**: typecheck, lint, full suite, mutation report, version bumped in both package files,
   wire-check run LIVE.

**Settled with those criteria — the source IP is CLIENT-supplied here, unlike slice 4.** Found by
reading `nmapScan.ts` end to end: it SPLITS. `traceOccupants` (writing on a real other player's
box) resolves the scanner's address from `network_lan_leases` server-side, but `logHostScan`
(writing on the caller's regenerated NPC host) takes `payload.source_ip ?? 'unknown'`. Both of 4b's
targets fall on the second side of that split, so it mirrors `nmap`. The reason it is safe here and
was not in slice 4: an NPC host's row is per-viewer keyed, so the only reader of that line is the
person who wrote it; and the player's own box is one `su` away from `nano /var/log/access.log`
anyway — forging the field grants no capability they do not already have. Deriving it server-side
would cost a lease read and add a "no lease ⇒ no line" failure mode to buy nothing. In slice 4 the
source is ANOTHER player, who must never be able to author their own trace — hence the difference.

**Known divergence, accepted rather than fixed:** on the self case the server reads the
JOURNAL-materialized tree while the client reads the LIVE one, so a `nano` edit that has not landed
server-side yet means the logged size can trail what the player just saw. The alternative is the
client sending the size, which breaks criterion 5. Recorded so this is a decision, not a bug
someone rediscovers later.

**Includes**:
- `/var/log/access.log` seeded empty in `buildRemoteHostFs` (workstation + router already have it
  from slice 4), **only on hosts that rolled the http service** (settled 2026-07-30). It sits
  under the same condition as the `/var/www/html/index.html` line directly above it in the same
  generator: a box that can never be fetched can never have a line written, so an empty file
  there would be furniture. Note this differs from the workstation, where the file is
  unconditional — a player can `apt install nginx` at any moment, so their box is always
  web-capable; a generated host's service set is fixed at generation
- A new signed action + handler mirroring `handleNmapScan`: the client sends `essid`, target IP
  and path; the SERVER decides which machine the line lands on. The client never names a machine
  id — same rule as the cross-player path, for the same reason
- The self-fetch case: the caller's own workstation, resolved server-side from the verified pubkey
  (`nmapScan.ts:12` skips self-scan because the generic remote-log path is keyed by `hostMachineId`
  and cannot address a workstation — the cross-player handler CAN, so the self case is reachable
  here in a way it was not for `nmap`)
- Replace `LogApi.appendAccessLog(target, line)` with an **event-shaped** seam — no client
  timestamp, no client status, no client size, and no client machine id; the source IP is the one
  field the client does supply (see the settled decision above). Deleting the old signature and
  its four stubs is part of this slice
- `curl`'s own-LAN branch fires it fire-and-forget (`void … .catch(() => undefined)`, exactly as
  `nmap.ts:291` does) — the fetch must not wait on, or fail with, the log write

**Writer key — simpler here than in slice 4, and worth stating so nobody looks for a bug:** the
**caller's** key in BOTH cases. A generated NPC host has no owner, so it is per-viewer keyed
(`nmapScan.ts:147` does exactly this); the player's own box IS owned by the caller. So 4b never
needs the owner-vs-caller distinction — which is precisely why slice 4 is where that keystone gets
proven.

**Defers**: logging a fetch of an NPC host by a player who is not on that LAN (there is no such
path); log rotation.

**RED**: a behavior test that an own-LAN fetch of a generated host appends one line to THAT host's
`access.log` under the caller's key with the caller's LAN IP and the requested path; that a
self-fetch lands on the caller's own workstation; that a fetch of a host that is not serving
(no line, because nothing answered); that a 404 on a real server DOES log with its status; and
that a client-supplied machine id or timestamp cannot influence where the line lands or what it
says.
**GREEN**: the action, the handler, the adapter wiring, and the `curl` call site.
**MUTATE**: Stryker. Expect survivors on the self-vs-NPC target resolution and on the
fire-and-forget path (a `void`ed promise is easy to test into a false green — assert the seam was
called with the resolved values, not that the fetch succeeded).
**REFACTOR**: by now there are three log formatters and two LAN-regenerating handlers. Assess a
shared shape for real this time; note that `nmapScan.ts` and this handler differ only in what they
resolve and what they write.
**Done when**: AC 9 passes, mutation report clean, wire-check green, human approves the commit.

---

## Pre-PR Quality Gate (every slice)

1. Mutation testing run and survivors addressed (or reviewed `N/A` with alternate evidence)
2. Refactoring assessment recorded (`N/A` if it adds no value)
3. `npm run typecheck` + `npm run lint` green, full suite passing
4. Version bumped in `v2/package.json` **and** `package-lock.json`
   (`npm install --package-lock-only`)
5. Slices 3, 4, 4b: wire-check run live against `vercel dev` + supabase
6. Browser confirmation for the player-facing behaviour (`v2-e2e` skill) before D1 closes

## On D1 close-out

- Add the `lynx` slice to the epic's Phase 1 table (it is named in D1's *Defers* but has no row
  of its own yet)
- Run the browser confirmation (`v2-e2e` skill) — **still outstanding across slices 1–4**.
  Deferred to close-out rather than per-slice because it needs the game up, and a live dev server
  makes Stryker report false survivors (§5 of the conventions doc), so it wants its own pass. The
  slice-2 path to walk: `apt install nginx` → `su` → `nginx` → `curl http://<own IP>` → `nano` the
  page → `curl` again and see the edit. After 4b that same walk continues into
  `cat /var/log/access.log`, where the player's own fetches are now waiting — which makes it the
  single best demo of the whole D1 surface.
- Extract the shared online → `wlan0` → essid preamble (see "Known duplication" above) as a
  separate behaviour-preserving commit. **Slice 3 has landed, so this is now decidable**: `curl`
  needs `isOnline` + `wlan0` for BOTH branches but the `essid` only for the own-LAN one, so the
  seam is "online + addressed wlan0" and the essid read stays at the own-LAN call site.
- Add a `runLine`-level test for `curl -i` so the `flags` declaration is covered. Slice 3's
  mutation run showed `flags: { '-i': 'boolean' }` → `{}` surviving: it IS consumed (by the argv
  parser) but command tests hand-build the flag map and bypass it. Pre-existing since slice 1,
  surfaced only when timeouts stopped masking it. See §4 of the conventions doc.
- Decide whether `curl http://localhost` / `127.0.0.1` should resolve (slice 2 left it out; a
  player will type it). One place knows: `targetFs` in `curl.ts`.
- Update `conventions-and-gotchas.md` §1 with the D1 completion, then delete this plan file

(The routing correction and the `lynx`/`gobuster` placement are already written into the epic.)

---
*Delete this file when the plan is complete.*
