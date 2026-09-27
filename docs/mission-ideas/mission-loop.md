# Legacy mission loop

> **Legacy mission design, kept as inspiration for the missions rebuild.** Every `src/`, `scripts/` and `e2e/`
> path refers to git tag `legacy-final`, not to the current tree.

This page covers how a player experienced missions in the retired React app: the contract board, the briefing, the commands that behaved differently during a mission, attack patterns and topology, persistence, and the dev tooling. It ends with the ideas worth keeping and the problems legacy had. The seed keyword grammar, difficulty tiers, entry variants, network modes, entry port templates, port closures and content pools are in [mission-variations.md](./mission-variations.md), and each objective's rules are in [objectives.md](./objectives.md). This page does not repeat them.

At `legacy-final` the contract board is empty and prints a "rework" notice. The listings quoted below come from git history: the last full board (55 contracts, removed in `7bf5c822`, 2026-04-11) and a later 6-contract test board (added in `cc280264`, removed in `4812c77d`, 2026-04-17). The board was cleared because the vulnerability-lookup refactor was expected to break mission generation, and missions were scheduled for a later rework.

## 1. The loop, as the player saw it

`missions` → `accept <SEED>` → briefing → hack the generated network → `mail <client> <proof>` → MISSION COMPLETE. A player could `abort` at any point.

`missions`, `accept`, `abort` and `mail` were "game commands" (`src/commands/availability.ts` `GAME_COMMANDS`, `src/hooks/useCommands.ts` `SKIP_ACCESS_CHECK`). They worked on every machine with no binary and no permission check, so a player could `mail` straight from a shell inside the mission network. `help` listed them under their own "Mission" category.

### 1.1 `missions`: the board

`src/commands/missions.ts`: when a mission is active, `missions` prints that mission's briefing again. Otherwise it prints the board from `src/mission/missionBoard.ts`.

**Layout.** The board has two columns joined by `  │  `. The left column is **DARKNET CONTRACTS** and the right is **SECURITY CONTRACTS**. A listing goes to the right-hand (white-hat) column when its seed contains `script-fix`, `script-auto`, `forensics`, `malware` or `db-fix`. Each column has an `=` rule sized to its widest line. Each entry has four lines: `[DIFFICULTY]`, target, objective and `SEED:`. The footer tells the player how to accept.

Rendered output of the 55-listing board (first four rows):

```
==================================================================================  │  =============================================================================
  DARKNET CONTRACTS                                                                 │    SECURITY CONTRACTS
==================================================================================  │  =============================================================================

[EASY]                                                                              │  [EASY]
  Greenleaf Medical Group — patient records server                                  │    QuickShip Logistics — warehouse workstation
  Exfiltrate the ACCESS-KEY from their records archive                              │    Repair a broken inventory validation script on their workstation
  SEED: GREENLEAF-ssh-easy-exfiltrate                                               │    SEED: QUICKSHIP-ssh-easy-script-fix

[EASY]                                                                              │  [EASY]
  Ridgemont University — student database                                           │    Pinecrest Logistics — compromised shipping database
  Tamper with a student's academic records                                          │    Investigate the breach: find who broke in and where they came from
  SEED: RIDGEMONT-ftp-easy-tamper                                                   │    SEED: PINECREST-easy-forensics

[EASY]                                                                              │  [EASY]
  Pinnacle HR Solutions — payroll server                                            │    Coastal Freight — shipping container IoT hub
  Steal the root credentials from their file server                                 │    Write and deploy an automated monitoring script on their IoT gateway
  SEED: PINNACLE-http-easy-credential-theft                                         │    SEED: COASTAL-ssh-easy-script-auto

[EASY]                                                                              │  [EASY]
  BrightStar Energy — grid monitoring station                                       │    Lakeview Hosting — shared web server
  Destroy the monitoring station — brick the machine                                │    Find and neutralize malware running on their web server
  SEED: BRIGHTSTAR-exploit-easy-sabotage                                            │    SEED: LAKEVIEW-ssh-easy-malware-forwarded
```

Full render of the 6-listing test board (it had no white-hat seeds, so the right column is empty):

```
===================================================  │  ======================
  DARKNET CONTRACTS                                  │    SECURITY CONTRACTS
===================================================  │  ======================

[* (Easy)]
  NovaCorp Web Portal
  Exfiltrate data from the target server
  SEED: NOVA-HEIST-exploit-easy

[* (Easy)]
  Meridian FTP Archives
  Retrieve classified files via FTP
  SEED: FTP-HEIST-ftp-easy

[** (Medium)]
  Axiom Mail Infrastructure
  Compromise the mail server cluster
  SEED: MAIL-HACK-exploit-medium

[** (Medium)]
  Pinnacle Database Systems
  Exfiltrate customer records from the database
  SEED: DB-CRACK-db-exfiltrate-medium

[** (Medium)]
  ClearView Analytics firmware
  Audit network device firmware for vulnerabilities
  SEED: FIRMWARE-HACK-snmp-medium

[*** (Hard)]
  Fortis Global Infrastructure
  Full network compromise across all layers
  SEED: FULL-STACK-ssh-hard
```

At `legacy-final` the footer reads `> Type accept <SEED> to start a mission`. Older boards used the JS-call syntax `accept("SEED")`, which `317999b7` replaced with shell syntax.

The board at `legacy-final` is empty and prints this instead (verbatim):

```
============================================
  DARKNET MARKETPLACE
============================================

  [ MISSIONS ARE GETTING A REWORK ]

  The contract board is offline while the
  mission system is rebuilt from the ground
  up with a new vulnerability and defense
  framework.

  Check back soon.

```

**What a listing carried.** `MissionListing` = `client`, `clientEmail`, `target`, `objective`, `difficulty`, `seed`. The board rendered only `difficulty`, `target`, `objective` and `seed`. `client` and `clientEmail` were stored but never shown, and `mail` never checked them (see 1.4). `target` and `objective` were hand-written flavour. The seed's keywords (see [mission-variations.md](./mission-variations.md)) determined what was actually generated. The listing has no reward field.

**All 55 listings on the last full board** (`git show 7bf5c822^:src/mission/missionBoard.ts`). "Column" is derived with the white-hat rule above.

