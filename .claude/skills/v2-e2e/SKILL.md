---
name: v2-e2e
description: Drive the jshack.me v2 game live in a real browser with agent-browser against `vercel dev` + local supabase. Use whenever a slice needs browser-only confirmation (terminal flows, the nano editor, keyboard/focus), when asked to "run the app", "smoke test", "E2E this", or take a screenshot of the game, and before writing any agent-browser command against this project. Holds the preflight, the exact in-game command sequences to reach a given state, the terminal/DOM quirks, and how to derive seeded secrets offline.
---

# v2 live E2E runbook

Everything here is verified against the running game. Follow the recipes rather than
rediscovering the in-game commands — several have ordering traps that fail with unhelpful
errors.

**Scope.** E2E is reserved for browser-only behaviour Vitest can't reach: terminal flows, the
nano editor, keyboard/focus, full UI journeys. Do NOT duplicate unit or wire-check coverage
here. If a claim can be proven by a `scripts/test*.ts` wire-check, prove it there instead — it
is faster and more precise.

---

## 1. Preflight (always, in this order)

1. **Kill the port squatter.** Killing a `npm run vercel:dev` background task does NOT kill its
   child vite process; it orphans on 3100, a fresh start silently falls back to vite-only on
   3101, and every `/api/*` call then 502s.
   ```powershell
   Get-NetTCPConnection -LocalPort 3100,3101 -State Listen -ErrorAction SilentlyContinue |
     ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
   ```
2. **Start the server** as a background task, from `v2/`, with **no inner `&`** (an inner `&`
   detaches it, the wrapper exits, and an old-code server may keep serving):
   `npm run vercel:dev`
3. **Confirm it is serving the API**, not just vite. An empty POST must return **400** (not
   502/000):
   ```bash
   curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3100/api/network \
     -H 'Content-Type: application/json' -d '{}'
   ```
4. **Confirm it is YOUR code.** The ASCII banner prints the version from `package.json`. Check it
   matches the version you just bumped — this is the cheapest guard against testing a stale
   orphaned server.
5. **Local supabase must be up** — `npx supabase status`, **run from `v2/`**. From the repo
   root it looks for a container named `supabase_db_jshack.me` and dies with
   `failed to inspect container health: No such container`, which reads like supabase is down
   when it is running fine one directory along. If you need a clean world,
   `npx supabase db reset` — local only, safe: there is no linked project ref and
   `SUPABASE_URL` is `127.0.0.1`.

**Never run Stryker while the dev server is up** — it reports false survivors and reloads the
app mid-run, resetting any `su` elevation.

---

## 2. Browser session

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
  the `localStorage.clear()` recipe in §5, which destroys the first player and cannot alternate.
- **`eval` reuses ONE execution context, so `const`/`let` leak across calls.** A second `eval`
  declaring the same name dies with `SyntaxError: Identifier 'x' has already been declared` —
  and if you redirected output, it looks like the command silently did nothing. Wrap every
  `eval` body in an IIFE: `(() => { … })()`.
- **Wait for the PROMPT, never for the output to "stop growing".** A running command shows a
  braille spinner (`⠋ apt...`) whose frames are all one character wide, so `innerText.length`
  holds perfectly still while the command is still working — a settle-detector built on length
  stability returns immediately, and the next `keyboard type` lands in a terminal that is not
  listening. Poll for a line ENDING in a prompt character instead, and require it to be quiet for
  a few consecutive samples:
  ```js
  (async () => { let quiet = 0, prev = '';
    for (let i = 0; i < 160; i++) { await new Promise(r => setTimeout(r, 250));
      const t = document.body.innerText.trimEnd();
      quiet = (t === prev && /[#$>]$/.test(t)) ? quiet + 1 : 0; prev = t;
      if (quiet >= 3) return 'prompt'; }
    return 'TIMEOUT'; })()
  ```
  `>` matters as well as `#`/`$`: inside `mysql`/`rediscli` the prompt is `redis> `, and a matcher
  that only knows shell prompts times out on every statement you send to a data door.
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

---

## 3. Recipe: fresh player → connected, with nmap

The single most common starting state. Every step below has a trap.

```
NEW GAME → fill Workstation / Username / Root password ×2 → START
```

**The form's four fields are `<input>`s too, and a `fill` right after clicking NEW GAME
silently no-ops.** Two traps in one: the refs from the start-screen snapshot are stale on the
form, and polling `document.querySelector('input') !== null` to decide "the terminal is ready"
returns true while you are still LOOKING AT the form. Snapshot after the click, fill, then
**read the values back** before pressing START — an empty form answers with `Enter a name for
your workstation` and nothing else moves. Wait for the shell by polling the text for the prompt
(`$`), not for an input:

