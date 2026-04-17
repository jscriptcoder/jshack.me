# Vulnerability Effect Coherence

## Problem

Descriptions and attack patterns on vulnerabilities don't match the typed `effect` field:

- **Walker** (`src/generation/timeline/generatedVuln.ts:157`): description is hardcoded to `"${service} ${version} remote code execution (${cve})"` regardless of whether the effect is `file_read`, `password_reset`, `backdoor_port_open`, etc.
- **Walker attack patterns** (`GENERATED_ATTACK_PATTERNS`): keyed by service only, so an HTTP CVE with `file_read` effect can draw an RCE-flavored log line. Log evidence doesn't match the exploit.
- **Hand-authored** (`src/generation/pools/vulnerabilities.ts`): all 39 entries use `effect: { kind: 'shell_limited' }`, yet descriptions describe wildly different behaviors ("Pulse Secure VPN arbitrary file read", "Mosquitto MQTT broker auth bypass", "Dovecot POP3 DoS"). A player reading both fields sees contradictions.

Universe-day-0 also suffers: without walker variety active yet, players only experience `shell_limited` for days. Diversifying hand-authored effects is a gameplay improvement.

## Out of scope

- Real CVE IDs — we drop them (user pref). Hand-authored gets fake IDs in the same format.
- Walker year/serial scheme for generated CVEs — unchanged.
- Mission generation — downstream consumer, benefits automatically.

## Approach

Two new helpers, shared between walker and (implicitly) hand-authored authoring:

1. **`describeEffect(service, version, cve, effect) → string`** — produces a coherent description per effect kind. E.g.
   - `shell_limited` → `"${service} ${version} remote code execution (${cve})"`
   - `shell_full` → `"${service} ${version} authenticated ${tier} shell via protocol abuse (${cve})"`
   - `file_read` → `"${service} ${version} arbitrary file read via path traversal (${cve})"`
   - `file_write` → `"${service} ${version} arbitrary file write via upload bypass (${cve})"`
   - `dir_list` → `"${service} ${version} directory listing disclosure (${cve})"`
   - `password_reset` → `"${service} ${version} auth bypass allowing ${tier} credential override (${cve})"`
   - `backdoor_port_open` → `"${service} ${version} persistent backdoor on port ${port} (${cve})"`
   - `script_exec` → `"${service} ${version} unauthenticated script execution as ${tier} (${cve})"`

2. **`pickPatternForEffect(service, effect, prng) → AttackPattern`** — attack pattern pool keyed by `(service, effectKind)`. Falls back to a generic syslog pattern when the (service, effect) pair has no dedicated entries. Author 1-3 patterns per meaningful `(service, effectKind)` pair.

## Work breakdown

1. **`describeEffect` helper** (new file `src/generation/describeEffect.ts` + test) — TDD.
2. **Wire walker description** — replace hardcoded template in `generatedVuln.ts:157`. Update `generatedVuln.test.ts` to assert effect-coherent descriptions.
3. **`pickPatternForEffect` helper** — rework `GENERATED_ATTACK_PATTERNS` into `(service, effectKind)` keyed shape. New file `src/generation/attackPatterns.ts` (or extend `generatedVuln.ts`) + test.
4. **Wire walker attack patterns** — replace service-keyed lookup with `pickPatternForEffect`. Update tests.
5. **Rewrite 39 hand-authored entries** — for each:
   - Swap real CVE ID for fake (format `CVE-YYYY-NNNN`, year ≤ 2025, serials we author).
   - Pick effect kind from the service's plausible set (guided by `SERVICE_EFFECT_POOLS` in `effectPicker.ts`). Aim for reasonable spread across the 8 kinds.
   - Rewrite `description` via `describeEffect` output OR a hand-tuned variant that still matches the effect.
   - Rewrite `attackPattern` via `pickPatternForEffect` OR a hand-tuned variant that still matches the effect.
6. **Update dependent tests** — any test asserting specific CVE IDs (e.g., `CVE-2021-44228`) or RCE wording on walker output.
7. **Verify** — `npm run build`, `npm run lint`, `npm run format`, `npm run test:run`.
8. **Version bump + commit + PR.**

## TDD plan

Each helper lands with tests first:

- `describeEffect.test.ts`: one test per effect kind, asserting the description contains key markers (service name, version, CVE id, effect-specific verb like "file read" / "script execution" / "port NNNN").
- `attackPatterns.test.ts`: for each `(service, effectKind)` that has dedicated patterns, assert picker returns one of them; for unmapped pairs, assert it falls back to a generic syslog pattern tagged with the daemon name.
- `generatedVuln.test.ts`: update existing assertions to check description comes from `describeEffect` (not hardcoded), and pattern is effect-aware. Keep determinism tests.

## Risks / call-outs

- **Pool churn.** `GENERATED_ATTACK_PATTERNS` gets restructured; anything that imports it breaks. Quick grep planned.
- **Hand-authored effect redistribution changes gameplay balance** on day 0. Previously uniform `shell_limited`; now a mix. Considered a net-positive gameplay change; no-backward-compat policy means we don't need a migration.
- **Existing tests** that hard-code real CVE strings or descriptions break. Expected — update alongside the rewrite.
- **CVE ID uniqueness**: walker starts at year 2026. Hand-authored will use 2020-2025 with 4-digit serials to avoid collision with walker's 7-digit serials starting at year 2026.

## Progress

- [x] Branch created: `feat/vuln-effect-coherence`
- [x] Plan written
- [x] `describeEffect` helper + test (10 tests)
- [x] Walker description wired + coherence invariant test added
- [x] `pickPatternForEffect` helper + test (11 tests)
- [x] Walker attack patterns wired
- [x] Hand-authored entries rewritten — 39 entries, fake CVE IDs in `CVE-2024-9NNN` namespace, 5 distinct effect kinds for day-0 variety
- [x] `findExploitableCve.ts` synthetic stubs made effect-coherent (bonus scope — same principle applied)
- [x] Dependent tests updated (msfconsole, nmap, apt, vulnerabilityLookup, findExploitableCve)
- [x] Coherence invariant tests added on hand-authored pool
- [x] Build / lint / format / tests all green (2440 tests passing)
- [x] Version bump + PR
