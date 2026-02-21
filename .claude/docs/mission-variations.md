# Mission Variations

Comprehensive catalog of all procedural generation variation axes. Use this to track what exists and plan additions.

## Difficulty Tiers (3)

| Tier   | Internal Machines | Router | Hop Count     | Network Mode                        |
| ------ | ----------------- | ------ | ------------- | ----------------------------------- |
| Easy   | 2                 | 1      | 1             | 70% forwarded, 30% router-first     |
| Medium | 3–4               | 1      | up to 2       | 50% forwarded, 50% router-first     |
| Hard   | 4–6               | 1      | all non-entry | Always router-first (no forwarding) |

## Entry Variants (4)

How the player gains initial access to the entry machine.

| Variant | Flow                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| SSH     | Direct SSH login (credentials shown in briefing)                                    |
| FTP     | Explore via FTP, find SSH credentials in a file                                     |
| NC      | Connect via netcat backdoor (port 4444), find SSH credentials                       |
| Exploit | `nmap -sV` → find vulnerable service → `exploit(host, port)` → find SSH credentials |

## Network Modes (2)

| Mode         | Description                                                                       |
| ------------ | --------------------------------------------------------------------------------- |
| Forwarded    | Router NATs entry ports to the DMZ/entry machine. Player connects transparently.  |
| Router-first | No forwarding. Player must hack the router first, then pivot to internal network. |

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

## Entry Port Templates (6)

| Variant | Ports              |
| ------- | ------------------ |
| SSH     | 22/ssh, 80/http    |
| FTP     | 21/ftp, 22/ssh     |
| NC      | 22/ssh, 4444/elite |
| Exploit | 22/ssh, 80/http    |
| Exploit | 22/ssh, 3306/mysql |
| Exploit | 22/ssh, 6379/redis |

## Router Entry Port Templates (2)

Used when the router itself is the entry point (router-first mode).

| Variant | Ports              |
| ------- | ------------------ |
| SSH     | 22/ssh, 80/http    |
| Exploit | 22/ssh, 8443/https |

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

## Objective Types (3)

| Type             | Description                                    | Completion                             |
| ---------------- | ---------------------------------------------- | -------------------------------------- |
| exfiltrate       | Find ACCESS-KEY in target file, mail to client | `mail(email, "ACCESS-XXXX-XXXX-XXXX")` |
| tamper           | Modify a target file, mail client to confirm   | `mail(email, "done")`                  |
| credential_theft | Discover root password, mail to client         | `mail(email, "<password>")`            |

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

Used by FTP/NC/exploit variants to place SSH credentials on the entry machine.

| FTP Path                         | NC/Exploit Path                  | Style                      |
| -------------------------------- | -------------------------------- | -------------------------- |
| `/home/{{user}}/.ssh_backup`     | `/home/{{owner}}/ssh_backup.txt` | SSH credentials backup     |
| `/home/{{user}}/notes.txt`       | `/home/{{owner}}/notes.txt`      | Server notes with creds    |
| `/home/{{user}}/credentials.bak` | `/home/{{owner}}/.credentials`   | Auto-generated credentials |

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

## Board Missions (1 hardcoded, more to be added with e2e tests)

| Seed              | Client  | Difficulty |
| ----------------- | ------- | ---------- |
| MEDTECH-4A7F-easy | xR0gu3x | Easy       |

Players can also use any arbitrary seed string via `accept("any-string")`.

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
