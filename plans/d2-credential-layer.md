# D2 split — a player cracks a credential instead of being told it

> **Status: D2.1 ✅ SHIPPED (v0.111.0). D2.2 ✅ SHIPPED (v0.113.0). D2.3 or D2.5 next.**
> Authored 2026-07-31 (`story-splitting`), grounded against the shipped code (every file:line
> below was read, not recalled). Parent: [`legacy-parity-epic.md`](./legacy-parity-epic.md)
> Phase 1, D2.
>
> Both shipped plans' files have been deleted on close-out; their as-built lives in
> [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) and in the D2.2 row
> below. Findings 1–5 were all confirmed by building them — read them before planning a later
> slice.
>
> **The difficulty curve as shipped** — the whole credential layer reduces to this table, and
> nothing else in the game decides what falls:
>
> | knob | value | measured | role |
> |---|---|---|---|
> | `guest` | 1.00 | 100% | the always-open door; the cross-player loop rests on it |
> | `npcUser` | 0.70 | 70.3% | the routine win: sweep a LAN, get footholds |
> | `gateway` | 0.40 | 37.0-38.9% | the pre-vulnerability route to root, at every depth |
> | `npcRoot` | 0.12 | 11.9% | ~one crackable root per eight-host LAN |
>
> Measured over 2024 generated hosts and 2000 doors per gateway kind. The gateway figures sit
> below the knob because systematically-generated seeds converge slowly — see the population
> warning below before "correcting" one.

## Parent

> **A player can obtain a machine's credentials by attacking it, and can grow that
> ability by harvesting passwords other players and machines leak.**

- **Actor**: any player, as attacker; the box's owner, as defender.
- **Trigger**: `hydra` against a live service, or `john` against a stolen hash.
- **Outcome**: the ssh door — and every later door — opens with something earned in-game.
  Today `ssh` exists but takes a password no player can obtain, so v2's only door is
  decorative outside tests.
- **Current constraint**: this is four capabilities in one hat — a data-file install seam, a
  world-generation policy change, an online cracking tool with its own server seam, and an
  offline one. Planned as a unit it would produce a PR nobody can review.

---

## What the codebase actually says (read 2026-07-31)

Five findings that decide the split. Two of them contradict the cheapest-looking plan.

### 1. `ssh` authenticates **server-side**, across **four** reachability seams

`SshApi` (`v2/src/core/commands/types.ts:372`) is four methods — `authenticate`,
`authenticatePublic`, `authenticateSameLan`, `authenticateInnerGateway` — each backed by its
own signed action in `api/sessions.ts` (`authCreateSession`, `…Public`, `…SameLan`,
`…InnerGateway`). `ssh.ts:5` states it plainly: *"authenticates the password SERVER-side …
the server regenerates the host's `/etc/passwd` and validates."*

**Consequence — this is the cost driver.** hydra must agree with whatever `ssh` would accept,
or the game lies to the player. So hydra is **server-side too**, and it inherits the same
reachability fan-out. That fan-out is the single best splitting axis, and D1 already proved the
shape: own-LAN first, cross-player second.

### 2. `/etc/passwd` is deliberately **not** tier-3 readable — so hydra can't be client-side

`readFilter.ts:61-68` lists the externally-observable allowlist and its comment names the
exclusion outright: *"Everything NOT matching default-denies — /etc/passwd's inline hashes."*

**Consequence**: there is no client-side shortcut, not even for NPC hosts. The client *can*
regenerate an NPC host's baseline `buildRemoteHostFs(essid, host)` locally — `nmap` does — but
that baseline diverges from truth the moment anyone patches `/etc/passwd`, and the server holds
the patches. Cracking from the local regeneration would produce a password `ssh` then rejects.

### 3. `extraFiles` does not exist yet

`aptPackages.ts:20-24` is `{ name, binaries? }`, and its docstring says `description`/`version`/
`extraFiles` *"land with the future `apt install` command that actually installs them."* That
command shipped (`apt.ts`) — but it writes **binaries only** (`apt.ts:162-171`). There is also
no `/usr/share` anywhere in `workstationFs.ts`.

So the wordlist seam is genuinely net-new: a catalog field, an install-loop step, and a new
directory path. It is small — but it is the hard dependency under both `hydra` and `gobuster`.

