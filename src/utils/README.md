# Utilities

Shared utility modules used across the application. Each module is self-contained with colocated tests.

## Modules

| Module            | Description                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `crypto.ts`       | Deterministic XOR+FNV-1a encrypt/decrypt, hex-to-bytes conversion, key generation                                    |
| `md5.ts`          | MD5 hashing for password validation (used by `/etc/passwd` checks)                                                   |
| `network.ts`      | IP address validation (`isValidIP`) and IP range parsing (`parseIPRange`)                                            |
| `stringify.ts`    | Value-to-string conversion (used by `echo`, `output`, `resolve`)                                                     |
| `storage.ts`      | IndexedDB wrapper — open, read, write, clear for `session` and `filesystem` stores, plus mission seed persistence    |
| `storageCache.ts` | Pre-load cache that bridges async IndexedDB with sync React `useState` initializers (session, patches, mission seed) |
| `asyncCommand.ts` | Cancellation token for async commands — encapsulates `setTimeout` scheduling and cleanup                             |
| `crossTabSync.ts` | BroadcastChannel wrapper for cross-tab state sync (filesystem patches, WiFi, mission, theme)                         |

## Persistence Stack

```
main.tsx: await initializeStorage()  →  IndexedDB → module cache
                                                       ↓
SessionContext:    useState(getCachedSessionState)      (sync read)
FileSystemContext: useState(getCachedFilesystemPatches) (sync read)
useMissionState:  getCachedMissionSeed()               (sync read, regenerates network from seed)
                                                       ↓
useEffect:         saveSessionState(db, state)          (async write)
useEffect:         saveFilesystemPatches(db, patches)   (async write)
useMissionState:   saveMissionSeed(db, seed)            (async write, on start/abort/complete)
```

- **`storage.ts`** — Low-level IndexedDB operations (`openDatabase`, `loadSessionState`, `saveSessionState`, `loadFilesystemPatches`, `saveFilesystemPatches`, `loadMissionSeed`, `saveMissionSeed`, `clearAllData`)
- **`storageCache.ts`** — Called once before React mounts via `initializeStorage()`. Loads all stores (session, filesystem patches, mission seed) into a module-level cache. Also applies the persisted theme via `applyTheme()` to prevent flash of wrong colors on load. Handles one-time migration from localStorage. Exposes `getCachedMissionSeed()` for mission state restoration on reload.
