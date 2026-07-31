# Plan: D2.2 — not every account falls

**Status**: Active. Not started.
**Branch**: `feat/two-password-pools` (slice 1), `feat/gateway-crack-knob` (slice 2).
**Parent**: [`d2-credential-layer.md`](./d2-credential-layer.md) (split) →
[`legacy-parity-epic.md`](./legacy-parity-epic.md) (epic, Phase 1, decisions 1/6/7).

## Goal

Cracking becomes a difficulty curve instead of a formality: a guest account always falls, an
NPC's user account usually does, an NPC's root account rarely does, and a gateway's root account
is the best odds in the game — because the gateway is what you are supposed to be hunting.

D2.1 shipped the crack machinery against a **flat** pool, so today *everything* falls. That was
deliberate — it meant a failed crack could only be the machinery's fault. This slice supplies the
policy the machinery has been running without.

## The curve — SETTLED (owner, 2026-07-31)

Epic open branch 5 is now closed. These are the numbers; the acceptance criteria below are claims
about them.

| Account | Crackable | Why |
|---|---|---|
| **guest** (NPC *and* player workstation) | **100%** | The always-open door. Decision 1 leans on it: a defender's chosen root password is safe pre-CVE, so guest is what makes cross-player play exist at all. **Already true today** — this slice must not break it |
| **NPC user** | **70%** | The routine win. A player who sweeps a LAN gets footholds |
| **NPC root** | **12%** | ~1 crackable root per 8-host LAN. Decision 6's *"day-one rooting happens but is rare"* |
| **gateway root** (AP, inner, deep) | **40%** | Decision 1 names the AP gateway as THE crackable root target pre-CVE. Best root odds in the game, still a crack rather than a birthright |

A password is drawn from the **crackable** pool (every member ships in the default wordlist) or
the **uncrackable** pool (disjoint, none shipped, lives behind the `secrets.ts` codec). "Crackable"
remains membership in *your* wordlist — the knob only decides which pool the generator draws from.

## Acceptance criteria

- [ ] A guest account — on a generated NPC host **and** on a player's own workstation — always
      draws a password the default wordlist covers
- [ ] Across a large population of generated NPC hosts, crackable **root** accounts land near 12%
      and crackable **user** accounts near 70%, each inside a stated tolerance band
- [ ] Across a large population of generated gateways, crackable admin accounts land near 40%
- [ ] The two pools are **disjoint**: no password is in both, and no member of the uncrackable
      pool appears in the shipped default wordlist
- [ ] An account that drew from the uncrackable pool is **not** reported by `hydra` running the
      default wordlist — and the same account **is** reported once its password is appended to
      the wordlist file
- [ ] `ssh` still accepts every password `hydra` reports, and still rejects the rest — the two
      never disagree about an account, whichever pool it drew from
- [ ] The uncrackable pool does not appear in plaintext in a built bundle
- [ ] Server-side host regeneration keeps working in a **deployed** environment, where
      `__encoded.ts` is build-generated rather than committed

## What the codebase actually says (read 2026-07-31)

Four findings. Two of them change the slice's scope from what the split assumed.

### 1. Every gateway is ALREADY a hydra target, and its crack rate is an accident

`handleHydraCrack` resolves its target through `generateHomeLan(essid).hosts`, and that list
includes the AP gateway at `.1`, the inner gateway, and the switch — not just NPC siblings
(`generateHomeLan.ts:52-108`). All of them run `sshd` (routers are pinned to 1.0), and all of them
seed their root password from a **third** pool, `ROUTER_ADMIN_PASSWORDS` (`routerFs.ts:43`),
via `seedApGatewayAdminPw` / `seedInnerGatewayAdminPw` / the deep-gateway variant.

That pool is 8 words. **Two of them — `admin` and `admin123` — are already in the shipped default
wordlist** (`admin` via `COMMON_PASSWORDS`, `admin123` via `WEAK_PASSWORDS`). So roughly **25% of
every gateway in the game cracks today**, and that number is pool overlap, not a decision.

**Consequence**: the "two-pool" policy has to cover **three** pools. The split's D2.2 row named
only `WEAK_PASSWORDS` + `GUEST_PASSWORDS`; it did not know about this one.

### 2. `defaultWordlist.ts`'s docstring is wrong about exactly this

It currently claims the wordlist covers everything except the gateway, *"which is generated per
ESSID rather than drawn from a pool — taking the gateway stays a crack rather than a birthright."*

Both halves are false: the gateway password **is** a pool draw, and the default wordlist **does**
cover a quarter of that pool. Fix the comment in the slice that makes it true (slice 2), not
before — a comment that describes an intention the code does not implement is worse than none.

### 3. "Guest always falls" is already true — protect it, don't build it

