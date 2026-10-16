# Plan: script holes read the box as it stands

**Status**: Grilled and planned. Decisions confirmed by the owner 2026-10-17. One slice, next.
**Branch**: `feat/script-holes-read-the-box`
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

A script an `msfconsole` hole runs on a box reads that box as it is now, at the tier the hole
granted, on every box a fire can reach. Today it reads a stale copy or nothing, and a script
that edits a file can quietly undo what players did to it.

## Where it starts from (facts, 2026-10-17)

Read in the code on this date.

- **Scripts run in the browser, never on the server.** `runScript` builds an `AsyncFunction`
  over the player's source (`core/scripting/runScript.ts:44`). The server refuses to, since it
  would run player code inside the server (`sessions/exploitCreateSession.ts:124`). Only the
  writes a script made travel with the fire, and the server re-walks each at the granted tier
  before it lands.
- **A network fire's script reads the box as generated.** `msfconsole.ts:1104` rebuilds the
  target with `resolveLanHostIdentity(host, essid).baseFs`, with no journal replayed, and only
  for a generated host on the network the shell stands on. A fellow occupant, a box behind a
  public address and a deep-layer box get an empty tree: their scripts write but never read.
- **The script's view reads as `user` whatever the hole grants** (`targetScriptFs` with no
  tier, `msfconsole.ts:193`).
- **A write replaces the whole file.** The server upserts each write as the file's full
  content (`exploitCreateSession.ts:436`). So a script that reads a file, changes it and writes
  it back replaces the current file with the generated one plus its edit. Example: a root
  changes a generated box's root password, then a script adds a line to `/etc/passwd`; the
  old hash is back and the old password works again. A script appending to a log wipes the
  lines the journal held, since live logs start empty.
- **`--local` on a box that is not the player's own** runs the script against the shell's
  served tree (`msfconsole.ts:1000`): current, but pruned to the shell's tier and read as
  `user`, so a hole granting root cannot read root's files. On the player's own workstation
  `--local` reads the live tree at the granted tier (`msfconsole.ts:859`), which is right.
- **The server already holds the real tree at fire time.** `reachBox` returns `hostFs` with the
  journal replayed for every target kind (`exploitCreateSession.ts:253`), and
  `exploitLocalElevate.ts:293` materializes the box the same way. The served-shell path already
  filters a tree to a tier and serializes it (`filterTreeForSession`, `serializeTree` in
  `network/resolveCrossPlayerFs.ts:125`).
- **Read holes already return a box's files to the client**, one path per fire at the granted
  tier, each leaving a line (`exploitCreateSession.ts:483`).
- **A wallet key is an ordinary file** (`~/.wallet/wallet.dat`); reading one at the right tier
  is already an intended way to take it (`docs/wallet-architecture.md` §4).
- **None of this is in the docs**; only the code comment at `msfconsole.ts:186` mentions the
  stale read, and nothing mentions the overwrite.

## Decisions (owner-confirmed 2026-10-17)

1. **A script hole hands the browser the target's tree, filtered to the granted tier.** A
   modified client can therefore read the whole box in one fire; accepted, since it is what a
   read hole gives for every path at once, and it is the only way to give a script real reads
   without running it on the server. Rejected: running scripts on the server in a sandbox (a
   wasm JS engine or Vercel Sandbox), which keeps the hole blind at the cost of a new
   dependency and a much larger slice.
2. **Every box a network fire reaches**: a generated host, a fellow occupant's workstation, a
   box behind a public address, a deep-layer box, and the box itself over `localhost`. The
   client's own rebuild of the target and the empty-tree branch go. A script on another
   player's box reads their files, wallet key included, at the granted tier. Rejected: generated
   boxes only, and today's reach made current.
3. **`--local` on a box that is not the player's own follows the same rule**, at the granted
   tier rather than the shell's. `--local` on the player's own workstation is unchanged.
4. **Two steps, stateless.** Step 1 is today's fire, sent without running anything. A read
   hole and a write hole finish there exactly as now. A script hole answers with the tree
   filtered to the granted tier; the client runs the script against it. Step 2 is the same fire
   again carrying the writes, and the server recomputes everything (reach, manifest, game day,
   outcome) as it does on any fire, landing the writes only if a script hole still answers.
   The extra round trip happens on script holes only. Rejected: a signed, short-lived grant
   token, which needs a new secret or a table and would land writes on a box that went dark
   in between.
5. **Both steps leave the same exploit line** in the target service's log, so a script run
   writes two lines about a second apart. Neither step alone can be a silent door: step 1 hands
   over the box, and step 2 is a plain fire the server cannot tell from a lone one. Rejected: a
   different wording per step (a new line per service formatter), and logging step 2 only when
   a write lands.
6. **A step 2 that answers differently is rendered like any fire.** A refusal prints the usual
   bounce or connect failure; another effect is rendered as that effect, as a blind fire is
   today. No new wording. Rejected: a dedicated "target changed" line, which tells the player
   something about the box that a bounce hides.
