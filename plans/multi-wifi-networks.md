# Plan: Multi-WiFi Networks

**Branch**: feat/multi-wifi-networks
**Status**: Active

## Goal

Replace the single static WiFi network (JSHACK-CORP) with multiple seeded WiFi networks, each providing its own subnet of machines, gated by an intro screen where the player names their workstation and starts/continues a game.

## Context

Currently: 4 WiFi networks exist but only JSHACK-CORP is crackable. It gates access to a hardcoded 192.168.1.x subnet (gateway, fileserver, webserver). The player's machine is always "localhost."

After: A game seed generates 2-3 crackable WiFi networks (plus noise), each with its own seeded subnet of machines (router + 2-4 machines of varied roles). The player names their workstation before starting. Connecting to a different WiFi switches which subnet is visible. Routers have public IPs (prep for multiplayer).

## Acceptance Criteria

- [ ] WiFi state tracks which network (not just boolean connected/disconnected)
- [ ] Game state (seed + workstation name) persisted in IndexedDB
- [ ] Intro screen: new game (enter name) / continue previous game
- [ ] Prompt shows custom workstation name instead of "localhost"
- [ ] WiFi networks are seeded from game seed (2-3 crackable + noise)
- [ ] Each WiFi network has its own subnet of machines (seeded)
- [ ] Connecting to different WiFi auto-disconnects current (must be on workstation)
- [ ] Each subnet's router has a public IP
- [ ] Mission system unchanged (missions are independent of home networks)
- [ ] All state persists in IndexedDB (game state, connected WiFi, filesystem patches)
- [ ] Cross-tab sync works for WiFi changes
- [ ] Existing E2E test passes or is updated to work with intro screen

## Steps

---

### PR 1: Expand WiFi state from boolean to object

Pure refactor. No new features. All existing behavior preserved.

#### Step 1: Update WiFi state type and storage

**Test**: Write test for `saveWifiState` / `loadWifiState` accepting `WifiConnection | null` instead of `boolean`. Verify round-trip: save `{ essid: 'X', bssid: 'Y' }`, load it back, get same object. Save `null`, load back `null`.

**Implementation**:

- Define `WifiConnection = { readonly essid: string; readonly bssid: string }`
- Change `storage.ts`: `saveWifiState(db, connection: WifiConnection | null)`, `loadWifiState(db): WifiConnection | null`
- Change `storageCache.ts`: `getCachedWifiState(): WifiConnection | null`
- Migration: on load, if stored value is `true` (legacy boolean), convert to `{ essid: 'JSHACK-CORP', bssid: 'A4:CF:12:D3:8B:7A' }`. If `false`, convert to `null`.

**Done when**: Storage reads/writes `WifiConnection | null`, legacy boolean auto-migrates.

#### Step 2: Update SessionContext WiFi state

**Test**: Test that `setWifiConnected` accepts a `WifiConnection` object and that `disconnectWifi` sets state to `null`. Test that `wifiConnected` (boolean convenience getter) returns `true` when `connectedWifi` is non-null.

**Implementation**:

- `SessionContext`: rename internal state from `wifiConnected: boolean` to `connectedWifi: WifiConnection | null`
- Add `wifiConnected` derived boolean for backward compat: `connectedWifi !== null`
- Update `setWifiConnected` to accept `WifiConnection | null`
- Update `disconnectWifi` to set `null`
- Export `connectedWifi` on context for components that need the essid

**Done when**: SessionContext exposes both `connectedWifi` (object) and `wifiConnected` (boolean). All existing consumers compile and work.

#### Step 3: Update cross-tab sync for WiFi

**Test**: Test that `wifi-changed` messages carry `WifiConnection | null` instead of boolean.

**Implementation**:

- Update `crossTabSync.ts` message type: `{ type: 'wifi-changed'; connection: WifiConnection | null }`
- Update SessionContext broadcast/receive logic

