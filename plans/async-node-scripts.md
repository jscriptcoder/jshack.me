# Plan: Async Node Scripts

**Branch**: feat/tool-based-progression
**Status**: Active

## Goal

Enable `node` scripts to use `await` for async commands (hydra, nmap, etc.), so players can write automation scripts.

## Player Experience

```js
// brute.js — written with nano, run with node("brute.js")
for (let i = 0; i < 20; i++) {
  const output = await hydra("192.168.162.11", "ftp");
  const creds = output.filter(l => l.includes("login:"));
  if (creds.length > 0) {
    creds.forEach(l => console.log(l));
    break;
  }
  console.log(`Attempt ${i + 1}: no results, retrying...`);
}
```

## Acceptance Criteria

- [ ] `await hydra(...)` in a node script returns `string[]` of output lines
- [ ] `console.log()` prints to terminal in real-time from scripts
- [ ] `echo()` in async scripts prints to terminal in real-time (not buffered)
- [ ] Ctrl+C cancels the running script and current inner command
- [ ] Synchronous scripts continue to work unchanged (backwards-compatible)
- [ ] `sleep(ms)` is available for pacing loops

## Design

### Detection

If script content contains the `await` keyword, node uses the async execution path. Otherwise, existing sync path is unchanged.

### Async Execution Path

1. node detects `await` → returns `AsyncOutput` to Terminal
2. Terminal calls `start(onLine, onComplete)` as usual
3. Inside `start`, script runs via `AsyncFunction` constructor
4. Commands that return `AsyncOutput` are auto-wrapped: their lines are forwarded to `onLine` and collected into a `string[]` that the `await` resolves to
5. `console.log` and `echo` call `onLine` directly
6. When script finishes → `onComplete()`

### Key Utility: `collectAsyncOutput`

Converts `AsyncOutput` → `Promise<string[]>`, forwarding each line to an `onLine` callback. Used to bridge async commands into the await-based script context.

### Cancellation

- Track `cancelled` flag + reference to current inner command's `cancel`
- On Ctrl+C: set flag, cancel inner command
- Async wrappers check `cancelled` before starting new commands → throw to abort script
- `sleep()` also rejects on cancel

## Steps

### Step 1: Add `collectAsyncOutput` utility

**Test**: Given a mock AsyncOutput that emits lines, `collectAsyncOutput(asyncOutput, onLine)` resolves to `string[]` and calls `onLine` for each line.
**Implementation**: New function in `src/utils/asyncCommand.ts`.
**Done when**: Unit test passes.

### Step 2: Add async execution path to node command

**Test**: Script with `await` on a mock async command → node returns AsyncOutput → start produces collected lines. Also: sync scripts still work unchanged.
**Implementation**:
- Detect `await` keyword in content
- Use `AsyncFunction` constructor (`Object.getPrototypeOf(async function(){}).constructor`)
- Wrap execution context: each command fn is wrapped so AsyncOutput returns become `Promise<string[]>` via `collectAsyncOutput`
- `echo()` forwards to `onLine` in async mode
- `console` object with `log` method forwarding to `onLine`
- `sleep(ms)` utility in context
- Return `AsyncOutput` from node

**Done when**: Tests pass for async execution, console.log, echo forwarding, and sleep.

### Step 3: Add cancellation support

**Test**: Cancelling node's AsyncOutput stops script execution (subsequent awaits throw).
**Implementation**:
- Cancellation token tracks state + current inner cancel fn
- Async wrappers check cancelled state before starting commands
- `sleep()` rejects on cancel
- Script errors from cancellation are silently caught (not displayed)

**Done when**: Cancellation test passes.

### Step 4: Update manual and docs

**Implementation**: Update node command's manual text to mention `await` support, `console.log`, and `sleep`. Update architecture docs.
**Done when**: Docs reflect new capability.

## Pre-PR Quality Gate

1. All existing node tests still pass
2. New tests cover async path, console.log, echo, sleep, cancellation
3. `npm run build && npm run lint && npm run format:check && npm run test:run` all pass
4. Manual playtest: write a brute.js script via nano, run with node

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
