# 7. Game Shell & Lifecycle

The game shell is the player-facing UI layer that wraps all core systems. It manages the intro/boot flow, session state (the "current user/machine/path" context), game time (the procedural CVE timeline), multi-tab synchronization, persistence across refreshes, and the visual theme. This section covers everything from first boot to darknet marketplace access.

## 7.1 App Entry & Lifecycle (App.tsx)

`App.tsx` is the root component and orchestrates three screen states:

- **Intro** — New-game menu or continue-game prompt
- **Boot** — Linux-style animated boot sequence (new games only)
- **Game** — Main terminal interface wrapped in `SessionProvider` + `GameSession`

```
IntroScreen → (isNewGame) → BootScreen → Terminal
                 ↓
            (continueGame)
                 ↓
              Terminal
```

### New-Game Flow

1. **IntroScreen** collects username, workstation name, and root password via three-field form. A "New Game" button clears any previous game state; "Continue" button restores cached game state.
2. **Form submission** (or Enter key):
   - Validates hostname (2–24 chars, alphanumeric + hyphens, lowercase)
   - Validates username (2–24 chars, starts with letter, [a-z0-9_-], no reserved names like `root`, `guest`, `admin`)
   - Validates root password (minimum 4 characters, must match confirmation)
   - Generates a random 16-character hex `gameSeed` via `crypto.getRandomValues()`
   - Fires-and-forgets `registerWorkstation()` to the server (async, non-blocking — UX doesn't wait)
3. **BootScreen** runs a Linux-style boot animation with hardware init, kernel logs, systemd startup messages, and automatic login. Takes ~3 seconds.
4. **Game session begins** — `SessionProvider` wraps `GameSession`, which stitches together all child providers (`HomeNetworksProvider`, `MissionProvider`, `FileSystemProvider`, `NetworkProvider`) and mounts `Terminal`.

### Session Restoration (Continue)

When the app detects `cachedGame` (from `storageCache.getCachedGameState()`), it skips intro and boot, jumping directly to the terminal. The `sessionStorage` per-tab and IndexedDB shared stores are pre-populated before React mounts via `storageCache.ts`, guaranteeing no flicker.

### Hostname Computation

The player's full hostname combines workstation name + an 8-character identity-derived suffix:

```
"skylab" + "-a1b2c3d4" = "skylab-a1b2c3d4"
```

The suffix is computed once per identity (lazy-created on first intro) and is stable across sessions. It's used as the unique machine ID internally (`workstation_id`) but stripped from the prompt display via `displayPromptHostname()` to keep the prompt clean. This prevents prompt clutter while maintaining a permanent, collision-resistant identity.

The full hostname is computed at app startup via `computePlayerHostname(workstationName, identity)` and threaded through to every consumer: IntroScreen preview, BootScreen, SessionProvider prompt, and `/etc/hostname` file content.

## 7.2 Intro / Boot Screen (Username, Workstation Name, Root Password)

`IntroScreen.tsx` is a single-screen form that gathers three pieces of player configuration:

### Fields

1. **Workstation name** (required, 2–24 chars)
   - Lowercase alphanumeric + hyphens (validated via `/^[a-z0-9][-a-z0-9]*[a-z0-9]$/`)
   - Example: `skylab`, `my-pc`, `darknet-box`
   - Shown in prompt and `/etc/hostname` on localhost

2. **Username** (required, 2–24 chars)
   - Starts with letter, then [a-z0-9_-]
   - Rejected: `root`, `guest`, `admin`, `daemon`, `bin`, `sys`, `nobody`
   - Shown as `${username}@${hostname}>` in the prompt
   - Creates a home directory `/home/${username}` and entry in `/etc/passwd`

3. **Root password** (required, 4+ characters)
   - Confirmation field ensures no typos
   - Never exposed in-game; stored server-side as md5 hash in `/etc/passwd`
   - Used locally to authenticate `su` commands and to validate cross-player access on shared LANs
   - The player's own `su` command accepts this password with no brute-force check; remote players must hydra-crack it

### Prompt Preview

While the player types hostname and username, the form shows a live preview of the in-game prompt: `${trimmedUsername}@${displayPromptHostname(full_workstation_id)}>`. The preview strips the identity suffix automatically so the player sees the same clean prompt they'll get in-game.

### Menu Button Styling

Menu buttons (NEW GAME, CONTINUE, START, BACK) have bordered styling with theme-aware colors. On hover, they invert to accent background with accent text. Keyboard navigation: Enter submits, Escape cancels.

## 7.3 Boot Sequence (Linux-Style)

`BootScreen.tsx` plays a ~3-second Linux boot animation for new games. The sequence is non-interactive; players watch it complete then the terminal appears.

### Boot Sequence Steps

1. **BIOS messages** — "Initializing system…", "Memory test… 4096 MB OK" (dim text)
2. **Kernel load** — "Loading Linux 5.15.0…", "Loading initial ramdisk" (standard text)
3. **Kernel boot logs** — Realistic kernel timestamps and subsystem init lines (dim text, scrolling)
4. **systemd startup** — Service init messages with "[ OK ]" prefixes:
   - Journal Service
   - Local File Systems
   - Login Service
   - Network Manager
   - OpenSSH server
   - wlan0 device found
   - Network target
   - Multi-User System target
5. **Login prompt** — `${hostname} login: ${username} (automatic login)` (standard text)
6. **Completion** — Triggers `onComplete()` callback, which sets screen to 'game'

Each step has a `delay` property (milliseconds) that stagger the lines for realistic boot pace. Blank lines separate phases. The container auto-scrolls to bottom as lines are added. No input is accepted during boot.

## 7.4 Session Context (Current Machine, User, PWD, Hop Chain)

`SessionContext` (`src/session/SessionContext.tsx`) is the single source of truth for the player's current terminal session state.

### Core Session Type

```typescript
type Session = {
  readonly username: string; // Player-chosen, e.g., "jshacker"
  readonly userType: UserType; // 'root' | 'user' | 'guest'
  readonly machine: string; // IP or hostname, e.g., "192.168.1.75"
  readonly hostname?: string; // Display name for prompt, e.g., "dist-rtr"
  readonly currentPath: string; // Working directory, e.g., "/home/jshacker"
  readonly theme: ThemeId; // 'amber' | 'green' | 'cyan' | 'light'
};
```

### Default Session

On app start (or new tab), the session initializes to:

- `username` = player-chosen name from intro
- `userType` = 'user'
- `machine` = 'localhost'
- `currentPath` = '/home/${username}'
- `theme` = cached theme or 'amber' (default)

### Session Stack (SSH + su)

The session stack is a LIFO queue of snapshots. Pushing a session saves the current state; popping restores the previous state.

#### Snapshot Types

```typescript
type SessionSnapshot = {
  readonly session: Session;
  readonly reason: 'ssh' | 'su' | 'exploit';
};
```

#### Operations

- **`pushSession(reason)`** — Save current session to stack (before SSH, su, or exploit shell)
- **`popSession()`** — Restore previous session from stack
- **`popAllSessions()`** — Reset to bottom of stack (mission abort, returns home)
- **`canReturn()`** — Check if stack has entries

#### Example Flow

```
Start: user@localhost:/home/user>
SSH to 192.168.1.5
  → pushSession('ssh')
  → setMachine('192.168.1.5')
  → user@192.168.1.5>
su root (with password)
  → pushSession('su')
  → setUsername('root', 'root')
  → root@192.168.1.5>
exit
  → popSession()
  → user@192.168.1.5>
exit
  → popSession()
  → user@localhost:/home/user>
```

WiFi state (`connectedWifi`) is NOT part of snapshots — it doesn't change per SSH hop. Disconnecting WiFi from another tab resets the session to localhost but preserves other context.

### Hostname Display

The `hostname` field is optional and provides a display name for the prompt. The prompt uses `session.hostname ?? session.machine`. For localhost, an effect syncs `workstationName` into `session.hostname` so the prompt shows `user@skylab>` instead of `user@localhost>`. For remote machines, `setMachine(ip, hostname)` can set a display name from network config (e.g., `user@dist-rtr>` instead of `user@45.x.x.x>`).

### FTP Mode

FTP mode tracks both local and remote filesystem state simultaneously:

```typescript
type FtpSession = {
  readonly remoteMachine: string;
  readonly remoteUsername: string;
  readonly remoteUserType: UserType;
  readonly remoteCwd: string;
  readonly originMachine: string;
  readonly originUsername: string;
  readonly originUserType: UserType;
  readonly originCwd: string;
};
```

- **`enterFtpMode(session)`** / **`exitFtpMode()`** — Toggle FTP mode
- **`updateFtpRemoteCwd(path)`** / **`updateFtpOriginCwd(path)`** — Navigate directories on either side
- Prompt changes to `ftp>` when active
- All FTP commands (`pwd`, `ls`, `cd`, `get`, `put`, `quit`) operate on this dual state

### NC Mode

NC mode represents an interactive netcat shell:

```typescript
type NcSession = {
  readonly targetIP: string;
  readonly targetPort: number;
  readonly service: string;
  readonly username: string;
  readonly userType: UserType;
  readonly currentPath: string;
};
```

- **`enterNcMode(session)`** / **`exitNcMode()`** — Toggle NC mode
- **`updateNcCwd(path)`** — Navigate directories (read-only filesystem)
- Prompt changes to `$` when active
- Commands: `pwd`, `cd`, `ls`, `cat`, `whoami`, `help`, `exit` (no binary execution)

## 7.5 Game Time Model (Shared Universe Time, Server-Stamped)

`gameTime.ts` implements a real-world-clock time model for the procedural CVE timeline. The defense treadmill (Phase 3) advances CVE availability based on elapsed game time.

### API

```typescript
export const MS_PER_DAY = 86400000;  // Milliseconds in one 24-hour day

// Initialize anchor on first call; idempotent thereafter
initGameTimeIfUnset(): number

// Read anchor without side effects
readStartedAt(): number | null

// Compute whole game days elapsed since anchor
getGameTime(): number

// Clear anchor (called on permadeath / new game)
resetGameTime(): void
```

### How It Works

On first app load (new game), `initGameTimeIfUnset()` records `Date.now()` in `localStorage` under `jshack_started_at`. On subsequent loads, the function detects the stored anchor and returns it without writing.

`getGameTime()` returns `Math.floor((Date.now() - startedAt) / MS_PER_DAY)` — the number of whole 24-hour periods elapsed since the anchor was set. This is called by the vulnerability lookup layer whenever a CVE needs to be checked: if the CVE's `publishedAt` field (measured in game days since `startedAt`) is <= the result of `getGameTime()`, the CVE is "active" and can be exploited.

### Offline Accrual

If a player leaves the game for a week, they return to a week's worth of newly-published CVEs. This matches real system administration: patches accumulate while you're away. The game feels alive even when you're not playing.

### Permadeath / New Game

`resetGameTime()` clears the `localStorage` entry. The next `initGameTimeIfUnset()` call generates a fresh anchor, advancing all CVEs forward in the timeline.

### Multiplayer Note (Future)

In multiplayer, gameTime is intended to become **server-stamped** rather than client-computed, to prevent clock-tampering exploits. The current memory notes "shared universe time, anti-cheat server-stamped gameTime" as the target. The Solid rewrite should plan for this from the start: read gameTime from server-issued tokens or signed envelopes, not from `Date.now() - startedAt`.

## 7.6 Game Seed (Scope, Derivation)

`gameSeed.ts` generates the 16-character hex seed that drives all deterministic generation.

```typescript
export const generateGameSeed = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};
```

### Scope

The seed controls:

1. **Home network topology** — Every WiFi network the player can crack generates its own LAN via `generateNetwork(gameSeed, wifiNetwork)`, producing deterministic machines, services, CVEs, credentials, and filesystems. Same seed + same WiFi = same machines forever.
2. **Mission networks** — `generateMissionNetwork(seed)` produces a full network from a mission seed string. Different mission seeds = different networks.
3. **Localhost** — Generated via `generateLocalhost(gameState, hostname)`, which uses the game seed to derive guest account password and other deterministic content.

The seed does NOT control:

- Session state (current user, machine, path — these are transient per-tab)
- Theme choice (persisted but player-controlled)
- Filesystem patches (mutable via gameplay)

### Storage

Seed is persisted in `IndexedDB` as part of `GameState`, which also holds username, workstation name, and root password. On app reload, the cached seed deterministically regenerates every home-network machine and mission (if one is active).

## 7.7 WiFi System (Multi-WiFi, airmon-ng/airodump-ng/aircrack-ng)

The WiFi hacking gate is the gatekeeper to network access. From localhost, the player cannot reach any remote networks until they crack a WiFi connection.

### WiFi Network Definitions

Static WiFi networks are defined in `src/network/wifiNetworks.ts`:

```typescript
type WifiNetwork = {
  readonly bssid: string; // MAC address, e.g. "A4:CF:12:D3:8B:7A"
  readonly essid: string; // Network name
  readonly power: number; // Signal strength (-42 to -93)
  readonly channel: number; // WiFi channel (1–11)
  readonly encryption: 'WPA2' | 'WPA3' | 'WEP' | 'OPEN';
  readonly crackable: boolean; // Is the password discoverable?
  readonly password?: string; // (if crackable) Plaintext password from secrets
  readonly tier?: WifiTier; // 'crowded' | 'shared' | 'solo' (crackable only)
};
```

Example network:

```javascript
{
  bssid: 'A4:CF:12:D3:8B:7A',
  essid: 'JSHACK-CORP',
  power: -42,
  channel: 6,
  encryption: 'WPA2',
  crackable: true,
  password: secrets.WIFI_PASSWORD,  // Visible only in __encoded.ts for Vercel
  tier: 'solo',
}
```

Current catalog includes 4 networks: one crackable (JSHACK-CORP) and 3 noise networks (NetGear, FBI Van, hidden).

### WiFi Hacking Workflow

1. **`airmon-ng start wlan0`** — Enable monitor mode (localhost only)
   - Validates: on localhost, not already connected
   - Sets `setMonitorMode(true)` state
   - Only one mode toggle per command (no `stop` check during `start`)

2. **`airodump-ng`** — Scan for networks (localhost + monitor mode)
   - Lists all networks in tabular format: BSSID, Power, Channel, Encryption, ESSID
   - Async command with 600ms scan delay before output
   - Non-cancellable

3. **`aircrack-ng <bssid>`** — Crack WPA/WPA2 password (localhost + monitor mode)
   - Validates BSSID exists
   - If not crackable, throws "WPA3 encryption not supported" error
   - Simulated brute-force: iterates through wordlist, outputs progress every 400ms
   - On success, calls `setWifiConnected({ essid, bssid })`
   - Persists connection to IndexedDB (`wifiConnected` key)

### WiFi State

`connectedWifi: WifiConnection | null` is stored in `SessionContext` as a separate `useState`, not part of the core `Session` type. This separation reflects its nature: it's global shared state (all tabs see it), not per-tab session state.

```typescript
type WifiConnection = {
  readonly essid: string;
  readonly bssid: string;
};
```

### Persistence & Sync

- **Storage** — IndexedDB, shared across all tabs
- **BroadcastChannel sync** — When a tab connects/disconnects WiFi, it broadcasts `wifi-changed` to other tabs, which update their `connectedWifi` state

### Effects

Once WiFi is connected, the session's machine can reach networks on that BSSID's generated LAN. The home network is generated deterministically from `(gameSeed, wifiNetwork)`, so cracking the same BSSID always generates the same machines.

### Multiplayer Note

In multiplayer, the home network is **shared** with other players who cracked the same WiFi (Model B tiered hybrid, see Section 5). Each cracked WiFi joins the player to a `home_networks` row via `/api/join-home-network`, allocating an occupant slot.

## 7.8 Wallet (In-Game Balance, Separate Keypair)

The in-game wallet is a separate Ed25519 keypair that lives in the virtual filesystem (`~/.wallet/key.pem` on localhost) and can be lost or stolen.

### Split Keys

Two different Ed25519 keypairs:

1. **Player identity** (`src/identity/`) — Persisted in localStorage, never changes, tied to the player's browser profile. Used for server-authenticated requests. Determines the workstation's unique ID suffix.
2. **Wallet keypair** — Lives in the filesystem as a regular file. Can be copied between machines via SCP, exfiltrated, encrypted, deleted. Lost on permadeath (reset command).

The split prevents a compromised wallet from compromising the player's identity. Wallet defense is gameplay; identity defense is platform.

### Wallet File

```
~/.wallet/key.pem
  - Type: Ed25519 private key in PEM format
  - Owner: ${username} (player's user)
  - Permissions: 0600 (user-readable only)
  - Accessible: Via cat (plaintext), can be copied via SCP
```

### Balance Tracking

The balance is stored alongside the keypair in `~/.wallet/balance.json`:

```json
{
  "satoshis": 500000,
  "lastUpdated": 1672531200000
}
```

- Only the wallet owner can read/write balance
- No automatic reward distribution (future feature — Phase 4)
- Mission completion will update the balance via a privileged write (or server-side in multiplayer Phase 5)

### Vault Use Case

In future multiplayer, players can deposit their wallet on a shared LAN machine for safekeeping. The machine's root can encrypt/lock it; other players can authenticate with it for transactions.

## 7.9 Theme System (amber/green/cyan/light)

Terminal colors are themeable via CSS custom properties. Player can switch themes at runtime with the `theme()` command.

### Available Themes

| ID      | Name            | Style                   |
| ------- | --------------- | ----------------------- |
| `amber` | Amber (default) | Classic amber CRT       |
| `green` | Green Phosphor  | Green-on-black terminal |
| `cyan`  | Cyan            | Cyan/blue CRT           |
| `light` | Light           | Dark on light bg        |

### Color Tokens (14)

Each theme defines 14 semantic color tokens applied via CSS `--theme-*` variables:

- `--theme-bg` — Page background
- `--theme-text` — Primary text (results, descriptions)
- `--theme-text-bright` — Bright text (banner, commands, input, headings)
- `--theme-text-dim` — Dim text (prompt, status bar, cursor position)
- `--theme-error` — Error messages
- `--theme-accent` — Inverted backgrounds (nano title bar, badges)
- `--theme-accent-text` — Text on accent backgrounds
- `--theme-border` — Input border, help bar background
- `--theme-scroll-thumb` — Scrollbar thumb
- `--theme-scroll-thumb-hover` — Scrollbar thumb on hover
- `--theme-caret` — Input cursor color
- `--theme-link` — Hyperlinks
- `--theme-link-hover` — Hyperlink hover state
- `--theme-avatar-border` — Author card avatar border

### Application Flow

1. **Before React mounts** — `storageCache.ts` reads the persisted theme from IndexedDB and calls `applyTheme()` to set CSS variables immediately (prevents flash of wrong colors).
2. **React mount** — `SessionContext` initializes with the cached theme value. A `useEffect` calls `applyTheme()` whenever `session.theme` changes.
3. **User switches theme** — `theme("green")` calls `setTheme()` on the session context, which updates the persisted session and triggers the `useEffect` to apply the new CSS variables.

### Components & CSS Variables

Components use inline `style` attributes with `var(--theme-*)` instead of Tailwind color classes:

```jsx
<div style={{ color: 'var(--theme-text)' }}>Result text</div>
```

Fallback values are defined in `:root` in `src/index.css` (amber defaults) so the page renders correctly before JavaScript runs.

### User Command

```
theme()               — List all themes, mark active with *
theme("green")        — Switch to named theme
reset("confirm")      — Reset theme back to amber + clear all IndexedDB
```

Theme choice persists across sessions via IndexedDB (same store as WiFi/mission/patches).

## 7.10 Multi-Tab Support & Cross-Tab Sync (BroadcastChannel)

Multiple browser tabs can run independent terminal sessions with shared state.

### Per-Tab Independence

Each tab has its own session state (user, machine, path, SSH stack, FTP/NC/MySQL mode). Typing commands in one tab does not affect another tab's terminal. But:

- **Filesystem patches** — Shared. A file written in tab A immediately appears in tab B.
- **WiFi state** — Shared. Cracking WiFi in tab A enables network access in tab B.
- **Mission state** — Shared. Accepting a mission in tab A loads it in tab B.
- **Theme** — Shared. Switching theme in tab A updates tab B.

### Implementation

`src/utils/crossTabSync.ts` provides `createSyncChannel()`, which returns a `BroadcastChannel`-based messenger (or no-op stubs if unavailable).

Each context that needs sync creates a channel inside its subscription effect and closes it on cleanup. The channel ref is updated so broadcast calls always use the active channel. This pattern is React StrictMode-safe: the cleanup + re-run cycle gets a fresh channel instead of reusing a closed one.

### Messages

```javascript
// Filesystem patches
{ type: 'patch', machineId, patch: FileSystemPatch }

// WiFi state
{ type: 'wifi-changed', connected: WifiConnection | null }

// Mission state
{ type: 'mission-changed', seed: string | null }

// Theme
{ type: 'theme-changed', themeId: ThemeId }
```

### Echo Loop Prevention

Each context broadcasts only on locally-initiated changes (explicit method calls). `BroadcastChannel` does not deliver messages to the posting tab, so echo loops cannot occur. Messages are fire-and-forget; `IndexedDB` serves as the durable backing store.

### Tab Title Updates

`SessionContext` updates `document.title` based on the current session mode:

- `username@machine — JSHACK.ME` (normal)
- `ftp> — JSHACK.ME` (FTP mode)
- `nc shell — JSHACK.ME` (NC mode)
- `mysql> — JSHACK.ME` (MySQL mode)
- `redis> — JSHACK.ME` (Redis mode)

### Graceful Fallback

When `BroadcastChannel` is unavailable (older browsers), `createSyncChannel()` returns no-op stubs. Tabs work independently; shared state is only written/read via IndexedDB, so slow async consistency is the fallback. Modern browsers (all current versions) support `BroadcastChannel`.

### Relationship to Supabase Realtime

In multiplayer, `BroadcastChannel` and Supabase Realtime are both active and share `applyExternalPatch`. Decision recorded in memory: keep both for now; revisit deletion post-launch when Realtime reliability is measured.

## 7.11 Session Persistence (IndexedDB, Restore on Refresh)

Three-layer persistence architecture ensures state survives page refresh:

### Layer 1: Storage API (`storage.ts`)

Low-level adapter:

- **IndexedDB** — Shared state: WiFi connection, mission seed, filesystem patches, bricked machines, theme
- **sessionStorage** — Per-tab state: Session (user, machine, path, theme, SSH stack), FTP/NC/MySQL mode

### Layer 2: Cache Loader (`storageCache.ts`)

Pre-loads caches before React mounts:

1. Call `loadSessionFromSessionStorage()` (sync)
2. Call `loadGameState()` from IndexedDB (async)
3. Call `loadWifiConnected()`, `loadActiveMissionSeed()`, `loadPatches()`, `loadBrickedMachines()` (async)
4. Call `applyTheme()` to set CSS variables (prevents flash)
5. Mount React with initial state populated

### Layer 3: Contexts

Each context writes to storage on state changes:

- **SessionContext** — Writes session + WiFi to storage on every mutation
- **FileSystemContext** — Writes patches to IndexedDB after each write/create/delete
- **MissionProvider** — Writes mission seed to IndexedDB on start/abort/complete
- **useMissionState** — Persists active mission seed

### Storage Layout

| State                                        | Storage                        | Scope   |
| -------------------------------------------- | ------------------------------ | ------- |
| Session (user, machine, path, theme, stacks) | sessionStorage                 | Per-tab |
| WiFi connected                               | IndexedDB                      | Shared  |
| Mission seed                                 | IndexedDB                      | Shared  |
| Filesystem patches                           | IndexedDB                      | Shared  |
| Bricked machines                             | IndexedDB                      | Shared  |
| SSH keys (`~/.ssh_keys`)                     | Filesystem patches (IndexedDB) | Shared  |

### Patch-Based Persistence

Filesystem changes are stored as patches (diffs from base), not full snapshots. Each patch records:

- Machine ID (localhost, home network IP, mission IP, etc.)
- Path
- New content (or `null` for deletion)
- Owner
- Optional `isNew` flag (file didn't exist in base)

On init, patches are replayed in order via `applyPatches()`, reconstructing the current filesystem state. This approach is space-efficient and simplifies merging concurrent edits across machines.

### Mission Persistence

Active mission seed is stored in IndexedDB. On reload:

1. `useMissionState` reads the seed
2. `generateMissionNetwork(seed)` deterministically regenerates the full network
3. Cached mission patches are replayed on top

When a mission ends/transitions, mission patches are cleaned up.

### Permadeath Clears IndexedDB

`reset("confirm")` calls `clearAllData()`, which deletes all IndexedDB stores. This:

- Clears WiFi connection (forces re-crack)
- Clears mission seed (mission lost)
- Clears filesystem patches (localhost state reset, home networks reset)
- Clears bricked machines
- Leaves identity untouched (identity is in localStorage, separate from game state)
- Leaves theme choice untouched (stored in session, restored via sessionStorage)

## 7.12 Permadeath / New-Game Flow

When the player loses their workstation, they can either repair or start fresh.

### Permadeath Trigger

**Localhost bricked** — If the player deletes `/boot/vmlinuz` or `/boot/initrd.img` and reboots, the machine is permanently bricked. `Terminal.tsx` checks `isMachineBricked('localhost')` at the top of render. If true, it displays a frozen kernel panic screen with no input acceptance.

### Recovery Options

1. **Repair** — Not currently available in Phase 2. Phase 3 will allow admins to repair via privileged commands or server-side actions.
2. **Reset** — Type `reset confirm` (or explicit button in modal). This clears all IndexedDB, but:
   - **Identity preserved** — Ed25519 keypair in localStorage stays intact. The player's workstation ID suffix stays the same on the same LAN.
   - **Wallet lost** — Any wallet files in the filesystem are deleted (permadeath = financial loss).
   - **Session reset** — Current machine/user/path reset to localhost/player-username/home.
   - **WiFi reset** — Cracked WiFi networks are forgotten. Must re-crack.
   - **Missions aborted** — Active mission is cleared. Must accept a new seed.

### New-Game Intention

`reset confirm` is explicit and intentional — not accidentally triggered. A modal confirms the action before clearing. This makes permadeath a meaningful consequence.

### Identity Persistence

The player's Ed25519 identity is stored in `localStorage.jshack.identity`, NOT in IndexedDB. Even a full reset doesn't wipe identity. This allows:

- Same player reputation across resets (multiplayer messaging/darknet listings)
- Predictable workstation ID (identity-derived suffix stays the same)
- Cross-session key integrity (same keys for API requests)

To truly wipe identity, the player must clear browser `localStorage` manually via devtools. Identity reset is an explicit "new game" action.

## 7.13 Help / Man Pages

The terminal provides two commands for documentation:

### `help`

Lists all available commands grouped by category (General, Filesystem, Mission, Network, WiFi). All commands are visible; execution is gated by binary file permissions (`/bin/<cmd>`), so `help` may list commands the player can't yet run.

### `man <command>`

Displays detailed manual for a command in Unix man(1) style:

- NAME — Short description
- SYNOPSIS — Usage syntax
- DESCRIPTION — Detailed explanation
- ARGUMENTS — Argument descriptions + required/optional flags
- EXAMPLES — Usage examples

Commands must define a `manual` property on their `Command` type for detailed docs.

### Command Discovery

Tab completion and help are the same source: the command registry in `useCommands()`. No hidden commands.

## 7.14 Mission System OVERVIEW (Skim Only)

The mission system is the gameplay loop: browse contracts, accept missions (each is a seeded procedural network), hack the network, complete objectives, get paid.

This section is a brief overview. User intends to design fresh mission content in Phase 4+, so implementation details are deferred to `docs/mission-variations.md`.

### Mission Provider Hierarchy

```
SessionProvider
  → GameSession (generates localhost + home networks)
    → MissionProvider (manages active mission seed + state)
      → FileSystemProvider (merges mission filesystems)
        → NetworkProvider (merges mission network config)
          → Terminal
```

### 7.14.1 Darknet Marketplace

`missions()` displays the hardcoded mission board — a list of contracts with difficulty, objective type, and client info. Contracts are defined in `src/mission/missionBoard.ts` as a static array of objects with `title`, `description`, `seed`, `difficulty`, `objectiveType`, and `clientEmail`. New missions are added by editing this file (future: dynamic darknet server).

### 7.14.2 Contract Lifecycle

1. **Browse** — `missions()` lists all available contracts
2. **Accept** — `accept("SEED")` generates the `MissionNetwork` deterministically and calls `startMission()`:
   - `generateMissionNetwork(seed)` produces machines, network config, vulnerabilities, filesystems
   - Mission filesystems are merged into `FileSystemProvider`
   - Mission network config is merged into `NetworkProvider`
   - Router machine is added to the network for SSH/nmap/etc.
3. **Hack** — Player uses existing commands (ssh, ftp, nc, curl, nmap, exploit) to infiltrate the network
4. **Complete** — Player sends proof to client via `mail(client_email, proof)`:
   - Command validates proof against objective type
   - On success, calls `completeMission()`, which clears mission state
5. **Abort** — Type `abort()` to quit. Calls `abortMission()`, which:
   - Clears mission state
   - Pops all SSH sessions (returns to localhost)
   - Removes mission filesystems + network config

### 7.14.3 Mission Instances (Per-Acceptance, Permanent, Shareable)

Each `accept(seed)` creates a new mission instance from the seed. The instance is:

- **Persistent** — Persisted to IndexedDB (seed + patches)
- **Per-acceptance** — Same seed accepted twice = two separate instances (not merged)
- **Shareable** — On multiplayer LANs, the instance can be accessed/hacked by other players (future feature, blocked on `mission_instances` table)

Decided 2026-04-23: instances are permanent + shareable + unrestricted (completed, aborted, and post-permadeath all persist). Public IP is the instance key; visiting ≠ accepting.

### 7.14.4 Generation Axes (High Level)

The seeded generator controls (full catalog in `docs/mission-variations.md`):

1. **Difficulty** (easy/medium/hard) — Network depth via isolated subnet layers
2. **Entry variant** (ssh/ftp/nc/exploit/http/snmp) — How to gain initial access
3. **Network mode** (forwarded/router-first) — Port forwarding or gateway hacking
4. **Objective type** (exfiltrate/tamper/credential_theft/sabotage/backdoor/portforward/script_fix/forensics/malware) — What to accomplish
5. **Domain entry** — Domain-based briefing (forces nslookup)
6. **Encryption** — Target file encrypted (requires key discovery)
7. **Gateway type** — Managed switches with ACLs (vs NAT routers)
8. **Forced effect** — Specific vulnerability effect on target machine
9. **Forced tier** — Privilege level of forced effect (root/user/guest)

All axes can be controlled via seed keywords (case-insensitive substring match), e.g., `HEIST-ssh-forwarded-tamper-hard`, `BANK-JOB-nc-exfiltrate`. PRNG derivation falls back when no keyword is present.

## References

- `src/App.tsx` — App root, screen state machine
- `src/components/IntroScreen.tsx`, `BootScreen.tsx` — Intro/boot UI
- `src/session/SessionContext.tsx` — Session state + stack
- `src/session/gameTime.ts` — Game time model
- `src/game/gameSeed.ts`, `types.ts` — Seed generation + GameState type
- `src/network/wifiNetworks.ts`, `wifiTypes.ts` — WiFi definitions
- `src/commands/airmon.ts`, `airdump.ts`, `aircrack.ts` — WiFi hacking commands (legacy names)
- `src/theme/themes.ts`, `applyTheme.ts` — Theme system
- `src/utils/crossTabSync.ts` — BroadcastChannel sync
- `src/utils/storageCache.ts`, `storage.ts` — Persistence layer
- `src/mission/missionBoard.ts`, `MissionContext.tsx` — Mission system
- `src/commands/help.ts`, `man.ts` — Documentation commands
- `docs/mission-variations.md` — Mission generation axes catalog
