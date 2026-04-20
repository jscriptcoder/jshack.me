# Mission Variations

Comprehensive catalog of all procedural generation variation axes. Use this to track what exists and plan additions.

## Seed Keywords

All generation axes can be controlled by embedding keywords in the seed string (case-insensitive, matched via `includes()`). `parseSeedOverrides(seed)` in `generateMission.ts` extracts overrides. PRNG sequence is preserved — calls are consumed but results discarded in favor of overrides.

| Axis          | Keywords                                                                                                                                                                                      | Notes                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Difficulty    | `easy`, `medium`, `hard`                                                                                                                                                                      | Falls back to hash-based derivation without keyword                                                                                                                                     |
| Entry variant | `ssh`, `ftp`, `nc`, `exploit`, `http`, `snmp`                                                                                                                                                 | Falls back if template unavailable (e.g. nc+router-first)                                                                                                                               |
| Network mode  | `forwarded`, `router-first`                                                                                                                                                                   | Hyphenated to avoid false matches                                                                                                                                                       |
| Objective     | `exfiltrate`, `tamper`, `credential-theft`, `script-fix`, `script-auto`, `sabotage`, `backdoor`, `portforward`, `forensics`, `malware`, `db-exfiltrate`, `db-tamper`, `db-sabotage`, `db-fix` | Hyphen variant for credential_theft / script_fix / script_auto; portforward forces router-first; forensics/malware/db-fix force SSH entry; db-\* objectives inject MySQL port on target |
| Domain entry  | `domain`                                                                                                                                                                                      | Forces domain-based briefing (nslookup required)                                                                                                                                        |
| Encryption    | `gpg`                                                                                                                                                                                         | Forces exfiltrate + encrypted target file                                                                                                                                               |
| Gateway type  | `switch`                                                                                                                                                                                      | Forces inner gateways to be managed L3 switches (ACLs instead of NAT)                                                                                                                   |
| Forced effect | `shell-limited`, `shell-full`, `file-read`, `dir-list`, `file-write`, `password-reset`, `backdoor-port`, `script-exec`                                                                        | Forces a specific vulnerability effect on the target machine's first open non-SSH port                                                                                                  |
| Forced tier   | `tier-root`, `tier-user`, `tier-guest`                                                                                                                                                        | Controls the privilege tier of the forced effect (defaults to PRNG roll)                                                                                                                |

Example seeds: `HEIST-ssh-forwarded-tamper-hard`, `BANK-JOB-nc-exfiltrate`, `test-exploit-router-first`, `test-switch-snmp-hard`

## Difficulty Tiers (3)

| Tier   | Subnet Layers | Machines per Layer | Total Machines | Gateways | Router | Network Mode                                 |
| ------ | ------------- | ------------------ | -------------- | -------- | ------ | -------------------------------------------- |
| Easy   | 1             | 2                  | 2              | 0        | 1      | 70% forwarded, 30% router-first              |
| Medium | 2             | 2–3                | 5–7            | 1        | 1      | 50/50 per layer                              |
| Hard   | 3             | 2–3                | 8–11           | 2        | 1      | Border always router-first; inner layers 30% |

Difficulty adds network depth via isolated subnet layers. Each layer has its own private subnet and entry variant (SSH, FTP, NC, exploit, HTTP, SNMP). Layer boundaries require hacking a dual-homed gateway machine to reach the next layer. The target is always placed in the deepest layer (except portforward, which targets layer 0). Seed keywords for entry variant and network mode apply to the outermost layer only.

## Entry Variants (6)

How the player gains initial access to the entry machine.

| Variant | Flow                                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSH     | `nmap` → find port 22 → `hydra` brute-force to find credentials                                                                                                                                                                                         |
| FTP     | `nmap` → find port 21 → `hydra <ip> ftp` crack FTP virtual user password → FTP in, explore files → find leaked SSH creds or fetch `/etc/passwd` via `get` + `john` → SSH in. SSH passwords are NOT in hydra's wordlist (never crackable by brute force) |
| NC      | `nmap` → find suspicious high port → `nc` to get a read-only recon shell as port owner; explore files; ~30% credential leak chance, otherwise `hydra` for SSH. Remote code execution via `script_exec` vulnerabilities through `msfconsole`             |
| Exploit | `nmap -sV` → find vulnerable service → `msfconsole <host> <port>` → same restricted shell as NC                                                                                                                                                         |
| HTTP    | `nmap` → find HTTP port (80, 443, or 8080) → `curl` to explore web content → find SSH credentials in web files                                                                                                                                          |
| SNMP    | `nmap -sU` → find UDP 161 → `snmpwalk` with RW community → `snmpset` to open SSH port → `hydra` or cred leak                                                                                                                                            |

## FTP/NC/Exploit Owner Types (3)

Owner type for NC backdoor and exploit port owners varies per seed, adding difficulty variety. The NC shell user and exploit shell user are determined by the port owner. FTP also gets a port owner via PRNG (preserving sequence stability), but FTP authentication is independent — any valid user on the machine can log in via FTP with correct credentials. FTP-entry machines have separate FTP credentials (`/etc/vsftpd/virtual_users.conf`) with passwords from `WORDLIST_PASSWORDS` (crackable via hydra). ~40% of other FTP-open machines also get virtual users for variety.

| Type  | Weight | Effect                                                   |
| ----- | ------ | -------------------------------------------------------- |
| guest | 60%    | Limited file visibility, must find SSH creds             |
| user  | 30%    | Hint files in owner's home dir, accessible to that user  |
| root  | 10%    | Can read root-owned files, easiest to find what's needed |

**NC exception:** Backdoors are planted by prior attackers, not by root on their own machine. NC remaps root → user, so NC backdoors are effectively 60% guest / 40% user (PRNG sequence preserved).

