# Shell-Style Input Parser

## Problem

Interactive terminal input is parsed as **JavaScript** via `new Function(...contextKeys, 'return ${input}')` (`src/components/Terminal/Terminal.tsx:326`). Players must type `nmap('10.10.10.10', '-sV')` instead of the authentic `nmap 10.10.10.10 -sV`. This is a significant friction point for adoption — players familiar with Linux expect shell syntax.

Goal: replace the interactive execution pipeline with a **shell parser** (tokenize → AST → execute) that supports commands, quoted strings, flags, pipes (`|`), and output redirect (`>`). Commands remain plain functions underneath — only the input layer changes.

## Out of scope

- **Scripts** — `.js` scripts continue to use the existing JS execution path and function-call syntax (`nmap('10.10.10.10')`). Only interactive input changes.
- **Env vars** (`$VAR`, `$?`, `$HOME`) — deferred. Scripts still use `let`/`const` for variables.
- **Shell-level glob expansion** (`cat *.txt` → `cat a.txt b.txt`). `find` / `grep` keep their internal glob-pattern args as today (matches real bash with quoted patterns).
- **Command substitution** `$(...)`, **heredocs**, **background jobs** `&`, **subshells** `(...)`, **logical operators** `&&` / `||`. Explicitly deferred.
- **Mode-specific parsers** — Redis, MySQL, FTP, NC modes keep their current raw-input paths. Shell parser only runs in normal terminal mode.
- **Backward compatibility** — per project memory, no live players. Old JS-eval path and `output` command are deleted in the cutover commit, not preserved.

## Approach

New module `src/shell/` contains the full shell pipeline. Interactive path in `Terminal.tsx` calls into it. Scripts keep their current JS path untouched.

```
src/shell/
  tokenize.ts      // "grep foo | cat > out.txt" → Token[]
  parse.ts         // Token[] → Pipeline AST
  execute.ts       // AST → runs commands, wires stdin/stdout, handles `>`
  complete.ts      // tab completion driven by tokenizer
  types.ts         // Token, AST, ShellContext types
```

### Tokenizer

Input: raw string. Output: `Token[]` where each token is `{ kind: 'word' | 'pipe' | 'redirect', value: string }`.

Rules:

- Whitespace separates words
- Single quotes `'…'` and double quotes `"…"` produce one literal token (no interpolation in Phase A)
- Backslash `\` escapes the next character
- `|` and `>` are their own tokens
- Unterminated quotes are a parse error

### Parser

Input: `Token[]`. Output: AST.

```ts
type Pipeline = {
  readonly stages: readonly Stage[]; // [cmd1, cmd2, cmd3] for a | b | c
  readonly redirect?: { path: string }; // > out.txt on last stage only
};
type Stage = {
  readonly command: string; // first word
  readonly args: readonly string[]; // remaining words
};
```

Errors: redirect not on last stage, empty stage between pipes, redirect missing target.

### Executor

Walks the pipeline left-to-right:

1. First stage runs with no stdin
2. Each subsequent stage runs with the previous stage's stdout as `context.stdin`
3. If `redirect` is set, the final stage's stdout is written to the target file via the existing filesystem write path (reusing the logic from today's `output` command)
4. Async commands: collect all streamed lines via `AsyncOutput.start(...)` into a single string before passing to next stage (same pattern as `output.ts:15-22`)

Command contract additions:

- `ShellContext` grows one optional field: `stdin?: string`
- Consumer commands (`grep`, and future `head`/`tail`/`wc`/`sort`/`uniq`) read `context.stdin` when they have no file args
- Producer-only commands (`nmap`, `ls`, `cat`, `find`, etc.) ignore `stdin` — no changes needed

### Tab completion

Rewrite `handleTab` in `Terminal.tsx:590`:

- Tokenize input up to cursor
- If cursor is in the first token of a stage (right after `|` or start of line) → command-name completion
- Otherwise → path completion on the current token (no more "detect string literal" logic)
- Flag completion: if current token starts with `-` and we're past the command token, complete against `command.manual.arguments` names

Reuse existing `getPathCompletions` / `getCompletions` internals, but drive them from tokenizer output instead of regex string-literal detection.

## Work breakdown

All phases TDD — red, green, refactor.

### Phase A — Shell foundation (no pipes, no redirect)

1. `tokenize.ts` + tests — words, quoting (single/double), escaping, `|` and `>` recognition, unterminated quote error
2. `parse.ts` + tests — single command with args, reject `|` and `>` in this phase (placeholder errors), empty input
3. `execute.ts` + tests — dispatch single command to registry, wrap existing `fn(...args)` contract, handle async commands
4. Wire `Terminal.tsx` to use shell executor for non-Redis/MySQL/FTP/NC mode. Clean cutover — remove the JS-eval interactive path in the same step (we have 46 tests + manual verification; no live players per project memory).

**Acceptance:** `nmap 10.10.10.10 -sV` works in the terminal. Still no pipes, no redirect.

### Phase B — Pipes (Hybrid shell-context opt-in)

**Design decision (locked):** hybrid opt-in, not a full signature refactor. Command type gains an optional second method:

```ts
readonly fn: (...args: unknown[]) => unknown;                             // unchanged
readonly fnShell?: (ctx: ShellContext, ...args: unknown[]) => unknown;    // opt-in
```

Executor prefers `fnShell` when shell context is provided (pipe stdin) and the command defines it. Scripts, 58/60 producer-only commands, and their tests stay untouched. Future shell features (env vars, stderr, signals) extend `ShellContext` — zero churn to non-shell-aware commands.

1. Add `ShellContext` type in `src/shell/types.ts` with `stdin?: string`
2. Add optional `fnShell` to `Command` type
3. Extend parser to accept `|` and produce multi-stage pipelines
4. Extend executor to chain stages: intermediate stage stdout → next stage `ctx.stdin`. Intermediate async outputs collected synchronously into a string; final stage passes through unchanged.
5. Update `grep.ts` with `fnShell` that reads `ctx.stdin` when no file arg is present. File-mode grep unchanged (`fn` still works standalone).
6. Integration tests: `cat /etc/passwd | grep root`, three-stage chains, async intermediate, fall-back to `fn` when command has no `fnShell`.

**Acceptance:** pipes work for `grep` end-to-end.

### Phase C — Redirect `>`

1. Parser accepts `>` as the trailing operator on the last stage with a path target. Bash-style errors for malformed cases (leading `>`, missing target, operator after target, redirect before a pipe).
2. Executor gains an `options.redirectWriter` hook. When a pipeline has a redirect AND a writer is provided, the executor writes the final stage's output through the writer. Missing writer with present redirect → error (hard contract).
3. **Async output tee-ing**: when the final stage is `AsyncOutput`, the executor returns a new `AsyncOutput` that streams lines live to the terminal AND collects them; on completion, the collected content is written to the file via the writer. Writer errors emit an inline bash-style error line. (This intentionally diverges from real bash, which would silence terminal output — game UX preference.)
4. Sync final stage: writer called synchronously with the string result, executor returns `undefined` (nothing rendered).
5. Terminal.tsx wires `redirectWriter` using `resolvePath` + `getNode` + `writeFile`/`createFile` + `session.userType`. Errors surface as `bash: <path>: <reason>`.
6. The existing `output` command stays until Phase F. Redirect and `output` coexist during intermediate phases.

**Acceptance:** `cat /etc/hosts > out.txt` works; `cat /etc/passwd | grep root > matches.txt` works; `ping 1.1.1.1 > ping.log` streams live to terminal while writing to file.

### Phase D — Tab completion rewrite

1. New `src/shell/complete.ts` — `classifyCursor(input, cursorPos)` returns `{kind, prefix, quoteChar, tokenStart, tokenEnd}` where kind is `command | path | flag | none`. `complete(input, cursorPos, adapter)` dispatches to source-specific logic (command registry / filesystem / manual.arguments) and returns a full `CompletionOutcome` with replacement + cursor position + match list.
2. `Terminal.tsx` wires a `shellCompleteAdapter` from the active command registry + filesystem + session user; `handleTab` replaces the old two-layer approach with a single `complete()` call.
3. Flag completion filters `command.manual.arguments[].name` to entries starting with `-`.
4. Path completion works for **unquoted tokens** (`cat /etc/pa<Tab>`) as well as quoted (`cat "/etc/pa<Tab>`) — fixes the shell-mode regression where the old string-literal detection only fired inside quotes.
5. Redirect targets (`... > out<Tab>`) complete as paths.
6. Deleted dead hooks: `useAutoComplete`, `usePathAutoComplete`, `usePathCompletionAdapters`, `useVariables` (all orphaned by Phases A–D).

