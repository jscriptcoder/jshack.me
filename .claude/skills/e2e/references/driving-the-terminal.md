# Driving the terminal

## Browser session

```bash
agent-browser close --all                              # REQUIRED before --headed
agent-browser open http://localhost:3100 --headed      # window visible to the user
agent-browser snapshot -i                              # interactive refs (@e1, @e2 …)
```

- **`--headed` is silently ignored if a daemon is already running.** You get a headless browser
  and no error. Always `close --all` first when the user wants to watch.
- **`open` often never returns.** It blocks until the harness backgrounds it, but the page IS
  loaded. Do not wait on it or retry — confirm and move on:
  ```bash
  agent-browser --session <name> eval "location.href"
  ```
- **`close --all` may need running twice.** Those backgrounded `open` commands hold handles, so
  the first close can report success while `session list` still shows sessions. Re-run until
  `session list` says `No active sessions`.
- **Snapshot refs go stale after any DOM change.** `@e2` on the start screen is a different
  element from `@e2` on the form. Re-run `snapshot -i` after every click before using a ref, or
  `fill` fails with `Unknown ref: e3`.
- **Two players = two sessions.** `--session alice` / `--session bob` give isolated
  `localStorage`, so both identities stay alive and you switch with the flag. Prefer this over
  the `localStorage.clear()` recipe in [two-players.md](two-players.md), which destroys the first player and cannot alternate.
- **`close --all` is GLOBAL, whatever `--session` you put in front of it — and it destroys the
  identity.** `agent-browser --session bob close --all` closed the default session too, and the
  reopened page came up on NEW GAME: the owner key lives in that profile's `localStorage`, so an
  identity closed this way is unreachable even though its data is still server-side. Mid-run, close
  ONE session (`--session bob close`) and never `--all`. Name every player explicitly
  (`--session alice`) rather than leaving one on `default`, so no session is the one you forget you
  are holding. D10 slice 5's close-out lost a fully set-up player — WiFi cracked, connected, gpg
  installed — to this at the last beat.
- **`eval` reuses ONE execution context, so `const`/`let` leak across calls.** A second `eval`
  declaring the same name dies with `SyntaxError: Identifier 'x' has already been declared` —
  and if you redirected output, it looks like the command silently did nothing. Wrap every
  `eval` body in an IIFE: `(() => { … })()`.
- **Wait for the PROMPT, never for the output to "stop growing".** A running command shows a
  braille spinner (`⠋ apt...`) whose frames are all one character wide, so `innerText.length`
  holds perfectly still while the command is still working — a settle-detector built on length
  stability returns immediately, and the next `keyboard type` lands in a terminal that is not
  listening. Poll for the prompt line instead, and require it to be quiet for a few consecutive
  samples. Two things on screen defeat a naive version (2026-10-08, v0.334.0): the top bar's
  CLOCK ticks every second, so the page text never holds still and a whole-text comparison times
  out on an idle prompt; and the page ends with the status bar (`WLAN0 … V 0.334.0`), not the
  prompt, so testing the LAST character never matches. Strip clock times, cut at the status bar,
  and read the prompt as the line just above the bar's hostname line. That poller is
  [`scripts/wait-for-prompt.js`](../scripts/wait-for-prompt.js); pass it as
  `agent-browser --session <name> eval "$(cat .claude/skills/e2e/scripts/wait-for-prompt.js)"`
  (a file, because a bash heredoc eats its `\d` escapes). `:` is there for `Password:`. A wait that TIMES OUT is not the CLI hanging: an `eval` that
  runs past ~30 s comes back as `os error 10060`, which reads like a dead browser.
  `>` matters as well as `#`/`$`: inside `mysql`/`rediscli` the prompt is `redis> `, and a matcher
  that only knows shell prompts times out on every statement you send to a data door.
- **The terminal `<input>` is GONE while a command runs, so wait for it before typing.** A write
  on a remote box (`echo x > file` in a shell on a deep box) holds the spinner for a few seconds,
  and a helper that types the next command at once dies with `Cannot read properties of null`
  and drops that command. Poll `document.querySelector('input') !== null` before every type, and
  again before reading the output (2026-10-10, v0.352.0).
