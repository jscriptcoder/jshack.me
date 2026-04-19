# Terminal

The main UI component — a retro CRT terminal that orchestrates command execution, output rendering, input handling, and connection mode switching. Colors are driven by CSS custom properties (`--theme-*`) set by the active theme (amber, green, cyan, or light).

## Files

| File                 | Description                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Terminal.tsx`       | Main orchestrator — manages input state, command execution, async output streaming, password/FTP/NC mode switching, editor overlay, and output line management |
| `TerminalInput.tsx`  | Input line with prompt (`user@machine>`), cursor, key handlers (Enter, ArrowUp/Down, Tab), password masking                                                    |
| `TerminalOutput.tsx` | Renders output lines: banners, commands, results, errors, and the author profile card                                                                          |
| `NanoEditor.tsx`     | Full-screen nano-style text editor overlay with save/exit, cursor tracking, and exit prompt for unsaved changes                                                |
| `types.ts`           | All shared types: `Command`, `OutputLine`, `AsyncOutput`, `SpecialOutput` discriminated union, type guards                                                     |
| `index.ts`           | Module export                                                                                                                                                  |

## Command Execution Flow

```
User types input
    │
    ▼
Terminal.tsx executeCommand()
    │
    ├── Redis / MySQL mode? → raw input to mode executor
    │
    └── Shell pipeline
        └── tokenize → parse → execute (src/shell/)
            │   ├── pipes: stage stdout → next stage's ShellContext.stdin
            │   └── redirect `>`: final output written via redirectWriter
            │
            ├── Returns string → display as result
            ├── Returns { __type: 'author' } → render AuthorCard
            ├── Returns { __type: 'clear' } → clear output lines
            ├── Returns { __type: 'password_prompt' } → enter password mode
            ├── Returns { __type: 'async' } → stream output with delays
            ├── Returns { __type: 'ssh_prompt' } → async then password prompt
            ├── Returns { __type: 'ftp_prompt' } → switch to FTP commands
            ├── Returns { __type: 'nc_prompt' } → switch to NC commands
            ├── Returns { __type: 'nano_open' } → open NanoEditor overlay
            ├── Returns { __type: 'exit' } → pop session stack
            └── Throws Error → display as error
```

## Special Output Types (`__type` discriminated union)

| Type              | Trigger                | Behavior                                                          |
| ----------------- | ---------------------- | ----------------------------------------------------------------- |
| `author`          | `author()`             | Renders profile card with avatar, bio, links                      |
| `clear`           | `clear()`              | Clears all output lines                                           |
| `password_prompt` | `su(user)`             | Hides prompt, masks input with `*`                                |
| `ssh_prompt`      | `ssh("user@host")`     | After async delay, enters password mode for SSH                   |
| `ftp_prompt`      | `ftp(host)`            | After auth, switches to FTP command set                           |
| `ftp_quit`        | `quit()`/`bye()`       | Exits FTP mode, restores normal commands                          |
| `nc_prompt`       | `nc(host, port)`       | Switches to NC command set with `$` prompt                        |
| `nc_quit`         | `exit()` in NC         | Exits NC mode, restores normal commands                           |
| `nano_open`       | `nano(path)`           | Opens NanoEditor overlay with file content for editing            |
| `exit`            | `exit()`               | Pops session stack, returns to previous machine                   |
| `async`           | ping, nmap, curl, etc. | Streams lines via `onLine()`, disables input until `onComplete()` |

## Components

### Terminal (orchestrator)

- Holds all state: output lines, input value, mode flags (password, FTP username, async running), editor state
- Wires hooks together: `useCommands`, `useFtpCommands`, `useNcCommands`, `useCommandHistory`, `useAuthentication`
- Shell pipeline + tab completion live in `src/shell/`
- Handles password validation (local `su` via `/etc/passwd`, remote SSH via machine users)
- Defines logging callbacks (`onSuAuth`, `onSshAuth`, `onFtpAuth`) that write auth events to target machine log files (`/var/log/auth.log`, `/var/log/vsftpd.log`) via `src/logging/`
- Manages NanoEditor overlay lifecycle (open on `nano_open`, close on editor exit)
- Shows ASCII banner on startup
- Scans command output for mission flag — triggers completion banner when detected

### TerminalInput

- Renders prompt from `useSession().getPrompt()`
- Prompt modes: normal (`user@machine>`), FTP (`ftp>`), NC (`$`), hidden (password/username)
- Password mode: masks input with `*`, disables history/tab
- Blinking cursor animation
- Key bindings: Enter (submit), ArrowUp/Down (history), Tab (autocomplete), Ctrl+C (cancel async)

### TerminalOutput

- Renders each `OutputLine` by type:
  - `banner` — theme bright text, preserves whitespace
  - `command` — theme bright text with dim prompt prefix
  - `result` — theme text, indented
  - `error` — theme error color, indented
  - `author` — `AuthorCard` component with avatar, paragraphs, links
- All colors use CSS custom properties (`var(--theme-*)`) for theme support
- Auto-scrolls to bottom on new output

### NanoEditor

- Full-screen fixed overlay (`z-50`) covering entire viewport, styled with theme CSS variables
- Layout: title bar (inverted accent), textarea editor, status bar, help bar
- Title bar shows `GNU nano 7.2`, file path, and "Modified" indicator
- **Ctrl+S** — saves via `onSave` (existing file) or `onCreate` (new file), tracks `fileCreated` state
- **Ctrl+X / Escape** — exits immediately if unmodified; shows "Save modified buffer?" prompt if modified
- **Tab** — inserts 2 spaces at cursor (prevents default tab behavior)
- Exit prompt accepts **Y** (save + close), **N** (discard + close), **C** (cancel back to editing)
- Status bar: cursor position (Ln/Col), save confirmation, error messages (auto-clear after 3s)
- Uses `useLayoutEffect` to restore cursor position after Tab insertion updates content