`workstationGuestPassword` (`workstationFs.ts:93`) picks from `GUEST_PASSWORDS`, and every member
ships in the default wordlist. NPC guests draw from `WEAK_PASSWORDS`, likewise fully shipped. So
this criterion is a **conserved property**, not new behavior. It needs a regression test that
would fail if a later pool edit dropped a guest password from the shipped list — it does not need
an implementation.

### 4. Eight modules read the pools, and two are wire-checks that would silently weaken

`WEAK_PASSWORDS` / `GUEST_PASSWORDS` are imported by `remoteHostFs`, `workstationFs`,
`defaultWordlist`, three unit tests, and — importantly — `scripts/testHydraOwnLan.ts` and
`scripts/testInnerGatewayReach.ts`.

Both wire-checks recover a host's plaintext by matching md5 against `WEAK_PASSWORDS`. After the
split, an account that drew from the uncrackable pool simply **will not be found** by that match,
so the check's account list silently shrinks and every assertion still passes while proving less.
`testHydraOwnLan.ts`'s headline check is literally *"full wordlist cracks every account"* — which
becomes vacuous if "every account" quietly means "the crackable ones".

**This is an opportunity, not just a hazard**: the same wire-check should be strengthened to
assert an uncrackable-pool account is present on the box and does **not** fall.

---

## Slices

Two slices, per the owner's call. Each is one reviewable idea.

### Slice 1: An NPC host's root account usually holds

**Class**: Behavior change.

**Value**: The difficulty curve arrives where the player meets it first — the generated hosts on
their own LAN. After this slice a swept LAN reads as a population: guests fall, most user accounts
fall, and root usually does not.

**Actor / trigger / outcome**: player → `hydra <NPC host> ssh` → some accounts are reported and
some are not, and which is which is stable for that host.

**Path**: `buildRemoteHostFs` (per-account pool draw) → `/etc/passwd` → `handleHydraCrack`'s sweep
against the caller's wordlist → the reported set. Same production path D2.1 built; only the
generator's choice of password changes.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before code):

1. A new module owns the two pools: a committed **crackable** pool and an **uncrackable** pool
   read through `secrets.ts` → `__encoded.ts`, per decision 7
2. The pools are disjoint, and `DEFAULT_WORDLIST` covers the crackable pool **entirely** and the
   uncrackable pool **not at all** — asserted as set relations, not by spot-checking words
3. `buildRemoteHostFs` draws each account's password by an explicit per-account chance: guest
   1.0, user 0.70, root 0.12
4. Across ≥500 generated NPC hosts spanning many ESSIDs, the crackable fraction is within a
   stated tolerance of each knob — and the test names the tolerance rather than asserting an
   exact count
5. Every generated guest account's password is in the default wordlist — 100%, no tolerance
6. A host is byte-stable: regenerating the same `(essid, ip)` yields the same passwd, so two
   occupants scanning one box still agree
7. `hydra` with the default wordlist reports the crackable accounts on a host and omits the
   uncrackable ones; appending an uncrackable password to the wordlist file makes that account
   fall on the next run
8. `ssh` accepts exactly what `hydra` reported and rejects the uncrackable accounts' passwords
   until they are in the list

**RED**: a population test over `buildRemoteHostFs` asserting the root-account crackable fraction
sits near 12%. Today it is 100%, so it fails on the true claim. Then the disjointness and
wordlist-coverage set assertions, which fail because neither pool exists yet.

**GREEN**: the pools module, the `secrets.ts` key, and a `drawPassword(prng, chance)` helper used
three times in `buildRemoteHostFs`. Nothing else.

**MUTATE**: Stryker over the pools module + `remoteHostFs.ts` + `defaultWordlist.ts`. Expect
survivors on the comparison operator in the chance roll (`<` vs `<=`) and on the knob constants
themselves — a tolerance band is a weak oracle, so a mutant that shifts 0.12 slightly may live.

**KILL MUTANTS**: pick tolerance bands **tight enough that a knob mutant fails them**. If a band
survives every plausible knob value, it is decoration — narrow it or assert the exact deterministic
count over a fixed host set instead. Prefer the fixed-set assertion: the PRNG is deterministic, so
"these 500 seeds yield exactly N crackable roots" is both exact and stable.

**REFACTOR**: assess whether `workstationFs`'s guest draw should route through the same pools
module. Lean yes — one place answering "which pool does this account draw from" is the knowledge
this slice creates — but only after green.

**⚠️ Two hazards specific to this slice**:

- **The draw order shifts.** Adding a roll before each `prng.pick` changes every subsequent draw
  in `buildRemoteHostFs`, so hostnames, services and page content all move. That re-rolls the
  generated world, which is **free pre-launch** (the no-backward-compat licence) but will churn
  any golden assertions. `generateHomeLan.test.ts` and `routerFs.test.ts` carry byte-stability
  tests — expect to update them, and check the update is a re-baseline rather than a weakened
  claim.