- **Each CLI call costs ~1-2 s, so anything short is over before you can look at it.** A
  transient state (a spinner, a busy bar, a streamed command under ~2 s) will be gone by the
  time a follow-up `eval`/`screenshot` lands, which reads exactly like a broken feature. Drive
  AND observe inside a single async IIFE that polls, e.g. dispatch the command, then
  `for (…) { await new Promise(r => setTimeout(r, 100)); samples.push(…) }` and return the
  samples. To photograph a transient state, widen it first — queue the same command several
  times in one synchronous block (they serialize on `commandChain`) and then screenshot.
- **But an interval of ZERO length cannot be sampled at any rate — stop polling and change the
  scenario.** A busy label that flips `nmap`->`node`->`nmap` between two back-to-back inner commands
  never renders the middle state: both signal writes land in the same tick and Solid renders once,
  so the series reads `nmap... -> nmap... -> PROMPT` and looks exactly like a broken release. A 50ms
  poller finds no more than a 100ms one, because the state has no duration. The fix is to give the
  scenario a real gap: a script awaiting
  `new Promise((resolve) => setTimeout(resolve, 1200))` between the two calls turned the same probe
  into `nmap... -> node... -> nmap... -> PROMPT`. Before chasing a transient with a faster loop, ask
  whether it has any duration at all — and note a script CAN reach `setTimeout`, because only
  `console` is shadowed in the sandbox.
- **`keyboard type` fires NO `keydown` events, so it cannot type into `lynx`.** It works at the
  terminal prompt, which is a real `<input>`, but `lynx` reads every key from `keydown` on its
  screen — and a listener counted zero events across a `keyboard type "iv"`. The field stays `[_]`
  and the Enter that follows sends an EMPTY search (`?q=`), which reads exactly like a broken form.
  Type into a lynx field one `press` per character: `for c in u n i; do agent-browser press $c; done`.
  A real keyboard fires `keydown` for every key, so this is the tool, never the game.
- **There is no `agent-browser text` command.** Read the terminal with:
  ```bash
  agent-browser eval "document.body.innerText.slice(-800)"
  ```
  Take the last N chars — the scrollback is long and the tail is what you need.
- **`innerText` COLLAPSES blank lines, so never verify a line COUNT against it.** A command that
  emits blank spacer lines renders them as nothing, and the page shows fewer lines than the
  command produced. 2026-09-01: a script reported its captured `nmap` output as 10 lines against a
  prompt-typed control that *looked* like 7 — which reads as an off-by-three defect and is not.
  `nmap` emits three blank spacers, and the DOM ate them for the typed command too. **Count what a
  command EMITS, not what the page renders**: get the value itself out of the game
  (`console.log(JSON.stringify(out))` from a script, or assert on the array in a unit test) rather
  than counting `\n` in `innerText`. Had I trusted the rendered count I would have recorded a false
  "verified" — or chased a bug that was not there.

## Terminal and editor DOM quirks

- The command line is a single `<input>` that auto-focuses on mount and re-grabs focus on any
  plain click in the terminal. A click *while text is selected* is left alone so output stays
  copyable. Typing usually Just Works; only re-`focus()` if devtools or an alert stole it.
- **nano** is a `<textarea>` that auto-focuses when the editor opens. Type directly; read
  `.value` to verify the buffer, because the rendered body is canvas-like and `innerText` shows
  only the chrome. Save with `Control+o`, exit with `Control+x`.
- **NEVER issue the next `keyboard type` until the editor is GONE.** `^X` is not instant, and
  while the textarea still holds focus your next shell command is typed *into the buffer* and
  saved with it. This is silent and it corrupts data: a `cat /etc/iptables/rules.v4` typed one
  beat early landed inside a NAT rule as
  `forward 80 to 192.168.210.120:80cat /etc/iptables/rules.v4`, which fails the `$`-anchored
  parser, so the forward was dead while the file still *looked* almost right. Poll, never sleep:
  ```bash
  until agent-browser eval "(() => document.querySelector('textarea') === null)()" | grep -q true; do sleep 2; done
  ```
  Read the file back through the game afterwards — a trailing line with no newline runs into the
  next prompt on screen, so the corruption reads as a rendering artifact if you only glance.
