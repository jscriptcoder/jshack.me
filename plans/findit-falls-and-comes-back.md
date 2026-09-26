# Plan: X2 Slice 4 — findit Falls and Comes Back

**Epic:** `plans/legacy-parity-epic.md`, X2 slice 4. Grill record: "X2 — resolved scope & decisions"
(decisions 91–105, 2026-09-26); slices 1–3's as-built are in the same section. One owner decision
made at planning (2026-09-26, 116, refining 101) is listed under "Decided at planning" below.

**Branch:** `feat/findit-falls-and-comes-back`
**Status:** Active — planned 2026-09-26, one PR, v0.272.0.

---

## Decided at planning (2026-09-26)

**Owner decision (refines 101):**

116. **Restoring findit is a reboot.** `scripts/restoreFindit.ts` ends every open session on
     findit (every player, every kind, `rebooted`, as `reboot` does) and leaves a fresh boot marker on
     the restored box, besides deleting its `patches` rows. The server treats an open session row as
     the authority to act, so wiping the journal alone would leave a player standing on findit as
     root still root on the clean box, free to deface it again at once. And the boot marker that tells
     a standing shell the box went down lives in that same journal, so their terminal would not even
     notice. With 116 a standing shell is thrown off at its next command, exactly as after a reboot,
     and the only way back in is the one 102 names: a live CVE through findit's public address.
     Rejected: patches only (101 as first written), under which "comes back" holds only against
     players who had already left.

**Derived from existing conventions:**

117. **Order is the safety: close the sessions, then empty the journal, then write the marker.**
     Once the rows are closed, the active-session gate refuses every write from a shell that stood on
     the old box, so nothing written mid-restore survives onto the clean one. The other order leaves
     a window where a still-open root session writes into the journal just emptied.
118. **The restored box carries exactly one row: the boot marker**, at `BOOT_ID_PATH` with
     `BOOT_ID_OWNER` / `BOOT_ID_PERMISSIONS`, written under findit's stable network key
     (`apGatewayLogWriterKey(FINDIT_NETWORK)`), the same key its logs accrete under. Closed rows reuse
     the reason `rebooted`: 116 says a restore IS a reboot, so no new `END_REASONS` member. No
     `kern.log` line either. `reboot`'s line names the in-world address that ordered it, and the
     operator has none. The logs are wiped with everything else (102), so the defender's clean box
     starts with empty logs, like a reinstalled one.
