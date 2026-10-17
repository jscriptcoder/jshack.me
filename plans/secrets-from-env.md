# Plan: secrets come from the environment

**Status**: Grilled and planned. Decisions confirmed by the owner 2026-10-17. Three slices, in
order; slices 1 and 2 DONE (2026-10-17), slice 3 DONE (2026-10-18). Next: the close-out browser
run against production (below), then this plan's content moves into `docs/`.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

No spoiler secret lives in the repo: every pool reaches the build from one environment
variable, and the uncrackable pool reaches the bundle as md5 hashes only, under a new list,
since the current one is in git history.

## Where it starts from (facts, 2026-10-17)

- `src/core/secrets/secrets.ts` holds four lists in plaintext: `UNCRACKABLE_PASSWORDS`,
  `CRACKABLE_PASSWORDS`, `COMMON_PASSWORDS` (the wordlist padding) and `WIFI_PASSWORDS`.
  `scripts/encode.ts` XOR-encodes them into the gitignored `__encoded.ts`, run by every
  `pre*` npm hook. The XOR key ships with the bundle, so any of them decodes in seconds.
- Every generator that draws a password hashes it on the spot (`md5(drawPassword(…))` in
  `remoteHostFs`, `routerFs`, `generateDatabase`, `generateRedisStore`, `fixedSiteFs`,
  `workstationFs`). The own database and own store hold hashes only.
- Plaintext consumers at runtime: the wordlist (`DEFAULT_WORDLIST` = crackable + padding),
  aircrack/nmcli (wifi), and `ownAgentCommunity`, which `apt install snmpd` prints
  (`aptPackages.ts:217`) and which draws from both pools today.
- ~20 unit tests and ~25 `scripts/test*.ts` wire-checks reverse-look-up a plaintext from a
  generated hash (`ALL_GENERATED_PASSWORDS.find(c => md5(c) === hash)`), many for NPC root
  (88% uncrackable). About a dozen wire-checks call the production `seedApGatewayAdminPw`,
  `seedInnerGatewayAdminPw`, `seedDeepGatewayAdminPw` and `seedApGatewayCommunity` for a
  plaintext. Six tests (`gatewayAdminUi`, `gatewayBackups`, `mailbox`, `phoneHome`, `share`,
  `store`) assert no pool word leaks into generated content.
- No CI workflows. Node 22.17 locally (`process.loadEnvFile` available).
- `docs/backlog.md` already carries this as "The password pools are in the public repo"; its
  "plainly fake dev list in the repo" is superseded by decision 2.

## Decisions (owner-confirmed 2026-10-17)

1. **The env carries the uncrackable pool as plaintext; `scripts/encode.ts` hashes it
   before writing the bundled module.** Tests and wire-checks read the plaintext
   through a path that is never bundled. Rejected: hashes-only in the env — it would
   force a rewrite of every reverse-lookup test and make the leak tests inexpressible,
   to protect the words from the owner's own machine.
2. **A missing or malformed env fails everywhere.** `scripts/encode.ts` exits non-zero
   naming the problem; every `dev`/`build`/`test`/`typecheck` runs it first, so nothing
   runs without the secrets. Rejected: committed placeholder pools as a local fallback
   — two rules to keep in step, and a wrong "am I on Vercel?" check ships a placeholder
   world to production with no error. Revisit only if contributors arrive pre-launch.
3. **One JSON env var, `JSHACK_SECRETS`, holding every list**, validated against a zod
   schema that names the missing or malformed key. Never `VITE_`-prefixed (Vite would
   expose it to client code). Rejected: one var per list — many values across three
   environments for the same error precision.
4. **Tests read plaintext from a second generated, gitignored module,
   `src/core/secrets/__plaintext.ts`**, importable only from `*.test.ts(x)`,
   `src/test/**` and `scripts/**` (lint-enforced; amended in find-gaps 2026-10-17: nothing
   in `scripts/` ships, and the cross-player seeder needs a plaintext too). Production code reads the
   encoded module, whose uncrackable entries are hashes. `ALL_GENERATED_PASSWORDS`
   moves to the test-only side. Rejected: tests parsing `process.env` directly —
   vitest and every wire-check would need env-file loading and repeat the validation.
