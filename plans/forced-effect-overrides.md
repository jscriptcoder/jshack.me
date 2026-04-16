# Plan: forcedEffect on Port — Seed Keyword Overrides + SSH Closure Recovery

**Branch**: feat/forced-effect-overrides
**Status**: Active

## Goal

Add a `forcedEffect` field to `Port` that overrides the vulnerability's natural effect, controllable via seed keywords and automatically applied when SSH is closed — fixing the broken SSH-closed recovery path and giving testers fine-grained control over vulnerability scenarios.

## Context

**The problem:** v0.82.0 removed `bash()` from nc shell, making it read-only recon. When SSH is closed on a machine, the player has no way to restart sshd — there's no guarantee a `script_exec` vulnerability exists on any port. The SSH-closed recovery path is broken.

**The solution:** Two consumers of the same mechanism:

1. **SSH closure enrichment** — when SSH is closed on a machine, `applyPortClosures` stamps `forcedEffect: { kind: 'script_exec', tier: 'root' }` on one of the open ports (preferring FTP since it's guaranteed open). This ensures the player can always `msfconsole(target, ftpPort, '/script.js')` to inject a script that starts sshd.

2. **Seed keywords** — players/testers can force a specific effect + tier on the target machine via seed keywords. Extends the existing `parseSeedOverrides` pattern.

**Seed keyword syntax:**

Effect keywords (force effect on target machine):

- `shell-limited`, `shell-full`, `file-read`, `dir-list`, `file-write`, `password-reset`, `backdoor-port`, `script-exec`

Tier keywords (force the tier of the forced effect):

- `tier-root`, `tier-user`, `tier-guest`

Examples:

```
HEIST-ssh-script-exec-tier-root-hard    → target gets script_exec at root tier
test-file-read-tier-guest               → target gets file_read at guest tier
BANK-JOB-shell-full                     → target gets shell_full (tier from PRNG)
```

**How `forcedEffect` works at runtime:**

- `Port.forcedEffect?: VulnerabilityEffect` — optional field on the Port type
- `findExploitableCve` checks `port.forcedEffect` first. If present, it clones the base vulnerability but substitutes the forced effect. If no base vulnerability exists, it synthesizes a minimal one.
- `nmap -sV` shows the forced effect in its hint (same as natural effects)
- From the player's perspective, a forced effect is indistinguishable from a natural one

**Where `forcedEffect` is applied:**

1. **Seed keyword → target machine:** After `buildMissionObjective` picks the target, `generateMissionNetwork` applies the forced effect to the first exploitable port on the target machine.
2. **SSH closure → closed machine:** `applyPortClosures` stamps `script_exec` root on the FTP port (or another open port) when closing SSH.

## Acceptance Criteria

- [ ] `Port` type has an optional `forcedEffect` field of type `VulnerabilityEffect`
- [ ] `findExploitableCve` returns a vulnerability with the forced effect when `port.forcedEffect` is set, even if the port has no natural vulnerability
- [ ] Seed keyword `script-exec` forces `script_exec` effect on the target machine's first exploitable port
- [ ] Seed keyword `tier-root` / `tier-user` / `tier-guest` controls the tier of the forced effect
- [ ] All 8 effect kinds have corresponding seed keywords
- [ ] When SSH is closed on a machine, one open port gets `forcedEffect: { kind: 'script_exec', tier: 'root' }`
- [ ] Player can use `msfconsole` against a forced-effect port and get the expected behavior
- [ ] `nmap -sV` displays the correct effect hint for forced-effect ports
- [ ] Existing seeds without effect keywords produce identical networks (no PRNG sequence change)
- [ ] All existing tests pass
- [ ] Documentation updated

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test.

---

### Step 1: Add `forcedEffect` field to `Port` type

Add the optional `forcedEffect` field to `Port` in `src/network/types.ts`.

**RED**: Write a type-level test or compile-time check that `Port` accepts `forcedEffect`. Practically: write a test in `findExploitableCve.test.ts` that creates a port with `forcedEffect` and expects `findExploitableCve` to return a vulnerability with that effect.

**GREEN**: Add `forcedEffect?: VulnerabilityEffect` to the `Port` type. Update `findExploitableCve` to check `port.forcedEffect` first — if present, either override the natural vulnerability's effect or synthesize a minimal vulnerability when none exists.

**MUTATE**: Run mutation testing on `findExploitableCve`.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: `findExploitableCve` returns forced effects, synthesizes a vulnerability when no natural one exists, and all existing tests still pass.

---

### Step 2: Parse effect + tier seed keywords in `parseSeedOverrides`

Extend `SeedOverrides` with `forcedEffectKind` and `forcedEffectTier` fields. Parse 8 effect keywords and 3 tier keywords from the seed string.

**RED**: Write tests for `parseSeedOverrides` that:

- `'test-script-exec'` → `forcedEffectKind: 'script_exec'`
- `'test-shell-full'` → `forcedEffectKind: 'shell_full'`
- `'test-tier-root'` → `forcedEffectTier: 'root'`
- `'test-script-exec-tier-guest'` → both fields set
- `'test-no-effect'` → both fields undefined
- All 8 effect keywords parse correctly
- All 3 tier keywords parse correctly

**GREEN**: Add the keyword parsing to `parseSeedOverrides`. Add fields to `SeedOverrides` type.

**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: All 8 effect + 3 tier keywords parse correctly, no PRNG sequence change for seeds without keywords.

---

### Step 3: Apply seed-keyword forced effect to target machine

After `buildMissionObjective` picks the target, apply the forced effect to the first exploitable port on the target machine in `generateMissionNetwork`.

**RED**: Write test in `generateMission.test.ts` that:

- Seed with `script-exec-tier-root` produces a target machine with a port that has `forcedEffect: { kind: 'script_exec', tier: 'root' }`
- Seed without effect keywords produces no `forcedEffect` on any port
- The forced effect port is exploitable via `findExploitableCve`

**GREEN**: In `generateMissionNetwork`, after building the objective, find the target machine, pick its first open non-SSH port, and stamp `forcedEffect` built from the overrides.

**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: Seed keywords produce forced effects on target machine ports, no effect without keywords.

---

### Step 4: Stamp `forcedEffect` on SSH-closed machines in `applyPortClosures`

When SSH is closed on a machine, stamp `forcedEffect: { kind: 'script_exec', tier: 'root' }` on one of its open ports (prefer FTP port 21, fall back to any open port).

**RED**: Write test in `enrichment.test.ts` that:

- Machine with SSH closed has at least one port with `forcedEffect: { kind: 'script_exec', tier: 'root' }`
- The forced effect port is open (not the closed SSH port)
- Dual closure (both SSH + FTP closed) stamps forced effect on the NC backdoor port
- Machines without SSH closure have no `forcedEffect`

**GREEN**: In `applyPortClosures`, after closing SSH, find the best open port and add `forcedEffect`.

**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: SSH-closed machines always have a `script_exec` root forced effect on an open port.

---

### Step 5: Remove objective-type skip for SSH closures that are now solvable

With forced `script_exec` on SSH-closed machines, some objectives no longer need to skip closures entirely. Evaluate and relax:

- **sabotage** — player can inject `rm('/boot/vmlinuz'); reboot()` via script_exec. But `reboot` and `rm` are not in the target command context yet. **Defer** unless we add them.
- **backdoor** — player can inject `nc("-l", port)` via script_exec. The target context already has `nc` (listen mode). **Can relax.**
- **script_fix / script_auto** — player needs interactive file editing on target. **Skip remains.**
- **portforward** — player needs iptables on router. **Skip remains.**

**RED**: Write test that `backdoor` objective type no longer skips port closures (machines can have SSH closed).

**GREEN**: Remove `backdoor` from the skip list in `applyPortClosures`. (Only if Step 4 is solid.)

**MUTATE**: Run mutation testing.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Assess.
**Done when**: `backdoor` objectives allow port closures. Other objectives remain skipped with rationale documented.

---

### Step 6: Update documentation

- `src/generation/README.md` — document `forcedEffect` mechanism
- `.claude/docs/mission-variations.md` — add effect/tier keywords to seed keywords table, update port closures section
- `.claude/docs/infrastructure-design.md` — document `forcedEffect` on `Port`, update SSH closure recovery path
- `.claude/docs/architecture.md` — mention forced effects in vulnerability system description
- `src/network/README.md` — document `forcedEffect` field on `Port`
- `README.md` — add effect keywords to seed examples if applicable

**Done when**: All docs accurate and `npm run format` passes.

---

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — run `mutation-testing` skill
2. Refactoring assessment — run `refactoring` skill
3. `npm run build` passes
4. `npm run lint` passes
5. `npm run format` passes
6. `npm run test:run` passes

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