| # | Difficulty | Column | Target | Objective | Seed | Listing `clientEmail` (never shown) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | EASY | Darknet | Greenleaf Medical Group — patient records server | Exfiltrate the ACCESS-KEY from their records archive | `GREENLEAF-ssh-easy-exfiltrate` | `xR0gu3x@darkmail.onion` |
| 2 | EASY | Darknet | Ridgemont University — student database | Tamper with a student's academic records | `RIDGEMONT-ftp-easy-tamper` | `gh0st_@darkmail.onion` |
| 3 | EASY | Security | QuickShip Logistics — warehouse workstation | Repair a broken inventory validation script on their workstation | `QUICKSHIP-ssh-easy-script-fix` | `cyph3rpunk@darkmail.onion` |
| 4 | EASY | Darknet | Pinnacle HR Solutions — payroll server | Steal the root credentials from their file server | `PINNACLE-http-easy-credential-theft` | `darkfl0w@darkmail.onion` |
| 5 | EASY | Darknet | BrightStar Energy — grid monitoring station | Destroy the monitoring station — brick the machine | `BRIGHTSTAR-exploit-easy-sabotage` | `zer0day_@darkmail.onion` |
| 6 | EASY | Darknet | Apex Courier Services — fleet tracking server | Plant a backdoor on their tracking server for persistent access | `APEX-ssh-easy-backdoor` | `v0id_agent@darkmail.onion` |
| 7 | EASY | Darknet | Solaris Telecom — border gateway router | Hack the router and expose an internal service via port forwarding | `SOLARIS-snmp-easy-portforward` | `n3twr4ith@darkmail.onion` |
| 8 | EASY | Security | Pinecrest Logistics — compromised shipping database | Investigate the breach: find who broke in and where they came from | `PINECREST-easy-forensics` | `v0id_agent@darkmail.onion` |
| 9 | EASY | Security | Coastal Freight — shipping container IoT hub | Write and deploy an automated monitoring script on their IoT gateway | `COASTAL-ssh-easy-script-auto` | `cyph3rpunk@darkmail.onion` |
| 10 | EASY | Darknet | Redstone Mining Corp — operations data server | Exfiltrate the ACCESS-KEY from their mining operations archive | `REDSTONE-nc-easy-exfiltrate` | `sh4d0w_@darkmail.onion` |
| 11 | EASY | Darknet | Silverline Transit Authority — fare management server | Steal root credentials from their fare processing system | `SILVERLINE-snmp-easy-credential-theft` | `n1ghtcr4wl@darkmail.onion` |
| 12 | EASY | Darknet | Crestview Academy — enrollment database | Tamper with enrollment records in their student portal | `CRESTVIEW-exploit-easy-tamper` | `gh0st_@darkmail.onion` |
| 13 | EASY | Security | Lakeview Hosting — shared web server | Find and neutralize malware running on their web server | `LAKEVIEW-ssh-easy-malware-forwarded` | `h4rdl1nk@darkmail.onion` |
| 14 | EASY | Darknet | Trident Pharma — clinical trials database | Exfiltrate the access key from their database records | `TRIDENT-ssh-easy-db-exfiltrate-forwarded` | `sqlph4nt0m@darkmail.onion` |
| 15 | EASY | Darknet | NovaTech Solutions — customer database | Tamper with user records in the database | `NOVATECH-ftp-easy-db-tamper` | `r00tk1ll@darkmail.onion` |
| 16 | EASY | Darknet | Arclight Industries — internal database | Wipe a critical table from their database | `ARCLIGHT-exploit-easy-db-sabotage` | `v4ult_br3ak@darkmail.onion` |
| 17 | EASY | Security | Harborview Medical — patient management database | Fix corrupted records in their database — a deployment went wrong | `HARBORVIEW-ssh-easy-db-fix` | `dbm3dic@darkmail.onion` |
| 18 | MEDIUM | Darknet | Obsidian Financial — trading platform backend | Tamper with trading records to manipulate account balances | `OBSIDIAN-ssh-medium-tamper` | `n3twr4ith@darkmail.onion` |
| 19 | MEDIUM | Darknet | NovaTech Labs — research file server | Steal root password from their research infrastructure | `NOVATECH-ftp-medium-credential-theft` | `silkr0ad@darkmail.onion` |
| 20 | MEDIUM | Darknet | Meridian Defense Corp — encrypted data vault | Exfiltrate encrypted ACCESS-KEY from their data vault | `MERIDIAN-nc-medium-exfiltrate-gpg` | `bl4ckh4t@darkmail.onion` |
| 21 | MEDIUM | Security | Sentinel Security — surveillance server cluster | Repair a broken audit script on their monitoring infrastructure | `SENTINEL-ssh-medium-script-fix` | `v0id_agent@darkmail.onion` |
| 22 | MEDIUM | Darknet | Axiom Biotech — gene sequencing lab server | Sabotage their primary analysis machine | `AXIOM-http-medium-sabotage` | `ph4nt0m@darkmail.onion` |
| 23 | MEDIUM | Darknet | Cobalt Dynamics — network gateway infrastructure | Breach their router via SNMP and exfiltrate the ACCESS-KEY | `COBALT-snmp-medium-exfiltrate` | `darkfl0w@darkmail.onion` |
| 24 | MEDIUM | Darknet | Prism Analytics — data processing cluster | Plant a root backdoor on their analytics engine | `PRISM-ftp-medium-backdoor` | `silkr0ad@darkmail.onion` |
| 25 | MEDIUM | Darknet | Apex Industrial — network perimeter router | Breach the gateway and set up port forwarding to an internal machine | `APEXIND-snmp-medium-portforward` | `darkfl0w@darkmail.onion` |
| 26 | MEDIUM | Security | Meridian Health Systems — breached patient portal | Trace the attacker through the network and identify them | `MERIDIAN-medium-forensics` | `sh4d0w_@darkmail.onion` |
| 27 | MEDIUM | Security | Sterling Dynamics — internal build cluster | Write a cron job that verifies their deployment pipeline | `STERLING-ssh-medium-script-auto` | `sh4d0w_@darkmail.onion` |
| 28 | MEDIUM | Darknet | Vertex Logistics — shipment tracking platform | Tamper with shipment routing data to reroute a high-value cargo | `VERTEX-exploit-medium-tamper` | `n1ghtcr4wl@darkmail.onion` |
| 29 | MEDIUM | Darknet | Cascade Power Systems — grid monitoring cluster | Sabotage their grid monitoring infrastructure | `CASCADE-nc-medium-sabotage` | `zer0day_@darkmail.onion` |
| 30 | MEDIUM | Darknet | Irongate Manufacturing — production control network | Breach the switch gateway and tamper with production records | `IRONGATE-snmp-medium-tamper-switch` | `ph4nt0m@darkmail.onion` |
| 31 | MEDIUM | Darknet | Helix Genomics — research authentication server | Exploit a vulnerability and extract root credentials | `HELIX-exploit-medium-credential-theft` | `darkfl0w@darkmail.onion` |
| 32 | MEDIUM | Security | Thornfield Hospital — patient database server | Investigate and neutralize malware compromising patient data | `THORNFIELD-ssh-medium-malware` | `cyb3rg00d@darkmail.onion` |
| 33 | MEDIUM | Darknet | Meridian Finance — trading platform database | Exfiltrate the secret access key from their trading database | `MERIDIAN-ssh-medium-db-exfiltrate` | `sqlph4nt0m@darkmail.onion` |
| 34 | MEDIUM | Security | Crestline Logistics — fleet management database | Fix corrupted maintenance records that are grounding vehicles | `CRESTLINE-ssh-medium-db-fix` | `dbm3dic@darkmail.onion` |
| 35 | MEDIUM | Darknet | Zenith Aerospace — contractor payroll database | Tamper with contractor payment records in the database | `ZENITH-http-medium-db-tamper` | `r00tk1ll@darkmail.onion` |
| 36 | MEDIUM | Darknet | Polaris Insurance — claims processing database | Wipe the claims table from their database | `POLARIS-exploit-medium-db-sabotage` | `v4ult_br3ak@darkmail.onion` |
| 37 | HARD | Darknet | Vanguard Gov Systems — classified document server | Destroy their classified archive — leave no trace | `VANGUARD-ssh-hard-sabotage` | `zer0day_@darkmail.onion` |
| 38 | HARD | Security | Nexus Pharma — drug trial data processing cluster | Repair a corrupted validation script deep in their network | `NEXUS-ssh-hard-script-fix` | `cyph3rpunk@darkmail.onion` |
| 39 | HARD | Darknet | IronClad Insurance — claims database cluster | Extract root credentials from their claims network | `IRONCLAD-nc-hard-credential-theft` | `xR0gu3x@darkmail.onion` |
| 40 | HARD | Darknet | Cerberus Bank — core transaction network | Exfiltrate encrypted ACCESS-KEY from the vault — GPG required | `CERBERUS-exploit-hard-exfiltrate-gpg-domain` | `n3twr4ith@darkmail.onion` |
| 41 | HARD | Darknet | Helios Aerospace — mission control infrastructure | Tamper with flight system access controls | `HELIOS-http-hard-tamper-domain` | `bl4ckh4t@darkmail.onion` |
| 42 | HARD | Darknet | Zenith Federal — core banking router network | Breach their SNMP gateway and steal root credentials | `ZENITH-snmp-hard-credential-theft-domain` | `gh0st_@darkmail.onion` |
| 43 | HARD | Darknet | Titan Defense — weapons research network | Plant a root backdoor deep in their research cluster | `TITAN-exploit-hard-backdoor-domain` | `ph4nt0m@darkmail.onion` |
| 44 | HARD | Darknet | Bastion Federal — classified network gateway | Penetrate the gateway and forward a port to expose their internal infrastructure | `BASTION-snmp-hard-portforward-domain` | `zer0day_@darkmail.onion` |
| 45 | HARD | Security | Obsidian Defense Corp — infiltrated classified network | Full incident response: trace the intrusion chain and unmask the attacker | `OBSIDIAN-hard-forensics` | `n1ghtcr4wl@darkmail.onion` |
| 46 | HARD | Security | Obsidian Labs — deep research network | Write an automated health-check script deep in their infrastructure | `OBSIDIANLAB-ssh-hard-script-auto-domain` | `bl4ckh4t@darkmail.onion` |
| 47 | HARD | Darknet | Polaris Satellite Corp — orbital control network | Destroy their orbital telemetry systems — wipe it clean | `POLARIS-ftp-hard-sabotage` | `xR0gu3x@darkmail.onion` |
| 48 | HARD | Darknet | Onyx Intelligence Group — encrypted signals archive | Exfiltrate encrypted ACCESS-KEY through a switch-gated classified network | `ONYX-nc-hard-exfiltrate-gpg-switch` | `silkr0ad@darkmail.onion` |
| 49 | HARD | Darknet | Aurora Pharmaceuticals — clinical trial network | Tamper with drug trial results deep in their switch-managed infrastructure | `AURORA-ftp-hard-tamper-switch` | `cyph3rpunk@darkmail.onion` |
| 50 | HARD | Darknet | Sovereign Systems — classified communications network | Tamper with encrypted communications records in their classified network | `SOVEREIGN-exploit-hard-tamper-domain` | `darkfl0w@darkmail.onion` |
| 51 | HARD | Security | Titanium Defense — weapons research network | Hunt and eliminate deeply hidden malware in their classified infrastructure | `TITANIUM-ssh-hard-malware` | `wh1t3h4t@darkmail.onion` |
| 52 | HARD | Darknet | Obsidian Corp — executive database behind multi-layer network | Destroy the audit trail in their deeply buried database | `OBSIDIAN-ssh-hard-db-sabotage` | `v4ult_br3ak@darkmail.onion` |
| 53 | HARD | Darknet | Blackrock Defense — weapons procurement database | Exfiltrate the access key from their deep procurement database | `BLACKROCK-snmp-hard-db-exfiltrate` | `sqlph4nt0m@darkmail.onion` |
| 54 | HARD | Darknet | Citadel Finance — high-frequency trading database | Tamper with trading records deep in their multi-layer network | `CITADEL-ftp-hard-db-tamper` | `r00tk1ll@darkmail.onion` |
| 55 | HARD | Security | Sentinel Health — clinical records database | Fix corrupted patient records buried deep in their infrastructure | `SENTINEL-ssh-hard-db-fix` | `dbm3dic@darkmail.onion` |

