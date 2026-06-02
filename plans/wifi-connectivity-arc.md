# Plan: WiFi Connectivity Arc (v2)

**Branch**: per-slice (`feat/v2-wifi-*`) — this plan is the umbrella; each slice is its own PR.
**Status**: Active — design locked via grill-me (2026-06-02). Confirm each slice's acceptance
criteria before its RED.
**Arc**: [project-v2-connectivity-arc] — "get online + tooling" before the LAN-scan payoff. This is
the player's cold-start journey: no internet → crack WiFi → connect → **online**.

## Goal

Deliver the playable crack→connect→online loop on the player's workstation: `ifconfig` (no IP) →
`airmon start wlan0` (monitor mode) → `airdump` (list APs) → `aircrack <bssid>` (reveal a crackable
AP's password) → `nmcli connect <essid> <pw>` (**online milestone**). All client-side and seeded by
identity, with the server-authoritative home-network join deferred behind an already-correct async
seam. `apt`/`nmap` and the scannable shared LAN are downstream epics that consume `isOnline()`.

## Locked design decisions (grill-me, 2026-06-02)

1. **WiFi gen is client-side, seeded by player identity** (like `buildWorkstationBaseFs`); the only
   server-authoritative step is the **join**. Seeing an AP grants nothing — only the join has
   consequence, and that's server-gated.
2. **`WifiNetwork` model** = base (`bssid`, `essid`, `power`, `channel`, `encryption`) +
   discriminated `{ crackable: true; password: string } | { crackable: false }`. **No `tier`**
   (home-network density — deferred with the shared-LAN model).
3. **Richer structured interface model.** `ConnectivityState = { interfaces: ReadonlyMap<string,
   NetworkInterface> }`, `NetworkInterface` = discriminated union by kind:
   - `loopback (lo)`: always `up`, `ipv4` = 127.0.0.1.
   - `ethernet (eth0)`: `mac`, `up` (false at start), `ipv4` (null until a wired LAN — future hook).
   - `wireless (wlan0)`: `mac`, `up`, `monitorMode`, `association: {essid,bssid} | null`, `ipv4`.
   - Cold start: `lo` up, `eth0` down/no-IP, `wlan0` up/`monitorMode:false`/`association:null`/
     `ipv4:null`. **MACs seeded-deterministic** from identity. `online` = any non-lo iface has ipv4.
4. **Env seam:** read via `NetworkView` (`interfaces()`, `isOnline()`, `wifiNetworks()`); write via
   one thin generic `env.setInterface(name, next)` (read-modify-write of one Map entry, mirrors
   `setCwd`). **Policy lives in commands**, env stays dumb.
5. **WiFi networks generated once**, memoized in `ui/state` from `identity.publicKeyHex`, exposed
   read-only via `NetworkView.wifiNetworks()`. Full list (passwords included) is in the runtime
   object; `airdump` self-censors (no password column), `aircrack` is the only command that reveals
   it. Encode keeps it out of the static bundle; runtime plaintext is expected.
6. **The join is an async `env.homeNetwork.join(essid): Promise<{ localIp, hostname }>` seam**,
   currently **local-deterministic** (seed IP/hostname from identity+essid), explicitly the future
   server boundary. `nmcli` awaits it then `setInterface('wlan0', …)`. The shared-LAN home-network
   model (occupants, DB, `/api/join-home-network`) is **deferred** to a downstream epic.
7. **Persistence:** `monitorMode` **transient** (reset false on load — a tool-state). `connection`
   **persisted** as the connected **ESSID** in localStorage; on `startGame`, rehydrate by
   re-calling the deterministic join seam (reproduces `localIp`/`hostname`) and `setInterface`.
   Principle: persist achievements, not tool-states; persist the minimum + re-derive.
8. **Crackability gates** (port all three; the gameplay): WPA3 → `handshake capture not supported`;
   `power < -80 dBm` → `no handshake captured`; `<hidden>` ESSID → `no probing clients seen`.
   `crackable` is derived from these; `crackable:false` APs keep `encryption`/`power`/`essid` so
   `aircrack` picks the right failure. Keep the `WPA2|WPA3|WEP|OPEN` enum for display; generation
   uses WPA2/WPA3 only. **Defer OPEN-connect and WEP mechanics.**
9. **Preconditions:** all four commands gate on `isOnLocalhost`
   (`session.machineId === computeWorkstationId(identity.pubkey)` — currently unreachable in normal
   play but faithful + unit-testable with a foreign machineId). `airdump`/`aircrack` require
   `wlan0.monitorMode`. **Mutual exclusivity both ways** (tighten over legacy): `airmon start`
   requires `association === null`; `nmcli connect` requires `monitorMode === false` (else
   `wlan0 is in monitor mode; run 'airmon stop wlan0' first`). `nmcli connect`: ESSID must exist,
   password must match, same-ESSID reconnect is a no-op. `airmon`/`ifconfig` reject non-wireless
   interfaces type-safely via the union.
10. **Dramatic streaming** for `airdump`/`aircrack` via async `CommandResult`, paced by a NEW
    **abort-aware injected `env.sleep(ms): Promise<void>`** seam (rejects on `env.signal` so Ctrl-C
    stops a crack mid-flight; UI provides a real setTimeout sleep, tests provide an instant one — no
    fake timers). This seam is foundational, reused by every downstream async command (hydra, nmap,
    ssh). Tune durations shorter than legacy (~12s aircrack is too long).

**Secret pipeline (enabling, Slice 0).** WiFi passwords are the first genuine *spoiler* secret.
Port legacy's encode mechanism: pure `contentCodec` (XOR+Base64, key in bundle — **obfuscation not
secrecy**; it stops `grep` of the deployed dist, not a source-repo reader). `scripts/encode.ts`
(tsx) reads committed `src/secrets/secrets.ts`, writes **gitignored** `src/secrets/__encoded.ts`;
`predev`/`prebuild`/`pretest:run`/`pretest:coverage` hooks run encode first. Scope: the **mechanism**
+ only `WIFI_PASSWORDS`. Don't port the other 5 legacy pools. Server-authoritative WiFi validation
is deferred L3 ([feedback_multiplayer_ship_first]). Guest passwords already-plaintext in
`workstationFs.ts` are fine (wordlist-discoverable by design) — optionally move behind the codec
later, low priority.

