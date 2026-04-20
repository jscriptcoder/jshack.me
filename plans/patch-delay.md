# Plan: CVE Patch Delay

**Branch**: feat/patch-delay
**Status**: Active

## Goal

Introduce a randomized 1–2 day window between a service/firmware CVE publishing and its fix becoming available via `apt upgrade`, so players must invest in defensive measures (firewalling, stopping services, hardening permissions) instead of relying on an instant-patch button. Expose the gap to players via a new `apt list --upgradable` flag that shows per-package status and a patch ETA.

## Background

**Current behaviour** (`src/generation/timeline/config.ts:16-27`, `src/generation/timeline/walker.ts:121-134`):
Every service has a procedurally walked version timeline. Entries carry `publishedAt` — the game-day the version's CVE drops. `findLatestSafeVersion` picks the first entry where `publishedAt > gameTime`, which is always "just about to become vulnerable." Effect: the instant a CVE publishes, the patched version is available for free.

**New behaviour**: each timeline entry carries a deterministic per-CVE `patchDelay` (1–2 days). A version V*i is only available as an upgrade target once `publishedAt(V*{i-1}) + patchDelay(V_i) <= gameTime`. When the current version is vulnerable and the next version is not yet released, `apt upgrade` reports "no fix available yet" with an ETA.

**Key decisions** (from design discussion):

- Randomized 1–2 days, driven by a side-PRNG keyed `${prngKey}:patchDelay` so the main walk's gap/bump stream stays stable. Range is bounded by the `minSafeWindowDays > maxPatchDelayDays` invariant — widening the patch range requires widening the safe-window range too.
- Patch delay range lives in `CVE_TIMING_CONFIG` as `minPatchDelayDays` / `maxPatchDelayDays`.
- ETA surfaced to the player uses the config **average** (`(min + max) / 2`) — no per-CVE ETA leak, no countdown, just a stable planning number.
- **No defence hints** in `apt upgrade` output — a single neutral warning line only. Players must figure out which defence (iptables, systemctl stop, chmod, etc.) fits the situation.
- **Invariant guarded at module load**: `minSafeWindowDays > maxPatchDelayDays`. If violated, every CVE would outlive its fix window and players would be perpetually vulnerable. Enforce with a module-level check in `config.ts` that throws on import when the invariant breaks — surfaces config mistakes the moment the app loads.
- Per-service tuning is a future improvement. v1 uses a single global range.
- All affected tests and debug scripts fixed in the relevant step — no "fix later."

## Acceptance Criteria

- [ ] `buildTimelineFromTemplate` emits a `patchDelay` integer in `[minPatchDelayDays, maxPatchDelayDays]` on every `GeneratedVersion`, deterministic per service.
- [ ] `findLatestSafeVersion` returns `undefined` when the current CVE's fix is not yet released; returns the newer safe version otherwise.
- [ ] `findLatestSafeFirmware` mirrors that behaviour for router firmware.
- [ ] `apt upgrade` on a machine running a vulnerable service emits a line like `W: sshd is vulnerable but no fix has been released (ETA ~2 days)` and does not include the service in the upgrade list while the fix is unreleased. Unaffected services in the same command still upgrade normally.
- [ ] `apt upgrade` called once the patch is released upgrades the service exactly as before.
- [ ] `apt list --upgradable` (and its short alias `-u`) prints one line per installed package with a status column: `[upgradable → <version>]` / `[vulnerable, no fix yet — ETA ~N days]` / `[up to date]`.
- [ ] `simulateExploit.ts` accounts for the gap — CVEs report the patch-delay window in their output.
- [ ] `dumpMissionNetwork.ts` / `dumpHomeNetwork.ts` show patch-availability alongside vulnerability state for each service.
- [ ] `README.md`, `src/generation/README.md`, `src/commands/README.md`, `.claude/docs/infrastructure-design.md`, and `.claude/docs/mission-variations.md` reflect the new behaviour.
- [ ] Version bumped in `package.json` (minor bump — new feature, no breaking API).

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test. Each step is a single PR.

