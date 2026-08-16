# E2E verification: shared-network reconciliation

A live-browser runbook that exercises everything epic item #5 shipped (PRs #326–#334,
v0.88.0 → v0.96.0) as a real player would, in a real browser, against `vercel dev` +
local supabase.

**Last executed in full: 2026-07-28 against v0.96.0.** All six acts passed. Supporting
gates on that tree: 1958 unit tests / 122 files, and 26 wire-check scripts /
179 checks. Two runbook errors found and corrected in place (the `nmap` CIDR form, and
the assumption that any L1 NPC is sshable), plus one real client defect recorded in §6.

**Act 9 added 2026-08-14 against v0.129.0** — D1b's browser, proven from the log's side: three
pages viewed left three lines, which is what makes "going back re-fetches" an observable
decision rather than an implementation note. It found a **fourth nano trap that supersedes the
third**: polling for the editor's ABSENCE is unreliable even doubled, so poll for the terminal
input's presence instead. See §5.

**Act 4 re-run 2026-07-28 against v0.99.0, all four checks passed** — a NAT forward now
reaches whichever occupant LEASES the address it names, so every occupant is
forward-reachable and the "publish for the later joiner" workaround is gone. That run also
found a **client defect: a stale shared-file buffer silently deleted another occupant's
rules** — ~~fixed at v0.101.0/v0.102.0~~, see §6. Acts 1–3, 5 and 6 were not re-run on that
tree.

**Load [`.claude/skills/v2-e2e/SKILL.md`](../../.claude/skills/v2-e2e/SKILL.md) before
running any `agent-browser` command.** It owns the preflight, the DOM quirks, and the
base recipes. This document is the item-#5 test plan layered on top of it, and adds the
two-player mechanics the skill does not yet cover.

---

## 1. What this proves, and what already proves itself

Item #5's claims are already covered at two layers. **Do not re-prove them in the
browser** — the browser run exists to show the whole loop is *playable* and that the
pieces compose through the real UI.

| Layer | Command | Covers |
|---|---|---|
| Unit | `npm test -- --run` | 1958 tests: generators, resolvers, handlers, permission walks |
| Wire | 27 `scripts/test*.ts` | every `api/` path against real supabase |
| **Browser** | **this document** | **the playable loop: discovery → crack → join → see each other → attack** |

Run the first two first. If either is red, stop — a browser failure on top of a red
suite tells you nothing.

```bash
cd v2
npm test -- --run
for s in $(ls scripts/test*.ts | sed 's|scripts/||;s|\.ts$||'); do
  npx dotenv -e .env.development.local -- npx tsx scripts/$s.ts | tail -1
done
```

Expected: the unit suite fully green, and one line per script each reading
`N/N checks passed` — any `0/N` or a missing line is a red gate, whatever the totals are
on the tree you are on.

### The claims this browser run owns

These are the item-#5 acceptance criteria that only a real two-player journey shows:

1. Two identities on one ESSID land on **one shared AP gateway** — same box, same
   `rules.v4`, same admin password.
2. They land on **one LAN**, at **different addresses**, and **see each other** in
   `nmap`.
3. They see the **same NPC hosts** at the same addresses, and a file one writes to an
   NPC is **visible to the other**.
4. A NAT forward published by one occupant is **reachable from outside** and lands on
   the publisher's box.
5. Bricking the gateway takes the **public IP dark** while the **ESSID stays joinable**
   and occupants still reach each other.
6. A reconnecting occupant **returns to the same address**.
7. `nmcli disconnect` makes a box **unreachable** — and only that.

---

## 2. Preflight

Follow the skill's §1 in full, then two additions specific to this run:

**Confirm the version banner matches `v2/package.json`.** Anything lower is a stale
orphaned server serving older code, and every claim below would be meaningless.

**Start from a clean world.** The shared-AP assertions are about *who is on a network*,
and a leftover occupant from an earlier session will make a two-player scan read as
three:

```bash
cd v2 && npx supabase db reset      # local only — safe, no linked project ref
```

This also re-applies `20260727000000_drop_network_registry.sql`. Confirm the table is
actually gone before trusting anything else:

```bash
# expect: relation "network_registry" does not exist
# `supabase db psql -c` does NOT exist (CLI 2.95: "unknown shorthand flag: 'c'").
# Go through the container instead — this is the reliable way to query local supabase.
docker exec supabase_db_jshack-me-v2 psql -U postgres -c 'select 1 from network_registry limit 1' 2>&1 | head -2
```

---

## 3. Two players in one browser

The skill's §5 recipe (`localStorage.clear()` + reload) mints a fresh identity but
**destroys the previous one**, so you can never switch back. Every journey below needs
A and B alternating. Two options, in order of preference.

### Option A — two isolated agent-browser sessions (preferred)

`--session <name>` gives each player its own browser context and therefore its own
`localStorage`. Both stay alive; you switch by changing the flag.

```bash
agent-browser close --all
agent-browser --session alice open http://localhost:3100 --headed
agent-browser --session bob   open http://localhost:3100 --headed
```

Every later command carries its player: `agent-browser --session bob keyboard type "..."`.

### Option B — snapshot and restore the identity

One browser, swapping identities. Two keys matter:

| Key | Holds |
|---|---|
| `jshack.identity` | the Ed25519 keypair — **this is the player** |
| `jshack:connected-essid` | the remembered connection, restored on reload |

```bash
# stash A, mint B
agent-browser eval "localStorage.setItem('stash.alice', localStorage.getItem('jshack.identity'))"
agent-browser eval "localStorage.removeItem('jshack.identity'); localStorage.removeItem('jshack:connected-essid')"
agent-browser open http://localhost:3100     # NEW GAME → fresh identity

# later: back to A
agent-browser eval "localStorage.setItem('jshack.identity', localStorage.getItem('stash.alice'))"
agent-browser open http://localhost:3100
```

**Always confirm who you are before trusting a result** — running an assertion as the
wrong player is the single easiest way to get a false pass:

```bash
agent-browser eval "JSON.parse(localStorage.getItem('jshack.identity')).publicKeyHex.slice(0,8)"
```

Or in-game: `identity`.

---

## 4. The discovery constraint — read this before writing any journey

**`nmcli connect` only accepts an ESSID that is in *that player's own* scan list.** It
resolves against `env.network.wifiNetworks()` and errors `network "X" not found`
otherwise. You cannot simply type a chosen ESSID into both players.

How the scan is built (`core/generation/generateWifi.ts`):

- Seed is `wifi-<playerPubkey>-<scanIndex>`. **Deterministic per player per scan**, and
  `airdump` increments `scanIndex`, so **re-running `airdump` re-rolls the list**. A
  page reload does not.
- Base draw: **2–3** crackable ESSIDs from the 50-entry `crackableEssidPool`.
- Then the **occupied-ESSID injector**: ESSIDs *other players are currently on*, a
  random subset of size `0..min(n, 3)`.

So the two-player encounter works exactly as designed: **A joins first, which makes A's
ESSID "occupied"; B then re-runs `airdump` until the injector surfaces it.** With one
occupied network that is a coin flip per scan — expect to run `airdump` a handful of
times. That is not a bug, it *is* the discovery mechanic, and it is worth watching work.

