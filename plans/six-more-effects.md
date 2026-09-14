# Plan: Phase 3 Slice 5 — Six More Effects

**Epic:** `plans/legacy-parity-epic.md` — Phase 3 (the "V" series), slice 5. Prior slice
close-out: "Phase 3 slice 4 — the defender patches" (#498, #499, v0.214.0–v0.215.0), plus the
own-LAN scan fix detour (#500, #501, v0.216.0–v0.217.0).

**Status:** Active — PR1 (file_read + dir_list) shipped at v0.218.0 (#502). PR2 (password_reset) is next, branching from updated `main`.

**Delivery:** Five independent PRs, sequenced to trunk (NOT a stack). Each merges to `main`;
the next branches from updated `main`. They share a seam (the effect branch in the exploit
handler and `msfconsole`) but no hard dependency — each is independently observable and
shippable, and each un-built effect keeps collapsing to a limited shell until its own PR lands.

**Branch for PR2:** `feat/exploit-password-reset` (PR1 shipped from `feat/exploit-read-effects`).

---

## Goal

Make the six non-shell CVE effects do their real work — instead of collapsing to a limited
shell (decision 31) — against own-LAN targets. `hydra` gets its job back, and
`password_reset` becomes the route by which a player earns a plaintext they did not already
hold (unblocking D2.6b's wordlist progression).

## The one property that makes this safe

**The roll is frozen; only what an effect DOES changes.** `SERVICE_EFFECT_POOLS` and the
seeded draw in `exploitEffect.ts` are final and pinned in `exploitEffect.test.ts` — this slice
never re-rolls which effect a CVE has, only what firing it produces. So nothing already
published moves (same discipline slice 2 applied to the timeline walk).

**Decision 31's collapse is removed one effect at a time.** Today every effect flows through
`shellFor` → `'limited'` → the handler mints an `exploit_limited` session. Each PR peels its
effects off that default and gives them their real behavior; the effects a later PR owns keep
collapsing to a limited shell until then. This keeps every intermediate `main` shippable and
preserves the invariant a refusal still means exactly one thing — **the CVE is not live on
that box** — while a *built* effect now does its real work and an *un-built* one still hands a
limited shell.

## Scope boundary (locked, decision 34)

**Own-LAN targets only** — NPC siblings, the `.1` gateway, the seeded edge router: exactly what
`handleExploitCreateSession` reaches today. Every cross-player question (whose journal, whose
log, whose source IP, the public / forward / deep routes) is answered together in **slice 6**.
The first player-vs-player CVE therefore lands in slice 6, after the trace has been exercised
against NPCs for two slices. Decision 39 (`apt install pkg=<version>` downgrade-only pinning)
is likewise deferred to slice 6, where it pairs with the cross-player persistence beats.

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 8 | The eight effect kinds. `shell_full`/`shell_limited` mint sessions; `backdoor_port_open` writes an `nc` pidfile patch with D5 chain forwarding; `password_reset` writes an `/etc/passwd` patch; `file_read`/`dir_list` need only a server-computed read payload; `file_write`/`script_exec` need a CVE-authorized write and exec path. |
| 9 | Severity → tier: `critical`→root, `high`→user, `medium`/`low`→guest. This is the effect's `tier` — the account the effect targets and the privilege the read/write runs at. |
| 13 | `nmap -sV` reports version + CVE id + severity, never the effect. **Firing is the reveal** — including learning "this exploit needs a target path." |
| 21 | `password_reset`: overwrite the tier's `/etc/passwd` hash with `md5("pwned-<last4-of-cve>-<tier>")`, tell only the attacker the plaintext, no recovery hint in the trace. |
| 23 | `msfconsole` runs from a script: a state-changing effect still fires; a shell effect **reports** (`root shell available on <host>`) instead of pushing a session the script cannot enter. `withoutScript` comes off. |
| 31 | The collapse being unwound. The roll is final; a not-yet-built effect collapses to a limited shell. |
| 34 | Cross-player deferred to slice 6 — this slice is own-LAN only. |

## Server surface — one handler, discriminated result

Extend `handleExploitCreateSession` (`src/core/sessions/exploitCreateSession.ts`); do NOT add a
second action. The regenerate → replay-journal → `canBoot` → `portsOpenToNetwork` filter →
resolve version → `exploitOutcome` → write-trace preamble is identical for every effect and
already there. Branch on `outcome.effect` **after** authorization:

- `shell_full` / `shell_limited` → mint a session (today's path, unchanged).
- `file_read` / `dir_list` → read the materialized+patched FS at the requested path, tier-gated
  by the same permission logic `cat`/`ls` already use; return the payload. No session, no patch.
- `file_write` / `password_reset` / `backdoor_port_open` → apply a patch through the
  `upsertPatch` dep the handler already holds; return an ack (and, for `password_reset`, the
  plaintext).
- `script_exec` → run the supplied script against the target through the D9 runner; return an ack.

The request schema gains ONE optional third-argument field (the path / `local:remote` / script
body / script path the player typed). The client cannot know the effect before firing, so it
always sends whatever third token was typed (or none). When the computed effect needs an
argument and none was sent, the server returns a discriminated `needs-arg` result and the client
prints the usage line — the reveal-by-firing decision 13 already sanctions. The response becomes
a discriminated union on effect; `msfconsole.ts` renders each shape.

Because these are `api/` behavior changes, **each PR that touches the handler extends the
wire-check** `scripts/testExploitOwnLan.ts` against `vercel dev` + supabase (the a11y of the
`api/` layer: `npm run vercel:dev`, ports 54421/54422, healthy = `400 envelope_invalid`).

## The third-argument grammar (decision 23)

| Effect | 3rd arg | Interactive output (own-LAN) |
|---|---|---|
| `file_read` | `<path>` | `[+] Reading <path> (as <tier>):` + contents, or `[-] File not found or permission denied (as <tier>): <path>` |
| `dir_list` | `<path>` | `[+] Listing <path> (as <tier>):` + entries, or `permission denied` |
| `file_write` | `<local:remote>` | `[+] Uploaded <local> → <remote> as <tier> (<N> bytes)` |
| `password_reset` | — | `[+] Password reset for '<user>' — new password: pwned-XXXX-<tier>` |
| `backdoor_port_open` | — | `[+] Backdoor planted on port <port>` |
| `script_exec` | `<path>` | `[+] Script injected on <host> as <tier>` (blind — side effects only, no output) |

Wording is a starting point ported from legacy `msfconsole.ts`; final phrasing is settled per
PR at RED time. From a script, `file_write`/`password_reset`/`backdoor_port_open`/`script_exec`
still act, and `shell_full`/`shell_limited` report rather than push.

---

## Slices

All five are **behavior change**: RED-GREEN-REFACTOR increments; the mutation-or-alternate
gate runs once per PR at PR readiness; each handler-touching PR carries its wire-check. Bump
the version in both `v2/package.json` and `v2/package-lock.json` per PR (0.217.0 → 0.218.0 …).

### PR1 — file_read + dir_list (the read payload + the third-arg seam) — SHIPPED v0.218.0 (#502)

Both read effects read the target tier-gated and mint no session; a blind fire reveals the CVE
and asks for a path. Verified by RED-GREEN unit tests, a scoped mutation gate (the read tier
gate and each read/list failure's wording pinned), and a 26/26 live own-LAN wire-check. The
discriminated response + `needs-arg` reveal + the shared read-effect handler branch are the
seam PR2–PR5 build on.

**Value:** A player fires a CVE that rolled `file_read`/`dir_list` and gets a tier-gated read of
a file or directory on the target, instead of a limited shell.
**Actor/trigger/outcome:** player runs `msfconsole <host> <port> <path>` on an own-LAN box whose
service rolled a read effect → the file contents / directory entries print, gated by the
effect's tier; a path the tier cannot read answers `permission denied`.
**Path:** `msfconsole.ts` → `env.exploit.run` (+ third-arg field) → `handleExploitCreateSession`
branches `file_read`/`dir_list` → reads `materializeMachineFs` at the path, tier-gated → returns
payload → client renders. Introduces the discriminated response + the `needs-arg` reveal.
**Acceptance:**
- A `file_read` roll returns the target file's contents, gated at the effect's tier; a
  higher-privilege path is refused with `permission denied (as <tier>)`.
- A `dir_list` roll returns the directory entries at the effect's tier.
- Firing a read effect with no path returns the usage line, not a session.
- No session row is minted for a read effect; no patch is written.
- Un-built effects (write/reset/backdoor/script) still collapse to a limited shell.
**Evidence:** RED-GREEN unit tests through `msfconsole`/handler; mutation gate; wire-check
extended with a read case (openssh `file_read` is the canonical own-LAN example — decision from
`exploitEffect.test.ts`'s pinned mapping).

### PR2 — password_reset (decision 21)

**Value:** A player earns a plaintext they did not hold — the route D2.6b's wordlist progression
was waiting on.
**Actor/trigger/outcome:** player runs `msfconsole <host> <port>` on a box whose service rolled
`password_reset` → the tier's `/etc/passwd` hash is overwritten with
`md5("pwned-<last4-of-cve>-<tier>")` and the plaintext is printed to the attacker only.
**Path:** handler branch `password_reset` → read `/etc/passwd` (root) → find the tier's user →
overwrite the hash → `upsertPatch` → return the plaintext.
**Acceptance:**
- The tier's account hash becomes `md5("pwned-<last4>-<tier>")`; the attacker sees the plaintext,
  the trace does not name it (recovery is earned, not given).
- A box holding no account at the granted tier refuses and logs, rather than inventing a name.
- A later login with the printed plaintext succeeds (hash round-trips through auth).
**Evidence:** RED-GREEN; mutation gate; wire-check with a reset case + a subsequent auth check.

### PR3 — backdoor_port_open (D5 chain reuse)

**Value:** A CVE plants a quiet `nc` backdoor — a persistence mechanic that leaves a pidfile,
reusing D5's chain forwarding whole.
**Actor/trigger/outcome:** player runs `msfconsole <host> <port>` on a box whose service rolled
`backdoor_port_open` → an `nc` pidfile patch appears at `effect.port` with D5 chain forwarding;
the port is then reachable.
**Path:** handler branch `backdoor_port_open` → write the `nc` pidfile patch (root) via
`upsertPatch`, reusing the D5 pidfile/forwarding shape → return the port.
**Acceptance:**
- The backdoor port opens and is reachable through the same path D5's planted listeners are.
- The pidfile carries the effect's tier so a later shell on it lands at that privilege.
**Evidence:** RED-GREEN; mutation gate; wire-check with a backdoor case + a reachability check.

### PR4 — file_write (local:remote CVE write)

**Value:** A CVE writes a local file onto the target — planting or clobbering content the box
then serves/reads.
**Actor/trigger/outcome:** player runs `msfconsole <host> <port> <local:remote>` on a box whose
service rolled `file_write` → the local file's bytes are written to the remote path at the
effect's tier.
**Path:** handler branch `file_write` → read the client's local content → write the remote path
via `upsertPatch`, tier-gated → return the byte-count ack. Requires the `local:remote` third-arg
form (usage error otherwise).
**Acceptance:**
- The remote path holds the local bytes after firing; a path the tier cannot write is refused.
- Missing / malformed `local:remote` returns the usage line.
**Evidence:** RED-GREEN; mutation gate; wire-check with a write case + a read-back.

### PR5 — script_exec + the decision-23 script grammar

**Value:** A CVE injects and runs a script on the target (D9 runner), and `msfconsole` becomes
scriptable — the last collapse is removed and mass exploitation is finally scriptable, which
D9's own `sweep.js` example was reaching toward.
**Actor/trigger/outcome:** player runs `msfconsole <host> <port> <script-path>` on a box whose
service rolled `script_exec` → the local script runs blind on the target at the effect's tier.
AND: from a `node` script, every state-changing effect still fires while `shell_full`/
`shell_limited` report (`root shell available on <host>`) instead of pushing a session.
**Path:** handler branch `script_exec` → run the supplied script through the D9 runner against
the target → return an ack. Drop `withoutScript` from `msfconsole`; make the shell branches
report-not-push when `env` indicates a scripted run.
**Acceptance:**
- A `script_exec` roll runs the script blind (side effects only, no target output).
- `msfconsole` runs from a script; a scripted shell effect reports and mints no session the
  script cannot enter; a scripted state-changing effect changes state as interactively.
- D9's per-line-snapshot rule stays intact.
**Evidence:** RED-GREEN; mutation gate; wire-check with a script case; a scripted-run test
proving the report-not-push grammar.

---

## Out of scope (recorded, not forgotten)

- **Cross-player effects** (whose journal / log / source IP; public / forward / deep routes) —
  slice 6.
- **`apt install pkg=<version>` downgrade-only pinning** (decision 39) — slice 6.
- The effect **roll** and the severity→tier table — frozen; not touched here.