**Acceptance:** `cat /etc/pa<Tab>` → `/etc/passwd` (no quotes needed); `nmap -s<Tab>` lists `-sU`, `-sV`; `ls | gr<Tab>` → `grep `; `cat /x > /tmp/o<Tab>` → `/tmp/out.txt`. Known limitation: FTP/NC path completion now uses the default filesystem, not the mode-specific one — Phase G addresses.

### Phase E — Flag audit + subcommand keyword completion

Two parallel extensions of the Phase D completer: backfill missing flag documentation, and add first-arg keyword completion for commands that dispatch on a subcommand token.

**Flag audit:**

1. For each command file, locate flag-handling logic (e.g., `args.includes('-l')`, `args.filter(a => a.startsWith('-'))`, switch on flag strings).
2. Confirm `manual.arguments` contains an entry for each flag. If missing, add `{ name: '-x', description: '...', required: false }`.
3. Unify existing quoted variants (e.g., `'"-l"'` — old JS-syntax artifact) to bare `-l`.

Scope: 4 commands needed entries added (`apt`, `curl`, `ls`, `rm`). `grep`, `nc`, `nmap` already had documented flags.

**Subcommand keyword completion:**

1. Extended `CommandArgument` with optional `values?: readonly string[]` for the discrete set of valid values at that arg slot.
2. Added `values` to the first `manual.arguments` entry of 4 commands: `apt` (install/list/upgrade), `systemctl` (start/stop/status), `nmcli` (connect/disconnect/status), `airmon` (start/stop).
3. Extended `complete.ts`: when the cursor is at positional arg 0 of a stage AND the prefix has no `/` AND the command's first non-flag argument has `values`, offer those keywords instead of path completion. Falls back to path when either condition fails.
4. `gobuster dir` and `dig axfr` left out — only one keyword each / non-arg-0 position.

**Out of scope:** synopsis/examples rewrite, deleting `output`, version bump, doc updates, free-form value completion (package names, hostnames, theme names, etc.).

**Acceptance:** `<cmd> -<Tab>` lists every flag the command actually supports. `apt <Tab>` → `install, list, upgrade`; `systemctl <Tab>` → keywords; etc. `npx tsc --noEmit` + `npm run test:run` green.

### Phase F — Manual rewrite + cleanup

1. **Rewrite every command's `manual.synopsis` and `manual.examples[].command`** from JS-call syntax to shell syntax across all ~60 command files. `man` renders these verbatim (`man.ts:5,23`), so they must match the new input style.
   - `synopsis: 'nmap(target, ...flags)'` → `synopsis: 'nmap <target> [flags...]'`
   - `{ command: 'nmap("192.168.1.1", "-sV")' }` → `{ command: 'nmap 192.168.1.1 -sV' }`
   - Audit tests that assert against synopsis/example strings and update.
2. **`output` becomes script-only**: remove from the shell command registry (not visible in `help`, tab completion, or interactively) but keep its `fn` injected into `executionContext` so scripts continue to call `output(cmd, path?)` unchanged. The `output.ts` file and tests stay. `>` replaces it interactively.
3. Update docs — `README.md`, `src/commands/README.md`, `.claude/docs/*` — use shell syntax for interactive examples. **Keep JS syntax only where the context is clearly about scripts** (scripts are unchanged).
4. Bump version in `package.json` + lockfile (feature change — per memory).
5. Full verification: `npm run build`, `npm run lint`, `npm run format`, `npm run test:run`.

