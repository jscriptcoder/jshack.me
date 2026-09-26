# Plan: X2 Slice 2 — findit.io Answers a Search

**Epic:** `plans/legacy-parity-epic.md`, X2 slice 2. Grill record: "X2 — resolved scope & decisions"
(decisions 91–105, 2026-09-26); slice 1's as-built is in the same section. Two owner decisions made
at planning (2026-09-26) and the choices derived from existing conventions are listed under "Decided at
planning" below.

**Status:** 2a merged (v0.269.0, PR #555); 2b not started (`feat/lynx-submits-a-form`).

**Delivery:** two independent PRs against trunk, merged in order (2b builds on 2a through `main`, not
through a stack).

| PR | Branch | Version | Owns |
|---|---|---|---|
| 2a | `feat/findit-answers-a-search` | v0.269.0 | the findit box and its address; the query-aware URL; the search over publishers' live homepages; `<meta name="description">` and site-name titles on publisher homepages; the escaped results page; `lynx` showing a form field |
| 2b | `feat/lynx-submits-a-form` | v0.270.0 | a `lynx` form field you select, type into and submit, as real lynx does |

Each PR bumps `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

---

## Goal

From any network, `curl "http://findit.io/?q=university"` returns an HTML page that ranks Ridgemont
University first, linking `http://ridgemont.edu/`. `lynx findit.io` shows the search form, and after
2b a player types a term into it and follows a result. findit.io is itself a real box: `nmap` shows
`22` and `80`, and its root password does not crack.

## Grounding (verified 2026-09-26, v0.268.0)

- **World DNS and addresses.** `generation/publisher.ts` owns the world's whole DNS:
  - `siteAddress(domain)` answers a domain;
  - `publisherAt(ip)` answers an address (the fallback behind the three `api/` IP → network lookups:
    `api/network.ts:110`, `:298`, `api/sessions.ts:199`);
  - `publisherIp(essid)` derives `193.x.y.z` from `createPrng('publisher-ip-<essid>')`.

  `resolveName` asks `siteAddress` first (`network/resolveName.ts:106`). Every one of these is keyed by a
  catalog ESSID.
- **The public fetch.** `handleResolveHttpFetch` (`network/resolveHttpFetch.ts`) calls
  `resolveWebTarget`, which looks up the network, materializes the AP gateway, boot-gates it, runs
  `machineServing`, and then:
  - takes the gateway arm (a port the gateway itself listens on), or
  - takes the forward arm: occupant, else the generated box via `generatedLanBox`.

  An http-serving check follows. Then comes the page read, `resolveWebPath(payload.path)`, and
  `logFetch` writes `payload.path` raw into the target's `/var/log/access.log`. **No dynamic handler
  exists**; every response is a file read.
- **The query string breaks today, at both ends.**
  - Client: `URL_PATTERN` (`network/http.ts`) is `/^http:\/\/([^\s/:]+)(?::(\d+))?(\/\S*)?$/`. The host
    class does not exclude `?`, so `http://findit.io?q=x` parses the host as `findit.io?q=x`.
    `http://findit.io/?q=x` parses with path `/?q=x`.
  - Server: `resolveWebPath('/?q=x')` normalizes to `/var/www/html/?q=x`, which is not a directory
    request, so it reads a file named `?q=x` and 404s.
- **The gateway as its own server.** `materializeApGatewayFs(network, patches)` builds
  `buildApGatewayBaseFs(essid)` (`generation/routerFs.ts:387`). The gateway arms of `resolveWebTarget`,
  `resolvePublicTarget` (`:128`, hard-codes `kind: 'router'` and `seedApGatewayHostname`) and
  `resolvePublicScan` all read that one tree. **A box that owns its public address therefore needs no
  new resolver:** it is a network whose AP-gateway tree is the box itself.
- **Publisher homepages.** `buildWebSite` (`generation/webSite.ts:425`) runs on every webserver. It titles
  `index.html` with `headed(persona.place)` ("The campus"), and `htmlDocument` (`:220`) emits
  `<head><title>…</title></head>` with no meta description. The site server is
  `siteServer(essid)` (`generation/siteServer.ts`). Its http port comes from `siteForward(essid)`
  (`generation/remoteHostFs.ts:205`).
- **lynx.** `ui/renderPage.ts` renders headings, paragraphs, divs, lists, anchors, `br`, tables and
  `pre`. An `<input>` has no text, so **a form renders as nothing today**. Links are the only selectable
  items (`ui/screens/Lynx.tsx`, `followLink` in `ui/state.ts:1462`). `followLink` uses `parseHttpUrl`.
- **Legacy reference.** `src/themedNetworks/handlers/searchEngine.ts` (the frozen root app):
  - weights keyword 3 / title 2 / description 1, substring match per whitespace term;
  - ten results, `escapeHtml` on every interpolation;
  - a `wrapHtml` form with `value` re-filled;
  - `No matches for "<term>".`
- **Batched reads.** No `api/` dependency reads several machines' patches at once today;
  `findPatches` takes one `machine_id`.
- **Tests and wire-checks.**
  - Unit tests are colocated.
  - `test/factories/commandEnv.ts` is the command-environment factory.
  - Wire-checks `scripts/testPublisherWeb.ts` and `testHttpFetch.ts` are the models for a new
    `scripts/testFindit.ts`.

## Scope boundary

**In:** the findit box, its domain and address; queries in URLs; the search over the 32 publishers'
live homepages; meta descriptions and site-name titles on publisher homepages; the results page; `lynx`
showing and (2b) submitting a form.

**Not built here, deliberately:**
- player pages in the index, `robots.txt` `Disallow: /`, and IP-only results (slice 3);
- a restore script, and reading findit's log as intel (slice 4);
- pagination and a crawl beyond `/index.html` (decisions 96 and 99);
- new categories (slices 5–6);
- `POST` forms and any form field other than a text input and its submit.

**Already true after 2a, for slice 4 to rely on:** a search is a fetch, so findit's `access.log` records
the raw path, `/?q=<term>`, under the searcher's server-held address. Slice 4 then only has to prove
it is readable once findit is rooted.

## Decided at planning (2026-09-26)

**Owner decisions:**

1. **The index is live, read in one batch.** Every search reads each publisher's homepage as it is
   served now, patches included, so a rooted webserver whose `index.html` was rewritten changes its
   own listing at the next search. The ~64 machines involved (32 gateways and 32 site servers) are
   read in ONE batched patch query. A publisher whose gateway no longer forwards `:80` to its generated
   site server (repointed from inside) falls back to the full single-target resolution for that one
   publisher, so it lists whatever that forward now reaches. A publisher that is dark (bricked gateway
   or box, nginx stopped, filtered) is simply absent from the results.
2. **The lynx form ships in two PRs.** 2a renders the field and button visibly; searching in lynx is
   by URL (`lynx "findit.io/?q=university"`) and following result links. 2b makes the field
   interactive.

**Derived from existing conventions (not re-litigated):**

3. **findit is its own one-machine network.** It has a network key (`findit.io`) that is not a wifi
   ESSID and is never broadcast. Its "AP gateway" tree IS the findit box, so every existing public
   path reaches it through the gateway arm with no new resolver:
   - fetch;
   - scan;
   - ssh / hydra login;
   - exploit;
   - its log under `ap:findit.io`.

   The gateway builder and the public-target gateway arm branch on the findit key for the box's
   tree, hostname (`findit`) and kind (an ordinary server, fronting no segment).
4. **The box (decision 102).**
   - It runs `sshd` + `nginx` and nothing else: no snmp, no admin UI.
   - Its root password is drawn from the UNCRACKABLE pool.
   - Its `dpkg/status` rides the existing CVE timeline, like any generated box.
   - Its `/var/www/html/index.html` is the search form page (decision 100), so a rooted findit can be
     defaced.
5. **Its domain and address.**
   - `findit.io` joins the world DNS: `siteAddress('findit.io')` and `publisherAt` both answer it.
   - Its address is `193.x.y.z` derived the same way from its key.
   - A catalog-wide test proves it distinct from the 32 publishers.
6. **A URL may carry a query, as on the real web.**
   - The URL host stops at `?`, so `http://findit.io?q=x` means path `/?q=x`.
   - A bare `findit.io?q=x` works through `parseTypedUrl`.
   - Every file read ignores the query: `curl ridgemont.edu/?x=1` serves the homepage.
   - The raw path, query included, is what the access log records.
7. **One dynamic handler, one rule** (decision 95). A request to findit's own box for path `/` with a
   non-empty `q` is answered by the pure search. Everything else, on findit or anywhere, reads a file.
   The handler runs only after `resolveWebTarget` succeeds, so a bricked or stopped findit takes search
   down with it (decision 100).
8. **Scoring** (decision 96). The query is decoded, then split on whitespace, lower-cased, and each term
   matched by substring. Each term scores title 3, description 2, visible body text 1, and scores add
   across terms. Only positive scores are listed, at most ten, highest first. Ties go by domain,
   alphabetically, so a result order never flickers.
9. **Reading a homepage without a DOM** (`core/` is framework-free).
   - The title is `<title>`'s text; a page without one is titled by its domain.
   - The description is `<meta name="description" content="…">`.
   - Body text is the page with comments, scripts and tags stripped and the common entities decoded.
   - A missing description falls back to the body's first non-empty line.
10. **The results page** (decision 99), all interpolations escaped:
    - It has legacy's shape: `<title>`, `<h1>findit.io</h1>`, a `GET` form to `/` with `name="q"` and
      the query re-filled in `value`, `<hr>`, then an `<ol>` of results.
    - Each result is a linked title `http://<domain>/`, the domain on its own line, then the
      description.
    - No result gives `No matches for "<term>".`
11. **Publisher homepages name themselves.**
    - The site server of a publisher titles its site with the catalog `site.name` ("Ridgemont
      University") in `<title>` and `<h1>`. Every other webserver is unchanged.
    - Every publisher homepage gains a `<meta name="description">` built from its site name and a
      per-category phrase (university, library, park, transit, airport, station, corporate, café).
    - Publisher sites never emit `robots.txt` `Disallow: /` (decision 97; already true, now pinned by a
      test).

---

## Slices

Both are **behavior change**. Required implementation skills for each: `tdd`, `testing`, `functional`,
`refactoring` (after each green), `typescript-strict`; `v2-e2e` for the closing browser run;
`mutation-testing` at the PR-readiness gate. Reduction program: `N/A`. Transition/terminal evidence:
`N/A`.

### Slice 2a: findit.io answers a search

**Value:** a player on any network types `curl "findit.io/?q=university"` and gets a ranked page of
websites they were never told about. `lynx` shows findit's form and its results, and follows them.

**Path:**
1. `curl`/`lynx` → `parseTypedUrl` (query-aware) → `addressForTarget` (`findit.io` in the world DNS) →
   `fetchPublic` → `api/network.ts` `resolveHttpFetch`.
2. IP → network (findit fallback) → the findit tree through the gateway arm → http-serving check.
3. On `/?q=`, the search: one batched read of the publishers' gateways and site servers →
   materialize → homepages → the pure score/rank → the escaped page. Otherwise, a file read.
4. The hit goes into findit's `access.log` under `ap:findit.io`.

**Class:** behavior change. **Delivery:** independent PR against trunk.

**Acceptance criteria:**
- [ ] `nslookup findit.io` answers a `193.` address that is not any publisher's. `curl http://findit.io/`
      returns findit's form page from any network, and the hit lands in findit's `access.log`.
- [ ] `curl "http://findit.io/?q=university"` returns an `<ol>` whose first result links
      `http://ridgemont.edu/`, titled "Ridgemont University", with its description.
- [ ] A term found only in a publisher's homepage body finds that publisher (e.g. a word from the
      university's front page). A term that matches nothing returns `No matches for "<term>".`
- [ ] A term and a title containing `<`, `"` or `&` come back escaped: no page text can inject markup
      into the results.
- [ ] At most ten results are listed, highest score first, ties by domain.
- [ ] Rewriting ridgemont.edu's served `index.html` title (through its journal) changes its listing at
      the next search. Bricking its webserver drops it from the results.
- [ ] `curl http://findit.io?q=university` (no slash) and `curl "findit.io/?q=university"` (no scheme)
      both work. `curl "ridgemont.edu/?x=1"` serves ridgemont's homepage.
- [ ] `nmap findit.io` shows `22/tcp open ssh` and `80/tcp open http` and nothing else. A root login
      with any wordlist password fails.
- [ ] Bricking findit, or stopping its nginx, makes every `findit.io` request unreachable, search
      included. Its `index.html` rewritten through its journal serves the rewritten page at `/`.
- [ ] `lynx findit.io` shows the form as a visible text field and a `[Search]` button.
      `lynx "findit.io/?q=university"` lists the results, and following the first one opens
      ridgemont.edu.
- [ ] Publisher homepages are titled with the site name and carry a meta description. A
      non-publisher webserver's pages are byte-for-byte unchanged.

**RED (in order, one increment each):**
1. `http.ts`: `parseHttpUrl('http://findit.io?q=x')` gives host `findit.io`, path `/?q=x`.
   `resolveWebPath('/?q=x')` names the index. `resolveWebPath('/about.html?x=1')` names `about.html`.
   A query with an encoded `/..` cannot climb out.
2. Publisher homepage: the site server's `index.html` for `CAMPUS-GUEST-OPEN` has
   `<title>Ridgemont University</title>` and a meta description naming it. A non-publisher webserver's
   site is unchanged (snapshot before the change). No publisher `robots.txt` disallows `/`.
3. `publisher.ts`: `siteAddress('findit.io')` is a `193.` address distinct from all 32 publishers, and
   `publisherAt` of it answers the findit key. `resolveName('findit.io')` resolves from any network.
4. The findit box tree: `materializeApGatewayFs` for the findit key serves http on `80` and ssh on
   `22`, nothing else. Its root hash matches no wordlist password. Its `dpkg/status` lists `nginx` and
   `openssh-server` at timeline versions. Its `/var/www/html/index.html` holds the form.
5. The pure page reader: title, meta description, and visible body text from sample HTML, including:
   - a page with no title;
   - one with no description (falls back to the first body line);
   - comments and scripts excluded;
   - entities decoded.
6. The pure search: ranking by title 3 / description 2 / body 1 with substring terms, the ten cap,
   ties by domain, empty on no positive score. Built through factories for index entries.
7. The results page: form re-filled with the escaped query, escaped titles/domains/descriptions, links
   `http://<domain>/`, and the no-match line.
8. `handleResolveHttpFetch`: `/?q=university` against findit returns the ranked page from publishers'
   live homepages. A publisher whose webserver journal rewrites its title is listed by the new title; a
   bricked one is absent. Other findit paths read files. The same `?q=` against ridgemont.edu reads its
   homepage file. A bricked findit is `host_unreachable`. The hit is logged on findit with the raw
   path.
9. The repointed-forward fallback: a publisher gateway forwarding `:80` to an occupant is listed
   through the full single-target resolution.
10. Public scan and public login against findit's address: ports `22`/`80`; login with a wordlist
    password refused.
11. `renderPage`: a text `<input>` renders as a visible field showing its value or placeholder, and a
    submit `<button>` as `[<label>]`.

**GREEN:**
- **URL and path:** `?` excluded from the URL host, with an optional query in `URL_PATTERN`; the query
  stripped in `resolveWebPath`.
- **Publisher homepages:** the site-name title and meta description for publisher site servers in
  `webSite.ts` (a per-category phrase pool).
- **The findit box:** `generation/findit.ts` holding:
  - the domain and network key;
  - the derived address;
  - the box tree, composed from the existing router/host builders and pools rather than a new
    generator family.
- **Wiring:** `publisher.ts`'s DNS maps extended to it; the gateway builder and the public-target
  gateway arm branching on the key.
- **The index:** `core/findit/` modules for:
  - the page reader;
  - the scorer/ranker;
  - the results page;
  - the live index (publishers' homepages via one batched patch read, the repointed fallback through
    `resolveWebTarget`).
- **The handler:** the branch in `handleResolveHttpFetch`.
- **`api/`:** a new `findPatchesForMachines` dependency (`.in('machine_id', ids)`) inside
  `api/network.ts`'s existing deps (no new `api/` file).
- **lynx:** `renderPage` handling `input`/`button`.

**REFACTOR:** the batched publisher read and `resolveWebTarget` must not drift apart. If the
in-memory reachability checks (gateway boots, forward serves http, box boots and serves) duplicate
`resolveWebTarget`'s, extract the pure half that takes preloaded patches and have both call it.

**Wire-check:** a new `scripts/testFindit.ts` against `vercel dev` + local supabase:
- `/` serves the form;
- `/?q=university` ranks ridgemont.edu first;
- a seeded title patch on ridgemont's webserver changes its listing, and a seeded brick drops it;
- a seeded brick on findit makes search unreachable;
- the hit lands in findit's `access.log` under `ap:findit.io` with the raw `/?q=` path.

`testPublisherWeb.ts` and `testHttpFetch.ts` must stay green.

**Browser:** `v2-e2e`, from the player's own network:
- `curl "findit.io/?q=university"`;
- `lynx findit.io` (form visible);
- `lynx "findit.io/?q=university"`, following result 1 to ridgemont.edu;
- `nmap findit.io`.

**PRE-PR MUTATION:** Stryker per changed core file (json reporter, capped concurrency, no dev server
running). The scorer's weights and the ten cap, the escaper, and the query/path parsing are the
highest-value survivors to kill.

**Done when:** all criteria checked; typecheck, lint and tests green; the wire-check passes live; the
browser run is recorded; mutation reviewed.

**As built (2026-09-26):**
- **Decided mid-slice — a gateway that serves the web itself is listed.** Planning only named the
  repointed-forward case. Mutation testing asked what happens when a rooted gateway stops forwarding
  and serves `:80` from its own disk instead, and the honest answer is that it IS what answers, so it
  is fetched the ordinary way and listed. Only a network where NOTHING serves the web is absent.
- **findit is a network whose gateway is the box.** `buildApGatewayBaseFs` branches on the findit key
  and returns `buildFinditFs()`, so fetch, scan, login and logging all reach it through code that
  already existed — no new resolver. `resolvePublicTarget`'s gateway arm names it `findit` and gives
  it no fronted segment, because it is not an access point and there is nothing behind it to forward
  into.
- **A URL may carry a query.** `URL_PATTERN` ends the host at `?` and accepts a query with no path,
  so `findit.io?q=x` means `/?q=x`; `resolveWebPath` cuts the query off before resolving a file, so
  every other site ignores it. The raw path, query and all, is still what the access log records —
  which is slice 4's prize, already in place.
- **The index is a view, read in one batch.** `indexedWeb` reads the 32 publishers' gateways and web
  servers through one new `findPatchesForMachines` dependency (`.in('machine_id', ...)`, module scope
  inside `api/network.ts`; no new `api/` file), then resolves every site in memory. `servesWebOn`
  was extracted so the crawl and the fetch share one definition of "serving the web".
- New modules: `core/findit/{readPage,search,page,publisherIndex}.ts`, `core/generation/findit.ts`,
  `core/network/webServing.ts`.
- **Publisher homepages name themselves**, titled with the catalog `site.name` and carrying a
  `<meta name="description">` from a per-category phrase. Every other web server is unchanged, which
  a snapshot over all of them pins.
- **Gates:** 6237 unit tests green, typecheck and lint clean. Mutation, scoped, in two batches:
  `search.ts` 37/39, `page.ts` 43/44, `readPage.ts` 146/166, `http.ts` 114/115, `webServing.ts`
  10/10, `publisherIndex.ts` 59/72. Three real gaps were found and closed — the whole-document byte
  assertions for both served pages, an unterminated comment that a later `>` had been hiding by
  accident, and a journal whose EARLIER row decides. Six survivors were hand-verified as killed
  (module-load statics: the `PUBLISHERS` list, `FINDIT_FRONT_PAGE`, and four module-level regexes).
  The rest are equivalent or defensive: `resolveWebPath('/')` vs `''` (both name the root's index),
  two unreachable null guards, the `'none'` guard that saves a fetch that would fail anyway, and
  `split(/\s+/)` vs `/\s/`, which the empty-term filter makes identical.
- **Wire-check:** new `scripts/testFindit.ts`, 9/9 live. A search for "services" returns ten sites; a
  rewritten homepage is listed by its new title and no longer found by its old words; a bricked
  webserver drops out; a query on an ordinary site still serves its page; and the search lands in
  findit's own `access.log` with `/?q=services` under the searcher's server-held address.
- **Browser (v0.269.0, from `MIDNIGHT-DINER`):** `curl findit.io/?q=university` ranked Ridgemont
  first; `lynx findit.io/?q=coffee` rendered the form as `[coffee] [ Search ]` above six numbered
  cafés, and following result 1 opened `http://beanthere.com/`; `nmap -sV findit.io` showed
  `80 nginx/1.26.0` and `22 OpenSSH 9.7.0`, each with a live CVE on the world's own timeline.
- **Fixed in passing:** five source files carried a cp1252 `0x97` byte where an em-dash belonged, from
  slice-1c-era edits. Recorded as a gotcha.

### Slice 2b: lynx submits a form

**Value:** a player in `lynx findit.io` selects the search field, types a term, presses Enter and reads
the results, the way real lynx browses a search engine.

**Path:** `Lynx.tsx` selection (links and now text fields) → typing edits the field → Enter on the field
or `[Search]` builds `<action>?<name>=<encoded value>` against the page URL → the existing `followLink`
fetch → results page; Back returns to the form.

**Class:** behavior change. **Delivery:** independent PR against trunk, after 2a merges.

**Acceptance criteria:**
- [ ] Arrow keys move between links AND text fields in document order. A selected text field shows it
      is being edited.
- [ ] Typing while a field is selected edits its value; Backspace deletes. `q`/Escape do not quit while
      a field is being edited (Escape leaves the field instead).
- [ ] Enter in the field, or on `[Search]`, submits a `GET` to the form's `action` (resolved against
      the page URL) with the field's value URL-encoded. The results page opens, and Back returns to the
      form page.
- [ ] A form with no `action` submits to the page's own path. Only `GET` forms submit; a `POST` form
      renders but does not submit.
- [ ] Search term text never becomes markup anywhere along the way (escaped on findit, encoded in the
      URL).

**RED:** jsdom + `@solidjs/testing-library` tests on `Lynx.tsx` in the order above. `renderPage` segments
for fields carry their name, value and form (action/method). URL building is a pure helper test, and
`resolveHref` covers action resolution.
**GREEN:** a `field` segment kind in `renderPage`; field selection, editing and submission in
`Lynx.tsx`; submission through the existing `followLink`.
**REFACTOR:** assess whether links and fields share one selectable-item list.
**Wire-check:** `N/A`: client-only, no `api/` change. Alternate evidence: the component tests plus the
browser run.
**Browser:** `v2-e2e`: `lynx findit.io`, select the field, type `university`, Enter, follow result 1.
**PRE-PR MUTATION:** Stryker on `renderPage.ts` and the form-URL helper; `Lynx.tsx` keyboard handling
is covered by the component tests.
**Done when:** all criteria checked, gates green, the browser run recorded, mutation reviewed.

## Pre-PR Quality Gate (each PR)

1. Implementation complete, refactoring assessed.
2. Mutation testing on the PR's changed core files; valuable survivors killed.
3. `npm run typecheck` and `npm run lint` from `v2/` pass; `npm test` green.
4. Wire-check live where the PR touches `api/` (2a).
5. Version bumped in `package.json` + `package-lock.json`.

## Risks

- **Search cost.** One batched read of ~64 journals plus 32 homepage materializations per search.
  Measure it in the wire-check against a single fetch. If it is too slow, the fallback is a pure index
  over generated homepages that consults journals only for publishers with patches on their site
  server or gateway.
- **The findit key in ESSID-shaped code.** Anything that assumes a network key is a catalog ESSID
  (`networkPersona`, `generateHomeLan`, `frontedSegment`, `seedApGatewayHostname`) must never be asked
  about findit, or must answer it sanely. The public-target, scan and fetch tests against findit are
  the guard.
- **Homepage re-titling moves content.** Changing the publisher site server's title and adding a meta
  line changes those 32 pages and their byte counts; allowed pre-launch. The non-publisher snapshot
  guards everyone else.
- **Stripping tags with a pattern, not a parser.** Player HTML arrives in slice 3. The reader must be
  total (never throw) on malformed markup, and it only ever feeds text into an escaped output.
