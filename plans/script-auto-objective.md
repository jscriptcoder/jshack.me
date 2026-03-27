# Plan: `script_auto` Mission Objective

**Branch**: feat/script-auto-objective
**Status**: Active

## Goal

Add a new `script_auto` mission objective where the player writes a script from scratch in a cron/init/network-up location, based on comment instructions, that either reads a local file or POSTs to a remote API endpoint to extract a value and pass it to `_decode()`.

## Design

### Concept

- A stub script exists in an automation location with comment-only instructions
- The player writes the script body using `nano`, runs it with `node`, gets the ACCESS-KEY from `_decode()`
- The player mails the ACCESS-KEY to the client (same verification as `script_fix`)

### Two Flavors

**Local read**: Instructions say "Read `/path/to/file.json`, extract the `fieldName` field, pass to `_decode()`"
- Player writes a sync script: `const data = JSON.parse(cat('/path/to/file.json')); echo(_decode(data.fieldName))`
- The data file is placed on the same machine as the script

**Remote fetch**: Instructions say "POST to `http://ip/api/endpoint`, extract the `fieldName` field, pass to `_decode()`"
- Player writes an async script: `const r = await curl('-X', 'POST', 'http://ip/api/endpoint'); const data = JSON.parse(r.join('\n')); echo(_decode(data.fieldName))`
- The API JSON file is placed on a different machine in the network (must have port 80 open)

### Script Locations (3)

- `/etc/cron.d/<name>.js` — periodic monitoring job
- `/etc/init.d/<name>.js` — boot-time data collection
- `/etc/network/if-up.d/<name>.js` — network-up connectivity check

### Template Structure

```typescript
type ScriptAutoTemplate = {
  readonly location: 'cron.d' | 'init.d' | 'if-up.d';
  readonly scriptName: string;
  readonly flavor: 'local' | 'remote';
  readonly instructions: string;         // Comment block with instructions (has {{placeholders}})
  readonly dataFileName: string;         // JSON file name (local: on target, remote: on API machine)
  readonly dataContent: string;          // JSON content for the data file
  readonly extractField: string;         // The JSON field to extract
  readonly expectedChecksum: string;     // Value of that field (what _decode expects)
};
```

For **local** templates: `dataFileName` is an absolute path on the target machine, `instructions` reference that path.
For **remote** templates: `dataFileName` is the API endpoint name (placed at `/var/www/api/<name>.json` on the API machine), `instructions` reference `http://{{apiIp}}/api/<name>`.

### API Machine Selection

For remote flavor, the generator picks a non-target machine in the same subnet layer that has (or can have) port 80 open. The API JSON file is placed on that machine via `extraDirectories`. If no suitable machine exists, falls back to local flavor.

### Objective Fields (new on MissionObjective)

- `scriptAutoFlavor?: 'local' | 'remote'` — which flavor
- `scriptAutoDataPath?: string` — path to data file (local) or API endpoint path (remote)
- `scriptAutoDataContent?: string` — JSON content for the data file
- `scriptAutoApiMachine?: string` — IP of machine hosting the API (remote only)

Reuses existing fields: `targetPath` (script location), `targetContent` (stub with instructions), `expectedChecksum`, `expectedProof` (ACCESS-KEY), `scriptOwner`.

### Port Closure Exemption

Like `script_fix`, `script_auto` needs SSH access on the target machine. Add to the port closure skip list in `enrichment.ts`.

### _decode Injection

Extend the `getDecodeFn()` check in `useCommands.ts` to also activate for `script_auto` missions (currently only `script_fix`).

## Acceptance Criteria

- [ ] `script_auto` is a valid objective type selectable via PRNG pool and `script-auto` seed keyword
- [ ] Templates cover all 7 machine roles with both local and remote flavors
- [ ] Local flavor: data file placed on target machine, script reads it
- [ ] Remote flavor: API JSON placed on a different machine with port 80, script curls it
- [ ] Script stubs are placed in cron.d, init.d, or if-up.d locations
- [ ] `_decode()` is injected for `script_auto` missions (same mechanism as `script_fix`)
- [ ] Verification via `mail()` works identically to `script_fix` (ACCESS-KEY match)
- [ ] Port closures skip `script_auto` (needs SSH)
- [ ] PRNG sequence preserved (dummy rolls consumed for binary/encrypt alignment)
- [ ] All existing tests pass, new tests cover generation and verification
- [ ] Documentation updated (mission-variations.md, CLAUDE.md, README.md)