```bash
agent-browser --session <name> eval "(()=>[...document.querySelectorAll('input')].map(e=>e.value).join('|'))()"
```

Then, in the terminal:

| # | Command | Trap |
|---|---|---|
| 1 | `airmon-ng start wlan0` | `airodump-ng` fails without this (`airodump-ng: monitor mode not enabled — run airmon-ng start wlan0 first`). **And it refuses while you are CONNECTED** (`airmon-ng: wlan0 is already connected to a network`) — the exact mirror of step 4, so to re-scan later you must `nmcli disconnect` FIRST. Check its output: piping this step to `/dev/null` and looping `airodump-ng` gives eight identical `monitor mode not enabled` errors that read like eight unlucky scans |
| 2 | `airodump-ng` | **The whole aircrack-ng suite carries the `-ng` suffix** — the real binary names. `airmon`, `airodump`, `aircrack` bare all die `bash: <name>: command not found`, which reads exactly like an uninstalled tool (they are preinstalled). It is `airodump-ng`, never `airodump` or `airdump` |
| 3 | `aircrack-ng <BSSID>` | Use a **WPA2** row from the crackable pool (`SHINRA-5G`, `ACME-CORP`, `WEYLAND-NET`, `TYRELL-CORP`, …). WPA3 rows and the noise pool are not crackable. Prints `KEY FOUND! [ <pw> ]` |
| 4 | `airmon-ng stop wlan0` | `nmcli` refuses while monitor mode is ON (`nmcli: wlan0 is in monitor mode — run 'airmon-ng stop wlan0' first`) — the mirror of step 1 |
| 5 | `nmcli connect <ESSID> <password>` | Prints `assigned 192.168.<subnet>.<host>` — note the subnet, the gateway is `.1` |
| 6 | `su root` then the root password | `apt` needs root (dpkg lock error otherwise) |
| 7 | `apt install nmap` | `nmap` is NOT preinstalled |
| 8 | `nmap 192.168.<subnet>.1` | Now works |

Typing into the terminal:
```bash
agent-browser keyboard type "airmon-ng start wlan0"; agent-browser press Enter
```

Allow generous sleeps — `aircrack-ng` runs ~14 s of simulated key testing, `nmcli` and `nmap` pace
their output deliberately.

---

## 4. Recipe: shell on the AP gateway

The gateway is the `.1` of the connected LAN. Its credentials seed from the **ESSID**, so derive
them offline (§6) rather than cracking in-game:

```
ssh root@192.168.<subnet>.1     →  password = seedApGatewayAdminPw(<ESSID>)
```

The prompt becomes `root@ap-gw:/root#`. Verify the **server-served** tree actually arrived —
an empty foreign tree means the hop resolved but the fetch didn't:

- `cat /etc/iptables/rules.v4` → the seeded NAT table with its comment header
- `cat /etc/passwd` → root-only, exactly one line, no guest account

The gateway is nobody's own box, so it always routes through the cross-player path. Its
hostname in scans and log traces is `seedApGatewayHostname(<ESSID>)`; note the shell prompt
shows the machine-id name part (`ap-gw`) instead, which is a known cosmetic mismatch.

**The same mismatch happens on NPC routers and switches, so do not read it as a lost session.**
An inner gateway scanned as `switch-core` answers its shell prompt as `root@inner-gw`; the scan
shows the generated hostname while the prompt shows the machine-id name part, which is keyed by
DEVICE ROLE rather than by that hostname. Confirmed 2026-08-26 on `192.168.216.48`. Identify the
box you landed on by the IP you typed, never by the prompt.

---

## 5. Recipe: two identities (cross-player loop)

Player A does the setup (§3, then `sshd`, then §4 and `nano rules.v4` to publish a forward).
Then mint player B:

```bash
agent-browser eval "localStorage.clear()"
agent-browser open http://localhost:3100        # → NEW GAME mints a fresh identity
```

A's state PERSISTS server-side (registry + journal keyed by A's owner key), so B attacks A's
public IP. **Confirm B's identity differs from A's** before trusting the result.

**After a reload, `agent-browser press Enter` is silently lost** — characters accumulate with no
submit. Dispatch a native keydown instead:
```js
i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
```

---

## 6. Deriving seeded secrets and querying the DB