- **`press Control+o` / `Control+x` can stop registering** after a run of other key presses
  (`Control+End` then many `Backspace`s did it). The editor just sits there with no status line,
  which looks like a hung save. Dispatch the chord natively instead — same workaround as the lost
  Enter in [two-players.md](two-players.md):
  ```js
  (() => { const ta = document.querySelector('textarea'); ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true })); })()
  ```
  `^O` writes **without** exiting (correct nano behaviour), and its "wrote N lines" status is
  transient — so absence of a status line is not evidence the save failed. Confirm against the
  journal instead: `docker exec supabase_db_jshack-me psql -U postgres -tAc "select content from patches where path = '…'"`.
- **A real `click` beats the native-dispatch workaround, and beats `eval`-based focus.** Once any
  `agent-browser eval` has touched focus, `press Control+o` / `Control+x` stop reaching the editor
  even though `document.activeElement` still reports the textarea — and a synthetic
  `KeyboardEvent` dispatched on it does nothing either. `agent-browser click "textarea"`
  immediately before each chord fixes it every time. Click, then `^O`; click again, then `^X`.
- **Never poll for the editor's ABSENCE — poll for the TERMINAL's return.** Checking
  `document.querySelector('textarea') === null` is unreliable *even twice in a row*: it reported
  a close that had not happened on two consecutive checks, and the next `keyboard type` went into
  the buffer — `...the main page</a>.</p>cat /var/www/html/notes.html`, one `^O` away from being
  saved. An absence can be produced by a transient re-render; a presence cannot. Wait on the
  positive signal, then reconfirm it:
  ```bash
  agent-browser eval "(() => document.querySelector('input') !== null && document.querySelector('textarea') === null)()"
  ```
  **The reconfirm is the part that works — a lone `true` is noise.** 2026-09-01: that exact probe
  returned `true` on its FIRST check and then `false` **twenty-four times running**; the editor had
  never closed. Sleep a beat after a `true`, ask again, and only believe two in a row. In the same
  run `^X` needed **two attempts on three of four files** even with a real `click` immediately
  before the chord, so wrap it in a retry loop rather than treating one press as done:
  [`scripts/close-nano.sh <session>`](../scripts/close-nano.sh) does exactly that and exits
  non-zero if the editor never closed.
  Read the buffer back after any command that was supposed to run in the SHELL — if it is in
  there, the editor never closed. Recovering a corrupted buffer without retyping it:
  ```js
  (() => { const ta = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, CLEAN);
    ta.dispatchEvent(new Event('input', { bubbles: true })); })()
  ```
  Pass that snippet from a `.js` file — `agent-browser eval "$(cat fix.js)"` — so bash quoting
  never has to survive both `'` and `"` in one argument.
- **`[ Wrote N lines ]` is gone within a second.** Check for it in the SAME step as `^O`; a check
  one `sleep 1` later already returns nothing and reads as a failed save. Absence of the status is
  not evidence of failure — confirm by `cat`-ing the file back through the game.
- **Git Bash rewrites anything that looks like an absolute unix path.** Typing
  `<a href="/notes.html">` into nano arrives as `href="C:/Program Files/Git/notes.html"`. Silent,
  and only visible when you read the buffer back. Export `MSYS_NO_PATHCONV=1` and
  `MSYS2_ARG_CONV_EXCL='*'` around any step that types a path into the game.
- **Every second command in a batched run is silently dropped.** After Enter the terminal input is
  re-created and re-grabs focus asynchronously, so an immediately following `keyboard type` types
  into nothing: no error, and the transcript shows a bare prompt where your command should be.
  Focus, type, **verify `input.value`, then** press Enter — one command per step.
  [`scripts/type-command.sh <session> "<cmd>"`](../scripts/type-command.sh) does all four (and
  waits for the input to exist, and sets the Git Bash path-conversion guards above); it refuses
  to press Enter if the field does not hold exactly `<cmd>`.
- **The terminal `<input>` can silently lose focus** when a second headed session is open, and
  then `keyboard type` goes nowhere: no error, no characters, and the `until` loop you wrapped it
  in spins until it times out. Focus explicitly before typing in a two-player run —
  `eval "(() => document.querySelector('input').focus())()"` — and verify with
  `eval "(() => document.querySelector('input').value)()"` before pressing Enter.
- Read all terminal output through `document.body.innerText` — it is plain text.
