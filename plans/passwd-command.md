# Plan: the `passwd` command — change an account's password

**Status:** grill complete + plan drafted + find-gaps pass (2026-10-23) — ready to implement
(TDD). Not yet started.

A player-facing `passwd` command that rewrites an account's md5 hash in `/etc/passwd`.
On the player's own workstation it changes their own account (user/guest/root). On a
foreign box (NPC or another player) a root session can rewrite any account's hash,
locking the owner out of `su`. It is the write-mirror of `su` (`src/core/commands/su.ts`),
which already reads `/etc/passwd` at root on the own box, lets the server answer elsewhere,
and prompts masked via `env.prompt`. The cross-player write rides the existing patch
journal (`upsertPatch`) and its L1/L2 gates (`authorizeMachineAccess` +
`remoteWritePermission`) — no new persistence mechanism.

---

## Grill record (2026-10-23)

_Decisions are numbered as they are confirmed. Open questions sit at the bottom until resolved._

1. **Own box: faithful setuid rule.** On the player's own workstation, `passwd` (no
   argument) changes the account the caller is currently sitting as (guest, user, or root),
   allowed at **any tier** — modelling a setuid-root `passwd`, the write-mirror of how `su`
   already reads `/etc/passwd` at root regardless of caller tier. `passwd <user>` for a
   named account other than the caller's own requires the caller to be **root**. So a guest
   can change the guest password and a user the user password without rooting their own box,
   but changing `root`'s (or another user's) password means `su root` first. Rejected: a
   simpler "any `passwd` requires root," which real Linux never demands for one's own account.

2. **Foreign box: root required for any `passwd`.** On any box that is not the caller's own
   workstation (NPC or another player), every `passwd` — own-named account or another —
   requires an active **root** session on that host. This aligns with the existing L2 gate
   (`remoteWritePermission`): only root may write the root-owned `/etc/passwd` on a foreign
   host, so a user-tier foreign write is already denied with no special-casing. Getting root
   is the price of the lockout: with root on A's box, `passwd root` locks A out of `su root`
   and `passwd <A's user>` locks that user. Rejected: a faithful cross-box setuid rule where
   a user-tier foreign shell could change that user's own password — a thinner realism
   argument on a box that isn't yours, and it would need the server to bypass L2 for the
   self-account case.

