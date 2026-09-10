# Plan: Phase 3 slice 3 — a door opens

**Branch**: `feat/phase3-a-door-opens`
**Status**: Active
**Epic**: [`legacy-parity-epic.md`](./legacy-parity-epic.md) — Phase 3 slice 3. Decisions 1-30 are
locked; decisions 31-35 were settled at this planning session and are recorded in the epic. This
plan implements them and does not reopen them.
**Delivery**: ONE independent PR against `main` (decision 35). Behaviour change, TDD.

## Goal

`msfconsole <host> <port>` fires the CVE `nmap -sV` already names, and a stale NPC service hands
over a shell with no credential — while the box writes down that it happened.

## Acceptance Criteria

- [ ] `msfconsole <ip> <port>` against a generated LAN host whose service has a live CVE opens a
      shell at the tier the severity forecast — `critical` → root, `high` → user, `medium`/`low` →
      guest — with **no password asked at any point**.
- [ ] A `shell_full` grant behaves exactly as an `ssh` hop: it has a TTY, lands in the account's
      home directory, and can `ssh` onward. A `shell_limited` grant behaves exactly as an `nc`
      backdoor shell: no TTY, so `ssh`, `nano` and every prompting command refuse it.
- [ ] The session is a **server-authorized row** of kind `exploit` / `exploit_limited` at the
      granted tier. Every existing gate treats it as an ordinary session — including `rm
      /boot/vmlinuz` on a root grant.
- [ ] The target records the break-in in **the same log its credential sweeps already land in**,
      through a `formatExploit` formatter on its own catalog row, and **the line names the CVE**.
- [ ] A port whose service has **no live CVE** refuses the exploit and writes a bounce line to that
      same log. A port with **no service** (a planted `nc` listener) has nothing to fire and nothing
      to write.
- [ ] A port the owner has **filtered** is not a door, whatever is behind it.
- [ ] The attacker's failure message is identical for "not vulnerable" and "nothing listening
      there", so a refusal leaks nothing about the box.
- [ ] `msfconsole` needs `apt install metasploit` first and runs from whatever box the player is
      standing on.
- [ ] `man msfconsole` documents the command.
- [ ] The wire carries it: a new `scripts/testExploitOwnLan.ts` proves the session row, its tier and
      the target's trace line live against `vercel dev` + supabase.
- [ ] Version bumped in `v2/package.json` **and** `v2/package-lock.json`.

## Slices

### Slice 3: msfconsole opens a shell on a stale NPC service, and the box writes it down

**Value**: Everything slice 2 renders becomes actionable. Until now the player watches the world
get worse; this is the first move they can make with what a scan told them, and the first door in
the game that opens with no credential at all.
**Path**: `msfconsole <ip> <port>` → `addressForTarget` → `env.exploit.run` → signed
`exploitCreateSession` on `api/sessions.ts` → regenerate the target's FS → `portsOpenToNetwork` +
`readOpenPorts(fs, { gameDay })` → `exploitOutcome` → session row + `formatExploit` append →
`pushSession` client-side.
**Class**: Behaviour change.
**Delivery**: Independent PR against trunk. No stack.
**Required implementation skills**: `tdd`, `testing`; `refactoring` if the effect pools earn a split
once written; `mutation-testing` at PR readiness.
**Reduction program**: N/A.
**Transition/terminal evidence**: N/A.

**Acceptance criteria**: the plan-level list above, in full. **Confirmed with the owner before any
code.**