**Legacy reference (port + simplify, like md5/prng):** `src/utils/contentCodec.ts`,
`scripts/encode.ts`, `src/secrets/secrets.ts`; `src/network/wifiNetworks.ts`,
`src/generation/generateWifi.ts`; `src/commands/{airmon,airdump,aircrack,nmcli}.ts`,
`src/hooks/useWifiCommands.ts` (the context surface).

## Acceptance Criteria (overall)

- [ ] A built bundle contains **no plaintext WiFi password** (encode pipeline works).
- [ ] `generateWifi(pubkeyHex)` is deterministic; 2–3 crackable + 3–5 noise; crackable carry a
      password from the encoded pool; byte-identical per identity.
- [ ] `ifconfig` shows `lo`+`wlan0` (no IP) at cold start; `-a` also shows `eth0` (down).
- [ ] `airmon start/stop wlan0` toggles `wlan0.monitorMode`; gated by `isOnLocalhost` + not-connected.
- [ ] `airdump` (monitor required) streams the AP list, no password column.
- [ ] `aircrack <bssid>` streams a crack; reveals the password for crackable APs; emits the right
      per-reason failure for WPA3 / weak-signal / hidden; Ctrl-C aborts mid-crack.
- [ ] `nmcli connect <essid> <pw>` (monitor off) validates the password, awaits the join seam, sets
      `wlan0` association+ipv4, goes **online**; `ifconfig` then shows the assigned IP; reconnect
      survives reload via stored-ESSID rehydration.
