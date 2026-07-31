# D2 split — a player cracks a credential instead of being told it

> **Status: D2.1 ✅ SHIPPED (2026-07-31, v0.111.0). D2.2 is next.** Authored 2026-07-31
> (`story-splitting`), grounded against the shipped code (every file:line below was read, not
> recalled). Parent: [`legacy-parity-epic.md`](./legacy-parity-epic.md) Phase 1, D2.
>
> D2.1's plan file has been deleted on close-out; its as-built is
> [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1. Findings 1–4 below
> were all confirmed by building it — read them before planning any later slice.

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
| **D2.2** | **Not every account falls** | The difficulty curve — decision 6's "crackable is membership in *your* wordlist", made real | `WEAK_PASSWORDS` + `GUEST_PASSWORDS` converge into crackable/uncrackable pools; uncrackable pool into `secrets.ts` → `__encoded.ts` (decision 7); per-account probability in `buildRemoteHostFs` (NPC user: high; NPC root: low); guest always crackable | Probability *values* (open branch 5 — tune here) | A day-one root crack happens but is rare across a scanned LAN; a player's chosen workstation root password **never** cracks; guest always does | Ships. Re-rolls the generated world (fine pre-launch) |
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
- ⚠️ **This is the state the game is in right now**: not broken but flat — every account falls,
  because the pool is single and the default wordlist covers it. A known-good *checkpoint*, not a
  ship point. **D2.2 is what makes it a game**, and until it lands, do not read a successful crack
  as evidence the difficulty curve works.
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

## Next step

Load `planning` for **D2.2 — not every account falls** — alone.

**It carries one unresolved decision.** The probability knob *values* (epic open branch 5) are
deliberately not set anywhere: D2.2's planning is where they get chosen, and they are a product
call, not a derivation. Settle them before RED, because the acceptance criteria are statements
about them ("a day-one root crack is rare", "guest always falls").

The second question D2.2 must answer is what "rare" is measured over. A per-account probability
rolled at generation is a property of the **world**, so a claim like *"most NPC roots hold"* is
only testable across a population of generated hosts, not against one. Decide at planning
whether the acceptance test scans a LAN, or many.

Per the epic, before any code in a slice: load `tdd`, `testing`, `mutation-testing`,
`refactoring`; run full RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR; present before the next slice
starts.

### ⚠️ D2.2 adds no endpoint, but it is NOT client-only — check this before assuming no wire-check

Decision 7 puts the uncrackable pool in `secrets.ts` → the **gitignored, build-generated**
`__encoded.ts`. Verified 2026-07-31: that file is reached today from exactly one non-test
importer, `generateWifi.ts`, itself imported only by `src/ui/state.ts` — so the encoded secrets
have **never been loaded server-side**.

D2.2 changes that. The pools live in `remoteHostFs.ts`, which `api/sessions.ts` reaches
transitively through both `hydraCrack` and `authCreateSession`. The moment the uncrackable pool
moves behind the codec, every Vercel function that regenerates a host depends on a file that is
**not in git** and exists only because `prebuild`/`pretypecheck` run `npm run encode`.

The build script chain looks right (`prebuild: npm run encode`), so this may well just work — but
it has never been exercised, and the failure mode is a runtime import error in production only,
which no local gate catches. **Prove it live with a wire-check** rather than reasoning about the
script chain. That is cheaper than the alternative: `ssh` and `hydra` both breaking in production
while every local gate stays green.

---
*Split artifact. Delete once every slice above is shipped or re-sited.*
