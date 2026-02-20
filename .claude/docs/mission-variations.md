# Mission Variations

Comprehensive catalog of all procedural generation variation axes. Use this to track what exists and plan additions.

## Difficulty Tiers (3)

| Tier   | Machines | Hop Count     |
| ------ | -------- | ------------- |
| Easy   | 2        | 1             |
| Medium | 3–4      | up to 2       |
| Hard   | 4–6      | all non-entry |

## Entry Variants (4)

How the player gains initial access to the entry machine.

| Variant | Flow                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| SSH     | Direct SSH login (credentials shown in briefing)                                    |
| FTP     | Explore via FTP, find SSH credentials in a file                                     |
| NC      | Connect via netcat backdoor (port 4444), find SSH credentials                       |
| Exploit | `nmap -sV` → find vulnerable service → `exploit(host, port)` → find SSH credentials |

## Machine Roles (4)

| Role        | Default Ports          | Entry-eligible? |
| ----------- | ---------------------- | --------------- |
| webserver   | 22, 80, 443            | Yes             |
| database    | 22, 3306 (5432 closed) | No              |
| fileserver  | 21, 22 (445 closed)    | No              |
| workstation | 22 (8080 closed)       | Yes             |

Entry machines always use the entry port template instead of the role's default ports.

## Entry Port Templates (6)

| Variant | Ports              |
| ------- | ------------------ |
| SSH     | 22/ssh, 80/http    |
| FTP     | 21/ftp, 22/ssh     |
| NC      | 22/ssh, 4444/elite |
| Exploit | 22/ssh, 80/http    |
| Exploit | 22/ssh, 3306/mysql |
| Exploit | 22/ssh, 6379/redis |

## Exploit Vulnerabilities (5)

Used when entry variant is `exploit`. Matched by port/service.

| CVE            | Service             | Port | Description                 |
| -------------- | ------------------- | ---- | --------------------------- |
| CVE-2021-41773 | Apache/2.4.49       | 80   | Path traversal / RCE        |
| CVE-2012-2122  | MySQL 5.5.23        | 3306 | Auth bypass (memcmp timing) |
| CVE-2022-0543  | Redis 5.0.7         | 6379 | Lua sandbox escape / RCE    |
| CVE-2017-5638  | Struts/2.3.31       | 8080 | RCE via Content-Type        |
| CVE-2015-1427  | Elasticsearch 1.4.2 | 9200 | Groovy sandbox bypass       |

## Objective Types (3)

| Type       | Description                    |
| ---------- | ------------------------------ |
| exfiltrate | Steal data from target machine |
| tamper     | Modify a target file           |
| find_flag  | Locate a hidden flag           |

## Target File Templates (12 — 3 per role)

### fileserver

| Path                                      | Content Style              |
| ----------------------------------------- | -------------------------- |
| `/srv/records/patient_discharge_2024.csv` | Flag hidden in CSV row     |
| `/srv/ftp/exports/financial_report.csv`   | Flag in financial CSV      |
| `/srv/backup/confidential_memo.txt`       | Flag as authorization code |

### database

| Path                                | Content Style                |
| ----------------------------------- | ---------------------------- |
| `/opt/mysql/dumps/users_backup.sql` | Flag in SQL INSERT statement |
| `/opt/db/exports/accounts.csv`      | Flag as access token         |
| `/opt/postgresql/audit_log.txt`     | Flag in audit log entry      |

### webserver

| Path                                      | Content Style          |
| ----------------------------------------- | ---------------------- |
| `/srv/www/data/users.json`                | Flag as admin API key  |
| `/srv/www/private/admin_credentials.conf` | Flag as secret key     |
| `/srv/www/html/.htaccess_backup`          | Flag as recovery token |

### workstation

| Path                                | Content Style                  |
| ----------------------------------- | ------------------------------ |
| `/opt/projects/classified_memo.txt` | Flag as authorization override |
| `/opt/projects/internal_report.txt` | Flag in audit finding          |
| `/opt/local/secret_notes.txt`       | Flag as emergency access code  |

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

### Usernames (5 per role, 20 total)

| Role        | Names                                       |
| ----------- | ------------------------------------------- |
| webserver   | www-data, webadmin, apache, nginx, deploy   |
| database    | dbadmin, postgres, mysql, dba, dataops      |
| fileserver  | ftpuser, backup, storage, sysadmin, fileadm |
| workstation | jsmith, admin, developer, analyst, operator |

### Hostnames (5 per role, 20 total)

| Role        | Names                                                |
| ----------- | ---------------------------------------------------- |
| webserver   | web01, web-prod, www, frontend, apache01             |
| database    | db-primary, db01, mysql-prod, postgres01, datastore  |
| fileserver  | files01, nas, backup-srv, storage01, ftp-main        |
| workstation | ws-admin, dev-box, ops-station, analyst-pc, jump-box |

### Guest Passwords (6)

`guest`, `guest123`, `password`, `letmein`, `welcome`, `changeme`

### Mission Passwords (20)

Encoded in `src/secrets/__encoded.ts` — used for machine user passwords.

## Filler Content

### Noise Files (5)

`.bashrc`, `.bash_history`, `.vimrc`, `.profile`, `.ssh_known_hosts`

### Red Herring Files (4)

`notes.txt`, `old_passwords.txt`, `.env.bak`, `maintenance_log.txt`

### Log Templates (7)

sshd accepted, sshd failed, sshd closed, CRON, systemd started, kernel link up, sudo

### Config Templates (2 per role, 8 total)

Role-appropriate server configs (Apache/nginx, MySQL/Postgres, Samba/vsftpd, SSH/bashrc).

## Hint Templates (5)

Used in attack chain step hints:

- Check auth.log for login attempts
- Look in service config for hardcoded credentials
- User left credentials in bash_history
- Backup file contains plaintext passwords
- Check user's home directory for notes

## Board Missions (5 hardcoded)

| Seed              | Client         | Difficulty |
| ----------------- | -------------- | ---------- |
| MEDTECH-4A7F-easy | xR0gu3x        | Easy       |
| WFIELD-9C2E       | null_entity    | Medium     |
| HCPD-3B1D-hard    | d4rk_m4tter    | Hard       |
| NOVA-7E2A-easy    | z3r0_c00l      | Easy       |
| BKRDG-5F9D-hard   | gh0st_pr0t0c0l | Hard       |

Players can also use any arbitrary seed string via `accept("any-string")`.

---

## Ideas for More Variety

_Uncomment and implement as needed._

<!-- ### New Machine Roles
- mail — ports 22/25/143/993, users: postmaster, mailadm
- router — ports 22/80/8443, users: netops, routeadm
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