**The 6-listing test board** (`git show 4812c77d^:src/mission/missionBoard.ts`). The `cc280264` commit message gives each one's purpose: web effects, FTP file read/write/list, mail-server effects, DB effects, router firmware, and all services across 3 layers. It also warns that at game time 0 only hand-authored CVEs (all `shell_limited`) were live, so testing typed effects meant fast-forwarding `jshack_started_at` in localStorage.

| # | Difficulty | Column | Target | Objective | Seed | Listing `clientEmail` (never shown) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | * (Easy) | Darknet | NovaCorp Web Portal | Exfiltrate data from the target server | `NOVA-HEIST-exploit-easy` | `gh0st_protocol@darkmail.onion` |
| 2 | * (Easy) | Darknet | Meridian FTP Archives | Retrieve classified files via FTP | `FTP-HEIST-ftp-easy` | `z3r0_c00l@darkmail.onion` |
| 3 | ** (Medium) | Darknet | Axiom Mail Infrastructure | Compromise the mail server cluster | `MAIL-HACK-exploit-medium` | `shadowbroker@darkmail.onion` |
| 4 | ** (Medium) | Darknet | Pinnacle Database Systems | Exfiltrate customer records from the database | `DB-CRACK-db-exfiltrate-medium` | `dr_chaos@darkmail.onion` |
| 5 | ** (Medium) | Darknet | ClearView Analytics firmware | Audit network device firmware for vulnerabilities | `FIRMWARE-HACK-snmp-medium` | `n1ghtwatch@proton.onion` |
| 6 | *** (Hard) | Darknet | Fortis Global Infrastructure | Full network compromise across all layers | `FULL-STACK-ssh-hard` | `r00tk1t@darkmail.onion` |