**Done when**: WiFi sync works across tabs with the new object shape.

#### Step 4: Update WiFi commands (nmcli, aircrack)

**Test**: Existing WiFi command tests pass. `nmcli("connect", ...)` stores the essid/bssid in WiFi state.

**Implementation**:

- `nmcli`: on connect, call `setWifiConnected({ essid, bssid })` instead of `setWifiConnected(true)`
- `nmcli("status")`: show connected network name
- No changes to airmon/airdump/aircrack (they don't touch WiFi state)

**Done when**: All WiFi commands work with expanded state. Existing tests pass.

---

### PR 2: Game state + intro screen

#### Step 5: Game state persistence

**Test**: Write tests for `saveGameState` / `loadGameState`. Verify round-trip of `{ seed: string; workstationName: string }`.

**Implementation**:

- Define `GameState = { readonly seed: string; readonly workstationName: string }`
- Add to `storage.ts`: `saveGameState(db, state)`, `loadGameState(db): GameState | null`
- Add to `storageCache.ts`: `getCachedGameState(): GameState | null`
- Add `GAME_STATE_KEY = 'gameState'` constant
- Add to `initializeStorage` preload flow
- Add `clearGameState` for "new game" reset

**Done when**: Game state round-trips through IndexedDB.

#### Step 6: Game seed generation

**Test**: Test that `generateGameSeed()` produces a string. Test that same seed always produces same WiFi networks (determinism verified later, but seed format test here).

**Implementation**:

- Add `src/generation/gameSeed.ts`
- `generateGameSeed(): string` — uses `crypto.getRandomValues` to create a hex string (e.g., 16 chars)
- Export for use in intro screen

**Done when**: Seed generation utility exists and is tested.

#### Step 7: Intro screen component

**Test**: Component test: renders "New Game" and "Continue" options. "Continue" only shown when game state exists. Entering name and clicking "Start" calls `onStart({ seed, workstationName })`. Submitting empty name shows validation.

**Implementation**:

- Create `src/components/IntroScreen.tsx`
- Two paths: "New Game" (shows name input → generates seed → saves to IndexedDB → callback) and "Continue" (loads game state → callback)
- Minimalist CRT aesthetic (consistent with terminal theme)
- Name input with validation (non-empty, reasonable length)
- "Continue" disabled/hidden when no saved game state
- "New Game" with existing save shows warning about overwriting

**Done when**: IntroScreen component renders, collects name, generates seed, persists game state.

#### Step 8: Integrate intro screen into App

**Test**: Integration test: when no game state, intro screen shows. After starting game, terminal shows. On refresh with saved state, terminal shows directly (or intro with "Continue" highlighted).

**Implementation**:

- `App.tsx`: check `getCachedGameState()` on mount
- If no game state → show `<IntroScreen onStart={...} />`
- If game state exists → show `<SessionProvider>...<Terminal />`
- Pass game state through to providers (context or props)
- `reset` command clears game state and shows intro screen again

**Done when**: App gates terminal behind intro screen. New/continue flow works.

---

### PR 3: Custom workstation name

#### Step 9: Workstation name in prompt

**Test**: Test that `getPrompt()` returns `jshacker@my-machine>` when `session.machine === 'localhost'` and workstation name is `'my-machine'`. Returns `jshacker@192.168.1.50>` when on remote machine (unchanged).

**Implementation**:

- Add `workstationName: string` to SessionContext (read from game state)
- Update `getPrompt()`: when `session.machine === 'localhost'`, use workstation name instead of `'localhost'`
- Terminal prompt rendering uses this automatically

**Done when**: Prompt shows custom name on workstation, IPs on remote machines.

#### Step 10: Workstation name in /etc/hostname

**Test**: Test that localhost filesystem's `/etc/hostname` content matches the workstation name from game state.

**Implementation**:

- `machineFileSystems.ts` or `FileSystemProvider`: when building localhost filesystem, replace `/etc/hostname` content with workstation name
- Could be done as a dynamic patch applied at provider level, or by making localhost filesystem factory accept a name parameter

**Done when**: `cat /etc/hostname` on workstation shows custom name.

---

### PR 4: Seeded WiFi network generation

#### Step 11: WiFi network generator

**Test**: Test `generateWifiNetworks(seed)` produces deterministic output. Same seed → same networks. Different seeds → different networks. Always 2-3 crackable + 2-4 noise networks. Each crackable network has unique essid, bssid, password.

**Implementation**:

- Create `src/generation/generateWifi.ts`
- `generateWifiNetworks(seed: string): readonly WifiNetwork[]`
- Use PRNG from seed (reuse existing `createPrng`)
- Crackable count: 2-3 (seeded)
- ESSID pool: corporate-style names (`ACME-CORP`, `INITECH-5G`, `GLOBEX-NET`, etc.)
- BSSID: randomly generated MAC addresses
- Passwords: drawn from existing `passwords` pool or new WiFi password pool
- Noise networks: mix of WPA3 (uncrackable), weak signal (< -80 dBm), hidden
- Signal strengths: crackable networks have -35 to -65 dBm, noise has -70 to -95 dBm
- Channels: varied, no collisions within crackable set

**Done when**: Deterministic WiFi generation from seed. Tested for structure and determinism.

#### Step 12: Wire generated WiFi into commands

**Test**: Test that `airdump` displays generated networks (not static). Test that `aircrack` can crack each generated crackable network. Test that `nmcli connect` accepts any generated crackable network.

**Implementation**:

- Replace static `WIFI_NETWORKS` import with generated networks from game state seed
- WiFi commands receive generated networks via context (or module-level generated from seed)
- `findWifiNetwork(bssid)` and `findWifiNetworkByEssid(essid)` search generated list
- Passwords need to be in secrets registry (or generated at runtime from seed — since they're seeded and deterministic, XOR encoding isn't needed; the seed itself is the secret)

**Done when**: WiFi commands use seeded networks. All WiFi command tests pass.

---

### PR 5: Per-WiFi subnet generation

#### Step 13: Home network generator

**Test**: Test `generateHomeNetwork(seed, wifiIndex)` produces deterministic subnet. Contains 1 router + 2-4 machines. Router has public IP. Machine roles are varied. All machines have hostnames, IPs, ports, users, filesystems.

**Implementation**:

- Create `src/generation/generateHomeNetwork.ts`
- Reuse patterns from `topology.ts` and `generateMission.ts`:
  - `generatePrivateSubnet(prng)` for subnet
  - `generatePublicIp(prng)` for router's public IP
  - Role assignment (webserver, database, fileserver, workstation mix)
  - `fileSystemFactory.ts` for machine filesystems
  - User/password generation from pools
- Each WiFi network maps to a unique home network by combining game seed + WiFi index as PRNG seed
- Output: `HomeNetwork = { subnet, router, machines, machineConfigs, fileSystems, dnsRecords }`
- Player's workstation is NOT part of this — it's always "localhost" with its own filesystem

**Done when**: Home network generation produces full machine sets from seed.

#### Step 14: Dynamic NetworkContext per WiFi

**Test**: Test that when `connectedWifi.essid` is 'NETWORK-A', NetworkContext provides machines from Network A's subnet. When disconnected, provides no machines. When switched to 'NETWORK-B', provides Network B's machines.

**Implementation**:

- Generate all home networks on game start (or lazily on first connect)
- Store generated home networks in a new context or provider
- `NetworkContext`: instead of reading from static `createInitialNetwork()`, read from the home network matching `connectedWifi.essid`
- Dynamic localhost interface: `wlan0` IP comes from connected network's subnet (e.g., `.100` in that subnet)
- DNS records come from connected network
- Mission network overlay logic stays the same (missions override home network when active)

**Done when**: NetworkContext dynamically switches based on connected WiFi. Machines change per network.

#### Step 15: Dynamic FileSystemProvider per WiFi

**Test**: Test that filesystem includes home network machines' filesystems when connected. Switching WiFi changes available machine filesystems.

**Implementation**:

- `FileSystemProvider`: merge home network filesystems alongside localhost filesystem
- When WiFi switches, the available machine filesystems change
- Filesystem patches are keyed by machine IP — patches to machines in Network A persist even when on Network B (they just aren't visible until you reconnect to A)
- Localhost filesystem is always present

**Done when**: File operations work on home network machines. Patches persist per-machine across WiFi switches.

---

### PR 6: WiFi switching logic

#### Step 16: Auto-disconnect on WiFi switch

**Test**: Test that `nmcli("connect", "NETWORK-B", password)` when already on "NETWORK-A" auto-disconnects A and connects B. Test that if `session.machine !== 'localhost'`, nmcli connect refuses with "must disconnect from remote machine first."

**Implementation**:

- `nmcli`: before connecting, check if already on different WiFi
  - If on localhost: auto-disconnect current → connect new
  - If SSH'd into remote machine: return error "Disconnect from remote machine first"
- `disconnectWifi()` already resets to localhost — reuse that, then immediately connect to new network
- Monitor mode should be disabled when switching (can't monitor while connected)

**Done when**: WiFi switching works cleanly. Can't switch while SSH'd.

---

### PR 7: Polish + remove static network

#### Step 17: Remove static initial network

**Test**: Verify that `initialNetwork.ts` static machines (gateway, fileserver, webserver) are no longer referenced. All network access goes through generated home networks.

**Implementation**:

- Remove static machine definitions from `initialNetwork.ts` (gateway, fileserver, webserver, their RemoteMachine/DNS)
- Keep localhost interface templates (wlan0 up/down, loopback) — these are still used
- Remove static machine filesystems from `machineFileSystems.ts` (192.168.1.1, 192.168.1.50, 192.168.1.75)
- Keep localhost filesystem
- Update any hardcoded references to 192.168.1.x IPs in hints/tutorials

**Done when**: No static network machines remain. Everything is generated.

#### Step 18: Update localhost filesystem hints

**Test**: Test that WiFi tutorial hint file references reflect the new flow (multiple networks).

**Implementation**:

- Update `/home/jshacker/downloads/wifi_tools.txt` to reference multiple networks
- Update any other hint files that reference specific IPs or network names
- Update `.bash_history` if it contains static references

**Done when**: In-game hints match the new multi-WiFi flow.

#### Step 19: E2E test update

**Test**: E2E test (Playwright) works with intro screen + multi-WiFi flow.

**Implementation**:

- Update E2E test to handle intro screen (enter name, start game)
- Update WiFi cracking steps to use generated network
- Mission flow should still work (missions are independent)

**Done when**: `npm run test:e2e` passes.

---

## Resolved Questions

1. **WiFi passwords encoding**: Runtime generation from seed is sufficient. No need for build-time encoding — the seed itself is the secret.

2. **Localhost filesystem persistence**: Factory parameter. The localhost filesystem factory accepts `workstationName` and produces `/etc/hostname` with the correct value. Patches represent player actions only, not system initialization. Future DB stores `{ seed, workstationName }` and reconstructs.

3. **Reset command**: Soft reset — clears session state (SSH stack, path, filesystem patches, SSH keys, bricked machines) but preserves game state (seed + workstation name). "New Game" from intro screen handles full wipe.

4. **Home network machine content**: Simpler content — configs, logs, noise files. Not mission-level depth (no target files, credential leaks, scripts).

5. **Existing save migration**: Not needed. No active players. "New Game" calls `clearAllData()` to wipe all IndexedDB state before creating fresh game state.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — run `mutation-testing` skill
2. Refactoring assessment — run `refactoring` skill
3. Typecheck and lint pass
4. DDD glossary check (if applicable)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
