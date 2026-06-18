# Cross-player live E2E playbook (agent-browser vs `vercel dev`)

How to drive the v2 two-player cross-player loop live against `npm run vercel:dev` (:3100) with
`agent-browser`. This recurs for every Story-5+ slice that needs a "decision-8" full-loop confirm
(the browser-only behaviour unit/integration tests can't reach — see the architecture doc's read/scan/
login sections in [`cross-player-architecture.md`](./cross-player-architecture.md)). These are the
mechanics that cost iterations the first time; reuse them.

## Why this is fiddly

The loop needs TWO distinct players, a terminal that renders **outside** queryable DOM text, and a
key-event quirk after page reload — none obvious, all repeatable.

## Mechanics

- **Start fresh, own the process.** Kill any stale server on :3100 first
  (`Get-NetTCPConnection -LocalPort 3100` → `Stop-Process`), then start `npm run vercel:dev` as a
  background task with **no inner `&`** — an inner `&` detaches it and the wrapper exits, orphaning a
  server that may keep serving OLD code. Confirm your code is the code under test.
- **Two identities = clear localStorage + reload.** Player A does the setup (crack WiFi →
  `nmcli connect` → `su root` → `sshd` → `ssh root@<subnet>.1` → `nano rules.v4` add the forward), then
  `localStorage.clear()` + `agent-browser open` → **NEW GAME** mints a fresh identity (player B). A's
  state PERSISTS server-side (registry + journal keyed by A's owner_key), so B attacks A's public IP.
  Confirm B's `identity` ≠ A's.
- **Compute A's secrets offline.** B needs A's public IP + the workstation guest password, which the
  game doesn't surface. Drop a temp `*.tmp.ts` **inside `v2/`** (so `./src/...` imports resolve — a
  `/tmp` path won't) and `npx tsx` it: `assignHomeNetwork(ownerKey, essid)` → `{ localIp, publicIp }`,
  `workstationGuestPassword(ownerKey)`, `seedRouterAdminPw(ownerKey)`. Cross-check `localIp` against the
  live `ifconfig`. Delete the temp file.
- **Terminal input.** The shell command line is a single `<input>` that auto-focuses on mount and
  re-grabs focus on any plain click in the terminal (a click _while text is selected_ is left alone,
  so output stays copyable). So typing usually Just Works without a manual focus; only re-`focus()` it
  if a prior step (devtools, an alert, a foreign element) stole focus. Read output via
  `document.body.innerText` (the terminal is plain text).
- **Enter doesn't submit after a reload.** `agent-browser keyboard type` lands characters, but
  `agent-browser press Enter` is lost post-reload (chars accumulate with no submit). Submit by
  dispatching a native keydown on the input via `eval`:
  `i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))`.
- **nano** is a `<textarea>` that auto-focuses when the editor opens — just type, then read `.value`
  to verify the buffer (the rendered body is canvas/non-text, so `innerText` shows only the chrome).
  Save = `press Control+o` → `press Enter` → `press Control+x`.
- **Cross-player file reads are tier-gated.** As `guest`, A's `/etc/` etc. list EMPTY (root-readable
  content is hidden from the guest tier) — that is NOT a bug. `su root` (A's workstation root password)
  reveals `/etc/passwd` and the rest.

## Worked example (the 5.1.3b/5.1.3c confirm)

A: crack `ABSTERGO-NET` → `nmcli connect` (`192.168.7.102`) → `su root` → `sshd` (`:22` up) →
`ssh root@192.168.7.1` → `nano /etc/iptables/rules.v4` add `forward 2222 to 192.168.7.102:22`. Then
clear localStorage, become B (different subnet `192.168.43.x`): `nmap <A.publicIp>` shows `:22` **and**
`:2222` (5.1.3b) → `ssh guest@<A.publicIp> -p 2222` lands on `guest@<A's ws>` (5.1.3c) → `su root` →
reads A's `/etc/passwd`. The forward auth succeeding live-verifies the (locally untypechecked) `api/`
registry select.
