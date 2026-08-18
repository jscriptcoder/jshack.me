# Plan: an ftp session shows the box you logged into

**Branch**: `fix/ftp-cross-player-tree`
**Status**: Slice 1 DONE (v0.152.0) — awaiting commit approval
**Sibling**: [`d5-netcat-backdoor.md`](./d5-netcat-backdoor.md) slice 8 — the same defect at the
shell's door, closed at v0.151.0. Read its as-built before starting; both halves of that fix have
an exact counterpart here.
**Foundations**: [`cross-player-architecture.md`](../v2/docs/cross-player-architecture.md) §3
(reachability/login), §4 (authorization), §5 (read filter);
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §9 (the closed nc entry).

## Goal

An `ftp` session held on a box that is not on the player's own LAN lists — and hands over — THAT
box's files, instead of the player's own.

## Why this exists

Slice 8 of D5 fixed one of **three** places that decide which tree a session reads. They are
supposed to agree and did not:

| Site | Cross-player check | State |
|---|---|---|
| `scpTargetTree` (`state.ts:623`) | `isCrossPlayerWorkstation` → `resolveCrossPlayerFs` | correct |
| `activeRoot` / `isCrossPlayerHop` (`state.ts:365`, `activeRoot.ts:81`) | kind-gated; `nc` was missing | **fixed v0.151.0** |
| `ftpRoot` (`state.ts:389`) | **none at all** | **fixed v0.152.0** (this plan) |

`ftpRoot` calls `resolveActiveRoot` directly. Off the player's own LAN, `baseFsFor` finds no
generated host for the target's `machine_id` under the VIEWER's essid and falls through to
`?? ownBaseFs` — the intruder's own workstation seed, with the target's journal replayed over it.
`scpTargetTree`'s own docstring already names this failure mode in so many words: *"the local
resolver falls back to OUR OWN base."*

**CONFIRMED, not a lead.** The reproduction printed it: at `ftp>` on another network's box,
`ls /home` answered `tester` — the intruder's own account. The RED failed on its first run for
exactly the stated reason.

**And it is worse than the nc case was.** `get` reads through the same `env.ftp.fs`, so
`get /etc/passwd` off another player's box would hand the intruder a copy of their OWN file while
reporting a transfer, and the server would itemise it in the target's `vsftpd.log` as a file that
left. The player is looking at one box and taking from another.

## Grounding, confirmed by reading the code (do not re-derive)

- **`ftpRoot` is synchronous** — `ftpBinding` feeds it straight into
  `createFsView(ftpRoot(session), …)`. `scpTargetTree`'s async on-demand shape does **not**
  transplant here; the tree has to be resolved ahead of the read, which is what `ftpPatches`
  already does for the journal.
- **There is already a second-signal precedent, and it is the right one.** `ftpCwd` and
  `ftpPatches` exist because an ftp session is a SECOND machine held beside the shell, and
  `servedRoot()` follows the ACTIVE session only. A cross-player ftp target needs its own served
  tree beside them, on the same reasoning.
- **The existing ftp suite cannot see this.** `state.test.ts`'s `the ftp sub-shell` describe picks
  its targets with `generateHomeLan(ESSID)` where `ESSID` is the essid the player is CONNECTED to,
  then reaches them at `THEIR_PUBLIC_IP`. The address is foreign; the machine is not. So
  `generatedBaseFsForMachineId` resolves, the local path is exercised, and the fallback never
  fires. **The RED fixture's whole job is to be on a different essid** — this is the same fixture
  blind spot slice 8 found in `activeRoot.test.ts`, in a different suite.
- **`isCrossPlayerHop` must NOT be widened to `ftp`.** `activeRoot.test.ts` pins it `false` and
  `activeRoot.ts`'s docstring says why: ftp addresses its target through `ftpRoot`, and the shell
  underneath is a different machine that still needs its own answer. That assertion should survive
  this fix untouched. If a change wants to flip it, the diagnosis is wrong.