**The crack is skippable.** `passwordForEssid(essid)` is ESSID-seeded and the password
compare is the only gate — `nmcli connect` does not check that you ran `aircrack`. For
journeys where the crack is not the thing under test, derive the password offline (§7)
and skip `airmon`/`airdump`/`aircrack` entirely, saving ~14 s of simulated cracking per
player. **Do run the real crack at least once** (Act 1) so the arc itself is covered.

---

## 5. The journeys

Each act states its target, the commands, the observable that proves it, and the trap.
Terminal input is always:

```bash
agent-browser --session <player> keyboard type "<command>"
agent-browser --session <player> press Enter
```

and output is read with:

```bash
agent-browser --session <player> eval "document.body.innerText.slice(-1200)"
```

Allow generous waits: `aircrack` ~14 s, `nmcli`/`nmap` pace their output deliberately.

**`agent-browser press Enter` is unreliable here** — on a freshly opened session it is
silently dropped and characters just accumulate in the input (you will see
`airmon start wlan0airdump...` sitting there unsubmitted). Clear the field and submit
with a native keydown instead. Keep this as a helper and use it for every command:

```bash
# run.sh <session> <command> [waitSeconds]
timeout 60 agent-browser --session "$1" eval "(()=>{const i=document.querySelector('input'); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i,''); i.dispatchEvent(new Event('input',{bubbles:true})); i.focus(); return 'cleared';})()" >/dev/null
timeout 60 agent-browser --session "$1" keyboard type "$2" >/dev/null; sleep 1
timeout 60 agent-browser --session "$1" eval "(()=>{document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true})); return 'ok';})()" >/dev/null
sleep "${3:-4}"
```

It works for masked password prompts too. **`nmap` takes a range, not CIDR** —
`nmap 192.168.36.1-254`; a `/24` prints a usage error.

---

### Act 1 — A: fresh player to connected (the full arc, cracked for real)

`NEW GAME` → Workstation `skylab`, Username `neo`, Root password (twice) → `START`.

| # | Command | Trap |
|---|---|---|
| 1 | `airmon start wlan0` | `airdump` fails without it |
| 2 | `airdump` | It is `airdump`, not `airodump`. **Note a WPA2 crackable row — this ESSID is X for the rest of the run** |
| 3 | `aircrack <BSSID of X>` | WPA2 crackable rows only. Prints `KEY FOUND! [ <pw> ]` — **record it** |
| 4 | `airmon stop wlan0` | `nmcli` refuses while monitor mode is on |
| 5 | `nmcli connect X <pw>` | Prints `Connected to X — assigned 192.168.<subnet>.<host>` — **record the subnet and A's host octet** |
| 6 | `su root` + root password | `apt` needs root |
| 7 | `apt install nmap` | `nmap` is not preinstalled |
| 8 | `sshd` | Root only. Opens port 22 on A's own box — needed for Act 4 |

**Proves:** the arc still works end to end after the reconciliation.
**Record:** X, its password, A's subnet, A's octet, A's pubkey prefix.

---

### Act 2 — B joins the same AP, and they see each other

Mint B (§3). Run B's arc, but this time hunt for X:

1. `airmon start wlan0`
2. `airdump` — **repeat until X appears in B's list.** Each run re-rolls. If ~8 runs
   produce nothing, confirm A is still an occupant (`nmcli status` as A) before
   suspecting the injector.
3. `airmon stop wlan0`
4. `nmcli connect X <pw from Act 1>` — the password is the network's, not A's, so the
   value recorded in Act 1 is correct for B.

**The assertions:**

| Check | Command (as B) | Expect |
|---|---|---|
| Same LAN, different address | `ifconfig` | same `192.168.<subnet>.` prefix as A, **different** host octet |
| Not the gateway, not an NPC | — | B's octet is neither `.1` nor any NPC address from the scan below |
| They see each other | `nmap 192.168.<subnet>.1-254` | A's workstation appears as a host |
| Same world | compare with A's `nmap` | **identical NPC hosts at identical addresses** |

Then switch to A and run the same `nmap`. B must appear in A's scan too — the
occupant merge is symmetric.

**Proves:** shared LAN, collision-free leases, mutual visibility, shared NPC population.
**Trap:** run `nmap` as *both* players before concluding — a one-sided check passes even
if the merge is broken in one direction.

---

### Act 3 — one shared gateway, one shared world

The AP gateway is the `.1` of the LAN, and its credentials seed from the **ESSID**, so
both players reach the *same box* with the *same* password. Derive it offline (§7).

As **A**:

```
ssh root@192.168.<subnet>.1        → password = seedApGatewayAdminPw(X)
cat /etc/iptables/rules.v4         → the seeded NAT table with its comment header
cat /etc/passwd                    → root-only, exactly one line, no guest
nano /etc/iptables/rules.v4        → add a forward to A's LAN address, Ctrl+O, Ctrl+X
exit
```

As **B**: `ssh root@192.168.<subnet>.1` with the **same password**, then
`cat /etc/iptables/rules.v4`.

**Expect: B sees A's edit.** One gateway, one journal, one world.

Then the shared-NPC half. **Do not assume any L1 NPC machine is sshable** — each host
rolls its services independently (`hostServices`), and an ESSID where all of them roll
none is normal, not a fault. On `APERTURE-WIFI` all four machines came up with no
services and `ssh` correctly answered `Connection refused`.

The reliable shared non-player box is the **inner gateway / switch** (the non-`.1`
router and switch rows in the scan — e.g. `.217 wan-rtr`, `.218 dist-rtr`). Their
credentials derive offline exactly like the AP gateway's, via
`seedInnerGatewayAdminPw(essid, octet)` (§7).

As A, `ssh root@192.168.<subnet>.217`, `touch /tmp/alice-was-here`; as B, `ssh` the same
address and `ls /tmp`. **Expect A's file** — but read the staleness warning below first.

> **Wait a few seconds after any `ssh` hop before trusting a read.** The client renders
> the *un-replayed* base tree for a moment after landing on a shared generated box, so an
> immediate `ls` can come back empty and look like a broken merge when the journal is
> fine. Re-run the read after ~10 s before recording a failure. This is a real client
> defect, not a test artifact — see §6.

**Proves:** one AP gateway per ESSID, shared journal, shared NPC filesystems.
**Trap:** the prompt reads `root@ap-gw` rather than the scan hostname — a known cosmetic
mismatch, not a failure. Verify the *tree arrived* (`rules.v4` has its header); an empty
foreign tree means the hop resolved but the fetch did not.

---

### Act 4 — the outside view: public scan and a live forward

Mint a **third** identity C that never joins X — the outsider. Get X's public IP:

```bash
# in v2/, see §7 for the temp-file pattern
npx dotenv -e .env.development.local -- npx tsx ./q.tmp.ts   # select public_ip from network_public_ips where essid = X
```

As **C**: `apt install nmap` (after `su root`), then `nmap <public IP of X>`.