- [ ] `nmcli disconnect`/`status` behave; mutual exclusivity enforced both ways.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. Load `tdd`, `testing`,
`mutation-testing`, `refactoring` (+ `typescript-strict`, `functional`) before any code. Present each
slice's acceptance criteria and **wait for confirmation before RED**. Bump version + run
`npm run lint` (v2 has no Prettier) per slice.

### Slice 0: Secret codec + encode pipeline (enabling)

**Value**: Spoiler-safety — WiFi passwords (next slice) are born encoded, never greppable in dist.
Horizontal but justified: directly unblocks Slice 1's password pool, independently verifiable, reused
by every future secret.
**Path**: `core/.../contentCodec.ts` (pure XOR+Base64, encode/decode) → `src/secrets/secrets.ts`
(committed plaintext, `WIFI_PASSWORDS` only) → `scripts/encode.ts` (tsx; reads secrets, writes
gitignored `src/secrets/__encoded.ts`) → npm `encode` + `predev`/`prebuild`/`pretest:run`/
`pretest:coverage` hooks → `.gitignore` entry.
**Acceptance criteria**: `decode(encode(x)) === x` for arbitrary strings incl. unicode/empty;
`__encoded.ts` is generated + gitignored; a production build contains no plaintext WiFi password
(spot-grep a sample value in `dist/`). **Present + confirm before RED.**
**RED**: codec round-trip (incl. a known vector locking XOR key + base64); decode of a known
encoded constant. (Build-grep is a manual/CI check, not a unit test.)
**GREEN**: port `contentCodec`; add the script + secrets source + hooks.
**MUTATE/KILL/REFACTOR**: per skills (watch the XOR-key literal, base64 alphabet, byte-cycling index).

### Slice 1: Connectivity-state model + `ifconfig` (read-only)

**Value**: Player runs `ifconfig` and sees they're offline — `wlan0` has no IP. Walking skeleton of
the interface model + `NetworkView` reads.
**Path**: `core/network/interfaces.ts` (the discriminated union + cold-start builder, seeded MACs) →
`NetworkView.interfaces()`/`isOnline()` reads + `ui/state` signal + `buildCommandEnv` wiring →
`core/commands/ifconfig.ts` (renders up interfaces; `-a` shows down `eth0`; `ifconfig <name>` one).
`env.setInterface` may land here (unused until Slice 2) or with Slice 2 — prefer Slice 2 (YAGNI).
**Acceptance criteria**: cold-start map = `lo`(up,127.0.0.1)/`eth0`(down,null)/`wlan0`(up,no
monitor/assoc/ip); MACs deterministic per identity; `ifconfig` no-arg lists `lo`+`wlan0`; `-a` adds
`eth0`; `ifconfig wlan0` shows one; `isOnline()` false. **Present + confirm before RED.**
**RED**: cold-start builder shape + determinism; `ifconfig` rendering for no-arg / `-a` / named /
unknown-iface; `isOnline()` false when no ipv4. **GREEN**: build the model + reads + ifconfig.

### Slice 2: `airmon` (monitor-mode toggle) + `env.setInterface`

**Value**: Player enables monitor mode on `wlan0` (the airdump/aircrack prerequisite).
**Path**: `env.setInterface(name, next)` write seam + `ui/state` signal setter → `core/commands/
airmon.ts` (start/stop; `isOnLocalhost` gate; reject if associated; reject non-wireless iface;
idempotent). Reads current `wlan0`, narrows to wireless, sets `monitorMode`.
**Acceptance criteria**: `airmon start wlan0` sets monitorMode true + driver banner; `stop` clears;
idempotent messages; `isOnLocalhost` failure (foreign machineId); rejects when associated; `airmon
start eth0` → not-found/`not a wireless interface`. **Present + confirm before RED.**
**RED**: each branch above (start/stop/idempotent/gates). Mutator watch: the `'wlan0'` literal, the
boolean set, the gate conditions. **GREEN**: setInterface seam + airmon.