- **The write path carries the same trap slice 8 hit.** `writeToFtpTarget` ends
  `if (written.ok) void refetchFtpPatches(session)` — the JOURNAL. The moment `ftpRoot` reads a
  SERVED tree, that re-pull refreshes a source the tree is no longer built from, and a landed
  `put` will not appear in the next `ls`. Its docstring states the rule out loud (*"A landed write
  re-pulls the TARGET's journal … so the next `ls` at the prompt shows the file that just
  arrived"*), so the comment moves with the code.
- **The server side is believed, not proven.** `authorizeMachineAccess` gates
  `resolveCrossPlayerFs` on an active session row regardless of kind — proven for `nc` by
  `testNcCrossPlayerReach` check 5, never for `ftp`. `testFtpCrossPlayer` is 16/16 on login, logs,
  tier-filtered writes and framing, and has no served-tree check at all.

## Acceptance Criteria

- [x] An `ftp` session on a machine that is NOT on the viewer's current LAN lists the TARGET's own
      seeded files at `ftp>`, and does not list a file that exists only on the intruder's box
- [x] A `get` from such a session transfers the target's bytes, not the intruder's
- [x] A `put` that lands is visible to the next `ls` at the same prompt — across the network as it
      already is on the LAN
- [x] An ftp session on a host that IS on the viewer's LAN still resolves locally, with no round
      trip added to a read
- [x] While a cross-player tree is in flight the prompt shows an EMPTY listing, never the
      intruder's own box
- [x] The shell underneath is untouched: `quit` hands back the same machine, cwd and tier it did
      before, and `activeRoot` never sees the ftp target
- [x] `scripts/testFtpCrossPlayer.ts` proves an `ftp` row alone is served the target's tree

## Reduction Program

`N/A` — no mechanism is retired. This adds the served-tree half `ftpRoot` never had.

## Slices

**Present the slice's acceptance criteria and wait for approval before writing any code.**

---

### Slice 1: An ftp session on another player's box lists that box — DONE (v0.152.0)

**Value**: A player who logs into a stranger's ftp door sees the stranger's files — the thing the
door was sold as doing.
**Path**: `ftp <their public IP>` → `ftpAuthenticatePublic` returns a row on the target →
`enterFtpSession` → `ftpRoot(session)` → today `resolveActiveRoot` falls back to `ownBaseFs` →
with the served tree fetched and preferred, `env.ftp.fs` renders the target.
**Class**: Behavior change — full TDD cycle.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.

**Acceptance criteria**: the seven above, which are one slice's worth: they are one behavior
(`ftp>` reads the box you logged into) plus the invariants that keep it from costing something
elsewhere. If the write-visibility half turns out to want its own RED-GREEN — as it did in slice 8,
where the guard test drove it — take it as a second commit inside the slice, not a second PR.

**RED**: A `state.ts`-level test whose target is generated on an essid the player is NOT connected
to, so the machine is genuinely foreign. At `ftp>`, `ls` must show a file seeded on the target and
must NOT show one that exists only on the intruder's own box. Fails today by listing the intruder's
box. Build the served tree the way the server composes it —
`applyPatches(buildRemoteHostFs(essid, host), journal)`, base plus journal — because a hand-rolled
tree is not a box (slice 8's harness trap, recorded in §9).
**GREEN**: A served tree held beside `ftpPatches`, fetched on enter and preferred by `ftpRoot`,
with an empty root while it is in flight. Minimum that passes — do not generalize the two ftp
signals and the shell's three into a shared abstraction on this slice.
**MUTATE**: Meaningful. The machine-level predicate is the thing being added, so a mutant that
routes EVERY ftp session through the server, or none, must fail. Expect the same class of survivor
slice 8 found: a mutant that changes no output, only how many requests are issued — plan a test
that PRICES a read on the own-LAN path.
**KILL MUTANTS**: Assert the own-LAN ftp case explicitly, and assert the round-trip count on it.
**REFACTOR**: Assess whether `activeRoot`'s and `ftpRoot`'s served/loading/local ladder is now one
shape written twice. It may be — but three resolution sites drifting is what caused this, and a
premature shared helper that hides which machine is being asked about would make the next drift
harder to see. Decide with the code in front of you, not now.
**Wire-check**: **Required.** Extend `scripts/testFtpCrossPlayer.ts` with the counterpart of
`testNcCrossPlayerReach`'s check 5: a caller holding only an `ftp` row is served the target's own
tree by `resolveCrossPlayerFs`. If it is refused, this plan's GREEN is wrong and the fix moves
server-side — find that out before writing the client half.
**Done when**: All criteria met, wire-check green, `conventions-and-gotchas.md` §9 records the
outcome (a third site that drifted, or a lead that proved false), human approves the commit.

**As-built.** The plan held: the wire-check answered first, the RED reproduced, and the fix was
client-side. Five things worth carrying:

- **The wire-check ran BEFORE the client work and was worth it.** `resolveCrossPlayerFs` serves a
  caller holding only an `ftp` row (check 17) and prunes to the tier the credential bought, not
  the box owner's (check 18) — so no server change was needed. Had it refused, every line of the
  client fix would have been wrong. 18/18.
- **The fixture blind spot was the whole reason this shipped.** The existing ftp suite reaches its
  targets at a public IP but generates them on the essid the player is CONNECTED to: foreign
  address, local machine, resolver always succeeds. Moving the target to another essid is the
  entire difference between a suite that could see this and one that could not.
- **The write half was branched, not doubled, and a test proved it load-bearing.** Hand-applying
  the half-fix (`refetchFtpPatches` after a landed write, with the tree now SERVED) makes `put`
  land and never appear — caught by the guard written before the read half moved. Same trap as
  slice 8, found deliberately this time rather than by luck.
- **A machine-id tag on the served tree was removed rather than tested.** It produced a mutant
  nothing could kill — one ftp session at a time, and entering one clears the tree, so a mismatched
  tag is unreachable. What replaced it is a test of the race it was imagined to cover: a slow
  answer about the foreign box landing after the player opened a door on their OWN LAN. Without
  the session-id guard that answer paints the other network's tree over the local one, which the
  test now shows.
- **Mutation**: 20 mutants on the lines this slice wrote, **18 killed (90%)**. Both survivors are
  defensive guards whose identical twins in the shipped `refetchFtpPatches` carry the same two:
  `if (deps === undefined) return` (unreachable once `startGame` has wired the client) and the
  `?.` in the late-answer guard. The second was chased and proved unkillable at this seam — with
  `?.` removed the mutant throws a real TypeError, but inside a fire-and-forget task, so no
  observable behavior changes. The `?.` stays: a crash in a background task is still a crash.

---

## Live proof

A browser act is **not** required to close this slice, and should not be invented for it: Act 15
already ran the shell's half of this exact fix end to end. What is required is the wire-check
above, because the served-tree fetch for an `ftp` row is a server behavior no unit test can see.

If a browser run happens anyway, note the constraint Act 15 recorded: **wifi lists are seeded per
identity**, so two players do not necessarily share an ESSID — check `airdump` on both before
planning a two-player act around one.

## Pre-PR Quality Gate

Per slice, from `v2/`:

1. **Mutation or alternate evidence** — run `mutation-testing`; record explicit `N/A` plus
   proportionate evidence where it is not meaningful
2. **Refactoring assessment** — `refactoring`; record `N/A` when nothing is worth changing
3. **Typecheck** — `npm run typecheck` (`tsc -b`; a plain `tsc --noEmit` is a NO-OP here)
4. **Lint/format** — `npm run lint` (v2 has no Prettier)
5. **Version bump** — `v2/package.json` AND `v2/package-lock.json`
   (`npm install --package-lock-only`). Current: **0.151.0**
6. **Wire-check** — `scripts/testFtpCrossPlayer.ts` against `vercel dev` + supabase

## Close-out

§9 records it as CLOSED (v0.152.0), with the three-sites table, the fixture-blind-spot rule and
the untagged-tree reasoning — so it survives this file. **Delete this file once the PR merges.**

Left deliberately undone: no browser act. Act 15 already ran the shell's half of this fix end to
end, and the wire-check covers the server half; a third act would re-prove both. If one is ever
run, check `airdump` on both identities first — wifi lists are seeded per player.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