### 1.2 `accept <SEED>`

`src/commands/accept.ts`:

- No seed → `accept: missing seed` / `Usage: accept <SEED-CODE>`.
- A mission already active → `A mission is already active. Use abort to cancel it first.` Only one mission could run at a time.
- Any string was accepted as a seed, not just board seeds. The same seed always generated the same network. The command ran `generateMissionNetwork(seed, usedPublicIps)` asynchronously, then `startMission`, then printed the briefing. A generation failure printed `accept: <message>`.
- `usedPublicIps` held the public IPs of the player's joined home networks (`src/game/GameSession.tsx`). The mission router's public IP re-rolled to avoid them.

### 1.3 The briefing

`formatMissionBriefing` in `src/commands/accept.ts`, verbatim frame:

```
============================================
  MISSION BRIEFING
============================================

  Seed: <seed>
  Difficulty: <easy|medium|hard>
  Objective: <objective.description>
  Reply to: <clientEmail>

<objective hint lines>

  Target: <router public IP, or <router-hostname>.mission when domainEntry>

  Use abort to cancel the mission.
============================================
```

`Reply to:` is the generated `clientEmail`. That email is a PRNG pick from `clientHandles` (`src/generation/pools/machines.ts`) plus `@darkmail.onion` (`generateClientEmail` in `src/generation/attackChain.ts`). It is not the board listing's `clientEmail`. The briefing never names an entry variant or gives credentials.

