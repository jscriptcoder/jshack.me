# v2 Pipes (`|`) — implementation plan

Wire the v2 shell to chain commands: `cmd1 | cmd2 | …`, threading each stage's
stdout into the next stage's `env.stdin`. This activates grep's already-shipped
(but dormant) stdin path live.

Next chunk after this: redirections (`>`). The tokenizer/parser shapes here are
chosen to make that a drop-in addition (legacy already proves the shape).

## Legacy parity reference

Source of truth: `src/shell/{tokenize,parse,execute,types}.ts`.

- Tokenizer emits typed tokens `word | pipe | redirect`. `|`/`>` are operators
  only outside quotes/escapes (`echo "a|b"` → one word).
- Parse splits by `pipe` into stages. Empty stage (`| a`, `a |`, `a || b`) →
  `bash: syntax error near unexpected token \`|'`.
- Execute threads stage N-1 stdout → stage N stdin; result/exit = last stage.

## v2 design decisions

1. **stdin = `AsyncIterable<string>`** (already on `CommandEnv.stdin`, already
   consumed by grep). NOT legacy's single joined string. This is the fn/fnShell
   collapse — one `execute` signature serves shell pipes AND future `node` JS
   calls. See `project-v2-commands-js-callable`.
2. **Async intermediate stages: drain fully** (user decision 2026-05-29). No
   legacy "must complete synchronously" throw. Each intermediate stage's output
   (sync lines OR drained async lines) is collected, then replayed as an
   `AsyncIterable<string>` to the next stage.
3. **stdout vs stderr split**: only `kind: 'text'` lines feed the pipe. `error`
   lines from ANY stage surface to the terminal directly (real-bash behavior:
   stderr is not piped). `dim`/`prompt` lines: not piped, surfaced to terminal.
4. **Exit code**: last stage's exit code (bash default; no `pipefail`).
   Parse error = 2. command-not-found in any stage = 127.
5. **Eager, not lazy**: each stage runs to completion before the next starts
   (matches legacy; deterministic ordering). Lazy/concurrent streaming is a
   future enhancement — grep's `for await` already supports it when we get there.

## Type changes

`core/shell/tokenize.ts` — change return shape from `{ tokens: string[] }` to a
typed token stream. Mirror legacy minimally (no redirect token YET — added in
the redirections chunk):

```ts
export type Token =
  | { readonly kind: 'word'; readonly value: string }
  | { readonly kind: 'pipe' };

export type TokenizeResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly error: string };
```

New `core/shell/pipeline.ts` — parse tokens into stages:

```ts
export type Stage = { readonly name: string; readonly args: readonly string[] };
export type Pipeline = { readonly stages: readonly Stage[] };
// parsePipeline(tokens): { ok: true; pipeline } | { ok: false; error }
```

`runLine.ts` becomes: tokenize → parsePipeline → run stages, threading stdin.

## Vertical slices (each: RED → GREEN → MUTATE → REFACTOR, commit per slice)

### Slice 1 — tokenizer emits pipe operators
- RED: `tokenize` returns `Token[]`; `|` outside quotes → `{ kind: 'pipe' }`;
  `echo "a|b"` and `echo a\|b` keep `|` literal in the word.
- Adapt `runLine.ts` + existing tokenize/runLine tests to the new token shape
  (single-command path still works: one `word` token = name, rest = args).
- GREEN + MUTATE + commit. Leaves codebase green, no user-visible pipe yet.

### Slice 2 — two-stage pipeline executes end-to-end
- RED (through `runCommandLine`): `echo hello | grep hello` → `hello`;
  `cat /etc/passwd | grep root` → matching lines; `echo a | grep z` → exit 1.
- parsePipeline (2 stages), sequential execute, text-line stdout →
  `AsyncIterable<string>` stdin, last-stage exit code.
- Per-stage bindFlags (each stage parses its own flags).
- GREEN + MUTATE + commit. **First live use of grep's stdin path.**

### Slice 3 — N stages, syntax errors, stderr routing, async draining
- RED: `a | b | c` (3+ stages); `| a` / `a |` / `a || b` →
  `bash: syntax error near unexpected token \`|'` exit 2;
  command-not-found mid-pipe → 127; intermediate `error` lines reach terminal
  while `text` lines pipe; an async-result intermediate stage drains fully.
- GREEN + MUTATE + commit.

## Out of scope (explicit)
- Redirections (`>`, `>>`) — next chunk. Tokenizer leaves room for the token.
- `node` JS-callable adapter — separate future chunk.
- Lazy/concurrent stage streaming — future enhancement.
- `pipefail` / `PIPESTATUS` — not in legacy, not needed.
- Rendering `async` CommandResult in `runInput` — pre-existing UI gap; pipes
  with the six shipped commands all return `sync`, so unaffected. Note it.

## Verification
Per slice: `npm run test:run`, `npm run lint`, `npm run format`. After the chunk:
`npm run build`. Bump version (package.json + package-lock.json) on completion.
Squash-merge each slice PR via `gh pr merge --squash --delete-branch`.