The game does not surface another player's secrets, and gateway credentials seed from the ESSID.
Compute them with a **temp file inside `v2/`** — `./src/...` imports only resolve from there, and
a `/tmp` path will not work:

```bash
cat > ./g.tmp.ts << 'EOF'
import { seedApGatewayAdminPw, seedApGatewayHostname } from './src/core/generation/routerFs';
import { computeApGatewayId } from './src/core/identity/router';
console.log('adminpw=' + seedApGatewayAdminPw('SHINRA-5G'));
EOF
npx tsx ./g.tmp.ts; rm -f ./g.tmp.ts
```

**`npx tsx -e "..."` produces no output here** — always use a file. Same for DB queries, which
additionally need the env:

```bash
npx dotenv -e .env.development.local -- npx tsx ./q.tmp.ts
```

For a plain table read, skip the temp file — query the container directly. **`supabase db psql
-c` does not exist** (CLI 2.95: `unknown shorthand flag: 'c'`); go through docker:

```bash
docker exec supabase_db_jshack-me-v2 psql -U postgres -tAc "select * from home_network_occupants"
```

Useful lookups: `workstationGuestPassword(ownerKey)`, `assignHomeNetwork(ownerKey, essid)` →
`{ localIp, hostname }` (no `publicIp` — public IPs are server-allocated), and the
`network_public_ips` table for an ESSID's actual public IP. Cross-check any derived `localIp`
against the live `ifconfig`. Delete the temp file when done.

---

## 7. Terminal and editor DOM quirks

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
  Enter in §5:
  ```js
  (() => { const ta = document.querySelector('textarea'); ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true })); })()
  ```
  `^O` writes **without** exiting (correct nano behaviour), and its "wrote N lines" status is
  transient — so absence of a status line is not evidence the save failed. Confirm against the
  journal instead: `docker exec supabase_db_jshack-me-v2 psql -U postgres -tAc "select content from patches where path = '…'"`.
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
  ```bash
  for attempt in 1 2 3 4; do
    agent-browser click "textarea"; agent-browser press Control+x; sleep 3
    back=$(agent-browser eval "(() => document.querySelector('input') !== null && document.querySelector('textarea') === null)()" | tail -1)
    if [ "$back" = "true" ]; then sleep 2
      again=$(agent-browser eval "(() => document.querySelector('input') !== null && document.querySelector('textarea') === null)()" | tail -1)
      [ "$again" = "true" ] && break
    fi
  done
  ```
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
  Focus, type, **verify `input.value`, then** press Enter — one command per step:
  ```bash
  agent-browser eval "(() => { const i = document.querySelector('input'); i.focus(); i.value=''; })()"
  agent-browser keyboard type "$cmd"
  agent-browser eval "(() => document.querySelector('input').value)()"   # must equal $cmd
  agent-browser press Enter
  ```
- **The terminal `<input>` can silently lose focus** when a second headed session is open, and
  then `keyboard type` goes nowhere: no error, no characters, and the `until` loop you wrapped it
  in spins until it times out. Focus explicitly before typing in a two-player run —
  `eval "(() => document.querySelector('input').focus())()"` — and verify with
  `eval "(() => document.querySelector('input').value)()"` before pressing Enter.
- Read all terminal output through `document.body.innerText` — it is plain text.

---

## 8. Teardown

```bash
agent-browser close --all
```
then re-run the §1 port kill. Verify 3100/3101 are clear; a survivor will silently serve stale
code to the next session.

---

## 9. Extending this skill

Add a recipe whenever you reach a state that cost you more than one wrong attempt. Keep the
shape: **target state → numbered commands → the trap in each**. Traps are the value; a bare
command list will be re-derived correctly anyway, but an ordering trap costs a full cycle every
time.

**A bricked gateway, a multi-occupant same-LAN encounter, the web surface, the path sweep and
the text browser are now written up** — as full journeys rather than recipes — in
[`v2/docs/e2e-shared-network-verification.md`](../../../v2/docs/e2e-shared-network-verification.md),
which also carries the two-player mechanics, the ESSID-discovery constraint, and a known
client defect worth not misreading as a test failure. Read it before driving any
cross-player scenario. Still unwritten: a deep-chain pivot.

**Publishing a site to browse (Act 9's setup)**: `apt install lynx` and `apt install nginx` —
neither is preinstalled — then `nginx` to listen, and **`rm /var/www/html/index.html` before
writing your own**, because installing nginx leaves a default page there and a half-generated
site makes the link count meaningless.