The `Objective:` text and the hint lines for every objective type are quoted verbatim in
[objectives.md](./objectives.md#1-what-the-player-was-told).

### 1.4 Play, then `mail`

The mission network became visible from the player's workstation only once the workstation had WiFi internet. `src/network/NetworkContext.tsx` treats a workstation without WiFi as disconnected and shows no machines, and the e2e helper `completeWifiGate` is documented as "required before any network access". From the workstation, the player could see only the mission's border router (see 2).

`mail <recipient> [content]` (`src/commands/mail.ts`) was the only way to complete a mission:

1. No recipient → `mail: missing recipient`.
2. Content was required unless the objective was checked by inspecting machine state. `script_fix`, `script_auto`, `tamper`, `sabotage`, `backdoor`, `portforward`, `db_tamper`, `db_sabotage` and `db_fix` took no content. `exfiltrate`, `credential_theft`, `forensics`, `malware` and `db_exfiltrate` required it. `malware` is verified by machine state but was still not on the content-optional list.
3. No active mission → `No active mission. Use accept <SEED> to start one.`
4. The recipient had to match the generated `clientEmail` exactly: `mail: unknown recipient "<x>". Check the mission briefing for the correct email.`
5. Proof was checked **synchronously** before any output. A failure threw `mail: delivery failed — <reason>`, the mission stayed active, and the player could retry any number of times with no penalty.

| Objective | What `mail` checked | Failure reason text |
| --- | --- | --- |
| exfiltrate | content `=== expectedProof` | `Incorrect proof. Find the ACCESS-KEY in the target file.` |
| credential_theft | content `=== expectedProof` | `Incorrect password. Discover the root password on the target machine.` |
| tamper | read the target file as root: old value gone, new value present | `Target file not found. The file may have been deleted.` / `Target file still contains "<old>". Modify the file first.` / `Target file does not contain "<new>". Check your edit.` |
| script_fix | ran the script on disk (`runScriptWithSystem`); the value passed to `_system()` must equal `expectedChecksum` | `Script execution failed: …` / `Script did not call _system(). …` / `Script output is incorrect. …` |
| script_auto | same, after stripping `await`; `cat()` returns the local data file, `curl()` returns the API JSON | same family |
| sabotage | `isMachineBricked(target)` | `Target machine is still operational. Delete critical boot files and reboot it.` |
| backdoor | `/var/run/nc-<port>.pid` exists on the target and its `userType=` matches the required user | `No listener detected on port <p>. Run nc -l <p> on the target machine.` / `Backdoor must be opened as <x>. Currently opened as <y>.` |
| portforward | parse the router's `/etc/iptables/rules.v4` and look for the exact `publicPort → internalIp:internalPort` rule | `No matching forwarding rule found. Add: forward <p> to <ip>:<port>` |
| forensics | split content on space, comma, colon or hyphen; both the attacker handle and the IP must be present (case-insensitive) | `Send both the attacker alias and their origin IP.` / `Incorrect findings. …` |
| malware | the malware file is gone **and** its PID file is gone | `Malware is still on disk at <path>. …` / `Malware process is still running. Use ps to find it and kill to stop it.` |
| db_exfiltrate | content `=== expectedProof` | `Incorrect proof. Find the ACCESS-KEY in the database.` |
| db_tamper / db_fix | in `/var/lib/mysql/data.json`, the target row (found by a filter column and value) has the new value in the target column | wording differs for tamper and fix (`corrupted value … still present`) |
| db_sabotage | database file deleted, table dropped, or all rows deleted | `Table '<t>' still has data. Destroy it.` |

On success, the output streamed with jittered delays (verbatim):

```
Connecting to darkmail.onion...
Encrypting message for <recipient>...
Routing through onion network...
Message delivered.

============================================
  MISSION COMPLETE
============================================
  Seed: <seed>
  Difficulty: <difficulty>

  Contract fulfilled. Type missions for more jobs.
============================================
```

`completeMission()` fired immediately before the banner.

### 1.5 `abort`

`src/commands/abort.ts`: with no active mission it printed `No active mission to abort.` Otherwise it called `popAllSessions()` (unwinding every nested SSH/FTP/NC hop back to the workstation), then `abortMission()`, then printed `Mission aborted. All mission data cleared.`

## 2. Commands that behaved differently during a mission

| Command | Mission-time behaviour | Source |
| --- | --- | --- |
| `missions` | Printed the active briefing instead of the board. | `src/commands/missions.ts` |
| `accept` | Refused while a mission was active. | `src/commands/accept.ts` |
| `abort` / `mail` | Worked only during a mission (see 1.4, 1.5). | |
| `nslookup` / `dig <domain>` | On the workstation, `<router-hostname>.mission` resolved to the router's public IP, and only while a mission was active. It was the only mission record visible from outside. Inside the network each machine saw its layer's `.mission` A records (see 3.2). `dig` printed records as `<host>.mission.` and stripped `.mission` from the name column. `nslookup`'s manual example was `nslookup target.local` ("Resolve a mission domain"). | `src/network/NetworkContext.tsx`, `src/commands/dig.ts`, `src/commands/nslookup.ts` |
| `dig <ip> axfr` | On a `dns`-role machine, read `/etc/bind/named.conf`. If it contained `allow-transfer { any; }`, `dig` dumped `/etc/bind/zones/db.mission`, which revealed internal hostnames. Otherwise it printed `; Transfer failed.` | `src/commands/dig.ts` |
| `nmap`, `ssh`, `ftp`, `nc`, `curl`, `msfconsole` from the workstation | The mission border router appeared in the workstation's visible machines alongside the home LAN and world routers. Its remote view merged live iptables forwarding rules and SNMP firewall overrides (`buildRouterRemoteView`), so an `snmpset firewallSSH=permit` or an edited `rules.v4` changed what `nmap` saw. | `src/network/NetworkContext.tsx`, `src/network/networkUtils.ts` |
| `msfconsole <host> <port>` | Forced effects from seed keywords (`shell-full`, `tier-root`, …) were stamped on the target machine's first open non-SSH port, along with an `owner` whose tier matched. Port closures stamped `script_exec`/root plus an owner on a fallback port so the player could always restart `sshd`. A forced effect with no natural CVE got a synthetic CVE (`CVE-2025-9501`…`9513` per service, `CVE-2025-9500` otherwise), with a description and attack pattern derived from the effect. A port with no `owner` failed with `exploit failed — service not exploitable`. After NAT resolution, `findMachineByIp` searched the whole mission, so a forwarded exploit hit the internal box, not the router. | `src/generation/generateMission.ts`, `src/generation/enrichment.ts`, `src/generation/findExploitableCve.ts`, `src/commands/msfconsole.ts` |
| `node <script>` | During `script_fix`/`script_auto` only, scripts got a `_system(value)` global. It returned `System check: PASS` when `String(value) === expectedChecksum`, otherwise `System check: FAIL — script output is incorrect`. Outside those missions, `_system` was undefined. | `src/hooks/useCommands.ts` (`getSystemFn`), `src/commands/node.ts` |
| `gpg <file> <key>` | No mission branch. It was the tool the encrypted-exfiltrate objective depended on: a 64-hex key and XOR+FNV-1a decrypt (`src/utils/crypto.ts`). The "need root" in the hint came from file permissions; `gpg` itself only checked read access, which root bypassed. | `src/commands/gpg.ts` |
| `reboot` | On a machine with `/boot/vmlinuz` missing (GRUB halt) or `/boot/initrd.img` missing (kernel panic), marked the machine bricked and popped the session. The bricked set persisted and was broadcast to other tabs (`bricked-changed`). After that, any network command targeting that IP printed `connect: Connection timed out — host <ip> appears to be down`. This is what `sabotage` verified. | `src/commands/reboot.ts`, `src/commands/networkGuards.ts` |
| `nc -l <port>` | Wrote `/var/run/nc-<port>.pid` as `nc:port=…,user=…,userType=…,home=…`. `backdoor` verification read it. | `src/commands/nc.ts` |
| `su` | `findMachineUsers` searched the mission network config and the router, so `su` knew the users on mission machines. | `src/network/NetworkContext.tsx` |
| `xterm` | New tabs shared mission state (see 4.3). | `src/commands/xterm.ts` |
| `reset confirm` | Wiped mission state together with everything else. | `src/commands/reset.ts` |

## 3. Attack patterns and topology

### 3.1 Attack patterns (`src/generation/attackPatterns.ts`)

An **attack pattern** is the log line an exploit leaves on the target. `pickPatternForEffect(service, effect, prng)` selects a pattern using two keys: the service's log family (which log file, in which format) and the effect kind (what the exploit actually did). The pattern is fixed at the moment a CVE is built: for hand-authored CVEs (`src/generation/pools/vulnerabilities.ts`), for procedural walker CVEs (`src/generation/timeline/generatedVuln.ts`) and for synthesized forced-effect stubs (`src/generation/findExploitableCve.ts`). A CVE therefore always leaves the same kind of breadcrumb. When `msfconsole` runs, `src/logging/handlers/exploitAttempt.ts` appends the formatted line to the log file of the **post-NAT** target, with the attacker's source IP in it. This is how the game turns exploitation into material for tracing and forensics.

Families: HTTP (`http`, `http-alt`, `https`, `elasticsearch` → `/var/log/access.log`), FTP (`/var/log/vsftpd.log`), MySQL (`/var/log/mysql.log`), Redis (`/var/log/redis.log`), Mail (`smtp` → `postfix/smtpd`, `imap`/`pop3` → `dovecot`, in `/var/log/mail.log`). Every other service falls back to `/var/log/syslog` tagged with a native daemon name (`postgres`, `mongod`, `smbd`, `rsyncd`, `vncserver`, `modbusd`, `openvpn`, `named`, `mosquitto`, `sshd`, else the service name). `<tier>` and `<port>` are substituted from the effect. When an entry lists two patterns, one is picked by PRNG.

| Effect (what the exploit did) | HTTP `access.log` (method path → status) | FTP `vsftpd.log` command | MySQL `mysql.log` query | Redis `redis.log` message | Mail `mail.log` message | syslog fallback message |
| --- | --- | --- | --- | --- | --- | --- |
| `shell_limited`: restricted shell | `GET /cgi-bin/?cmd=id` → 500; or `POST /cgi-bin/php?-d+allow_url_include=1` → 500 | `SITE EXEC /bin/sh` | `SELECT sys_exec('id')` | `CONFIG SET dir /var/spool/cron` | `remote command via malformed protocol verb` | `remote code execution attempt observed` |
| `shell_full`: full shell at a tier | `POST /admin/exec?shell=<tier>` → 200; or `POST /management/api/run-shell` → 200 | `USER admin'\0` | `SELECT sys_exec('bash -i >& /dev/tcp/0/0 0>&1') AS <tier>` | `EVAL os.execute('bash -i') for <tier> context` | `authenticated <tier> shell via sieve filter abuse` | `authenticated <tier> shell spawned via protocol abuse` |
| `file_read`: read one file | `GET /?file=../../../../etc/passwd` → 200; or `GET /download?path=../../../../etc/shadow` → 200 | `RETR ../../../../etc/passwd` | `SELECT LOAD_FILE('/etc/shadow')` | `EVAL "return redis.readfile('/etc/passwd')"` | `sieve fileinto: arbitrary read of /etc/shadow` | `unauthorized file read via path traversal` |
| `dir_list`: list a directory | `GET /?path=../../../../etc/` → 200; or `GET /files/?list=1&dir=../../../` → 200 | `LIST ../../../../etc` | `SELECT * FROM information_schema.files WHERE file_name LIKE '/etc/%'` | `EVAL listing /etc via redis.call` | `maildir listing request traversed outside mail spool` | `directory listing disclosed to unauthenticated peer` |
| `file_write`: write a file | `POST /upload?path=../../../../var/www/html/shell.php` → 201; or `POST /api/files/write?target=../../../etc/cron.d/evil` → 201 | `STOR ../../../../var/www/html/shell.php` | `SELECT 'shell' INTO OUTFILE '/var/www/html/shell.php'` | `CONFIG SET dbfilename /var/www/html/shell.php` | `sieve fileinto wrote to /var/www/html/shell.php (path bypass)` | `arbitrary file write via upload bypass` |
| `password_reset`: reset a tier's password | `POST /admin/password-reset?user=<tier>&force=1` → 200; or `POST /api/auth/bypass?override=1` → 200 | `SITE CHPASS <tier> newpass123` | `UPDATE mysql.user SET authentication_string=PASSWORD('pwn') WHERE User='<tier>'` | `CONFIG SET requirepass pwn (overriding <tier>)` | `auth plugin accepted password reset for <tier> without challenge` | `credential override accepted for <tier> account` |
| `backdoor_port_open`: open a listener | `POST /cgi-bin/bind?port=<port>` → 200 | `SITE EXEC nc -l -p <port> -e /bin/sh` | `SET GLOBAL general_log_file='/tmp/bind-<port>.sock'` | `SLAVEOF rogue <port> — opening bind shell` | `malformed AUTH opened listener on <port>` | `persistent listener opened on port <port>` |
| `script_exec`: run a player script | `POST /api/eval?code=process.mainModule.require(%27child_process%27).exec` → 200; or `POST /admin/template?engine=unsafe&tpl={{7*7}}` → 200 | `SITE EXEC lua /tmp/payload.lua` | `SET GLOBAL general_log_file = '/var/lib/mysql/plugin/evil.so'` | `EVAL lua sandbox escape via os.execute() bypass` | `sieve script executed arbitrary program via vnd.dovecot.execute` | `script executed as <tier> via unsandboxed evaluator` |

Formatting (`src/logging/formatters.ts`):

- **HTTP:** Apache combined `<ip> - - [ts] "METHOD path HTTP/1.1" status 0`.
- **vsftpd:** `FTP command: Client "<ip>", "<cmd>"`.
- **MySQL:** general-log `Query /* from <ip> */ <query>`.
- **Redis:** warning-level `# Client <ip> <message>`.
- **Mail:** syslog lines with the daemon tag.

An exploit against a port with no matching CVE still logs `exploit attempt rejected (no known vulnerability)` to syslog (`formatUnknownExploitAttempt`), so a failed attempt also leaves a trace.

### 3.2 Topology (`src/generation/topology.ts`), beyond mission-variations.md

- **Layer contents.** Each layer is one `/24` private subnet. Its gateway (the gateway into the layer) always sits at `<subnet>.1`. The layer's first machine is always the entry/DMZ box, with role `webserver` or `workstation`. The other machines draw from `webserver`, `database`, `fileserver`, `workstation`, `mailserver`, `iot` and `dns`. Last octets are unique within a layer (2–254). Hostnames are unique across the whole mission, including gateways; once a role's pool runs out, a numeric suffix is appended. Subnets are unique across layers.
- **Addresses.** Subnets come from RFC 1918 ranges: `10.x.x`, `172.16–31.x` or `192.168.2–254`. `192.168.1.x` is avoided because the static workstation network uses it. The border router's public IP takes its first octet from `45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212` (`src/generation/ip.ts`). MACs are `02:xx:xx:xx:xx:xx`.
- **Gateways.** The border router has `eth0` = public IP and `eth1` = `<layer0>.1`. Each inner gateway is dual-homed. `eth0` is a random free octet on the upstream subnet. `eth1` is `<downstream>.1`. Its ports are the downstream layer's gateway ports: the router-entry template in router-first mode, default router ports otherwise. A gateway's access variant is `ssh` when its downstream layer is forwarded, otherwise the downstream layer's entry variant.
- **Visibility.** Each machine sees its layer peers, the upstream gateway (at `.1`) and the outbound gateway into the next layer, if any. An inner gateway sees both adjacent layers plus the next gateway. The border router sees layer 0 plus the first inner gateway. From the workstation, only the border router is visible. In generation, the router's users are also mapped to `<layer0>.1`, and each inner gateway's users to its downstream `.1`, so SSHing to the `.1` address from inside works.
- **NAT.** In forwarded mode, the border router forwards **every open port of the entry machine** one-to-one (`publicPort = internalPort`). The same applies to an inner layer when its gateway is a router. The player's live forwards lived in the gateway's `/etc/iptables/rules.v4` (pre-populated in forwarded mode, an empty template in router-first mode). `NetworkContext` re-read that file, which is what made `portforward` playable.
- **Switch gateways** (`switch` keyword). An inner gateway could be an L3 switch instead of a router: always ACL-deny, never forwarded, no NAT rules and no firmware vendor. Only inner gateways can be switches; the border is always a router.
- **Firmware.** The firmware vendor of routers and router gateways comes from a separate PRNG keyed on **hostname** (`firmware-vendor:router:<hostname>`), not IP. Two instances of the same seed then get the same vendor even with different public IPs, and the side PRNG leaves the main sequence unchanged.
- **DNS.** Each layer's machines hold A records `<hostname>.mission` for their peers, the upstream gateway (at its `.1`) and the outbound gateway. The border router holds layer 0, its own public-IP record and the first gateway. The only record resolvable from outside is `<router-hostname>.mission`. The `domainEntry` briefing depended on that record (easy 30% / medium 50% / hard 70% chance, or the `domain` keyword).
- **Seed overrides** for entry variant and forwarded mode apply to the outermost layer only. Inner layers always roll.
- **Post-topology tweaks** (`src/generation/generateMission.ts`):
  - Redis 6379 opens on about 35% of `database` machines (`applyRedisPortOpening`).
  - `db_*` objectives inject MySQL 3306 on the target.
  - Gateways that rolled "basic SNMP" get UDP 161 added to their network view.
  - `portforward` forces router-first mode.
  - The white-hat objectives (`forensics`, `script_fix`, `script_auto`, `malware`, `db_fix`) force SSH entry.

Enrichment, mission-relevant parts only (`src/generation/enrichment.ts`):

- **Port owners.** `pickOwnerType` is guest 60% / user 30% / root 10%. NC backdoors remap root to user, because a backdoor is "planted by a prior attacker or rogue insider, not by root". The FTP and exploit variants keep the rolled tier. The exploit variant also rewrites the port's `serviceVersion` to a known-vulnerable version.
- **Port closures.** `applyPortClosures` (rules are in [mission-variations.md](./mission-variations.md)). The mission-relevant bits: `script_fix`, `script_auto`, `sabotage` and `portforward` skip all closures because they need an interactive shell. `backdoor` does not skip them, because the player can inject `nc -l` through a `script_exec` port. Every closure guarantees a way back in: an FTP port and a root-owned NC backdoor, plus `script_exec`/root on a port so the player can restart `sshd`.

## 4. Persistence, abort and complete, rewards, multiple tabs

### 4.1 Persistence

- Only the **seed** was persisted, in IndexedDB store `session` under key `activeMissionSeed` (`src/utils/storage.ts`). On reload, `useMissionState` regenerated the whole `MissionNetwork` from that seed, since generation is deterministic.
- Filesystem **patches** (edits, `apt install`s, deletions) persisted separately in IndexedDB. On the first mount with a persisted mission, `useFileSystemSync` replayed the cached non-workstation patches on top of the regenerated filesystems, so in-progress work survived a reload (`src/filesystem/useFileSystemSync.ts`).
- Mission machines were keyed by IP in the filesystem/patch map (`missionFileSystems`, merged after the workstation and home filesystems).

### 4.2 Abort and complete

- `abortMission` and `completeMission` were **identical**. Each set `activeMission = null`, deleted the persisted seed and broadcast `mission-changed` with `seed: null` (`src/mission/useMissionState.ts`).
- `abort` called `popAllSessions()` explicitly first. `mail` did not. Instead, `MissionProvider`'s effect (`src/mission/MissionContext.tsx`) called `popAllSessions()` whenever the mission went from active to null while the tab's session was on a machine other than the player's own workstation. That returned the player to the workstation after completion, and also after an abort in another tab.
- `popAllSessions` (`src/session/SessionContext.tsx`) restored the bottom of the session stack. Server-side, it ended the oldest tracked session in the chain, and its descendants were cascade-ended.
- **Patches were never wiped** on abort or complete. Before v0.112.0, a "mission-transition wipe" in `FileSystemContext` and the server's `clearTransientPatches` endpoint (`DELETE WHERE machine_id <> 'localhost'`) cleared them. Both were removed under a design rule, stated in `src/patchRegistry/README.md` and the `useFileSystemSync` comment: "mission instances are permanent — once accepted, the seed retires but the instance and its patches persist forever for anyone who can route to it."
- The bricked-machines set was persisted and cross-tab synced on its own path (`src/session/SessionContext.tsx`), and abort/complete did not touch it.

### 4.3 Rewards

There were none. No code tied completion to money, reputation, XP, unlocks or a completed-missions history. Completion printed a banner and cleared state. The board listings had no reward field. Nothing prevented re-accepting a completed seed; the "seed retires" rule was intent only, with no code enforcing it. The only mention of reputation is a forward-looking line in `src/identity/README.md`: resetting identity means "abandoning your reputation, your darknet listings, your messages".

### 4.4 Multiple tabs

- A `BroadcastChannel('jshack-sync')` carried `{ type: 'mission-changed', seed: string | null }` (`src/utils/crossTabSync.ts`). A receiving tab regenerated the mission from the seed (or cleared it) and also wrote the seed to IndexedDB.
- A tab whose session was inside the mission network when another tab aborted was popped back to the workstation by the `MissionProvider` effect.
- The `xterm` manual says: "Filesystem, WiFi state, and mission state are shared across tabs." Each tab kept its own session, user, machine, path and history.
- The channel is created inside a `useEffect`, so React StrictMode's cleanup and re-run get a fresh open channel. The broadcast target is held in a ref.

## 5. Dev tooling

**Seed keywords as the dev control surface.** `parseSeedOverrides` (`src/generation/generateMission.ts`) has its full grammar in [mission-variations.md](./mission-variations.md). Because any seed was valid, devs and QA reached a specific shape by writing it into the seed: `accept BASTION-snmp-hard-portforward-domain`, `test-switch-snmp-hard`, `password-reset-tier-root-easy`. PRNG calls are always consumed, even when an override discards the result, so a keyword changes only its own axis and leaves the rest of the network as it would otherwise be. The same seed grammar also drove **world networks**: `src/worldNetworks/generate.ts` ran `generateMissionNetwork(seed, undefined, { allocateIp: async () => row.public_ip })` to build shared persistent networks from rows in the `world_networks` table.

**`scripts/dumpMissionNetwork.ts`**: regenerates a mission offline and pretty-prints it.

```
npx tsx scripts/dumpMissionNetwork.ts <seed>
npx tsx scripts/dumpMissionNetwork.ts <seed> --cat <ip|hostname>:<path>
```

Its usage examples: `MEDTECH-4A7F-easy`, `GRADE-TAMPER-74`, `my-seed --cat jump-box:/etc/passwd`, `my-seed --cat 192.168.1.5:/var/log/auth.log`. Output sections, rendered with ANSI colour (helpers in `scripts/lib/dumpUtils.ts`):

- **OVERVIEW:**
  - seed, the active overrides parsed back out of the seed (`difficulty=hard, objectiveType=portforward, …`), difficulty, layer count, machine count
  - entry variant and entry point, router public IP
  - NAT mode (forwarded or router-first) with each NAT rule `:port → ip:port`
  - router domain, whether domain entry is on, client email
- **LAYER TOPOLOGY** (multi-layer only): per layer, subnet, gateway, variant, mode and machine count.
- **OBJECTIVE:** type, description, target machine and path, tamper old/new, expected proof, binary/encrypted flags, encryption key, key placement, script bug type and hint path, expected checksum. The whole answer key.
- **OUTER ROUTER, then LAYER n:** each machine tagged `[ROUTER]`, `[GATEWAY]`, `[ENTRY]` (forwarded) or `[PIVOT]` (router-first), and `[TARGET]`. Each port shows open or closed, version, the procedural patch timeline (`patch=Nd fix@dayN`), `[forced=<kind>/<tier>]` and `owner=<user>(<tier>)`. Users are listed as `name (tier)`.
- **FILESYSTEMS:** the full tree per machine with owner, size and a 60-character content preview.

`--cat` prints one file in full and accepts a hostname or an IP. It resolves against mission machines plus the router, and lists the available machines on a miss.

Sibling scripts, both offline:

- **`scripts/inspectPort.ts <seed> <ip> [gameTimeDays]`:** for each open port on one mission machine, prints the version, `forcedEffect` and the CVE `findExploitableCve` returns at that game time.
- **`scripts/simulateExploit.ts mission <seed> <ip> <port> [--gameTime <days>]`:** reports what `msfconsole` would do: the CVE, the effect, the attack-pattern log line and, for `backdoor_port_open`, the NAT gateway chain.

In the browser, `scripts/devConsole/setupTestPlayer.js` deletes `activeMissionSeed` when resetting a test player. The e2e helpers `acceptMission` and `expectMissionComplete` (`e2e/helpers.ts`) wait for the `MISSION BRIEFING` and `MISSION COMPLETE` banners.

## 6. Design notes worth keeping

- **One seed string is both the content and the save file.** Persisting only the seed plus a patch log made reload and cross-tab sync cheap, and a mission could be shared by quoting its seed.
- **Seed keywords double as a player-facing name and a dev override.** A contract's seed told the player what kind of job it was and let a dev force any axis. The rule of always consuming PRNG calls means an override never reshuffles the unrelated parts of the network.
- **Completion is a message to the client, verified against world state.** `mail` checked the machines themselves (file contents, pid files, iptables rules, the bricked set, database rows). The player could not fake completion, it fit the fiction, and one verb served 14 objective types.
- **Instant, specific failure feedback, no penalty.** Proof was checked before the "sending" animation, and each failure said exactly what was still wrong. Missions were retryable puzzles, not one-shot gambles.
- **The briefing withholds the method.** It gives the target (IP or `.mission` name) and the success condition, never the entry variant or credentials. Discovering the way in is the game.
- **White-hat jobs as a second column.** Defensive and repair work (script fix/auto, forensics, malware, db fix) sat beside offensive contracts, forced SSH entry, and handed over the root password in the briefing. It offered a non-attacker play style on the same machinery.
- **Every generated obstacle has a guaranteed way out.** Port closures always leave FTP, a root NC backdoor and a `script_exec`/root port. Objectives that need a shell skip closures entirely. A generated mission is solvable by construction.
- **Exploits leave effect-accurate breadcrumbs.** The attack-pattern pool makes the log line match what the exploit actually did, in the target service's native log format, on the post-NAT host. That makes the forensics objective work and ties offence to defence.
- **Instance identity is keyed on hostname, not IP.** Firmware vendor and similar properties are derived from seed-stable values, so two instances of one seed are structurally identical even when their public IPs differ.
- **Only the border router is visible from outside.** One public IP (or one `.mission` name) per mission, with everything else reached by pivoting. This kept the workstation's view clean and made depth feel real.
- **The generator is reusable.** The same `generateMissionNetwork` with a pinned-IP allocator produced persistent world networks. Missions and world content can share one engine.

## 7. Known problems in legacy

- **Board clients were decorative, not the real recipient.** `MissionListing.client` and `clientEmail` were never rendered or checked. `Reply to:` came from a separate PRNG pick, so a listing's advertised client usually differed from the one the player had to mail. Several board handles (`sqlph4nt0m`, `dbm3dic`, …) are not in the `clientHandles` pool at all.
- **The objective type was rolled twice.** Without an objective keyword, `generateMission.ts` picked from 6 types to decide port closures, and `buildMissionObjective` independently picked from 8. The closure decision could therefore follow a different objective than the one generated, for example a `script_fix` target losing SSH. White-hat SSH forcing also applied only when the objective came from a keyword.
- **Several objectives were keyword-only.** `portforward`, `forensics` and every `db_*` type were absent from both PRNG pools, so a free-form seed could never produce them.
- **Substring keyword matching.** `parseSeedOverrides` uses `includes()`, so a seed containing the letters `nc`, `ssh` or `http` anywhere (in a company name, say) silently forces that entry variant. The code works around specific cases (hyphenated `router-first`, stripping `backdoor-port`/`script-exec`, longest keyword first) instead of tokenising.
- **Two parallel machine structures.** `MissionNetwork.machines` and `networkConfig.machineConfigs` each held port data, and every transform (forced effects, MySQL injection, SNMP ports) had to be applied to both. The code calls this out as tech debt (`project_dual_machine_structure_drift`), with a property test in `generateMission.test.ts` as the tripwire.
- **Exploit logs ignored forced and firmware effects.** `src/logging/handlers/exploitAttempt.ts` looked up the CVE with `findVulnForService`, not `findExploitableCve`. A forced-effect port therefore logged the natural CVE's pattern (describing a different effect), a synthesized-CVE port logged "exploit attempt rejected (no known vulnerability)", and `success` was not used when picking the line.
- **A re-rolled public IP shifts the whole mission.** `generatePublicIp` re-rolls on collision with `usedIps` and consumes extra PRNG calls, so the same seed could generate a different network for a player whose home-network IPs collided. The server allocator seam (`allocateIp('mission_instance')`) existed but `accept` never passed it.
- **Mission instances were not server-side.** The patch registry and L2 write validation covered mission machines leaf-only, because `mission_instances` was "not yet a server-side concept". Untouched mission paths were an open threat-model gap (`src/patchRegistry/README.md`). Mission `.1` gateway aliases were also left out of the gateway canonical map ("deferred to mission redesign", `src/network/NetworkContext.tsx`).
- **"Permanent instances" was never enforced.** Patches stopped being wiped, but nothing retired a seed, recorded completion or gave rewards. Re-accepting a seed regenerated the same network while old patches still sat under the same IP keys.
- **Abort and complete were indistinguishable in state.** Both just cleared the seed. There was no history, score or record that a contract was fulfilled, and the bricked set outlived the mission.
- **`mail`'s content-optional list missed `malware`**, even though its verification ignores content.
- **Documentation drift in legacy docs:**
  - `src/mission/README.md` says mission patches are "cleaned up on mission end/transition" (false since v0.112.0) and that the router IP is `45.x.x.x` (the first octet varies across 12 prefixes). It also documents the retired JS-call syntax (`missions()`, `accept("SEED")`).
  - `src/generation/README.md`'s usage calls `generateMissionNetwork('HEIST-7734')` synchronously, but the function is async (it returns a `Promise<MissionNetwork>`).
  - `src/worldNetworks/README.md` points to `src/generation/parseSeedOverrides.ts`, which does not exist; the function lives in `generateMission.ts`.
  - A `NetworkContext` branch comment says "mission but no WiFi", but a workstation without WiFi returns the disconnected view before that branch is reached.
  - `topology.ts` computes `externalDnsRecords`, but `MissionNetwork` never carries them. `NetworkContext` re-derives the `<router>.mission` record itself.
- **The board was hand-maintained against a moving generator.** It was cleared twice because generator refactors (credential removal, dynamic CVE lookup) broke listed seeds. The `cc280264` note shows that at game time 0 only `shell_limited` CVEs were live, so which listed missions were playable depended on the game clock.
