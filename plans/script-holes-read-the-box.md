# Plan: script holes read the box as it stands

**Status**: Grilled. Decisions confirmed by the owner 2026-10-17. One slice, not yet planned.
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