7. **One slice, one PR, a browser run at the close-out.** The PR carries unit and jsdom tests
   and a wire-check proving: a script on a generated box reads a file a player changed (the
   stale read reproduced RED first); a script on a fellow occupant's box reads their files at
   the granted tier; a `--local` script on another box reads at the granted tier, not the
   shell's; a script run leaves two lines; a step 1 alone leaves one. After merge one browser
   run plays the `/etc/passwd` case end to end: change a generated box's root password, fire a
   script that edits `/etc/passwd`, confirm the change holds. Version bumped as for any feature.

## Follows from the decisions

- **A script hole stops being blind on the way back for a modified client only.** The shipped
  client still prints nothing a script read; what it says after a script is unchanged.
- **A script reads at the granted tier**, so a root hole's script sees `/root` and root-only
  service data, where today's view read as `user`.
- **A script that writes back what it read no longer undoes other players' changes**, apart from
  a change landing in the second between the two steps, which is any concurrent edit.
- **The step-2 message carries the writes, never the source**, as today.

## Out of scope

- Running scripts on the server.
- Keying the credential streams with a server secret, and taking the pools out of the repo
  (`docs/backlog.md`, beside "What a network was generated with is computable by any client").

## The slice: a script reads the box it hit, as it stands, at the granted tier

