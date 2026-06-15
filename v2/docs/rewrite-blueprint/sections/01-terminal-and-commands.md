# 1. Terminal & Commands

This section documents the user-facing CLI layer of jshack.me: the terminal UI, shell parser, command registry, scripting runtime, and special modes (nano, lynx, nc, FTP, MySQL, Redis). A fresh engineer should be able to re-implement every behavior from this document.

## 1.1 Terminal UI

### Core Components

**Terminal.tsx** (src/components/Terminal/Terminal.tsx): main orchestrator

- Manages input state: `input` (string), `asyncRunning` (bool), `editorState` (nano), `lynxState` (lynx)
- Manages output: `lines` (array of OutputLine), auto-scroll on new output
- Command execution pipeline: tokenize -> parse -> execute via `src/shell/`
- Mode switching: normal -> password prompt -> FTP mode -> NC mode -> MySQL mode -> Redis mode
- Async streaming with cancellation: stores `asyncCancelRef` and calls `.cancel()` on Ctrl+C
- Editor & browser overlays: NanoEditor and LynxBrowser as fixed z-50 overlays
- Prompts and auth handling: password mask, FTP username/password two-stage, SSH key auto-auth
- Logging callbacks: `onSuAuth`, `onSshAuth`, `onFtpAuth` write to target machine log files

**TerminalInput.tsx** (src/components/Terminal/TerminalInput.tsx): input line

- Prompt: `user@machine>` (normal), hidden (password/username), `ftp>` (FTP), `$` (NC), `mysql>` (MySQL), `redis>` (Redis)
- Rendering: prompt (dim), input (bright), cursor (theme caret color)
- Password mode: `type="password"` input, masks with `*`
- Keyboard bindings:
  - **Enter**: calls `onSubmit()` (executes command)
  - **ArrowUp**: calls `onHistoryUp()` (navigate history backward)
  - **ArrowDown**: calls `onHistoryDown()` (navigate history forward)
  - **Tab**: calls `onTab(cursorPosition)` for autocomplete
  - Disabled in password/username mode (no history, no tab)
- Cursor positioning: programmatic changes reset cursor to end via `useEffect`
- Text input: `isUserInput` ref tracks whether change is user-typed or programmatic

**TerminalOutput.tsx** (src/components/Terminal/TerminalOutput.tsx): output rendering

- Line types: `banner`, `command`, `result`, `error`, `author`
- All colors use CSS custom properties (`var(--theme-*)`) for theme switching
- Auto-scroll on new lines

**NanoEditor.tsx** (src/components/Terminal/NanoEditor.tsx): text editor overlay

- Layout: title bar, textarea, status bar, help bar
- Title: `GNU nano 7.2 [filename] [Modified]`
- Full-screen overlay: `fixed z-50`, dark background, theme colors
- **Ctrl+S**: saves via `onSave()` (existing) or `onCreate()` (new file)
- **Ctrl+X** or **Escape**: exits if unmodified; prompts if modified
- **Tab**: inserts 2 spaces at cursor
- Exit prompt: **Y** (save+close), **N** (discard+close), **C** (cancel)
- Status bar: cursor position, messages (auto-clear 3s)

**LynxBrowser.tsx** (src/components/Terminal/LynxBrowser.tsx): text-mode browser overlay

- Layout: title bar (page title + URL), scrollable body, status bar, help bar
- Fetch lifecycle: injected `onFetch(url)` callback (wired to use same NAT/logging as `curl`)
- HTML parsing: semantic markup via `renderHtml`, keeps multi-word link text atomic
- History stack: caches `{ url, response, rendered }` per page; Back is instant
- **ArrowUp/Down**: move cursor, **Enter/Right**: follow, **Left/Backspace**: back, **q/Escape**: quit

## 1.2 Shell Parser

The shell parser lives in `src/shell/` and handles tokenization, quoting, pipes, redirects, execution.

### Tokenization (tokenize.ts)

```
Token = {word, value} | {pipe} | {redirect}
```

Features:

- Single quotes: 'literal' (no escaping)
- Double quotes: "quoted" (supports `\"` and `\` escapes only)
- Backslash escapes: outside quotes, `\<char>` becomes `<char>`
- Pipes: `|` separates stages
- Redirect: `>` writes output to file
- Whitespace: spaces and tabs are boundaries

### Parsing (parse.ts)

```
Stage = {command: string, args: string[]}
Pipeline = {stages: Stage[], redirect?: {path: string}}
```

Features:

- Extracts redirect (trailing `> <path>`) - only legal at end
- Splits pipes, validates no empty groups
- Builds stages: first word is command, rest are args

### Execution (execute.ts)

```
execute(pipeline, registry, options) -> unknown
```

Flow:

1. For each intermediate stage, run and collect output as string
2. Async intermediate stages: collected synchronously (must complete immediately)
3. Pass string output as stdin to next stage (via ShellContext)
4. Run final stage, optionally feeding stdin
5. If redirect, write output via RedirectWriter callback
6. Return final result or undefined (if redirect)

Stdin passing: If command implements `fnShell(ctx, ...args)`, it receives stdin. Otherwise falls back to `fn(...args)`.

## 1.4 Scripting

node <file>.js execution:

Sync mode: Uses new Function constructor
Async mode: Uses AsyncFunction constructor, enables await

Execution context: All commands + writeFile() helper

writeFile(path, content): Write file with current user permissions

- string: written as-is
- string[]: joined with newline
- Objects: pretty-printed JSON
- Respects user write permissions

## 1.5 Hooks

useCommands: Top-level hook returning { commands, commandNames, lynxFetch }

useFtpCommands, useNcCommands, useMysqlCommands, useRedisCommands: Mode-specific, return null when inactive

useCommandHistory: Up/down navigation

useAuthentication: Password prompt state management

## 1.6 Special Modes

NC Mode: nc <host> <port> - read-only shell (pwd, cd, ls, cat, whoami, help, exit)

FTP Mode: ftp <host> - file transfer (pwd, lpwd, cd, lcd, ls, lls, get, put, quit)

MySQL Mode: mysql <host> <user> - SQL execution (SHOW TABLES, SELECT, UPDATE, DELETE, etc.)

Redis Mode: rediscli <host> - key-value commands (KEYS, GET, SET, DEL, etc.)

Nano Editor: nano <path> - text editor overlay with Ctrl+S save, Ctrl+X exit

Lynx Browser: lynx <url> - text browser with arrow key navigation

## 1.7 Tab Completion

classifyCursor: Determines if completion is for command, path, or flag

Completion algorithm:

- Commands: prefix match, longest common prefix, trailing space
- Paths: split dir+prefix, list+filter, common prefix, trailing slash
- Handles quotes and escapes

---

End of Section 1: Terminal & Commands

Comprehensive catalog of every command, parser feature, UI component, and execution mode.
For re-implementation, follow this structure and refer to file paths for original source.
All behavior is deterministic and reproducible from this specification.
