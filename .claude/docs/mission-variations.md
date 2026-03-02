# Mission Variations

Comprehensive catalog of all procedural generation variation axes. Use this to track what exists and plan additions.

## Seed Keywords

All six major generation axes can be controlled by embedding keywords in the seed string (case-insensitive, matched via `includes()`). `parseSeedOverrides(seed)` in `generateMission.ts` extracts overrides. PRNG sequence is preserved — calls are consumed but results discarded in favor of overrides.

| Axis          | Keywords                                                 | Notes                                                     |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Difficulty    | `easy`, `medium`, `hard`                                 | Falls back to hash-based derivation without keyword       |
| Entry variant | `ssh`, `ftp`, `nc`, `exploit`, `http`                    | Falls back if template unavailable (e.g. nc+router-first) |
| Network mode  | `forwarded`, `router-first`                              | Hyphenated to avoid false matches                         |
| Objective     | `exfiltrate`, `tamper`, `credential-theft`, `script-fix` | Hyphen variant for credential_theft / script_fix          |
| Domain entry  | `domain`                                                 | Forces domain-based briefing (nslookup required)          |
| Encryption    | `decrypt`                                                | Forces exfiltrate + encrypted target file                 |

Example seeds: `HEIST-ssh-forwarded-tamper-hard`, `BANK-JOB-nc-exfiltrate`, `test-exploit-router-first`

## Difficulty Tiers (3)

| Tier   | Internal Machines | Router | Hop Count     | Network Mode                        |
| ------ | ----------------- | ------ | ------------- | ----------------------------------- |
| Easy   | 2                 | 1      | 1             | 70% forwarded, 30% router-first     |
| Medium | 3–4               | 1      | up to 2       | 50% forwarded, 50% router-first     |
| Hard   | 4–6               | 1      | all non-entry | Always router-first (no forwarding) |

## Entry Variants (5)

How the player gains initial access to the entry machine.

| Variant | Flow                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| SSH     | Direct SSH login as regular user (credentials shown in briefing)                    |
| FTP     | Explore via FTP, find SSH credentials in a file                                     |
| NC      | Connect via netcat backdoor (port 4444), find SSH credentials                       |
| Exploit | `nmap -sV` → find vulnerable service → `exploit(host, port)` → find SSH credentials |
| HTTP    | `nmap` → discover port 80 → `curl` to explore web content → find SSH credentials    |

## FTP/NC/Exploit Owner Types (3)

Owner type for FTP, NC backdoor, and exploit port owners varies per seed, adding difficulty variety. The FTP login user, NC shell user, and exploit shell user are all determined by the port owner.

| Type  | Weight | Effect                                                   |
| ----- | ------ | -------------------------------------------------------- |
| guest | 60%    | Limited file visibility, must find SSH creds             |
| user  | 30%    | Hint files in owner's home dir, accessible to that user  |
| root  | 10%    | Can read root-owned files, easiest to find what's needed |