119. **The script is the whole mechanism** (the collapsed version first). `scripts/restoreFindit.ts`
     reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` like every operator script. It exits 2 when
     either is missing, and addresses ONE machine id, `computeApGatewayId(FINDIT_NETWORK)`. It has no
     flags and no dry run, and prints what it did (sessions closed, journal rows removed, the new
     marker). Running it on a findit nobody touched closes nothing, removes nothing and leaves a fresh
     marker, which is harmless. Rejected: a `core/` restore function with injected deps and fakes. It
     would test three awaited calls against stand-ins for the only thing that matters, the real
     tables. The wire-check proves those.
120. **"Who searched what" and "a defaced `/` for everyone" are already built, and this slice proves
     them.**
     - Slice 2a logs every fetch's raw path, `/?q=<term>`, under the searcher's server-held address.
     - 100 serves `/` from findit's own `index.html`.
     - The search branch of `handleResolveHttpFetch` answers `?q=` from a function, so defacing, or
       even deleting, `index.html` changes the front page for everyone and leaves search working.

     The exploit, read and write paths reach findit through the gateway arm (`lanHostIdentity`'s
     octet-1 case builds `buildFinditFs()`), but none has been driven against findit live yet. If a
     probe fails, the fix joins this PR through TDD at that handler.
121. **One PR, v0.272.0.** The script alone is the "comes back"; the prize and the defacement have
     nothing to ship without it.

---

## Goal

When a player roots findit.io, they can read who searched for what and deface its front page for
everyone. The operator's `scripts/restoreFindit.ts` then returns findit to its generated state and
throws off anybody standing on it.

## Acceptance Criteria

- [ ] A player who holds a root session on findit (a live CVE through `findit.io:80`) reads findit's
      `/var/log/access.log` and finds another player's search as `/?q=<term>` under that player's
      public address.
- [ ] That player rewrites `/var/www/html/index.html`, and every other player's `curl findit.io`
      gets the rewritten page, while `curl "findit.io/?q=<term>"` still answers with results.
- [ ] Once the operator runs `scripts/restoreFindit.ts`:
  - [ ] `curl findit.io` serves the generated search form again.
  - [ ] Findit's journal holds only a fresh boot marker, so the logs and the planted dpkg are gone.
  - [ ] Every session open on findit is closed as `rebooted`.
  - [ ] The attacker's next write to findit is refused.
- [ ] The script run twice is harmless, and it refuses to run without its env, exiting 2.

## Slices

### Slice 4: findit falls and comes back

**Value:** Behavior change. The operator can undo a rooted findit in one command, and the rooting
that makes that necessary is proven to pay off: another player's search is readable in findit's log,
and a defaced front page reaches everyone.
**Path:**
1. The attacker's `exploitCreateSession` at `findit.io:80` opens a root session on findit's machine.
2. `resolveCrossPlayerFs` lets them read `access.log`, which holds the searcher's
   `resolveHttpFetch ?q=` line.
3. The patch write endpoint rewrites `index.html`.
4. Every player's `resolveHttpFetch /` serves the rewritten page.
5. The operator runs `scripts/restoreFindit.ts`. It closes findit's `sessions` rows, deletes its
   `patches` rows and upserts one boot-marker row.
6. `resolveHttpFetch /` serves the generated form again, and the attacker's write is refused.

**Class:** Behavior change (operational: an operator script over the real tables).
**Delivery:** Independent PR against trunk (`main`), no stack.
**Required implementation skills:**
- Before code: `tdd`, `testing` and `refactoring` (and the `v2-e2e` runbook for the browser run).
- At PR readiness: `mutation-testing`, to confirm the `N/A` below, or to run on any handler a
  failing probe forces into scope.

**Reduction program:** N/A.
**Transition/terminal evidence:** N/A.

**RED (wire-level, since the behavior is the live tables):** write
`scripts/testRestoreFindit.ts` first, against `vercel dev` + local supabase. It follows
`testExploitPublisherSite.ts`'s shape and fixtures: a fixed day from `gameDayAt`, a release from
`packageTimeline` whose `exploitOutcome` is a shell at a tier findit's root account satisfies, and
`registerNetwork` for both players' homes. It runs `npx tsx scripts/restoreFindit.ts` as a child
process with its env passed through. It fails first because the script does not exist.
1. **B searches.** B's `resolveHttpFetch` of `findit.io/?q=<unique term>`, with B registered on a
   crackable network.
2. **A roots findit.** Stage findit's `dpkg/status` on the live-shell release, then A's
   `exploitCreateSession` at findit's derived address, port 80, opens a session on findit's machine
   id.
3. **A reads the prize.** A's `resolveCrossPlayerFs` of findit shows `/var/log/access.log` holding
   `/?q=<term>` under B's stored public address.
4. **A defaces.** A's signed patch write of `/var/www/html/index.html` succeeds. B's
   `resolveHttpFetch /` returns A's page byte for byte, and B's `?q=<term>` still returns the
   results page.
5. **The operator restores.** The script exits 0. Checked through the service role, BEFORE any
   fetch writes a new log line: findit's `patches` holds exactly one row, the boot marker, under the
   network key. A's session row is closed with `rebooted`.
6. **The world sees it.** B's `resolveHttpFetch /` returns the generated front page
   (`FINDIT_FRONT_PAGE`), and A's next signed write to findit is refused.
7. **Twice is harmless.** A second run exits 0 and leaves one marker row, the new one.
8. **No env, no run.** Run without env, the script exits 2.
9. **Cleanup.** Remove both players' rows, then run the script once more so the local findit is
   clean.

A probe that fails for a reason other than the missing script (step 2, 3 or 4 against findit) is a
real defect. It gets its own RED as a unit test at the owning handler (`handleExploitCreateSession`,
the cross-player fs handler or the patch write) before the fix.

**GREEN:** `scripts/restoreFindit.ts`, in the order 117 fixes:
1. Update `sessions` to set `ended_at`/`end_reason: 'rebooted'` where `machine_id = findit` and
   `ended_at IS NULL`.
2. Delete `patches` where `machine_id = findit`.
3. Upsert the boot-marker row under the network key, with content `${randomUUID()}\n`.
4. Print the counts.

Header comment in the house style: what it is for, the order and why, usage with
`npx dotenv -e .env.development.local -- npx tsx scripts/restoreFindit.ts`, and the production
note (the operator supplies production's URL and key).

**REFACTOR:** assess only. `testRestoreFindit.ts` may share `testFindit.ts`'s fetch helpers. Copy,
don't import: scripts are standalone, and `networkFixture.ts` is the only shared fixture module. Move
a helper into `networkFixture.ts` only if a third script would use it.

**PRE-PR MUTATION or alternate evidence:**
- **Mutation: `N/A`** for the script. It is an operational entry point over live tables, outside
  Stryker's reach (no unit test imports it).
- **Alternate evidence:**
  - `testRestoreFindit.ts` green live.
  - The browser run below.
  - The full unit suite, typecheck and lint.
- If a probe forced a handler fix, mutation-test that handler's changed lines (a scoped
  `stryker.mutation.json`, dev server down).

**Browser run** (the `v2-e2e` runbook; two sessions, `alice` and `bob`):
1. Bob, on their own network, runs `lynx findit.io` and searches a distinctive word.
2. Alice finds findit's door: `nmap -sV findit.io`. If no live CVE on findit today opens a shell, the
   run stages findit's `dpkg/status` through psql, as the runbook's §6 allows.
3. Alice exploits it, `cat /var/log/access.log` shows Bob's `/?q=<word>` under Bob's public IP, and
   writes `/var/www/html/index.html` with nano.
4. Bob's `curl findit.io` shows Alice's page, and Bob's search still answers.
5. The operator runs `scripts/restoreFindit.ts`.
6. Alice's next command in the findit shell throws Alice off.
7. Bob's `lynx findit.io` shows the form again.

**Also in the PR:**
- The version goes to 0.272.0 (`package.json` + lock).
- A "Restoring findit" paragraph in `.claude/skills/v2-e2e/SKILL.md`: how to root findit in a run,
  what the script does, and that it throws standing shells off.
- One line in `v2/docs/conventions-and-gotchas.md`'s operational section naming the script.

**Done when:**
- All acceptance criteria are met.
- `testRestoreFindit.ts` passes every check live.
- The browser run is recorded.
- 6345+ unit tests pass, and `npm run typecheck` and `npm run lint` are clean.
- Mutation is recorded as `N/A` with that alternate evidence, or run on any handler a probe forced.

## Pre-PR Quality Gate

1. Implementation complete, refactor assessed.
2. Mutation `N/A` reviewed against the alternate evidence, or run for any forced handler fix (the
   dev server must be DOWN).
3. `npm run typecheck`, `npm run lint` and `npx vitest run` are green.
4. The wire-check is green live, and the browser run is done.
5. No DDD glossary. Domain words match the epic's: findit, restore, boot marker, journal.

## Risks

- **Rooting findit in the browser depends on the world's CVE clock.** Staging the manifest is the
  runbook's sanctioned fallback, and the wire-check never depends on the clock.
- **A restore racing a live write.** 117's order closes the authority first. A write already past the
  gate when the rows close can still land before the delete, and the delete then removes it. Nothing
  can land after the delete except through a new session, which needs a new exploit.
- **Production runs are by hand.** There is no scheduled restore (101 rejected one). The operator
  decides when.
