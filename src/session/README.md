# Session

Single source of truth for all terminal session state. Manages the current user, machine, working directory, and connection modes (SSH, FTP, NC).

## Files

| File                   | Description                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `SessionContext.tsx`   | React context with session state, connection stacks, persistence, and type guards  |
| `sessionUtils.ts`      | Pure functions: type guards, validators, normalizers, and default session constant |
| `sessionUtils.test.ts` | Unit tests for sessionUtils                                                        |
| `gameTime.ts`          | Real-world-clock game time model anchored at first game start via localStorage     |
| `gameTime.test.ts`     | Unit tests for gameTime                                                            |

## Session State

```typescript
type Session = {
  readonly username: string; // Current user (player-chosen, e.g., "jshacker")
  readonly userType: UserType; // 'root' | 'user' | 'guest'
  readonly machine: string; // Current machine (e.g., "localhost", "192.168.1.75")
  readonly hostname?: string; // Display name for prompt (e.g., "dist-rtr", "myworkstation")
  readonly currentPath: string; // Working directory (e.g., "/home/<username>")
  readonly theme: ThemeId; // Terminal color theme ('amber' | 'green' | 'cyan' | 'light')
};
```

Default session: `<username>@localhost:/home/<username>` (user type: `user`, theme: `amber`). Username is player-chosen via the intro screen.

The `hostname` field provides display names for the prompt (`session.hostname ?? session.machine`). On localhost, an effect syncs `workstationName` into `session.hostname`. On SSH'd machines, `setMachine(ip, hostname)` sets it from the remote machine's network config.

## Connection Modes

### Session Stack (SSH + su)

When SSH-ing into a remote machine, switching users via `su()`, or gaining a shell through an exploit, the current session is pushed onto a stack with a `reason` field (`'ssh'`, `'su'`, or `'exploit'`). `exit()` pops the stack to restore the previous session, showing context-appropriate messages ("Connection closed." for SSH, "logout" for su).

- `pushSession('ssh')` — save current state before SSH
- `pushSession('su')` — save current state before user switch
- `pushSession('exploit')` — save current state before exploit shell (e.g., msfconsole `shell_full` effect)
- `popSession()` — restore previous state on exit
- `canReturn()` — check if stack has entries
- Supports nested SSH (machine A -> B -> C) and mixed stacking (SSH -> su -> exit -> exit)

### FTP Mode

Tracks both local (origin) and remote machine state simultaneously:

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

- `enterFtpMode(session)` / `exitFtpMode()` — toggle FTP mode
- `updateFtpRemoteCwd(path)` / `updateFtpOriginCwd(path)` — navigate directories
- Prompt changes to `ftp>` when active

### NC Mode

Interactive shell access on remote services (backdoors):

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

- `enterNcMode(session)` / `exitNcMode()` — toggle NC mode
- `updateNcCwd(path)` — navigate directories
- Prompt changes to `$` when active

## Game Time

Real-world-clock time model for the defense treadmill (Phase 3). The game's CVE table has a `publishedAt` field on every entry measuring game days since `startedAt`; once game time passes that threshold, the CVE becomes "active" and can be exploited.

### API (`gameTime.ts`)

| Export                  | Description                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `MS_PER_DAY`            | Constant (`86400000`) — milliseconds in one day                                      |
| `initGameTimeIfUnset()` | Records anchor (`Date.now()`) in localStorage on first call; returns `startedAt`     |
| `readStartedAt()`       | Reads the stored anchor without side effects; returns `number \| null`               |
| `getGameTime()`         | Returns whole game days elapsed: `Math.floor((Date.now() - startedAt) / MS_PER_DAY)` |
| `resetGameTime()`       | Clears the anchor (called on permadeath / new game)                                  |

The anchor is stored in localStorage under `jshack_started_at`. `initGameTimeIfUnset()` is safe to call on every app startup — it only writes if no anchor exists yet.

**Offline accrual:** if the player leaves the game for a week, they return to a week's worth of newly-published CVEs. This matches how real system administration feels — patches pile up while you're away.

## Persistence

Session state uses a split storage model:

- **sessionStorage** (per-tab): Session (machine, username, userType, currentPath, theme), session stack (SSH history), FTP session, NC session. Each browser tab gets an independent session — new tabs start fresh at `localhost /home/<username>`.
- **IndexedDB** (shared): WiFi connection (`wifiConnected` key — stores `WifiConnection | null`, i.e., `{ essid, bssid }` or `null`), game state (`gameState` key — stores `{ seed, workstationName, username, rootPassword }`). Shared across all tabs so cracking WiFi in one tab enables network access everywhere. WiFi state is a standalone `useState<WifiConnection | null>` in `SessionProvider`, not part of the `Session` type. `wifiConnected` boolean is derived as `connectedWifi !== null`.

Validated with type guards on restore. Falls back to defaults if invalid or corrupted.

## Context API

`useSession()` provides:

| Method                      | Description                                                        |
| --------------------------- | ------------------------------------------------------------------ |
| `session`                   | Current session state (per-tab)                                    |
| `connectedWifi`             | `WifiConnection \| null` — which WiFi network (shared)             |
| `wifiConnected`             | Derived boolean (`connectedWifi !== null`)                         |
| `setUsername(name, type)`   | Change current user                                                |
| `setMachine(ip, hostname?)` | Change current machine and optional display hostname               |
| `setCurrentPath(path)`      | Change working directory                                           |
| `getPrompt()`               | Formatted prompt (`user@workstation>`, `user@ip>`, `ftp>`, or `$`) |
| `pushSession(reason)`       | Save session to stack (before SSH, su, or exploit)                 |
| `popSession()`              | Restore previous session (on exit)                                 |
| `popAllSessions()`          | Reset to bottom of stack (mission abort)                           |
| `canReturn()`               | Check if session stack has entries                                 |
| `enterFtpMode(session)`     | Enter FTP mode                                                     |
| `exitFtpMode()`             | Exit FTP mode                                                      |
| `enterNcMode(session)`      | Enter NC mode                                                      |
| `exitNcMode()`              | Exit NC mode                                                       |
| `setWifiConnected(conn)`    | Set WiFi connection (`WifiConnection \| null`)                     |
| `disconnectWifi()`          | Disconnect WiFi and reset to localhost (preserves theme)           |
| `setTheme(themeId)`         | Switch terminal color theme (persists across sessions)             |
