# Plan: Cross-Machine Credentials & Web Credential Exposure

**Branch**: feat/lateral-credentials
**Status**: Active

## Goal

Add realistic lateral movement breadcrumbs: cross-machine credentials in root/user-owned files (~30% per machine) and web-discoverable credentials on any machine serving HTTP/HTTPS/HTTP-ALT (~30% chance), plus fix a gobuster NAT resolution bug.

## Context

Currently, credential leaks are same-machine only and guest-owned (world-readable) for privilege escalation. HTTP entry credentials only appear on HTTP-entry-variant machines. Players rely entirely on tools (hydra, SNMP) for lateral movement. This feature adds an alternative: after escalating on a machine, find credentials for other same-layer machines in realistic locations (deploy scripts, backup configs, ansible playbooks). Additionally, any web-serving machine can expose credentials via curl/gobuster, not just HTTP-entry machines.

## Design Decisions

- **Cross-machine creds are NOT world-readable** — owned by root or the regular user, requiring privilege escalation first. This creates a two-step loop: escalate -> discover -> move laterally.
- **Same-layer only** — cross-machine credentials reference machines in the same subnet layer (realistic: same admin, same network segment).
- **~30% probability** — matches existing credential leak chance. Low enough to not trivialize tool-based hacking.
- **Web credentials on any HTTP-serving machine** — ports 80 (http), 443 (https), 8080 (http-alt) all qualify. ~30% chance. Reuses body-based and header-based template patterns.
- **PRNG stability** — new PRNG calls are appended after existing calls in `buildMachineConfig` to minimize seed disruption. Each new feature always consumes its PRNG calls for sequence stability.

## Acceptance Criteria

- [ ] Cross-machine credential leaks appear on ~30% of non-target machines with realistic templates
- [ ] Cross-machine leaks are root-owned or user-owned (not guest)
- [ ] Cross-machine leaks reference valid same-layer machine credentials
- [ ] Web credentials appear on ~30% of non-HTTP-entry machines with open HTTP/HTTPS/HTTP-ALT ports
- [ ] Web credentials support both body-based and header-based (.headers sidecar) discovery
- [ ] Gobuster correctly resolves NAT for ports 443 and 8080 (not just 80)
- [ ] All existing tests pass (seed-dependent tests updated as needed)
- [ ] PRNG consumption is deterministic (always same number of calls per machine)

---

## PR 1: Fix gobuster NAT resolution for non-80 ports

Small bugfix. Gobuster hardcodes `resolveNat(targetIP, 80)` instead of using the parsed port, so NAT resolution fails for HTTPS (443) and HTTP-ALT (8080).

### Step 1: Test and fix gobuster NAT resolution

**Test**: Write a test that calls gobuster with a URL on port 8080 (or 443) against a machine behind NAT. Assert it resolves to the correct internal machine's web root (currently fails because it resolves port 80 NAT).

**Implementation**: In `src/commands/gobuster.ts` line 170, change `resolveNat(targetIP, 80)` to `resolveNat(targetIP, parsed.port)`.

**Done when**: Gobuster returns correct results for `http://router:8080` and `https://router` URLs when NAT maps those ports to different internal machines.

---

## PR 2: Cross-machine credential leak templates

Pure data PR — add the template pool and types. No wiring yet.

### Step 2: Define cross-machine credential template type

**Test**: Write a test that validates all cross-machine templates have required fields: `path`, `content` with `{{target_ip}}` and `{{target_username}}` and `{{target_password}}` placeholders, and `owner` of `'root'` or `'user'`.

**Implementation**: In `src/generation/pools/credentials.ts`:

- Add `CrossMachineCredentialLeakTemplate` type with `path`, `content` (string with `{{target_ip}}`, `{{target_username}}`, `{{target_password}}`), `owner: 'root' | 'user'`, and optional `binary` flag.
- Add `crossMachineCredentialLeakTemplates` array with ~15-20 realistic templates.

Template categories:

- **Deploy/automation** (root-owned): `/root/.ssh/config`, `/opt/deploy/hosts.ini`, `/opt/ansible/inventory.yml`, `/root/deploy.sh`
- **Backup scripts** (root-owned): `/etc/cron.d/backup`, `/opt/backups/sync.sh`, `/root/.netrc`
- **App configs** (user-owned): `/home/{{owner}}/projects/app/.env`, `/home/{{owner}}/.bash_history` (with ssh/scp commands showing passwords)
- **Service configs** (root-owned): `/etc/supervisor/conf.d/tunnel.conf`, `/opt/docker/docker-compose.yml` with remote DB hosts

Templates use `{{target_ip}}`, `{{target_username}}`, `{{target_password}}` for the remote machine, and `{{owner}}` for the file owner's home directory path.

**Done when**: Templates export, type-check, and all have the required placeholders.

---

## PR 3: Cross-machine credential placement wiring

Wire the templates into the generation pipeline.

### Step 3: Build same-layer credential mapping in generateFileSystems

**Test**: Write a unit test for a new `buildSameLayerCredentials` helper: given layers and a credential map, for a machine IP it returns credentials of other machines in the same layer (excluding self). Verify it returns empty for single-machine layers.

**Implementation**: In `src/generation/filesystem/generateFileSystems.ts`:

- Add helper function `buildSameLayerCredentials(layers, credentials)` that returns a `Map<string, ReadonlyArray<{ip, username, password}>>` — for each machine IP, the credentials of other same-layer machines.
- Build this map before the per-machine loop.

