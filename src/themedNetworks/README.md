# Themed Networks

Runtime layer that gives `world_networks` rows dynamic HTTP behavior. A **request handler** is a pure function that observes incoming curl requests to a specific machine and either produces a response or falls through to the static-file pipeline.

Used by themed networks like the search engine (`findit.io`) — when a player runs `curl http://findit.io?q=foo`, the search-engine handler reads the index from the machine's filesystem and returns ranked results. Static sites without a handler (e.g. `techparts.io`) keep working unchanged — every URL falls through to `/var/www/html<path>` and returns the file the generator laid down.

## Active themed networks

| Theme           | Domain         | IP              | Handler? | Notes                                                                                                                                                                                                                  |
| --------------- | -------------- | --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search-engine` | `findit.io`    | `192.0.2.80`    | Yes      | Indexes peer `world_networks` rows' `search_metadata` into `/etc/findit/index.json`, served via the search-engine handler.                                                                                             |
| `techparts`     | `techparts.io` | `198.51.100.80` | No       | Hand-authored gray-market reseller site. Static-only — every URL falls through to `/var/www/html<path>`. Time-gated CVE on port 80 (procedural Apache; shell_full at user tier; first drop ~3-14 days into game time). |

## How it works

```
┌──────────────────────────────────────────────────────────────┐
│  curl http://findit.io?q=foo                                  │
└──────────────────────────────────────────────────────────────┘
                       │
                       ▼  parseUrl → { path, query, ... }
┌──────────────────────────────────────────────────────────────┐
│  CurlContext.getHandler(filesystemIP) → RequestHandler?       │
└──────────────────────────────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
   handler(args, fs) →            (no handler / null result)
   HandlerResponse | null              │
        │                             ▼
        ▼                       /var/www/html/<path> static file
   wrapHandlerResponse →          (existing pipeline)
   HttpResponse
```

The handler registry (`handlerRegistry.ts`) maps `world_networks.theme` → `RequestHandler`. `useWorldNetworks` builds an IP→handler map from rows + generated networks; `NetworkProvider` exposes `getHandler(ip)` on context for curl dispatch.

## Files

| File                                | Description                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                          | `RequestHandler`, `RequestArgs`, `MachineFsAccess`, `HandlerResponse`. Shared contract between curl and theme-specific handlers.                                                                                                                                                                            |
| `handlerRegistry.ts`                | `THEME_HANDLERS` map (theme → handler) + `buildWorldHandlerMap(rows, networks)` which pairs each row's theme with its generated network's router IP and returns the IP→handler map.                                                                                                                         |
| `handlers/searchEngine.ts`          | findit.io search handler. Reads `/etc/findit/index.json`, scores entries by keyword/title/description substring match against the `q` param, returns top 10.                                                                                                                                                |
| `generators/searchEngineNetwork.ts` | Builds findit.io's single-machine `MissionNetwork`. Ports 80 + 443 open, /var/www/html/index.html landing page, /etc/findit/index.json snapshot built from peer rows' search_metadata.                                                                                                                      |
| `generators/techpartsNetwork.ts`    | Builds techparts.io's single-machine `MissionNetwork`. Lays every entry from the `TECHPARTS_PAGES` manifest into `/var/www/html<path>` verbatim. Port 80 ships a procedural Apache version chosen by `pickApacheCveVersion` (shell_full:user constraint); port 443 ships nginx/1.20.1 (decorative, no CVE). |
| `generators/registry.ts`            | `selectGenerator(theme)` — theme-keyed generator dispatch. Themes without a registered entry fall back to `generateMissionNetwork`.                                                                                                                                                                         |
| `content/techparts/pages.ts`        | Hand-authored content manifest for techparts.io. Linked + hidden pages, `kind: 'html' \| 'text'` discriminated. HTML pages must pass terminal-browser invariants (see authoring rules).                                                                                                                     |

## Handler authoring rules

- **Pure functions.** No closures over DB or network state — everything comes from `RequestArgs` + `MachineFsAccess`.
- **Read-only fs.** Handlers can `fs.readFile(path)` but not write. Mutations belong to the patch system, not request handling.
- **`null` means fall through.** Returning `null` from a handler delegates to the static-file path. Returning a `HandlerResponse` (any status code, including 404) means the handler took ownership.
- **No header composition.** Curl adds `Date` / `Server` / `Content-Length` / `Connection` from `wrapHandlerResponse`. Handlers only set status + content-type + body.

## Content authoring rules (static themed networks)

Content manifests for static themed networks (techparts.io and any future handler-less sites) ship via TS modules under `content/<theme>/`. The `lynx` terminal-browser command (see `src/commands/lynx/render.ts`) renders `kind: 'html'` pages by handing the raw markup to the host browser's DOMParser, so every HTML page must:

- **Be well-formed semantic HTML.** Parses without errors via DOMParser.
- **Avoid `<script>`, `<style>`, `class=`, `id=`.** The terminal browser has no CSS or JS surface; these attributes would smuggle layout concerns into a frame that can't honour them.
- **Resolve every internal `<a href>`.** A path-aware link-integrity walker enforces this — orphaned navigation breaks recon.

Plain-text artefacts (`*.txt`, `*.bak`, `robots.txt`) carry `kind: 'text'` and are served verbatim. The generator MUST NOT transform manifest body content — what the manifest declares is what curl and lynx return.