**Acceptance:** every `man <cmd>` shows shell syntax, `output` gone from shell (but still works in scripts), version bumped, all checks green.

### Phase H — Scripting API refresh ✅ shipped

Replaced `output(cmd, path?)` + `resolve(promise)` with a single script-only helper:

- `writeFile(path, content)` — writes `content` to `path` under the current user's permissions. Strings pass through; arrays of strings are joined with `\n`; other values go through `stringify()`. Permission errors surface as `writeFile: <reason>`. Lives in `src/scripting/` and is injected into `executionContext`; never appears in the shell command registry.

`capture(asyncCmd)` was dropped from the plan — the async-path wrapper in `src/commands/node.ts` already turns `await asyncCmd(...)` into `Promise<string[]>`, so a dedicated capture helper is redundant. `resolve(promise)` was deleted outright — `await` replaces it.

Scripts that want to combine the two write `const lines = await hydra(...); writeFile('/tmp/out', lines)`.

Deleted files: `src/commands/output.ts`, `src/commands/output.test.ts`, `src/commands/resolve.ts`, `src/commands/resolve.test.ts`.

New files: `src/scripting/writeFile.ts`, `src/scripting/writeFile.test.ts`, `src/scripting/index.ts`.

### Phase G — FTP / NC mode path completion

Phase A already routed FTP/NC input through the shell parser (both modes swap in mode-specific command Maps but otherwise share the tokenize → parse → execute pipeline). The remaining gap was tab path completion: Phase D left the completer wired to the default filesystem for all modes.

This phase makes `shellCompleteAdapter` in `Terminal.tsx` mode-aware:

- **NC mode**: resolves paths against the NC target machine's filesystem via `listDirectoryFromMachine` / `getNodeFromMachine` / `resolvePathForMachine` keyed by `ncSession.machineId` + `ncSession.userType` + `ncSession.currentPath`.
- **FTP mode**: routes to the FTP **remote** machine's filesystem (`ftpSession.remoteMachine` + `remoteUserType` + `remoteCwd`). Local-facing commands (`lcd`, `lls`, `put`) share the remote filesystem for completion — positional-arg precision per command is a future refinement that would need the completer to pass the detected command name into the adapter.
- **Redis / MySQL**: empty adapter (these modes have no filesystem semantics and take raw REPL input anyway).
- **Default**: unchanged (current session's filesystem).

**Acceptance:** `cat /etc/pa<Tab>` inside an NC shell lists entries from the NC target machine; inside FTP it lists entries from the remote server. All existing tests pass.

## Testing strategy

- **Unit** — tokenizer, parser, executor each tested in isolation. Tokenizer table-driven tests for quoting edge cases.
- **Integration** — full pipeline strings end-to-end through `execute.ts` with a test command registry.
- **Regression** — every existing command test keeps passing. Shell is additive to the command layer, so `fn(...args)` tests are untouched.

## Design decisions (locked)

1. **Quoting**: single and double quotes are identical in Phase A — both produce a literal token, no interpolation. Revisit when env vars land.
2. **`>>` append**: deferred indefinitely. No clear gameplay use.
3. **Error messages**: match real bash (`bash: foo: command not found`, `bash: syntax error near unexpected token '|'`, etc.) for authenticity.
4. **Exit codes**: deferred. Commands continue to throw on error; the executor renders the error message as today. No `$?` plumbing.
5. **Mode parsers**:
   - `redis` and `mysql` — unchanged (raw-input paths remain; their real CLIs aren't bash-shaped, so current behavior is authentic).
   - `ftp` and `nc` — should convert to shell-style eventually, but **as a separate step after the main shell lands** (see Phase G).

## Out-of-scope follow-ups

- Env vars + `$?` + interpolation inside double-quotes
- Shell-level glob expansion
- `>>` append, `<` stdin-from-file, `2>` stderr redirect
- `&&`, `||`, `;` operators
- Command substitution `$(...)`
- Background `&` and job control
