# Hooks

Custom React hooks that wire together commands, context, and terminal features. These are the glue between the UI (Terminal component) and the domain logic (commands, filesystem, network, session).

## Files

| File                           | Description                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useCommands.ts`               | Master command registry — combines all command sources into a single execution context and command name list                                                  |
| `useFileSystemCommands.ts`     | Creates filesystem commands (pwd, ls, cd, cat, whoami, gpg, output, strings, nano) with context from `useFileSystem` and `useSession`                         |
| `useNetworkCommands.ts`        | Creates network commands (ifconfig, ping, nmap, nslookup, ssh, curl, ftp, nc, exploit, gobuster) with context from `useNetwork` and `useFileSystem`           |
| `useFtpCommands.ts`            | Creates FTP-mode commands (pwd, lpwd, cd, lcd, ls, lls, get, put, quit/bye) — returns `null` when not in FTP mode                                             |
| `useNcCommands.ts`             | Creates NC-mode commands (pwd, cd, ls, cat, whoami, help, exit) — returns `null` when not in NC mode                                                          |
| `useWifiCommands.ts`           | Creates WiFi commands (airmon, airdump, aircrack, nmcli) — manages monitor mode state via `useRef`                                                            |
| `useCommandHistory.ts`         | Up/down arrow navigation through previous commands                                                                                                            |
| `useAutoComplete.ts`           | Tab completion for command names and variable names                                                                                                           |
| `usePathAutoComplete.ts`       | Tab completion for file/directory paths inside string arguments — resolves paths via filesystem context                                                       |
| `usePathCompletionAdapters.ts` | Adapts filesystem APIs for NC/FTP mode path completion — wraps three `usePathAutoComplete` instances (default, FTP remote, FTP local) with mode-aware routing |
| `useAuthentication.ts`         | Password/SSH/FTP/su authentication state and logic — manages password prompts, credential validation, and session transitions on successful login             |
| `useVariables.ts`              | `const`/`let` variable declarations, reassignment, and immutability enforcement                                                                               |

## How Commands Are Assembled

`useCommands` is the top-level hook consumed by `Terminal.tsx`. It merges commands from multiple sources:

```
useCommands()
├── Static commands (echo, author, clear, exit, resolve)
├── theme (uses setTheme from session context — unrestricted, guest-accessible)
├── node (lazy getter for execution context — needs access to all commands including itself)
├── Mission commands (missions, accept, abort, mail — uses useMission() context)
├── apt (package manager — install tools on remote machines)
├── useFileSystemCommands() → pwd, ls, cd, cat, whoami, gpg, output, strings, nano, john
├── useNetworkCommands()    → ifconfig, ping, nmap, nslookup, ssh, curl, ftp, nc, exploit, gobuster
├── useWifiCommands()       → airmon, airdump, aircrack, nmcli
├── su (depends on current machine's user list)
└── help, man (created last, with access to all commands above)
```

After assembly, all non-builtin/non-game commands are wrapped with a unified access check (from `availability.ts`):

- `wrapWithAccessCheck` checks binary existence + execute permissions at execution time
- Binary missing → `"command not found"` (with apt install hint for apt-installable tools)
- Binary exists but no execute permission → `"Permission denied"`
- All commands are visible to all users — no user-type filtering for tab autocomplete or `help()`
- `man()` receives all commands regardless

Returns `{ executionContext, commandNames }` where:

- `executionContext` — `Record<string, Function>` injected into `new Function()` for evaluation (with restrictions applied)
- `commandNames` — list of accessible names for tab autocompletion

## Mode-Specific Hooks

`useFtpCommands` and `useNcCommands` return `Map<string, Command> | null`. When active (non-null), `Terminal.tsx` swaps out the normal command set for the mode-specific one.

## Input Hooks

| Hook                        | Used By                        | Description                                                                                                           |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `useCommandHistory`         | `Terminal.tsx`                 | Tracks command history array and current index; `navigateUp()`/`navigateDown()` return the command string             |
| `useAutoComplete`           | `Terminal.tsx`                 | Takes command names + variable names; `getCompletions(input)` returns matches with display text                       |
| `usePathAutoComplete`       | `usePathCompletionAdapters.ts` | Takes filesystem helpers; `getPathCompletions(input, cursorPosition)` returns path matches when cursor is in a string |
| `usePathCompletionAdapters` | `Terminal.tsx`                 | Mode-aware path completion — routes to NC/FTP/default `usePathAutoComplete` instance based on active mode             |
| `useVariables`              | `Terminal.tsx`                 | Intercepts `const`/`let`/reassignment before command execution; manages variable store with immutability checks       |

## Authentication Hook

| Hook                | Used By        | Description                                                                                                    |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `useAuthentication` | `Terminal.tsx` | Manages password prompt state (su/SSH/FTP), credential validation, and session transitions on successful login |

`useAuthentication` encapsulates four authentication flows:

- **su** — validates password against `/etc/passwd` hashes on the current machine, switches user type
- **SSH** — validates against remote machine user list, pushes session stack, resolves NAT, switches to remote machine. Saves SSH key on success; auto-authenticates on subsequent connections.
- **SCP** — validates against remote machine user list, triggers file transfer. Saves SSH key on success; auto-authenticates on subsequent connections.
- **FTP** — two-stage login (username → password), validates against remote machine, enters FTP mode session

**SSH key persistence**: After first successful SSH/SCP password auth, saves `user@ip` to `~/.ssh_keys` on the source machine. On subsequent connections, `hasAuthorizedKey()` checks for a match and skips the password prompt. The `connectSsh()` helper extracts the shared session setup logic used by both auto-auth and password-auth paths.

Returns `startPasswordPrompt()`, `startSshPrompt()`, `startFtpPrompt()`, `startScpPrompt()` for triggering prompts, and `handlePasswordSubmit()`, `handleFtpUsernameSubmit()` for processing input. `startSshPrompt` and `startScpPrompt` check for saved keys and auto-authenticate when found. Terminal.tsx passes the current `input` and a `clearInput` callback to the submit handlers.
