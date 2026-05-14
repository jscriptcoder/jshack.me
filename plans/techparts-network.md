# Plan: techparts.io themed network

**Branch**: `feat/techparts-network`
**Status**: Active

## Goal

Ship `techparts.io` as the second themed world network — a single-machine, read-only "sketchy gray-market electronics reseller" site discoverable via findit.io. Content lives in a hand-authored TS manifest; ports 80/443 are open with service versions that map to existing CVE templates so the site becomes exploitable (and shared-world-tamperable) as in-game time passes.

## Acceptance Criteria

Observable behaviours, exercised end-to-end once both PRs land:

- [ ] A player who runs `curl http://techparts.io/` from any in-game shell receives the HTML landing page advertising TechParts Global.
- [ ] A player who runs `curl http://techparts.io/<linked-path>` for any of the publicly-linked pages (catalog, ~5–6 product pages, about, shipping, contact, faq) receives the corresponding page content.
- [ ] A player who runs `gobuster http://techparts.io/` discovers the hidden paths (`/robots.txt`, `/admin`, `/backup/`, `/staff-notes.txt`, `/.env.bak`, `/changelog.txt`, `/uploads/`) and can `curl` each one to read its content.
- [ ] A player who runs `nmap techparts.io` sees ports 80 and 443 open with the chosen service banners.
- [ ] A player who runs `curl http://findit.io?q=parts` (or another keyword from the search metadata) receives techparts.io in the top results.
- [ ] Once the http CVE activates against the chosen version, `msfconsole techparts.io 80` can mutate `/var/www/html/index.html` and other players visiting techparts.io see the defaced content (existing cross-player effect machinery).
- [ ] No regressions: findit.io still indexes correctly, the playground row still loads, all existing themed-network behaviour is unchanged.

## Design decisions (locked)

- **Brand**: `TechParts Global` at domain `techparts.io`.
- **IP**: `198.51.100.80` (TEST-NET-2 docs range, different /24 from findit @ `192.0.2.80` and playground @ `203.0.113.42`; the `.80` octet nods at port 80).
- **Theme name**: `'techparts'` (lowercase, single word, slot-fits existing free-form theme column).
- **Service versions**: port 80 = `Apache/2.4.49` (`shell_limited`/user); port 443 = `nginx/1.20.1` (no natural CVE, mirrors findit decoratively). The port-80 CVE is what activates "site becomes exploitable" over game time.
- **No handler**: read-only static content falls through to the existing `/var/www/html/<path>` curl pipeline. `THEME_HANDLERS` gets no entry.
- **Generator only**: dispatched via `selectGenerator('techparts')`.
- **Content authoring**: hand-authored TS manifest under `src/themedNetworks/content/techparts/`. Pages are flat data: `{ path, title, body, kind, visibility }` where `kind: 'html' | 'text'` discriminates renderable HTML pages from plain-text artefacts (robots.txt, .env.bak, *.txt). Generator lays each entry into `/var/www/html<path>` exactly as the URL string requests it (so `/about.html` lives at `/var/www/html/about.html`, `/` lives at `/var/www/html/index.html`).
- **HTML must be browser-renderable.** An upcoming terminal-browser command will render `kind: 'html'` pages by handing the raw markup to the host browser's parser. So every HTML page must be well-formed (all tags closed, valid nesting, semantic structure — `<h1>`, `<p>`, `<ul>`, `<table>`, `<a>`, `<form>`). No CSS, no JS, no `<style>`/`<script>` tags, no `class`/`id` reliance for layout. Plain-text entries are exempt — they're served verbatim and rendered as preformatted text by the browser.
- **Narrative**: flavor-only. No story arc across hidden files — each easter egg is independent gray-market texture.
- **search_metadata**: title "TechParts Global — Worldwide Electronic Components", description "OEM, refurbished, and bulk electronics. Factory-direct pricing, worldwide shipping.", keywords `["electronics", "components", "cpu", "memory", "wholesale", "oem", "parts"]`.

## PR split

Two independently-reviewable PRs:

