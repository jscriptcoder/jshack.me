# Plan: X2 Slice 1 — An Institution Has a Website You Reach by Name

**Epic:** `plans/legacy-parity-epic.md`, X2 slice 1. Grill record: "X2 — resolved scope & decisions"
(decisions 91–105, 2026-09-26), plus **seven decisions made at planning** (2026-09-26, owner-confirmed
as a set) restated under "Decided at planning" below.

**Status:** 1a merged (v0.265.0, PR #551); 1b merged (v0.266.0, PR #552); 1c merged (v0.267.0, PR #553); 1d built (v0.268.0, `feat/a-bare-address-is-a-url`, PR open).

**Delivery:** four independent PRs against trunk, merged in order (each builds on the one before
it through `main`, not through a stack).

| PR | Branch | Version | Owns |
|---|---|---|---|
| 1a | `feat/a-publisher-answers-at-its-ip` | v0.265.0 | catalog `site`, derived `193.` addresses, the guaranteed webserver and its forward, forwards that reach a generated box (fetch + scan), the server-side derivation fallback |
| 1b | `feat/a-domain-resolves` | v0.266.0 | the world-name step in `resolveName`; `nmap`/`ssh` resolving before the public check; `lynx` resolving at all |
| 1c | `feat/the-forward-is-a-way-in` | v0.267.0 | the public-target resolver's generated-box fallback, so an exploit through the forwarded `:80` lands inside the LAN |
| 1d | `feat/a-bare-address-is-a-url` | v0.268.0 | `curl`/`lynx` taking a scheme-less address as `http://`, as the real tools do (added after 1b, owner-agreed 2026-09-26) |

Each PR bumps `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

---

## Goal

From any network, a player types `curl http://ridgemont.edu/` and reads Ridgemont University's
homepage; `nmap ridgemont.edu` shows the gateway's `22` and the forwarded `80`; and a live CVE on that
webserver is a way into the university's LAN — all before anybody has ever joined its wifi.

## Grounding (verified 2026-09-26, v0.264.0)

- **Publishers.** `ESSID_CATALOG` (`generation/pools/essidCatalog.ts:40`) is built by
  `entries(category, [essid, place][])` (`:35`). Its consumers are `crackableEssidPool`
  (`generateWifi.ts:50`, order load-bearing) and `CATALOG_BY_ESSID` (`persona.ts:40`). **No test
  sweeps the catalog today**; the uniqueness tests here are the first.
- **Addresses.** `generatePublicIp` and `isPublicIp` (`generation/ip.ts:21`, `:36`) share
  `publicFirstOctets` (`:16`), which has no `193`. Join allocation is `allocatePublicIp`
  (`network/allocatePublicIp.ts:33`), wired at `api/network.ts:807` with a random `drawIp`, a
  `readByEssid` (`:720`) and a `claim` (`:736`) against `network_public_ips(essid PK, public_ip UNIQUE)`.
- **The IP → network lookup is written three times**, each building
  `{router_machine_id: computeApGatewayId(essid), essid}`: `api/network.ts:95` (`webTargetDepsVia`:
  `resolveHttpFetch`, `resolveHttpSweep`), `api/network.ts:281` (`resolvePublicScan`),
  `api/sessions.ts:183` (`findNetworkByPublicIpVia`: exploit, public auth, mysql, redis, snmp,
  hydra). **A new `api/*.ts` file is a new Vercel endpoint**, so a shared helper cannot live there.
- **Gateway.** `RULES_V4_SEED` (`generation/routerFs.ts:131`) forwards nothing;
  `buildApGatewayBaseFs(essid)` (`:385`) shares `buildRouterBaseFsFromIdentity` (`:350`) with the
  inner/deep gateways. Gateway sshd is a roll at rate 1 (`seedApGatewayHasSsh`, `:104`).
  `machineServing` (`network/machineServing.ts:31`) reads the forward.
- **A forward resolves ONLY to a player occupant**, in three resolvers: `resolveForwardTarget` in
  `network/resolveHttpFetch.ts:160` and `network/resolvePublicTarget.ts:154`, and
  `resolveForwardTargets` in `scan/resolvePublicScan.ts:144`. Precedent for a generated target:
  `scan/resolveSameLanScan.ts:79-98` (`resolveLanHostIdentity` → `findPatches` →
  `materializeMachineFs` → `canBoot`) and `network/resolveInnerGatewayTarget.ts:133-195`.
- **Webservers.** `generateHomeLan(essid)` (`generation/generateHomeLan.ts:53`) names siblings from
  `machineRole` (`machineRole.ts:73`, webserver 16%); the role is read back from the hostname
  (`roleOfHostname`, `pools/hostnames.ts:66`). A webserver runs http at 0.95
  (`rolePlacement.ts:~55`) on `80`, else `8080`/`8000` (`serviceCatalog.ts:193-204`). **Extra PRNG
  draws in `generateHomeLan` move octets the lease allocator excludes** — override, never draw.
- **Names.** `resolveName` (`network/resolveName.ts:89`) and `addressForTarget` (`:124`) are LAN-only
  ("There is no world DNS here", `:15-17`). `curl`, `ftp`, `scp`, `nc`, `msfconsole` resolve before
  their public check; **`nmap` (`:352` before `:366`) and `ssh` (`:272` before `:288`) check
  `isPublicIp` first**; `lynx` (`:63`), `gobuster`, `hydra` never resolve. `nslookup`/`dig` call
  `resolveName` directly.
- **Tests and wire-checks.** Colocated `*.test.ts` for all of the above
  (`resolvePublicTarget` is covered only via `authCreateSessionPublic.test.ts`);
  `test/factories/commandEnv.ts` (`fetchPublic` NOT_IMPLEMENTED at `:112`); wire scripts
  `scripts/testHttpFetch.ts`, `testCrossPlayerScanTrace.ts`, `testPublicIpAllocation.ts` (asserts
  `isPublicIp(stored)`), fixture helpers in `scripts/networkFixture.ts`.

## Scope boundary

**In:** the 32 publishers' `site`, addresses, webservers and forwards; world names for every command
that already resolves names, plus `lynx`; the forward as an exploit route.

**Not built here, deliberately:** findit.io itself and `<meta name="description">` (slice 2); player
pages in any index (slice 3); `gobuster`/`hydra` name resolution; any change to the gateway's own
ports; new categories (slices 5–6).

## Decided at planning (2026-09-26)

1. **Reserved octet `193`.** A publisher's IP is `193.x.y.z` from `createPrng('publisher-ip-<essid>')`;
   `isPublicIp` accepts `193`, `generatePublicIp` never draws it. A catalog-wide test proves the 32
   addresses distinct.
2. **Joining stores the derived address**, and the server's IP → network lookup falls back to the
   derivation on a miss — ONE pure `core/` function wrapped around each of the three `api/` lookups
   (module scope inside each endpoint; no new `api/` file).
3. **The webserver is guaranteed by override, never by a draw.** If no sibling is a webserver, the
   lowest-addressed ordinary sibling becomes one; the publisher's webserver always runs http; the
   gateway seeds `forward 80 to <ip>:<httpPort>` with the port it actually rolled.
4. **All three forward resolvers fall back to the generated LAN box** at the forwarded address when no
   occupant matches (fetch and scan in 1a, public target in 1c).
5. **World names resolve inside `resolveName`**, so `nslookup` sees them; `nmap` and `ssh` resolve
   before the public check; `lynx` goes through `addressForTarget`. `gobuster`/`hydra` stay out.
6. **Names** — one fictional city, Ridgemont:

   | ESSID | domain | name |
   |---|---|---|
   | 20 corporates | `acme.com`, `initech.com`, `globex.com`, `waystar.com`, `dundermifflin.com`, `hooli.com`, `umbrellacorp.com`, `starkindustries.com`, `cyberdyne.com`, `oscorp.com`, `weyland-yutani.com`, `tyrellcorp.com`, `aperturescience.com`, `shinra.com`, `abstergo.com`, `wonkalabs.com`, `ocp.com`, `piedpiper.com`, `vandelayindustries.com`, `nakatomi.com` (catalog order) | their `place` |
   | 6 cafés | `brewandcode.com`, `beanthere.com`, `midnightdiner.com`, `nightowlcafe.com`, `groundzerocoffee.com`, `espressoexpress.com` | their `place` |
   | `CAMPUS-GUEST-OPEN` | `ridgemont.edu` | Ridgemont University |
   | `LIBRARY-PATRON` | `ridgemontlibrary.org` | Ridgemont Public Library |
   | `CITY-PARK-WIFI` | `ridgemontparks.gov` | Ridgemont Parks Department |
   | `METRO-COMMUTER` | `ridgemontmetro.gov` | Ridgemont Metro |
   | `AIRPORT-LOUNGE-VIP` | `flyridgemont.com` | Ridgemont International Airport |
   | `TRAIN-STATION-FREE` | `ridgemontcentral.org` | Ridgemont Central Station |

7. **Three independent PRs**, v0.265.0–v0.267.0, each closed by a `v2-e2e` browser run; 1a and 1c
   carry an `api/` change and so a wire-check.

---

## Slices

Every slice is a **behavior change**. Required implementation skills for each: `tdd`, `testing`,
`functional`, `refactoring` (after each green), `typescript-strict`; `v2-e2e` for the closing browser
run; `mutation-testing` at the PR-readiness gate. Reduction program: `N/A`. Transition/terminal
evidence: `N/A`.

### Slice 1a: A publisher's website answers at its public IP, from anywhere, before anyone joins

**Value:** a player on any network who has a publisher's `193.` address reads its homepage and sees
`22` + `80` on a scan — the public web exists for the first time.
**Path:** `curl`/`nmap <193 IP>` → `isPublicIp` → `fetchPublic` / public scan → `api/network.ts` →
IP → network lookup (derivation fallback) → gateway FS (seeded forward) → `machineServing` → forward
resolver (generated-box fallback) → webserver FS → page / port table; `access.log` on the webserver.
**Class:** behavior change. **Delivery:** independent PR against trunk.

**Acceptance criteria:**
- [x] Every institutional-category catalog network that hosts a site has a distinct domain and a
      distinct `193.` address; no other network has either.
- [x] `isPublicIp` accepts a publisher address; `generatePublicIp` never produces one.
- [x] A publisher's LAN always has a webserver serving http, and a non-publisher's LAN is exactly as
      it was (same hosts, same addresses).
- [x] A publisher's gateway `rules.v4` forwards public `80` to that webserver's http port; a
      non-publisher's forwards nothing.
- [x] `curl http://<publisher IP>/` from a player on an unrelated network returns the webserver's
      homepage, with no player ever having joined the publisher, and the hit lands in that
      webserver's `access.log`.
- [x] `nmap <publisher IP>` shows `22/tcp open ssh` and `80/tcp open http`.
- [x] A player who joins a publisher is given its derived address.
- [x] A forward to a LAN address held by an occupant still reaches the occupant (no regression).

**RED (in order, one increment each):**
1. Catalog sweep: every `site` sits on an institutional category, domains are unique, publishers
   are exactly the 32 in decision 6.
2. `publisherIp(essid)`: distinct `193.` addresses across the catalog; `isPublicIp` true;
   a large sample of `generatePublicIp` never starts with `193`.
3. `generateHomeLan` for a publisher has a webserver; for every non-publisher it is unchanged
   (snapshot of hosts + IPs before the change).
4. A publisher's webserver serves http (its services list), and `buildApGatewayBaseFs` for a publisher
   carries `forward 80 to <webserver ip>:<its http port>`.
5. The IP → network fallback: a derived address with no stored row resolves to its ESSID; an unknown
   address still resolves to none.
6. `resolveHttpFetch` for a publisher address with no occupant returns the webserver's homepage and
   records the hit on the webserver.
7. `resolvePublicScan` for a publisher address reports `22` and `80` open.
8. Join allocation returns the derived address for a publisher (the `allocatePublicIp` wiring).

**GREEN:** optional `site` on catalog entries (and on `entries`); `publisherIp`; `193` in
`isPublicIp` only; the webserver override in `generateHomeLan`; http pinned on the publisher's
webserver; the seeded forward through an optional rules argument to the shared router builder; the
core fallback wrapped in the three `api/` lookups; the generated-box fallback in the fetch and scan
forward resolvers (modelled on `resolveSameLanScan`); the `drawIp` wiring.
**REFACTOR:** the fetch and scan resolvers' fallbacks are the same lookup — extract it if the two
copies match once green.
**Wire-check:** a new `scripts/testPublisherWeb.ts` against `vercel dev` + local supabase —
`curl` and `nmap` of a publisher address with `network_public_ips` cleared, then after a join; and
`testPublicIpAllocation.ts` still green.
**Browser:** `v2-e2e` — from the player's own network, `curl http://<ridgemont.edu's address>/` and
`nmap` it.
**PRE-PR MUTATION:** Stryker on the changed core files (json reporter; scope per file, capped
concurrency); address valuable survivors in the same gate.
**Done when:** all criteria checked, typecheck + lint + tests green, the wire-check passes live, the
browser run is recorded, mutation reviewed.

**As built (2026-09-26):**
- **Decided mid-slice — the AP log key.** A fetch of a publisher nobody had joined had no writer key
  to log under (shared logs keyed to the lowest lease holder). Owner chose a stable per-network key,
  `ap:<essid>`, for EVERY AP's ownerless boxes; lease reads that only picked the key were removed,
  and a player's write to a generated database now lands in the network's row too.
  `docs/cross-player-architecture.md` updated.
- New modules: `generation/publisher.ts` (`publisherSite`, `publisherIp`, `publisherAt`),
  `generation/siteServer.ts`, `network/generatedLanBox.ts` (the shared fetch/scan fallback).
- Gates: suite 6120 green; wire-checks `testPublisherWeb` 6/6 plus 37 others live; browser run from
  `BOFH-KEEPOUT` — `curl http://193.46.209.111/` returned the campus homepage, `nmap` showed
  22/161/80, no stored address, hit logged under `ap:CAMPUS-GUEST-OPEN`. Mutation in four scoped
  batches: all own-line mutants killed or hand-verified (module-load statics the vitest runner
  cannot reload), `isPublicIp` gained direct tests, two redundant conditions removed.
- **Carried to slice 2:** the generated homepage is titled with the network's `place` ("The
  campus"), not the site `name` ("Ridgemont University"); findit ranks titles, so slice 2's homepage
  work should title a publisher's page with its site name.

### Slice 1b: A domain resolves, anywhere, for every command that takes an address

**Value:** the player types `ridgemont.edu` instead of an address — the web reads like the web.
**Path:** command → `addressForTarget` / `resolveName` (world step first) → the existing public path.
**Class:** behavior change. **Delivery:** independent PR against trunk, after 1a merges.

**Acceptance criteria:**
- [x] `nslookup ridgemont.edu` answers the derived address from any network.
- [x] `curl http://ridgemont.edu/` and `lynx http://ridgemont.edu/` return the homepage (see as-built: the
      bare `lynx ridgemont.edu` form is an open question).
- [x] `nmap ridgemont.edu` shows `22` + `80` (it resolves before deciding the target is public).
- [x] `ssh <user>@ridgemont.edu` reaches the publisher's gateway, as `ssh` to its address does.
- [x] A LAN name still resolves on its own LAN; an unknown name still passes through unchanged.

**RED:** `resolveName` for a world domain from any ESSID; a LAN name unchanged; then one command
test each for `nslookup`, `curl`, `nmap`, `ssh`, `lynx` naming a domain.
**GREEN:** a world-name table derived from the catalog, consulted first in `resolveName`; `nmap`
and `ssh` move their public check after resolution; `lynx` calls `addressForTarget`. Update the
`resolveName.ts` module doc and `conventions-and-gotchas.md` §1's X1 note.
**REFACTOR:** assess only.
**Wire-check:** `N/A` — client-only; the public paths it reaches are 1a's, already wire-checked.
Evidence: command tests + the browser run.
**Browser:** `v2-e2e` — `nslookup`, `curl`, `nmap`, `lynx` on `ridgemont.edu`.
**PRE-PR MUTATION:** Stryker on `resolveName.ts` and the changed command files.
**Done when:** criteria checked, gates green, browser run recorded, mutation reviewed.

**As built (2026-09-26):**
- **World names first.** `siteAddress(domain)` in `generation/publisher.ts` (a catalog-derived
  domain → `193.` table) is consulted first in `resolveName`, case-folded, with no occupant round
  trip; a player who names their box `acme.com` cannot take Acme's traffic.
- **`nmap` and `ssh` resolve before `isPublicIp`.** `ssh` keeps one occupant read via a lazily
  cached promise (a test pins the single read); a domain or an address costs none.
- **`lynx` resolves, and so does a followed link** (`followLink` in `ui/state.ts`) — not in the plan,
  but a page opened by domain carries the domain in every relative link. The address bar keeps the
  typed name.
- **Resolved by 1d (v0.268.0):** `lynx`/`curl` rejected a scheme-less URL, so the AC's bare
  `lynx ridgemont.edu` is built and tested as `lynx http://ridgemont.edu/`. Accepting bare hosts
  (as real `lynx` and `curl` do) is a separate `parseHttpUrl` change.
- **Gates:** 6134 unit tests green, typecheck and lint clean. Stryker (scoped, 95 mutants): 84
  killed; survivors are `publisher.ts` module-load statics (hand-verified: the mutant throws at
  import) and one pre-existing X1 regex; 3 NoCoverage on `followLink`'s pre-existing offline alert.
- **Browser (v0.266.0, from `APT-3B-WIFI`):** `nslookup` → `193.46.209.111`; `nmap` → 22/161/80;
  `curl` → the campus homepage; `lynx` → homepage, then About followed by link; `ssh
  admin@ridgemont.edu` → password prompt, refused server-side.

### Slice 1c: The forward is a way in

**Value:** decision 105 made real — a live CVE on a publisher's webserver, found from outside, lands
the attacker inside that LAN without cracking its wifi.
**Path:** `msfconsole` against `<domain>:80` → `api/sessions.ts` exploit path → IP → network lookup
→ `resolvePublicTarget` (generated-box fallback) → session on the webserver → trace in its log.
**Class:** behavior change. **Delivery:** independent PR against trunk, after 1b merges.

**Acceptance criteria:**
- [x] With a live http CVE on a publisher's webserver, the exploit through its public `80` opens a
      session ON THE WEBSERVER (its hostname, its LAN address), not on the gateway.
- [x] The exploit's trace lands in the webserver's own log, under the network's `ap:<essid>` key,
      naming the attacker's server-derived source IP.
- [x] With no live CVE, the exploit refuses as it does on any box.
- [x] Occupant forwards behave exactly as before.

**RED:** `resolvePublicTarget` for a publisher's forwarded port with no occupant returns the
generated webserver; then the exploit session test (`exploitCreateSession`) landing on it.
**GREEN:** the generated-box fallback in `resolvePublicTarget`'s forward resolver, sharing 1a's
lookup if extracted.
**REFACTOR:** if all three resolvers now carry the same fallback, consider consolidating.
**Wire-check:** extend the exploit cross-network script (or a new one) to exploit a publisher's
webserver with no occupant; session lands, trace written.
**Browser:** `v2-e2e` — `nmap -sV ridgemont.edu` → `msfconsole` → a shell on the webserver.
**PRE-PR MUTATION:** Stryker on `resolvePublicTarget.ts` and any extracted helper.
**Done when:** criteria checked, gates green, wire-check live, browser run recorded, mutation
reviewed.

**As built (2026-09-26):**
- **The fallback lives in `resolvePublicTarget`'s forward resolver**, reusing 1a's
  `generatedLanBox` (which now also hands back the host, for its hostname and kind). No occupant at
  the forwarded address → the generated box, boot-gated, journal-replayed, logging under
  `ap:<essid>`. So every door on that resolver gains it at once: login, `hydra`, the data doors,
  `snmpset` and `msfconsole`. No consolidation with the fetch and scan resolvers: the three
  target shapes differ, and the shared knowledge is already `generatedLanBox`.
- **Filtered or stopped reads as dark**, like an occupant's box: the forward's internal port
  must be open to the network on the generated box too (`listensOn`, now shared by both
  branches), else `host_unreachable`.
- **The generated box keeps the segment it fronts from inside** (`frontedSegment` with its own
  kind), so an inner router reached through a player's forward takes `snmpset` NAT writes into its
  hidden layer and refuses LAN ones. This was not in the plan; a mutation survivor showed it
  untested, and two `snmpSetCrossPlayer` tests now pin it.
- **Found in play:** on today's game day (76) every publisher's webserver ships `nginx 1.26.0`,
  whose live hole is `script_exec` (high, user) and not a shell. So the shell criterion is proven
  in unit tests and in the wire-check by walking the manifest onto `1.27.0` (`shell_full`, guest).
  The browser proves the same path with the stock hole.
- **Gates:** 6142 unit tests green, typecheck and lint clean. Stryker (scoped,
  `resolvePublicTarget.ts` + `generatedLanBox.ts`): `generatedLanBox` 19/19; `resolvePublicTarget`
  141 killed, 1 survived (pre-existing `kind: 'router'` on the AP gateway: equivalent, since
  `frontedSegment` ignores kind for the AP), 2 NoCoverage (pre-existing `?? []`).
- **Wire-check:** new `scripts/testExploitPublisherSite.ts`, 6/6. The session lands on `www-59`,
  the trace is in its `auth.log` under `ap:CAMPUS-GUEST-OPEN` naming the server-held attacker
  address, and a clean release refuses `not_vulnerable`. Re-run green:
  `testExploitApGateway` 15/15, `testPublisherWeb` 6/6, `testExploitCrossPlayer` 14/14,
  `testHydraCrossPlayer` 16/16, `testMysqlCrossPlayer` 8/8, `testRedisCrossPlayer` 13/13,
  `testSnmpCrossPlayer` 15/15, `testCrossPlayerRouter` 8/8.
- **Browser (v0.267.0, from `APT-3B-WIFI`):** `nmap -sV ridgemont.edu` → `80/tcp http
  nginx/1.26.0 CVE-2026-0269486 high`; `msfconsole ridgemont.edu 80 pwn.js` → `Script injected
  on 193.46.209.111 as user`. The script's `/tmp/through-the-forward.txt` landed on
  `www-59-650d566f`, and its `auth.log` line (under `ap:CAMPUS-GUEST-OPEN`) names the
  attacker's home address.

### Slice 1d: A bare address is a URL

**Value:** the player types what they would type into a real terminal — `lynx ridgemont.edu`,
`curl ridgemont.edu/about.html` — and gets the page, where today both answer `(3) URL rejected`.
Makes 1b's `lynx ridgemont.edu` criterion true as written.
**Path:** `curl`/`lynx` argument → `parseTypedUrl` (scheme-less input read as `http://<input>`) →
the existing resolve-and-fetch path.
**Class:** behavior change. **Delivery:** independent PR against trunk, after 1c merges.
**Decided (2026-09-26):** a missing scheme means `http://`, as both real tools default. Deliberately
NOT copied: `curl`'s `ftp.`/`imap.`-prefix protocol guessing, `lynx`'s local-file-first check and
its `www.`/`.com` expansion. An explicit `https://` behaves as it does today.

**Acceptance criteria:**
- [x] `curl ridgemont.edu` and `curl ridgemont.edu/about.html` return the same page as the
      `http://` forms.
- [x] `lynx ridgemont.edu` opens the homepage; its address bar shows the normalised
      `http://ridgemont.edu/`.
- [x] A bare LAN name or address (`curl printer-111`, `curl 192.168.x.y:8080/`) works the same way.
- [x] An explicit scheme — `http://`, `https://`, or one the tools do not speak — behaves exactly as
      before.

**RED:** a `curl.test.ts` and a `lynx.test.ts` case on a bare domain, both failing with
`URL rejected`. **GREEN:** the default in `parseHttpUrl`. **REFACTOR:** assess.
**Wire-check:** `N/A` — client-only, no `api/` change. **Browser:** `v2-e2e` — `curl ridgemont.edu`,
`lynx ridgemont.edu`. **PRE-PR MUTATION:** Stryker on the URL parser.
**Done when:** criteria checked, gates green, browser run recorded, mutation reviewed.

**As built (2026-09-26):**
- **A new entry point, not a change to `parseHttpUrl`.** `parseTypedUrl` in `network/http.ts` reads a
  string with no `://` as `http://<input>` and hands back the parsed URL plus the spelling to show.
  `parseHttpUrl` stays strict because `resolveHref` needs it that way: a href with no scheme is
  RELATIVE, and `about.html` must never become a host. `gobuster` still takes only full URLs.
- **`lynx`'s address bar spells shorthand out in full** (`http://ridgemont.edu/`, the web's own
  port left unwritten). That is required, not cosmetic: the address bar is the base every link
  resolves against, so a bare base would break following links. A URL typed with its scheme
  keeps its typed spelling.
