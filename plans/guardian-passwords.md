# Plan: the guardian changes passwords

**Status:** grill complete + plan drafted (2026-10-28) — ready to implement (TDD). Not yet started.

Every guardian `patch` (and so every `restore`, which ends by patching) rewrites each patrolled
box's `/etc/passwd` as generated, with every account holding a freshly drawn password of the
same kind it was born with, and appends a real-`passwd` line per account to the box's
`auth.log`. It closes the bundle shortcut: a generated box's password is seeded, so a player
who decodes the bundle can work a crackable account's word out without the `hydra` run whose
attempts land in `auth.log`. A word the guardian drew at round time comes from no seed.

No engine change is needed for the lockout: `ssh`, `su` and `hydra` all read the account hash
from the box's replayed journal (`passwdAccount.ts`), so the guardian's row, being the latest
written, wins over the seed's and over any earlier player's `passwd`.

---

## Grill record (2026-10-28)

1. **Pool: the same kind the account already holds.** An account generated crackable gets a
   fresh word from `CRACKABLE_PASSWORDS`; one generated uncrackable gets a fresh hash from
   `UNCRACKABLE_HASHES`. Every box stays exactly as hard as it was generated and `hydra` still
   opens what it opened before; only the shortcut goes. Every account rotates, uncrackable
   ones included, though they had no shortcut to close: one rule, no carve-out. Rejected:
   always crackable (the guardian would make the civic web easier than generated) and always
   uncrackable (the first round would erase every crackable find on the patrol).

2. **Reach: the same boxes as `patch`.** The named public websites, or the patrol (every fixed
   box, then each `government` and `public` network's site, 52 boxes) when none are named.
   The shortcut stays open on shop servers, NPC LAN hosts and AP gateways: those are the
   neglected boxes, defended by nobody, and that is the point of them. Rejected: adding each
   civic site's AP gateway (a second kind of box in the patrol), and every generated box (the
   guardian is the public web's caretaker, and "neglected" would stop meaning anything).

3. **What is written: the whole `/etc/passwd` as generated.** The rows the box was born with,
   in their order and with every field but the hash as generated, each hash freshly drawn in
   its GENERATED kind. A player's `passwd` change is replaced, an account they added is gone,
   a row they deleted comes back. "Kind" is read off the box as generated, so a hash a player
   set (in neither pool) is never classified. Not a restore: sessions stay, and the rest of
   the journal (a defaced page, a wiped log) is still the owner's pick to restore. Rejected:
   rewriting only field 2 of the generated rows in the file as it stands, which would keep a
   player's backdoor account open through the round.

4. **`patch` rotates; no new verb.** Every patch round rotates every box it reaches, and
   `restore` already ends by patching, so a restore can never leave the box on its seeded
   passwords. The `/guardian` skill's round is unchanged. Accepted costs: a patch is no longer
   "nothing but the moved versions marks that the guardian came by", it is no longer
   idempotent (every run draws again, a rerun after a database error just draws again), and an
   `up to date` box still has its passwords changed. Rejected: a separate `rotate` verb (one
   more verb, step and allow rule) and a verb `restore` doesn't call (the shortcut reopens
   silently when the owner forgets it).

5. **Trace: one `passwd` line per account on the box's `auth.log`.** The line the `passwd`
   command writes (`formatPasswdLine`: `passwd[pid]: password changed for <user>`), appended
   as the box. A rooted player who reads the logs learns the guardian came by and when;
   nothing is pushed at anyone. Rejected: no trace, which would be unlike every other write
   in the world (even a restore leaves its boot marker).

6. **Defaults confirmed with the summary:**
   - A rotation ends no session (a patch evicts nobody). A player already on the box stays
     until they leave, then finds their word dead.
   - A bricked box is left alone, as `patch` already leaves it; it comes back through
     `restore`, which rotates.
   - The words are drawn from `node:crypto`, never a seeded PRNG, which would only be a new
     bundle shortcut.
   - The operator never sees or stores the new words.
   - The patch line names the count: `millbrook.gov: 11 upgraded (…), 3 passwords changed`,
     and the total line counts the passwords changed across the round.
   - A fresh draw may land on the word the account already held. Luck, no exclusion rule.
   - One slice, one PR, a minor version bump.

---

## Design (how the decisions map to the engine)

**Core, pure (`src/core/guardian/`).** `decidePatch` takes two more inputs from the script:
`draw` (a `{ crackable(): string; uncrackable(): string }` returning an md5 hash, backed by
`node:crypto` in the script and by a fixed function in tests) and `now` (the epoch stamp the
`auth.log` lines carry, through `asGameTime` and `derivePid` as `passwdChange.ts` does). Its
non-bricked outcomes now carry, beside the manifest, the passwd rows:

- **`/etc/passwd`**: the base tree's `/etc/passwd` (`box.baseFs()`), each row's hash replaced
  by `draw.crackable()` when the generated hash is the md5 of a `CRACKABLE_PASSWORDS` word,
  else by `draw.uncrackable()`. Owner `root`, `PASSWD_FILE` permissions, restated as the
  passwd command restates them. Written under `apGatewayLogWriterKey(box.networkKey)`.
- **`/var/log/auth.log`**: the log as the replayed tree holds it (`materializeMachineFs`,
  which `decidePatch` already builds), plus one `formatPasswdLine` per account, hostname from
  the box's `/etc/hostname`. A wiped log starts again from the lines. Same writer key,
  `AUTH_LOG_OWNER` / `AUTH_LOG_PERMISSIONS`. One row, appended in the decider rather than
  through `appendMachineLog`, because the script already holds the journal it reads.

Probable shape (settle in GREEN/REFACTOR, collapsed first): `PatchOutcome`'s `up-to-date` and
`upgraded` both gain `rows: readonly PatchRow[]` (every row the patch writes) and
`passwordsChanged: number`; `upgraded`'s `row` folds into `rows`. `decideRestore` passes the
same `draw`/`now` through and writes `[...patch.rows, marker]`; with `journal: null` the
auth.log builds on the base tree's log.

**Report (`report.ts`).** `isOwnRow` also accepts `/etc/passwd` under the box's writer key,
so a round never reads its own rotation as tampering. A player's `passwd` row is under their
own key and still reads as tampered.

**Script (`scripts/guardian.ts`).** `patch` upserts every row of the outcome (it upserts one
today); `restore` passes the draw and time through. The draw: `randomInt` over
`CRACKABLE_PASSWORDS` → `md5`, and over `UNCRACKABLE_HASHES`.

**Unchanged:** sessions, the patrol, the round in the skill, every reader of `/etc/passwd`.

---

## TDD slices (each leaves the tree green)

1. **A patch rewrites `/etc/passwd` as generated, each hash redrawn in its generated kind.**
   Through `decidePatch`: a civic site's server (root, user, guest) and a fixed box (root
   only); a crackable-generated account draws from `crackable`, an uncrackable one from
   `uncrackable` (a test pool whose generated root is uncrackable — pick the box offline via
   `src/test/passwords.ts`, never print a word); a journal holding a player's `passwd` change,
   an added account and a deleted row comes out as generated; an `up to date` box still
   rotates; a bricked box writes nothing. Rows written as the box, root's.
2. **Each changed account leaves a `passwd` line on the box's `auth.log`.** Appended to the log
   as replayed; a wiped (tombstoned) log restarts from the lines; the time and pid come from
   `now`.
3. **Restore rotates.** `decideRestore` writes the passwd and auth.log rows with the patched
   manifest and the boot marker.
4. **The report reads the guardian's own `/etc/passwd` as the box's own**, and a player's still
   as tampered.
5. **Operator lines.** `patchSummary` names `N passwords changed`; `patchTotal` counts them.
6. **Script + wire-check.** `guardian.ts` draws with `node:crypto` and upserts every row.
   `scripts/testGuardian.ts`: after a patch the seeded root word is refused over `ssh`, the new
   one (found offline: the journal's hash against `CRACKABLE_PASSWORDS`) is accepted, a player's
   earlier `passwd` word is refused, the intruder already inside stays standing, and `auth.log`
   holds the lines. **The existing "a second round the same day writes nothing" check changes:**
   a second round now moves no package but changes the passwords again.
7. **Docs.** The `guardian.ts` header, `patch.ts`/`restore.ts` headers ("leaves no trace but
   the versions it moved" no longer holds), `.claude/skills/guardian/SKILL.md` (the patch line
   and `/etc/passwd` in "Reading a report line"), handbook 12 "Data fixes", and the backlog item
   removed. Version bump in `package.json` + `package-lock.json`.

## Evidence & gates

- `npm run typecheck`, `npm run lint`, the unit suite.
- Wire-check `scripts/testGuardian.ts` against `vercel dev` + local supabase (the `api/` reads
  are unchanged, but the guardian writes through the service role and the lockout is only
  proven by a live `ssh`).
- Mutation gate (Stryker, json reporter, scoped to `src/core/guardian/`) at PR readiness.
- Browser: none for this slice. No client change; the live `ssh` in the wire-check is the
  player's view. A production `/guardian` round by the owner is the real-world confirmation.

## Out of scope

- Rotating any box outside the patrol / named public websites (decision 2).
- A scheduled guardian (its own backlog item).
- Ending sessions on rotation.
