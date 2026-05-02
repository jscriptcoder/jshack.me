# Plan: findit.io — first themed network + discovery primitive

**Branch**: `findit-search-engine`
**Status**: In progress — Step 1 (DNS merge) complete

## Problem

Themed persistent networks (`world_networks` table) shipped in PR #84, but only the playground row exists. We have no discovery mechanism — players need a way to find themed networks without out-of-band hints. Mission-lore signposting + a static darknet directory don't scale and don't work for content nets that aren't tied to a mission.

We also have no model for "interactive sites" — `curl` is purely static-file serving (`curl.ts:124-151`). Any themed network that wants dynamic behavior (search, lookup, login form) has no shape to fit into.

## Goal

Ship a Google-like search engine at `findit.io` as the canonical discovery surface. Players run:

```
$ curl http://findit.io?q=graphic+card
1. Tech Parts Store — techparts.io
   Quality computer components and peripherals.

2. RGB Glow — rgbglow.shop
   LED strips, cooling fans, gaming accessories.
```

Then resolve via `dig <domain>` → IP → standard attack flow.

In the same chunk: ship the **infrastructure** (DNS, query strings, request handlers) and the **first batch of indexable starter sites** so the discovery loop is end-to-end demonstrable.

## Model

Five pieces stack:

1. **World networks contribute DNS to localhost.** Today `worldRouterViews` only adds router IPs to `currentConfig.machines` (`NetworkContext.tsx:211`); the corresponding dnsRecords are dropped. They need to merge into the localhost-visible `dnsRecords` array alongside.

2. **curl learns query strings.** `parseUrl` (`curl.ts:51`) extracts `query` separately from `path`: `{ protocol, host, port, path, query }`. The path becomes the file lookup key; query is passed to handlers.

3. **curl learns per-machine request handlers.** New optional `getHandler(machineIp): RequestHandler | undefined` on `CurlContext`. A `RequestHandler` is a pure function `(req: { method, path, query }, fs: MachineFsAccess) => HttpResponse | null`. If a handler exists and returns non-null, curl uses that response. Returning `null` falls back to the existing static-file path. This keeps every existing static page working and lets specific machines opt into dynamic behavior.