5. **A player's own SNMP agent draws its community from the crackable pool only**, so
   `apt install snmpd` can always print it. Every player's agent falls to the default
   `passwords.txt`; accepted, since the agent buys port control and nothing else.
   Rejected: a player-chosen community (makes the one unopenable door `ownAgent.ts`
   argues against) and a dedicated own-agent pool (another pool, another knob).
6. **The new uncrackable words keep today's shape**: a word plus a few digits or a
   symbol, 8–12 characters, reading like something a person chose. External cracking
   stays the intended route (md5 is weak on purpose); the bundle's hash list is a
   shortcut to work a player could do in-game one hash at a time — still a step up
   from today's reversible XOR. Rejected: words beyond external cracking, or a mix —
   those change what "uncrackable" means and deserve their own grill.
7. **Claude drafts the new uncrackable list in the session; the owner edits and
   approves it.** The words in the session transcript are acceptable — it is a casual
   game's spoiler, not a credential.
8. **Only the uncrackable list rotates.** Crackable, padding and wifi move to the env
   unchanged: the first two reach every player in `passwords.txt`, and aircrack prints
   every wifi key on a crack, so new values would hide nothing and reshuffle the world.
9. **A postbuild check fails the build if any uncrackable plaintext appears in
   `dist/`**, run after `vite build` alongside `scripts/checkBudgets.ts`. It proves the
   promise itself, not the wiring the lint rule guards.
