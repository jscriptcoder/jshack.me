# Plan: Hydra Brute-Force Logging

**Branch**: feat/hydra-brute-force-logging
**Status**: Complete (delete this file on merge)

## Goal

Give defenders a forensic trail on any machine targeted by `hydra`: a single aggregate "brute-force detected" line per attacked service, plus one standard auth-success entry per cracked credential.

## Context

`hydra` is currently the only offensive tool that leaves **zero** trail on the target. Running it against any of its five supported services (`ssh`, `ftp`, `mysql`, `redis`, `snmp`) writes nothing to any log file. This plan closes that gap using the same aggregate-callback pattern already shipped for nmap (v0.91.0) and gobuster (v0.92.0).

Why aggregate + success (not per-attempt):

- A real 30-password × 3-user SSH brute-force would dump ~90 `Failed password` lines plus a success line. Reproducing that per-attempt is realistic but buries other events under noise.
- An aggregate line carries the distinctive signature (rapid burst, same source IP, attempts vs successes ratio) without the flood, matching how fail2ban / mod_security / netfilter LOG surface enumeration attacks.
- A per-success entry using the _normal_ auth-success format (same as `formatSshAccepted`, `formatFtpLoginOk`, etc.) means that when the attacker later uses the cracked credential, the real login blends in with the brute-force-forged one — the player has to correlate _both_ the aggregate and the success line to trace a breach.

## Acceptance Criteria

Observable, player-visible behaviour after the change:

- [ ] Running `hydra <target> ssh` writes exactly one aggregate line to the target's `/var/log/auth.log`, identifying the source IP and the number of authentication attempts.
- [ ] Running `hydra <target> ssh` with one or more crackable users writes one `Accepted password` entry per cracked user to `/var/log/auth.log` — indistinguishable in format from a legitimate `ssh` login.
- [ ] The same pattern holds for `ftp` → `/var/log/vsftpd.log`, `mysql` → `/var/log/mysql.log`, `redis` → `/var/log/redis.log`, and `snmp` → `/var/log/syslog`.
- [ ] Default `hydra <target>` (no service filter, which attacks ssh+ftp) produces one aggregate line and its associated success entries in _each_ service's log file.
- [ ] Aggregate lines carry attempt count and success count so a single `grep` reveals the sweep size and outcome.
- [ ] Source IP honours NAT / cross-network rules (same semantics as existing `resolveLogSourceIP` + `resolveNat`).
- [ ] Cancelling a hydra session before completion writes no log entries.
- [ ] A hydra attempt against a service with zero crackable users still writes the aggregate line (with `0 successes`) — the attempt itself is the forensic signal.
- [ ] All existing tests continue to pass. New behaviour has new tests at every layer (formatter unit tests, hydra callback tests, end-to-end handler tests).

## Non-goals

- Per-attempt `Failed password` lines (ruled out above).
- Reusing `createSshAuthHandler` / `createFtpAuthHandler` directly for the success entries — inline handlers in `useNetworkCommands.ts` (nmap/gobuster pattern) stay consistent with what we just shipped and avoid coupling hydra to the auth-flow handlers.
- Changing any real-ssh / real-ftp auth logging already in place.

## Design Overview

### Callback shape (added to `HydraContext` in `src/commands/hydra.ts`)

```typescript
type HydraService = 'ssh' | 'ftp' | 'mysql' | 'redis' | 'snmp';

type HydraSuccess = {
  readonly username?: string; // absent for snmp
  readonly password?: string; // absent for snmp
  readonly community?: string; // snmp only
};

type HydraBruteForceInfo = {
  readonly targetIp: string;
  readonly port: number;
  readonly service: HydraService;
  readonly attempts: number;
  readonly successes: readonly HydraSuccess[];
};

readonly onBruteForceAggregate?: (info: HydraBruteForceInfo) => void;
```

Fired **once per attacked service** at the end of that service's sweep. Default-mode hydra (ssh+ftp) fires it twice.

### Per-service routing (inline handler in `useNetworkCommands.ts`)