**RED**: Seven increments, each failing first. The load-bearing ones are the tier ladder, the
limited shell's missing TTY, the server refusing a filtered port, the trace naming the CVE, and the
bounce line a non-vulnerable port still writes.
**GREEN**: The minimum for each increment. No `--local`, no non-shell effect, no `apt upgrade`.
**REFACTOR**: Assess whether the per-service effect pools earn their own module once written. Start
in `exploitEffect.ts`.
**PRE-PR MUTATION**: One Stryker run over `src/core/cve/exploitEffect.ts`,
`src/core/sessions/exploitCreateSession.ts`, `src/core/commands/msfconsole.ts`,
`src/core/logging/exploitLog.ts`. Conventions §4: `npm run encode` first, `--reporters json,progress`,
read `reports/mutation/mutation.json`, name the production files explicitly so `*.test.ts` is not
mutated, and **read the timeout column** — a timeout counts as killed and inflates the score.
**PR-ready when**: every acceptance criterion is met, the mutation gate is run and its valuable
survivors addressed, `npm run typecheck` and `npm run lint` pass, and the complete non-watch suite is
green. Owner approves the commit.
**Slice complete when**: the PR lands.

## Increments (RED → GREEN order inside the one PR)

1. **What a CVE grants.** `src/core/cve/exploitEffect.ts`: the eight effect kinds, the per-service
   pools ported from legacy `effectPicker.ts`, `tierForSeverity`, and `exploitOutcome(key, service,
   gameDay)` returning `{ cve, severity, effect, shell, tier }`. The six kinds slice 5 builds
   collapse to a **limited** shell (decision 31) — the roll itself is final, so slice 5 changes
   interpretation and re-rolls nothing. *RED*: every catalog service has a non-empty pool; the same
   CVE rolls the same effect twice; all four severities map to their tier; an unbuilt kind yields a
   limited shell and `shell_full` a full one. **The effect draws on its own PRNG stream**, so slice
   2's four golden CVE pins do not move.
2. **The seven formatters.** `src/core/logging/exploitLog.ts` plus a **required** `formatExploit`
   on `SweepLog` (decision 32), filled for all seven catalog rows. Both outcomes come from the one
   formatter family and land in the row's existing destination. *RED*: a success line names the CVE;
   a failure line names it too and reads as a bounce; each row's line is recognisably its own
   daemon's; the type refuses a row without one.
3. **Two session kinds.** `SessionKind` gains `exploit_limited`; `hasTty` excludes it beside `nc`;
   `HOP_KINDS` gains `exploit` only; `isCrossPlayerHop` gains both (decision 33). *RED*: a limited
   shell refuses `ssh` with the no-TTY message and a full one does not; a refresh restores a full
   exploit shell onto the stack and ends a limited one.
4. **The server action.** `src/core/sessions/exploitCreateSession.ts`, mirroring
   `authCreateSession`: verify the envelope → resolve the host on the CALLER's regenerated LAN →
   `canBoot` → recompute `gameDay` from the SERVER's clock → `portsOpenToNetwork` for the filter →
   `readOpenPorts(fs, { gameDay })` for the CVE → derive effect and tier → mint the row → append the
   trace. *RED*: a live CVE mints a row at the right tier and kind; a filtered port is not a door; a
   port inside its safe window refuses AND logs the bounce; a listener-only port refuses and logs
   nothing; a bricked box refuses; the tier decides which account the shell lands as.
5. **The command.** `src/core/commands/msfconsole.ts` + registry + `env.exploit` wiring, reachability
   mirroring `ssh`'s dispatch. *RED*: a vulnerable host prints the CVE and pushes the session; an
   unreachable address answers as `ssh` does; a non-vulnerable port and a listener-only port produce
   the SAME message; no password is ever prompted; `man msfconsole` renders.
6. **Nothing leaks into the scan.** *RED*: `nmap -sV` output is byte-identical to today for a host
   whose CVE now has an effect and a tier — the scan's answer and the exploit's answer are two
   functions, and only firing reveals the second.
7. **The wire.** `scripts/testExploitOwnLan.ts` live against `vercel dev` + supabase: the row lands
   with the tier the client showed, the target's log gains a line naming the CVE, and a port with no
   live CVE bounces and is written up.

## Threading map

