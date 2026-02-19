# Session

Single source of truth for all terminal session state. Manages the current user, machine, working directory, and connection modes (SSH, FTP, NC).

## Files

| File                 | Description                                                                       |
| -------------------- | --------------------------------------------------------------------------------- |
| `SessionContext.tsx` | React context with session state, connection stacks, persistence, and type guards |

## Session State

```typescript
type Session = {
  readonly username: string; // Current user (e.g., "jshacker")
  readonly userType: UserType; // 'root' | 'user' | 'guest'
  readonly machine: string; // Current machine (e.g., "localhost", "192.168.1.75")
  readonly currentPath: string; // Working directory (e.g., "/home/jshacker")
  readonly wifiConnected: boolean; // WiFi connection state (localhost only)
  readonly theme: ThemeId; // Terminal color theme ('amber' | 'green' | 'cyan' | 'light')
};
```

Default session: `jshacker@localhost:/home/jshacker` (user type: `user`, theme: `amber`).

## Connection Modes

### SSH — Session Stack

When SSH-ing into a remote machine, the current session is pushed onto a stack. `exit()` pops the stack to restore the previous session.

- `pushSession()` — save current state before SSH
- `popSession()` — restore previous state on exit
- `canReturn()` — check if stack has entries
- Supports nested SSH (machine A -> B -> C)

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

All session state is persisted to IndexedDB (`jshack-db` database, `session` store):

- Session (machine, username, userType, currentPath, wifiConnected, theme)
- Session stack (SSH history)
- FTP session (if active)
- NC session (if active)

Validated with type guards on restore. Falls back to defaults if invalid or corrupted.

## Context API

`useSession()` provides:

| Method                    | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `session`                 | Current session state                                     |
| `setUsername(name, type)` | Change current user                                       |
| `setMachine(name)`        | Change current machine                                    |
| `setCurrentPath(path)`    | Change working directory                                  |
| `getPrompt()`             | Formatted prompt string (`user@machine>`, `ftp>`, or `$`) |
| `pushSession()`           | Save session to stack (before SSH)                        |
| `popSession()`            | Restore previous session (on exit)                        |
| `popAllSessions()`        | Reset to bottom of stack (mission abort)                  |
| `canReturn()`             | Check if session stack has entries                        |
| `enterFtpMode(session)`   | Enter FTP mode                                            |
| `exitFtpMode()`           | Exit FTP mode                                             |
| `enterNcMode(session)`    | Enter NC mode                                             |
| `exitNcMode()`            | Exit NC mode                                              |
| `setWifiConnected(bool)`  | Set WiFi connection state                                 |
| `disconnectWifi()`        | Disconnect WiFi and reset to localhost (preserves theme)  |
| `setTheme(themeId)`       | Switch terminal color theme (persists across sessions)    |