| Check | Expect |
|---|---|
| The AP answers | host up, port `22` open (the gateway's own sshd) |
| Same gateway regardless of who asks | identical result whether A, B or C scans it |
| A's forward is live | the forwarded port appears, because A ran `sshd` in Act 1 |
| Reaching the forward lands on A | `ssh guest@<public IP> -p <forwarded port>` → a session on **A's** workstation |

**Proves:** the public face of a shared AP, and the NAT forward loop.

**Fixed at v0.99.0 — the check to run now.** The 2026-07-28 run found that with A (first
joiner) and B (second) both running `sshd` and both forwards published on the same
gateway, the outsider's `nmap` showed `22` and **B's port only**; A's forward never
appeared, and `ssh -p <B's port>` landed on B. A forward resolved to whichever occupant
joined the ESSID most recently, so everyone else's was dead.

A forward now resolves through `network_lan_leases` to whoever holds the address it
names. Publish one for **each** of A and B — both edit the SAME `rules.v4` on the shared
gateway, one line each — and expect:

| Check | Expect | v0.99.0 |
|---|---|---|
| Both forwards visible | C's `nmap <public IP>` lists `22`, A's port AND B's port | ✅ `22, 2222, 3333` |
| Each lands on its own box | `ssh guest@<public IP> -p <A's port>` → A's workstation; `-p <B's port>` → B's | ✅ `guest@skylab` / `guest@logos` |
| Credentials don't cross | A's guest password on B's port → `Permission denied` | ✅ |
| Leaving closes only your own door | A `nmcli disconnect` → A's port vanishes from C's scan, B's still answers | ✅ `22, 3333`; `-p 2222` → `Connection refused` |

A's port coming back when A rejoins is the same check from the other side, and A returns
to the **same address** (the permanent lease) — worth doing in the same pass, it is free.

Wire-checked by `scripts/testSharedApForwards.ts` (8/8), which covers the same four
claims at the API layer. What the browser adds is the **`nano` co-edit** — and that is
where the run found §6's defect, so do not skip it.

---

### Act 5 — brick the gateway: WAN dark, LAN alive

The sharpest behavioural claim of the whole item. As **A**, on the gateway:

```
ssh root@192.168.<subnet>.1
rm /boot/vmlinuz
exit
```

| Check | As | Expect |
|---|---|---|
| Public IP goes dark | C | `nmap <public IP>` → host **down**, no ports |
| Permanently | C | still dark after a reload — the tombstone is journal-backed |
| ESSID still visible | any new identity | X still appears in `airdump`, still crackable, still joinable |
| Occupants still reach each other | A ↔ B | `nmap` of the LAN still lists both; `ssh` between them still works |
| The gateway itself is dead | A | `ssh root@192.168.<subnet>.1` refused — a bricked box refuses ssh from inside its own LAN too |

**Proves:** WAN/LAN gate split — bricking the AP's public face does not destroy the
network for the people on it.
**Trap:** this is destructive and permanent for X. Run it **last**, or `npx supabase db
reset` afterwards.

---

### Act 6 — leases are permanent, occupancy is not

Two claims that look similar and are opposites.

**The lease survives a disconnect** (as B):

```
nmcli disconnect
nmcli connect X <pw>
```

**Expect the same address B held before.** The lease outlives occupancy precisely so a
reconnecting player returns to where it was.

**Occupancy does not** — this is the 6a rule, and the most important single check in
this document:

1. As **A**: `nmcli disconnect`.
2. As **B**: `nmap 192.168.<subnet>.1-254` → **A is gone**.
3. As **B**: `ssh guest@<A's old address>` → **fails**. A's machine is not on a network.
4. As **A**: `nmcli connect X <pw>` → same address back; B can see and reach A again.

**Proves:** being on a WiFi is what makes a machine reachable — not whether a player is
playing, and not anything that outlives the disconnect.
**Trap:** B's *session* on A (if one is open from Act 2) is not what is being tested. The
credential stays valid; what disappears is A's machine. If a stale session masks the
result, open a fresh one.

---

### Act 7 — the web surface, end to end (D1)

**Executed in full 2026-07-31 against v0.108.0. All checks passed.** This is the D1
browser confirmation, kept here because it is the same two-player machinery as the acts
above with a different door. It covers both halves of the access log, which is the part
no wire-check can show as a *journey*.

#### Own-LAN half (one identity)

`airmon start wlan0` → `airdump` → `aircrack <BSSID>` → `airmon stop wlan0` → `nmcli
connect` → `su root` → `apt install nginx` → `nginx` → `curl http://<own IP>` → `nano
/var/www/html/index.html` → `curl` again → `cat /var/log/access.log`.

| Check | Result |
|---|---|
| The edit is live | `curl` returns the edited page — same tree, not a regenerated one |
| The self-fetch is logged, readable at once | two lines, no break-in needed |
| The size TRACKS the edit | `200 212` then `200 80` — the server read the real tree each time, and 80 is exactly the edited page's length |
| A generated host's page is real recon | versions, `/metrics`, a leaked `<!-- TODO: remove debug endpoints -->` |
| The port is honoured | `curl http://<host>` on a host serving `:8080` is REFUSED; `:8080` returns the page. A refusal here is correct, not a bug |
| A fetched NPC host keeps the record | `ssh root@<host>` (creds recovered offline, §7) → its `access.log` holds all four of your fetches |
| The traversal is verbatim | `"GET /../../etc/passwd HTTP/1.1" 404 0` — as typed, not as resolved |
| `curl -i` works | status line + `Server: nginx` + `Content-Length`, no `Date:` (deliberate) |

#### Cross-player half (two identities, two networks)

A on `ROBOVAC-AP`, B on `ABSTERGO-NET` — **different networks**, which is the point.
A: `nginx` → `nano` a page → `ssh root@<subnet>.1` (gateway pw offline, §7) → `nano
/etc/iptables/rules.v4` → append `forward 80 to <A's LAN IP>:80`. Get A's public IP from
`network_public_ips`. Then B: `curl http://<A's public IP>`.

| Check | Result |
|---|---|
| B reads A's page with **no session and no credential** | ✅ A's page, from another network |
| B's probes are refused, not leaked | `/admin/config.php` and `/../../etc/passwd` both bare 404 |
| An unforwarded public IP and an unknown one are INDISTINGUISHABLE | both `Connection refused` — the collapsed `host_unreachable` doing its job |
| A's log names B by **public** IP | `203.4.16.180`, ABSTERGO-NET's WAN address — B never sent it, the server derived it |
| One row, one writer key | the row is keyed to **A's owner key**, not B's; B's identity lives only in the source-IP field, where B cannot rewrite it |
| Own-LAN and cross-player lines interleave in ONE file | A's own `192.168.210.120` lines sit beside B's `203.4.16.180` lines — the same file wherever you read it |

**Two traps this run found, both now in the skill's §7:** a shell command typed one beat
before `nano` closed was saved INTO the NAT rule (dead forward, file still looked right),
and `press Control+o/x` stopped registering mid-session.

**One behaviour worth not misreading as a bug.** A's terminal showed only her OWN line
until she ran something else. B's fetches were already persisted correctly — nothing
pushes to A's client, because the `patches-changed` channel is workstation-scoped and
BroadcastChannel is same-browser only. A defender gets no live tail. That is the accepted
staleness in `conventions-and-gotchas.md` §"deferred backlog", where the decision against
Supabase Realtime and the cheaper pull-shaped alternative are both recorded.

---

### Act 8 — the path sweep, and the log that reads it back (D1c)

**Executed in full 2026-08-13 against v0.124.0. All checks passed.** One identity, own LAN.
This act exists because the world has no unlinked content to find — every generated box stops
at `/var/www/html/index.html` — so the *player* generates the content and sweeps for it. That
substitution is deliberate and is what stands in for a content epic as evidence.

`airmon start wlan0` → `airdump` → `aircrack` → `airmon stop wlan0` → `nmcli connect` → `su
root` → `apt install gobuster` → `mkdir /var/www/html/private` + `mkdir /var/www/html/hidden` →
`nano` a page into each → `apt install nginx` → `nginx` → `gobuster http://localhost` → `nano
/usr/share/wordlists/dirlist.txt` → sweep again → `cat /var/log/access.log`.

Two directories, not one, and the choice matters: `private` **is** in the shipped list and
`hidden` is **not**, so a single run shows both sides of the gate at once.

| Check | Result |
|---|---|
| A hand-made page is found | `/private/ (Status: 200) [Size: 84]` — exactly the bytes typed into `nano`, so it read the live tree |
| The list is the sole gate | `/hidden/` sits in the document root and is NOT reported — `2/40 paths found` |
| A player widens the list and the world grows | append `hidden` with `nano` → `3/41 paths found`, `/hidden/ (Status: 200) [Size: 82]` |
| The sweep is logged **whole**, misses included | 41 lines for a 40-word list: 39 × `404 0`, 2 × `200` |
| One sweep is ONE moment | all 41 lines share `[13/Aug/2026:08:15:28 +0000]`; the second sweep's 43 lines share `08:17:19`. Two blocks, two stamps |
| One sweep is ONE write | `select count(*) … machine_id like 'sweepbox-%'` → **1** row holding both blocks, 84 lines |
| The retry the player never sees IS logged | `"GET /private HTTP/1.1" 404 0` immediately followed by `"GET /private/ HTTP/1.1" 200 84`. The tool printed only the second; the defender gets both |
| A loopback sweep is loopback in the log | source `127.0.0.1` on every line of an own-box sweep |
| A neighbour's tree is the NEIGHBOUR's | `gobuster http://192.168.45.223` → `/index.html [Size: 340]` where the sweeper's own is `212`. A same-size answer would mean the LAN lookup silently fell back to self |
| The neighbour's log names the sweeper by LAN IP | 41 lines on `workstation-223`, source `192.168.45.114` — the sweeper never sent that address, the server derived it |
| A host not serving http refuses | `nmap` shows `desktop-192` with no open ports; only `workstation-223` (22, 80) answers a sweep |

**The plan's own journey was wrong, and this run is why it is worth executing one.** The
written recipe used `mkdir /var/www/html/hidden` — and `hidden` is not in `DEFAULT_DIRLIST`,
so followed literally it finds nothing and reads as a broken tool. The fix is either a listed
directory or the `nano` step; the run above does both deliberately.

**One realism compromise, visible here.** The bare `"GET /private HTTP/1.1"` logs `404 0`
where real Apache answers `301`. Accepted for this slice and recorded in the plan; it is the
first thing to revisit if redirect statuses ever land.

**A third nano trap, now in the skill's §7.** After any `agent-browser eval` touches focus,
`press Control+o` / `Control+x` stop reaching the editor — `document.activeElement` still
reports the textarea, so it looks like a hung save. A real `agent-browser click "textarea"`
before the chord fixes it. This cost a corrupted buffer: two `cat` commands typed one beat
early landed *inside* the page, because a poll caught a transient re-render and reported the
editor closed when it was not. Poll for absence **twice**, and read the buffer back before
saving.

---

### Act 9 — the browser, and the log that counts what it read (D1b)

**Executed 2026-08-14 against v0.129.0. All checks passed.** Single player; no second
identity needed, because the whole of D1b is observable from one box reading its own site.

**Target**: `lynx` renders a page as text, follows a numbered link, goes back, and quits —
and the box that served it can say exactly how many pages were read.

| # | Command | Trap |
|---|---|---|
| 1 | Act 1's arc → connected (`ACME-CORP`, `192.168.45.77`) | — |
| 2 | `su root` → `apt install lynx` | **`lynx` is not preinstalled**, exactly like `nmap` |
| 3 | `apt install nginx` → `nginx` | Root-tier. Prints `Server listening on 0.0.0.0 port 80.` |
| 4 | `rm /var/www/html/index.html` | `apt install nginx` leaves a **default page** there. Remove it, or the site under test is half generated and the link count is not yours |
| 5 | `nano /var/www/html/index.html` → a page linking `/notes.html` | §7's nano traps, plus a new one below |
| 6 | `nano /var/www/html/notes.html` → a page linking back | — |
| 7 | `lynx http://localhost/` | — |
| 8 | `Enter`, then `ArrowLeft`, then `ArrowLeft`/`Backspace` again, then `q` | — |
| 9 | `cat /var/log/access.log` | The count is the assertion. See below |

**What the browser showed**, read with
`eval "document.querySelector('main').innerText"` — the overlay is plain text, so the whole
screen including the footer comes back in one read:

```
http://localhost/                                  ← on open
Nebuchadnezzar
Ship systems nominal.
Read the [1]operator notes.
↑↓ Select  ⏎ Follow  q Quit                        ← no Back: nowhere to go back to yet

http://localhost/notes.html                        ← after Enter
Operator Notes
Broadcast depth 09. Hovercraft grounded.
Return to [1]the main page.
↑↓ Select  ⏎ Follow  ← Back  q Quit                ← Back appears with the first history entry

http://localhost/                                  ← after ArrowLeft
Read the [1]operator notes.                        ← selection restored to the link left by
↑↓ Select  ⏎ Follow  q Quit                        ← Back gone again: the trail is spent
```

Markup never renders (`<h1>` is a line, not a tag), the link is numbered and carries
`aria-current="true"`, and a second `ArrowLeft` plus a `Backspace` at the first page did
**nothing** — the overlay stayed open rather than quitting. `q` returned the terminal with
its scrollback intact.

**The log is the real assertion**, because it is the only place the design decision is
visible from the other side:

```
127.0.0.1 - - [14/Aug/2026:07:52:39 +0000] "GET / HTTP/1.1" 200 108
127.0.0.1 - - [14/Aug/2026:07:52:49 +0000] "GET /notes.html HTTP/1.1" 200 127
127.0.0.1 - - [14/Aug/2026:07:53:00 +0000] "GET / HTTP/1.1" 200 108
```

**Three lines for three pages viewed — and the third is what proves going back re-fetches.**
A cached back would have left two. The two no-op back presses at the first page would have
made it five if they had fetched, and they did not. Sizes match the two files (108 / 127) and
the repeat of `/` reports 108 again, so the count is not a rendering artifact.

**Cross-network, same act**: `lynx http://203.0.113.7` (an address nobody forwards) reports

```
lynx: (7) Failed to connect to 203.0.113.7 port 80: Connection refused
```

**in the terminal, without opening the browser** — the collapsed refusal, named with its
program, through the real signed `resolveHttpFetch` round-trip rather than a stub. That is
D1b slice 7's client branch proven live; the endpoint behind it is `curl`'s and predates it.

**A fourth nano trap, worse than the third, now in the skill's §7.** The double-poll for the
editor's absence that §5's Act 7 note prescribes **is not enough** — it reported "closed"
twice while the editor was still open, and the next shell command was typed into the buffer
and would have been saved with it:

```
...<a href="/index.html">the main page</a>.</p>cat /var/www/html/notes.html
```

**Poll for the terminal input's PRESENCE instead** —
`document.querySelector('input') !== null && document.querySelector('textarea') === null`.
A positive signal cannot be produced by a transient re-render, where an absence can. Read the
buffer back after any command that was supposed to run in the shell, and recover with the
native-setter recipe rather than retyping.

**And a Git Bash trap that has nothing to do with the game**: MSYS rewrites any argument that
looks like an absolute unix path, so `keyboard type '<a href="/notes.html">'` arrives in the
editor as `href="C:/Program Files/Git/notes.html"`. Silent, and only visible when you read the
buffer back. Export `MSYS_NO_PATHCONV=1` and `MSYS2_ARG_CONV_EXCL='*'` for any step that types
a path into the game.

**`[ Wrote N lines ]` is transient and easy to miss** — checking for it one second after `^O`
already returns nothing, which reads as a failed save. Check immediately, and treat its absence
as unknown rather than as failure: confirm by `cat`-ing the file back through the game.

---

### Act 10 — the sweep that crosses a network (D1d)

**Executed 2026-08-14 against v0.130.0. All checks passed.** One identity, taken OUT of its own
network and back in through the front door: A publishes a forward on the shared gateway and then
sweeps their own **public** IP, which is the cross-network path in full — client branch, signed
round-trip, server-side list read, and the target's log.

The unit tests stub the seam and the wire-check posts straight at the endpoint, so **this is the
only thing that proves the client actually calls it** — a wrong field name in the adapter would
otherwise ship green.

**No nano this time.** The shell has `>` redirection, which writes a page in one line and skips
every editor trap in §7:

| # | Command | Trap |
|---|---|---|
| 1 | Act 1's arc → connected (`APERTURE-WIFI`, `192.168.36.211`) | — |
| 2 | `su root` → `apt install nginx` → `apt install gobuster` | **Wait for the `su` spinner.** A command typed while it runs lands in a dead input and is silently dropped |
| 3 | `rm /var/www/html/index.html`; `mkdir /var/www/html/staging` | Remove the default page or the site under test is half generated |
| 4 | `echo public front page > /var/www/html/index.html` | `>` works; `>>` does not exist |
| 5 | `echo staging area, do not link > /var/www/html/staging/index.html` | `staging` is already in `DEFAULT_DIRLIST`, so no list editing is needed |
| 6 | `nginx` | Root-tier |
| 7 | `ssh root@192.168.36.1` + `seedApGatewayAdminPw(<ESSID>)` (§6) | — |
| 8 | `echo forward 8080 to 192.168.36.211:80 > /etc/iptables/rules.v4` | Overwrites the seeded comment header — fine here, and far cheaper than nano |
| 9 | `exit` → `gobuster http://<public IP>:8080` | A public IP's **default** port reaches the gateway; the forwarded port is what reaches the box |

**What the attacker saw:**

```
Gobuster dir mode
[+] Url:       http://103.40.167.153:8080
[+] Wordlist:  /usr/share/wordlists/dirlist.txt
[+] Words:     40
/index.html          (Status: 200) [Size: 17]
/staging/            (Status: 200) [Size: 25]
Finished. 2/40 paths found.
```

`[+] Words: 40` is the load-bearing line: **the client never sent a word.** It named the machine
it was standing on and the server read that box's `dirlist.txt` off the journal, so the count and
every result came back from the far side. `/staging/` carries the trailing slash a real server
redirects to — the directory retry, decided server-side — and the sizes are the two files.

**What the defender's record held** (42 lines, read from the journal):

```
103.40.167.153 - - [14/Aug/2026:12:13:49 +0000] "GET /index.html HTTP/1.1" 200 17
103.40.167.153 - - [14/Aug/2026:12:13:49 +0000] "GET /admin HTTP/1.1" 404 0
… 38 more …
103.40.167.153 - - [14/Aug/2026:12:13:49 +0000] "GET /staging HTTP/1.1" 404 0
103.40.167.153 - - [14/Aug/2026:12:13:49 +0000] "GET /staging/ HTTP/1.1" 200 25
```

**42 lines for 40 words, under exactly ONE timestamp.** The two extra are the directory retry,
and the single stamp is the design claim: the box handled one request, so the wall reads as one
act rather than as forty. The source is the server-derived public IP, never anything the client
sent.

Cross-network refusal, same act: `gobuster http://203.0.113.7` (nobody forwards it) →
`gobuster: (7) Failed to connect to 203.0.113.7 port 80: Connection refused` — collapsed cause,
named with its program.

**The known log staleness, hit again — read `conventions-and-gotchas.md` §9 before calling it a
bug.** After a server-side append the client shows the log as **empty** until something else syncs
its journal: `cat /var/log/access.log` printed nothing while the row already held 3201 characters,
and a later own-LAN sweep (which writes locally) brought the whole file in at once. **Proven still
pre-existing by control**: a `curl` of the same forward — the shipped D1 path — was likewise
invisible until the next sync.

This is **not a new finding**. §9 decided it 2026-07-31 (no Supabase Realtime; the staleness is
accepted) and already records that it is worse for logs than for co-edits — every cross-player
trace, 100% of the time, across `kern.log`, `auth.log` and `access.log`. D1d adds a fourth writer
and nothing else. The approved fix, if it is ever taken, is a **pull** — refetch before reading
those three paths — not a push. Read the row from the DB when a log looks empty:

```bash
docker exec supabase_db_jshack-me-v2 psql -U postgres -tAc \
  "select content from patches where path='/var/log/access.log' and machine_id='<box>'"
```

**And check the machine id before believing an old log.** A previous session's `skylab-52dfb80b`
answered the first query with July lines and no error; the live box was `skylab-cca288f6`. Resolve
it from `home_network_occupants` for the ESSID rather than by hostname.

### Act 11 — the second door, opened from another network (D3)

**Executed 2026-08-15 against v0.136.0. All checks passed.** Two real players, two networks: A
publishes their ftp daemon through a forward on their AP, and B — who has never been on A's WiFi —
scans the address, cracks the credential, walks in, moves files in both directions, and leaves A
holding the whole story in one file.

The unit tests stub the seam and the wire-check posts straight at the endpoints, so **this is the
only thing that proves the client sends what the server reads**: a wrong field name in
`sessionsApi`/`patchApi` would otherwise ship green.

**As A** (`anton`, `SUITE-401` → `192.168.94.155`, public `45.7.194.128`):

| # | Command | Trap |
|---|---|---|
| 1 | Act 1's arc → connected (real `aircrack`, `KEY FOUND! [ thunder24 ]`) | — |
| 2 | `su root` → `vsftpd` | **Wait for the `su` spinner.** `vsftpd` is root-tier and opens :21 |
| 3 | `ssh root@192.168.94.1` + `seedApGatewayAdminPw('SUITE-401')` = `dovetail_7` | — |
| 4 | `echo forward 2121 to 192.168.94.155:21 > /etc/iptables/rules.v4` → `exit` | Not 21 on the outside: on a public address :21 is nothing and :22 is the GATEWAY |

**As B** (`cracklab`, `WEYLAND-NET` → public `138.2.25.151`) — a different AP entirely, which is
what makes the address in A's log falsifiable:

```
root@cracklab:/root# nmap 45.7.194.128
PORT     STATE SERVICE
22/tcp   open  ssh
2121/tcp open  ftp

root@cracklab:/root# hydra 45.7.194.128 ftp -p 2121
[2121][ftp] host: 45.7.194.128   login: guest   password: toor
1 valid password(s) found

root@cracklab:/root# ftp -p 2121 45.7.194.128 guest
Password:
Connected to 45.7.194.128.
220 (vsFTPd 3.0.3)
230 Login successful.
ftp> put /usr/share/wordlists/passwords.txt /tmp/dropped.txt
226 Transfer complete.
285 bytes sent.
ftp> get /tmp/dropped.txt /tmp/stolen.txt
226 Transfer complete.
285 bytes received.
```

**The tier crosses unchanged, and it bites first.** `get /home/gilfoyle/roadmap.txt` — a file A
wrote as root — answers `550 Failed to open file.` for B's `guest` credential, and so does
`/etc/passwd`. `ls` shows both; reading them is the walker's call, made against A's real tree. B
gets what `guest` may have and nothing else, exactly as on the LAN.

**What A's `/var/log/vsftpd.log` held** (85 lines, one row, A's own writer key):

