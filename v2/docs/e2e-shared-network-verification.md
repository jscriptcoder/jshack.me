# E2E verification: shared-network reconciliation

A live-browser runbook that exercises everything epic item #5 shipped (PRs #326–#334,
v0.88.0 → v0.96.0) as a real player would, in a real browser, against `vercel dev` +
local supabase.

**Last executed in full: 2026-07-28 against v0.96.0.** All six acts passed. Supporting
gates on that tree: 1958 unit tests / 122 files, and 26 wire-check scripts /
179 checks. Two runbook errors found and corrected in place (the `nmap` CIDR form, and
the assumption that any L1 NPC is sshable), plus one real client defect recorded in §6.

**Act 4 re-run 2026-07-28 against v0.99.0, all four checks passed** — a NAT forward now
reaches whichever occupant LEASES the address it names, so every occupant is
forward-reachable and the "publish for the later joiner" workaround is gone. That run also
found a **new client defect: a stale shared-file buffer silently deletes another
occupant's rules** (§6). Acts 1–3, 5 and 6 were not re-run on that tree.

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

## 6. What a failure means

| Symptom | Look at |
|---|---|
| A claim fails in browser **and** its wire-check fails | server bug — fix at `api/` or `core/`, wire-check first |
| Browser fails, wire-check passes | UI/adapter bug, or you tested as the wrong player (§3) |
| A shared box reads empty/stale right after `ssh` | fixed at v0.98.0 (below) — on an older build, re-read after ~10 s |
| A shared file is missing an edit another occupant just made | OPEN defect (below) — a session never learns of a foreign write; re-`ssh` to refresh, and do NOT save an editor over it |
| `network "X" not found` | B's scan does not contain X — re-`airdump` (§4), it re-rolls |
| Empty foreign tree after a successful `ssh` | the hop resolved but the fetch did not — check `/api/network` in `agent-browser console` |
| Everything 502s | port squatter — the skill's §1 kill, then restart |
| Results contradict the code you just read | version banner ≠ `v2/package.json` — stale orphaned server |

### OPEN at v0.99.0: saving a shared file deletes another occupant's edits

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

**Not yet fixed — it needs a decision, not just a patch.** The candidates: invalidate on a
cross-player write (needs a machine-scoped sync channel, today's is workstation-scoped);
refetch the journal when an editor OPENS a foreign file (cheap, narrow, doesn't fix a
concurrent save); reject a save whose base revision is stale (optimistic concurrency — the
honest fix, but it needs an in-game failure mode); or line-merge instead of whole-buffer
save (changes what `nano` means). Logged in `conventions-and-gotchas.md` §9.

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

Not covered here and still open: **deep-chain pivots through a shared chain** (Acts stop
at L1 NPCs) and **WiFi density / presence-TTL**, both deferred. If you want the deep
layer in the browser too, extend Act 3 with `ssh` into an inner gateway and follow its
forward down — the skill's §9 lists it as a wanted recipe.