### Slice 3: `generateWifi` + `env.sleep` + `airdump`

**Value**: Player scans and sees nearby APs (monitor required).
**Path**: `core/generation/generateWifi.ts` (seeded; 2–3 crackable + 3–5 noise; consumes encoded
`WIFI_PASSWORDS`; `bssidFromEssid`; trimmed ESSID pools) memoized in `ui/state`, exposed via
`NetworkView.wifiNetworks()` → `env.sleep(ms)` abort-aware seam (UI real / test instant) →
`core/commands/airdump.ts` (async streamed table; `isOnLocalhost` + `monitorMode` gates; **no
password column**).
**Acceptance criteria**: `generateWifi` deterministic + counts + crackable-have-passwords +
discriminated union holds; `airdump` requires monitor; streams BSSID/power/channel/encryption/ESSID
with no password; `env.sleep` rejects on abort. **Present + confirm before RED.**
**RED**: generation determinism/shape/union; airdump gating + streamed output + censorship; sleep
abort. **GREEN**: generateWifi + sleep seam + airdump. Tests inject instant sleep.

### Slice 4: `aircrack` (the three gates + dramatic crack)

**Value**: Player cracks a crackable AP and learns its password; learns why others fail.
**Path**: `core/commands/aircrack.ts` (async; `isOnLocalhost` + `monitorMode` gates; resolve AP by
BSSID; emit per-reason failure for WPA3/weak-signal/hidden; on crackable stream the crack animation
ending `KEY FOUND! [ password ]`; Ctrl-C aborts via `env.signal`/`env.sleep`).
**Acceptance criteria**: success reveals `network.password`; WPA3/weak/hidden each emit their exact
message; unknown BSSID errors; monitor required; abort stops mid-crack. **Present + confirm before
RED.** **RED**: each gate + success + abort. Mutator watch: the gate thresholds (`-80`), the three
message literals, the crackable discriminant. **GREEN**: aircrack.

### Slice 5: `nmcli` (connect via async join + persistence) → online

**Value**: Player connects to the cracked WiFi and goes **online**; `ifconfig` shows the IP; survives
reload.
**Path**: `env.homeNetwork.join(essid): Promise<{localIp,hostname}>` async seam (local-deterministic
impl, seeded) → `core/commands/nmcli.ts` (`connect`/`disconnect`/`status`; `isOnLocalhost`; require
monitor OFF; validate ESSID+password; await join; `setInterface('wlan0', {association,ipv4})`; record
hostname; same-ESSID no-op) → persistence: store connected ESSID in localStorage; `startGame`
rehydrates via the join seam + `setInterface`.
**Acceptance criteria**: connect validates pw, goes online, `ifconfig` shows ip, `isOnline()` true;
wrong pw / missing essid / monitor-on each error; disconnect clears + `status` reflects; reload keeps
you online via rehydration; mutual exclusivity enforced. **Present + confirm before RED.**
**RED**: connect happy path + each failure; disconnect/status; mutual-exclusion; persistence
round-trip (store essid → rehydrate → online). Mutator watch: the join-seam wiring, the password
compare, the monitor-off gate, the persisted-essid key. **GREEN**: join seam + nmcli + persistence.

## Pre-PR Quality Gate (per slice / PR)

1. Mutation testing (`mutation-testing`; note v2 Stryker quirks — load-throw + root-bypass
   equivalents + derived-list tautologies → prefer hard-coded locks).
2. Refactoring assessment (`refactoring`).
3. Typecheck + lint — **v2 has no Prettier; `npm run lint` is the format gate.**
4. Bump `v2/package.json` + lock per the feature-bump preference.
5. Update the Story-1 `workstationFs.test.ts` "exactly the base skeleton" assertion only if the base
   tree changes (it shouldn't this arc — WiFi/connectivity are not FS entries).

---

_Delete this file when the arc is complete. If `plans/` is empty, delete the directory._