```
… 84 FAIL LOGIN lines: [root] ×36, [gilfoyle] ×36, [guest] ×12 …
Sat Aug 15 16:40:16 2026 [pid 5984] [guest] OK LOGIN: Client "138.2.25.151"
Sat Aug 15 16:40:49 2026 [pid 2668] CONNECT: Client "138.2.25.151"
Sat Aug 15 16:40:49 2026 [pid 2668] [guest] OK LOGIN: Client "138.2.25.151"
Sat Aug 15 16:41:45 2026 [pid 4814] [guest] OK UPLOAD: Client "138.2.25.151", "/tmp/dropped.txt", 285 bytes
Sat Aug 15 16:42:51 2026 [pid 7686] [guest] OK DOWNLOAD: Client "138.2.25.151", "/tmp/dropped.txt", 285 bytes
```

Three things at once, and each is a separate claim:

- **`138.2.25.151` is WEYLAND-NET's public address — B's own network, derived server-side.** A is
  on `45.7.194.128`; the client never sent this and could not have been believed if it had. Every
  line carries it, hydra's wall included.
- **The wall, the break-in and both transfers are in ONE row under A's key.** Written under B's
  key instead, the login and the transfers would land in two rows and the journal's last-write-wins
  replay would show A half a visit.
- **`ls -l /tmp` as A: `-rwx---rw- guest 285 dropped.txt`** — the file B left, owned by the account
  B logged in as, and its content is B's wordlist. The patch is stored under *B's* writer key while
  the log stays under A's: the file is B's write, the record of it is A's box speaking.