Root owners have hints placed in `/tmp/` instead of `/home/root/` (since root's home is `/root/`, not managed by `generateHomeContent`).

## Domain Entry Mode

When domain entry is active, the mission briefing shows the router's `.mission` domain instead of its public IP, forcing the player to use `nslookup()` to discover the target IP before connecting.

| Difficulty | PRNG Chance (no keyword) |
| ---------- | ------------------------ |
| Easy       | 30%                      |
| Medium     | 50%                      |
| Hard       | 70%                      |

With the `domain` seed keyword, domain entry is always active. Without it, PRNG decides based on difficulty. Domain mode appends "Resolve the target domain first" to the intel hint but still shows variant-specific intel. SSH variant with credentials shown omits the `ssh()` command (player must nslookup to find IP first).

## Briefing Intel Variation

The mission briefing includes an `Intel:` section with variant-specific hints. No command names appear — hints use natural language so the player must figure out which tools to use.

| Variant | Intel Text                                                                         |
| ------- | ---------------------------------------------------------------------------------- |
| SSH     | ~50% shows credentials + `ssh()` command; ~50% hints at default credentials        |
| FTP     | "Our recon shows an FTP service running on the target."                            |
| NC      | "Our scanner picked up a suspicious backdoor service. Run a port scan to find it." |
| Exploit | "The target is running outdated software with known vulnerabilities."              |
| HTTP    | "There's a web server running on the target."                                      |

### SSH Credential Reveal (`briefingRevealsCredentials`)

A PRNG-determined boolean (~50/50) on `MissionNetwork` controls whether the SSH variant briefing shows credentials. Only affects SSH variant — other variants never reveal credentials.

| Value | Briefing Behavior                                                            |
| ----- | ---------------------------------------------------------------------------- |
| true  | Shows username, password, and `ssh()` command (or just creds in domain mode) |
| false | "Our intel suggests default credentials may still be active"                 |

When credentials are hidden, the player must guess from the `guestPasswords` pool (guest, guest123, password, letmein, welcome, changeme). Entry machines always have a guest account.

## Encrypted Exfiltrate

Exfiltrate objectives have a ~25% chance (or 100% with `decrypt` keyword) of encrypting the target file. The decryption key (64-char hex) is placed on a different machine in the attack path. Players must find the key and use `decrypt(file, key)` as root to reveal the ACCESS-KEY. Encryption uses deterministic XOR+FNV-1a checksum (`src/utils/crypto.ts`). Key files under `/home/` are user-owned (readable without root); key files in system paths (`/root/`, `/etc/`, `/var/`, `/opt/`) are root-owned.

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

A 4th objective type where the player finds a broken JavaScript script on the target machine, fixes it with `nano()`, and runs it with `node()`. The script computes a checksum from its filtered data and passes it to `_decode(checksum)` — a function only available inside `node()`'s execution context. If the checksum is correct (script was properly fixed), `_decode()` returns the ACCESS-KEY. The player then mails it to the client (consistent with exfiltrate flow). The ACCESS-KEY never appears in the script source (anti-cheat). Seed keyword: `script-fix`.

### Bug Types (3, ~33% each)

| Type      | Description                                                         |
| --------- | ------------------------------------------------------------------- |
| syntax    | Missing paren, quote, or brace — script throws a SyntaxError        |
| logic     | Wrong comparison value or filter condition — script outputs "ERROR" |
| corrupted | Data line replaced with `???` — correct value in a nearby hint file |

### Script Ownership

| Owner | Chance | Effect                                                           |
| ----- | ------ | ---------------------------------------------------------------- |
| user  | 60%    | Anyone can read/write/execute — no privilege escalation needed   |
| root  | 40%    | Anyone can read, but only root can write/execute — must su first |

### Script Fix Templates (8 + 2 router)

2 templates per main role (fileserver, database, webserver, workstation) + 2 for router (unused).

Each template is a short script that filters/counts array data and conditionally calls `echo(_decode(<checksum-expr>))` on success. `_decode(checksum)` is injected into `node()`'s execution context only during script_fix missions — it compares the checksum against the expected value and returns the ACCESS-KEY on match (or an error string otherwise). Each template has an `expectedChecksum` field. Bug variants introduce syntax errors, logic errors, or corrupted data lines. Corrupted variants have a hint file at a nearby path on the same machine containing the correct value.

### Key Design Decisions

- No binary wrapping (scripts must be readable/editable with nano)
- No encryption (scripts must be directly editable)
- Dummy PRNG rolls consumed for binary + encrypt to preserve sequence alignment
- Corrupted hints placed on same target machine (not a different machine)
- `_decode(checksum)` returns ACCESS-KEY on correct checksum — player mails it to client
- ACCESS-KEY never appears in script source (anti-cheat: can't `cat` to find it)
- `_decode()` only exists in `node()`'s execution context, not the terminal

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
| workstation | `/usr/local/bin/monitor_agent`, `/opt/lib/libauth.so`, `/var/cache/user_sessions.db` |
| router      | `/usr/local/bin/fw_monitor`, `/opt/lib/libnetfilter.so`, `/var/cache/routing.db`     |

Binary exfiltrate targets use paths like `/opt/app/data.bin`, `/var/lib/export.dat`, `/srv/cache/records.db`.

### Implementation

- `src/generation/binary.ts` — `wrapInBinaryNoise(prng, content)` utility + path pools
- Binary wrapping adds an ELF header, non-printable noise between lines, and a noise footer
- Non-printable chars: Latin-1 supplement (128-255), control chars (1-8, 14-31), null bytes
- `strings` command's `isPrintable()` (ASCII 32-126 + tab + newline) filters these out
- Hints for binary placements mention `strings` (e.g., "try extracting strings from it")

## Network Modes (2)

| Mode         | Description                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Forwarded    | Router NATs entry ports to the DMZ/entry machine. Player connects transparently.                                                                |
| Router-first | No forwarding. Player must hack the router first, then pivot to internal network. Router filesystem contains SSH credentials for entry machine. |

## Machine Roles (5)

| Role        | Default Ports          | Entry-eligible? | Notes                             |
| ----------- | ---------------------- | --------------- | --------------------------------- |
| webserver   | 22, 80, 443            | Yes             |                                   |
| database    | 22, 3306 (5432 closed) | No              |                                   |
| fileserver  | 21, 22 (445 closed)    | No              |                                   |
| workstation | 22 (8080 closed)       | Yes             |                                   |
| router      | 22, 80 (8443 closed)   | No              | Infrastructure only, never target |

Entry machines always use the entry port template instead of the role's default ports.
Router is always the border device between localhost and the mission network.

## Entry Port Templates (10)

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
| HTTP    | 22/ssh, 80/http     |

## Router Entry Port Templates (3)

Used when the router itself is the entry point (router-first mode). In router-first mode, entry credential hints (web content for HTTP, NC hints, exploit vulnerabilities) are placed on the router's filesystem, not on the internal entry machine. This ensures `curl`, `nc`, `exploit`, etc. work against the router.

| Variant | Ports              |
| ------- | ------------------ |
| SSH     | 22/ssh, 80/http    |
| Exploit | 22/ssh, 8443/https |
| HTTP    | 22/ssh, 80/http    |

## Exploit Vulnerabilities (6)

Used when entry variant is `exploit`. Matched by port/service.

| CVE            | Service             | Port | Description                      |
| -------------- | ------------------- | ---- | -------------------------------- |
| CVE-2021-41773 | Apache/2.4.49       | 80   | Path traversal / RCE             |
| CVE-2012-2122  | MySQL 5.5.23        | 3306 | Auth bypass (memcmp timing)      |
| CVE-2022-0543  | Redis 5.0.7         | 6379 | Lua sandbox escape / RCE         |
| CVE-2017-5638  | Struts/2.3.31       | 8080 | RCE via Content-Type             |
| CVE-2015-1427  | Elasticsearch 1.4.2 | 9200 | Groovy sandbox bypass            |
| CVE-2019-11510 | PulseSecure/9.0R1   | 8443 | Arbitrary file read (router VPN) |

## Objective Types (4)

| Type             | Description                                         | Completion                             |
| ---------------- | --------------------------------------------------- | -------------------------------------- |
| exfiltrate       | Find ACCESS-KEY in target file, mail to client      | `mail(email, "ACCESS-XXXX-XXXX-XXXX")` |
| tamper           | Modify a target file, mail client to confirm        | `mail(email, "done")`                  |
| credential_theft | Discover root password, mail to client              | `mail(email, "<password>")`            |
| script_fix       | Fix broken script, run with node(), mail ACCESS-KEY | `mail(email, "ACCESS-XXXX-XXXX-XXXX")` |

## Exfiltrate Target File Templates (15 — 3 per role)

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

## Tamper File Templates (9 — 2 per main role + 1 for router)

Used for `tamper` objectives. Player must change `tamperOldValue` to `tamperNewValue` in the file.

| Role        | Path                                   | Change                                       |
| ----------- | -------------------------------------- | -------------------------------------------- |
| fileserver  | `/srv/records/patient_records.csv`     | "active" → "discharged"                      |
| fileserver  | `/srv/ftp/exports/employee_roster.csv` | "standard" → "executive"                     |
| database    | `/opt/mysql/dumps/students.sql`        | "F" → "A" (grade)                            |
| database    | `/opt/db/exports/accounts.csv`         | "frozen" → "active"                          |
| webserver   | `/srv/www/data/users.json`             | "readonly" → "admin" (role)                  |
| webserver   | `/srv/www/private/access_control.conf` | "restricted" → "privileged"                  |
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

## Entry Credential Hint Templates (3)

Used by FTP/NC/exploit/HTTP variants to place SSH credentials on the entry machine.

| FTP Path                          | NC/Exploit Path                  | HTTP Path                        | Style                      |
| --------------------------------- | -------------------------------- | -------------------------------- | -------------------------- |
| `/home/{{owner}}/.ssh_backup`     | `/home/{{owner}}/ssh_backup.txt` | `/var/www/html/status` (header)  | SSH credentials backup     |
| `/home/{{owner}}/notes.txt`       | `/home/{{owner}}/notes.txt`      | `/var/www/html/admin/debug.html` | Server notes with creds    |
| `/home/{{owner}}/credentials.bak` | `/home/{{owner}}/.credentials`   | `/var/www/html/.env` (header)    | Auto-generated credentials |

HTTP entry variant places credentials either in the page body or in a `.headers` sidecar file (visible via `curl -i`). The `httpInHeader` flag on each template controls the placement: header-based secrets require `curl -i` to discover, while body-based secrets are visible with regular `curl`.

## Name Pools

### Usernames (5 per role, 25 total)

| Role        | Names                                       |
| ----------- | ------------------------------------------- |
| webserver   | www-data, webadmin, apache, nginx, deploy   |
| database    | dbadmin, postgres, mysql, dba, dataops      |
| fileserver  | ftpuser, backup, storage, sysadmin, fileadm |
| workstation | jsmith, admin, developer, analyst, operator |
| router      | netops, routeadm, admin, fwadmin, operator  |

### Hostnames (5 per role, 25 total)

| Role        | Names                                                |
| ----------- | ---------------------------------------------------- |
| webserver   | web01, web-prod, www, frontend, apache01             |
| database    | db-primary, db01, mysql-prod, postgres01, datastore  |
| fileserver  | files01, nas, backup-srv, storage01, ftp-main        |
| workstation | ws-admin, dev-box, ops-station, analyst-pc, jump-box |
| router      | router01, gw-main, border-gw, core-rtr, firewall01   |

### Guest Passwords (6)

`guest`, `guest123`, `password`, `letmein`, `welcome`, `changeme`

### Client Handles (10)

Used for `clientEmail` generation: `${handle}@darkmail.onion`

`xR0gu3x`, `gh0st_`, `cyph3rpunk`, `n3twr4ith`, `zer0day_`, `bl4ckh4t`, `silkr0ad`, `darkfl0w`, `v0id_agent`, `ph4nt0m`

### Mission Passwords (20)

Encoded in `src/secrets/__encoded.ts` — used for machine user passwords.

## Filler Content

### Noise Files (5)

`.bashrc`, `.bash_history`, `.vimrc`, `.profile`, `.ssh_known_hosts`

### Red Herring Files (4)

`notes.txt`, `old_passwords.txt`, `.env.bak`, `maintenance_log.txt`

### Log Templates (7)

sshd accepted, sshd failed, sshd closed, CRON, systemd started, kernel link up, sudo

### Config Templates (2 per role, 10 total)

Role-appropriate server configs (Apache/nginx, MySQL/Postgres, Samba/vsftpd, SSH/bashrc, iptables/interfaces).

## Hint Templates (5)

Each hint is paired with its credential placement template so the hint always describes the actual file where credentials were placed.

- Check auth.log on {{machine}} for login attempts → `/var/log/auth.log`
- User left credentials in their .bash_history on {{machine}} → `/home/{{localUser}}/.bash_history`
- A backup file in /tmp on {{machine}} contains plaintext passwords → `/tmp/backup_credentials.txt`
- Check {{localUser}}'s home directory on {{machine}} for notes → `/home/{{localUser}}/notes.txt`
- Look in /etc/maintenance.conf on {{machine}} for hardcoded credentials → `/etc/maintenance.conf`

## HTTP Lateral Movement

When the next-hop machine has port 80 open, the attack chain can select `http` as the lateral movement method (alongside existing SSH/FTP). Credentials are placed in web-accessible files on the current machine, discoverable via `curl`. PRNG picks between HTTP and other available methods (FTP, SSH).

### HTTP Credential Placement Templates (4)

| Path                              | Secret Location | Hint                                                     |
| --------------------------------- | --------------- | -------------------------------------------------------- |
| `/var/www/html/admin/config.json` | Header sidecar  | "The webserver may be leaking credentials — try curl -i" |
| `/var/www/html/status`            | Page body       | "Check the status page with curl"                        |
| `/var/www/html/.env`              | Header sidecar  | "The .env file is web-accessible — try curl -i"          |
| `/var/www/html/api/health`        | Page body       | "The API has a health endpoint — try curl"               |

### `.headers` Sidecar Convention

A file at `/var/www/html/page.html.headers` injects custom HTTP response headers when curl serves `/var/www/html/page.html`. Format: one `Key: Value` per line. The curl command reads these sidecar files transparently.

Secret header names: `X-Api-Key`, `X-Session-Token`, `Authorization`, `X-Internal-Auth`, `X-Access-Token`.

### Web Content Generation

Webserver-role machines (and any machine with web credential placements) get `/var/www/html/` populated with:

- An `index.html` page from `webContentTemplates` pool
- Credential placement files at their designated web paths
- `.headers` sidecar files for header-based secrets

## Board Missions (9)

9 curated missions covering all generation axes. Players can also use any arbitrary seed string via `accept("any-string")`.

| #   | Client     | Target                               | Objective        | Difficulty | Entry   | Mode         | Special | Seed                                                    |
| --- | ---------- | ------------------------------------ | ---------------- | ---------- | ------- | ------------ | ------- | ------------------------------------------------------- |
| 001 | xR0gu3x    | MedTech Solutions — hospital records | exfiltrate       | Easy       | SSH     | Forwarded    | —       | `MEDTECH-ssh-easy-forwarded-exfiltrate`                 |
| 002 | gh0st\_    | Eastwood University — registrar DB   | tamper           | Easy       | FTP     | Forwarded    | —       | `EASTWOOD-ftp-easy-forwarded-tamper`                    |
| 003 | cyph3rpunk | Nexus Corp — employee workstations   | credential_theft | Easy       | HTTP    | Forwarded    | —       | `NEXUS-http-easy-forwarded-credential-theft`            |
| 004 | n3twr4ith  | Vanguard Finance — trading platform  | exfiltrate       | Medium     | NC      | Forwarded    | —       | `VANGUARD-nc-medium-forwarded-exfiltrate`               |
| 005 | zer0day\_  | Sentinel Defense — weapons research  | tamper           | Medium     | Exploit | Router-first | —       | `SENTINEL-exploit-medium-router-first-tamper`           |
| 006 | bl4ckh4t   | OmniCloud Services — backup systems  | script_fix       | Medium     | SSH     | Forwarded    | Domain  | `OMNICLOUD-ssh-medium-forwarded-script-fix-domain`      |
| 007 | darkfl0w   | Iron Gate Security — vault server    | exfiltrate       | Hard       | Exploit | Router-first | Decrypt | `IRONGATE-exploit-hard-router-first-exfiltrate-decrypt` |
| 008 | v0id_agent | Cobalt Industries — R&D network      | credential_theft | Hard       | NC      | Router-first | —       | `COBALT-nc-hard-router-first-credential-theft`          |
| 009 | ph4nt0m    | Axiom Biotech — gene sequencer       | script_fix       | Hard       | HTTP    | Router-first | —       | `AXIOM-http-hard-router-first-script-fix`               |

**Coverage**: 3 easy / 3 medium / 3 hard, SSH×2 / FTP×1 / NC×2 / Exploit×2 / HTTP×2, exfiltrate×3 / tamper×2 / credential_theft×2 / script_fix×2, forwarded×5 / router-first×4, 1 domain, 1 decrypt.

---

## Ideas for More Variety

_Uncomment and implement as needed._

<!-- ### New Machine Roles
- mail — ports 22/25/143/993, users: postmaster, mailadm
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