Root owners have hints placed in `/tmp/` instead of `/home/root/` (since root's home is `/root/`, not managed by `generateHomeContent`).

## Domain Entry Mode

When domain entry is active, the mission briefing shows the router's `.mission` domain instead of its public IP, forcing the player to use `nslookup()` to discover the target IP before connecting.

| Difficulty | PRNG Chance (no keyword) |
| ---------- | ------------------------ |
| Easy       | 30%                      |
| Medium     | 50%                      |
| Hard       | 70%                      |

With the `domain` seed keyword, domain entry is always active. Without it, PRNG decides based on difficulty.

## Mission Briefing

The briefing (shown by `accept()` and `missions()`) contains only: seed, difficulty, objective description, client email, objective-specific instructions (what to do / what to mail), and the target IP or domain. No entry-variant-specific hints or credentials are revealed — the player must always figure out how to gain access independently.

## Encrypted Exfiltrate

Exfiltrate objectives have a ~25% chance (or 100% with `gpg` keyword) of encrypting the target file. The decryption key (64-char hex) is placed on a different machine in the attack path. Players must find the key and use `gpg(file, key)` as root to reveal the ACCESS-KEY. Encryption uses deterministic XOR+FNV-1a checksum (`src/utils/crypto.ts`). Key files under `/home/` are user-owned (readable without root); key files in system paths (`/root/`, `/etc/`, `/var/`, `/opt/`) are root-owned.

### Key Placement Templates (5)

| Path                               | Content Style                          |
| ---------------------------------- | -------------------------------------- |
| `/root/.keys/backup.key`           | AES key backup with `key=<hex>`        |
| `/etc/ssl/private/archive.key`     | Config-style with algorithm and key    |
| `/home/{{user}}/.gnupg/export.key` | PGP-looking key export block           |
| `/var/backups/.master.key`         | Master encryption key file             |
| `/opt/security/vault.key`          | JSON vault key with algorithm and date |

Key files have ~25% chance of binary wrapping (using `binaryKeyPaths` per role).

## Script Fix Objective

A white-hat objective type where the player is hired as an authorized contractor to fix a broken JavaScript script on the target machine. The player SSHs in with root credentials (provided in the briefing), fixes the script with `nano()`, and tests it with `node()`. The script computes a checksum from its filtered data and passes it to `_system(checksum)` — a function available inside `node()`'s execution context during script_fix missions. When the player runs `node()` to test, `_system()` returns "System check: PASS" or "System check: FAIL". To complete the mission, the player mails "done" to the client — the `mail()` command internally re-executes the script and verifies `_system()` was called with the correct checksum. Seed keyword: `script-fix`.

### Bug Types (3, ~33% each)

| Type      | Description                                                         |
| --------- | ------------------------------------------------------------------- |
| syntax    | Missing paren, quote, or brace — script throws a SyntaxError        |
| logic     | Wrong comparison value or filter condition — script outputs "ERROR" |
| corrupted | Data line replaced with `???` — correct value in a nearby hint file |

### Script Fix Templates (18 — 3 per main role + 2 router + 1 switch)

3 templates per main role (fileserver, database, webserver, mailserver, iot, workstation) + 2 for router + 1 for switch (unused — infrastructure-only roles).

Each template is a short script that filters/counts array data and conditionally calls `_system(<checksum-expr>)` on success. `_system(checksum)` is injected into `node()`'s execution context during script_fix missions — when testing, it returns "System check: PASS" or "System check: FAIL". During mail verification, the script is re-executed and the value passed to `_system()` is checked against `expectedChecksum`. Bug variants introduce syntax errors, logic errors, or corrupted data lines. Corrupted variants have a hint file at a nearby path on the same machine containing the correct value.

### Key Design Decisions

- White-hat mission: player is an authorized contractor (like forensics)
- SSH entry forced, root password in briefing (no infiltration required)
- No binary wrapping (scripts must be readable/editable with nano)
- No encryption (scripts must be directly editable)
- No dummy PRNG rolls needed (no backwards compatibility concerns)
- Corrupted hints placed on same target machine (not a different machine)
- `_system(checksum)` provides PASS/FAIL feedback during `node()` testing
- `mail()` re-executes the script to verify correctness (no ACCESS-KEY exchange)
- `_system()` only exists in `node()`'s execution context, not the terminal

## Script Auto Objective

A white-hat objective type where the player is hired as an authorized contractor to write an automated script from scratch. The player SSHs in with root credentials (provided in the briefing), finds the stub file in an automation location (cron, init, or network-up hook) with comment instructions describing what data to read and extract. The player writes the script body using `nano <path>`, tests it with `node <path>`, and confirms to the client via `mail <recipient> done`. The `mail` command re-executes the script and verifies `_system()` was called with the correct value. Seed keyword: `script-auto`.

### Two Flavors

| Flavor | Description                                                                | Script Mode |
| ------ | -------------------------------------------------------------------------- | ----------- |
| local  | Read a JSON file on the same machine, extract a field, pass to \_system()  | Sync        |
| remote | POST to an API endpoint on another machine, parse JSON, pass to \_system() | Async       |

### Script Locations (3)

| Location | Path prefix             | Narrative                     |
| -------- | ----------------------- | ----------------------------- |
| cron.d   | `/etc/cron.d/`          | Periodic monitoring job       |
| init.d   | `/etc/init.d/`          | Boot-time data collection     |
| if-up.d  | `/etc/network/if-up.d/` | Network-up connectivity check |

### Templates (24 — 3 per role)

Each role (fileserver, database, webserver, mailserver, iot, workstation, router, switch) has 3 templates covering all 3 locations (cron.d, init.d, if-up.d) and mixing local/remote flavors. Templates include comment instructions, a JSON data file with the expected value, and an `expectedChecksum` field.

### Data Placement

- **Local**: JSON data file placed on the target machine at a system path (e.g., `/var/lib/backup/status.json`)
- **Remote**: JSON file placed at `/var/www/api/<endpoint>.json` on a peer machine with port 80. The stub instructions include the API machine's IP

### Key Design Decisions

- White-hat mission: player is an authorized contractor (like forensics and script_fix)
- SSH entry forced, root password in briefing
- Uses `_system()` verification (same mechanism as script_fix)
- `mail()` re-executes the script to verify correctness (no ACCESS-KEY exchange)
- No binary wrapping, no encryption
- Port closures skipped (needs SSH shell access)
- Remote flavor falls back to local if no peer machine available
- Player writes the script from scratch (not fixing bugs)

## Backdoor Objective

A 6th objective type where the player must open a netcat listener (`nc -l`) on a target machine at a specific port as a specific user. The player must install netcat on the target machine first (via `apt install netcat` as root or `scp` the binary). Seed keyword: `backdoor`.

### Port Selection

Port is PRNG-picked from `backdoorPorts` pool: 4444, 31337, 8888, 1337 (all above 1024, so no root-for-port requirement).

### User Requirement (by difficulty)

| Difficulty | Required User            | Notes                                              |
| ---------- | ------------------------ | -------------------------------------------------- |
| Easy       | guest (60%) / user (40%) | No privilege escalation needed for the listener    |
| Medium     | root                     | Must escalate privileges before opening listener   |
| Hard       | root                     | Must escalate privileges + traverse longer network |

### Verification

`mail(client, "done")` reads `/var/run/nc-<port>.pid` on the target machine (as root) and verifies:

1. PID file exists (listener was started)
2. `userType` field matches the required user

### Key Design Decisions

- No target file (like sabotage/credential_theft)
- Dummy PRNG rolls consumed for binary + encrypt to preserve sequence alignment
- SSH port closures allowed for backdoor (player can `nc -l <port>` via script_exec injection on the forced-effect port)
- Player can install netcat via `apt install netcat` (needs root for apt) or copy the binary via `scp`

## Portforward Objective

A 7th objective type where the player must hack the border router and set up port forwarding to expose an internal machine's service. The player edits `/etc/iptables/rules.v4` on the router to add a forwarding rule. Seed keyword: `portforward`. Always forces router-first mode (no pre-populated NAT rules). SNMP is the most natural entry variant for this objective.

### Port Selection

- **Public port**: PRNG-picked from `forwardPublicPorts` pool: 8080, 8443, 9090, 8888, 3000, 4443
- **Internal port**: Picked from the target machine's open ports (prefers non-SSH services; falls back to SSH port 22)
- **Target machine**: The last machine in the attack path (same as other objectives)

### Verification

`mail(client, "done")` reads `/etc/iptables/rules.v4` from the router filesystem and verifies:

1. File exists and is readable
2. Parsed rules contain a matching entry: `forward <publicPort> to <internalIp>:<internalPort>`

### Key Design Decisions

- Always router-first (forwarded mode would have pre-existing rules, defeating the purpose)
- No target file (like sabotage/backdoor/credential_theft)
- SSH port closures skipped (player needs shell access through the network)
- Dummy PRNG rolls consumed for binary + encrypt to preserve sequence alignment
- Keyword-only objective (not in the PRNG random pool) — seeds without `portforward` keyword never generate this type

## Binary File Wrapping

Some credential breadcrumbs, exfiltrate target files, entry credential hints, and encryption keys are wrapped in "binary noise" — non-printable characters interspersed with readable content. `cat` shows garbled output; `strings` extracts the readable data. This adds a discovery mechanic requiring the `strings` command.

### Probabilities

| Context                | Binary Chance | Notes                                        |
| ---------------------- | ------------- | -------------------------------------------- |
| Credential breadcrumb  | 30%           | Next-hop passwords hidden in binary files    |
| Exfiltrate target file | 25%           | ACCESS-KEY in binary file                    |
| Entry credential hint  | 20%           | SSH creds for FTP/NC/exploit entry in binary |
| Encryption key file    | 25%           | Decryption key in binary file                |

### Binary File Paths

Binary credential placements use deep paths that look like compiled binaries or data files:

| Role        | Example paths                                                                        |
| ----------- | ------------------------------------------------------------------------------------ |
| webserver   | `/usr/local/bin/httpd_monitor`, `/opt/lib/libmod_auth.so`, `/var/cache/sessions.db`  |
| database    | `/usr/local/bin/db_healthcheck`, `/opt/lib/libmysqlclient.so`, `/var/cache/query.db` |
| fileserver  | `/usr/local/bin/sync_agent`, `/opt/lib/libstorage.so`, `/var/cache/ftp_sessions.db`  |
| mailserver  | `/opt/app/mailstore.bin`, `/var/lib/mailindex.dat`, `/srv/cache/mbox.db`             |
| iot         | `/opt/app/firmware.bin`, `/var/lib/sensor.dat`, `/srv/cache/telemetry.db`            |
| workstation | `/usr/local/bin/monitor_agent`, `/opt/lib/libauth.so`, `/var/cache/user_sessions.db` |
| router      | `/usr/local/bin/fw_monitor`, `/opt/lib/libnetfilter.so`, `/var/cache/routing.db`     |

Binary exfiltrate targets use paths like `/opt/app/data.bin`, `/var/lib/export.dat`, `/srv/cache/records.db`.

### Implementation

- `src/generation/binary.ts` — `wrapInBinaryNoise(prng, content)` utility + path pools
- Binary wrapping adds an ELF header, non-printable noise between lines, and a noise footer
- Non-printable chars: Latin-1 supplement (128-255), control chars (1-8, 14-31), null bytes
- `strings` command's `isPrintable()` (ASCII 32-126 + tab + newline) filters these out
- Hints for binary placements mention `strings` (e.g., "try extracting strings from it")

## Forensics Objective

An 8th objective type where the player investigates a breach as an authorized incident responder. Instead of breaking in, they trace an attacker's path through log files to identify the attacker's handle and origin public IP. Seed keyword: `forensics`.

### Entry & Access

- Always SSH entry variant (forced override regardless of seed)
- Root credentials provided in the objective description (player is an authorized investigator)
- No Intel section needed — credentials are part of the job

### Evidence Generation

- Attacker handle picked from `clientHandles` pool (guaranteed different from mission client)
- Attacker public IP generated via `generatePublicIp`
- Pre-populated `/var/log/auth.log` entries on each machine in the attack path:
  - Failed login attempts (1-3) followed by successful login
  - Entry machine logs show the attacker's public IP
  - Deeper machines show the previous machine's internal IP
- Calling card file (`.{handle}`) placed in `/tmp/` on the deepest machine

### Proof & Verification

Player mails both the attacker handle and origin IP. Proof is split on `/[\s,:\-]+/` and verified order-independently:

```bash
mail client@darkmail.onion xR0gu3x:45.33.12.99
mail client@darkmail.onion "45.33.12.99 - xR0gu3x"
mail client@darkmail.onion "xR0gu3x, 45.33.12.99"
```

### Difficulty Scaling

- **Easy**: 2 machines — attacker public IP visible on entry machine auth.log
- **Medium**: 3 machines — one internal hop to trace back
- **Hard**: 4+ machines — multiple hops through internal network

## Port Closures

PRNG-driven SSH/FTP port closures increase lateral movement variety. At most one SSH and one FTP closure per network (independent ~30% rolls). When SSH is closed on a machine, FTP port 21 is ensured open so the player must use FTP file transfers instead of a shell.

### Rules

- ~30% chance to close one SSH port; ~30% chance to close one FTP port (independent rolls)
- ~15% chance of dual closure (both SSH and FTP closed) — adds NC backdoor with root owner
- **Entry machine**: never closed (protected)
- **Router**: never closed (infrastructure)
- **script_fix / script_auto objectives**: never close SSH (player needs `node <path>` shell access on target)
- **sabotage objective**: never close SSH (player needs shell access to `rm` boot files and `reboot`)
- **portforward objective**: never close SSH (player needs shell access through the network)
- **backdoor objective**: closures allowed — player can inject `nc -l <port>` via `script_exec` on the forced-effect port
- **Same-machine collision**: FTP closure skipped if it targets the same machine as SSH closure
- When SSH is closed, FTP port 21 is added/opened and a root-owned NC backdoor is guaranteed
- SSH-closed machines get `forcedEffect: { kind: 'script_exec', tier: 'root' }` on an open port so players can `msfconsole <target> <port> /script.js` to inject a script that restarts sshd

### PRNG Consumption

Always consumes 8 PRNG calls for sequence stability, even when no closures apply (e.g., script_fix or no eligible machines).

### Lateral Movement Impact

`getMethodForMachine` in `attackChain.ts` checks `hasSsh` before selecting SSH as a lateral movement method. When SSH is closed, the attack chain routes through FTP or HTTP instead.

## Network Modes (2)

| Mode         | Description                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forwarded    | Gateway NATs entry ports to the DMZ/entry machine. Player connects transparently.                                                                 |
| Router-first | No forwarding. Player must hack the gateway first, then pivot to internal network. Gateway filesystem contains SSH credentials for entry machine. |

Each layer independently rolls its forwarding mode. Border router thresholds: easy 70%, medium 50%, hard 0% (always router-first). Inner layer thresholds: easy 70%, medium 50%, hard 30%. This keeps hard missions challenging at the border while allowing variety in inner pivoting.

## Machine Roles (8)

| Role        | Default Ports              | Entry-eligible? | Notes                                                             |
| ----------- | -------------------------- | --------------- | ----------------------------------------------------------------- |
| webserver   | 22, 80, 443                | Yes             |                                                                   |
| database    | 22, 3306 (5432 closed)     | No              |                                                                   |
| fileserver  | 21, 22 (445 closed)        | No              |                                                                   |
| mailserver  | 22, 25, 143 (993 closed)   | No              |                                                                   |
| iot         | 22, 80, 1883 (8443 closed) | No              | Minimal BusyBox-style filesystem                                  |
| dns         | 22, 53/udp, 953            | No              | BIND zone files; AXFR probability: easy 80%, medium 60%, hard 40% |
| workstation | 22 (8080 closed)           | Yes             |                                                                   |
| router      | 22, 80 (8443 closed)       | No              | Infrastructure only, never target                                 |

Entry machines always use the entry port template instead of the role's default ports.
Router is always the border device between localhost and the mission network.

## Entry Port Templates (13)

| Variant | Ports               |
| ------- | ------------------- |
| SSH     | 22/ssh, 80/http     |
| FTP     | 21/ftp, 22/ssh      |
| NC      | 22/ssh, 4444/elite  |
| NC      | 22/ssh, 31337/elite |
| NC      | 22/ssh, 8888/elite  |
| NC      | 22/ssh, 1337/elite  |
| Exploit | 22/ssh, 80/http     |
| Exploit | 22/ssh, 3306/mysql  |
| Exploit | 22/ssh, 6379/redis  |
| Exploit | 22/ssh, 21/ftp      |
| Exploit | 22/ssh, 25/smtp     |
| Exploit | 22/ssh, 1883/mqtt   |
| HTTP    | 22/ssh, 80/http     |

## Router Entry Port Templates (12)

Used when a router/gateway is the entry point (router-first mode). Applies to both the outer border router and inner-layer gateways. In router-first mode, entry credential hints (web content for HTTP, NC hints, exploit vulnerabilities) are placed on the router's filesystem, not on the internal entry machine. This ensures `curl`, `nc`, `msfconsole`, etc. work against the router.

| Variant | Ports                         |
| ------- | ----------------------------- |
| SSH     | 22/ssh, 80/http               |
| FTP     | 21/ftp, 22/ssh                |
| NC      | 22/ssh, 4444/elite            |
| NC      | 22/ssh, 31337/elite           |
| NC      | 22/ssh, 8888/elite            |
| NC      | 22/ssh, 1337/elite            |
| Exploit | 22/ssh, 8443/https            |
| Exploit | 22/ssh, 80/http               |
| Exploit | 22/ssh, 8080/http-alt         |
| Exploit | 22/ssh, 1883/mqtt             |
| HTTP    | 22/ssh, 80/http               |
| SNMP    | 22/ssh (closed), 161/udp snmp |

## Exploit Vulnerabilities (36)

Used when entry variant is `exploit`. Matched by port/service. Multiple templates per service for variety.

| CVE            | Service             | Port  | Description                               |
| -------------- | ------------------- | ----- | ----------------------------------------- |
| CVE-2021-41773 | Apache/2.4.49       | 80    | Path traversal / RCE                      |
| CVE-2017-7679  | Apache/2.4.25       | 80    | mod_mime buffer overread / RCE            |
| CVE-2019-0211  | Apache/2.4.38       | 80    | Privilege escalation via scoreboard       |
| CVE-2021-23017 | nginx/1.20.0        | 80    | DNS resolver off-by-one heap write        |
| CVE-2012-2122  | MySQL 5.5.23        | 3306  | Auth bypass (memcmp timing)               |
| CVE-2016-6662  | MySQL 5.5.52        | 3306  | Remote root via config manipulation       |
| CVE-2021-27928 | MariaDB 10.5.8      | 3306  | wsrep provider RCE                        |
| CVE-2022-0543  | Redis 5.0.7         | 6379  | Lua sandbox escape / RCE                  |
| CVE-2015-4335  | Redis 2.8.19        | 6379  | Lua sandbox escape via eval               |
| CVE-2017-5638  | Struts/2.3.31       | 8080  | RCE via Content-Type                      |
| CVE-2021-44228 | Tomcat/9.0.40       | 8080  | Log4j2 JNDI RCE (Log4Shell)               |
| CVE-2015-1427  | Elasticsearch 1.4.2 | 9200  | Groovy sandbox bypass                     |
| CVE-2019-11510 | PulseSecure/9.0R1   | 8443  | Arbitrary file read (router VPN)          |
| CVE-2011-2523  | vsftpd 2.3.4        | 21    | Backdoor command execution                |
| CVE-2015-3306  | ProFTPD 1.3.5       | 21    | mod_copy unauthenticated file copy / RCE  |
| CVE-2019-12815 | ProFTPD 1.3.6       | 21    | mod_copy arbitrary file copy              |
| CVE-2019-10149 | Exim 4.87           | 25    | RCE (The Return of WIZard)                |
| CVE-2010-4344  | Exim 4.69           | 25    | Heap overflow RCE                         |
| CVE-2021-3156  | Postfix 3.4.8       | 25    | Heap overflow via MAIL FROM               |
| CVE-2019-11500 | Dovecot 2.3.7       | 143   | IMAP/POP3 buffer overflow                 |
| CVE-2023-3028  | Mosquitto 2.0.14    | 1883  | MQTT broker auth bypass                   |
| CVE-2017-7650  | Mosquitto 1.4.12    | 1883  | Pattern-based ACL bypass                  |
| CVE-2017-0144  | Samba 4.5.9         | 445   | SMB RCE (EternalBlue)                     |
| CVE-2019-9193  | PostgreSQL 9.3      | 5432  | COPY TO/FROM PROGRAM RCE                  |
| CVE-2023-5868  | PostgreSQL 13.10    | 5432  | Aggregate function memory disclosure      |
| CVE-2020-7921  | MongoDB 3.6.12      | 27017 | Auth bypass via crafted roleInfo          |
| CVE-2019-2390  | MongoDB 4.0.5       | 27017 | BSON deserialization RCE                  |
| CVE-2022-29154 | rsync 3.2.3         | 873   | Arbitrary file write via path bypass      |
| CVE-2024-12084 | rsync 3.2.7         | 873   | Heap buffer overflow via checksum parsing |
| CVE-2019-15681 | TightVNC 1.3.10     | 5900  | Heap buffer overflow / info leak          |
| CVE-2006-2369  | RealVNC 4.1.1       | 5900  | Auth bypass via null auth type            |
| CVE-2017-15130 | Dovecot 2.2.33      | 110   | POP3 DoS via crafted RETR                 |
| CVE-2019-3467  | Courier 0.75.0      | 110   | POP3 buffer overflow / priv esc           |
| CVE-2022-2003  | ModbusTCP 1.0       | 502   | Unauthenticated PLC register write        |
| CVE-2019-9560  | Modicon M340        | 502   | Unauthenticated admin access              |
| CVE-2017-12166 | OpenVPN 2.4.3       | 1194  | Buffer overflow in key-method negotiation |
| CVE-2020-15078 | OpenVPN 2.5.1       | 1194  | Auth bypass via deferred auth plugin      |

## Procedural CVE Timing

Beyond the 36 hand-authored CVEs above, the timeline walker (`src/generation/timeline/walker.ts`) produces procedural CVEs for any service/firmware version over game time. Each procedural CVE carries three randomized-but-deterministic timing fields:

| Field       | Range (days)                     | Source                          | Effect                                                                                                            |
| ----------- | -------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Safe window | 3–14 (minSafeWindowDays / max)   | `prng.nextInt`                  | Gap between one CVE publishing and the next for the same service. Drives the ~43 CVEs/year/service cadence.       |
| Patch delay | 1–2 (minPatchDelayDays / max)    | side-PRNG (`:patchDelay` keyed) | After a CVE drops, its fix waits this many days before `apt upgrade` can apply it. Players must defend meanwhile. |
| Bump type   | major 5% / minor 15% / patch 80% | `prng.nextInt(0,99)`            | Shape of the next version tuple. Over time produces Apache/2.4.60 → 2.4.72 → 2.5.0 → 3.0.0-style progressions.    |

Invariant: `minSafeWindowDays > maxPatchDelayDays` (asserted at module load) guarantees every released fix has a positive safe window before the next CVE.

Hand-authored CVEs (above) have no patch delay — they are immediately fixable by design (they anchor day-0 exploit variety).

## Objective Types (14)

| Type             | Description                                                    | Completion                             |
| ---------------- | -------------------------------------------------------------- | -------------------------------------- |
| exfiltrate       | Find ACCESS-KEY in target file, mail to client                 | `mail(email, "ACCESS-XXXX-XXXX-XXXX")` |
| tamper           | Modify a target file, mail client to confirm                   | `mail(email, "done")`                  |
| credential_theft | Discover root password, mail to client                         | `mail(email, "<password>")`            |
| script_fix       | Fix broken script, test with node(), confirm to client         | `mail(email, "done")`                  |
| script_auto      | Write automated script from scratch, test with node(), confirm | `mail(email, "done")`                  |
| sabotage         | Destroy target machine, confirm the kill                       | `mail(email, "done")`                  |
| backdoor         | Open nc listener on target machine, confirm                    | `mail(email, "done")`                  |
| portforward      | Hack the router and set up NAT port forwarding                 | `mail(email, "done")`                  |
| forensics        | Investigate breach, find attacker alias and origin IP          | `mail(email, "<alias> <ip>")`          |
| malware          | Find and neutralize active malware on compromised machine      | `mail(email, "done")`                  |
| db_exfiltrate    | SELECT ACCESS-KEY from database table, mail to client          | `mail(email, "ACCESS-XXXX-XXXX-XXXX")` |
| db_tamper        | UPDATE a record in the database, confirm to client             | `mail(email, "done")`                  |
| db_sabotage      | DROP TABLE or DELETE all rows from a database table            | `mail(email, "done")`                  |
| db_fix           | Fix corrupted database records (white-hat), confirm to client  | `mail(email, "done")`                  |

## Exfiltrate Target File Templates (21 — 3 per role)

Used for `exfiltrate` objectives. Contain `{{access_key}}` placeholder filled with `ACCESS-XXXX-XXXX-XXXX`.

### fileserver

| Path                                      | Content Style                |
| ----------------------------------------- | ---------------------------- |
| `/srv/records/patient_discharge_2024.csv` | ACCESS-KEY hidden in CSV row |
| `/srv/ftp/exports/financial_report.csv`   | ACCESS-KEY in financial CSV  |
| `/srv/backup/confidential_memo.txt`       | ACCESS-KEY as auth code      |

### database

| Path                                | Content Style                      |
| ----------------------------------- | ---------------------------------- |
| `/opt/mysql/dumps/users_backup.sql` | ACCESS-KEY in SQL INSERT statement |
| `/opt/db/exports/accounts.csv`      | ACCESS-KEY as access token         |
| `/opt/postgresql/audit_log.txt`     | ACCESS-KEY in audit log entry      |

### webserver

| Path                                      | Content Style                |
| ----------------------------------------- | ---------------------------- |
| `/srv/www/data/users.json`                | ACCESS-KEY as admin API key  |
| `/srv/www/private/admin_credentials.conf` | ACCESS-KEY as secret key     |
| `/srv/www/html/.htaccess_backup`          | ACCESS-KEY as recovery token |

### mailserver

| Path                                 | Content Style                      |
| ------------------------------------ | ---------------------------------- |
| `/var/mail/ceo`                      | ACCESS-KEY as auth token in email  |
| `/var/spool/mail/admin`              | ACCESS-KEY as wire transfer code   |
| `/srv/mail/archive/confidential.eml` | ACCESS-KEY as emergency access key |

### iot

| Path                            | Content Style                    |
| ------------------------------- | -------------------------------- |
| `/opt/firmware/config_dump.bin` | ACCESS-KEY as API key in config  |
| `/var/log/mqtt_export.csv`      | ACCESS-KEY in MQTT topic payload |
| `/tmp/device_backup.tar.log`    | ACCESS-KEY as master token       |

### workstation

| Path                                | Content Style                        |
| ----------------------------------- | ------------------------------------ |
| `/opt/projects/classified_memo.txt` | ACCESS-KEY as authorization override |
| `/opt/projects/internal_report.txt` | ACCESS-KEY in audit finding          |
| `/opt/local/secret_notes.txt`       | ACCESS-KEY as emergency access code  |

### router (infrastructure-only — unused in practice)

| Path                            | Content Style                      |
| ------------------------------- | ---------------------------------- |
| `/opt/router/access_log.txt`    | ACCESS-KEY as override code        |
| `/opt/router/vpn_keys.txt`      | ACCESS-KEY as VPN pre-shared key   |
| `/opt/router/backup_config.txt` | ACCESS-KEY in router backup config |

## Tamper File Templates (13 — 2 per main role + 1 for router)

Used for `tamper` objectives. Player must change `tamperOldValue` to `tamperNewValue` in the file.

| Role        | Path                                   | Change                                       |
| ----------- | -------------------------------------- | -------------------------------------------- |
| fileserver  | `/srv/records/patient_records.csv`     | "active" → "discharged"                      |
| fileserver  | `/srv/ftp/exports/employee_roster.csv` | "standard" → "executive"                     |
| database    | `/opt/mysql/dumps/students.sql`        | "F" → "A" (grade)                            |
| database    | `/opt/db/exports/accounts.csv`         | "frozen" → "active"                          |
| webserver   | `/srv/www/data/users.json`             | "readonly" → "admin" (role)                  |
| webserver   | `/srv/www/private/access_control.conf` | "restricted" → "privileged"                  |
| mailserver  | `/var/mail/hr`                         | "approved" → "denied" (termination)          |
| mailserver  | `/etc/aliases`                         | mail routing redirect                        |
| iot         | `/etc/config/device.conf`              | "armed" → "disarmed" (alarm)                 |
| iot         | `/etc/config/update.conf`              | firmware update URL redirect                 |
| workstation | `/opt/projects/payroll.csv`            | "$45,000" → "$145,000" (salary)              |
| workstation | `/opt/local/performance_review.txt`    | "needs_improvement" → "exceeds_expectations" |
| router      | `/opt/router/firewall_policy.conf`     | "DENY" → "ALLOW"                             |

## Credential Placement Templates (5)

Where next-hop credentials are hidden on the current machine.

| Path                           | Style                                    |
| ------------------------------ | ---------------------------------------- |
| `/var/log/auth.log`            | Login attempts with password in comment  |
| `/home/{{user}}/.bash_history` | Command history with password in comment |
| `/tmp/backup_credentials.txt`  | Plaintext credentials file               |
| `/home/{{user}}/notes.txt`     | Server access notes                      |
| `/etc/maintenance.conf`        | Config with embedded remote credentials  |

## HTTP Entry Credential Placement (6)

HTTP entry variant places SSH credentials in `/var/www/html/` on the entry machine, discoverable via `gobuster` + `curl`. Other entry variants (FTP/NC/exploit) do not place hint files — players use tools like `hydra` to crack credentials.

PRNG picks one template per mission. Files are root-owned (curl serves them since it reads as root, but a user who SSHs in cannot `cat` them locally). Only user-type credentials are leaked (not root, not guest).

### Body-based (credentials in file content, visible via `curl`)

| Web Path            | Content Style                               |
| ------------------- | ------------------------------------------- |
| `.env`              | App environment file with SSH_USER/SSH_PASS |
| `admin/config.json` | JSON config with SSH credentials object     |
| `api/health`        | Health endpoint with debug credentials      |

### Header-based (credentials in `.headers` sidecar, requires `curl -i`)

| Web Path           | Body Content           | Sidecar Header    |
| ------------------ | ---------------------- | ----------------- |
| `index.html`       | (existing page)        | `X-Debug-Token`   |
| `status`           | Plain text status page | `X-Session-Token` |
| `admin/debug.html` | HTML debug console     | `X-Internal-Auth` |

## Name Pools

### Usernames (5 per role, 35 total)

| Role        | Names                                           |
| ----------- | ----------------------------------------------- |
| webserver   | www-data, webadmin, apache, nginx, deploy       |
| database    | dbadmin, postgres, mysql, dba, dataops          |
| fileserver  | ftpuser, backup, storage, sysadmin, fileadm     |
| mailserver  | postmaster, mailadm, dovecot, smtp-svc, mailops |
| iot         | admin, device, iotuser, sensor, operator        |
| workstation | jsmith, admin, developer, analyst, operator     |
| router      | netops, routeadm, admin, fwadmin, operator      |

### Hostnames (5 per role, 35 total)

| Role        | Names                                                   |
| ----------- | ------------------------------------------------------- |
| webserver   | web01, web-prod, www, frontend, apache01                |
| database    | db-primary, db01, mysql-prod, postgres01, datastore     |
| fileserver  | files01, nas, backup-srv, storage01, ftp-main           |
| mailserver  | mail01, mx-primary, smtp-relay, postfix-srv, exchange01 |
| iot         | cam-01, thermostat, smart-lock, iot-hub, sensor-gw      |
| workstation | ws-admin, dev-box, ops-station, analyst-pc, jump-box    |
| router      | router01, gw-main, border-gw, core-rtr, firewall01      |

### Guest Passwords (7)

`guest`, `guest123`, `password`, `letmein`, `welcome`, `changeme`, `123456`

### Client Handles (10)

Used for `clientEmail` generation: `${handle}@darkmail.onion`

`xR0gu3x`, `gh0st_`, `cyph3rpunk`, `n3twr4ith`, `zer0day_`, `bl4ckh4t`, `silkr0ad`, `darkfl0w`, `v0id_agent`, `ph4nt0m`

### Mission Passwords (60)

Encoded in `src/secrets/__encoded.ts` — used for machine user passwords.

## Filler Content

### Noise Files (5)

`.bashrc`, `.bash_history`, `.vimrc`, `.profile`, `.ssh_known_hosts`

### Red Herring Files (4)

`notes.txt`, `old_passwords.txt`, `.env.bak`, `maintenance_log.txt`

### Log Templates (7) — Static Filler

Pre-generated filler content for `/var/log/` noise files during mission generation. These are **not** the dynamic connection logging system — see `src/logging/README.md` for the dynamic logging that records real player auth events.

sshd accepted, sshd failed, sshd closed, CRON, systemd started, kernel link up, sudo

### Config Templates (2 per role, 14 total)

Role-appropriate server configs (Apache/nginx, MySQL/Postgres, Samba/vsftpd, Postfix/Dovecot, BusyBox/MQTT, SSH/bashrc, iptables/interfaces).

## Hint Templates (5)

Each hint is paired with its credential placement template so the hint always describes the actual file where credentials were placed.

- Check auth.log on {{machine}} for login attempts → `/var/log/auth.log`
- User left credentials in their .bash_history on {{machine}} → `/home/{{localUser}}/.bash_history`
- A backup file in /tmp on {{machine}} contains plaintext passwords → `/tmp/backup_credentials.txt`
- Check {{localUser}}'s home directory on {{machine}} for notes → `/home/{{localUser}}/notes.txt`
- Look in /etc/maintenance.conf on {{machine}} for hardcoded credentials → `/etc/maintenance.conf`

### `.headers` Sidecar Convention

A file at `/var/www/html/page.html.headers` injects custom HTTP response headers when curl serves `/var/www/html/page.html`. Format: one `Key: Value` per line. The curl command reads these sidecar files transparently. Gobuster filters out `.headers` files from enumeration results.

Header names used: `X-Debug-Token`, `X-Session-Token`, `X-Internal-Auth`.

### Web Content Generation

Any machine with an open HTTP port gets `/var/www/html/` populated with:

- An `index.html` page from role-appropriate `webContentTemplates` pool
- HTTP entry machines additionally get credential files from `httpEntryCredentialTemplates`
- `.headers` sidecar files for header-based credential templates

<!--
## HTTP Lateral Movement (not yet implemented)

When the next-hop machine has port 80 open, the attack chain could select `http` as a lateral movement method (alongside existing SSH/FTP). Credentials would be placed in web-accessible files on the current machine, discoverable via `curl`.
-->

## Credential Leak Placement

Careless user credentials left in guest-readable locations. ~30% chance per machine (PRNG roll). Only leaks `user`-type account credentials (never root, never guest). Gives guest accounts a realistic path to privilege escalation — but not always.

### PRNG Consumption

Always consumes 2 PRNG calls per machine (1 roll + 1 template pick) for sequence stability, even when no leak is placed.

### Plaintext Templates (10)

| Path                               | Content Style                                            |
| ---------------------------------- | -------------------------------------------------------- |
| `/etc/maintenance.conf`            | Maintenance config with `user`/`pass` fields             |
| `/etc/crontab`                     | Cron job with `--user=` `--pass=` in command line        |
| `/srv/www/.env`                    | Laravel-style `DB_USERNAME`/`DB_PASSWORD` env vars       |
| `/var/www/config.php.bak`          | PHP config with `$db_user`/`$db_pass` variables          |
| `/tmp/.backup.sh`                  | Bash backup script with `REMOTE_USER`/`REMOTE_PASS`      |
| `/tmp/deploy.log`                  | Deploy log leaking credentials in connection string      |
| `/opt/app/config.ini`              | INI-style `[database]` section with `user`/`password`    |
| `/opt/app/settings.yml`            | YAML config with `username`/`password` under `database:` |
| `/srv/app/db.conf`                 | Key-value config with `USER`/`PASS`                      |
| `/opt/monitoring/check_service.sh` | Health check script with DB credentials                  |

### Binary Templates (3)

Wrapped in binary noise — `cat` shows garbled output, `strings` extracts credentials.

| Path                          | Content Style                                 |
| ----------------------------- | --------------------------------------------- |
| `/usr/local/bin/health_check` | Compiled monitoring tool with hardcoded creds |
| `/opt/lib/libauth.so`         | Shared library with embedded service creds    |
| `/var/cache/app.db`           | SQLite-style cache with credentials table     |

### Permissions

All credential leak files are guest-owned (world-readable), placed in system directories with `worldReadable` traversal. Guest can always discover and read them.

## SNMP Entry Variant

Router-first mode only. The router has all TCP ports filtered and SNMP (UDP 161) open. The player must discover SNMP via UDP scanning, enumerate the MIB tree to find credentials, and use SNMP SET to open the SSH firewall.

### Attack Chain

1. `nmap(routerIP)` — all TCP ports filtered (dead end)
2. `nmap("-sU", routerIP)` — discovers UDP 161 (snmp)
3. `apt("install", "snmp")` — installs `snmpwalk` and `snmpset` binaries
4. `snmpwalk(routerIP)` — public community shows basic system info (hostname, interfaces)
5. `snmpwalk(routerIP, rwCommunity)` — RW community reveals leaked SSH credentials in extend script args + firewall OIDs (`firewallSSH deny`)
6. `snmpset(routerIP, rwCommunity, "firewallSSH=permit")` — opens SSH through the firewall
7. `ssh(user, routerIP)` — connects with leaked credentials

### SNMP Config File

Router filesystem contains `/etc/snmp/snmpd.conf` with:

- `rocommunity public` — read-only community (always "public")
- `rwcommunity <string>` — read-write community (PRNG-picked from: `private`, `ADMIN`, `C1sc0`, `write`, `secret`)
- System OIDs: `sysDescr`, `sysName`, `sysContact`, `ifDescr`, `ifAddr`
- Extend scripts: `nsExtendArgs.backup --user <username> --pass <password>` (leaked credentials)
- Firewall OIDs: `firewallSSH deny`, `firewallHTTP deny`

### Dynamic Firewall State

`NetworkContext` reads SNMP firewall OIDs from `/etc/snmp/snmpd.conf` (same pattern as iptables rules). When `snmpset` changes `firewallSSH` from `deny` to `permit`, port 22 dynamically becomes open on the router. Parser: `src/network/snmpFirewallParser.ts`.

### Apt Multi-Binary Package

`apt("install", "snmp")` installs both `/usr/bin/snmpwalk` and `/usr/bin/snmpset`. The `AptPackageInfo` type supports a `binaries` field for packages that install multiple commands.

## Ideas for More Variety

_Uncomment and implement as needed._

<!-- ### New Machine Roles
- ci-server — ports 22/8080/443, users: jenkins, deploy
- monitoring — ports 22/9090/3000, users: grafana, alertops
-->

<!-- ### New Entry Variants
- curl — discover hidden API endpoint, POST to get SSH creds
- dns — zone transfer reveals internal hostnames + creds
-->

<!-- ### New Objective Types
- plant — write a specific file to a target location
- destroy — delete/corrupt a target file
- chain — multi-objective across several machines
-->

<!-- ### New Vulnerability Templates
- CVE-2014-6271 (Shellshock) — Bash RCE via CGI
- CVE-2019-0708 (BlueKeep) — RDP RCE
- CVE-2021-44228 (Log4Shell) — Log4j RCE
-->

<!-- ### New Target File Templates
- mail: /var/mail/spool/inbox.mbox, /srv/mail/archive.tar contents
- router: /etc/firewall/rules.conf, /opt/vpn/client.ovpn
-->