**PR A — content + generator (no live effect):** ships the manifest, generator, and tests. No migration, no registry entry → no rows reference `theme='techparts'`, so nothing visible changes in-game. Reviewable on its own: pure TS infrastructure + content.

**PR B — wire-up + migration:** registry entry + SQL migration (public_ips + world_networks row with search_metadata) + README updates. Site goes live, findit.io indexes it on next page load. Post-merge: re-run `scripts/backfillWorldNetworkBaseFs.ts` to populate `machine_filesystems` rows for the new public_ip.

---

## PR A — content + generator

### Step A1: Manifest type + invariant tests + landing page

**RED**: Add `src/themedNetworks/content/techparts/pages.test.ts` with the following failing tests:

- "every page's `path` starts with `/`"
- "page paths are unique across the manifest"
- "every internal `<a href='/...'>` in HTML page bodies points to a `path` that exists in the manifest" (link-integrity invariant — catches broken nav; walks `kind: 'html'` pages only)
- "every `kind: 'html'` page parses as well-formed HTML with no parse errors" (parse via the project's chosen parser — see below)
- "no `kind: 'html'` page contains `<script>`, `<style>`, `class=`, or `id=` attributes" (terminal-browser constraint: no CSS, no JS, no layout-class reliance)
- "the manifest exports a `/` landing page with `kind: 'html'`"
- "the manifest exports a `linked` and a `hidden` projection so the generator can ask which paths are gobuster-only vs nav-discoverable"

For HTML parsing: prefer `DOMParser` if jsdom/happy-dom is available in the test env (check `vitest.config.ts`); otherwise add `parse5` as a dev dep and use its strict parser. Decide during step execution.

**GREEN**: Add `src/themedNetworks/content/techparts/pages.ts`. Define:

```ts
type TechpartsPage = {
  readonly path: string;
  readonly title: string;
  readonly body: string;
  readonly kind: 'html' | 'text';
  readonly visibility: 'linked' | 'hidden';
};
```

Export `TECHPARTS_PAGES: readonly TechpartsPage[]` with one entry: the `/` landing page (basic hero + nav placeholder + sketchy trust badges copy, semantic HTML only, well-formed, no `<script>`/`<style>`/`class`/`id`). Export derived projections `LINKED_PAGES` and `HIDDEN_PAGES`.

**MUTATE**: Run `mutation-testing` skill on `pages.ts` + invariant tests. Manifest data is mostly literals — mutants will target the projection filters, the link-integrity walker, and the HTML-validity / forbidden-tag walkers.

**KILL MUTANTS**: Address any surviving mutants on the projection logic and href walker. Ask human if mutant value is ambiguous on literal HTML.

**REFACTOR**: Assess; likely none — manifest is data.

**Done when**: invariants pass with a single homepage entry; LINKED/HIDDEN projections both return correct subsets.

### Step A2: Full public page set

**RED**: Extend `pages.test.ts` with assertions that the manifest contains entries with path `/catalog.html`, `/about.html`, `/shipping.html`, `/contact.html`, `/faq.html`, each `linked`, each with non-empty title and html. Also assert the landing page's HTML links to all five via `<a href>` (so gobuster isn't needed to find them and link-integrity now exercises a real graph).

**GREEN**: Add the five pages to `TECHPARTS_PAGES`. Update landing-page HTML to nav-link them. Author copy hand-in-hand with the user (gray-market tone — "Genuine\* electronic components", buried disclaimers, sketchy certifications, crypto-preferred payments on `/shipping.html`, only an email on `/contact.html`).

**MUTATE**: Re-run.

**KILL MUTANTS**: As above.

**REFACTOR**: If shared copy patterns emerge (header, footer), extract a `wrapInLayout(title, body)` helper inside `pages.ts`. Only if it adds clarity — premature otherwise.

**Done when**: all six linked pages present, nav links resolve, invariants still pass.

### Step A3: Product pages

**RED**: Assert manifest contains 5–6 entries under `/products/...` (decided with user during step), each `linked`, each with distinct title. Also assert `/catalog.html` HTML links to all of them.

