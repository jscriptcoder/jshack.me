# Utilities

Shared utility modules used across the application. Each module is self-contained with colocated tests.

## Modules

| Module            | Description                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `crypto.ts`       | Deterministic XOR+FNV-1a encrypt/decrypt, hex-to-bytes conversion, key generation                                         |
| `md5.ts`          | MD5 hashing for password validation (used by `/etc/passwd` checks)                                                        |
| `network.ts`      | IP address validation (`isValidIP`) and IP range parsing (`parseIPRange`)                                                 |
| `stringify.ts`    | Value-to-string conversion (used by `echo`, `output`, `resolve`)                                                          |
| `storage.ts`      | Storage wrapper — sessionStorage for per-tab session, IndexedDB for shared state (filesystem patches, WiFi, mission seed) |
| `storageCache.ts` | Pre-load cache that bridges async IndexedDB + sync sessionStorage with React `useState` initializers                      |
| `asyncCommand.ts` | Cancellation token for async commands — encapsulates `setTimeout` scheduling and cleanup                                  |
| `crossTabSync.ts` | BroadcastChannel wrapper for cross-tab state sync (filesystem patches, WiFi, mission, theme)                              |

## Persistence Stack

```
main.tsx: await initializeStorage()  →  sessionStorage + IndexedDB → module cache
                                                                       ↓
SessionContext:    useState(getCachedSessionState)      (sync read from sessionStorage)
                   getCachedWifiState()                 (sync read, WiFi from IndexedDB)
FileSystemContext: useState(getCachedFilesystemPatches) (sync read from IndexedDB)
useMissionState:   getCachedMissionSeed()               (sync read from IndexedDB)
                                                                       ↓
useEffect:         saveSessionToTab(state)              (sync write to sessionStorage)
SessionContext:    saveWifiState(db, connected)          (async write to IndexedDB)
useEffect:         saveFilesystemPatches(db, patches)   (async write to IndexedDB)
useMissionState:   saveMissionSeed(db, seed)            (async write to IndexedDB)
```

- **`storage.ts`** — Low-level operations: sessionStorage helpers (`saveSessionToTab`, `loadSessionFromTab`, `clearSessionFromTab`), IndexedDB helpers (`openDatabase`, `loadFilesystemPatches`, `saveFilesystemPatches`, `loadMissionSeed`, `saveMissionSeed`, `saveWifiState`, `loadWifiState`, `clearAllData`)
- **`storageCache.ts`** — Called once before React mounts via `initializeStorage()`. Loads session from sessionStorage, shared state (filesystem patches, WiFi, mission seed) from IndexedDB into a module-level cache. Also applies the persisted theme via `applyTheme()` to prevent flash of wrong colors on load. Exposes `getCachedWifiState()` for shared WiFi and `getCachedMissionSeed()` for mission state restoration on reload.