3. **Old-password prompt for a non-root caller changing their own account.** When the caller
   is **not** root and is changing their **own** account (only possible on the own box — see
   1 and 2), `passwd` first prompts `Current password:` (masked via `env.prompt`) and compares
   `md5(typed)` to the stored hash, exactly as `su` does; a mismatch fails without touching the
   file. **Root is never asked** for the old password — neither own-box root changing anyone,
   nor the foreign-box case (always root). So the prompt appears in exactly one situation: a
   user/guest changing their own password on their own box. Rejected: skipping it because the
   caller already holds the session — it is the most recognizable piece of real `passwd`, costs
   one masked prompt in one case, and reuses machinery `su` already has.
   - **Empty-hash exception (refines 3, find-gaps 2026-10-23).** The prompt is **skipped when
     the account being changed currently has an empty hash** (a password-less account, e.g. a
     default `guest`), exactly as `su`'s `needsPassword = userType !== 'root' && hash !== ''`
     does. Otherwise the check could never pass — `md5(anything)` is a 32-char hex string,
     never the empty string — and decision 1's promise that "a guest can change the guest
     password" would be impossible. So a guest with an empty hash goes straight to `New
     password:`; a user with a real hash is still prompted.

4. **New-password entry: double masked prompt, must match, no quality rules, empty rejected.**
   `passwd` prompts `New password:` then `Retype new password:`, both masked via `env.prompt`.
   A mismatch prints `passwd: Sorry, passwords do not match` and aborts non-zero with nothing
   written (a single clean failure, no retry loop — as `su` treats a bad password). No
   strength/quality checks (these are game tokens; "players learn the hard way" — no nagging):
   any non-empty string is accepted and stored as `md5(new)`. An **empty** new password is
   rejected with `passwd: No password supplied` and nothing written — an empty hash means a
   password-less account in this engine (`su` treats it specially), so a stray Enter must not
   silently strip an account's password.

5. **Interactive-only, no scripted form.** `passwd` depends on masked prompts, and scripts
   stub `env.prompt` as `NOT_IMPLEMENTED('prompt')`, so a scripted `passwd` simply fails on
   the prompt exactly as `su` does today. We add no non-interactive escape hatch — no
   `passwd <user> <newpass>` args, no `chpasswd`. This matches the engine's standing rule that
   credential entry (`su`, `ssh`, `mail login`) never happens in a script, and real `passwd`'s
   own interactive-only nature (`chpasswd` is the scripted tool, which we don't ship). The
   lockout stays a deliberate manual act: "root the box, then change its password" cannot be
   bundled into one automated script.

6. **A password change affects future authentication only; existing sessions survive.** Like
   real `passwd` (and unlike the findit *restore*, which reboots and kicks shells), changing an
   account's hash does **not** end anyone's open session on that account — no kill, no
   downgrade, no reboot. Only the next `su`/`ssh` is affected. The lockout bites when the
   victim's standing session on that account lapses (exit, disconnect, reboot) and they try to
   authenticate with the old password. Deliberate consequence: a victim who is **actively root**
   when struck can fight back — still root, they can `passwd root` straight back — a genuine
   duel rather than an unconditional instant lockout. Against the common case (victim not
   currently sitting as root) the lockout is immediate on their next `su`. Rejected: findit-style
   session-killing, which belongs to the operator restore, a heavier and different act.

7. **No victim notification, but a real `auth.log` breadcrumb.** (a) The victim gets **no**
   proactive signal — no message, mail, or nudge; they learn the hard way when the next `su`
   fails with the usual `Authentication failure`. (b) `passwd` leaves a real-`passwd`-style
   line on the target box's `/var/log/auth.log`, e.g. `passwd[pid]: password changed for
   <user>`, reusing the mechanism `su` already writes to (own box via `appendAuthLog`; foreign
   box via the server-side trace path `su` already uses). A later root — or the guardian's
   round — can `cat /var/log/auth.log` to see that and when the password changed, and the
   write's existing `writer_key` provenance (`traceProvenance`) can trace who. The act is
   harsh but not invisible. Rejected: a silent change (stealthier but less real) and victim
   notification (softens the mechanic against "learn the hard way").
   - **Success only; failures are not logged (refines 7b, find-gaps 2026-10-23).** The
     `auth.log` line is written on a **successful** change only — unlike `su`, which logs both
     outcomes. The only failure that can reach a log point is an own-box wrong-current-password
     (decision 3); foreign writes are always root with no old-password check (2), and privilege
     refusals are up-front client-side with no server call (9). That lone failure is always the
     box's own owner fumbling their own password — no second party to inform, no guardian/
     defender value — so logging it would be self-noise. The meaningful event is that a
     password *did* change, and that is what the line records.

8. **Surface is `passwd [username]`, no flags.** The command is named `passwd`. `passwd`
   (no arg) targets the caller's current account; `passwd <username>` targets a named account
   (needs root per 1/2). No flags — no `-l`/`-u` (lock/unlock), `-S` (status), or `-e`
   (expire). Per the standing rule "commands are not real-command clones; a missing flag is
   not a bug," the lock/expire/status machinery is extra mechanic for little play value, and
   "lock an account" is already reachable by setting a password nobody knows.

9. **Error cases, up-front refusals, no self-lockout safety net.**
   - **Unknown account:** `passwd: user '<name>' does not exist` (mirrors `su`'s wording),
     including when the box has no `/etc/passwd` at all (a rooted owner deleted it — no
     accounts, so the name doesn't exist).
   - **No-arg target resolution (find-gaps 2026-10-23).** `passwd` with no argument targets
     `env.session.username` — the account named on the current session row, the same identity
     `su` uses — then looks that name up in `/etc/passwd`. If that account has **no row** (a
     synthetic/exploit session account, or a box whose `/etc/passwd` was deleted), it falls
     through to the unknown-account error above: `passwd: user '<name>' does not exist`. No
     "create the row" behaviour — `passwd` changes existing accounts, it does not mint them.
   - **Privilege refusals happen up front, before any prompt** (the client knows its own
     tier, so prompting then failing is pointless): own box, a user/guest running `passwd
     root` (or another account) → `passwd: you may not change the password for '<name>'`;
     foreign box, a non-root caller running any `passwd` → `passwd: you need root to change
     passwords on this machine`. (Departs from real `passwd`, which prompts first and fails
     after.)
   - **Row integrity:** only field 2 (the hash) is rewritten; `uid:gid:gecos:home:shell` are
     preserved exactly.
   - **Stale-buffer refusal (find-gaps 2026-10-23).** `env.patches.write` refuses the write if
     the box's `/etc/passwd` changed between the read and the write (a second `passwd`, the
     `--local systemctl` row append, an `apt` action). On that refusal `passwd` prints
     `passwd: /etc/passwd changed underneath you — try again` (error), exits non-zero, and
     writes **nothing** — the typed new password is discarded and the player re-runs. Honest,
     recoverable, and matches real `passwd`'s file-locking spirit; silently re-reading and
     re-applying could clobber the other writer, which `baseContent` exists to prevent.
   - **Actor success feedback (find-gaps 2026-10-23).** On a successful change `passwd` prints
     `passwd: password updated successfully` (normal output) and exits 0, on both own and
     foreign boxes. Unlike `su` (which stays silent because it hands you a visibly new shell),
     `passwd` has no other visible effect, so this line is the actor's only confirmation the
     change landed — and on a foreign box, the attacker's confirmation the lockout is set.
   - **Self-lockout: no safety net.** No confirmation, no recovery. Change your own root
     password and forget it and the only way back is the operator **restore** script,
     consistent with "every machine is attackable → the remedy is an operator restore." You
     lock yourself out, you learn the hard way.
   - **Prompt-abort and scripted calls inherit `su` (find-gaps 2026-10-23).** No bespoke
     handling: cancelling any of the three masked prompts (Ctrl-C) returns exit 130 and writes
     nothing, exactly as `su` does; a scripted `passwd` hits `NOT_IMPLEMENTED('prompt')` and
     fails like a scripted `su` (decision 5), no special message.

---

## Enforcement & persistence (how the decisions map to the engine)

- **Own box** writes to `/etc/passwd` are authorized by **L1** alone (own workstation by
  suffix match; L1 bypasses L2 — `remoteWritePermission` says so). The privilege rule in
  decision 1 (own account free; another account needs root) is therefore **client-enforced**
  on the own box. This is acceptable: an own-box write is **self-affecting only** — a tampered
  client that wrote its own `/etc/passwd` gains nothing it couldn't get by `su root` on a box
  whose root password it set. No cross-player stakes.
- **Foreign box** writes are **server-authoritative**: L1 confirms an active session there,
  **L2 (`remoteWritePermission`) confirms the session tier may write the root-owned
  `/etc/passwd` — i.e. root** — which is exactly decision 2. A tampered client cannot forge
  this; `upsertPatch` server-stamps `writer_key` from the verified pubkey and rejects any
  client-claimed key.
- **Persistence** rides the existing patch journal keyed by `machine_id` (own-box read keys on
  the machine, foreign writes coexist by `writer_key`). A changed hash is a patch on
  `/etc/passwd` that the server keeps and hides from everyone but a reader who regains access —
  the same path the `--local systemctl` hole already uses to append to `/etc/passwd`.
- **Reads already honor the new hash:** both `su` and the ssh auth gates
  (`authCreateSession*`) read the account hash through `passwdAccount.ts`, which parses the
  live (patched) `/etc/passwd`. No reader change is needed — the lockout falls out.

---

## What's new vs reused

**Reused as-is:**
- `env.prompt({ masked: true })` — the three masked prompts (current/new/retype), the same
  primitive `su` uses.
- `md5` (`core/generation/md5.js`) — hash the new password.
- `passwdAccount.ts` — parse `/etc/passwd` rows (account lookup, tier derivation); reused for
  "does this account exist" and to find the row to rewrite.
- `env.fs.stat` root read on the own box (setuid-style, as `su` reads passwd) to obtain the
  current file to compose against.
- `env.patches.write(PASSWD_PATH, rewritten, { baseContent })` — own-box write authorized by
  L1; `baseContent` guards a stale buffer (two writers racing on `/etc/passwd`), exactly as an
  editor's foreign write does.
- L1/L2 gates (`authorizeMachineAccess` + `remoteWritePermission`) — foreign write gated to
  root with zero new code.
- `commandRegistry` — add one import to the `builtins` array in `registry.ts`.

**New:**
- `core/commands/passwd.ts` — the command module (parsing, refusals, prompts, row rewrite).
- A row-rewrite helper beside `passwdAccount.ts` (`PASSWD_PATH`/`PASSWD_OWNER` already live
  there) that replaces **only field 2** of a named row and re-serializes, preserving
  `uid:gid:gecos:home:shell` and the rest of the file.
- An `auth.log` formatter + event: a `passwdChange` variant on `AuthLogEvent`
  (`core/commands/types.ts`) and a `formatPasswdLine` in `core/logging/authLog.ts`
  (`passwd[pid]: password changed for <user>`), server-stamped like the existing su line.
- Foreign server handler: a `passwd` write endpoint (new, or an extension of the patches
  endpoint) that authorizes the root session (L1/L2), writes the `/etc/passwd` row patch, and
  **server-stamps the `auth.log` line** — mirroring `authElevateSession.ts`, which already
  reads the box's auth.log, stamps UTC time + pid, and appends the line as a patch. This is
  the one genuinely new server-side piece and the main wire-check target.

## Open implementation question (resolve at planning, not a product decision)

**Own box auth.log vs foreign box auth.log.** The own-box line can go through the existing
`appendAuthLog` endpoint (own-workstation-only) with the new `passwdChange` event. The foreign
line cannot — `appendAuthLog` refuses a non-own target — so it must be stamped by the foreign
`passwd` handler itself, the way `authElevateSession` stamps the foreign `su` line.
**Recommended:** a dedicated server `passwd` handler that does both the row patch and the
server-stamped log in one authorized request (not two client calls), so a crafted client can't
write the row without the trace or forge the timestamp.

---

## TDD slices (each leaves the tree green)

Ordered so every increment is shippable and testable through the command's public interface
(a `core/commands/passwd.test.ts` with the fake `commandEnv` factory, as `su.test.ts` does).
Behaviour tests first (RED), minimum code to GREEN, assess refactor, repeat. No mutation
harness between increments — once at the end-of-phase PR gate.

1. **Surface + refusals (own box, no write yet).** `passwd` parses `[username]`; up-front
   privilege refusals (decisions 1, 9): a user/guest running `passwd root` → `you may not
   change the password for 'root'`; unknown account → `user '<name>' does not exist`. RED
   tests for each message and exit code.
2. **Own-box self-change with the old-password gate (decisions 3, 4).** Non-root caller:
   `Current password:` → `md5` compare (fail = abort, nothing written); then `New password:` /
   `Retype new password:` → mismatch abort, empty rejected; success writes the rewritten row
   via `env.patches.write` and the row integrity holds (only field 2 changes). Assert the
   written content through the patch spy.
3. **Own-box root-changes-another (decision 1).** Root skips the old-password prompt and may
   target any account; the setuid read (`env.fs.stat`) lets it find the row. The `auth.log`
   line via `appendAuthLog` + the new `passwdChange` event + `formatPasswdLine` (decision 7b).
4. **Foreign-box root write (decisions 2, 6, 7).** Non-own box: non-root caller refused up
   front (`you need root…`); a root session composes against the foreign `/etc/passwd` (read
   as an editor reads a foreign file) and writes through the server handler; existing sessions
   untouched (decision 6 — asserted by the reader: `accountIn` now returns the new hash while
   no session row is removed). Server-stamped foreign `auth.log` line.
5. **Wire-check (`scripts/test*.ts` vs `vercel dev` + supabase).** The `api/` claims that
   can't be unit-proven: a root session on a foreign box rewrites its `/etc/passwd` and the
   change persists + hides from the owner; a non-root foreign write is **refused** by L2; the
   server stamps the `auth.log` line (client can't forge time); the owner's next `su`/ssh with
   the old password now fails and with the new one succeeds; and a `passwd` whole-file rewrite
   composes correctly **over a prior `/etc/passwd` patch from a different writer** (e.g. the
   systemctl-hole row append) rather than erasing it.

## Evidence & gates

- **Unit:** `core/commands/passwd.test.ts` (jsdom not needed — pure core command), plus
  formatter/helper tests beside their modules.
- **Wire-check:** slice 5 above — the only proof the foreign authorization + server-stamped
  log actually hold against the real stack.
- **Mutation gate:** once at PR-readiness over the accumulated scope (Stryker, repo doc's json
  reporter, scoped to the new files, capped concurrency — per the known-good run recipe).
- **Browser run:** deferred to epic/feature close-out (slice PRs merge without one; a single
  E2E pass covers them) — a B-attacks-A lockout played live.
- **Version bump** on the feature in `package.json` + `package-lock.json`
  (`npm install --package-lock-only`); `npm run typecheck` (`tsc -b`) and `npm run lint` green;
  every relative import ends `.js`.

## Out of scope / deferred

- `-l`/`-u` lock/unlock, `-S` status, `-e` expire (decision 8).
- A scripted/`chpasswd` form (decision 5).
- `/etc/shadow` modelling — the game keeps the hash in `/etc/passwd` directly (deliberately
  md5); no shadow split.

---

## Gaps closed — find-gaps session, 2026-10-23

Resolved (7):
```
[Blocker → decision 3]        Empty-hash account could never pass the old-password check →
                              skip the prompt when the stored hash is empty (mirrors `su`)
[Should  → decision 9 + §5]   Stale-buffer write refusal → message + nothing written, plus a
                              slice-5 wire-check that a rewrite composes over another writer's
                              prior /etc/passwd patch
[Should  → decision 9]        No-arg target = `env.session.username`; missing row falls through
                              to the unknown-account error (no row minting)
[Should  → decision 7b]       Failures are not logged — success only (the lone failure is the
                              owner fumbling their own password; self-noise)
[Should  → decision 9]        Actor success feedback → `passwd: password updated successfully`
[Nice    → decision 9]        Ctrl-C prompt-abort inherits `su` (exit 130, nothing written)
[Nice    → decision 9]        Scripted `passwd` fails like scripted `su` (decision 5)
```
Parked: none. No cross-decision contradictions found.
