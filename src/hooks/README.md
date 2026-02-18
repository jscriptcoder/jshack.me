# Hooks

Custom React hooks that wire together commands, context, and terminal features. These are the glue between the UI (Terminal component) and the domain logic (commands, filesystem, network, session).

## Files

| File                       | Description                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `useCommands.ts`           | Master command registry — combines all command sources into a single execution context and command name list                              |
| `useFileSystemCommands.ts` | Creates filesystem commands (pwd, ls, cd, cat, whoami, decrypt, output, strings, nano) with context from `useFileSystem` and `useSession` |
| `useNetworkCommands.ts`    | Creates network commands (ifconfig, ping, nmap, nslookup, ssh, curl, ftp, nc) with context from `useNetwork` and `useFileSystem`          |
| `useFtpCommands.ts`        | Creates FTP-mode commands (pwd, lpwd, cd, lcd, ls, lls, get, put, quit/bye) — returns `null` when not in FTP mode                         |
| `useNcCommands.ts`         | Creates NC-mode commands (pwd, cd, ls, cat, whoami, help, exit) — returns `null` when not in NC mode                                      |
| `useWifiCommands.ts`       | Creates WiFi commands (airmon, airdump, aircrack, nmcli) — manages monitor mode state via `useRef`                                        |
| `useCommandHistory.ts`     | Up/down arrow navigation through previous commands                                                                                        |
| `useAutoComplete.ts`       | Tab completion for command names and variable names                                                                                       |
| `usePathAutoComplete.ts`   | Tab completion for file/directory paths inside string arguments — resolves paths via filesystem context                                   |
| `useVariables.ts`          | `const`/`let` variable declarations, reassignment, and immutability enforcement                                                           |

## How Commands Are Assembled

`useCommands` is the top-level hook consumed by `Terminal.tsx`. It merges commands from multiple sources:

```
useCommands()
├── Static commands (echo, author, clear, exit, resolve)
├── theme (uses setTheme from session context — unrestricted, guest-accessible)
├── node (lazy getter for execution context — needs access to all commands including itself)
├── useFileSystemCommands() → pwd, ls, cd, cat, whoami, decrypt, output, strings, nano
├── useNetworkCommands()    → ifconfig, ping, nmap, nslookup, ssh, curl, ftp, nc
├── useWifiCommands()       → airmon, airdump, aircrack, nmcli
├── su (depends on current machine's user list)
└── help, man (created last, with access to all commands above)
```

After assembly, commands are filtered through `permissions.ts`:

- Restricted commands get their `fn` wrapped with a permission check (throws `permission denied` error)
- `commandNames` is filtered to only accessible commands (for tab autocomplete)
- `help()` receives only accessible commands; `man()` receives all commands

Returns `{ executionContext, commandNames }` where:

- `executionContext` — `Record<string, Function>` injected into `new Function()` for evaluation (with restrictions applied)
- `commandNames` — list of accessible names for tab autocompletion

## Mode-Specific Hooks

`useFtpCommands` and `useNcCommands` return `Map<string, Command> | null`. When active (non-null), `Terminal.tsx` swaps out the normal command set for the mode-specific one.

## Input Hooks

| Hook                  | Used By        | Description                                                                                                           |
| --------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `useCommandHistory`   | `Terminal.tsx` | Tracks command history array and current index; `navigateUp()`/`navigateDown()` return the command string             |
| `useAutoComplete`     | `Terminal.tsx` | Takes command names + variable names; `getCompletions(input)` returns matches with display text                       |
| `usePathAutoComplete` | `Terminal.tsx` | Takes filesystem helpers; `getPathCompletions(input, cursorPosition)` returns path matches when cursor is in a string |
| `useVariables`        | `Terminal.tsx` | Intercepts `const`/`let`/reassignment before command execution; manages variable store with immutability checks       |