**Done when**: Helper correctly maps machines to their same-layer peers' credentials, handles edge cases (single-machine layer, router layer).

### Step 4: Add placeCrossMachineCredentialLeak function

**Test**: Write unit tests for `placeCrossMachineCredentialLeak`:

1. When PRNG roll < 0.3 and same-layer credentials exist, a file is placed with correct content referencing the target machine's IP and credentials.
2. File is owned by root or user (never guest).
3. When PRNG roll >= 0.3, no file is placed but PRNG calls are still consumed.
4. When no same-layer credentials available, no file is placed but PRNG calls consumed.
5. `fillTemplate` correctly replaces `{{target_ip}}`, `{{target_username}}`, `{{target_password}}`.

**Implementation**: In `src/generation/filesystem/machineConfig.ts`:

- Add `CROSS_MACHINE_LEAK_CHANCE = 0.3`
- Add `placeCrossMachineCredentialLeak(prng, sameLayerCreds, extraDirectories, etcExtraContent)` function following the same pattern as `placeCredentialLeak()` but:
  - Picks a random target from `sameLayerCreds` (3rd PRNG call)
  - Uses `crossMachineCredentialLeakTemplates` instead
  - Sets file owner to template's `owner` field (root or user)
  - Always consumes 3 PRNG calls for stability

**Done when**: Function correctly places cross-machine credential files with proper ownership and content.

### Step 5: Wire placeCrossMachineCredentialLeak into buildMachineConfig

**Test**: Integration test using `generateFileSystems` with a known seed: verify that a machine with a cross-machine leak has a file referencing a valid same-layer machine's IP and credentials. Verify the file is NOT guest-owned.

**Implementation**:

- Add `sameLayerCredentials` to `BuildMachineConfigOptions`
- In `generateFileSystems`, compute the same-layer credential map and pass it to each `buildMachineConfig` call
- In `buildMachineConfig`, call `placeCrossMachineCredentialLeak()` after the existing `placeCredentialLeak()` call
- Skip placement on target machines (target shouldn't leak credentials for other machines)

**Done when**: End-to-end generation produces cross-machine credential leaks on ~30% of eligible machines with valid same-layer references.

---

## PR 4: Web credential exposure on non-entry machines

### Step 6: Define web credential templates for non-entry machines

**Test**: Validate all web credential templates have `webPath`, `content` with `{{username}}`/`{{password}}`, and optional `sidecarHeader`.

**Implementation**: In `src/generation/pools/credentials.ts`:

- Add `webCredentialTemplates` array — a curated subset of `httpEntryCredentialTemplates` that make sense for non-entry machines (misconfigured `.env`, leaked config backups, debug endpoints with headers).
- These expose same-machine credentials (SSH user/password for the machine being curl'd).
- ~10-12 templates mixing body-based and header-based.

**Done when**: Templates export and type-check. Mix of body and header types.

### Step 7: Add placeWebCredentials function

**Test**: Write unit tests for `placeWebCredentials`:

1. When PRNG roll < 0.3 and machine has non-root/non-guest creds, a web file is placed in htmlChildren.
2. Header-based templates create `.headers` sidecar files.
3. When PRNG roll >= 0.3, no file placed but PRNG calls consumed.
4. When machine is HTTP entry, function is skipped (already has entry credentials).

**Implementation**: In `src/generation/filesystem/machineConfig.ts`:

- Add `WEB_CREDENTIAL_CHANCE = 0.3`
- Add `placeWebCredentials(prng, machineCreds, htmlChildren)` — similar to `placeHttpEntryCredentials` but with probability gate and using `webCredentialTemplates`.
- Always consumes 2 PRNG calls for stability.

**Done when**: Function places web-discoverable credentials with both body and header variants.

### Step 8: Wire placeWebCredentials into buildMachineConfig

**Test**: Integration test: generate a network with a known seed, find a non-HTTP-entry machine with an open web port, verify it has web credentials discoverable via curl (body content or headers).

**Implementation**:

- In `buildMachineConfig`, after the existing HTTP entry credential block:
  - If `!isHttpEntry` and machine has an open HTTP/HTTPS/HTTP-ALT port, call `placeWebCredentials()`
  - This runs after web content generation so `htmlChildren` already has the index.html

**Done when**: Non-entry web machines have ~30% chance of exposing credentials via curl/gobuster.

---

## PR 5: Update seed-dependent tests and documentation

### Step 9: Fix seed-shifted tests

**Test**: Run full test suite, identify any seed-dependent tests that broke due to new PRNG consumption.

**Implementation**: Update test seeds or expected values for tests broken by the new PRNG calls. Use `scripts/dumpMissionNetwork.ts` and `scripts/dumpHomeNetwork.ts` to find replacement seeds.

**Done when**: `npm run test:run` passes.

### Step 10: Update documentation

**Implementation**: Update:

- `.claude/CLAUDE.md` — document cross-machine credentials, web credential exposure, new template types
- `.claude/docs/architecture.md` — lateral movement section
- `.claude/docs/infrastructure-design.md` — credential placement details
- `.claude/docs/mission-variations.md` — if applicable
- `src/generation/pools/README.md` or similar module docs
- Memory files — mark this feature as complete, remove from "upcoming work"

**Done when**: All docs reflect the new credential system.

---

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing -- run `mutation-testing` skill
2. Refactoring assessment -- run `refactoring` skill
3. Typecheck and lint pass
4. DDD glossary check (if applicable)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