- **Update both wire-checks** (finding 4). `testHydraOwnLan.ts` must seed from the crackable pool
  and additionally assert an uncrackable account does not fall; `testInnerGatewayReach.ts` must
  match against both pools or it will fail to find a gateway password at all.

**Wire-check**: `scripts/testHydraOwnLan.ts`, extended. **This slice's wire-check has a second
job**: it is the first time `__encoded.ts` is loaded **server-side**. Verified 2026-07-31 that the
encoded secrets have never crossed to the server — the only non-test importer is `generateWifi.ts`,
reached solely from `src/ui/state.ts`. `remoteHostFs.ts` is reached by `api/sessions.ts` through
both `hydraCrack` and `authCreateSession`, so after this slice every host-regenerating function
depends on a **gitignored, build-generated** file. The `prebuild` hook looks correct; it has never
been exercised, and the failure mode is an import error in production only, with `ssh` and `hydra`
both down while every local gate stays green. Run the wire-check against `vercel dev` and confirm
a crack still resolves.

**Done when**: all eight criteria pass, both wire-checks green, mutation reviewed, human approves.

---

### Slice 2: A gateway is the best root target in the game, deliberately

**Class**: Behavior change.

**Value**: Turns finding 1's accidental ~25% into a designed 40%, and makes decision 1 true in the
code rather than only in the epic: the gateway is what a player hunts when NPC roots hold.

**Actor / trigger / outcome**: player → `hydra <gateway IP> ssh` → the gateway's root account
falls appreciably more often than an NPC's, and taking it is the pre-CVE route to root.

**Path**: `seedApGatewayAdminPw` / `seedInnerGatewayAdminPw` / the deep variant → the same
per-account pool draw slice 1 introduces → `/etc/passwd` → the crack sweep.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before code):

1. `ROUTER_ADMIN_PASSWORDS` splits into crackable and uncrackable halves through the **same**
   pools module slice 1 built — not a parallel mechanism
2. All three gateway kinds (AP, inner, deep) draw at 0.40, and the knob is stated once
3. Across a large population of ESSIDs, the crackable fraction of AP gateway admin passwords is
   within a stated tolerance of 40%
4. A gateway that drew uncrackable is not reported by `hydra` with the default wordlist, and
   `ssh root@<gateway>` with a wordlist guess fails — the gateway is reachable but holds
5. `defaultWordlist.ts`'s docstring is corrected to describe what the code now actually does
   (finding 2)

**RED**: a population test over `seedApGatewayAdminPw` across many ESSIDs asserting the crackable
fraction near 40%. Fails today at ~25%, and fails for the right reason — the current number is
pool overlap, not a knob.

**GREEN**: route the router pool through the pools module and apply the knob.

**MUTATE**: Stryker over `routerFs.ts` + the pools module. Same tolerance-band caution as slice 1;
prefer an exact count over a fixed ESSID set.

**KILL MUTANTS**: the three gateway kinds must each be proven to use the knob — a mutant that
applies it to the AP gateway only should fail.

**REFACTOR**: assess whether the three `seed*AdminPw` functions are now one function with three
seed namespaces. They look alike; check whether they would change together before merging them.

**Explicitly NOT in this slice**: making the gateway *findable* or *worth taking* — it already
bears the public IP and the NAT table. This changes only how often its password is in reach.

**Wire-check**: none net-new. Slice 1 proved the encoded pool loads server-side; this slice adds
no new server path. `scripts/testInnerGatewayReach.ts` must still pass — it recovers a gateway
password by pool match and will need both pools.

---

## Explicitly NOT in D2.2

- **The defender's view of the sweep** — D2.3. A hydra run still writes no `auth.log` line.
- **Cross-player targets** — D2.4.
- **`john`** — D2.5. Note that once root accounts start holding, a stolen root *hash* becomes the
  natural next move, which is exactly why D2.5 follows this slice rather than preceding it.
- **Wordlist growth as a mechanic** — D2.6, and slice 1's criterion 7 already proves the
  underlying behavior works.

## Pre-PR quality gate (per slice)

1. `npx vitest run` — full suite
2. `npx stryker run --mutate <changed files>` — **dev server down**, or false survivors
3. `npm run typecheck` (`tsc -b`; plain `tsc --noEmit` is a no-op here) and `npm run lint`
4. Version bump in `v2/package.json` **and** `v2/package-lock.json`
   (`npm install --package-lock-only`)
5. Slice 1: both wire-checks green against a live stack, ports 3100/3101 killed afterwards
6. Confirm the built bundle does not contain the uncrackable pool in plaintext

---
*Delete this file when both slices are shipped.*
