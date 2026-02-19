# CTF Flag Redesign

Complete redesign of the flag system for JSHACK.ME — a cohesive CTF experience where each flag teaches a skill, hints at the next challenge, and requires progressively advanced techniques.

---

## Design Principles

1. **Every command matters** — Each available command should be needed at some point during the CTF
2. **Natural progression** — Each flag hints at the next, creating a guided but not hand-held experience
3. **Skill building** — Early flags teach commands used in later, harder challenges
4. **Multiple connection methods** — Players must use SSH, FTP, NC, and curl at different stages
5. **Escalation paths** — Guest → user → root progression on machines
6. **Multi-step puzzles** — Advanced flags require combining variables, decrypt, strings, output

---

## Command Restrictions by User Type

**New feature**: Commands are tiered by user type. When a player connects to a machine as guest, they only have basic navigation. Escalating to user or root unlocks more powerful tools.

| Tier         | User Type | Commands                                                                                       |
| ------------ | --------- | ---------------------------------------------------------------------------------------------- |
| **Basic**    | `guest`   | help, man, echo, whoami, pwd, ls, cd, cat, su, clear, author                                   |
| **Standard** | `user`    | All basic + ifconfig, ping, nmap, nslookup, ssh, ftp, nc, curl, strings, output, resolve, exit |
| **Full**     | `root`    | All standard + decrypt                                                                         |

**Rationale**:

- **Guests** can only look around and escalate (su) — they're intruders with minimal tools
- **Users** have network and analysis tools — they can explore, connect, and inspect
- **Root** has decrypt — the most powerful tool, requiring full access to use
- `su` is available to guests so they can escalate
- `exit` is available to users (need it to leave SSH sessions)

**When a restricted command is called**: Show an error like `permission denied: 'nmap' requires user privileges` — this teaches the player they need to escalate.

---

## `/etc/passwd` Permissions

| Machine         | Readable by | Rationale                                                                         |
| --------------- | ----------- | --------------------------------------------------------------------------------- |
| **localhost**   | root, user  | Player starts as user; can read passwd to learn the mechanic                      |
| **All remotes** | root only   | Forces players to find credentials through other means (logs, configs, web pages) |

On remote machines, players must discover credentials through:

- Log files that leak usernames/passwords
- Config files with hardcoded credentials
- Web pages that expose user info
- Hints from other machines

---

## Network Topology

Network is **per-machine** — each machine sees its own interfaces, reachable machines, and DNS.

```
198.51.100.0/24 (Internet)
│
├── 198.51.100.10 ─── gateway eth0 (WAN)
│                     gateway eth1 (LAN) ─── 192.168.1.1
│                                             │
│                                        192.168.1.0/24 (Local LAN)
│                                             ├── 192.168.1.50  fileserver — FTP, SSH
│                                             ├── 192.168.1.75  webserver — SSH, HTTP, MySQL, backdoor:4444
│                                             └── 192.168.1.100 localhost — Player's machine
│
└── 203.0.113.42 ─── darknet eth0 (Public) — SSH, HTTP-ALT:8080, backdoor:31337
                      darknet eth1 ─── 10.66.66.100
                                        │
                                   10.66.66.0/24 (Hidden Network)
                                        ├── 10.66.66.1  shadow — FTP, SSH
                                        ├── 10.66.66.2  void — SSH, maintenance:9999
                                        └── 10.66.66.3  abyss — SSH only
```

**Reachability:** LAN machines reach each other + darknet. Darknet sees gateway WAN + hidden network only. Hidden machines see each other + darknet eth1 only.

---

## Machine Users

| Machine        | Username | Type  | Password      | How player discovers password                                |
| -------------- | -------- | ----- | ------------- | ------------------------------------------------------------ |
| **localhost**  | jshacker | user  | h4ckth3pl4n3t | Player starts as this user                                   |
| **localhost**  | root     | root  | sup3rus3r     | Crack from /etc/passwd (readable by user on localhost)       |
| **localhost**  | guest    | guest | guestpass     | Not needed for progression                                   |
| **gateway**    | guest    | guest | guest2024     | Hinted in localhost `/var/log/auth.log`                      |
| **gateway**    | admin    | root  | n3tgu4rd!     | Found in gateway auth.log (readable by guest)                |
| **fileserver** | guest    | guest | anonymous     | Classic FTP default, hinted on gateway admin page            |
| **fileserver** | ftpuser  | user  | tr4nsf3r      | Hinted on gateway admin page or web content                  |
| **fileserver** | root     | root  | b4ckup2024    | Found in config file after escalating to ftpuser             |
| **webserver**  | guest    | guest | w3lcome       | Hinted in fileserver backup notes                            |
| **webserver**  | www-data | user  | d3v0ps2024    | Found in webserver `/var/log/access.log` (readable by guest) |
| **webserver**  | root     | root  | r00tW3b!      | Found in database backup or web config                       |
| **darknet**    | guest    | guest | sh4d0w        | Found via webserver backdoor (nc) output                     |
| **darknet**    | ghost    | user  | sp3ctr3       | Found via darknet web page or API response                   |
| **darknet**    | root     | root  | d4rkn3tR00t   | Requires decrypting a file                                   |
| **shadow**     | operator | user  | c0ntr0l_pl4n3 | Hidden network (skeleton)                                    |
| **shadow**     | root     | root  | sh4d0w_r00t   | Hidden network (skeleton)                                    |
| **shadow**     | guest    | guest | demo          | Hidden network (skeleton)                                    |
| **void**       | dbadmin  | user  | dr0p_t4bl3s   | Hidden network (skeleton)                                    |
| **void**       | root     | root  | v01d_null     | Hidden network (skeleton)                                    |
| **void**       | guest    | guest | demo          | Hidden network (skeleton)                                    |
| **abyss**      | phantom  | user  | sp3ctr4l      | Hidden network (skeleton)                                    |
| **abyss**      | root     | root  | d33p_d4rk     | Hidden network (skeleton)                                    |
| **abyss**      | guest    | guest | demo          | Hidden network (skeleton)                                    |

---

## Flag Progression

### Overview