- **Manuals** for both commands name the shorthand and carry a bare-domain example. The `v2-e2e`
  runbook row that said "lynx wants a URL" is corrected.
- **Gates:** 6146 unit tests green, typecheck and lint clean. Wire-check `N/A`: client-only, no
  `api/` change. Stryker on `http.ts`: 111 killed, 1 survived — the pre-existing
  `host === undefined` guard, equivalent since the pattern always captures a host. The two
  pre-existing `^`/`$` anchor survivors were killed by new `parseHttpUrl` cases; they matter more
  now that typed input reaches the parser.
- **Browser (v0.268.0, from `UPSTAIRS-NEIGHBOR`):** `curl ridgemont.edu` → the campus homepage;
  `lynx ridgemont.edu` → address bar `http://ridgemont.edu/`, then link 3 (About) followed to
  `http://ridgemont.edu/about.html`.

## Pre-PR Quality Gate (each PR)

1. Implementation complete, refactoring assessed.
2. Mutation testing on the PR's changed core files; valuable survivors killed.
3. `npm run typecheck` and `npm run lint` from `v2/` pass; `npm test` green.
4. Wire-check live where the PR touches `api/`.
5. Version bumped in `package.json` + `package-lock.json`.

## Risks

- **Re-rolled content on publisher LANs.** The webserver override changes one sibling's role on
  publishers that had none; that box's content changes. Allowed pre-launch; the non-publisher
  snapshot test guards everyone else.
- **Build budget.** A publisher's gateway now forwards to a box the server must materialize per
  request; measure the fetch path against the existing same-LAN scan cost.
- **A publisher whose rolled webserver port is `8080`/`8000`.** The forward maps public `80` to it;
  `nmap` of the gateway must still say `80`.
