# Secrets from the environment — grill record

Goal: take every spoiler secret out of the repo (`src/core/secrets/secrets.ts`) and
supply it at build time from an environment variable; ship the uncrackable pool to
the bundle as md5 hashes only. Rotate the uncrackable list, since the current one is
in git history.

Facts established before the grill:

- ~20 unit tests and ~25 `scripts/test*.ts` wire-checks reverse-look-up a plaintext
  from a generated hash (`ALL_GENERATED_PASSWORDS.find(c => md5(c) === hash)`), many
  for NPC root (88% uncrackable). Six tests (`gatewayAdminUi`, `gatewayBackups`,
  `mailbox`, `phoneHome`, `share`, `store`) assert no pool word leaks into generated
  content. All need the uncrackable plaintext.
- No CI workflows exist; the env is needed in Vercel Preview, Vercel Production and
  the local `.env.development.local`.
- `ownAgentCommunity` is the one runtime consumer that needs an uncrackable plaintext
  (it shows the owner their community once).

## Decisions

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
   expose it to client code). Rejected: one var per list — fifteen values across three
   environments for the same error precision.
4. **Tests read plaintext from a second generated, gitignored module,
   `src/core/secrets/__plaintext.ts`**, importable only from `*.test.ts(x)`,
   `src/test/**` and `scripts/test*.ts` (lint-enforced). Production code reads the
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
   pastes it.** The words in the session transcript are acceptable — it is a casual
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

## Follow-ons the plan must carry

- Rotating the uncrackable list and drawing the own-agent community from the crackable
  pool change the generated world → a minor version bump.
- `secrets.ts` is deleted; `scripts/encode.ts` loads `.env.development.local` locally
  (Vercel's build has the var in `process.env`).
- The `e2e` skill derives seeded secrets offline from the pools — it must read the new
  test-only module.
- `docs/conventions-and-gotchas.md` and any doc naming `secrets.ts` need the new
  source of truth and the setup step for a fresh machine.
