# Plan: Refactor script_fix to white-hat mission

**Branch**: feat/script-fix-whitehat
**Status**: Active

## Goal

Make script_fix missions white-hat (authorized contractor, like forensics): SSH entry with root password in briefing, replace `_decode` verification with `_system` verification where mail runs the script to check correctness.

## Acceptance Criteria

- [ ] script_fix missions force SSH entry (like forensics)
- [ ] script_fix briefing includes root password (like forensics)
- [ ] Scripts use `_system(value)` instead of `echo(_decode(value))`
- [ ] `_system` in `node()` context gives feedback (PASS/FAIL) when player tests
- [ ] `mail()` reads script from target machine, executes it, checks `_system` was called with `expectedChecksum`
- [ ] `mail()` accepts empty/any content for script_fix (player sends "done" or anything)
- [ ] `_decode` still works for script_auto (second PR will convert it)
- [ ] Mission board descriptions reflect white-hat framing
- [ ] No `expectedProof`/ACCESS-KEY generated for script_fix
- [ ] All existing tests updated, new tests for `_system` and mail verification
- [ ] `scriptOwner` field removed for script_fix (root access given, no need for user/root split)

## Steps

### Step 1: Replace `_decode` with `_system` in node execution context

The `_system` function replaces `_decode` for script_fix missions. When the player runs `node(path)` to test their script, `_system(value)` prints feedback: "System check: PASS" or "System check: FAIL — script output is incorrect".

**Test**: Update `node.test.ts` `_decode() injection` describe block — rename to `_system() / _decode() injection`. Add tests:

- `_system(correct_value)` returns "System check: PASS"
- `_system(wrong_value)` returns "System check: FAIL — script output is incorrect"
- `_system` is not injected when no mission active
- `_decode` still works for script_auto context

**Implementation**:

- In `node.ts`: Rename `getDecodeFn` to `getSystemFn` in `NodeContext` type. Accept `_system` alongside `_decode`. Inject `_system` into sync/async contexts.
- In `useCommands.ts`: Change `getDecodeFn` logic — for `script_fix`, return a `_system` function that checks value against `expectedChecksum` and returns PASS/FAIL string. For `script_auto`, keep returning `_decode` (unchanged for now).

**Done when**: Node tests pass with `_system` for script_fix context and `_decode` for script_auto context.

### Step 2: Update script pool files to use `_system` instead of `_decode`

**Test**: Snapshot/grep test that no script_fix template contains `_decode`. Add a test in a new `scriptFix.test.ts` that iterates all templates and asserts they use `_system(...)` not `_decode(...)`.

**Implementation**: In `src/generation/pools/scriptFix.ts`, replace all `echo(_decode(...))` calls with `_system(...)` across all bug variants for all roles.

**Done when**: Pool test passes, no `_decode` references remain in scriptFix.ts.

### Step 3: Force SSH entry and root password in briefing for script_fix

**Test**: In `accept.test.ts`, add test for script_fix seed that verifies briefing contains "Root password:" and investigation-style hint. In a generation test, verify script_fix missions use SSH entry variant.

**Implementation**:

- `generateMission.ts`: Add `script_fix` to the SSH-forced check alongside `forensics`.
- `attackChain.ts` (`buildMissionObjective`): For `script_fix`, get root password from credentials (same pattern as forensics) and include in description. Remove `generateAccessKey` call. Set `expectedProof: ''` (not used anymore). Remove `scriptOwner` field (always root access).
- `accept.ts` (`formatObjectiveHint`): Update script_fix hint to reflect white-hat framing — remove ACCESS-KEY mention, tell player to fix script and confirm when done.

**Done when**: Accept test verifies root password in briefing, generation test verifies SSH entry.

### Step 4: Mail verification runs the script instead of checking ACCESS-KEY

This is the core change. Mail needs to execute the player's script and check `_system` was called with the correct value.

**Test**: In `mail.test.ts`:

