# Architecture

## Project Structure

```
src/
├── components/Terminal/   # Terminal UI (Terminal.tsx orchestrator, Input, Output, NanoEditor)
├── session/               # SessionContext — global session state (user, machine, path, wifiConnected)
├── filesystem/            # Virtual filesystem with IndexedDB persistence
│   ├── FileSystemContext.tsx   # Filesystem operations + patch persistence
│   ├── fileSystemFactory.ts    # Factory for generating machine filesystems
│   ├── machineFileSystems.ts   # Imports from __encoded.ts, exports Record + MachineId
│   ├── machines/               # Per-machine filesystem definitions (8 machines)
│   │   └── __encoded.ts        # GENERATED (gitignored) — encoded trees for production
│   └── types.ts                # FileNode, FilePermissions, FileSystemPatch types
├── hooks/                 # React hooks (commands, history, autocomplete, variables)
├── network/               # Per-machine network simulation (interfaces, DNS, machines)
├── commands/              # Command implementations (colocated with .test.ts files)
│   ├── ftp/               # FTP mode commands (pwd, ls, cd, get, put, quit)
│   └── permissions.ts     # Command restrictions by user type
├── utils/                 # Utilities (md5, crypto, contentCodec, storage, stringify)
├── test/setup.ts          # Test setup (jest-dom, fake-indexeddb)
└── App.tsx                # Root component (wraps Terminal with providers)

scripts/
└── encode-filesystems.ts  # Pre-build: encodes machine filesystems into __encoded.ts

e2e/
└── ctf-playthrough.spec.ts  # Playwright E2E (full 16-flag CTF playthrough)
```

## Terminal Features

- ASCII banner on startup ("JSHACK.ME v0.1.0")
- Dynamic prompt: `username@machine>` (managed via SessionContext)
- Command history (up/down arrows)
- Tab autocompletion for commands and variables
- `const`/`let` variable declarations with immutability enforcement

## Session Context

`SessionContext` (`src/session/SessionContext.tsx`) is the single source of truth for session state: username, userType, machine, currentPath, wifiConnected.

Key methods: `setUsername()`, `setMachine()`, `setCurrentPath()`, `setWifiConnected()`, `pushSession()` (before SSH), `popSession()` (exit), `canReturn()`.

Session stack enables SSH nesting — `pushSession()` saves state before connecting, `popSession()` restores it on `exit()`. WiFi state is included in snapshots.

## Persistence Architecture

Three-layer system:

1. **`storage.ts`** — Low-level IndexedDB wrapper (`jshack-db`, stores: `session`, `filesystem`)
2. **`storageCache.ts`** — Pre-load cache, called in `main.tsx` before React mounts. Bridges async IndexedDB with sync `useState` initializers. Handles one-time localStorage migration.
3. **Contexts** — Read from cache (sync), write to IndexedDB via `useEffect` (async)

Filesystem persistence uses patches (diffs from base filesystem). Each write/create operation records a `FileSystemPatch` with machineId, path, content, and owner. Patches are replayed on initialization via `applyPatches()`.

## Nano Editor

`nano(path)` returns `{ __type: 'nano_open', filePath }`. Terminal.tsx renders `NanoEditor` as a fixed overlay. Ctrl+S saves (creates or updates file via FileSystemContext), Ctrl+X/Escape exits (prompts if unsaved changes). Tab inserts 2 spaces.

## Async Output Pattern

Network commands (ping, nmap, ssh, nslookup) and WiFi commands (airdump, aircrack) return `AsyncOutput` with `start(onLine, onComplete)` and optional `cancel()`. Terminal disables input during execution. The `onComplete` callback can trigger a password prompt (used by SSH).

## WiFi Hacking Gate

Network access from localhost requires cracking a WiFi network first. This is a progression gate between flags 3 and 4 — not a flag itself.

**State**: `session.wifiConnected` (boolean, persisted to IndexedDB). When `false` on localhost:
- `ifconfig()` shows `wlan0` DOWN (no IP) + loopback `lo`
- Network commands (ping, nmap, ssh, ftp, nc, curl, nslookup) throw `"Network is unreachable"`
- `NetworkContext` returns empty machines/DNS

**Player flow**:
1. `airmon("start", "wlan0")` — enables monitor mode (transient `useRef`, not persisted)
2. `airdump()` — async scan revealing 4 nearby WiFi networks
3. `aircrack("A4:CF:12:D3:8B:7A")` — cracks JSHACK-CORP (the only crackable network), sets `wifiConnected: true`

**Implementation**:
- WiFi networks: `src/network/wifiNetworks.ts` (4 networks with signal/encryption/crackability)
- Commands: `src/commands/airmon.ts`, `airdump.ts`, `aircrack.ts`
- Hook: `src/hooks/useWifiCommands.ts` (wires commands with session + monitor mode ref)
- Gating: `useNetworkCommands.ts` wraps network commands with `wrapWithWifiCheck`
- `NetworkContext` switches localhost interfaces between `localhostDisconnectedInterfaces` and `localhostConnectedInterfaces` based on WiFi state
- localhost uses `wlan0` (not `eth0`) + `lo` loopback

## Available Commands

See `src/commands/` for implementations and `src/hooks/useCommands.ts` for the registry.

Main commands: help, man, echo, author, clear, pwd, ls, cd, cat, su, whoami, airmon, airdump, aircrack, ifconfig, ping, nmap, nslookup, ssh, exit, ftp, nc, curl, decrypt, output, resolve, strings, nano, node, reset.

FTP mode (when connected via ftp): pwd, lpwd, cd, lcd, ls, lls, get, put, quit/bye.

NC mode (when connected via nc): pwd, cd, ls, cat, whoami, help, exit — read-only shell access.

## SEO & Open Graph

Static assets in `public/`: robots.txt, sitemap.xml, og-image.png (1200x630), apple-touch-icon.png. Meta tags in `index.html` cover SEO, Open Graph, and Twitter Cards.

To regenerate OG image: edit `public/og-image.html`, open at 1200x630 viewport, screenshot.