**New server action (1 site):** `api/sessions.ts` gains `exploitCreateSession` beside its existing
seventeen, sourcing `gameDay` from `gameDayAt(asEpochMs(Date.now()))` exactly as the three scan
actions already do.

**New client seam (3 sites):** `CommandEnv.exploit` in `commands/types.ts`, wired in `ui/env.ts` and
`ui/state.ts` the way `ssh.authenticateSameLan` already is.

**Gains a required column (1 type, 7 rows):** `SweepLog.formatExploit` in `services/serviceCatalog.ts`.

**Gains a member (4 sites):** `SessionKind` in `commands/types.ts`; `hasTty` in `shell/runLine.ts:74`;
`HOP_KINDS` in `ui/sessionRehydrate.ts:41`; `isCrossPlayerHop` in `ui/activeRoot.ts:86`.

**Untouched:** every scan path, `nmap`, `liveCve`, `readOpenPorts`, and all four existing
`authCreateSession*` handlers.

## Design notes settled during planning

- **`liveCve` does not grow the effect.** The scan's answer and the exploit's answer stay two
  functions — `liveCve` says what a CVE IS, `exploitOutcome` says what firing it gets you. A single
  function returning both would leave the effect one field away from the scan output that decision
  13 forbids it from carrying, on the very call both the client and the server already make.
- **The exploit reuses `readOpenPorts`, filtered by `portsOpenToNetwork`.** Slice 2 already put the
  CVE on the port; the exploit asks the same question the scan asks, then honours the owner's filter
  exactly as `reachDoor` does. A port a defender filtered is not a door, whatever is behind it.
- **The http row's exploit trace lands in `auth.log`, not `access.log`.** The epic's own example says
  otherwise, but the rule in the same decision — reuse that row's `sweepLog` destination — is what
  keeps one service's evidence in one file. The http row's `sweepLog` is auth.log by INHERITANCE and
  the catalog already says so in its own comment; moving the web door's evidence to `access.log`
  would move its credential sweeps too, and that is a correction of its own, recorded as a follow-up
  rather than smuggled in here.
- **The failure message is deliberately uninformative.** "Not vulnerable" and "nothing listening"
  read identically to the attacker, the same way `authCreateSession` collapses unknown-user and
  wrong-password into one 401. The defender's log is where the difference lives.
- **No new `CommandEnv` clock or day.** The server recomputes `gameDay` from its own clock; the
  client never sends one.

## Scope narrowed at planning — needs owner sign-off

- **Decision 23's script grammar moves to slice 5.** `msfconsole` gets `withoutScript` in this
  slice. Decision 23 exists so that a scripted exploit still changes state while a shell effect
  merely reports — but under decision 31 **every** effect in slice 3 is a shell, so a scripted run
  could only ever report, would mint a row nobody enters, and would write a trace for an exploit the
  player then has to fire again from the prompt. The grammar earns its keep the moment a non-shell
  effect exists, which is slice 5.

## Out of scope

`msfconsole --local` and library CVEs (slice 8). The six non-shell effects (slice 5). Fellow
occupants and every cross-network route — public IPs, NAT forwards, inner gateways, the deep chain
(slice 6, decision 34). `apt upgrade`, so nothing in this slice can be patched shut; a port refuses
only because its CVE has not published yet. Firmware (slice 9). `reboot` evicting the session
server-side (slice 7) — a shell opened here outlives the defender's reboot until then.

## Pre-PR Quality Gate

1. Implementation complete; refactor assessment recorded.
2. Mutation gate run once over the accumulated scope; valuable survivors addressed.
3. `npm run typecheck` and `npm run lint` pass (from `v2/`).
4. Complete non-watch suite green; watchers stopped.
5. Wire-check run live against `vercel dev` + local supabase.
6. Version bumped in `package.json` and `package-lock.json`.

---
*Retire this plan into the epic's close-out log on completion, as D3-D10, X1 and slices 1 and 2 each
were, then delete the file.*