**GREEN**: Add product pages. Categories from the design brief: OEM CPUs (desoldered), engineering samples (gray-market chips), refurbished memory + SSDs, salvage lots, decommissioned networking gear, test equipment. Each product page: sketchy spec table, suspect pricing, "limited stock" pressure, vague return policy. Update `/catalog.html` to link them.

**MUTATE**: Re-run.

**KILL MUTANTS**: As above.

**REFACTOR**: Extract a `productPage({ sku, title, price, ... })` helper inside `pages.ts` if products are templated similarly enough that hand-writing each one is redundant. **NB**: hand-authored content is the chosen path — only extract the wrapper, never the copy.

**Done when**: 5–6 product pages present, catalog links to them, all invariants pass.

### Step A4: Hidden (gobuster-only) pages

**RED**: Assert manifest contains `/robots.txt`, `/admin`, `/backup/`, `/staff-notes.txt`, `/.env.bak`, `/changelog.txt`, `/uploads/`, each `hidden`, none of them referenced by an `<a href>` in any `linked` page (otherwise they wouldn't be gobuster-only). Assert each entry has the right `kind`: `/admin`, `/backup/`, `/uploads/` are `kind: 'html'`; `/robots.txt`, `/staff-notes.txt`, `/.env.bak`, `/changelog.txt` are `kind: 'text'`. Assert `/robots.txt` body contains `Disallow:` directives that name some of the other hidden paths (so a recon-curious player gets a hint). The HTML-validity + forbidden-tag invariants from Step A1 automatically apply to the new `kind: 'html'` entries.

**GREEN**: Add the seven hidden entries.

- HTML pages (well-formed, semantic, no script/style/class/id):
  - `/admin` — static login `<form>` (decorative until the http CVE activates); semantic `<label>`/`<input>`/`<button>` only.
  - `/backup/` — fake Apache directory listing rendered as `<table>` with rows for `db_2024.sql.bak`, `orders.csv`, etc. (no `<pre>` tricks needed; a real `<table>` is more terminal-browser-friendly).
  - `/uploads/` — same shape as `/backup/`, different filenames.
- Plain text (`kind: 'text'`):
  - `/robots.txt` — real robots.txt syntax (`User-agent: *`, `Disallow: /admin`, ...).
  - `/staff-notes.txt` — plain-text dev note ("don't forget to rotate the admin creds... someday").
  - `/.env.bak` — fake-leaked env vars (`DB_PASSWORD=...`, `API_KEY=...`); realistic decoy.
  - `/changelog.txt` — irreverent commit-log lines.

**MUTATE**: Re-run.

**KILL MUTANTS**: Hardest to kill — `robots.txt` Disallow contents are a fingerprint; mutants flipping which paths are mentioned should fail a test.

**REFACTOR**: Assess; likely none.

**Done when**: all seven hidden pages present, robots.txt names a subset of them, link-integrity invariant still holds (i.e., nothing links to hidden paths from linked pages).

### Step A5: Generator network-shape

**RED**: Add `src/themedNetworks/generators/techpartsNetwork.test.ts`. Following the `searchEngineNetwork.test.ts` shape exactly, add a `buildRow` factory and `buildCtx` helper. RED tests:

- "produces a single-machine network where the router IS the only machine"
- "uses public_domain as the router hostname" (asserts `routerMachine.hostname === 'techparts.io'`)
- "uses the allocator-provided IP for the router"
- "uses the row seed"
- "exposes the machine via networkConfig.machineConfigs keyed by public IP"

**GREEN**: Add `src/themedNetworks/generators/techpartsNetwork.ts`. Implement `generateTechpartsNetwork: ThemedGenerator` modelled on `generateSearchEngineNetwork`: single-machine `MissionNetwork` with `routerMachine` = the only machine, no inner layers, no NAT, `objective` filled with the same `'unused — world network'` placeholders.

**MUTATE**: Run on the generator. Expect mutants on the network-shape constants (machines=[], layers=[layer], domainEntry=false).

**KILL MUTANTS**: As above.

**REFACTOR**: Assess overlap with `searchEngineNetwork.ts`. If 80%+ of the boilerplate is shared, extract a `buildWorldNetworkRouter({ publicIp, domain, ports, users, fileSystem, seed })` helper into a shared module (e.g., `src/themedNetworks/generators/buildWorldNetworkRouter.ts`). Do not refactor until both generators are green — only after duplication is real.

**Done when**: all five shape tests pass.

### Step A6: Generator ports + CVE-eligible versions

**RED**: Add port-shape tests:

- "opens port 80 (http) with version Apache/2.4.49"
- "opens port 443 (https)"
- "both ports report `open: true`"

**GREEN**: Add the `ports` array to the generated `RemoteMachine`. Port 80 = `{ port: 80, service: 'http', serviceVersion: 'Apache/2.4.49', open: true }`. Port 443 = `{ port: 443, service: 'https', serviceVersion: 'nginx/1.20.1', open: true }`. Confirm via `grep` against `src/generation/pools/vulnerabilities.ts` that `Apache/2.4.49` maps to the existing `2024-9001` template — that's the activation trigger.

**MUTATE**: Run.

**KILL MUTANTS**: Version-string mutants (e.g., `2.4.49` → `2.4.48`) must fail tests, otherwise the CVE wiring isn't load-bearing in the test suite.

**REFACTOR**: None.

**Done when**: ports tests pass; port-80 version matches a real CVE template by string equality.

### Step A7: Generator filesystem layout

**RED**: Add filesystem-walk tests using the `readFileFromTree` helper:

- "lays every linked manifest page into `/var/www/html<path>` with correct content" (parameterised over `LINKED_PAGES`; for `path === '/'`, file lives at `/var/www/html/index.html`; for other paths, file lives at `/var/www/html${path}` verbatim — matching `curl.ts:137`)
- "lays every hidden manifest page into `/var/www/html<path>` with correct content" (same shape for `HIDDEN_PAGES`)
- "file content equals the manifest's `body` verbatim, regardless of `kind`" — generator does NOT transform or wrap content; what the manifest declares is what curl returns
- "creates the directory hierarchy for nested paths (e.g., `/products/<sku>.html`)" — i.e., walking `/var/www/html/products/` returns a directory containing the product files
- "page files are world-readable" — checked by walking the FileNode and asserting `worldReadable === true` (or whatever the FileNode shape exposes) so unauthenticated curl-as-root can fetch them
- "ships the same root + www-data users that findit.io ships" (mirror findit's user list so existing auth flows behave identically)

**GREEN**: Implement the filesystem builder. For each manifest page, compute its target FS path (`/` → `/var/www/html/index.html`; everything else → `/var/www/html${path}`). Build a recursive `mkDir`/`mkFile` tree using the existing helpers from `src/generation/filesystem/helpers`. Pass it to `createFileSystem` via `extraDirectories`. Users mirror findit: root + www-data, both `'no-shell-access'` (read-only intent).

**MUTATE**: Run. Critical mutants: path-construction (`/var/www/html${path}` vs `/var/www/html/${path}`), root-special-case (`path === '/'` vs `path.startsWith('/')`), readability bit.

**KILL MUTANTS**: All path-construction mutants must be killed by the parameterised filesystem-walk test.

**REFACTOR**: If the path-resolution + directory-building logic is non-trivial and could be reused by future themed networks, extract `layManifestIntoWebRoot(pages)` into a helper module. Likely valuable — accept if it falls out cleanly.

**Done when**: every manifest page (linked + hidden) is readable at its URL-shaped FS path; nested directory structure exists; users match findit.

### PR A Pre-PR Quality Gate

1. Mutation testing — run `mutation-testing` skill across all new files.
2. Refactoring assessment — run `refactoring` skill; the most likely candidate is a shared `buildWorldNetworkRouter` helper or `layManifestIntoWebRoot` helper.
3. `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` all pass.
4. Open PR titled "feat(themedNetworks): techparts.io content manifest + generator (no live effect)" with body summarising the no-live-effect framing and pointing at the migration PR to follow.

---

## PR B — registry, migration, docs (site goes live)

### Step B1: Theme registry entry

**RED**: Extend `src/themedNetworks/generators/registry.ts` tests (if any exist — otherwise add `registry.test.ts`):

- "selectGenerator('techparts') returns generateTechpartsNetwork"
- "selectGenerator('search-engine') still returns generateSearchEngineNetwork" (regression guard)
- "selectGenerator('unknown-theme') still returns the default mission-shaped fallback"

**GREEN**: Add `'techparts': generateTechpartsNetwork` to `THEME_GENERATORS`.

**MUTATE**: Run on `registry.ts`.

**KILL MUTANTS**: Theme-key mutants must fail tests.

**REFACTOR**: None.

**Done when**: theme is dispatchable.

### Step B2: SQL migration

**RED**: Add `supabase/migrations/<timestamp>_techparts_network.sql.test.ts` (or extend the existing world_networks migration smoke test if there is one — confirm during step). Test: after running migrations against the local Supabase DB, a `SELECT * FROM world_networks WHERE public_ip = '198.51.100.80'` returns one row with `theme='techparts'`, `public_domain='techparts.io'`, and `search_metadata` matching the locked spec. Also a `SELECT * FROM public_ips WHERE ip = '198.51.100.80'` returns kind=`'world_network'`. (If no integration test layer exists for migrations, fall back to a static SQL-text test that grep-asserts the migration file shape.)

**GREEN**: Add `supabase/migrations/<YYYYMMDDHHMMSS>_techparts_network.sql` mirroring `20260502130000_findit_search_engine.sql`. Two inserts: public_ips row + world_networks row with the locked search_metadata payload.

**MUTATE**: SQL is hard to mutation-test conventionally; skip or document why.

**KILL MUTANTS**: N/A.

**REFACTOR**: None.

**Done when**: migration applies cleanly to a fresh local DB and the row is queryable with the expected shape.

### Step B3: README + docs updates

No tests — pure documentation.

- Update `src/themedNetworks/README.md`:
  - Add a row to the "Files" table for `generators/techpartsNetwork.ts`.
  - Add a paragraph noting techparts.io as the second themed network (no handler — falls through to the static-file pipeline; serves as the reference example for handler-less themed sites).
- Update the top-level `README.md` if it enumerates known themed networks or world IPs.
- Update `docs/infrastructure-design.md` and `docs/mission-variations.md` only if they reference world networks specifically — check first; skip if not relevant.
- Run `npm run format` to normalise.

**Done when**: docs accurate, formatting clean.

### Step B4: Post-merge backfill

Not a code step — runtime action after PR B merges to main:

```bash
npx tsx scripts/backfillWorldNetworkBaseFs.ts --dry-run    # preview
npx tsx scripts/backfillWorldNetworkBaseFs.ts              # apply
```

Populates `machine_filesystems` rows for `198.51.100.80` so cross-player base-FS replication and L2 enforcement both have ground truth.

**Done when**: backfill prints non-zero row count for techparts and `SELECT count(*) FROM machine_filesystems WHERE machine_id = '198.51.100.80'` is non-zero.

### PR B Pre-PR Quality Gate

1. Mutation testing — run on `registry.ts` changes (migration SQL excluded).
2. Refactoring assessment — likely none; mostly additive.
3. `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` all pass.
4. Manual smoke (after backfill in dev): boot the game, `curl http://findit.io?q=parts`, confirm techparts.io is in results; `curl http://techparts.io/`, confirm landing page renders.
5. Open PR titled "feat(themedNetworks): wire techparts.io live (registry + migration + docs)" referencing PR A.

---

## Out of scope

- **Accounts / payments / mailboxes** (the Tier-2 ideas from the design conversation). Deferred to its own design + implementation phase.
- **Procedural / regenerating content.** Considered and rejected in favour of hand-authored stability; accretion model deferred until we have a second hand-authored site to compare against.
- **Mission-instance-aware variations.** techparts.io is one global shared instance, like findit.io.
- **A bespoke handler.** Static-file fall-through covers everything techparts.io needs at boot. A handler can be added later as a separate PR if dynamic behaviour (search box on `/catalog`, fake checkout form posting, etc.) becomes desirable.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