| Service | Aggregate log file    | Aggregate format style                      | Success entry (existing formatter)  |
| ------- | --------------------- | ------------------------------------------- | ----------------------------------- |
| ssh     | `/var/log/auth.log`   | syslog `sshd[pid]: Brute-force…`            | `formatSshAccepted`                 |
| ftp     | `/var/log/vsftpd.log` | vsftpd `BRUTE FORCE: Client…`               | `formatFtpLoginOk`                  |
| mysql   | `/var/log/mysql.log`  | MySQL general-log "Connect"                 | `formatMysqlConnect`                |
| redis   | `/var/log/redis.log`  | Redis `# Client … brute-force…`             | `formatRedisAuth`                   |
| snmp    | `/var/log/syslog`     | syslog `snmpd[pid]: Brute-force community…` | new `formatSnmpCommunityDiscovered` |

All use `resolveLogSourceIP` + NAT-aware `resolveNat` (same as existing handlers).

### File-by-file impact

- `src/logging/formatters.ts` — five new aggregate formatters + one new SNMP-success formatter.
- `src/logging/formatters.test.ts` — unit tests for each.
- `src/commands/hydra.ts` — add `onBruteForceAggregate` to `HydraContext`; fire from each of the three internal flows (`createSnmpAttack`, `createRedisAttack`, `createMysqlAttack`) + the default ssh+ftp flow.
- `src/commands/hydra.test.ts` — new `describe('onBruteForceAggregate callback')` block covering each service.
- `src/hooks/useNetworkCommands.ts` — inline per-service handler, wire it into `createHydraCommand`.
- `src/logging/README.md` — extend the handler + formats table.
- `.claude/docs/architecture.md` — mention hydra in the dynamic-connection-logs section.
- `.claude/docs/infrastructure-design.md` — update log-file routing table.

Rough size: ~400 lines including tests. Comfortably fits one PR.

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test.

### Step 1: Add the five aggregate formatters + SNMP success formatter

**RED**: Add six failing tests to `src/logging/formatters.test.ts`. Each asserts the exact output string for a representative input:

- `formatHydraBruteForceSsh` → `Mar 21 14:30:15 webserver sshd[1234]: Brute-force attempt from 10.0.1.100 — 90 authentication failures, 2 accepted` (syslog shape)
- `formatHydraBruteForceFtp` → `[2026-03-21 14:30:15] BRUTE FORCE: Client "10.0.1.100" — 90 login attempts, 2 successful`
- `formatHydraBruteForceMysql` → MySQL general-log "Connect" event phrased as brute-force
- `formatHydraBruteForceRedis` → `1234:M 21 Mar 2026 14:30:15.000 # Client 10.0.1.100 brute-force attempt — 30 password attempts, 1 authenticated`
- `formatHydraBruteForceSnmp` → `Mar 21 14:30:15 webserver snmpd[1234]: Brute-force community string attempt from 10.0.1.100 — 12 probed, 1 found`
- `formatSnmpCommunityDiscovered` → `Mar 21 14:30:15 webserver snmpd[1234]: Community string "private" accessed from 10.0.1.100`

Also cover zero-success cases and single-digit day padding (following existing formatter test conventions).

**GREEN**: Implement the six formatters in `src/logging/formatters.ts`. Reuse `formatSyslogLine`, `formatVsftpdTimestamp`, `formatMysqlTimestamp`, `formatRedisTimestamp` where possible. No other code changes.

**MUTATE**: Run `mutation-testing` skill on `src/logging/formatters.ts`. Produce report.

**KILL MUTANTS**: Address survivors — most likely around attempts/successes substitution (tests should catch swapping `attempts` for `successes` in the output). Ask human if any survivor's value is ambiguous.

**REFACTOR**: Collapse shared timestamp logic only if duplication exceeds the existing helpers; otherwise skip.

**Done when**: All six formatter tests pass, mutation survivors are killed or consciously accepted, `npm run lint` + `npm run build` clean.

