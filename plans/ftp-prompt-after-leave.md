# An `ftp>` prompt learns its session closed — grill record + plan

**Status:** Active — grilled 2026-10-18, no slice started.

Goal: the item recorded in `docs/backlog.md` as "An `ftp>` prompt across the network after its
owner leaves. Not checked." Found 2026-10-14 while closing the leaver's own sessions (v0.381.0).

Facts established before the grill, by reading:

- **The server already closes the row.** Leaving a network closes every open row through the box
  whatever its kind: other players' rows on it (`endVisitorSessions`) and the leaver's rows on every
  other machine (`endOwnSessionsAway`), with every chain above them (`api/network.ts`). A reboot, a
  firmware flash and a lost upstream hop close an `ftp` row the same way. Nothing on the server is
  missing.
- **The prompt never asks.** A shell asks `env.chain.openSessionIds()` before every line
  (`lostLegs` in `core/shell/runLine.ts`) and drops what the server closed. A line typed at `ftp>`
  goes to `runFtpLine` (`ui/state.ts` `executeLine`) and never reaches that check.
- **The prompt answers from a tree it already holds.** The target's tree is fetched once when the
  session is entered and again only after a `put` (`refreshFtpTree`). So once the row is closed,
  `ls`, `cd`, `pwd` and `get` keep answering as if nothing happened — `get` copies a file onto the
  player's box and prints `226 Transfer complete.` — while `put` answers
  `553 Could not create file: …: Permission denied`, which reads as a tier problem. The prompt
  stays until `quit`.
- **`listSessions` already answers the question.** `openServerSessionIds` returns the id of every
  open row the player holds, `ftp` rows included (the boot sweep relies on it to close abandoned
  ones), so no `api/` change is needed.

## Decisions

1. **`421` and back to the shell.** When the prompt finds its session closed, it prints
   `421 Service not available, remote server has closed connection.` and the terminal returns to
   the shell prompt, as a shell drops a closed hop. Nothing the player typed runs. Rejected: staying
   at a dead `ftp>` that answers `Not connected.` until `quit` (real BSD ftp, but a disconnected
   state the sub-shell does not have); reusing the shell's
   `Connection to <host> closed by remote host.` (ftp speaks in numbered replies).
2. **Every non-empty line asks first.** Any line but a bare Enter — `lls`, `lcd`, `lpwd`, `help`
   and `quit` included — asks whether the session is still open before it runs, one request a line,
   the cost a shell on another box already pays. One rule, as the shell's. Rejected: asking only on
   the remote commands, which is closer to real ftp but a carve-out that leaves the dead prompt
   usable for local commands.

Defaults taken without a question, following the shell's own rules:

- **An unanswered check runs the line.** When the server cannot be asked (`openSessionIds` answers
  `null`), the line runs as it does today: the row is the authority, and this is only how the player
  is told — the same posture as `lostLegs`.
- **One closed thing per line.** If the shell under the prompt lost its own hop too (the player's
  box left, taking both), the `421` drops the prompt and the shell's next line reports its own
  `Connection to <host> closed by remote host.` Nothing new reaches across the two.
- **Every way the row closes is covered.** The check reads the row, not the cause, so the leaver's
  own prompt, a visitor's prompt on the box that left, a target that rebooted or was flashed, and
  a prompt whose upstream hop was lost all get the same `421`.

Consequences: a player at `ftp>` is told on their next line that the session is gone, rather than
browsing a saved copy of a box they no longer reach or reading a closed session as a permission
refusal. No new server state, no `api/` change.

## Plan — one slice

**Slice 1 — the prompt asks before each line (v0.405.0).**

- RED (`src/core/commands/ftp.test.ts`, where `runFtpLine` is already tested): with the session's
  id absent from `env.chain.openSessionIds()`, a non-empty line prints exactly the `421` line, exits
  1, calls `env.ftp.leave()`, and does not run the command (a `put` does not call `env.ftp.write`, a
  `get` does not call `env.patches.write`). With the id present, or with `openSessionIds` answering
  `null`, the line runs as today. A bare Enter asks nothing.
- GREEN: `runFtpLine` asks before dispatch. The prompt needs the held session's id: add one
  read-only field to `FtpApi` (`sessionId`), set from `ftpSession()` in `ftpBinding`, rather than a
  new seam — `env.chain.openSessionIds()` already exists. `env.ftp.leave()` does the drop; its
  fire-and-forget end on an already-ended row changes nothing on the server.
- Docs: `docs/backlog.md` item marked RESOLVED with the version; the handbook's sessions chapter
  names the `ftp>` prompt beside the shell in the "asks before each line" rule.
- Wire-check: `N/A` — no `api/` change; `listSessions` is the endpoint `lostLegs` already uses,
  proven live by `scripts/testLeaverSessionsClose.ts` and the v0.381.0 browser run.
- Browser close-out: two terminals on one player. In terminal 1, `ftp` to a generated box; in
  terminal 2, `nmcli disconnect`; in terminal 1, `ls` prints the `421` and the shell prompt returns.
  Then a second player at `ftp>` on the first player's box when the first player leaves.
