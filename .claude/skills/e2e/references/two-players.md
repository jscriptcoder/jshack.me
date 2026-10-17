# Two players

**Read [`docs/e2e-shared-network-verification.md`](../../../../docs/e2e-shared-network-verification.md)
before driving any cross-player scenario.** It writes up a bricked gateway, a multi-occupant
same-LAN encounter, the web surface, the path sweep and the text browser as full journeys, and
carries the two-player mechanics, the ESSID-discovery constraint, and a known client defect worth
not misreading as a test failure.

## Second identity (cross-player loop)

Player A does the setup ([reaching-a-state.md](reaching-a-state.md), then `sshd`, then [reaching-a-state.md](reaching-a-state.md#shell-on-the-ap-gateway) and `nano rules.v4` to publish a forward).
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

### A player whose box was BORN with the service you need

Verified 2026-10-08 (v0.330.1). Since v0.330.0 a workstation's first boot leaves it running 1–3
services drawn from its identity (`sshd`, `vsftpd`, a web server, `mysqld`, `redis-server`; since
v0.333.0 the web server is `nginx` or `apache2`, 50/50), so B can
sweep A's box with no setup on A beyond joining WiFi. The run: A on `LINKSYS-8939`, B re-scanned
until it showed (34 scans), `nmap -sV <A>` listed A's three born services, `hydra <A> ssh` found
`guest`, `ssh guest@<A>` landed on `guest@alicebox`.

| Trap | What actually works |
|---|---|
| A was born without the service the scenario needs | Read A's boot screen: one `[  OK  ] Started …` line per running service (`OpenBSD Secure Shell server` is sshd). Re-mint A (`localStorage.clear()` + reload + NEW GAME) until it shows, about 2 in 5 for sshd — or `su` and start it, which is not the born case |
| `agent-browser fill "input >> nth=0" …` on the NEW GAME form | Fills nothing, and START answers `Enter a name for your workstation`. Set all four inputs in one `eval` through the native setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)` then an `input` event), and read the values back before START |
| `ssh: connect to host … Network error` partway through a long run | The `npm run vercel:dev` background task hit the harness's default 30-minute limit and was killed. Start it with the maximum background `timeout` (7200000) for any two-player run; a restart reloads every open page, which reboots both players and drops what was typed |
| Catching the boot screen's lines | They are gone once the terminal takes over. Poll `get text body` every second for `Reached target Multi-User` and grep `Started` in the same call |

### Two players on one network, without waiting for the injector

Verified 2026-10-12 (v0.366.0): A and B met on BUY-N-LARGE after 7 and 5 scans, no luck
involved. A scan's base draw is `generateWifi({ seedPubkeyHex, scanIndex })`, fixed per player
and per scan, and the first `airodump-ng` is scan 1. Mint both players, read each key
(`JSON.parse(localStorage.getItem('jshack.identity')).publicKeyHex`), and compute offline the
network both will be shown soonest:

```ts
import { generateWifi } from './src/core/generation/generateWifi.js';
const firstSeen = (key: string) => {
  const seen = new Map<string, { index: number; password: string }>();
  for (let scanIndex = 1; scanIndex <= 60; scanIndex++)
    for (const network of generateWifi({ seedPubkeyHex: key, scanIndex }))
      if (network.crackable && !seen.has(network.essid))
        seen.set(network.essid, { index: scanIndex, password: network.password ?? '' });
  return seen;
};
// keep the ESSIDs both maps hold, sort by alice.index + bob.index, take the first
```

| Trap | What actually works |
|---|---|
| `nmcli connect <ESSID>` → `network "<ESSID>" not found` after scanning past it | `nmcli` reads the LATEST scan only. Each player runs `airodump-ng` exactly the number of times the script gave, then connects |
| An ESSID like `r0/t0/n72` in the output | That is a drawn network's key, not its name ([reaching-a-state.md](reaching-a-state.md), "a box on a deep layer"). Take a row whose ESSID reads as a name, or map it with `essidOf(key)` |
| The owner's `cat /var/log/access.log` is EMPTY after a visitor's requests | A command on your own box asks the server nothing, so lines another player caused show only after the owner's next action that writes (a `curl localhost` did it). Check the row first: `select content from patches where machine_id = '<name>-<id>' and path = '/var/log/access.log'` |
| A guest's `ls /etc` on a player's box prints nothing, and ftp `get` answers `550` | The tree a guest is served is pruned to its tier. `/var/log/*` is what a guest can read and `get` there |
| The prompt wait ([driving-the-terminal.md](driving-the-terminal.md)) returns `prompt` and the tail shows no output | A command that answers in under a second can land AFTER the wait saw the old prompt quiet. Sleep 3 s and read the tail again before calling it empty |

### Two terminals of ONE player (`xterm`)

Verified 2026-10-07 (v0.324.0) checking that a WiFi change in one tab reaches the other.

1. In the player's session, type `xterm`. It opens a second tab in the SAME agent-browser session
   (same `localStorage`, same identity) — do not mint a second `--session`, which is a second player.
2. `agent-browser --session alice tab list` shows `t1` and `t2`; switch with `tab t1` / `tab t2`
   before every type or read. The new tab is the active one right after `xterm`.
3. Read each tab's WiFi state off the HUD rather than running a command:
   `(() => { const t = document.body.innerText; return t.slice(t.lastIndexOf("WLAN0")) })()`
   gives `WLAN0 DOWN ESSID —` or `WLAN0 <ip> ESSID <name>`.

| Trap | What actually works |
|---|---|
| `nmcli connect <ESSID>` in the new tab → `network "<ESSID>" not found` | Each tab keeps its OWN scan list in memory; the scan in tab 1 is not tab 2's. Connect from the tab that ran `airodump-ng`, or scan in tab 2 first (which re-rolls, so the network may not show) |
| A long `eval` that waits for the prompt dies with `os error 10060` | The command still ran; the CLI call timed out. Read the tail with a separate `eval` |
| A background helper running several tab switches in one call | Switches can race and the commands land in the wrong tab. One tab switch, one command, one read per step |