### Step 1: Timeline entries carry a per-CVE patch delay

**Acceptance criteria**:

- `CVE_TIMING_CONFIG` gains `minPatchDelayDays: 1` and `maxPatchDelayDays: 2`.
- `config.ts` enforces the invariant `minSafeWindowDays > maxPatchDelayDays` at module load (throws on import when violated).
- `GeneratedVersion` type gains `readonly patchDelay: number`.
- `buildTimelineFromTemplate` produces a `patchDelay` per entry, drawn from `prng.nextInt(minPatchDelayDays, maxPatchDelayDays)`, deterministic per prngKey.
- `findLatestSafeVersion` / `findLatestSafeFirmware` behaviour is **unchanged** — patch delay is only carried, not yet enforced.
- Existing callers (`findVulnForService`, `findPinnableServiceVersion`, `firmwareLookup`) continue to pass.

**RED**: Test that `buildTimelineFromTemplate` emits `patchDelay` on each entry within the configured range and that the sequence is deterministic for a given prngKey. Test the config invariants: `minPatchDelayDays <= maxPatchDelayDays`, both `>= 1`, and `minSafeWindowDays > maxPatchDelayDays` (covered by a test that imports a stub with the invariant violated and asserts it throws).
**GREEN**: Add the two config fields, extend `TimelineTiming`, extend `GeneratedVersion`, call `prng.nextInt` once per walk step to produce `patchDelay`, attach to the entry. Add the invariant guard to `config.ts`.
**MUTATE**: Run `mutation-testing` skill on `walker.ts` and `config.ts` changes.
**KILL MUTANTS**: Strengthen tests as needed; ask human when ambiguous.
**REFACTOR**: Check whether the patch-delay draw belongs in a small helper alongside `pickBumpType`.
**Done when**: Config + data-shape change lands behind a green test suite with no behaviour change for existing callers.

### Step 2: apt upgrade respects patch delay (service + firmware)

**Acceptance criteria**:

- `findLatestSafeVersion` returns `undefined` when the timeline entry that is currently "next safe" has not yet been released (`publishedAt(prev) + entry.patchDelay > gameTime`).
- `findLatestSafeFirmware` mirrors the change.
- `pickUpgradeTarget` in `apt.ts` returns a tagged result: `{ kind: 'target', version } | { kind: 'no-fix-yet' } | { kind: 'no-template' }`. `'no-template'` continues to fall back to `DEFAULT_LATEST_VERSION`; `'no-fix-yet'` is filtered out of the upgrade list.
- `handleUpgrade` emits a warning line per `'no-fix-yet'` service: `W: <service> is vulnerable but no fix has been released (ETA ~<avg> days)`. ETA uses `(minPatchDelayDays + maxPatchDelayDays) / 2`.
- A still-upgradable service in the same command upgrades normally even when another service is `'no-fix-yet'`.
- `apt install pkg=version` (version-pin) behaviour is unchanged — pinning stays explicit.

**RED**: Tests at three gameTimes around a known CVE: before `publishedAt` (upgrade finds latest safe), inside the patch gap (upgrade reports no fix), after `publishedAt + patchDelay` (upgrade finds the fix). Add an `apt upgrade` integration test that mixes a `'no-fix-yet'` service and a normal upgrade in the same call and asserts the warning line plus the successful upgrade of the other service.
**GREEN**: Update `findLatestSafeVersion`/`findLatestSafeFirmware` to the `prev + patchDelay <= gameTime` condition. Convert `pickUpgradeTarget` to tagged return. Update `collectUpgradeCandidates` and `handleUpgrade` to handle the new variant.
**MUTATE**: Run `mutation-testing` on `walker.ts`, `firmwareLookup.ts`, `apt.ts`.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Check `collectUpgradeCandidates` vs new variant handling — any duplication between service and firmware paths.
**Done when**: All upgrade-path tests pass, including the new gap-window cases.

