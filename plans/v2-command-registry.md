# Plan: v2 command registry extraction

**Branch**: `feat/v2-command-registry`
**Status**: Active

## Goal

Move the hardcoded `COMMANDS` Map out of `ui/state.ts` into `core/commands/registry.ts` — a private array of `Command` objects + a derived `commandRegistry: ReadonlyMap<string, Command>` keyed by `command.name`. Future command ports require touching only `core/`, never the UI layer.

## Background

Today `v2/src/ui/state.ts:16-34` owns both the per-command imports and the Map literal:

```ts
const COMMANDS: ReadonlyMap<string, Command> = new Map([
  ['cat', cat], ['cd', cd], ['echo', echo],
  ['grep', grep], ['ls', ls], ['pwd', pwd],
]);
```

Two issues this slice resolves:

1. **Architectural layer mismatch** — the set of builtin commands is intrinsic to `core/`; the UI is a consumer. Today `core/` doesn't even know what commands exist.
2. **Manual key/value pairing is fragile** — nothing stops a future `['ls', cat]` typo from compiling. Deriving the Map key from `command.name` makes the invariant load-bearing.

**Legacy interface check** (per `feedback-v2-match-legacy-command-interface`): legacy's `useFileSystemCommands` is a React hook that builds session-scoped factory commands (`createPwdCommand(getCurrentPath)` etc.). That pattern is React-coupled and incompatible with v2's framework-agnostic `CommandEnv`-passed-at-call-time model. **No CLI interface affected** — registry is internal plumbing, not a user-visible surface.

## Acceptance Criteria

- [ ] `v2/src/core/commands/registry.ts` exports `commandRegistry: ReadonlyMap<string, Command>` derived from a module-private `builtins: readonly Command[]` array, keyed by `command.name`
- [ ] `v2/src/ui/state.ts` imports `commandRegistry` from `core/commands/registry`; the six per-command imports and the local Map literal are gone; `runCommandLine(env, line, commandRegistry)` is the call
- [ ] Every existing terminal integration test in `terminal.test.tsx` still passes unchanged (behavior preserved end-to-end across cat/cd/echo/grep/ls/pwd)
- [ ] Registry test asserts the load-bearing invariant: every registered command is keyed by its own `name`
- [ ] Lint + typecheck + tests + mutation testing on the new file all green

## Slices

### Slice 1: Extract `commandRegistry` as derived-from-array source of truth

**Value**: Future command port (ps/mkdir/rm/touch/find/...) is a one-import + one-line-edit change in `core/commands/registry.ts`. The UI never has to be touched to expose a new command. Architecturally aligns `core/` with the framework-agnostic boundary spec.

**Path**: `core/commands/registry.ts` is the new single source of truth. `ui/state.ts` becomes a consumer. `runCommandLine(env, line, Map)` signature stays — only the Map's origin changes.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (slice):

- New file `v2/src/core/commands/registry.ts` exports `commandRegistry: ReadonlyMap<string, Command>`. Internal `builtins` array contains `[cat, cd, echo, grep, ls, pwd]`; Map is `new Map(builtins.map((command) => [command.name, command]))`.
- `v2/src/ui/state.ts`: remove the six per-command imports + the local `COMMANDS` Map; add `import { commandRegistry } from '../core/commands/registry';`; pass `commandRegistry` to `runCommandLine`.
- New `v2/src/core/commands/registry.test.ts` — "keys each command by its own `name`" iterates `commandRegistry.entries()`; asserts `command.name === key` for every entry.
- All existing `terminal.test.tsx` tests still pass without modification.

**RED**: Write `registry.test.ts` with the invariant test. Fails — module doesn't exist.

**GREEN**: Create `core/commands/registry.ts`:

```ts
import { cat } from './cat';
import { cd } from './cd';
import { echo } from './echo';
import { grep } from './grep';
import { ls } from './ls';
import { pwd } from './pwd';
import type { Command } from './types';

const builtins: readonly Command[] = [cat, cd, echo, grep, ls, pwd];

export const commandRegistry: ReadonlyMap<string, Command> = new Map(
  builtins.map((command) => [command.name, command]),
);
```

Then update `ui/state.ts` to import + pass `commandRegistry`. Drop the six per-command imports and local Map literal.

**MUTATE**: Stryker scoped to `core/commands/registry.ts`. Expected coverage chains:

- ArrayDeclaration "drop element": each missing builtin makes the corresponding terminal integration test fail (`cat /etc/passwd`, `grep Alice ...`, etc. → `command not found`). Killed by existing terminal tests.
- TupleSwap `[command.name, command]` → `[command, command.name]`: typecheck error, surfaces as build break.
- StringLiteral `command.name` → `''`: every Map key collapses to `''`; lookup-by-name in terminal tests fails. Killed by terminal tests + the invariant test (iteration would yield empty-string key vs `command.name` mismatch).

**Equivalent-by-design** (call out so we don't chase):

- Reordering of `builtins` array — no test asserts traversal order; reordering is observationally identical.
- The `ReadonlyMap` type annotation — stripping it doesn't change runtime behavior; only TS infers a wider type.
- "Empty registry" mutation: if `builtins` becomes `[]`, the invariant test passes trivially (zero iterations). Caught only by terminal integration tests, which would all fail with `command not found`. Accepted as fully covered via integration.

**KILL MUTANTS**: Address surviving mutants. Ask human only if a survivor's value is genuinely ambiguous.

**REFACTOR**: Likely none — the file is intentionally minimal (8 lines of body code). Don't add `Set`-based uniqueness assertion or `getCommand(name)` wrapper unless mutation testing demands it.

**Done when**: All slice ACs met, mutation report reviewed, terminal tests green, human approves commit.

## Pre-PR Quality Gate

1. Mutation testing on `core/commands/registry.ts`
2. Refactoring assessment (registry file + state.ts diff)
3. `cd v2 && npm run lint && npm run build && npm run test:run` all green
4. No new TypeScript suppressions, no `any`

## Out of scope (deferred)

- Help/man wiring iterating BUILTIN_COMMANDS — not needed until `help` ships; would be speculative.
- Self-registering pattern (import-side-effect `register()`) — anti-pattern, never doing this.
- Splitting builtins by tier or availability — premature; only useful when help/man need it.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