- script_fix with correct script: `mail(client, "done")` succeeds (mock readFileFromMachine returns fixed script content, mock executeScript validates `_system` call)
- script_fix with broken script: `mail(client, "done")` fails
- script_fix with missing script: `mail(client, "done")` fails with "Script not found"
- script_fix accepts empty/any content (just "done")

**Implementation**:

- Add `executeScript` callback to `MailCommandContext` — a function that takes `(machineId, scriptPath) => { systemValue: string | null }` or similar. This callback reads the script, runs it in a sandboxed context with `_system` captured, and returns what was passed to `_system`.
- `verifyScriptFix` changes: no longer checks `proof === expectedProof`. Instead calls `executeScript` to run the script on the target machine, checks if `_system` was called with `expectedChecksum`.
- In `useCommands.ts`: Wire up `executeScript` callback using `readFileFromMachine` + a lightweight script runner (extract from node.ts or create a utility).

**Done when**: Mail tests pass for script_fix with the new verification flow.

### Step 5: Extract script execution utility for mail verification

The mail command needs to run a script in a sandboxed context. Extract the core execution logic from `node.ts` into a shared utility.

**Test**: Unit test for the extracted utility: given script content and a context with `_system`, executes and returns what `_system` captured.

**Implementation**: Create `src/utils/scriptRunner.ts` with a `runScriptWithSystem(content: string, expectedChecksum: string): { passed: boolean }` function. Uses `new Function()` like node.ts sync path. Injects `_system` that captures the value. Returns whether the captured value matches `expectedChecksum`. Wire this into `mail.ts` via the context callback.

**Done when**: Script runner utility works standalone, mail uses it for verification.

### Step 6: Update mission board descriptions for script_fix

**Test**: In `missionBoard.test.ts`, verify script_fix contract descriptions reflect white-hat framing (no "retrieve the access code", instead "fix the broken script" or "repair" language).

**Implementation**: Update DKC-003, DKC-009, DKC-013 in `missionBoard.ts` — change objectives to white-hat framing. Update seed keywords to force SSH entry (replace nc/exploit/ftp with ssh).

**Done when**: Mission board test passes with updated descriptions.

### Step 7: Update mail command to accept optional content for script_fix

Currently `mail()` requires both recipient and content args. For script_fix, the content is irrelevant ("done" or empty). Make content optional when the objective is script_fix.

**Test**: In `mail.test.ts`, verify `mail(client)` (no content) works for script_fix.

**Implementation**: In `mail.ts`, when content is undefined/missing and objective is script_fix, treat as empty string instead of throwing. The verification happens via script execution, not proof content.

**Done when**: Mail accepts `mail(client)` and `mail(client, "done")` for script_fix.

### Step 8: Clean up and documentation

**Test**: Run full test suite, lint, build.

**Implementation**:

- Remove `scriptOwner` from script_fix objective generation (filesystem always places as root-readable)
- Update `.claude/CLAUDE.md` architecture notes about script_fix being white-hat
- Update `.claude/docs/mission-variations.md` to reflect script_fix changes
- Update `README.md` if needed

**Done when**: Build passes, lint clean, all tests green.

## Implementation Notes

- **PRNG stability**: The `attackChain.ts` changes must preserve PRNG roll count. script_fix currently does 2 dummy rolls (for binary + encrypt). If we remove `generateAccessKey` (which consumes PRNG rolls), we need compensating dummy rolls to keep other mission types deterministic. Check `generateAccessKey` to count its PRNG usage.
- **`_decode` coexistence**: `_decode` must still work for `script_auto` until the second PR. The node context logic needs to check objective type and inject the appropriate function.
- **Script runner sandboxing**: The script runner for mail verification should be minimal — no async support needed (scripts are simple sync checks), no echo buffering, just execute and capture `_system`.
- **Filesystem permissions**: With root access given, `scriptOwner` is irrelevant for script_fix. But the script file still needs proper permissions so the player can read/edit it with nano and execute with node.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — run `mutation-testing` skill
2. Refactoring assessment — run `refactoring` skill
3. Typecheck and lint pass
4. DDD glossary check (if applicable)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
