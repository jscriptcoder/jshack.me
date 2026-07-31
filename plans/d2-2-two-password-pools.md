# Plan: D2.2 — not every account falls

**Status**: Active. **Slice 1 shipped** (#354, #356, v0.112.0). Slice 2 is the remaining work.
**Branch**: ~~`feat/two-password-pools`~~ (slice 1, merged), `feat/gateway-crack-knob` (slice 2).
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

- [x] A guest account — on a generated NPC host **and** on a player's own workstation — always
      draws a password the default wordlist covers
- [x] Across a large population of generated NPC hosts, crackable **root** accounts land near 12%
      and crackable **user** accounts near 70%, each inside a stated tolerance band
- [ ] Across a large population of generated gateways, crackable admin accounts land near 40%
- [x] The two pools are **disjoint**: no password is in both, and no member of the uncrackable
      pool appears in the shipped default wordlist
- [x] An account that drew from the uncrackable pool is **not** reported by `hydra` running the
      default wordlist — and the same account **is** reported once its password is appended to
      the wordlist file
- [x] `ssh` still accepts every password `hydra` reports, and still rejects the rest — the two
      never disagree about an account, whichever pool it drew from
- [x] The uncrackable pool does not appear in plaintext in a built bundle
- [x] Server-side host regeneration keeps working in a **deployed** environment, where
      `__encoded.ts` is build-generated rather than committed

Only the gateway row is open. It is slice 2, and nothing else in this plan depends on it.

## What the codebase actually says (read 2026-07-31; re-checked after slice 1 shipped)

Four findings. Findings 3 and 4 are **discharged** — slice 1 handled both. Findings 1 and 2 are
slice 2's whole reason for existing and are re-verified against `main` at `3af0b92`.

### 1. Every gateway is ALREADY a hydra target, and its crack rate is an accident

`handleHydraCrack` resolves its target through `generateHomeLan(essid).hosts`, and that list
includes the AP gateway at `.1`, the inner gateway, and the switch — not just NPC siblings
(`generateHomeLan.ts:52-108`). All of them run `sshd` (routers are pinned to 1.0), and all of them
seed their root password from a **third** pool, `ROUTER_ADMIN_PASSWORDS` (`routerFs.ts:43`),
via `seedApGatewayAdminPw` / `seedInnerGatewayAdminPw` / the deep-gateway variant.

That pool is 8 words: `admin`, `admin123`, `root123`, `toor`, `default`, `cisco`, `linksys`,
`netgear`. **Two of them — `admin` and `admin123` — are already in the shipped default wordlist**
(`admin` via `COMMON_PASSWORDS`, `admin123` via `CRACKABLE_PASSWORDS` since slice 1). So a gateway
cracks today at a rate nobody chose. Nominally 2/8 = 25%; **measured 95/400 = 23.8%** of AP
gateways across 400 ESSIDs, because a seeded `pick` over 8 words is not perfectly uniform at that
sample size. Either way the number is pool overlap, not a decision.

**Consequence**: the "two-pool" policy has to cover **three** pools. The split's D2.2 row named
only the two account pools; it did not know about this one. Slice 1 retired both of those (they
are now `passwordPools.ts`), so `ROUTER_ADMIN_PASSWORDS` is the **last** password pool in the game
that is not routed through the policy module.

### 2. Two docstrings still describe a world the code does not implement

The original finding named `defaultWordlist.ts`'s claim that the wordlist covered everything
*except* the gateway. Slice 1 rewrote that docstring, so **that exact sentence is gone** — but the
falsehood moved rather than died, and a second one surfaced:

- **`defaultWordlist.ts:37-39`** now says the `COMMON_PASSWORDS` padding *"crack[s] nothing
  today."* False: `admin` is in the padding **and** in `ROUTER_ADMIN_PASSWORDS`, so the padding
  alone opens roughly one gateway in eight. The same docstring's headline — *"What it covers is
  exactly the CRACKABLE pool"* — is likewise only true of **account** passwords.
- **`routerFs.ts:40-42`** says the router pool is *"disjoint from the workstation guest pool."*
  That pool was retired in #356; the sentence now points at nothing, and the property it asserts
  is no longer checked anywhere.

Fix both in the slice that makes them true (slice 2), not before — a comment describing an
intention the code does not implement is worse than none.

### 3. "Guest always falls" is already true — protect it, don't build it *(DISCHARGED — slice 1)*

`workstationGuestPassword` (`workstationFs.ts:93`) picks from `GUEST_PASSWORDS`, and every member
ships in the default wordlist. NPC guests draw from `WEAK_PASSWORDS`, likewise fully shipped. So
this criterion is a **conserved property**, not new behavior. It needs a regression test that
would fail if a later pool edit dropped a guest password from the shipped list — it does not need
an implementation.

### 4. Eight modules read the pools, and two are wire-checks that would silently weaken *(DISCHARGED — slice 1)*

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

### Slice 1: An NPC host's root account usually holds — ✅ SHIPPED (#354, #356, v0.112.0)

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

**As built** — all eight criteria met. What landed:

- **`core/generation/passwordPools.ts`** (new) owns the policy: `CRACKABLE_PASSWORDS` (10 words,
  committed), `UNCRACKABLE_PASSWORDS` (48 words, through `secrets.ts` → `__encoded.ts`),
  `ALL_GENERATED_PASSWORDS` for reverse lookup, the `CRACK_CHANCE` knob table, and
  `drawPassword(prng, crackChance)`. The draw consumes **exactly two** PRNG draws on both
  branches, so retuning a chance does not move a caller's later draws.
- `remoteHostFs.ts` draws its three accounts through it; `WEAK_PASSWORDS` deleted.
- `defaultWordlist.ts` composes `CRACKABLE_PASSWORDS` + padding, deduped — the uncrackable pool
  is absent **by construction** (never imported) rather than by an assertion.
- **#356** discharged the REFACTOR item: `workstationFs.ts`'s `GUEST_PASSWORDS` retired,
  `workstationGuestPassword` now draws at `CRACK_CHANCE.guest`. One module answers "which pool
  does this account draw from".

**Evidence**: 134 test files / 2274 tests green · `tsc -b` + lint clean · Stryker **100.00%**
over `passwordPools.ts` + `remoteHostFs.ts` + `defaultWordlist.ts` (101 killed, **0 survivors**)
· `testHydraOwnLan.ts` **11/11 live** against `vercel dev` + supabase.

**Measured curve** across 2024 generated hosts (8 ESSIDs × 253 octets): root 240 = **11.9%**,
user 1422 = **70.3%**, guest 2024 = **100%**. Knobs are 12 / 70 / 100.

**Two things worth carrying forward**:

- **The `__encoded.ts` server-side risk was real and is now discharged.** This slice was the first
  time the build-generated secrets file crossed to the server (`api/sessions.ts` → `hydraCrack` /
  `authCreateSession` → `remoteHostFs`). Proved rather than inferred: deleted `__encoded.ts`,
  `npm run build` regenerated it via `prebuild`, then grepped the bundle — uncrackable pool **0
  occurrences**, a crackable word **2** as a control.
- **A tautological assertion hid 8 mutants.** `apt.test.ts` asserted `permissions:
  WORDLIST_PERMISSIONS` against the imported constant, so every mutant of that constant survived.
  Fixed by pinning the literal shape in `defaultWordlist.test.ts` — `apt.test.ts` keeps the
  constant, which is the right claim *there*. Asserting a value against the constant that
  produces it proves only that the import resolved.

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

**SETTLED (owner, 2026-07-31) — neither (a) nor (b): ONE pool pair, router defaults folded in.**

The plan offered (a) keep a themed router pool pair, or (b) drop the themed pool and draw from the
account pools. Implementation started on (a); the owner challenged it twice, and both challenges
held:

1. *"Why two uncrackable lists?"* — The flavour argument only pays on the **crackable** half,
   because that is the only half a player ever reads: a gateway that falls prints `linksys` and
   tells them what they broke into. An uncrackable password is invisible until harvested, by which
   point it is just a password. A second uncrackable list bought nothing observable and cost a
   second secret key, a second size invariant, and a **split progression** — harvesting off an NPC
   would never help against a router, contradicting what the mechanic already promises.
2. *"Why two crackable lists?"* — With the uncrackable half already shared, a shared crackable half
   makes the two pool pairs identical, so the whole abstraction collapses: no `PasswordPools` type,
   no `ACCOUNT_POOLS`/`ROUTER_POOLS`, and `drawPassword` keeps its original two-argument shape.

**As built**: the eight router factory defaults moved **into** `CRACKABLE_PASSWORDS` (10 → 17
words). One crackable pool, one uncrackable pool, one `drawPassword(prng, crackChance)`. Gateways
differ from accounts only by their knob.

**What it costs**: a cracked gateway can now print `sunshine` rather than `netgear`. The router
defaults are still in the pool, so gateways often print something router-shaped — diluted, not
gone. Pre-launch there is no compat burden, so themed pools stay cheap to reintroduce if that
flavour turns out to matter.

**Acceptance criteria** (confirm before code):

1. `ROUTER_ADMIN_PASSWORDS` is retired into the **same** pools module slice 1 built — not a
   parallel mechanism (as built: its words merged into `CRACKABLE_PASSWORDS`, and the constant is
   gone)
2. All three gateway kinds (AP, inner, deep) draw at 0.40, and the knob is stated once
3. Across a large population of ESSIDs, the crackable fraction of AP gateway admin passwords is
   within a stated tolerance of 40%
4. A gateway that drew uncrackable is not reported by `hydra` with the default wordlist, and
   `ssh root@<gateway>` with a wordlist guess fails — the gateway is reachable but holds
5. Both stale docstrings are corrected to describe what the code now does (finding 2):
   `defaultWordlist.ts`'s "the padding cracks nothing" and `routerFs.ts`'s reference to a
   workstation guest pool that no longer exists

**RED** (done): a population test over all three `seed*AdminPw` functions asserting the crackable
fraction near 40%. Failed at **95/400 (AP), 106/400 (inner), 84/400 (deep)** — the accidental
pool-overlap rate — against a floor of 140. Right reason: the old number was overlap, not a knob.

**⚠️ A 400-door population was too small, and the reason is worth keeping.** The first band held
the three kinds at 35.8% / 43.5% / 37.0% around a 40% knob — inside a ±5pp band, but barely. The
cause is not the roll: a freshly-seeded stream's first draw is uniform to within 0.3pp when the
seeds are unrelated (measured at four seed shapes × three thresholds). It is that these seeds
differ by a few characters, so their FNV-1a hashes are **correlated** and the observed rate
converges far slower than an independent sample would — 2000 doors gives 37.0% / 38.9% / 38.7%,
and only 20000 reaches 39.4-40.0%. The tests use 2000. Any future population test over
systematically-generated seeds has this problem.

**GREEN**: smaller than when this plan was written — `drawPassword` and the knob table already
exist. Add the gateway chance to `CRACK_CHANCE`, split the router pool per the decision above, and
route the three `seed*AdminPw` functions through it.

**MUTATE** (done, and the first result was wrong): the default 5s timeout inflated both files.

| file | as first reported | honest (`--timeoutMS 60000`) |
|---|---|---|
| `defaultWordlist.ts` | 100.00%, 0 survivors | **100.00%**, 0 survivors, 0 timeouts |
| `passwordPools.ts` | 100.00%, 5 timeouts | **95.83%**, 1 survivor |
| `routerFs.ts` | 95.83%, 46 kills / **46 timeouts** | **87.50%**, 12 survivors (timeouts 46 → 10) |

Eight `routerFs.ts` mutants that scored as "killed by timeout" were genuine survivors. Root cause
is structural, not this slice: the file is **64% static mutants** (module-level constants, each
forcing a module reload) and Stryker counts a timeout as a kill. Fixed at source —
`stryker.config.json` now sets `timeoutMS: 30000` so the next reader is not misled the same way.

**KILL MUTANTS**: every mutant on the lines this slice changed (49, 245, 265 — all three
`seed*AdminPw` functions) is **killed**, so the knob is proven at each depth rather than only at
the edge. The 12 survivors break down as:

- **3 equivalent** (L97, `seedApGatewayHasSsh`): `<`→`<=`, the comparison→`true`, and the seed
  namespace→empty all return `true` for every ESSID while `ROUTER_SSH_PROBABILITY` is pinned to 1.
- **1 equivalent** (`passwordPools.ts` L106): `prng.next() < chance` → `<=`. Provably equivalent —
  `next()` yields `k / 2^32` for integer `k ≤ 2^32-1`, and no knob is a reachable value (`1` needs
  `k = 2^32`; 0.7 / 0.12 / 0.4 all give non-integer `k`). Verified numerically, not asserted.
- **9 pre-existing, in code this slice never touched**: `RULES_V4_SEED` / `ACL_CONF_SEED` comment
  lines and their `join('\n')` separator (L117-121, L130-132), and `buildDeepSwitchBaseFs`'s
  config subtree → `{}` (L287). These are REAL gaps — the tests assert those files *parse*
  correctly, so blanking the header a player reads with `cat`, or building a deep switch with no
  `acl.conf`, goes unnoticed. Left for a follow-up rather than expanded into this slice; they were
  invisible before only because the old timeout masked them.

**Wire-checks** (live, `vercel dev` + supabase, v0.113.0): `testHydraOwnLan.ts` **11/11**,
`testInnerGatewayReach.ts` **8/8**. The second is the meaningful one here — it authenticates as
root on an inner gateway AND a deep child gateway, the exact server path this slice changed.

**REFACTOR**: assess whether the three `seed*AdminPw` functions are now one function with three
seed namespaces. They look alike; check whether they would change together before merging them.

**Explicitly NOT in this slice**: making the gateway *findable* or *worth taking* — it already
bears the public IP and the NAT table. This changes only how often its password is in reach.

**Wire-check**: none net-new. Slice 1 proved the encoded pool loads server-side; this slice adds
no new server path.

`scripts/testInnerGatewayReach.ts` needs no pool change — **corrected**: it recovers gateway roots
by calling `seedInnerGatewayAdminPw` / `seedDeepGatewayAdminPw` **directly** (lines 94, 122), not
by matching a hash against a pool, so it keeps working whichever pool the seed draws from. It uses
`ALL_GENERATED_PASSWORDS` only for a deep host's *guest* account (line 104). It must still pass,
because the gateway plaintexts themselves change.

**⚠️ Hazard — the credentials re-roll.** This was **far smaller than the plan feared**. Every
consumer of the gateway seeds (17 test files + 8 wire-check scripts) calls the `seed*AdminPw`
functions rather than pinning a literal, and each function owns a dedicated PRNG namespace, so
nothing outside the password itself moved. Exactly **two** goldens needed re-baselining:

- `routerFs.test.ts` — the one pinned gateway password, now `copperfield7` (this ESSID's gateway
  drew the uncrackable half, which is why it no longer reads like a router)
- `workstationFs.test.ts` — the two guest hashes, because merging the router defaults grew the
  crackable pool 10 → 17 and moved the pick index. Both patched together, per slice 1's lesson
  about reading the whole golden block first

**⚠️ A pre-existing flake blocked the gate, twice.** Stryker's dry run failed on `nmapScan`'s
"self still skipped" test while the full suite passed 13/13. Not caused by this slice: it is the
documented random-identity collision (a random pubkey's LAN octet landing on a generated host,
~1 in 25). The remedy helper `identityOffTheGeneratedLan()` already existed in that same file and
a sibling test already used it — this test just called `generateIdentity()` directly. Fixed
in place. Other files minting identities the same way remain latent.

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