### 4. The wordlist must be read as a **file**, or the progression mechanic is stillborn

Decision 6 makes wordlist growth the whole progression: harvest a plaintext → append it → your
coverage widens. That only works if `hydra`/`john` read
`/usr/share/wordlists/passwords.txt` **from the filesystem** at run time, never from an imported
constant. Curation is by `nano` (there is no `>>` — `tokenize.ts` emits `pipe`/`redirect` only).

**This is a design constraint, not a slice.** Get it wrong in the first slice and "grow your
wordlist" is a rewrite rather than a free consequence.

For cross-player cracking the *server* does the matching, and it can read the caller's own
`passwords.txt` from their own persisted patches — no need to ship the list up in the payload,
and no client claim to distrust. Worth confirming at planning.

### 5. The trace is already written, and there are **two** near-duplicate password pools

`formatSshdAuthLine` (`authLog.ts`) already emits `Failed password for <user> from <ip>` and
`Accepted password for …`. A hydra run is N failed lines and maybe one accepted — the format,
the path, the perms and the appender all exist.

And the pools have already forked: `GUEST_PASSWORDS` (`workstationFs.ts:52`, 8 entries) and
`WEAK_PASSWORDS` (`remoteHostFs.ts:91`, 10 entries) overlap heavily and both carry a comment
deferring to *"a later hydra/wordlist epic"*. That epic is this one; the pools converge here.

---

## Recommended first slice — ✔ SHIPPED

> **A player cracks an NPC host on their own LAN and logs into it with what they cracked.**

**Why this first**: it is the only slice that can go first. Nothing else in D2 has a
reachable input — see the ordering trap below. It also lands the two risky unknowns (the
`extraFiles` seam and the server-side crack action) against the *cheapest* target, the one
decision 4 already picked: a generated NPC host on the shared LAN, verifiable with one
identity and no second browser session.

### ⚠️ Ordering trap — `john` cannot go first

`john` looks like the cheap opener: no server, no network, a hash in hand. But **there are no
reachable hashes until hydra opens a door.** A player is only ever on their own box, whose
passwords they already know; `/etc/passwd` is off the tier-3 allowlist (finding 2), and the AP
gateway's is root-only and one line. `john` is gated behind the first successful login, so it
lands *after* hydra, not before.

---

## Split candidates