4. **Theme-keyed handler registry.** Code-side `Record<WorldNetworkTheme, RequestHandler>`. At NetworkContext hydration, world networks with a known theme look up their handler. Handlers live in code (functions can't go in DB); the world_networks row only carries the `theme` string.

5. **Search handler implementation.** Reads `/etc/findit/index.json` from findit.io's filesystem at request time, ranks entries by simple keyword match against title/description/keywords, returns top 10 in plain-text "Google-results" shape. Empty/missing query → returns null so the static `/var/www/html/index.html` landing page serves.

The search index is **generated from `world_networks` rows at seed time** — every row with non-null `search_metadata: {title, description, keywords}` becomes one index entry. New themed networks ship → re-run seed → findit.io updates. Snapshot model (not live-read at query time) keeps the search handler pure and the file mutable per the shared-world-mutation rule.

**Ports 80 + 443 both open**, both serve the exact same pipeline (static files under `/var/www/html` + handler check). No cert handshake simulation — that's consistent with curl's existing model for the playground network.

## Acceptance criteria

**DNS extension**

- World networks' `dnsRecords` (collected from inner machineConfigs + a synthesized record for the public router hostname) merge into localhost's `currentConfig.dnsRecords` when localhost has internet (own-workstation-with-home and own-workstation-with-mission branches in `NetworkContext.tsx:241-323`).
- `dig findit.io` from localhost resolves to findit.io's public IP.
- The `.mission` TLD assumption stays where it lives (mission topology); world networks use real-feel TLDs (`.io`, `.com`, `.shop`, `.cafe`).

**curl extensions**

- `parseUrl` returns `query` separately from `path`. Existing callers ignoring the field keep working.
- `CurlContext` gains optional `getHandler`. Existing tests pass with no handler set.
- Static-file fallback path unchanged when handler returns `null` or no handler exists.
- Handler dispatch covers both GET and POST.

**Search handler**

- Pure function, fully testable in isolation given a mock fs.
- Reads `/etc/findit/index.json`. If file is missing or malformed, returns 500-shaped response.
- Splits `q` on `+` and whitespace, lowercases, simple substring/keyword match against entry title/description/keywords. Top 10 by simple score.
- No-results case returns a "no matches" body.
- No `q` param → returns null (static landing page serves).

**world_networks schema**

- New nullable column `search_metadata jsonb` with shape `{ title, description, keywords }`.
- Migration is additive; existing playground row stays unindexed (search_metadata = null).

**findit.io world network**

- Single-machine network row, hostname `findit.io`, public IP allocated through existing world IP allocator.
- Ports 80 (http) and 443 (https) open, both wired to the same handler+static pipeline.
- Filesystem at seed time includes `/var/www/html/index.html` (landing page) and `/etc/findit/index.json` (index built from all current `search_metadata` entries).
- `theme = 'search-engine'` → registry maps to search handler.
- Indexed: yes, with its own search_metadata so `curl findit.io?q=search` returns findit.io itself.

**Starter sites — same PR**

- 2-3 single-machine world networks with `search_metadata` populated, so the discovery loop has real results.
- Concrete: `techparts.io` (component shop), `devnotes.io` (a dev's blog with mildly interesting drafts), `localmail.cafe` (a café with a public-WiFi landing page).
- Each has a static `/var/www/html/index.html` with at least one curiosity (a hidden comment, a stray credential in HTML source, a TODO referencing another domain) — enough to make the loop feel rewarding, not enough to count as "themed network content" (that comes in the next chunk).

**Tests**

- Unit: `parseUrl` extracts query strings; search handler ranks correctly; missing-q passthrough; missing/malformed index file behavior.
- Unit: NetworkContext merges world dnsRecords into localhost dnsRecords across all internet-connected branches.
- Integration: `curl http://findit.io?q=parts` returns formatted results; `curl https://findit.io?q=parts` returns identical results; `curl findit.io` (no q) returns landing page.

## Out of scope

- **`ThemePack` abstraction.** Hold off until the second multi-machine themed network is being built — premature otherwise. This PR uses ad-hoc per-site generators.
- **AXFR support against world-network DNS servers.** Basic resolution only; the `.mission`-hardcoded path in `dig.ts:153` stays scoped to mission DNS for now.
- **Real HTTPS cert simulation.** Port 443 is "open" and serves the same content as 80; no TLS handshake plumbing.
- **Search analytics, query logs, dashboards.** Not a real product.
- **Multiple competing search engines + fallback indexers.** One for now; "the search engine got bricked" can be solved when it actually happens.
- **Dynamic per-row ranking algorithms.** Simple substring/keyword scoring is enough.
- **Live world_networks read from findit.io's handler.** Index is snapshotted to FS at seed time; if a row gets added later, re-run the seed.
- **Form POST handling, login forms, sessions on findit.io.** Read-only GET-shaped service.

## Phasing

Single PR. Implementation order:

1. **DNS merge in NetworkContext** — world networks contribute dnsRecords to localhost-visible config across all three internet-connected branches. Tests for the merge.
2. **parseUrl query-string extraction** — pure refactor of `curl.ts:51`. Existing tests continue to pass.
3. **RequestHandler types + getHandler dispatch in curl** — abstract types + dispatch logic. No handlers wired yet.
4. **Search handler** — pure function in `src/themedNetworks/handlers/searchEngine.ts` (or wherever fits). Fully unit-tested.
5. **Theme registry** — `themedNetworks/handlerRegistry.ts` mapping theme → handler. NetworkContext consults it when building `getHandler`.
6. **Migration** — `search_metadata jsonb` column on `world_networks`.
7. **findit.io seed** — DB row + machine generator that emits `/var/www/html/index.html` + `/etc/findit/index.json` (index built from world_networks search_metadata). Theme = 'search-engine'.
8. **Starter site seeds** — 2-3 single-machine world networks with content + search_metadata. These can be hand-rolled for now; the ThemePack abstraction comes later.
9. **Docs + memory** — `src/themedNetworks/README.md` for the handler abstraction; update `project_themed_persistent_networks.md` memory; reference findit.io in user-facing docs.

## Risks

1. **Handler null-vs-error semantics.** Returning `null` = "not handled, fall back to static." Returning a 4xx response = "handled, here's an error." Document this clearly so future handler authors don't accidentally swallow paths that should 404. Search handler returns null only when no `q` param is present.
2. **Index regeneration cadence.** New themed networks added later won't appear until findit.io re-seeds. Acceptable for v1; revisit if it becomes friction.
3. **Substring matching is naive.** "graphic card" matching "graphics" via substring works; "GPU" matching "graphic card" doesn't. Add a keywords array per entry to compensate. Real fuzzy matching is post-launch.
4. **Cross-player index defacement.** Per shared-world rule — fine. A player editing `/etc/findit/index.json` to redirect searches is gameplay, not a bug.
5. **Static-file behavior for paths under findit.io.** Anything beyond `/` (e.g., `/about`, `/api/...`) currently serves whatever's in `/var/www/html/...`. The search handler returns null for those, so static fallback applies. Acceptable.

## Locked-in decisions

1. **Index source**: generated from `world_networks.search_metadata` at seed time (snapshotted into `/etc/findit/index.json`).
2. **Ports**: 80 + 443 both open, identical pipeline, no TLS simulation.
3. **Handler registry**: code-side, theme-keyed, handlers are pure functions.
4. **Result format**: plain text, "Google-results" shape (numbered list, title — domain, blurb).
5. **Starter sites in same PR**: yes — at least 2 single-machine sites so the discovery loop is demonstrable.
6. **Theme name**: `'search-engine'`.

## Estimated effort

~2-3 days. Bulk: curl extension + handler dispatch, the search handler + tests, seed migration for findit.io and starters. The DNS merge is small; the schema change is a one-column migration.