**The known log staleness, hit again — read `conventions-and-gotchas.md` §9 before calling it a
bug.** A's first `cat /var/log/vsftpd.log` said `No such file or directory` and `ls /tmp` was empty
while the row already held all 85 lines. One local write (`echo sync > /tmp/sync.txt`) re-pulled the
journal and the whole file appeared. Same pre-existing behaviour D1d recorded at Act 10, with a
fifth writer added and nothing else.

---

### Act 12 — the silent door, opened from another network (D3b)

**Executed 2026-08-16 against v0.139.0. All checks passed.** The same two-network setup as Act 11
with the other door: A publishes their **sshd** through a forward, and B — on a different AP —
scans it, cracks it, moves a file each way, and leaves A a log that records four logins and
names no file at all.

The wire-check (`testScpTransfer`, 19/19) posts straight at the endpoints, so as in Act 11 **this
is the only thing that proves the client sends what the server reads**. It matters more here than
it did for ftp: the download direction reads a stranger's box through `resolveCrossPlayerFs`, and
the failure mode of getting that wrong is not an error — it is B being handed *their own* file
under A's name.

**As A** (`anton`, `DEFCON-VILLAGE` → `192.168.97.119`, public `45.232.28.45`):

| # | Command | Trap |
|---|---|---|
| 1 | §3's arc → connected (real `aircrack`, `KEY FOUND! [ diamond99 ]`) | — |
| 2 | `su root` → `sshd` | Confirm with `cat /var/run/sshd.pid` → `sshd:port=22`. A transfer reaches sshd or nothing |
| 3 | `ssh root@192.168.97.1` + `seedApGatewayAdminPw('DEFCON-VILLAGE')` = `root123` | — |
| 4 | `echo forward 5544 to 192.168.97.119:22 > /etc/iptables/rules.v4` → `exit` | Not 22 on the outside: on a public address :22 is the GATEWAY's own daemon, which is a different machine |