| # | Slice | Value | Includes | Defers | Acceptance examples | Release constraint |
|---|---|---|---|---|---|---|
| **D2.1** ✔ | **A player cracks an NPC host on their own LAN and logs in with it** — **SHIPPED v0.111.0** (#351 `4627621`, #352 `b227a0b`) | The first credential earned in-game. Turns `ssh` from decorative into playable | `extraFiles` on `AptPackage` + apt's install loop writes them; `/usr/share/wordlists/passwords.txt` shipped by `apt install hydra`; `hydra <host> [service] [user]` streaming like `aircrack`; a signed same-LAN crack action mirroring `authCreateSessionSameLan`'s reachability; hydra reads the **file** (finding 4) | Every other reachability; the two-pool policy; the defender's trace; `john` | `apt install hydra` → `cat /usr/share/wordlists/passwords.txt` lists words → `hydra 192.168.x.y ssh` → prints a cracked account → `ssh` with it **succeeds** → a wrong password still fails | **Demo-quality, not ship-quality** — with one flat pool, *everything* cracks. See the open question |
| **D2.2** ✔ | **Not every account falls** — **SHIPPED v0.113.0** (#354 `f9ad49b`, #356 `3af0b92`, #357 `f69b05d`) | The difficulty curve — decision 6's "crackable is membership in *your* wordlist", made real | `core/generation/passwordPools.ts` owns one crackable pool, one uncrackable pool (behind `secrets.ts` → `__encoded.ts`), the `CRACK_CHANCE` table and `drawPassword`; `WEAK_PASSWORDS`, `GUEST_PASSWORDS` and `ROUTER_ADMIN_PASSWORDS` all retired into it | — | A day-one root crack happens but is rare across a scanned LAN; a player's chosen workstation root password **never** cracks; guest always does | Shipped. Re-rolled the generated world (free pre-launch) |
| **D2.3** | **The defender sees the attempt** | The attacker stops being invisible. Same actor-flip that made D1's slice 4 worth its own PR | N `Failed password for <user> from <ip>` + the accepted line, into the target's `/var/log/auth.log`; owner-keyed writer; **server-derived** source IP | Rate limiting; lockout; alerting | A runs `hydra` at an NPC host; the box's `auth.log` shows the failed sweep and the one success, at the attacker's real LAN IP | Ships |
| **D2.4** | **A player cracks a stranger's box across the network** | Cracking reaches other players — the epic's actual point | hydra over the `public` and `innerGateway` reachability seams, matching `ssh`'s remaining variants; server reads the caller's own wordlist from their persisted patches | — | B `hydra <A's public IP> ssh` → cracks A's **guest** account → `ssh` in → A's `auth.log` carries the sweep | Ships. **Needs a `scripts/test*.ts` wire-check** and two identities |
| **D2.5** | **A player cracks a stolen hash offline** | Loot becomes capability. The first thing worth stealing that is not a file you read | `john <hash>`; matches against the same wordlist file; the `/etc/passwd` → hash → plaintext → `su` chain | Hash formats beyond md5; `--show`; pot file | B is `guest` on a cracked NPC box → `cat /etc/passwd` → `john <root hash>` → plaintext → `su root` succeeds | Ships |
| **D2.6** | **A player grows their wordlist and cracks what they could not before** | Decision 6's progression loop, closed | Harvest → `nano` append → the previously-failing crack now succeeds. **Probably free** if D2.1 honours finding 4 | — | A password harvested from box X is appended by hand, and box Y — which drew the same password — now cracks | Ships |

### D2.6 may be an acceptance test, not a slice

If `hydra` and `john` read the file rather than a constant, D2.6 is already true the moment
D2.5 lands, and it collapses into a characterisation test plus a docs line. **Do not plan it
until D2.5 is green** — planning it as a slice up front invents work that finding 4 gives away.

---

## Warnings

- ✅ **`gobuster` is no longer in D2 — it is D1c** (decision 2 above). The epic originally
  sited it here because it needs the same `extraFiles` seam, but that seam is *all* it shares:
  gobuster brute-forces **paths**, not credentials, its target is D1's web surface, and its
  whole defender-side tell is a wall of 404s in the `access.log` D1 just built. **D2.1 shipped
  that seam** (`AptPackage.extraFiles`), so D1c is unblocked and can be picked up at any time.
- ✅ **Do not let hydra read a constant.** Finding 4. It is the difference between decision 6's
  progression loop being free and being a rewrite. **Honoured in D2.1** — the server reads
  `/usr/share/wordlists/passwords.txt` from the caller's own journal, per run. `john` (D2.5) must
  read the same file the same way.
- ⚠️ **hydra must never disagree with `ssh`.** Both must resolve the target's `/etc/passwd`
  the same way, server-side, through the same reachability rules. A hydra that cracks from a
  locally regenerated baseline will hand the player a password `ssh` then rejects — and the
  player will read that as a broken game, not a stale cache.
- ✅ **The flat-pool interlude is over.** D2.1 shipped a world where every account fell — a
  known-good checkpoint, not a ship point. D2.2 supplied the policy, so a successful crack is now
  evidence about a *rolled* account rather than about everything.
- ⚠️ **A rate is only observable across a POPULATION, and systematic seeds converge slowly.**
  Crackability is decided at generation, so one box proves nothing about a knob. Worse, sampling
  with `NET-0`, `NET-1`, … is not the sample size it looks like: those strings differ by a few
  characters, so their FNV-1a hashes correlate. A 0.40 knob read 35.8-43.5% at 400 doors,
  37.0-38.9% at 2000, and only reached 39.4-40.0% at 20000. **Do not tune a knob to close that
  gap** — a fresh stream's first draw is uniform to within 0.3pp on unrelated seeds. Sample harder
  or widen the band and say why in the test.
- ⚠️ **Decision 7's accepted cost applies from D2.2 onward.** The uncrackable pool rides
  `contentCodec.ts`, which documents itself as *"OBFUSCATION, NOT SECRECY — the key sits in the
  shipped bundle."* A determined reader recovers the pool. Recorded, accepted, revisited at
  multiplayer-hardening — do not re-litigate it inside a slice.

---

## Parking lot

- **Probability knob values** (open branch 5) — tuning, belongs in D2.2's planning, not here.
- **`hydra` against non-ssh services** — each arrives with its own door (ftp with D3, mysql with
  D6, snmp community strings with D8), per the epic. D2 ships the ssh service only.
- **Rate limiting / lockout** as a defender counter-move — not in legacy, not required for
  parity. Post-ship if wanted.
- **Wordlist hardening** (md5 hashes to the client, plaintext server-side) — the epic's recorded
  path if decision 7 ever bites.

---

## Decisions taken at split (owner, 2026-07-31)

1. **D2.2 stays its own slice — the two-pool policy does NOT fold into D2.1.** D2.1 lands the
   server-side crack seam against a world where the answer is always "cracked", so a failure is
   unambiguously the seam's fault rather than a probability roll. The flat-pool interlude is an
   accepted, temporary checkpoint state.
2. **`gobuster` leaves D2 and becomes D1c**, beside `lynx`. It shares only the `extraFiles`
   seam with the credential layer; its target, its content and its trace are all D1's web
   surface. D2.1 still builds the seam — gobuster just consumes it later, from the web epic.

## What D2.2 settled, beyond its own row

**The third pool the split missed is gone.** Planning found that every gateway was already a hydra
target, drawing from an unmentioned `ROUTER_ADMIN_PASSWORDS` whose eight words included two the
shipped wordlist covered — so gateways cracked at a measured 23.8% by pure accident. That is why
D2.2 ran as two slices. `ROUTER_ADMIN_PASSWORDS` no longer exists: its factory defaults were
folded into the single crackable pool and gateways now draw at their own knob.

**One pool pair, not one per door kind.** The plan called for themed crackable/uncrackable halves
for routers. Review killed both: the uncrackable half is invisible until harvested (so its flavour
buys nothing observable, and a second one would split wordlist growth into two progressions), and
once that half is shared, a separate crackable half makes the two pool pairs identical. The
abstraction collapsed to `drawPassword(prng, crackChance)` over two module-level pools. Cost: a
cracked gateway can print `sunshine` rather than `netgear`. Cheap to reverse pre-launch.

**✅ The `__encoded.ts` server-side risk is discharged.** Decision 7 put the uncrackable pool in
the gitignored, build-generated `__encoded.ts`, and D2.2 was the first time that file crossed to
the server (`api/sessions.ts` → `hydraCrack` / `authCreateSession` → `remoteHostFs`). The failure
mode would have been a runtime import error in production only, invisible to every local gate.
Proved rather than reasoned: `__encoded.ts` deleted, `npm run build` regenerated it via `prebuild`,
and a grep of the bundle found the uncrackable pool **0 times** against a crackable control word at
**2**. Wire-checks then passed live — `testHydraOwnLan.ts` 11/11 and `testInnerGatewayReach.ts`
8/8, the latter authenticating as root on an inner *and* a deep child gateway.

## Next step

**D2.3** (the defender sees the sweep land in `auth.log`) or **D2.5** (`john`). D2.5 is the more
interesting of the two now: root accounts actually hold, so a stolen root hash is a real next move
rather than a redundant one — and D2.6 likely collapses into an acceptance test the moment it
lands, per finding 4.

Per the epic, before any code in a slice: load `tdd`, `testing`, `mutation-testing`,
`refactoring`; run full RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR; present before the next slice
starts.

### ⚠️ Known gaps left behind, worth a short PR

D2.2's honest mutation run (once a raised timeout stopped scoring timeouts as kills) exposed **9
genuine survivors in code it never touched**: the `RULES_V4_SEED` / `ACL_CONF_SEED` header lines
and their `join('\n')` separator, and `buildDeepSwitchBaseFs`'s config subtree mutating to `{}`.
The tests assert those files *parse*, so blanking the header a player reads with `cat`, or building
a deep switch with no `acl.conf`, goes unnoticed. Not blocking anything; small and well understood.

---
*Split artifact. Delete once every slice above is shipped or re-sited.*