## Steps

### Step 1: Add `script_auto` to `MissionObjectiveType` and objective fields

**Test**: Write a type-level test or unit test that `'script_auto'` is a valid `MissionObjectiveType` and the new optional fields exist on `MissionObjective`.
**Implementation**: Add `'script_auto'` to the union in `types.ts`, add optional fields (`scriptAutoFlavor`, `scriptAutoDataPath`, `scriptAutoDataContent`, `scriptAutoApiMachine`).
**Done when**: Types compile, existing tests pass.

### Step 2: Add `script_auto` verification in `mail.ts`

**Test**: Write tests for `verifyScriptAuto` — correct ACCESS-KEY returns null, wrong key returns error string. Mirror existing `verifyScriptFix` tests.
**Implementation**: Add `verifyScriptAuto()` function (same logic as `verifyScriptFix`) and wire it into the `verifyProof` dispatcher.
**Done when**: Verification tests pass.

### Step 3: Add `_decode()` injection for `script_auto` in `useCommands.ts`

**Test**: Write test that `_decode` is injected when active mission is `script_auto` (extend existing `script_fix` _decode tests in `node.test.ts`).
**Implementation**: Change the `getDecodeFn()` guard from `type !== 'script_fix'` to `type !== 'script_fix' && type !== 'script_auto'` (or use an includes check).
**Done when**: _decode injection tests pass for both `script_fix` and `script_auto`.

### Step 4: Create `script_auto` templates pool

**Test**: Write tests that templates exist for all 7 machine roles, each template has valid structure (location, scriptName, flavor, instructions, dataFileName, dataContent, extractField, expectedChecksum).
**Implementation**: Create template definitions in `src/generation/pools/scriptAuto.ts` (or add to existing `scripts.ts`). Aim for 2-3 templates per role, mixing local/remote flavors and all 3 locations.
**Done when**: Template pool tests pass.

### Step 5: Add `script_auto` generation in `attackChain.ts`

**Test**: Write tests that `buildMissionObjective` with `script_auto` type produces correct objective fields — targetPath in automation location, targetContent contains instructions, expectedChecksum matches template, scriptOwner set, PRNG dummy rolls consumed.
**Implementation**: Add `selectScriptAutoFile()` helper and `if (objectiveType === 'script_auto')` branch in `buildObjective()`. For remote flavor, pick an API machine from the same layer. Consume dummy PRNG rolls for binary/encrypt.
**Done when**: Generation tests pass.

### Step 6: Add filesystem placement for `script_auto` data files

**Test**: Write tests that local-flavor data files are placed on target machine and remote-flavor API JSON files are placed on the API machine with proper `/var/www/api/` directory structure.
**Implementation**: In `filesystem.ts`, handle `script_auto` objective: place data file on target (local) or create API endpoint on API machine (remote). Ensure the API machine has port 80 open and `/var/www/api/` directory exists.
**Done when**: Filesystem placement tests pass.

### Step 7: Add `script_auto` to objective pool and seed keyword

**Test**: Write tests that `script_auto` appears in the PRNG pool, `script-auto` seed keyword triggers it, and port closures are skipped for `script_auto`.
**Implementation**:
- Add `'script_auto'` to `objectiveTypes` array in `attackChain.ts`
- Add `['script-auto', 'script_auto']` to `objectiveKeywords` in `generateMission.ts`
- Add `script_auto` to port closure skip list in `enrichment.ts`
**Done when**: Integration tests pass — generating a mission with `script-auto` keyword produces correct objective.

### Step 8: End-to-end integration test

**Test**: Generate a full mission with `script-auto` seed keyword, verify the complete pipeline: objective generated, script stub placed in automation location, data file placed correctly, _decode would work with correct checksum, mail verification accepts correct ACCESS-KEY.
**Implementation**: Write integration test in `generateMission.test.ts` similar to existing objective-specific tests.
**Done when**: E2E generation test passes, all existing tests still pass.

### Step 9: Update documentation

**Test**: N/A (documentation only).
**Implementation**: Update `mission-variations.md` (add script_auto row, describe flavors/locations), `CLAUDE.md` (add to objective list), `README.md` (mention new objective), and any per-module READMEs.
**Done when**: `npm run format` passes on all updated docs.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — run `mutation-testing` skill
2. Refactoring assessment — run `refactoring` skill
3. Typecheck and lint pass
4. All tests pass (`npm run test:run`)
5. Build succeeds (`npm run build`)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