**As B** (`cracklab`, `ACME-CORP` → public `203.204.205.211`):

```
root@cracklab:/root# nmap 45.232.28.45
PORT     STATE SERVICE
22/tcp   open  ssh
5544/tcp open  ssh

root@cracklab:/root# hydra 45.232.28.45 ssh -p 5544
[5544][ssh] host: 45.232.28.45   login: guest   password: root1234

root@cracklab:/root# scp -p 5544 /usr/share/wordlists/passwords.txt guest@45.232.28.45:/tmp/carried.txt
guest@45.232.28.45's password:
Connecting to 45.232.28.45...
passwords.txt   100%  285 bytes

root@cracklab:/root# scp -p 5544 guest@45.232.28.45:/tmp/carried.txt /root/stolen.txt
Connecting to 45.232.28.45...
carried.txt   100%  285 bytes
```

`cat /root/stolen.txt` returns the 36-word list — read off A's box, not B's. **That round trip is
the whole proof of the cross-player read binding**: `/tmp/carried.txt` exists on A and nowhere on
B, so a resolver that fell back to B's own base would have answered `No such file or directory`
rather than the file.

**The tier crosses, and it bites the same way.** `scp -p 5544 guest@45.232.28.45:/etc/passwd .`
answers `scp: /etc/passwd: No such file or directory` — sealed and absent collapsed to one
answer, so a guest credential cannot map out what it may not read.

**What A's `/var/log/auth.log` held:**