10. **Claude sets `JSHACK_SECRETS` in Vercel Preview and Production through the Vercel
    MCP tools, then reads both back to verify.** The owner authorized this in the grill.
    Ordering is forced by decision 2: both must be set BEFORE the PR is pushed, or its
    Preview build (and then `main`'s Production deploy) fails.
    **Stored readable (not "sensitive") in Vercel Preview, Production and Development**
    (find-gaps, 2026-10-17). Vercel is the backup of the plaintext: if the local file is
    lost, the value is copied back from the Development entry. The owner can read and edit
    it from the dashboard to add words later. The Development entry exists only so a fresh
    machine has a source; nothing builds against it.

## Changing the secrets later (find-gaps, 2026-10-17)

The local file is edited first, and Vercel follows:

1. Edit `JSHACK_SECRETS` in `.env.development.local`.
2. `npm run encode` (the parser validates), then the full test run.
3. Paste the same value into Vercel Preview, Production and Development.
4. Redeploy: the value is baked in at build, so the live game keeps the old one until then.

**Any change to a list re-rolls every door that draws from it**: a draw picks an index
scaled by the list's length. Harmless before launch. After launch, it invalidates every word
players have harvested from that pool (and, for wifi, every network's key) in one go.

## Out of scope

- Generating the world on the server, or keying credential streams with a server secret
  (`docs/backlog.md`, "What a network was generated with is computable by any client").
  The hashes a client can compute from an ESSID stay computable; this work only stops the
  bundle from handing over the words.
- Changing md5, the pools' crack rates, or what "uncrackable" means (decision 6).

## Delivery

Three independent PRs against `main`, in order. Each branch starts after its predecessor
lands. Slice 3 needs slice 1 (no runtime plaintext left on the uncrackable side) and slice 2
(the env exists).

---

## Slice 1: a player's own SNMP agent always holds a crackable community

**Status**: DONE — PR #693, squash-merged as `b6ab3864`, v0.396.0; Production READY.

**Value**: an attacker with a default `apt install hydra` wordlist can always crack another
player's SNMP agent, and the agent's owner is always shown a word, whatever pools the bundle
carries later.
**Path**: `apt install snmpd` → `aptPackages.ts` (state file + install output) →
`ownAgentCommunity` → the agent's hash on the box → a crack sweeps the attacker's wordlist
against it.
**Class**: behavior change. **Branch**: `feat/own-agent-crackable-community`.
**Required skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at PR readiness.

### Acceptance criteria

1. Over a population of owner keys, every own-agent community is a word in the default
   wordlist (today ~40% are not).
2. `apt install snmpd` prints that word, and the state file holds its md5, as today.
3. The community stays deterministic per owner key: reinstalling prints the same word.
4. Generated devices' communities are unchanged (still 60/40 at `CRACK_CHANCE.community`).

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **RED** in the own-agent tests: over a few hundred owner keys, every community is in
   `DEFAULT_WORDLIST`. **GREEN**: `ownAgentCommunity` picks from `CRACKABLE_PASSWORDS` on its
   own `own-agent-community-` stream instead of going through `seedSnmpCommunity`. Rewrite the
   `ownAgent.ts` header: the "same pool at the same rate" paragraph becomes "the crackable
   pool only, so the owner can always be told it and every agent joins the economy".
2. **Docs and version.** The SNMP section of the as-built doc that describes the own agent;
   the next minor version in `package.json` + `package-lock.json`.

### Evidence

- Unit: the population test; the existing install tests (state-file hash matches the printed
  word) stay green; generated-device community tests untouched.
- Wire-check re-run: `scripts/testSnmpInstall.ts` and `scripts/testSnmpCrossPlayer.ts`.
- Pre-PR: Stryker on `ownAgent.ts`; `npm run typecheck`; `npm run lint`; the full test run.

---

## Slice 2: the secrets come from `JSHACK_SECRETS`, with a new uncrackable list

**Status**: DONE — PR #695, squash-merged as `ecf36d57`, v0.397.0; Production READY
(`dpl_EWAAvbVEuCS5vrVsFDyFFjKsAU3m`). As built, worth knowing for slice 3:

- **Shape errors come first.** `parseSecrets` reports every shape problem (missing or unknown
  list, a non-word) at once, and the word rules run only once the shape is right.
- **Rotating the uncrackable list moves golden pins**: the landmark fingerprints
  (`landmarks.test.ts`), the db-box and backdoor rows (`remoteHostFs.test.ts`), and the inner
  gateway's pin in `routerFs.test.ts`, which now asserts a pool POSITION
  (`UNCRACKABLE_PASSWORDS[2]`) rather than a word. Slice 3's seeder rename touches that pin.
  The runbook in `docs/handbook/12-build-deploy-operate.md` tells the owner to re-capture them.
- **Proof the rotation moved nothing else**: all 612 networks generated byte-identical between
  the old and new list with uncrackable words and their md5s masked (4,409 occurrences each).
  The same masked-dump technique is a ready base for slice 3's world-fingerprint diff.
- **Vercel**: the MCP connection answers 403 on project env variables; the CLI works. Its
  `vercel env add JSHACK_SECRETS preview` keeps demanding a branch, so the Preview entry was made
  through `vercel api /v10/projects/<id>/env` (all branches, type `encrypted`, readable). A
  pulled value is double-quoted without escaping; Node's env-file reader needs it single-quoted.
- **Local stack**: WinNAT still reserves 54247–55336; the wire-checks ran with supabase remapped
  to 556xx (config and env file backed up and restored afterwards).

**Value**: the repo holds no spoiler secret from here on, and the live uncrackable words are
ones its history has never seen. The owner gets a precise error on a missing or malformed
variable instead of a quietly wrong world.
**Path**: `.env.development.local` locally, or Vercel's build env → `scripts/encode.ts` →
`__encoded.ts` → the pools → every generated door.
**Class**: behavior change (the uncrackable words re-roll; the build gains a hard failure).
**Branch**: `feat/secrets-from-env`.
**Required skills**: `tdd`, `testing`, `refactoring`, `typescript-strict`;
`mutation-testing` at PR readiness.

### Shape (settled while planning)

- **A pure parser, `src/core/secrets/parseSecrets.ts`**, takes the raw string and returns the
  four lists or an error naming the key and the rule. zod schema; invariants that a bad paste
  could break and that no test run on Vercel would catch:
  - each of `UNCRACKABLE_PASSWORDS`, `CRACKABLE_PASSWORDS`, `COMMON_PASSWORDS`,
    `WIFI_PASSWORDS` is a non-empty array of non-blank, unique strings;
  - the uncrackable list has at least 40 words and more than the crackable list;
  - no uncrackable word is in the crackable, padding or wifi lists (the wordlist must never
    cover it).
  The invariant tests in `passwordPools.test.ts` and `defaultWordlist.test.ts` that check
  the real data move onto the parser, tested with small fixtures; the parser is now the gate
  that runs on Vercel too.
- **`scripts/encode.ts`** reads `process.env.JSHACK_SECRETS`; when absent and
  `.env.development.local` exists, it `process.loadEnvFile`s that first. Missing or invalid →
  prints the parser's message and exits 1. Output shape unchanged: four XOR-encoded entries.
- **`secrets.ts` is deleted.** Its per-list comments (why each pool exists, why the words read
  as chosen) move to the consumers: `passwordPools.ts`, `defaultWordlist.ts`,
  `generateWifi.ts`.
- **The new uncrackable list**: Claude drafts ~50 words in the session (decision 6's shape),
  the owner edits and approves, Claude writes the full JSON into `.env.development.local`.

### Acceptance criteria

1. With `JSHACK_SECRETS` unset and no local file, `npm run encode` (and so `dev`, `build`,
   `test`, `typecheck`) fails, naming the variable.
2. A malformed value fails naming the key and the rule broken (a missing list, a blank word,
   a duplicate, an uncrackable word also in the wordlist, too short an uncrackable list).
3. A valid value produces the same pools the game used before for crackable, padding and
   wifi: those doors and every wifi key are unchanged.
4. Every uncrackable door now draws from the new list, and no word of the old list is in it.
5. `src/core/secrets/secrets.ts` is gone and no committed file holds a pool word list.
6. The six leak tests pass against the new real list.
7. The Vercel Preview build of the PR succeeds with the variable set there.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The parser.** RED in `parseSecrets.test.ts`: a valid fixture parses; each broken rule
   fails with its key and reason. GREEN: the schema. Move the data-invariant tests here.
2. **`encode.ts` reads the env.** Old list first (same values as `secrets.ts`, in
   `.env.development.local`), so the full test run proves the move is value-preserving before
   anything rotates. Then delete `secrets.ts`. Evidence: criteria 1–3 by running
   `npm run encode` with the variable unset, malformed, and valid; full test run green.
3. **Rotate the uncrackable list.** Draft, owner approval, written to the local file. Fix any
   test that hard-codes an old word (`grep` for each old word across `src/` and `scripts/`).
   Full test run green, the six leak tests included.
4. **Vercel.** Set `JSHACK_SECRETS`, readable, in Preview, Production and Development
   (Vercel MCP), read all three back and compare with the local value (decision 10). Before
   the PR is pushed.
5. **Docs and version.** Fresh-machine setup (where the variable comes from, what fails
   without it, restoring it from Vercel's Development entry) in
   `docs/handbook/02-local-development.md` and `docs/conventions-and-gotchas.md`; the
   "Changing the secrets later" runbook, re-roll warning included, in
   `docs/handbook/12-build-deploy-operate.md`;
   every doc naming `secrets.ts` (`01-architecture`, `03-codebase-map`, `04-client-runtime`,
   `06-world-generation`, `12-build-deploy-operate`, `e2e-shared-network-verification.md`,
   the `e2e` skill); the next minor version.

### Evidence

- Unit: the parser (every rule, the key named); the full test run on the old list (value
  preservation), then on the new list.
- `npm run encode` by hand: unset, malformed, valid.
- Wire-checks: one cross-player crack and one NPC root login re-run against `vercel dev`
  (`scripts/testHydraCrossPlayer.ts`, `scripts/testCrossPlayerSuElevate.ts`) to prove the
  server half generates from the same env.
- The PR's Vercel Preview build succeeds.
- Pre-PR: Stryker on `parseSecrets.ts`; `npm run typecheck`; `npm run lint`.

---

## Slice 3: the bundle carries the uncrackable pool as hashes only

**Status**: DONE — PR #696, squash-merged as `0eca075e`, v0.398.0; Production READY
(`dpl_9nkFznEYry7PjSNpm9ScyX5VB9pg`). As built, worth knowing for the close-out:

- **`plaintextFor(hash)` throws** for a hash from no pool. The ~31 sites that call
  `ALL_GENERATED_PASSWORDS.find(…)` and treat "no match" as normal (a player-set account)
  kept that call, only importing it from `src/test/passwords.ts` now.
- **The leak scan is `src/core/secrets/findSecretLeaks.ts`**, pure and unit-tested, because
  vitest only collects `src/`; `scripts/checkSecrets.ts` reads `dist/` and reports. It matches
  literal words only: an `encode.ts` that regressed to writing plaintext under the hash key would
  pass it, and is caught instead by the generation tests and the world fingerprint.
- **`UNCRACKABLE_HASHES` goes through the same XOR codec** as the other lists, for one module
  shape; the obfuscation adds nothing for hashes.
- **The world fingerprint** (scratch, uncommitted) hashed every box tree of 612 networks (3,727
  boxes), the 5 fixed sites and 200 own boxes: byte-identical to `main`. Every one of the 45
  migrated wire-checks passed against `vercel dev`; the Vercel Preview log shows both modules
  written and `ok   secrets: none of 52 uncrackable passwords in 18 built files`.
- **`checkBudgets` timings are load-noisy here**: a back-to-back A/B had `main` failing sets the
  branch then passed. Read a timing failure against `main` before blaming a change.

**Value**: a player who digs through the bundle finds no uncrackable word, only hashes they
would have to crack, exactly as they would in-game. The generated world is identical.
**Path**: `scripts/encode.ts` → `__encoded.ts` (uncrackable as md5s) and `__plaintext.ts`
(test-only) → `drawPasswordHash` → every generator → `dist/` → the postbuild check.
**Class**: pure refactor of world output (every generated hash identical) plus a new build
gate. **Branch**: `feat/uncrackable-pool-as-hashes`.
**Required skills**: `testing`, `refactoring`; `mutation-testing` at PR readiness.

### Shape (settled while planning)

- **`encode.ts` writes two modules.** `__encoded.ts`: crackable, padding and wifi as today,
  and `UNCRACKABLE_HASHES` (md5 of each word, list order kept, so `prng.pick` lands on the
  same index). `__plaintext.ts`: the four raw lists. Both gitignored.
- **One drawer returns a hash.** `drawPassword` becomes `drawPasswordHash(prng, chance)`:
  `crackable ? md5(prng.pick(CRACKABLE_PASSWORDS)) : prng.pick(UNCRACKABLE_HASHES)`, still
  exactly two draws. `UNCRACKABLE_PASSWORDS` and `ALL_GENERATED_PASSWORDS` leave production.
- **Every `md5(drawPassword(…))` becomes `drawPasswordHash(…)`**, and the seeders that return
  a plaintext return a hash and say so in their name: `seedApGatewayAdminHash`,
  `seedInnerGatewayAdminHash`, `seedDeepGatewayAdminHash`, `seedSnmpCommunityHash`,
  `seedApGatewayCommunityHash`, `workstationGuestHash`. `ownAgentCommunity` (crackable after
  slice 1) keeps returning a word.
- **A test-only helper, `src/test/passwords.ts`**, over `__plaintext.ts`:
  `ALL_GENERATED_PASSWORDS`, the raw lists, and `plaintextFor(hash)`. Tests and wire-checks
  switch to it: `ALL_GENERATED_PASSWORDS.find(c => md5(c) === hash)` → `plaintextFor(hash)`,
  `seedApGatewayAdminPw(essid)` → `plaintextFor(seedApGatewayAdminHash(essid))`.
- **Lint**: a `no-restricted-imports` block forbidding `__plaintext.js` and `src/test/**` from
  every file except `*.test.ts(x)`, `src/test/**` and `scripts/**`.
  `scripts/seedCrossPlayerTarget.ts` moves to `plaintextFor(workstationGuestHash(…))`.
- **`scripts/checkSecrets.ts`**, run first in `postbuild` (deterministic, before the noisy
  budgets): reads every uncrackable word from `__plaintext.ts`, scans `dist/`, fails naming
  the word and the file.

### Acceptance criteria

1. No uncrackable word appears anywhere in `dist/`; `npm run build` fails, naming the word and
   file, if one ever does.
2. Every generated credential hash is identical to slice 2's: a world fingerprint (every
   account, gateway admin, community, database and store lock across every town, plus own
   boxes for a set of owner keys) diffs empty against `main`.
3. Production code (`src/` outside tests and `src/test/**`, and `api/`) importing
   `__plaintext.ts` or `src/test/**` is a lint error.
4. Every test and wire-check that needs a plaintext gets it from `src/test/passwords.ts`.

### Increments (green throughout; commit on approval)

1. **Fingerprint baseline.** A scratch script (not committed) prints every credential hash
   across the world set `scripts/checkBudgets.ts` already builds (Ridgemont's landmarks,
   every drawn town, the corporations, with their home LANs and deep layers), plus own boxes
   for a fixed set of owner keys, on `main`; saved to the scratchpad.
2. **Two modules and the hash drawer.** `encode.ts` output, `drawPasswordHash`, the seeders
   renamed, the test helper, every test and wire-check moved onto it. Full test run green;
   fingerprint diffs empty.
3. **The lint block.** Proven by a throwaway production import that lint rejects.
4. **The postbuild check.** Proven by a throwaway uncrackable word planted in a source string:
   the build fails naming it; removed, the build passes. Then the real build: no match.
5. **Docs.** The secrets sections touched in slice 2, now saying the bundle holds hashes;
   the `e2e` skill's offline secret derivation (`plaintextFor(seed*Hash(…))`);
   `docs/backlog.md`'s "The password pools are in the public repo" marked resolved.

### Evidence

- Preservation: the world fingerprint diffs empty; the full test run green before and after.
- Wire-checks against `vercel dev` (the server rebuilds the same hashes): the hydra
  cross-player, `su` elevate, inner-gateway reach, deep chain, mysql, redis and SNMP
  cross-player scripts.
- The build check's planted-word run (fails) and the real build (passes); `grep` of `dist/`
  for every old and new uncrackable word: none.
- Pre-PR: Stryker on `passwordPools.ts` and `checkSecrets.ts`; `npm run typecheck`;
  `npm run lint`.

## After each merge, and rollback (find-gaps, 2026-10-17)

- **Every slice:** once its PR lands, Claude confirms `main`'s Production deployment reaches
  READY (Vercel MCP). A failed build never gets promoted, so the previous deployment keeps
  serving. The fix is to correct the env value and redeploy, or `git revert` the PR. Leaving
  `JSHACK_SECRETS` in Vercel after a revert is harmless.
- **Close-out browser run after slice 3** (`e2e` skill, against production):
  1. `apt install snmpd` prints a community that is in `passwords.txt`.
  2. `hydra` with the default wordlist cracks a crackable-pool door.
  3. An NPC whose root drew from the uncrackable pool opens with its plaintext once that
     word is appended to the wordlist, which proves the hashed draw matches the real word.
  4. The live JS bundle, fetched from production, contains no uncrackable word.

## Carried risks

- **Order matters for Vercel.** Slice 2's PR must not be pushed before both Vercel envs hold
  `JSHACK_SECRETS`; a Preview env applies to every branch, so setting it early breaks nothing
  on `main` (the code there ignores it).
- **Installed own agents keep their old community** (hashed into the state file at install)
  until reinstalled; pre-launch, accepted.
- **The rotation re-rolls every uncrackable door.** Players' harvested words stop working;
  pre-launch, no compat burden.
- **The bundle's hashes are the whole pool at once** (decision 6): accepted.
