# Themed Networks

Runtime layer that gives `world_networks` rows dynamic HTTP behavior. A **request handler** is a pure function that observes incoming curl requests to a specific machine and either produces a response or falls through to the static-file pipeline.

Used by themed networks like the search engine (`findit.io`) — when a player runs `curl http://findit.io?q=foo`, the search-engine handler reads the index from the machine's filesystem and returns ranked results. Static sites without a handler keep working unchanged.

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

The handler registry (forthcoming `handlerRegistry.ts`) maps `world_networks.theme` → `RequestHandler`. NetworkContext consults it when building `getHandler` for the curl context.

## Files

| File                       | Description                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`                 | `RequestHandler`, `RequestArgs`, `MachineFsAccess`, `HandlerResponse`. Shared contract between curl and theme-specific handlers.                             |
| `handlers/searchEngine.ts` | findit.io search handler. Reads `/etc/findit/index.json`, scores entries by keyword/title/description substring match against the `q` param, returns top 10. |

## Handler authoring rules

- **Pure functions.** No closures over DB or network state — everything comes from `RequestArgs` + `MachineFsAccess`.
- **Read-only fs.** Handlers can `fs.readFile(path)` but not write. Mutations belong to the patch system, not request handling.
- **`null` means fall through.** Returning `null` from a handler delegates to the static-file path. Returning a `HandlerResponse` (any status code, including 404) means the handler took ownership.
- **No header composition.** Curl adds `Date` / `Server` / `Content-Length` / `Connection` from `wrapHandlerResponse`. Handlers only set status + content-type + body.