### Step 2: Emit `onBruteForceAggregate` from the SSH+FTP default hydra flow

**RED**: Add tests to `src/commands/hydra.test.ts`:

- `calls onBruteForceAggregate once per attacked service in default (ssh+ftp) mode` — assert callback fired exactly twice with the correct `service`, `port`, and `successes` array.
- `successes include username and cracked password for each wordlist-hit user` — assert each element shape.
- `does NOT call onBruteForceAggregate when scan is cancelled before the service summary schedules` — cancellation safety.
- `calls onBruteForceAggregate with 0 successes when no users are crackable by the wordlist` — negative path must still log.
- `targetIp honours the actual host argument` including when resolved via DNS.

Each test uses the existing `createMockContext` factory plus `vi.fn()` for the callback.

**GREEN**: Add `onBruteForceAggregate?: (info: HydraBruteForceInfo) => void` to `HydraContext`. In the default-mode per-service flow (`serviceUsers.forEach` block in `hydra.ts`), capture `svcResults` into an aggregate and fire the callback once in the service-summary `token.schedule` block. Compute `attempts = users.length * ATTEMPTS_PER_USER`. Compute `successes` from `svcResults`.

**MUTATE**: Mutation-test `hydra.ts` (default-flow block). Ensure attempts/successes swaps, off-by-one on `.length`, and service-name substitution are caught.

**KILL MUTANTS**: Tighten any under-specified test (most likely "attempts exactly equals users.length × ATTEMPTS_PER_USER").

**REFACTOR**: Consider extracting the aggregate-emission into a small helper `emitAggregate(svc, users, results)` if the block is now long. Only refactor if it improves clarity.

**Done when**: New tests pass, existing hydra tests untouched, mutation survivors addressed, lint + build clean.

### Step 3: Emit `onBruteForceAggregate` from SNMP, Redis, MySQL internal flows

**RED**: Three new tests, one per service, in `hydra.test.ts`:

- `snmp mode: calls onBruteForceAggregate with service='snmp' and a `community` value on success`
- `redis mode: calls onBruteForceAggregate with the brute-forced password on success, empty successes on failure`
- `mysql mode: calls onBruteForceAggregate with each cracked {username, password} pair`

Each asserts the exact shape of the `successes` array and correct `attempts` count (matching what the existing UI summary line reports).

**GREEN**: Thread `onBruteForceAggregate` through `createSnmpAttack`, `createRedisAttack`, and `createMysqlAttack`. Fire in each's summary `token.schedule` block. Populate `successes` appropriately per service.

**MUTATE**: Mutation-test each of the three helpers. Watch for: wrong service tag substitution, `found` vs `!found` inversion, swapping `community` ↔ `password` in snmp.

**KILL MUTANTS**: Address survivors.

**REFACTOR**: If all three helpers now share an identical summary-emit pattern, consider a tiny helper. Only if it reads better.

**Done when**: All hydra tests green, all existing callers of the three helpers still work, mutation survivors addressed.

### Step 4: Wire inline handler in `useNetworkCommands.ts` that writes aggregate + success entries

**RED**: This step adds integration behaviour not currently covered by unit tests. Two layers:

1. Extend existing `hydra.test.ts` with an integration-style test: given a spy `onBruteForceAggregate`, invoke hydra end-to-end and assert the callback payload. (Already done in Step 2 — serves as the test.)
2. No new handler test file is added — the handler is inline (nmap/gobuster pattern). Its behaviour is verified by the E2E Playwright test (`npm run test:e2e`) on a mission playthrough that includes hydra, plus a new targeted behavioural assertion in `hydra.test.ts` if the handler-logic is non-trivial.

Failing behavioural test: add to `hydra.test.ts` a test that stands up a fake `logFs` + `onBruteForceAggregate` wired to the real handler logic (copied from `useNetworkCommands.ts` as a local helper for the test), runs hydra against ssh, and asserts that:

- `/var/log/auth.log` on the target gains exactly one syslog-format `Brute-force attempt from …` line.
- `/var/log/auth.log` on the target gains exactly one `Accepted password for <cracked-user> from <ip>` line per cracked user.