### Step 3: `apt list --upgradable` prints per-package status

**Acceptance criteria**:

- `apt list --upgradable` and its short alias `apt list -u` are recognised (mirroring the existing `--installed` / `-i` pair).
- Output contains one line per installed package on the current machine, status column one of:
  - `[upgradable → <version>]` when a fix is available,
  - `[vulnerable, no fix yet — ETA ~N days]` when vulnerable in the patch gap (N = avg delay),
  - `[up to date]` when the current version has no live CVE.
- Includes router firmware as package `firmware` when on a router.
- `--installed` / `-i` output unchanged.
- Manual page lists both `--upgradable` and `-u`; `apt list` usage line updated to show the new flag alongside `-i`.

**RED**: Integration test rendering the three status variants for a machine with mixed services (up to date, upgradable, in-gap) and verifying the router-firmware row when applicable. Assert `apt list --upgradable` and `apt list -u` produce identical output (mirroring the existing `-i` / `--installed` alias tests).
**GREEN**: Extend `handleList` to branch on `--upgradable` or `-u`, reuse `pickUpgradeTarget` + `findVulnForService` + firmware helpers. Thread `getCurrentMachine` and `getGameTime` into `handleList` (they already exist in `AptContext`).
**MUTATE**: Run `mutation-testing` on the new list rendering.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Consider extracting per-package status into a small helper shared with `handleUpgrade`.
**Done when**: New flag works end-to-end with all three status variants.

### Step 4: Debug scripts + simulateExploit reflect patch delay

**Acceptance criteria**:

- `scripts/simulateExploit.ts` output includes the patch-delay window for the chosen CVE (e.g. `Fix released at day X (patch delay: Y days)`).
- `scripts/dumpMissionNetwork.ts` and `scripts/dumpHomeNetwork.ts` show, per vulnerable service, whether a fix is currently released or still in the gap, plus the release day.
- Script contract tests in `scripts/lib/` updated.

**RED**: Update existing script output snapshot / contract tests (or add one) asserting the new field.
**GREEN**: Extend `scripts/lib/dumpUtils.ts` and the scripts themselves to surface `patchDelay` / release status.
**MUTATE**: Run `mutation-testing` where scripts have logic (formatting only is usually low-value to mutate; focus on decision points).
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Consolidate any duplicated "format CVE row" logic.
**Done when**: Debug scripts agree with in-game behaviour for arbitrary seeds.

### Step 5: Documentation + version bump

**Acceptance criteria**:

- `README.md` mentions the patch-delay mechanic under the apt / vulnerabilities section and documents `apt list --upgradable`.
- `src/generation/README.md` describes `patchDelay` on `GeneratedVersion` and the updated semantics of `findLatestSafeVersion`.
- `src/commands/README.md` updates the apt manual entry.
- `.claude/docs/infrastructure-design.md` reflects the vulnerability lifecycle change.
- `.claude/docs/mission-variations.md` adds patch delay to the generation axes list.
- `package.json` + `package-lock.json` version bumped (minor).
- `npm run format` run so all `*.md` changes are consistent.

**RED**: N/A for pure docs + version bump. Still run the full check suite (`build`, `lint`, `format:check`, `test:run`).
**GREEN**: Edit the docs and bump the version.
**MUTATE**: N/A.
**KILL MUTANTS**: N/A.
**REFACTOR**: N/A.
**Done when**: Docs accurate, version bumped, full verification suite green, PR opened.

## Pre-PR Quality Gate

Before each PR in this plan:

1. `npm run build`
2. `npm run lint`
3. `npm run format:check` (or `npm run format` then re-check)
4. `npm run test:run`
5. Mutation testing — `mutation-testing` skill on the files touched in the step.
6. Refactoring assessment — `refactoring` skill.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