| #   | Flag                          | Machine       | Difficulty   | Key Skills                       |
| --- | ----------------------------- | ------------- | ------------ | -------------------------------- |
| 1   | FLAG{welcome_hacker}          | localhost     | Beginner     | ls, cat                          |
| 2   | FLAG{hidden_in_plain_sight}   | localhost     | Beginner     | ls (with -a flag)                |
| 3   | FLAG{root_access_granted}     | localhost     | Beginner     | cat /etc/passwd, su              |
| 4   | FLAG{network_explorer}        | network       | Intermediate | ifconfig, ping, nmap, curl       |
| 5   | FLAG{gateway_breach}          | gateway       | Intermediate | ssh (as guest), su, cat          |
| 6   | FLAG{admin_panel_exposed}     | gateway       | Intermediate | curl (with -i), cat              |
| 7   | FLAG{file_transfer_pro}       | fileserver    | Intermediate | ftp, get, ls                     |
| 8   | FLAG{binary_secrets_revealed} | webserver     | Advanced     | ssh, strings, output, variables  |
| 9   | FLAG{decrypted_intel}         | cross-machine | Advanced     | decrypt, variables (key from #8) |
| 10  | FLAG{backdoor_found}          | webserver     | Advanced     | nmap, nc                         |
| 11  | FLAG{darknet_discovered}      | darknet       | Expert       | nslookup, curl                   |
| 12  | FLAG{master_of_the_darknet}   | darknet       | Expert       | ssh/nc, su, decrypt (multi-step) |
| 13  | FLAG{code_the_decoder}        | darknet       | Bonus        | nano, node, JavaScript (ROT13)   |
| 14  | FLAG{shadow_debugger}         | shadow        | Intermediate | ftp recon, nano, node, JS debug  |
| 15  | FLAG{void_data_miner}         | void          | Advanced     | nc recon, nano, node, cat()      |
| 16  | FLAG{abyss_decryptor}         | abyss         | Expert       | ssh, nano, node, XOR cipher      |

---

### Detailed Flag Walkthrough

#### FLAG 1: `FLAG{welcome_hacker}` — First Steps

**Machine**: localhost | **Difficulty**: Beginner | **User**: jshacker (user)

**Skills taught**: `ls`, `cat` — basic file navigation

**Setup**:

- File: `/home/jshacker/README.txt`
- Permissions: readable by user

**Content**:

```
=== WELCOME TO JSHACK.ME ===

You are jshacker, a security researcher.
Your mission: investigate this network and uncover its secrets.

Start by exploring. Use ls() to list files, cd() to move around,
and cat() to read files.

FLAG{welcome_hacker}

Hint: Real hackers know that not all files are visible...
Try ls(".", "-a") to see hidden files.
```

**Leads to**: Flag 2 (hidden files)

---

#### FLAG 2: `FLAG{hidden_in_plain_sight}` — Hidden Files

**Machine**: localhost | **Difficulty**: Beginner | **User**: jshacker (user)

**Skills taught**: `ls` with `-a` flag — discovering hidden files

**Setup**:

- File: `/home/jshacker/.mission`
- Permissions: readable by user

**Content**:

```
MISSION BRIEFING
================
This network has been compromised. Multiple machines are running
suspicious services. Your job is to investigate.

FLAG{hidden_in_plain_sight}

NEXT STEPS:
1. Check /etc/passwd to see who else is on this machine
2. The root account holds secrets. Can you crack the password?
   Hint: Use su("root") after figuring out the password.
```

**Leads to**: Flag 3 (root escalation)

---

#### FLAG 3: `FLAG{root_access_granted}` — Root Access

**Machine**: localhost | **Difficulty**: Beginner | **User**: jshacker → root

**Skills taught**: Reading `/etc/passwd`, cracking MD5 hashes, `su`

**Setup**:

- `/etc/passwd` is readable by user on localhost (contains MD5 hashes)
- Root password `toor` has MD5 hash — player must recognize/crack it
- File: `/root/flag.txt` — readable only by root

**How to solve**:

1. `cat("/etc/passwd")` — see root's MD5 hash
2. Recognize the hash or crack it (common password "toor")
3. `su("root")` → enter password "toor"
4. `cat("/root/flag.txt")`

**Content** of `/root/flag.txt`:

```
FLAG{root_access_granted}

Now you have full control of this machine.
Try exploring the network:
  ifconfig() — see your network interface
  ping("192.168.1.1") — test connectivity
  nmap("192.168.1.0/24") — scan for machines
```

**Leads to**: Flag 4 (network discovery)

---

#### FLAG 4: `FLAG{network_explorer}` — Network Recon

**Machine**: network/gateway | **Difficulty**: Intermediate | **User**: jshacker (user) or root

**Skills taught**: `ifconfig`, `ping`, `nmap`, `curl`

**Setup**:

- Gateway web page (`/var/www/html/index.html`) contains the flag
- Accessible via `curl("192.168.1.1")`

**How to solve**:

1. `ifconfig()` — see IP 192.168.1.100, gateway 192.168.1.1
2. `ping("192.168.1.1")` — gateway responds
3. `nmap("192.168.1.0/24")` — discover all machines and open ports
4. Notice gateway has port 80 (http) open
5. `curl("192.168.1.1")` — get the web page

**Content** of gateway `/var/www/html/index.html`:

```html
<h1>NetGuard Router v3.2.1</h1>
<p>Administration portal</p>
<p>Authorized personnel only.</p>
<!-- FLAG{network_explorer} -->
<!-- Admin panel: /admin.html (restricted) -->
<!-- Default credentials may still be in the system logs -->
```

**Leads to**: Flag 5 (gateway SSH) — hint about credentials in logs

**Also needed**: A hint on localhost about the gateway guest password. Add to `/var/log/auth.log` on localhost:

```
[info] Auto-configured gateway access: guest/guest (default credentials)
```

---

#### FLAG 5: `FLAG{gateway_breach}` — Gateway Breach

**Machine**: gateway | **Difficulty**: Intermediate | **User**: guest → admin (root)

**Skills taught**: `ssh` as guest, navigating with limited commands, `su` escalation

**Setup**:

- SSH into gateway as guest (password: "guest", hinted in localhost logs)
- As guest: only basic commands (ls, cd, cat, su, etc.)
- A world-readable config or log file leaks admin credentials
- File: `/var/log/auth.log` on gateway — readable by guest
- Flag: `/root/flag.txt` — readable only by root

**How to solve**:

1. `ssh("guest", "192.168.1.1")` → password "guest"
2. As guest, explore: `ls("/var/log")`, `cat("/var/log/auth.log")`
3. Log contains: `[warning] Failed login attempt for admin with password 'admin' from 192.168.1.100`
4. `su("admin")` → password "admin"
5. `cat("/root/flag.txt")`

**Content** of gateway `/root/flag.txt`:

```
FLAG{gateway_breach}

The admin panel at /var/www/html/admin.html contains
network configuration details. Check it out.

Also noticed unusual FTP traffic to 192.168.1.50.
Credentials might be the defaults: guest/guest
```

**Leads to**: Flag 6 (admin panel) + Flag 7 (fileserver)

---

#### FLAG 6: `FLAG{admin_panel_exposed}` — Admin Panel

**Machine**: gateway | **Difficulty**: Intermediate | **User**: admin (root) on gateway

**Skills taught**: `curl` with `-i` flag, or reading files as root

**Setup**:

- File: `/var/www/html/admin.html` — readable only by root
- Accessible via `cat` as root on gateway, or `curl("192.168.1.1/admin.html", "-i")` from localhost as root

**Content** of `/var/www/html/admin.html`:

```html
<h1>NetGuard Admin Panel</h1>
<h2>Network Configuration</h2>
<table>
  <tr>
    <td>Gateway</td>
    <td>192.168.1.1</td>
  </tr>
  <tr>
    <td>File Server</td>
    <td>192.168.1.50</td>
  </tr>
  <tr>
    <td>Web Server</td>
    <td>192.168.1.75</td>
  </tr>
  <tr>
    <td>External</td>
    <td>203.0.113.42 (darknet.ctf)</td>
  </tr>
</table>
<!-- FLAG{admin_panel_exposed} -->
<!-- Maintenance note: webserver guest account uses default password -->
```

**Leads to**: Flag 7 (fileserver) — confirms network layout and darknet existence

---

#### FLAG 7: `FLAG{file_transfer_pro}` — File Transfer

**Machine**: fileserver | **Difficulty**: Intermediate | **User**: guest → ftpuser (user)

**Skills taught**: `ftp`, FTP commands (ls, cd, get), file transfer workflow

**Setup**:

- FTP into fileserver as guest (password: "guest", hinted in gateway flag)
- As guest on FTP: can list and navigate
- Find hint about ftpuser in a readable directory
- Download a file containing the flag

**How to solve**:

1. `ftp("192.168.1.50")` → username "guest", password "anonymous"
2. FTP mode: navigate to `/srv/ftp/public` → `ls()` → see `readme.txt`
3. `get("readme.txt")` → download hint file
4. `cd("/srv/ftp/uploads")` → `ls("-a")` → find `.backup_notes.txt` (hidden file)
5. `get(".backup_notes.txt")` → download flag file
6. `quit()` → back on localhost
7. `cat("readme.txt")` → hints about ftpuser credentials
8. `cat(".backup_notes.txt")` → contains the flag

**Content** of `.backup_notes.txt`:

```
Backup rotation schedule — DO NOT SHARE

FLAG{file_transfer_pro}

Note: Encrypted backup stored on webserver at /var/www/backups/
Encryption key was split — part 1 is in the webserver binary at /opt/tools/scanner
The key file will be needed for decryption.

Webserver SSH accepts default guest credentials.
```

**Leads to**: Flag 8 (binary analysis on webserver) + Flag 9 (decryption)

---

#### FLAG 8: `FLAG{binary_secrets_revealed}` — Binary Analysis

**Machine**: webserver | **Difficulty**: Advanced | **User**: guest → www-data (user)

**Skills taught**: `strings`, `output`, variables (`const`/`let`)

**Setup**:

- SSH into webserver as guest (password: "guest", hinted in admin panel + backup notes)
- As guest: limited commands, can navigate but not use `strings`
- Need to escalate to user (www-data) to use `strings`
- A readable log hints at www-data credentials
- Binary at `/opt/tools/scanner` — readable by user
- Binary contains flag + half of a decryption key

**How to solve**:

1. `ssh("guest", "192.168.1.75")` → password "guest"
2. As guest, explore: `cat("/var/log/access.log")` (readable by guest)
3. Log contains: `[auth] www-data authenticated from console (webmaster)`
4. `su("www-data")` → password "webmaster"
5. Now has user commands: `strings("/opt/tools/scanner")`
6. Output includes flag and key fragment
7. `const scannerOutput = output(strings, "/opt/tools/scanner")` — store result

**Content** embedded in binary (visible via strings):

```
FLAG{binary_secrets_revealed}
DECRYPT_KEY_PART1=a1b2c3d4e5f6
See /var/www/backups/ for the encrypted file.
The second half of the key is in /srv/ftp/config/ on the fileserver.
```

**Leads to**: Flag 9 (decryption) — player now has half a key and knows where to look

---

#### FLAG 9: `FLAG{decrypted_intel}` — Decryption Challenge

**Machine**: cross-machine | **Difficulty**: Advanced | **User**: root (for decrypt command)

**Skills taught**: `decrypt`, variables, cross-machine problem solving, `resolve`

**Setup**:

- Encrypted file on webserver: `/var/www/backups/encrypted_intel.enc` (readable by user)
- Key part 1: from binary analysis (Flag 8)
- Key part 2: on fileserver `/srv/ftp/config/.key_fragment` (readable by user via FTP)
- Full key: concatenation of both parts (64-char hex string)
- `decrypt` requires root — player must be root on current machine

**How to solve**:

1. FTP into fileserver, navigate to `/srv/ftp/config`, `ls("-a")` → find `.key_fragment`
2. `get(".key_fragment")` → download to local machine
3. `quit()` → back on localhost
4. `cat(".key_fragment")` → `DECRYPT_KEY_PART2=ea2d996cb180258ec89c0000b42db460`
5. Combine with part 1: `const key = "76e2e21d...b42db460"` (64 hex chars)
6. SSH into webserver, escalate to root (for decrypt command)
7. `resolve(decrypt("/var/www/backups/encrypted_intel.enc", key))`

**Decrypted content**:

```
FLAG{decrypted_intel}

INTELLIGENCE REPORT:
The webserver at 192.168.1.75 has a backdoor running on port 4444.
It was installed by www-data. Use nc to connect.

There is also an external server at darknet.ctf.
Use nslookup("darknet.ctf") to resolve its IP address.
Its web service runs on port 8080.
```

**Leads to**: Flag 10 (backdoor) + Flag 11 (darknet)

---

#### FLAG 10: `FLAG{backdoor_found}` — Backdoor Access

**Machine**: webserver | **Difficulty**: Advanced | **User**: via nc (www-data)

**Skills taught**: `nc`, backdoor ports, exploring via limited shell

**Setup**:

- Port 4444 on webserver is the backdoor (already visible from nmap)
- NC connects as www-data (the service owner)
- NC mode has limited commands: pwd, cd, ls, cat, whoami, help, exit
- Flag hidden in a directory only accessible through backdoor

**How to solve**:

1. `nmap("192.168.1.75")` — confirms port 4444 (elite) is open
2. `nc("192.168.1.75", 4444)` — connects to backdoor as www-data
3. Explore: `ls("/opt")` → find hidden service directory
4. `cat("/opt/tools/.backdoor_log")` — contains the flag

**Content**:

```
FLAG{backdoor_found}

Backdoor installed by ghost@203.0.113.42
Connection log shows darknet.ctf:31337 as C2 server
Access requires: guest/guest then escalate
The darknet web portal at port 8080 has login information.
```

**Leads to**: Flag 11 (darknet web recon)

---

#### FLAG 11: `FLAG{darknet_discovered}` — Darknet Recon

**Machine**: darknet | **Difficulty**: Expert | **User**: from localhost

**Skills taught**: `nslookup`, `curl` with custom port, API exploration

**Setup**:

- `nslookup("darknet.ctf")` → resolves to 203.0.113.42
- `curl("darknet.ctf:8080")` → darknet web portal
- API endpoint reveals credentials and flag

**How to solve**:

1. `nslookup("darknet.ctf")` — resolves to 203.0.113.42
2. `curl("203.0.113.42:8080")` — darknet portal page
3. Page mentions an API: `/api/secrets`
4. `curl("203.0.113.42:8080/api/secrets")` — requires user-level knowledge
5. Response contains flag and ghost credentials

**Content** of darknet `/var/www/html/index.html` (port 8080):

```html
<pre>
 ____    _    ____  _  ___   _ _____ _____
|  _ \  / \  |  _ \| |/ / \ | | ____|_   _|
| | | |/ _ \ | |_) | ' /|  \| |  _|   | |
| |_| / ___ \|  _ <| . \| |\  | |___  | |
|____/_/   \_\_| \_\_|\_\_| \_|_____| |_|

Welcome to the darknet. You shouldn't be here.

FLAG{darknet_discovered}

API endpoint: /api/secrets
Ghost in the machine: ghost/fun123
Backdoor service running on port 31337.
</pre>
```

**Leads to**: Flag 12 (final flag)

---

#### FLAG 12: `FLAG{master_of_the_darknet}` — Final Flag

**Machine**: darknet | **Difficulty**: Expert | **User**: guest → ghost → root

**Skills taught**: Full chain — SSH/NC, multi-level escalation, decrypt

**Setup**:

- Connect to darknet via SSH as guest or NC on port 31337
- Escalate guest → ghost (user) using credentials from Flag 11
- As ghost (user), find encrypted final flag in `/home/ghost/`
- Find decryption key by reading API secrets or exploring
- Escalate to root to use decrypt
- Root password for darknet must be discovered (hidden in a config file readable by ghost)

**How to solve**:

1. `ssh("guest", "203.0.113.42")` → password "guest"
   OR `nc("203.0.113.42", 31337)` → connects as ghost directly
2. If SSH as guest: `su("ghost")` → password "fun123" (from Flag 11)
3. As ghost: `ls("/home/ghost", "-a")` → find `.encrypted_flag.enc` and `.notes`
4. `cat("/home/ghost/.notes")` → contains key hint: "Key is in /etc/shadow... but you need root"
5. Find root password: `cat("/var/log/auth.log")` as ghost → log leaks root password attempt: `[error] root login with password 'password' from 10.0.0.1`
   OR find it in a config file readable by ghost
6. `su("root")` → password "password"
7. Now has decrypt command
8. Find decryption key: `cat("/etc/shadow")` or a key file in `/root/`
9. `const key = "..."` (from key file)
10. `resolve(decrypt("/home/ghost/.encrypted_flag.enc", key))`

**Decrypted content**:

```
FLAG{master_of_the_darknet}

Congratulations! You've completed the JSHACK.ME CTF.
You've mastered: file navigation, privilege escalation,
network scanning, remote access, binary analysis,
cryptography, and backdoor exploitation.

Type author() to learn about the creator of this challenge.
```

---

## Commands Used Per Flag

Ensures every command is needed:

| Command       | Used in Flags               | Role                      |
| ------------- | --------------------------- | ------------------------- |
| `help`        | Any (discovery)             | Lists available commands  |
| `man`         | Any (learning)              | Command documentation     |
| `echo`        | Any (utility)               | Output values             |
| `clear`       | Any (utility)               | Clear screen              |
| `author`      | Post-game                   | Creator info              |
| `ls`          | 1, 2, 5, 7, 8, 10, 12       | Directory exploration     |
| `cd`          | 5, 7, 8, 10, 12             | Navigation                |
| `cat`         | 1, 2, 3, 4, 5, 6, 8, 10, 12 | Reading files             |
| `pwd`         | Any (orientation)           | Current location          |
| `whoami`      | Any (identity check)        | Current user              |
| `su`          | 3, 5, 8, 12, 14, 15, 16     | Privilege escalation      |
| `ifconfig`    | 4                           | Network discovery         |
| `ping`        | 4                           | Connectivity test         |
| `nmap`        | 4, 10                       | Port scanning             |
| `nslookup`    | 11                          | DNS resolution            |
| `curl`        | 4, 6, 11                    | Web content retrieval     |
| `ssh`         | 5, 8, 12, 14, 15, 16        | Remote shell access       |
| `ftp`         | 7, 9, 14                    | File transfer / recon     |
| `nc`          | 10, 12 (alt), 15            | Backdoor access / recon   |
| `strings`     | 8                           | Binary analysis           |
| `output`      | 8                           | Capture command output    |
| `resolve`     | 9, 12                       | Unwrap async results      |
| `decrypt`     | 9, 12                       | Decrypt files (root only) |
| `exit`        | 5, 7, 8, 10, 12, 14, 15, 16 | Return from remote        |
| `const`/`let` | 8, 9, 12                    | Store values in variables |
| `nano`        | 13, 14, 15, 16              | Edit/create files         |
| `node`        | 13, 14, 15, 16              | Execute JavaScript files  |

---

## Escalation Paths Summary

```
localhost (start as user "jshacker")
├── Read /etc/passwd → crack root hash → su to root
│
├── gateway (SSH as guest)
│   └── Read logs → find admin password → su to admin (root)
│
├── fileserver (FTP as guest → ftpuser)
│   └── FTP get files → download key fragments
│
├── webserver (SSH as guest)
│   ├── Read logs → find www-data password → su to www-data (user)
│   │   └── Use strings on binary → find key + flag
│   └── NC on port 4444 → backdoor as www-data
│
└── darknet (SSH as guest or NC on 31337)
    ├── su to ghost (user) → find encrypted flag
    ├── Read logs → find root password → su to root → decrypt
    ├── /root/.hidden_network → guest/demo for hidden network
    │
    ├── shadow (SSH as guest)
    │   └── Read logs → find operator password → su to operator → debug script (nano+node)
    │
    ├── void (SSH as guest)
    │   └── Read logs → find dbadmin password → su to dbadmin → extract data (nano+node)
    │
    └── abyss (SSH as guest)
        └── Read logs → find phantom password → su to phantom → XOR decode (nano+node)
```

---

## Root-Only Directories

Additional directories that require root access, providing incentive for escalation:

| Directory           | Machine            | Contains                                                                |
| ------------------- | ------------------ | ----------------------------------------------------------------------- |
| `/root/`            | All machines       | Flags, key files, config                                                |
| `/etc/passwd`       | All remotes        | User list with MD5 hashes (root-only on remotes)                        |
| `/etc/shadow`       | Optional           | Alternative to passwd restriction                                       |
| `/opt/tools/`       | webserver          | Binary with hidden data (user-readable, but strings requires user type) |
| `/var/www/backups/` | webserver          | Encrypted files                                                         |
| `/var/log/auth.log` | gateway, webserver | Could restrict to root on some machines                                 |

---

## Implementation Checklist

### Phase 1: Command Restrictions

- [x] Add user type checking to command registration in `useCommands.ts`
- [x] Define command tiers (guest/user/root) as a configuration
- [x] Show permission error when restricted command is called
- [x] ~~Update `useFtpCommands.ts` and `useNcCommands.ts` for consistency~~ — Not needed, FTP/NC modes bypass restrictions (separate command sets)
- [x] Add tests for command restrictions

### Phase 2: Filesystem Changes

- [x] Update `/etc/passwd` permissions (root-only on remotes, root+user on localhost)
- [x] Remove all existing flags from `machineFileSystems.ts`
- [x] Add new flag files for all 12 flags
- [x] Add hint files (logs, configs, notes) that guide progression
- [x] Add encrypted files for decrypt challenges
- [x] Add binary file(s) for strings challenges
- [x] Update `/var/log/` files with credential-leaking logs
- [x] Add `/opt/tools/` directory to webserver

### Phase 3: Web Content

- [x] Redesign gateway web pages (index.html, admin.html)
- [x] Redesign darknet web pages (index.html, API responses)
- [x] Update webserver API content
- [x] Ensure curl returns correct content for each endpoint

### Phase 4: Testing & Polish

- [x] Update all affected tests
- [x] Playtest the full progression start to finish
- [x] Verify no dead ends (every flag is reachable)
- [x] Verify hints are clear enough without being too obvious
- [x] Update documentation (README, CLAUDE.md)

### Phase 5: Filesystem Noise

- [x] Localhost: /etc (hostname, hosts, crontab), ~/.bash_history, ~/.bashrc, ~/downloads/ (cheatsheet, todo)
- [x] Localhost: /var/log/syslog
- [x] Gateway: /etc (hostname, hosts, iptables.rules), guest ~/.bash_history
- [x] Gateway: /var/log/firewall.log, /var/www/html/robots.txt, /var/www/html/css/style.css
- [x] Fileserver: /etc (hostname, vsftpd.conf), /var/log/syslog
- [x] Fileserver: FTP noise (CHANGELOG.txt, meeting_notes, tmp_data.csv)
- [x] Webserver: /etc (hostname, apache2/apache2.conf, mysql/my.cnf)
- [x] Webserver: /var/log/mysql.log, web noise (robots.txt, .htaccess, style.css), backup_manifest.txt
- [x] Darknet: /etc (hostname, hosts with .onion entries)
- [x] Darknet: ghost (bash_history, tools/port_scanner.py, tools/README.md), root .bash_history, cron.log
- [x] Verified no noise file contains FLAG{} pattern

### Phase 6: Bonus Flags

- [x] Flag 13 — Code the Decoder (ROT13 in darknet `/home/ghost/projects/`)

### Phase 7: Hidden Network Flags (FTP/NC recon + nano + node challenges)

- [x] Update `initialNetwork.ts`: add FTP port to shadow ~~, add NC port 9999 to void (with dbadmin owner)~~
- [x] Add darknet hint file `/root/.hidden_network` (lists services per machine)
- [x] Flag 14 — Shadow (FTP recon + nano+node):
  - [x] Expand `shadow.ts`: /srv/ftp/exports/ (system_report.txt with creds), diagnostics/, auth.log, noise
  - [x] Add tests in `shadow.test.ts`
- [x] Flag 15 — Void (NC recon + nano+node):
  - [x] Expand `void.ts`: recovery/ with 5 CSV tables, .abyss_notes (phantom creds), auth.log, noise
  - [x] Add tests in `void.test.ts`
- [x] Flag 16 — Abyss (SSH only, creds from void):
  - [x] Expand `abyss.ts`: vault/ with cipher docs + payload, auth.log (no password leak), noise
  - [x] Add tests in `abyss.test.ts`
- [x] Update docs (CLAUDE.md, README.md, CTF_DESIGN.md, WIP.md)
- [x] Playtest full chain: Playwright E2E test plays through all 16 flags automatically

---

## Verified Playtest — Solutions Guide

Complete walkthrough verified against the actual filesystem and command implementations.

### Summary Table

| #   | Flag                            | Machine    | Path / Method                           | Access Required                                     |
| --- | ------------------------------- | ---------- | --------------------------------------- | --------------------------------------------------- |
| 1   | `FLAG{welcome_hacker}`          | localhost  | `/home/jshacker/README.txt`             | `ls`, `cat` as user                                 |
| 2   | `FLAG{hidden_in_plain_sight}`   | localhost  | `/home/jshacker/.mission`               | `ls -a`, `cat` as user                              |
| 3   | `FLAG{root_access_granted}`     | localhost  | `/root/flag.txt`                        | Crack passwd hash, `su root`                        |
| 4   | `FLAG{network_explorer}`        | gateway    | `curl("192.168.1.1")` HTML comment      | `ifconfig`, `nmap`, `curl`                          |
| 5   | `FLAG{gateway_breach}`          | gateway    | `/root/flag.txt`                        | SSH as guest, `su admin`                            |
| 6   | `FLAG{admin_panel_exposed}`     | gateway    | `/var/www/html/admin.html` HTML comment | `cat` as admin or `curl`                            |
| 7   | `FLAG{file_transfer_pro}`       | fileserver | `/srv/ftp/uploads/.backup_notes.txt`    | FTP as ftpuser, `ls -a`, `get`                      |
| 8   | `FLAG{binary_secrets_revealed}` | webserver  | `/opt/tools/scanner`                    | SSH, `su www-data`, `strings`                       |
| 9   | `FLAG{decrypted_intel}`         | webserver  | `/var/www/backups/encrypted_intel.enc`  | `su root`, `decrypt` with split key                 |
| 10  | `FLAG{backdoor_found}`          | webserver  | `/opt/tools/.backdoor_log`              | `nc` port 4444, `ls -a`, `cat`                      |
| 11  | `FLAG{darknet_discovered}`      | darknet    | `curl("http://203.0.113.42:8080")`      | `nslookup`, `curl` with port                        |
| 12  | `FLAG{master_of_the_darknet}`   | darknet    | `/home/ghost/.encrypted_flag.enc`       | SSH, `su root`, `decrypt`                           |
| 13  | `FLAG{code_the_decoder}`        | darknet    | `/home/ghost/projects/` (ROT13)         | `nano`, `node` as ghost                             |
| 14  | `FLAG{shadow_debugger}`         | shadow     | `/home/operator/diagnostics/` (debug)   | FTP recon, SSH as operator, `nano`, `node`          |
| 15  | `FLAG{void_data_miner}`         | void       | `/home/dbadmin/recovery/` (CSV extract) | NC recon:9999, SSH, `su dbadmin`, `nano`, `node`    |
| 16  | `FLAG{abyss_decryptor}`         | abyss      | `/home/phantom/vault/` (XOR cipher)     | SSH, `su phantom` (creds from void), `nano`, `node` |

### Step-by-Step Walkthrough

#### FLAG 1 — `welcome_hacker` (Beginner)

```javascript
// Start as jshacker@localhost
ls(); // See README.txt
cat('README.txt'); // FLAG{welcome_hacker}
// Hint: "Try ls('.', '-a') to see hidden files"
```

#### FLAG 2 — `hidden_in_plain_sight` (Beginner)

```javascript
ls('.', '-a'); // See .mission
cat('.mission'); // FLAG{hidden_in_plain_sight}
// Hint: "Check /etc/passwd... Use su('root')"
```

#### FLAG 3 — `root_access_granted` (Beginner)

```javascript
cat('/etc/passwd'); // See root hash: a0ff67e77425eb3cea40ecb60941aea4
// Crack hash → "sup3rus3r" (use online MD5 lookup)
su('root'); // Enter: sup3rus3r
cat('/root/flag.txt'); // FLAG{root_access_granted}
// Hint: "ifconfig(), ping(), nmap()"
```

#### FLAG 4 — `network_explorer` (Intermediate)

```javascript
// Credential: localhost /var/log/auth.log → "guest/guest2024" for gateway
cat('/var/log/auth.log'); // "Auto-configured gateway access: guest/guest2024"
ifconfig(); // See gateway 192.168.1.1
nmap('192.168.1.1-254'); // Discover all machines + open ports
curl('192.168.1.1'); // HTML contains <!-- FLAG{network_explorer} -->
// Hint: "Admin panel: /admin.html" + "credentials in system logs"
```

#### FLAG 5 — `gateway_breach` (Intermediate)

```javascript
ssh('guest', '192.168.1.1'); // Enter: guest2024
// Now guest@gateway — basic commands only
cat('/var/log/auth.log'); // "pam_audit: admin authenticated with password 'n3tgu4rd!'"
su('admin'); // Enter: n3tgu4rd!
cat('/root/flag.txt'); // FLAG{gateway_breach}
// Hint: "admin panel at /var/www/html/admin.html" + "FTP to 192.168.1.50"
```

#### FLAG 6 — `admin_panel_exposed` (Intermediate)

```javascript
// As admin@gateway:
cat('/var/www/html/admin.html'); // <!-- FLAG{admin_panel_exposed} -->
// OR from localhost: curl("192.168.1.1/admin.html")
// Hint: network table shows all machines + "webserver guest uses default password"
// Also: /root/.network_config has fileserver creds: guest/anonymous, ftpuser/tr4nsf3r
//   and webserver creds: guest/w3lcome
```

#### FLAG 7 — `file_transfer_pro` (Intermediate)

```javascript
exit(); // Return to localhost
ftp('192.168.1.50'); // Login as guest / anonymous
// FTP starts at /home/guest — navigate to FTP directory
cd('/srv/ftp/public');
ls(); // See readme.txt
get('readme.txt'); // Download hint file
cd('/srv/ftp/uploads');
ls('-a'); // See .backup_notes.txt
get('.backup_notes.txt'); // Download flag file
quit();
cat('readme.txt'); // "ftpuser — read/write (password: tr4nsf3r)"
cat('.backup_notes.txt'); // FLAG{file_transfer_pro}
// Hint: "Encrypted backup on webserver /var/www/backups/"
//   "Key split — part 1 in /opt/tools/scanner"
//   "Webserver SSH accepts default guest credentials"
```

#### FLAG 8 — `binary_secrets_revealed` (Advanced)

```javascript
ssh('guest', '192.168.1.75'); // Enter: w3lcome
// guest@webserver — basic commands only, can't use strings
cat('/var/log/error.log'); // "www-data console login: password 'd3v0ps2024'"
su('www-data'); // Enter: d3v0ps2024
// Now www-data (user) — has strings command
strings('/opt/tools/scanner'); // Shows:
//   FLAG{binary_secrets_revealed}
//   DECRYPT_KEY_PART1=76e2e21dacea215ff2293e4eafc5985c
//   "See /var/www/backups/ for the encrypted file."
//   "The second half of the key is in /srv/ftp/config/ on the fileserver."
```

#### FLAG 9 — `decrypted_intel` (Advanced)

```javascript
// Key part 2: get from fileserver FTP
exit(); // Return to localhost
ftp('192.168.1.50'); // Login as ftpuser / tr4nsf3r
cd('/srv/ftp/config');
ls('-a'); // See .key_fragment
get('.key_fragment'); // Download to local
quit();
cat('.key_fragment'); // DECRYPT_KEY_PART2=ea2d996cb180258ec89c0000b42db460

// Decrypt on webserver (need root for decrypt command)
ssh('guest', '192.168.1.75'); // Enter: w3lcome
su('www-data'); // Enter: d3v0ps2024
cat('/var/www/backups/db_backup.sql'); // Shows root password: r00tW3b!
su('root'); // Enter: r00tW3b!
// Now root@webserver — has decrypt command
const key = '76e2e21dacea215ff2293e4eafc5985cea2d996cb180258ec89c0000b42db460';
decrypt('/var/www/backups/encrypted_intel.enc', key);
// FLAG{decrypted_intel}
// Hint: "webserver backdoor on port 4444" + "darknet.ctf at 203.0.113.42:8080"
```

#### FLAG 10 — `backdoor_found` (Advanced)

```javascript
exit(); // Return to localhost
nmap('192.168.1.75'); // Confirm port 4444 (elite) open
nc('192.168.1.75', 4444); // Connect as www-data
ls('/opt/tools', '-a'); // See .backdoor_log
cat('/opt/tools/.backdoor_log'); // FLAG{backdoor_found}
// Hint: "darknet.ctf:31337 as C2 server"
//   "The darknet web portal at port 8080 has login information"
exit();
```

#### FLAG 11 — `darknet_discovered` (Expert)

```javascript
nslookup('darknet.ctf'); // Resolves to 203.0.113.42
curl('http://203.0.113.42:8080'); // ASCII art + FLAG{darknet_discovered}
// Also shows: "ghost/sp3ctr3" + "API: /api/secrets" + "port 31337"
curl('http://203.0.113.42:8080/api/secrets'); // JSON hints about ghost's home
```

#### FLAG 12 — `master_of_the_darknet` (Expert)

```javascript
// Option A: SSH as guest then escalate
ssh('guest', '203.0.113.42'); // Enter: sh4d0w (from webserver .darknet_access)
su('ghost'); // Enter: sp3ctr3 (from darknet index.html)

// Option B: NC on port 31337 for recon, then SSH
nc('203.0.113.42', 31337); // Connects as ghost — explore, then exit
ssh('ghost', '203.0.113.42'); // Enter: sp3ctr3

// As ghost@darknet:
ls('-a'); // See .encrypted_flag.enc, .notes
cat('.notes'); // "Need root to use decrypt(). Key in /root/keyfile.txt"
cat('/var/log/auth.log'); // "pam_audit: root authentication - password 'd4rkn3tR00t'"
su('root'); // Enter: d4rkn3tR00t
cat('/root/keyfile.txt'); // Key: 82eab922d375a8022d7659b58559e59026dbff2768110073a6c3699a15699eda
const key = '82eab922d375a8022d7659b58559e59026dbff2768110073a6c3699a15699eda';
decrypt('/home/ghost/.encrypted_flag.enc', key);
// FLAG{master_of_the_darknet}
// "Congratulations! You've completed the JSHACK.ME CTF."
```

#### FLAG 13 — `code_the_decoder` (Bonus)

```javascript
// As ghost@darknet (already on darknet from Flag 12):
ls(); // See projects/ directory
cd('projects');
cat('README.md'); // Explains ROT13 encoding, hints at nano + node
cat('encoded_message.txt'); // Contains: SYNT{pbqr_gur_qrpbqre}

// Write a decoder script:
nano('decode.js');
// In the editor, write:
//   const encoded = cat("encoded_message.txt")
//   const decoded = encoded.replace(/[a-zA-Z]/g, c => {
//     const base = c <= 'Z' ? 65 : 97
//     return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base)
//   })
//   echo(decoded)
// Save with Ctrl+S, exit with Ctrl+X

node('decode.js'); // Outputs: FLAG{code_the_decoder}
```

#### FLAG 14 — `shadow_debugger` (Intermediate — FTP recon + nano + node)

```javascript
// From darknet, discover hidden network:
ifconfig(); // See eth1: 10.66.66.100
cat('/root/.hidden_network'); // Lists shadow (FTP), void (maintenance:9999), abyss (SSH only)

// FTP recon on shadow:
ftp('10.66.66.1'); // Login as guest / demo
cd('/srv/ftp/exports');
ls(); // system_report.txt, network_status.txt
get('system_report.txt');
quit();
cat('system_report.txt');
// Reveals: operator password 'c0ntr0l_pl4n3' + void maintenance port 9999

// SSH to shadow as operator:
ssh('operator', '10.66.66.1'); // Enter: c0ntr0l_pl4n3

// Find the challenge:
ls('diagnostics'); // README.txt, access.log, check_logs.js
cat('diagnostics/README.txt'); // Explains the broken script

// Try running the buggy script:
node('diagnostics/check_logs.js');
// Error: TypeError: Cannot read properties of undefined (reading 'split')

// Debug — fix bug 1: i <= lines.length → i < lines.length
nano('diagnostics/check_logs.js'); // Fix the loop bound
node('diagnostics/check_logs.js');
// Empty output — still wrong

// Debug — fix bug 2: split(",") → split("|")
cat('diagnostics/access.log'); // See pipe-delimited format
nano('diagnostics/check_logs.js'); // Fix the delimiter
node('diagnostics/check_logs.js');
// Output: FLAG{shadow_debugger}
```

#### FLAG 15 — `void_data_miner` (Advanced — NC recon + nano + node)

```javascript
// NC recon on void (maintenance service):
exit(); // Back to darknet
nc('10.66.66.2', 9999); // Connects as dbadmin (read-only shell)
ls('recovery'); // Preview: manifest.txt, table_01.csv ... table_05.csv
cat('recovery/manifest.txt'); // See the extraction challenge
cat('/var/log/auth.log'); // "dbadmin authenticated - password 'dr0p_t4bl3s'"
ls('/home/dbadmin', '-a'); // See .abyss_notes
cat('/home/dbadmin/.abyss_notes'); // phantom / sp3ctr4l for abyss
exit(); // Back to darknet

// SSH to void as dbadmin:
ssh('guest', '10.66.66.2'); // Enter: demo
su('dbadmin'); // Enter: dr0p_t4bl3s

// Write a data extraction script:
nano('extract.js');
// In the editor:
//   const tables = ["table_01.csv","table_02.csv","table_03.csv","table_04.csv","table_05.csv"]
//   const fragments = tables.map(t => {
//     const rows = cat("recovery/" + t).split("\n")
//     return rows[13].split("|")[3]
//   })
//   echo(fragments.join(""))
// Save and exit

node('extract.js'); // Output: FLAG{void_data_miner}
```

#### FLAG 16 — `abyss_decryptor` (Expert — SSH only, creds from void)

```javascript
// SSH to abyss (credentials discovered from void NC recon):
exit(); // Back to darknet
ssh('guest', '10.66.66.3'); // Enter: demo
su('phantom'); // Enter: sp3ctr4l (from void's .abyss_notes)

// Find the challenge:
ls('vault'); // README.txt, cipher.txt, key.txt, encoded_payload.txt
cat('vault/README.txt'); // Context about the vault
cat('vault/cipher.txt'); // XOR with repeating key, hex-encoded
cat('vault/key.txt'); // ABYSS
cat('vault/encoded_payload.txt');
// 07 0e 18 14 28 20 20 20 20 20 1e 26 3c 30 21 38 32 2d 3c 21 3c

// Write a decoder script:
nano('decrypt.js');
// In the editor:
//   const hex = cat("vault/encoded_payload.txt").trim()
//   const key = cat("vault/key.txt").trim()
//   const bytes = hex.split(" ")
//   const decoded = bytes.map((b, i) =>
//     String.fromCharCode(parseInt(b, 16) ^ key.charCodeAt(i % key.length))
//   ).join("")
//   echo(decoded)
// Save and exit

node('decrypt.js'); // Output: FLAG{abyss_decryptor}
```

### Credential Discovery Chain

```
localhost (start as jshacker)
│
├─ /etc/passwd → crack root hash (sup3rus3r) → su root [Flag 3]
├─ /var/log/auth.log → gateway guest/guest2024 [Flag 4, 5]
│
├─ gateway (SSH as guest)
│  ├─ /var/log/auth.log → admin password n3tgu4rd! [Flag 5]
│  ├─ /root/flag.txt → hints: FTP to fileserver, "anonymous" [Flag 7]
│  ├─ /root/.network_config → fileserver: guest/anonymous, ftpuser/tr4nsf3r
│  │                        → webserver: guest/w3lcome
│  └─ /var/www/html/admin.html → network layout, darknet IP [Flag 6]
│
├─ fileserver (FTP as guest → ftpuser)
│  ├─ /srv/ftp/public/readme.txt → ftpuser/tr4nsf3r
│  ├─ /srv/ftp/uploads/.backup_notes.txt → webserver hints [Flag 7]
│  └─ /srv/ftp/config/.key_fragment → decrypt key part 2 [Flag 9]
│
├─ webserver (SSH as guest → www-data → root)
│  ├─ /var/log/error.log → www-data/d3v0ps2024
│  ├─ /opt/tools/scanner → strings: flag + key part 1 [Flag 8]
│  ├─ /var/www/backups/db_backup.sql → root/r00tW3b!
│  ├─ /var/www/backups/encrypted_intel.enc → decrypt [Flag 9]
│  ├─ nc port 4444 → /opt/tools/.backdoor_log [Flag 10]
│  └─ /opt/tools/.darknet_access → darknet guest/sh4d0w
│
└─ darknet (SSH as guest/ghost → root)
   ├─ curl :8080 → flag + ghost/sp3ctr3 [Flag 11]
   ├─ /var/log/auth.log → root/d4rkn3tR00t
   ├─ /root/keyfile.txt → decrypt key
   ├─ /home/ghost/.encrypted_flag.enc → decrypt [Flag 12]
   ├─ /home/ghost/projects/ → ROT13 challenge [Flag 13]
   ├─ /root/.hidden_network → services per machine (FTP, NC, SSH)
   │
   ├─ shadow (FTP recon → SSH as operator)
   │  ├─ ftp: /srv/ftp/exports/system_report.txt → operator/c0ntr0l_pl4n3 + void hint
   │  └─ ssh: /home/operator/diagnostics/ → debug buggy script [Flag 14]
   │
   ├─ void (NC recon on port 9999 → SSH as dbadmin)
   │  ├─ nc: preview recovery/, read auth.log → dbadmin/dr0p_t4bl3s
   │  ├─ nc: /home/dbadmin/.abyss_notes → phantom/sp3ctr4l (abyss creds)
   │  └─ ssh: /home/dbadmin/recovery/ → extract from 5 CSV tables [Flag 15]
   │
   └─ abyss (SSH only — creds from void NC recon)
      ├─ ssh as guest/demo → su phantom (password from void)
      └─ /home/phantom/vault/ → XOR cipher decode [Flag 16]
```

---

## Open Questions

1. **How should MD5 cracking work?** — Players need to crack hashes. Options:
   - Passwords are common enough to guess (toor, admin, password, guest)
   - Provide an in-game tool or hint
   - Include a password list hint file somewhere

2. **Should there be a scoreboard or flag tracker?** — Could add a `flags` command that shows found/total

3. **Encryption key format** — Currently uses 64-char hex for AES-256-GCM. The split-key mechanic (32 chars + 32 chars from different machines) needs careful implementation.

4. **Binary file format** — The `strings` command needs a realistic-looking binary. Currently uses base64-like encoding with embedded ASCII.

5. **NC mode limitations** — NC only has read-only access (pwd, cd, ls, cat, whoami, help, exit). Is this enough for the flags that require nc?

6. **FTP mode** — FTP commands run as the FTP user's type. Guest FTP users would have guest command restrictions even in FTP mode? Or are FTP commands separate from the tier system?