```
… hydra's wall of Failed password lines, all from 203.204.205.211 …
Aug 16 07:54:40 anton sshd[5154]: Accepted password for guest from 203.204.205.211
Aug 16 07:55:30 anton sshd[1363]: Accepted password for guest from 203.204.205.211
Aug 16 07:55:58 anton sshd[2849]: Accepted password for guest from 203.204.205.211
Aug 16 07:56:39 anton sshd[7334]: Accepted password for guest from 203.204.205.211
```

Four claims, each separate:

- **Four logins for one crack and three transfers, and NOT ONE names a file.** The carry, the
  take and the refused read are indistinguishable from somebody logging in. `cat
  /var/log/vsftpd.log` → `No such file or directory`: the door has no log of its own, so there
  was never an scp line to forget to suppress. Set this against Act 11's `OK UPLOAD` /
  `OK DOWNLOAD` for the same movement — two doors, two costs.
- **`203.204.205.211` is ACME-CORP's address — B's own network, derived server-side.** A is on
  `45.232.28.45`, and B's client reported `192.168.45.254`, which appears nowhere.
- **`ls -l /tmp` as A: `-rwx---rw- guest 285 carried.txt`** — B's file, owned by the account B
  logged in as, sitting on A's box.
- **`select kind, count(*) filter (where ended_at is null) from sessions` → `scp | 0 | 3`.**
  Three rows opened, three closed, none outliving the command that opened it. A door held ajar
  would show here and nowhere else in the game.

---

## 6. What a failure means

| Symptom | Look at |
|---|---|
| A claim fails in browser **and** its wire-check fails | server bug — fix at `api/` or `core/`, wire-check first |
| Browser fails, wire-check passes | UI/adapter bug, or you tested as the wrong player (§3) |
| A shared box reads empty/stale right after `ssh` | fixed at v0.98.0 (below) — on an older build, re-read after ~10 s |
| A shared file is missing an edit another occupant just made | Expected — a session still never learns of a foreign write; re-`ssh` to refresh. Saving over it is now safe: the editor asks first (below) |
| `network "X" not found` | B's scan does not contain X — re-`airdump` (§4), it re-rolls |
| Empty foreign tree after a successful `ssh` | the hop resolved but the fetch did not — check `/api/network` in `agent-browser console` |
| Everything 502s | port squatter — the skill's §1 kill, then restart |
| Results contradict the code you just read | version banner ≠ `v2/package.json` — stale orphaned server |

### Fixed at v0.101.0 + v0.102.0: saving a shared file deleted another occupant's edits

Found by the v0.99.0 Act 4 re-run, in the `nano` co-edit half. **Not caused by the NAT
forward change — but that change is what makes it reachable**, because until v0.99.0 only
one occupant's forward worked, so nobody had a reason to co-edit one gateway.

A session standing on a FOREIGN machine fetches that machine's journal on the hop, and
refetches after its own writes. Nothing else invalidates it: the `patches-changed` sync
channel is **workstation-scoped** (own box only), so a player on a shared gateway never
learns another occupant wrote to it. `nano` then saves the **whole buffer**, and the
journal replays last-writer-wins — so the stale buffer becomes the newest row and the
newer rules vanish.

Reproduced end to end, both occupants root on one AP gateway:

```
B (on the gateway):  nano rules.v4 → append `forward 4444 to <B>:22` → ^O ^X → cat shows 3 forwards
A (session opened BEFORE that write):  nano rules.v4 → buffer holds only 2 forwards
A:                   append a comment → ^O ^X
C (outsider):        nmap <public IP> → 22, 2222, 3333.   B's 4444 is GONE from the world.
```

The `patches` rows show it plainly — A's row is newer and simply does not contain B's line:

```
3d5386c5  16:08:37   … forward 2222 … ~ forward 3333 … ~ forward 4444 …
a9dc9916  16:09:20   … forward 2222 … ~ forward 3333 … ~ # alice was here
```