**GREEN**: In `src/hooks/useNetworkCommands.ts`, add an inline `onHydraBruteForceAggregate` handler (mirroring the existing nmap inline handler at line ~113). Branch on `info.service`:

- Build the aggregate line via the matching `formatHydraBruteForce*` formatter.
- For each entry in `info.successes`, build a success line via the matching existing formatter (`formatSshAccepted` / `formatFtpLoginOk` / `formatMysqlConnect` / `formatRedisAuth`) or `formatSnmpCommunityDiscovered` for snmp.
- Resolve NAT via `resolveNat(info.targetIp, info.port)` to get the correct log destination IP.
- Resolve source IP via `resolveLogSourceIP`.
- Append each line via `appendToMachineLog` to the service's natural log file.

Pass the handler into `createHydraCommand({ …, onBruteForceAggregate: onHydraBruteForceAggregate })`.

**MUTATE**: Mutation-test the new inline handler block.

**KILL MUTANTS**: Survivors most likely around service-branching (swapping one case for another). Tests must cover all five services.

**REFACTOR**: If the five per-service branches duplicate log-file + formatter wiring, consider a lookup table `{ ssh: { file, fmt, successFmt }, … }`. Only if it improves readability.

**Done when**: Integration test passes, all existing hydra tests pass, `npm run test:e2e` passes (mission playthrough still works end-to-end), lint + build + format clean.

### Step 5: Documentation + version bump + PR

**RED**: N/A — documentation and housekeeping.

**Updates**:

- `src/logging/README.md` — extend "Scan aggregates" subsection to cover hydra; extend "Log Formats" table with the five new lines; extend "Events Logged" table with the five hydra-aggregate rows + the snmp success formatter.
- `.claude/docs/architecture.md` — mention hydra in the dynamic-connection-logs list (`/var/log/auth.log` now also records hydra brute-force aggregates, etc.).
- `.claude/docs/infrastructure-design.md` — add rows to the log-file routing table.
- `README.md` — no change unless the public feature list calls out "hydra leaves a trail" (optional).
- Bump `package.json` `0.93.0 → 0.94.0`; regenerate `package-lock.json` via `npm install --package-lock-only`.

**Done when**: Docs reflect shipped behaviour, version is bumped, PR is opened against `main` with a summary linking to this plan file, all CI-equivalent checks green locally.

## Pre-PR Quality Gate

Before opening the PR:

1. **Mutation testing** — run `mutation-testing` skill across `hydra.ts`, `formatters.ts`, and the new inline handler. Document survivors in the PR description.
2. **Refactoring assessment** — run `refactoring` skill on touched files.
3. **Typecheck + lint + format**: `npm run build && npm run lint && npm run format:check && npm run test:run`.
4. **E2E**: `npm run test:e2e` to confirm the mission playthrough still works (hydra is used in cracking flows).
5. **Manual smoke test** in dev server: run `npm run dev`, crack a home-network SSH machine with `hydra`, then `cat /var/log/auth.log` on the target and confirm both the aggregate and success lines appear with plausible formatting.

## Risks & Edge Cases to Watch

- **Empty-successes aggregate still logs**: tests must explicitly cover `0 successes` — accidentally guarding on `if (successes.length > 0)` would hide the attempt.
- **NAT-forwarded services**: `resolveNat(ip, port)` must be called per service port (not hardcoded to hydra's target IP). Each service may resolve to a different backend — validated by the existing nmap/gobuster precedent.
- **SNMP UDP vs TCP**: the existing SNMP attack already keys on `protocol === 'udp'`. The aggregate formatter must not hardcode `udp` into the log text in a misleading way.
- **SSH + FTP default mode aggregate ordering**: if players' tests assert strict ordering of callback invocations, we need to document which fires first (ssh before ftp in the current loop order).
- **Localhost guard**: `hydra` already refuses localhost. The aggregate should never be triggered against localhost — verified by the existing localhost-throw test.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
