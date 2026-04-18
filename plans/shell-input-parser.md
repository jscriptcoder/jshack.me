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
6. The existing `output` command stays until Phase E. Redirect and `output` coexist during intermediate phases.

**Acceptance:** `cat /etc/hosts > out.txt` works; `cat /etc/passwd | grep root > matches.txt` works; `ping 1.1.1.1 > ping.log` streams live to terminal while writing to file.

### Phase D — Tab completion rewrite

1. New `complete.ts` — given (input, cursorPos), return completions for command/path/flag based on tokenizer output
2. Replace `handleTab` two-layer logic in `Terminal.tsx`
3. Add flag completion driven by `command.manual.arguments`
4. Update `TerminalInput.test.tsx` and add direct tests for `complete.ts`

**Acceptance:** tab completion works for commands, paths, and flags. Old string-literal-detection code deleted.

### Phase E — Cutover, command manuals, cleanup

1. Delete the `new Function()` JS-eval branch in `executeCommand` (`Terminal.tsx:326`) — scripts keep their own path, unchanged
2. Delete `src/commands/output.ts` and `output.test.ts` — `>` replaces it. Remove from registry wiring.
3. **Rewrite every command's `manual.synopsis` and `manual.examples[].command`** from JS-call syntax to shell syntax across all ~60 command files. `man` renders these verbatim (`man.ts:5,23`), so they must match the new input style.
   - `synopsis: 'nmap(target, ...flags)'` → `synopsis: 'nmap <target> [flags...]'`
   - `{ command: 'nmap("192.168.1.1", "-sV")' }` → `{ command: 'nmap 192.168.1.1 -sV' }`
   - Audit tests that assert against synopsis/example strings and update
4. Update docs — `README.md`, `src/commands/README.md`, `.claude/docs/*` — use shell syntax for interactive examples. **Keep JS syntax only where the context is clearly about scripts** (scripts are unchanged).
5. Bump version in `package.json` + lockfile (feature change — per memory)
6. Full verification: `npm run build`, `npm run lint`, `npm run format`, `npm run test:run`

**Acceptance:** single dispatch path for interactive input, `output` gone, every `man <cmd>` shows shell syntax, version bumped, all checks green.

### Phase F — FTP / NC mode shell migration (follow-up)

Separate branch/PR after Phase E lands. Apply the same tokenize → parse → execute pipeline to `ftp>` and `nc>` modes so players can type `get file.txt` instead of `get("file.txt")`. Redis and MySQL modes remain raw-input (authentic to their real CLIs).

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
   - `ftp` and `nc` — should convert to shell-style eventually, but **as a separate step after the main shell lands** (see Phase F).

## Out-of-scope follow-ups

- Env vars + `$?` + interpolation inside double-quotes
- Shell-level glob expansion
- `>>` append, `<` stdin-from-file, `2>` stderr redirect
- `&&`, `||`, `;` operators
- Command substitution `$(...)`
- Background `&` and job control