Two boundaries worth knowing: a **fresh `ssh` hop does refresh** the view (A re-hopped and
saw B's line), and repeated `cat` within the existing session does **not** — A re-read
twice over ~12 s and stayed stale. So the staleness is per-session and permanent until the
next hop, unlike the v0.98.0 race below which self-healed.

This is the hazard the v0.98.0 note predicted ("nano saves the WHOLE buffer … silently
wiping them from a shared gateway"); v0.98.0 closed the *hop-race* source of staleness,
not this one. It applies to any shared machine, not only the AP gateway.

**Fixed by optimistic concurrency on a content hash, server-side.** A save carries a
fingerprint of the content the editor was SHOWN; the server compares it against the row a
reader would materialize (`orderPatchesForReplay`, `writer_key` tiebreak included) and
answers `409 modified_since_open` when they differ. Nano turns that into GNU nano's own
question — `File was modified since you opened it, continue saving? (y/n)` — where `y`
re-sends with no fingerprint at all, which is the unconditional write path. Last-writer-wins
is deliberately preserved: **you can still delete another occupant's rule, you just cannot do
it blind.** `>`, `touch`, `apt` and the sshd pidfile never showed the player content, carry no
fingerprint, and are unaffected by construction rather than by a special case.

**The staleness itself is NOT fixed, and is not meant to be.** A session standing on a shared
machine still never learns of a foreign write — verified again below, where A's editor opened
on a 5-line buffer while the world held 6. What changed is that the stale buffer can no longer
destroy anything silently. An editor-open refetch and a machine-scoped invalidation channel
both stay deferred (`conventions-and-gotchas.md` §9); rejections are therefore routine rather
than rare, which is accepted.

Re-verified end to end on 2026-07-29 at v0.102.0, three real players, same shape as the repro
above:

```
B (root on the gateway):  nano rules.v4 → append `forward 4444 to 192.168.167.19:22` → ^O ^X
A (session opened BEFORE that write):  nano rules.v4 → buffer holds 5 lines, no 4444
A:                        append a comment → ^O → ASKED
A:                        n            → buffer intact, journal untouched (one row, B's)
C (outsider on ACME-CORP):  nmap 203.97.86.63 → 22, 4444.   B's forward still answers.
A:                        ^O → ASKED → y  → [ Wrote 6 lines ], A's row now newest
C:                        nmap 203.97.86.63 → 22 only.      B's forward gone, deliberately.
```

One trap worth keeping: **a forward only answers if its target box is listening.** B's 4444
was absent from C's first scan until B ran `sshd` on their own box — the forward resolves the
lease, then gates on the target's liveness. That is correct behaviour, not a failed check.

### Fixed at v0.98.0: the journal lagged an `ssh` hop

Reproduced on 2026-07-28, v0.96.0; fixed the same day. Kept here because the shape recurs:
any late answer applied without asking who it was for can paint one machine over another.
After `ssh`ing onto a shared generated box, the same session showed two different trees:

```
root@inner-gw:/root# ls /tmp          # immediately after the hop
root@inner-gw:/root# ls /tmp          # ~12 s later, nothing else done
alice-was-here
```

The server is not at fault. A signed `listPatches` for that machine returns `200` with
every writer's rows, and replaying them offline over `generatedBaseFsForMachineId(...)`
produces the correct tree — the file and the edit both materialize. Only the browser is
behind.

`refreshServedRoot` already dropped a late result when the player had since hopped
(`if (activeSession()?.machineId !== active.machineId) return;`). `refetchPatches` had
**no such guard** — it called `setPatches` unconditionally when its fetch resolved — so
the two refetches a hop fires could land out of order and leave the previous machine's
journal (or an empty one) in place.

**Why it mattered beyond a confusing read:** `nano` saves the *whole buffer*. Opening an
editor during the stale window and saving would write back a tree missing the other
occupants' rules, silently wiping them from a shared gateway.

The fix carries `refetchPatches`' own deps through its await and applies the answer only
while the player still stands on that machine — the same rule as its sibling. Covered by
`ui/state.test.ts` ("patch journal across a machine change"), which rehydrates onto a hop
with the own box's journal held open, then releases it. One residue is deliberately left:
two fetches for the SAME machine can still land out of order (own box only, self-healing) —
see the deferred backlog in `conventions-and-gotchas.md` for why the obvious counter-based
fix is not a drop-in.

---

## 7. Deriving secrets and querying the DB

Per the skill's §6 — **a temp file inside `v2/`**, because `./src/...` imports resolve
only from there and `npx tsx -e` produces no output in this environment.

```bash
cd v2
cat > ./g.tmp.ts << 'EOF'
import { seedApGatewayAdminPw, seedApGatewayHostname } from './src/core/generation/routerFs';
import { computeApGatewayId } from './src/core/identity/router';
import { workstationGuestPassword } from './src/core/generation/workstationFs';
const ESSID = 'SHINRA-5G';                       // ← X
console.log('gateway admin pw =', seedApGatewayAdminPw(ESSID));
console.log('gateway hostname =', seedApGatewayHostname(ESSID));
console.log('gateway id       =', computeApGatewayId(ESSID));
EOF
npx tsx ./g.tmp.ts; rm -f ./g.tmp.ts
```

The WiFi password itself is `passwordForEssid` in `core/generation/generateWifi.ts` (not
exported — read it from the `aircrack` output, or from `wifiNetworks()` in the page via
`agent-browser eval`).

For a plain read, skip the temp file entirely and query the container directly — far
quicker, and it needs no env:

```bash
docker exec supabase_db_jshack-me-v2 psql -U postgres -tAc \
  "select essid, octet, left(owner_key,12) from network_lan_leases order by octet"
```

Use a `tsx` temp file when the query needs signing or core imports (it needs the env):

```bash
npx dotenv -e .env.development.local -- npx tsx ./q.tmp.ts
```

Signing one as a live player is the sharpest way to split a client bug from a server bug:
lift `jshack.identity` out of `localStorage`, `signRequest(identity, 'listPatches', {...})`,
and compare what the server returns against what the terminal shows. That is exactly how
the §6 defect was isolated. Note `signRequest` takes `(identity, action, fields)` —
positional, not one options object.

Useful reads: `network_public_ips` (an ESSID's public IP), `home_network_occupants`
(who is on it, and the identity fields), `network_lan_leases` (who holds which octet).
**`network_registry` no longer exists** — a query against it should error, and that
error is itself a valid check.

Delete the temp file when done.

---

## 8. Teardown

```bash
agent-browser close --all
```

then re-run the skill's §1 port kill and verify 3100/3101 are clear. A survivor silently
serves stale code to the next session.

If Act 5 ran, `npx supabase db reset` — X's gateway is permanently bricked otherwise.

---

## 9. Coverage map

| Item #5 acceptance criterion | Act | Also proven by |
|---|---|---|
| Same AP gateway for every occupant | 3 | `testCrossPlayerRouter`, `testSharedJournal` |
| Forward visible + reaches the publisher | 4 | `testCrossPlayerRouter`, `testSharedApForwards` |
| EVERY occupant's forward works, not just one | 4 | `testSharedApForwards` |
| No implicit gateway access | 3 | `testGatewayBrickLanAlive` |
| Brick = WAN dark, LAN alive | 5 | `testGatewayBrickLanAlive`, `testRouterBrick`, `testBrickedDark` |
| No address collisions; stable on rejoin | 2, 6 | `testLanLeaseAllocation` |
| Same NPCs, same deep chains | 2, 3 | `testDeepChainReach`, `testDeepSwitchChain` |
| NPC writes shared between occupants | 3 | `testSameLanCrossPlayerFs` |
| Every occupant visible to every other | 2 | `testSameLanOccupancy` |
| Registry gone, behaviour unchanged | all | the full wire-check suite |
| Disconnected = unreachable | 6 | `testDisconnectedUnreachable` |

D1's own criteria, layered on afterwards:

| D1 / D1b / D1c criterion | Act | Also proven by |
|---|---|---|
| A page comes back over http, logged like any fetch | 7 | `curl.test.ts` |
| A path sweep finds what the page never linked | 8 | `gobuster.test.ts` |
| A page renders as TEXT, comments withheld | 9 | `renderPage.test.ts` |
| Links numbered and followable; selection restored on return | 9 | `Lynx.test.tsx` |
| Going back RE-FETCHES — one log line per page viewed | 9 | `Lynx.test.tsx` + the log count itself |
| Cross-network browsing collapses to one refusal | 9 | `lynx.test.ts`, `webPage.ts` at 100% |

D3's criteria, layered on after that:

| D3 criterion | Act | Also proven by |
|---|---|---|
| A forwarded ftp door is visible and reachable from outside | 11 | `testFtpCrossPlayer`, `nmap` on the same forward |
| A cracked credential opens it, at the tier it carries | 11 | `testFtpCrossPlayer`, `testFtpSession` |
| Files move both ways across the network | 11 | `testFtpCrossPlayer`, `testFtpPut` |
| The defender reads the whole visit from ONE file, one row | 11 | `testFtpTransferTrace`, `testFtpCrossPlayer` |
| The address recorded is the visitor's real vantage | 11 | `testFtpCrossPlayer` (incl. the pivot case) |

D3b's criteria, the other door:

| D3b criterion | Act | Also proven by |
|---|---|---|
| A forwarded ssh door carries a file BOTH ways across the network | 12 | `testScpTransfer`, `scp.test.ts` |
| The read is the TARGET's box, not the visitor's own | 12 | `testScpTransfer` (17-19), `state.test.ts` |
| The tier the credential bought decides both directions | 12 | `testScpTransfer` (16, 18) |
| The defender's log records a LOGIN and never the file | 12 | `testScpTransfer` (5, 13), `scp.test.ts` vs ftp's ledger |
| The row that authorized it is gone when the command returns | 12 | `testScpTransfer` (6, 19) |
| A forward answered by another daemon is refused | 12 (nmap) | `testScpTransfer` (14), `scp.test.ts` |

Not covered here and still open: **deep-chain pivots through a shared chain** (Acts stop
at L1 NPCs) and **WiFi density / presence-TTL**, both deferred. If you want the deep
layer in the browser too, extend Act 3 with `ssh` into an inner gateway and follow its
forward down — the skill's §9 lists it as a wanted recipe.
