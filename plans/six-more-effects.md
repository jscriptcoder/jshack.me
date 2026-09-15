# Plan: Phase 3 Slice 5 — Six More Effects

**Epic:** `plans/legacy-parity-epic.md` — Phase 3 (the "V" series), slice 5. Prior slice
close-out: "Phase 3 slice 4 — the defender patches" (#498, #499, v0.214.0–v0.215.0), plus the
own-LAN scan fix detour (#500, #501, v0.216.0–v0.217.0).

**Status:** Active — PR1 (file_read + dir_list) shipped at v0.218.0 (#502), PR2 (password_reset) at
v0.219.0 (#503), PR3 (backdoor_port_open) at v0.220.0 (#504), PR4 (file_write) at v0.221.0 (#505),
PR5 (scriptable `msfconsole`) at v0.222.0 (#506). PR6 (script_exec) is next, branching from updated
`main` — its design is now settled (the client runs the script, the server validates and applies its
writes) and carries the `WORLD_EPOCH` move; see its section.

**Delivery:** Six independent PRs, sequenced to trunk (NOT a stack). Each merges to `main`;
the next branches from updated `main`. They share a seam (the effect branch in the exploit
handler and `msfconsole`) but no hard dependency — each is independently observable and
shippable, and each un-built effect keeps collapsing to a limited shell until its own PR lands.

**Branch for PR6:** `feat/exploit-script-exec` (PR1 shipped from `feat/exploit-read-effects`, PR2
from `feat/exploit-password-reset`, PR3 from `feat/exploit-backdoor-port`, PR4 from
`feat/exploit-file-write`, PR5 from `feat/msfconsole-scriptable`).

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

All six are **behavior change**: RED-GREEN-REFACTOR increments; the mutation-or-alternate
gate runs once per PR at PR readiness; each handler-touching PR carries its wire-check — PR5
touches no handler and so carries none, which its own section argues. Bump
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

### PR2 — password_reset (decision 21) — SHIPPED v0.219.0 (#503)

The granted tier's hash becomes `md5("pwned-<last4-of-cve>-<tier>")`, the plaintext goes back to
the attacker alone, and no session is minted. Verified by RED-GREEN unit tests, a scoped mutation
gate (`exploitCreateSession` 96.73%, `passwdAccount` 94.44%) and a 31/31 live own-LAN wire-check
that ends by logging in over the box's own ssh door with the plaintext it handed over.

**Two facts this PR established, which PR3–PR5 inherit.** First, an effect is reachable only once
a release CARRYING it has published, and no package's starting release rolls one — so the box has
to be walked onto that release through the journal, exactly as `apt upgrade` does, before the
effect can be fired at all. That applies to unit tests and to the wire-check alike, and it is why
the wire-check pairs a door with a release rather than finding one. Second, because that left
`password_reset` unreachable at game day 13, `WORLD_EPOCH` moved 2026-09-01 → 2026-08-01, putting
the world on day 44 (its staleness tripwire asserts `< 90`).

**Check reachability before planning the next wire-check.** At the versions boxes ship today the
world publishes `file_read`, `dir_list`, `script_exec`, `file_write` and `shell_full` —
`backdoor_port_open` was NOT among them, so PR3 should expect the same walk-forward, and PR4/PR5
should confirm rather than assume.

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

### PR3 — backdoor_port_open (D5 chain reuse) — SHIPPED v0.220.0 (#504)

Firing plants an `nc` listener pidfile on the target and reports the port, minting no session — a
door left standing open rather than somewhere the attacker is now stood. The port is drawn from the
same pool the world's own planted listeners use and is **seeded on the CVE**, so every box running
that release opens the same port; nothing is stored, the server derives it as it plants the door.
A listener already holding that port is overwritten at the effect's tier rather than refused —
the port is a function of the CVE, so a collision is ordinary rather than exceptional, and refusing
there would make a bounce mean something other than "the CVE is not live on that box". Verified by
RED-GREEN unit tests, a scoped mutation gate (`exploitCreateSession.ts` re-measured alone: 168/173
killed, 0 timeouts, zero survivors in the changed branch) and a 36/36 live own-LAN wire-check that
ends by knocking at the planted port and opening through the real auth gate at the granted tier.

**Reachability, and what it means for PR4.** `backdoor_port_open` needed the walk-forward PR2
predicted: no shipped version rolls it, so the wire-check reaches it by pairing a findable daemon
with a release that carries it (vsftpd 4.0.0, user tier). No epoch move was needed this time — day
44 already had one, unlike PR2. **PR4 looks different:** `file_write` IS among the effects the world
publishes at shipped versions (see PR2's note above), so it may need no walk at all — since
confirmed, and recorded under PR4 below.

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

### PR4 — file_write (local:remote CVE write) — SHIPPED v0.221.0 (#505)

The bytes come from the CLIENT — the server regenerates the target and has no view of the
attacker's filesystem — and a local file the shell cannot read stops the fire before the target
hears anything. Verified by RED-GREEN unit tests, a mutation gate (473 mutants, 82 → 70 survivors
after six added tests, 390 → 402 killed with no new survivors) and a 45/45 live own-LAN wire-check.

**What PR5 inherits, and the one open question.** The account gate was relaxed: `file_read`,
`dir_list` and `file_write` now answer ABOVE the refusal that requires an account at the granted
tier, because an effect aiming at a file needs nobody to BE — it acts AS the tier. Without that,
this hole was unreachable at all (snmp is guest-tier on root-only routers). **PR5 must decide which
side of that gate `script_exec` sits on**: it targets neither a file nor an account, and running as
a tier nobody holds is a live design question, not a mechanical port. Also inherited: the
`readOpenPorts` door-finder, for any effect whose door `doorsOn` cannot produce. Reachability looks
clear — PR2's survey lists `script_exec` among the effects the world publishes at shipped versions,
so like PR4 it likely needs no walk-forward; confirm rather than assume.

Gameplay consequence, recorded: a rooted player can no longer close a `file_read` hole by deleting
the account at its tier. It was never the way in.

**Reachability — confirmed, and PR4 is the exception.** `snmp` rolls `file_write` at the version
every box ships (the mapping `exploitEffect.test.ts` pins), and generated manifests really are built
from `startingVersionOf` rather than from the newest release — so unlike PR2 and PR3 there is **no
walk-forward to arrange**. The hole is `CVE-2026-0712758`, medium, published day 4, which puts the
effect at **guest** tier. Reachability is pinned rather than rolled: `buildApGatewayBaseFs` sets
`hasSnmp: true`, so every network's `.1` gateway runs the agent by construction.

**The wire-check's own door-finder cannot see it, though**, for two independent reasons — this is the
work PR4 has to do before it can write a write case. `doorsOn` enumerates ports through
`hostServices`, which rolls against `placementOf`; snmp's flat `placement` is 0, and its only
non-zero cells sit under the `router`/`switch` roles, which `roleOfHostname` never returns. The agent
is planted by the router builders instead, so that roller yields an snmp door for no host at all.
Separately, `doorsOn` keeps only a door with an account at the effect's tier — and routers are
root-only filesystems while this effect is guest-tier, so it would be dropped a second time. PR4's
wire-check therefore has to find its door with `readOpenPorts` against the gateway's planted pidfile,
and the tier-account filter needs rethinking for an effect whose target is a file rather than an
account.

Confirmed by running the probe against the live generators, not only by reading them: across six
unrelated ESSIDs every `.1` gateway answered on 161 with `net-snmp 5.9.4` and reported
`CVE-2026-0712758` **from its own manifest read**, `hostServices` yielded zero snmp doors across 54
hosts, and every gateway's account list came back `[root:root]` — so the tier-account filter drops a
guest-tier effect there with certainty rather than merely probably. Unproven and not to be leaned
on: ssh is rolled rather than pinned on the AP gateway, so its port 22 is not guaranteed.

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

### PR5 — `msfconsole` becomes scriptable — SHIPPED v0.222.0 (#506)

The script adapter marks every call it makes, and the two shell branches read that mark and report
the door rather than pushing a session the caller could never enter — symmetrically, `Full shell
available on` against `Limited shell available on`, because a script BRANCHES on that line and
matching "Got shell" against "Full shell" would mean knowing an asymmetry to see a difference.
Everything that acts rather than lands a shell behaves exactly as it does at the prompt. Verified
by RED-GREEN unit tests through both the adapter and the command, a scoped mutation gate (599
mutants across the three files in scope, 68 survivors, none of them in the code this added) and
the 45/45 wire-check re-run UNCHANGED, since no `api/` behavior moved.

It also cleared the limited-shell coverage debt: the two mutants PR3 named are dead, measured
rather than asserted — `exploitCreateSession.ts` was put in mutation scope deliberately for that
reason, though this PR does not change it.

**Honest note for whoever reads this later.** The `shell_limited` test and the two scripted-effect
tests are CHARACTERIZATION, not RED-first — they pin behaviour that already worked, and the
mutation result is what earns them their place. The three behavioural increments (the gate,
report-not-push, the wording split) were genuinely red first.

**Why this was its own PR.** The plan originally paired this with `script_exec`. The two separated
once the runner was actually read rather than cited: `runScript` builds an `AsyncFunction` over
player-supplied source and injects a context assembled from `CommandEnv`, and nothing server-side
runs scripts at all. "Run the script on the target through the D9 runner" therefore describes
evaluating a player's JavaScript inside the Vercel function — real code execution on our own
infrastructure, the one thing in this repo that would not be simulated. The scriptable half needs
none of that, is independently valuable, and ships first.

**Value:** Mass exploitation becomes scriptable — what D9's own `sweep.js` example was reaching
toward. A script fires a CVE at every host a scan found and branches on what came back.
**Actor/trigger/outcome:** a `node` script calls `await msfconsole(host, port)` → every
state-changing effect acts exactly as it does interactively, while a shell effect REPORTS the
door instead of pushing a session the script could never have entered.
**Path:** `commandContext` threads a scripted marker onto the env it already builds per call
(`{ ...env, scripted: true }` — the shape `runLine` uses for `stdin`); `msfconsole` drops
`withoutScript`, and its shell branches report rather than push when that marker is set. No
handler branch is added: this PR changes no `api/` behavior.
**Acceptance:**
- `msfconsole` runs from a script; the refusal is gone.
- A scripted `shell_full` roll reports the door, calls no `pushSession`, and leaves the cwd.
- A scripted `shell_limited` roll reports too, worded apart from a full shell — a script told
  "full" that then cannot pivot has been lied to by its own tool.
- An INTERACTIVE shell roll still pushes the session and still moves the cwd.
- Read, list, write, reset and backdoor behave identically scripted and interactive.
- A scripted fire's stdout is ordinary stdout carrying `.exitCode`; a refusal still exits 1.
- D9's per-line-snapshot rule stays intact.
**Evidence:** RED-GREEN through `msfconsole` and `commandContext`; mutation gate on `src/core/**`.
Wire-check `N/A` as an EXTENSION, since no `api/` behavior changes — but run unchanged as a
regression check, which is the alternate evidence this PR records.

**Inherited coverage debt — the limited-shell branch, cleared here.** PR1–PR4 each peeled an
effect off decision 31's collapse, and every one of them returns BEFORE the shell branch, which
is now reached only by a genuine `shell_limited` roll. No unit test exercises one: PR3's mutation
run reports the `'exploit_limited'` literal in `exploitCreateSession.ts` as uncovered, and
inverting `outcome.shell === 'full'` survives.

The door is known rather than hoped for. Walking every package's timeline shows `shell_limited`
is rolled in exactly TWO places in the whole world: `openssh-server` 9.8.3 (index 6, publishes
day 61, high → user, `CVE-2026-0194478`) and `snmp` 5.11.0 (index 19, day 163, medium → guest).
nginx, vsftpd, mysql, redis and bind9 never roll it across 60–77 releases each. A unit test owns
its own clock through `deps.now()`, so the openssh door closes this debt with NO epoch move.

**A correction to what this plan used to claim here.** The old note said "the wire-check still
fires a real limited-shell door every run". It does not. That door is `192.168.78.24:80 (http)` —
nginx index 0, which rolls `script_exec` and reaches a limited shell only through decision 31's
collapse. Deferring `script_exec` keeps it standing; building it does not. See PR6.

### PR6 — script_exec (the client runs it, the server decides what it did)

**Design settled, and the blueprint settled it.** `docs/rewrite-blueprint/sections/03-cve-and-exploits.md`
§3.1.8 has this effect "blindly execute a JavaScript file on the remote machine as the specified
tier", with "no output captured or returned" and "sandboxed — the script cannot call system commands
or reach back to localhost". §3.1.5 then calls `file_write` "the gateway effect for persistence
(plant a backdoor script, then execute it via script_exec)". The two are a designed PAIR, so
plant-with-no-interpreter would not merely risk failing to earn the name — it would collapse two
effects into one and delete the beat the pair exists for. Server-side eval stays rejected for the
reason PR5 opens with: `runScript` builds a real `AsyncFunction` over player-supplied source, and
firing that from the handler would execute player JavaScript inside the Vercel function.

**The shape.** The CLIENT runs the script; the SERVER decides what it is allowed to have done.
`msfconsole <host> <port> <path>` reads the local script through the same tier-scoped view the
`local:remote` half already uses, runs it under `runScript` against the target's regenerated tree
with an fs-only context — no commands, no localhost, which is the blueprint's sandbox stated as a
context rather than enforced as a rule — and COLLECTS the writes it proposes instead of sending them
as they happen. They travel with the one existing exploit fire. The server then re-walks every write
at the granted tier through the same `resolveWriteTarget`/`createFsView` pair the `file_write` branch
already uses, and applies only what that tier could have written itself.

**No new endpoint and no new signed action.** The plan previously assumed one was needed, on the
premise that "a client may only write to a box it holds a session on". That premise is true of the
CLIENT and false of the SERVER, which is the half that matters here: `file_write`, `password_reset`
and `backdoor_port_open` all reach `deps.upsertPatch` today with no session behind them, and
`snmpSet` describes itself as "the only place in the game where a player changes what a machine DOES
without ever standing on it. NO SESSION ROW." The exploit action already IS the CVE-authorized write
channel. What a client genuinely cannot do is read or write the target directly — `listPatches` and
`upsertPatch` both pass `authorizeMachineAccess` — which is exactly why the writes ride the fire
rather than going out on their own.

**Why the client may read the target freely.** It cannot know the tier before it fires — decision 13
makes firing the reveal — so the script runs against an UNFILTERED view and the tier is enforced only
where it persists. That leaks nothing: seed-regen already hands the client the whole generated tree,
so a script reading it learns only what `generateHomeLan` would have told the same client anyway. The
blueprint's own rule survives intact because it is a rule about writes — a guest-tier script still
cannot write a root-owned file, the server having refused it. Two costs, recorded rather than hidden:
the script's reads are not tier-filtered, and they see the box WITHOUT its journal, since the patches
need a session this effect never mints. Both sit comfortably inside an effect the blueprint calls
blind.

**A bare `<path>` is read locally, and failing to read it must NOT stop the fire.** `file_read` and
`dir_list` take a bare path naming a file on the TARGET; `script_exec` takes one naming a file on the
ATTACKER's own box. The client cannot tell which it is holding, so it reads the path locally, blind,
and sends the bytes when it can. Unlike the `local:remote` pair — where an unreadable local half
refuses before anything reaches the network — an unreadable bare path cannot refuse, or every blind
`file_read` aimed at a path this box happens not to have would stop before the daemon ever heard
from it.

**What PR6 must not be surprised by.** Building it removes the LAST collapse. `mintsLimitedShell` in
the wire-check excludes each effect as it gains real behaviour, and `script_exec` is the sixth and
final exclusion — after which the predicate collapses to a single positive check on `shell_limited`
and the exclusion list goes away entirely. The script HARD-EXITS (`process.exit(2)`) when it can find
no limited-shell door, so a real one has to exist before the collapse goes: the nearest genuine
`shell_limited` roll is openssh 9.8.3 at day 61 while the world sits on day 45, so the `WORLD_EPOCH`
move lands in this same PR. **Correction to what this plan said earlier:** the staleness tripwire in
`worldClock.test.ts` ALREADY asserts `toBeLessThan(90)` and needs no edit — moving the anchor back 16
days, to 2026-07-16, puts the world on day 61 and stays well inside that bound.

**Reachability, already confirmed.** `script_exec` is rolled at the version boxes ship by nginx
(1.26.0, index 0, day 9, high → user, `CVE-2026-0269486`), and later by openssh 9.8.2, mysql
8.0.38 and redis 7.3.0. vsftpd, bind9 and snmp never roll it — snmp by design, there being no
interpreter behind an SNMP agent to inject one into.

**Value:** A CVE runs the attacker's OWN script on the target — the persistence lever `file_write`
is the gateway to, and the one effect whose consequences the player composes rather than picks from
a list.
**Actor/trigger/outcome:** player runs `msfconsole <host> <port> <path>` on a box whose service
rolled `script_exec` → the writes the script made land on the target at the effect's tier, and the
fire reports only that it ran.
**Path:** client reads `<path>` from its own box (blind, and non-fatal when it cannot) → `runScript`
over an fs-only context against the regenerated target → the collected writes travel on the existing
exploit fire → handler branch `script_exec` re-walks each write at the granted tier through
`resolveWriteTarget`/`createFsView` → applies the ones that pass → one trace, one ack.

**Acceptance:**
- A script that writes a file on the target leaves that file there after the fire, owned and
  permissioned as a write at the granted tier would leave it.
- A write the granted tier could not have made is dropped while the script's other writes still
  land — the tier is enforced per write, not per script.
- A script that throws partway keeps the writes it completed first. It really ran; the side effects
  it had already caused are not unwound, and the player is told `Script injection failed: <error>`.
- Firing with no path names the CVE and asks for one, the same reveal-by-firing the read effects use.
- A `<path>` this box cannot read does NOT stop the fire — only the `local:remote` pair refuses early.
- The script reaches an `fs` and nothing else: no command is callable and no localhost is reachable.
- Nothing is read back to the player — the ack is `[+] Script injected on <host> as <tier>` and the
  effect stays blind.
- With the collapse removed, `shell_limited` still mints a limited shell, and the wire-check finds a
  GENUINE limited-shell door on the moved epoch rather than a collapsed one.
- Version bumped to v0.223.0 in `package.json` and `package-lock.json`.

**Evidence:** RED-GREEN for each increment; the mutation gate over the changed core; a live own-LAN
wire-check carrying a script case with a read-back, run on the moved epoch so the limited-shell
section proves it found a real `shell_limited` roll.

---

## Out of scope (recorded, not forgotten)

- **Cross-player effects** (whose journal / log / source IP; public / forward / deep routes) —
  slice 6.
- **`apt install pkg=<version>` downgrade-only pinning** (decision 39) — slice 6.
- The effect **roll** and the severity→tier table — frozen; not touched here.
