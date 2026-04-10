# Plan: Phase 1 — Dynamic Vulnerability Lookup

**Branch**: `plan/phase-1-dynamic-vuln-lookup` (plan doc)
**Implementation branches**: to be created off `multiplayer` as each commit/PR lands
**Base branch for all PRs in this phase**: `multiplayer` (NOT `main`)
**Status**: Active

## Context

This is Phase 1 of the multiplayer-prep defense rework. We're establishing a dynamic vulnerability model so that every subsequent defense feature (patching, version drift, firewall, router firmware, exploit logging) can layer on top of it trivially. Missions are allowed to break during this phase and will be reworked later. No backward compatibility is required.

## Goal

Whether a port is exploitable is determined at runtime by looking up its `(service, serviceVersion)` pair against the CVE table, rather than being baked into a `Port.vulnerability` field at generation time.

## Non-goals

The following are explicitly out of scope for Phase 1 and will be addressed in later phases:

- **Exploit logging** (source IP, CVE, outcome recorded on target's logs) — Phase 2.
- **Renaming `nc_prompt` → `exploit_session`** — Phase 2.
- **`apt upgrade` / patching command** — Phase 3+.
- **Version drift over game time** — Phase 3+.
- **Player-facing firewall command** — Phase 3+.
- **Router firmware updates** — Phase 3+.
- **Mission generation rework** — deferred entirely; breakage is expected.
- **Removing the `!targetPort.owner` gate in `msfconsole`** — deliberately left alone.
- **Vulnerability class diversification** (SQLi / LFI / auth bypass giving different rewards instead of "get shell") — deferred.

## Data model change

### Before

```ts
// src/network/types.ts
export type Vulnerability = {
  readonly cve: string;
  readonly description: string;
  readonly serviceVersion: string;
};

export type Port = {
  readonly port: number;
  readonly service: string;
  readonly open: boolean;
  readonly protocol?: 'tcp' | 'udp';
  readonly owner?: ServiceOwner;
  readonly vulnerability?: Vulnerability;
};
```

### After

```ts
// src/network/types.ts
export type Vulnerability = {
  readonly cve: string;
  readonly description: string;
  readonly serviceVersion: string;
};

export type Port = {
  readonly port: number;
  readonly service: string;
  readonly serviceVersion: string; // NEW — required, always set at construction
  readonly open: boolean;
  readonly protocol?: 'tcp' | 'udp';
  readonly owner?: ServiceOwner;
  // vulnerability field REMOVED
};
```

The `Vulnerability` type itself is kept — it's still the return type of the lookup function. What changes is that it's no longer stored on the port; it's derived on demand.

## Lookup function

```ts
// src/generation/pools/vulnerabilities.ts
export const findVulnForService = (
  service: string,
  serviceVersion: string,
): Vulnerability | undefined =>
  vulnerabilityTemplates.find(
    (t) => t.service === service && t.vulnerability.serviceVersion === serviceVersion,
  )?.vulnerability;
```

- Returns `undefined` when no CVE matches — this **is** the "port is safe" signal.
- A port is safe iff `findVulnForService(port.service, port.serviceVersion)` returns `undefined`.
- No separate "safe versions" table; the CVE table is the single source of truth (Option C).

## Known touchpoints

**Producers** (must set `serviceVersion` on every port they construct):

- `src/generation/enrichment.ts:90-115` — `addExploitVulnerability`. Currently attaches a full `Vulnerability` object; must instead pick a vulnerable version from the CVE table and set `port.serviceVersion` to it. The same first-match-wins picking logic can be preserved.
- Every other port construction site in `src/generation/` (`topology.ts`, `pools/ports.ts`, and anywhere port objects are spread/created). TypeScript will enforce a full audit once `serviceVersion` becomes required.

**Consumers** (must switch from `port.vulnerability` to the lookup):

- `src/commands/msfconsole.ts:75-88` — exploit check (`!targetPort.vulnerability` → `!findVulnForService(targetPort.service, targetPort.serviceVersion)`). The secondary `!targetPort.owner` gate stays as-is.
- `src/commands/nmap.ts:23` — `formatPortLine` version column. Replace `port.vulnerability?.serviceVersion ?? ''` with `port.serviceVersion` (always shows a version for open ports when `-sV` is set).
- `src/commands/nmap.ts:27-44` — `formatVulnerabilitySection`. Replace `openPorts.filter((p) => p.vulnerability)` + access to `p.vulnerability` with a lookup-based filter and lookup-based rendering.
- `src/commands/nmap.ts:98-113` — `formatTreeCVELines`. Same story.
- `src/commands/nmap.ts:296-298` — range-scan summary line. Replace `p.vulnerability ? ... : p.service` with a lookup.

**Tests**:

- `src/commands/msfconsole.test.ts` — any fixture that constructs ports with a `vulnerability` field.
- `src/commands/nmap.test.ts` — version column and CVE block assertions.
- Any generation tests that inspect port shape.
- **Intended mission breakage**: mission-level tests that depend on specific CVE selection or on a specific `vulnerability` object being present may break. These are acceptable; document any failing missions in the PR description and leave them unfixed for the later mission rework phase.

## Acceptance Criteria

Behaviour-driven; observable from the terminal and the public types:

- [ ] A port whose `(service, serviceVersion)` matches a CVE entry is exploitable via `msfconsole(host, port)` — the exploit session starts as the port's owner and the displayed CVE matches the looked-up one.
- [ ] A port whose `(service, serviceVersion)` does not match any CVE entry is **not** exploitable — `msfconsole` rejects with `no known vulnerability on <ip>:<port>`.
- [ ] `nmap -sV <host>` displays a service version for every open port (not only vulnerable ones), reading directly from `port.serviceVersion`.
- [ ] `nmap -sV <host>` displays a `VULNERABILITIES:` block whose entries come from the lookup function, not from a stored field — and the entries match what `msfconsole` would accept.
- [ ] `nmap -sV <range> --tree` still annotates hosts with CVE markers for ports whose lookup returns a vulnerability.
- [ ] On any given seed, machines generated with `accessVariant === 'exploit'` produce an entry port that is exploitable via the new model (the exact CVE may differ from before; what matters is that the entry path still works).
- [ ] The `Port` type no longer has a `vulnerability` field. `serviceVersion: string` is required.
- [ ] `npm run build`, `npm run lint`, `npm run format:check`, and `npm run test:run` all pass. Mission-related test failures are documented separately and not considered blockers per the no-backward-compat policy.

## Steps

Every step follows RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR. Each step ends in a committable state; the branch is green after every step. Tests describe observable behaviour via the terminal / public API, not internal function calls.

### Step 1: Introduce `findVulnForService` lookup function

**RED**: Write `src/generation/pools/vulnerabilities.test.ts` (new file) with behaviour-driven tests:

- `findVulnForService('http', 'Apache/2.4.49')` returns the `CVE-2021-41773` vulnerability.
- `findVulnForService('http', 'Apache/999.0.0')` returns `undefined`.
- `findVulnForService('unknown-service', 'any')` returns `undefined`.
- `findVulnForService('http', 'Apache/2.4.25')` returns `CVE-2017-7679` (same service, different version → different CVE) — proves the lookup respects version, not just service.

**GREEN**: Add `findVulnForService` to `src/generation/pools/vulnerabilities.ts` as a plain `.find()` over `vulnerabilityTemplates`.

**MUTATE**: Run the `mutation-testing` skill on `vulnerabilities.ts`. Expect mutations on the filter predicate (`===` → `!==`, service comparison drop, version comparison drop) to be killed by the tests above.

**KILL MUTANTS**: If any surviving mutants indicate a weak test, add a test that distinguishes the survived mutation.

**REFACTOR**: None expected — this is a one-line function.

**Done when**: All four tests pass, no surviving mutants, `npm run build` + `npm run lint` clean. No other file changed.

### Step 2: `msfconsole` uses `findVulnForService`; `Port` gains optional `serviceVersion`

**RED**: Update `src/commands/msfconsole.test.ts` with a behaviour test:

- Given a mocked remote machine with a single open port `{ service: 'http', serviceVersion: 'Apache/2.4.49', open: true, owner: {...} }` and **no** `vulnerability` field, `msfconsole` produces an `exploit successful` session whose displayed CVE is `CVE-2021-41773`.
- Given the same port shape but `serviceVersion: 'Apache/999.0.0'`, `msfconsole` rejects with the "no known vulnerability" error.

This test will fail because `msfconsole` currently reads `targetPort.vulnerability`, which is absent, so it short-circuits.

**GREEN**:

- Add `readonly serviceVersion?: string` to `Port` in `src/network/types.ts` (**optional** for now, so the rest of the codebase still compiles).
- In `msfconsole.ts:80-88`: replace the `!targetPort.vulnerability` check with:
  ```ts
  const vulnerability = findVulnForService(targetPort.service, targetPort.serviceVersion ?? '');
  if (!vulnerability) {
    throw new Error(`msfconsole: no known vulnerability on ${targetIP}:${port}`);
  }
  ```
- Destructure `vulnerability` from the lookup result, not the port.
- Leave the `!targetPort.owner` gate untouched.

**MUTATE**: Run `mutation-testing` on `msfconsole.ts`. Expect mutations on the lookup result check (`!vulnerability` → `vulnerability`, nullish coalescing removal) to be killed.

**KILL MUTANTS**: Add tests as needed to pin the lookup-result branch.

**REFACTOR**: None expected.

**Done when**: Both new tests green, existing `msfconsole.test.ts` still green (old fixtures that set `port.vulnerability` will silently ignore it but pass as long as `serviceVersion` is also set on those fixtures — update fixtures to use `serviceVersion` and drop the `vulnerability` field), `npm run build` clean.

### Step 3: `nmap -sV` reads `port.serviceVersion` and uses lookup for CVE rendering

**RED**: Update `src/commands/nmap.test.ts` with behaviour tests:

- `nmap('-sV', host)` against a machine with an open port `{ service: 'ssh', serviceVersion: 'OpenSSH 9.6', open: true }` (no `vulnerability` field, no CVE for this version) displays a version column containing `OpenSSH 9.6` and does **not** emit a `VULNERABILITIES:` section.
- `nmap('-sV', host)` against a machine with an open port `{ service: 'http', serviceVersion: 'Apache/2.4.49', open: true }` (no `vulnerability` field) displays the version column with `Apache/2.4.49` **and** emits a `VULNERABILITIES:` section containing `CVE-2021-41773`.
- `nmap('-sV', range, '--tree')` annotates a host whose port has a matching `serviceVersion` with the CVE marker in the tree output.

**GREEN**:

- `formatPortLine` reads `port.serviceVersion` directly (drop `port.vulnerability?.serviceVersion`).
- `formatVulnerabilitySection` filters open ports via `findVulnForService(p.service, p.serviceVersion)`, and iterates the lookup results for rendering.
- `formatTreeCVELines` same treatment.
- Range-scan summary line: replace `p.vulnerability ? ... : p.service` with `findVulnForService(...)` result.

**MUTATE**: Run `mutation-testing` on `nmap.ts`. Expect mutations on the filter predicate and the lookup-result rendering to be killed.

**KILL MUTANTS**: Add targeted tests.

**REFACTOR**: If `findVulnForService` ends up called 3–4 times per port per scan, consider memoising per-scan inside a `Map<service:version, Vulnerability | null>`. Only refactor if the duplication is ugly; performance is a non-concern at this scale.

**Done when**: All new nmap tests green, existing nmap tests updated to drop stored `vulnerability` fixtures, `npm run build` clean.

### Step 4: Exploit variant generation sets `serviceVersion` instead of a `vulnerability` object

**RED**: Update (or add) generation tests — locate the existing `addExploitVulnerability` test coverage (likely in `enrichment.test.ts` or a topology test). Write behaviour tests:

- A machine generated with `accessVariant === 'exploit'` has a non-SSH open entry port whose `serviceVersion` matches a CVE entry — i.e., `findVulnForService(port.service, port.serviceVersion)` returns a `Vulnerability`.
- The same port does **not** have a `vulnerability` field set.
- The owner is still attached (regression guard).

**GREEN**: Update `addExploitVulnerability` in `src/generation/enrichment.ts`:

```ts
const vulnTemplate = vulnerabilityTemplates.find((v) => v.service === p.service);
if (!vulnTemplate) return p;

return {
  ...p,
  serviceVersion: vulnTemplate.vulnerability.serviceVersion,
  owner: { ... }, // unchanged
};
```

Drop the `vulnerability: vuln.vulnerability` assignment.

**MUTATE**: Run `mutation-testing` on `enrichment.ts` around `addExploitVulnerability`. Expect the service-match and version-assignment mutations to be killed.

**KILL MUTANTS**: Add tests as needed.

**REFACTOR**: None expected.

**Done when**: Generation test(s) green, `msfconsole` tests still green against seeded exploit-variant machines (integration behaviour preserved), `npm run build` clean.

### Step 5: Make `serviceVersion` required on `Port`; remove legacy `vulnerability` field

**RED**: This step is driven by the type system more than new tests. The behaviour already exists. Before changing the type:

- Write one terminal-level regression test asserting that a freshly generated home network (via `generateLocalhost` or equivalent) has every port in every machine carrying a `serviceVersion` string.

**GREEN**:

- In `src/network/types.ts`: make `serviceVersion: string` required (drop the `?`), remove the `vulnerability?: Vulnerability` field from `Port`. Keep the `Vulnerability` type exported — still used by `findVulnForService` return value.
- Run `npm run build` — TypeScript will produce a list of every remaining construction site that fails to set `serviceVersion`. Walk the list and set a sensible version per port. Strategy:
  - If the port matches a CVE template (`vulnerabilityTemplates.find((v) => v.port === port && v.service === service)`), either use a safe version or deliberately pick the vulnerable one — follow the semantics of the surrounding code. For generic construction sites, pick a generic "safe" version string per service.
  - Create a small helper `defaultServiceVersion(service: string): string` co-located with the CVE table that returns a version string guaranteed not to match any CVE entry for that service. Use it as the default at construction sites that don't explicitly want a vulnerable version.
- Remove any remaining references to `port.vulnerability` that the earlier steps missed (TS will surface them all).

**MUTATE**: Run `mutation-testing` on `defaultServiceVersion` (trivial function) and re-run on `vulnerabilities.ts`. Verify no regression in killed mutants from Step 1.

**KILL MUTANTS**: Address as needed.

**REFACTOR**: Run the `refactoring` skill over the touched files. Obvious cleanup candidates: collapse duplicated "version + service lookup" patterns, extract shared test fixtures for port construction.

**Done when**:

- `serviceVersion: string` is required on `Port`.
- `vulnerability` field is gone from `Port`.
- No `port.vulnerability` references remain in `src/`.
- `npm run build`, `npm run lint`, `npm run format:check`, `npm run test:run` all pass.
- Mission test failures (if any) are listed in the PR description and left unfixed.

## PR strategy

Each step is a single commit. Natural PR groupings (pick at execution time):

- **PR A**: Step 1 only (lookup function — pure addition, trivially reviewable).
- **PR B**: Steps 2 + 3 (migrate consumers — `msfconsole` and `nmap` to lookup; `Port` gains optional `serviceVersion`).
- **PR C**: Steps 4 + 5 (migrate producer + cleanup — exploit variant, required field, remove legacy field).

All PRs target `multiplayer`. Feature branches are named `feat/phase-1-step-<N>-<slug>`.

If any PR grows beyond ~400 LoC changed or becomes hard to review, split further.

## Pre-PR Quality Gate

Before each PR:

1. **Mutation testing** — run `mutation-testing` skill on the files touched by the step(s) in that PR.
2. **Refactoring assessment** — run `refactoring` skill on the touched files.
3. **Full verification loop** — `npm run build`, `npm run lint`, `npm run format:check`, `npm run test:run` all pass.
4. **Documentation** — update `src/generation/README.md` and `src/commands/README.md` if the refactor shifts any documented responsibilities. `.claude/docs/infrastructure-design.md` should get a note about the dynamic vuln model when PR C lands.
5. **Mission breakage report** — list any failing mission-related tests in the PR description, confirm they are intentional breakage consistent with the no-backward-compat policy, and tag them for the later mission rework phase.

## Risks & open questions

- **`vulnerabilityTemplates.find` picks the first match.** Today `addExploitVulnerability` silently depends on the order of the CVE table to pick a specific CVE per service. After the refactor, this is still true — but the test in Step 4 should pin the exact version selected for the exploit variant on a stable seed, so we notice if template ordering ever shifts. If we want per-seed variety (different CVEs for the same service on different seeds), that's a separate enhancement, not Phase 1.
- **Port construction audit surface.** Step 5 will hit every port construction site — this is where the real size of the refactor shows up. If it turns out to be much larger than expected, consider splitting Step 5 into "make required + add helper" and "remove legacy field" as two commits.
- **`nmap -sV` now shows versions for safe ports.** Before this refactor, only vulnerable ports displayed a version. After, every open port displays one (because `serviceVersion` is always set). This is more realistic but is a player-visible behaviour change — worth mentioning in the PR description.

---

_Delete this file when Phase 1 is complete. If `plans/` is empty, delete the directory._
