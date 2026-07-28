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
5. **Local supabase must be up** (`npx supabase status`). If you need a clean world,
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
- **There is no `agent-browser text` command.** Read the terminal with:
  ```bash
  agent-browser eval "document.body.innerText.slice(-800)"
  ```
  Take the last N chars — the scrollback is long and the tail is what you need.

---

## 3. Recipe: fresh player → connected, with nmap

The single most common starting state. Every step below has a trap.

```
NEW GAME → fill Workstation / Username / Root password ×2 → START
```

Then, in the terminal:

| # | Command | Trap |
|---|---|---|
| 1 | `airmon start wlan0` | `airdump` fails without this |
| 2 | `airdump` | It is **`airdump`**, not `airodump` |
| 3 | `aircrack <BSSID>` | Use a **WPA2** row from the crackable pool (`SHINRA-5G`, `ACME-CORP`, `WEYLAND-NET`, …). WPA3 rows and the noise pool are not crackable. Prints `KEY FOUND! [ <pw> ]` |
| 4 | `airmon stop wlan0` | `nmcli` refuses while monitor mode is ON — the mirror of step 1 |
| 5 | `nmcli connect <ESSID> <password>` | Prints `assigned 192.168.<subnet>.<host>` — note the subnet, the gateway is `.1` |
| 6 | `su root` then the root password | `apt` needs root (dpkg lock error otherwise) |
| 7 | `apt install nmap` | `nmap` is NOT preinstalled |
| 8 | `nmap 192.168.<subnet>.1` | Now works |

Typing into the terminal:
```bash
agent-browser keyboard type "airmon start wlan0"; agent-browser press Enter
```

Allow generous sleeps — `aircrack` runs ~14 s of simulated key testing, `nmcli` and `nmap` pace
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

**A bricked gateway and a multi-occupant same-LAN encounter are now written up** — as full
journeys rather than recipes — in [`v2/docs/e2e-shared-network-verification.md`](../../../v2/docs/e2e-shared-network-verification.md),
which also carries the two-player mechanics, the ESSID-discovery constraint, and a known
client defect worth not misreading as a test failure. Read it before driving any
cross-player scenario. Still unwritten: a deep-chain pivot.