**Value**: a player whose `msfconsole` hole runs their script sees that script read the real
box (other players' changes included, at the tier the hole gave) on every box a fire reaches,
and a script that writes back what it read no longer undoes anyone's work.
**Path**: `msfconsole <host> <port> <script>` and `msfconsole --local <command> <script>` →
`env.exploit.run` / `env.exploit.elevateLocal` → `sessionsApi.ts` (`exploitPayloadFields`,
`interpretExploitResponse`) → `api/sessions.ts` → `handleExploitCreateSession` /
`handleExploitLocalElevate` → `hostFs` filtered by `filterTreeForSession` → back to the
client, which runs the script → the same fire again with the writes → patches and trace.
**Class**: behavior change. **Delivery**: one PR against `main`.
**Required skills**: `tdd`, `testing`, `refactoring`; `mutation-testing` at PR readiness;
`e2e` for the close-out run.

### Shape (settled while planning)

- **Step 1 says it holds a script; step 2 carries the writes.** A new optional payload field
  `script_ready: true` (client param `scriptReady`), set when the bare third token read as a
  file on the box the tool runs from. A script hole then answers:
  - `writes` present → today's branch, unchanged: re-walk each at the tier, land, trace;
  - else `script_ready` → `{ ok, effect: 'script_exec', cve, severity, tier, tree }`, the tree
    `serializeTree(filterTreeForSession(hostFs, tier))`, with one trace line;
  - else → `needsArg`, no trace, unchanged.
  Every other effect ignores the field, so it still finishes in one request.
- **The client seam gains one arm**: `script_exec` with `tree: Directory`, deserialized in
  `interpretExploitResponse`; a tree that does not decode is `network_error`, as any malformed
  answer is.
- **The client runs the script only after the server answers with a tree**, against
  `targetScriptFs(tree, collected, tier)`, then fires again with `writes` and renders that
  second answer. `prepareBlindPayload` stops running anything: it reads the local half, the
  bare token's content and its `localError`. The network fire and `fireLocalThroughServer`
  share one two-step helper.
- **Gone from the client**: the target rebuild and the empty tree at `msfconsole.ts:1095–1108`
  (its `generateHomeLan` / `resolveLanHostIdentity` use), and the stale-read comment at `:186`.
- **The emailit spool is not in `hostFs`** (only the served-shell read lays it in), so a root
  script on emailit sees no mail, exactly as a root read hole there does today. Left as it is;
  noted in the as-built.

### Acceptance criteria

1. A script fired at a generated box on the network the shell stands on reads the box as it
   stands: a file a player rewrote reads rewritten, a file a player planted is there, a file a
   player removed is gone.
2. A script fired at a fellow occupant's workstation, a box behind a public forward, a
   deep-layer box, or the box itself over `localhost` reads that box (today: nothing).
3. A script reads at the granted tier: a `user` hole's script on an occupant's box reads the
   owner's `~/.wallet/wallet.dat` and cannot read `/root`.
4. `msfconsole --local` on a box that is not the player's own runs the script at the granted
   tier: a root hole (`systemctl` on `libsystemd 255.4.3`) fired from a guest shell reads
   `/root`. On the player's own workstation `--local` behaves as today.
5. **The original bug**: a player changes a generated box's root password (a reset hole, or a
   root rewriting root's hash in `/etc/passwd`); a script that adds a line to `/etc/passwd`
   leaves root's new hash in place, and the new password still works.
6. A script run leaves exactly two exploit lines in the service's log; a step 1 alone leaves
   one; a script hole fired with no script named leaves none and asks for one, as today.
7. Read, write, reset, backdoor and shell holes are answered in one request with unchanged
   output, whether or not a script file was named.
8. When step 2 answers differently (a bounce, or another effect), the player sees that answer
   rendered as any fire's, and no writes land.
9. What `msfconsole` prints after a script is unchanged: `[+] Script injected on <host> as
   <tier>`, or `[-] Script injection failed: <reason>` with whatever the script wrote before
   it stopped landed.
10. Step 2 carries only the writes; no script source crosses the wire.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The network fire hands a ready script the box.** `handleExploitCreateSession`'s script
   branch gains the `script_ready` arm. RED in `exploitCreateSession.test.ts`: a script hole
   fired with `script_ready` and no writes answers the tree at the granted tier, holding a
   journal row's content and no root-only file for a `user` tier, and writes one trace line;
   with neither field it still asks and writes none. Criteria 1–3 and 6 at the handler.
2. **`--local` does the same.** `handleExploitLocalElevate`'s script branch, the same arm,
   tested in `exploitLocalElevate.test.ts` with a root tier reading `/root` that the caller's
   guest shell could not. Criterion 4 at the handler.
3. **The adapter carries both ways.** `scriptReady` → `script_ready` in `exploitPayloadFields`;
   the tree arm in `interpretExploitResponse`, malformed → `network_error`.
   `sessionsApi.test.ts`.
4. **The network fire runs the script against the served tree.** RED in `msfconsole.test.ts`:
   the fake seam answers a tree holding a file the generator never made; the script copies it,
   and the second call carries that content as a write. Plus: the script's view is at the
   granted tier; a read hole named with a script file is one call; a bounce on step 2 is
   rendered as the bounce. `exploitEnv` takes a sequence of answers; the existing script tests
   move onto it, and "lets the script read the TARGET" reads the served tree instead of a
   regenerated one. The client rebuild goes. Criteria 1–3 and 7–10 at the command.
5. **`--local` through the server runs the script the same way.** The `msfconsole --local`
   tests, same shape. Criterion 4 at the command; the own-workstation tests stay green
   untouched.
6. **The wire-check.** A new `scripts/testScriptHolesReadTheBox.ts` against `vercel dev` +
   supabase, RED first against the server as it is on `main`:
   - the generated box carrying nginx's shipped script hole on the lab network (found as
     `testExploitOwnLan.ts` finds `scriptDoor`): seed a rewritten file and a planted one as
     journal rows; step 1 returns both in the tree and leaves one line; step 2 lands a
     read-modify-write of a file the tier can write, keeping the journal's version under the
     edit, and leaves the second line;
   - a fellow occupant whose born service is moved onto a script-hole release
     (`openssh-server 9.8.2`, `user`), with a wallet file in their home: the tree carries it and
     holds no `/root`;
   - `--local systemctl` on a box whose manifest is moved to `libsystemd 255.4.3`, from a guest
     session: the tree carries `/root`;
   - a fire with no script named leaves no line.
   `testExploitOwnLan.ts` (its single-request script section now proves "step 2 alone leaves
   one line"), `testCrossPlayerLocalExploit.ts`, `testScriptedExploitLeavesNoRow.ts` and
   `testHopExploit.ts` re-run.
7. **Docs and version 0.395.0.** `docs/vulnerability-architecture.md` (the `script_exec` bullet:
   two steps, the served tree, both lines, the modified-client trade), the handbook's exploit
   chapter if it describes the script's view, `docs/project-status.md`. This plan's content
   moves there at the close-out.

### Evidence

- Unit: both handlers (tree at the tier, journal content present, root-only files absent below
  root, one line per step, the asking fire silent, writes unchanged); the adapter (field out,
  arm in, malformed tree); the command (served tree read, writes from it on the second call,
  granted-tier view, one call for every other effect, step-2 bounce rendered, a failing script
  still sends what it wrote, `--local` on another box two-step, own workstation unchanged).
- Wire-check: `testScriptHolesReadTheBox.ts` as above, plus the four re-runs.
- Pre-PR: Stryker on the changed lines of `msfconsole.ts`, `exploitCreateSession.ts`,
  `exploitLocalElevate.ts` and `sessionsApi.ts` (json reporter, concurrency capped);
  `npm run typecheck`; `npm run lint`; the full test run.
- Close-out browser run after merge (`e2e` skill): change a generated box's root password
  (through a reset hole, or as root by rewriting its hash in `/etc/passwd` with `nano`); from
  another shell fire a script hole there whose script appends a
  line to `/etc/passwd`; `su root` with the new password still works, and the service log shows
  two lines. Then a script on a fellow occupant's box reading a file in their home.

### Carried risks

- **Two lines per script run is a visible change** for anyone reading a box's log; intended
  (decision 5).
- **The served tree can be up to ~100 KB per fire** (the served-boxes measurement: 20–102 KB
  raw, median 36): well inside the 4.5 MB response limit, and a script hole is a rare fire.
