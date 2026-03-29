# Session

Single source of truth for all terminal session state. Manages the current user, machine, working directory, and connection modes (SSH, FTP, NC).

## Files

| File                   | Description                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `SessionContext.tsx`   | React context with session state, connection stacks, persistence, and type guards  |
| `sessionUtils.ts`      | Pure functions: type guards, validators, normalizers, and default session constant |
| `sessionUtils.test.ts` | Unit tests for sessionUtils                                                        |

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

When SSH-ing into a remote machine or switching users via `su()`, the current session is pushed onto a stack with a `reason` field (`'ssh'` or `'su'`). `exit()` pops the stack to restore the previous session, showing context-appropriate messages ("Connection closed." for SSH, "logout" for su).

- `pushSession('ssh')` — save current state before SSH
- `pushSession('su')` — save current state before user switch
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
| `pushSession(reason)`       | Save session to stack (before SSH or su)                           |
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
