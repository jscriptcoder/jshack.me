# Mission System Design

## Overview

After completing the introduction (tutorial), players transition into a **mission-based** progression system. Missions are hacker-for-hire contracts discovered on a darknet marketplace. Each mission generates a **procedurally generated network** using a seed, creating unique target infrastructure the player must hack into.

## Key Decisions

- The 16 existing flags are the **introduction/tutorial** — no more static flags will be added
- **Victory tracking is not needed** for the tutorial flags
- The next phase is mission-based gameplay with procedural generation

---

## Mission Board — The Darknet Marketplace

### Discovery

The player discovers the mission board after completing the tutorial flags. Possible entry points:

- A breadcrumb in the final flag (flag 16) or darknet filesystem
- A hidden URL found through exploration (e.g., `.onion`-style address in a config file)
- A hidden machine with no IP that shows in scans — must be discovered through hints/files on existing machines

### Access

The mission board is a "shady" darknet website or hidden machine. Design options:

1. **curl-able website** — `curl darknet.ctf/missions` or a hidden `.onion` URL
2. **Hidden machine** — A machine that doesn't appear in any `nmap` scan; its IP must be found in a file or config on another machine
3. **Combination** — A hidden machine hosting a web service, accessed via `curl` after discovering the IP

### Interface

The mission board presents available contracts with:

- Client alias (anonymous handle)
- Target description (what needs to be hacked)
- Objective (steal, modify, plant, extract)
- Difficulty rating
- Seed code (visible to player for sharing)

Example mission listing:

```
====================================
  DARKNET CONTRACTS — AVAILABLE JOBS
====================================

[001] CLIENT: xR0gu3x
      TARGET: MedTech Solutions — hospital records system
      OBJECTIVE: Exfiltrate patient discharge records
      DIFFICULTY: * (Easy)
      SEED: MEDTECH-4A7F-easy

Type: accept(seed) to start a mission
```

---

## Seed-Based Network Generation

Inspired by Minecraft's world generation — a seed deterministically generates an entire target network.

### What a Seed Determines

1. **Network topology** — A border router with a public IP (45.x.x.x) + 2-6 internal machines on a private subnet (10.x.x.0/24). Two modes: forwarded (router NATs to DMZ) or router-first (hack router to pivot).
2. **Machine roles** — Each internal machine gets a role that defines its services and filesystem template:
   - Web server, database server, file server, workstation
   - The router is always present as infrastructure (role: `'router'`)
3. **Users** — Realistic usernames per role, password hashes from a wordlist-style pool
4. **Ports and services** — Which ports are open, what services run (SSH, FTP, HTTP, MySQL, etc.)
5. **Filesystem content** — Role-based templates with randomized content:
   - Config files, logs, user data, application files
   - The "target" data (what the player needs to steal/modify)
6. **Attack path** — Which vulnerabilities exist and in what order:
   - Weak passwords, password reuse across machines
   - SSH keys left in /tmp or home directories
   - Config files with hardcoded credentials
   - Exposed backups with password hashes
   - Misconfigured permissions (world-readable sensitive files)
7. **Red herrings** — Noise files, fake credentials, dead-end services

### Generation Layers

```
Seed
 |
 +-- Network Layer
 |   - Router with public IP (45.x.x.x) + internal subnet (10.x.x.0/24)
 |   - Machine count (2-6 internal + 1 router)
 |   - Network mode (forwarded vs router-first)
 |   - Machine roles (web, db, file, workstation + router)
 |
 +-- User Layer
 |   - Usernames per machine (role-appropriate: www-data, dbadmin, jsmith, etc.)
 |   - Password generation (from wordlist pool, some shared across machines)
 |   - User types (root, user, guest)
 |
 +-- Service Layer
 |   - Open ports per machine (based on role)
 |   - Service banners
 |   - NC backdoors on specific machines
 |
 +-- Filesystem Layer
 |   - Role-based directory templates (similar to existing fileSystemFactory)
 |   - Randomized content per template:
 |     - Config files with real-looking settings
 |     - Log files with connection history
 |     - User home directories with dotfiles
 |     - Application-specific content (web pages, DB dumps, mail spools)
 |   - Target data placed according to mission objective
 |
 +-- Vulnerability Layer
 |   - Attack chain: entry point -> lateral movement -> target
 |   - Credential leaks (logs, configs, history files)
 |   - Permission misconfigurations
 |   - Password reuse patterns
 |
 +-- Red Herring Layer
     - Fake credentials that don't work
     - Dead-end services
     - Noise files and logs
```

### Seed Keywords

Seeds can embed keywords (case-insensitive) to control generation axes:

| Axis          | Keywords                                   | Notes                                               |
| ------------- | ------------------------------------------ | --------------------------------------------------- |
| Difficulty    | `easy`, `medium`, `hard`                   | Unified in `parseSeedOverrides`                     |
| Entry variant | `ssh`, `ftp`, `nc`, `exploit`              | Falls back if template unavailable for network mode |
| Network mode  | `forwarded`, `router-first`                | Hyphenated to avoid false matches                   |
| Objective     | `exfiltrate`, `tamper`, `credential-theft` | Hyphen variant for credential_theft                 |

Example: `accept("HEIST-ssh-forwarded-tamper-hard")` forces SSH entry, forwarded mode, tamper objective, hard difficulty.

PRNG sequence is preserved — override calls still consume the PRNG roll but discard the result, so seeds without keywords produce identical networks as before.

### Seed Sharing

Seeds are visible to the player — they can share seeds with friends for the same challenge. This adds:

- Replayability (try the same mission differently)
- Social element ("try seed `HEIST-7734`, the bank job is brutal")
- Community content without needing a backend

---

## Mission Types

### Data Exfiltration

- Find and extract a specific file (photo, document, database dump)
- Tools: `cat`, `ftp get`, `curl`, `strings`
- Example: "Download the classified research paper from the R&D file server"

### Record Tampering

- Modify a specific file to change data (grades, records, configs)
- Tools: `nano`, `ftp put`
- Example: "Change the grade for student ID #2847 from F to A in the registrar database"

### Credential Theft

- Find a password or key and prove access to a deeper system
- Tools: `cat`, `strings`, lateral movement via `ssh`
- Example: "Recover the CEO's email password from the mail server"

### Evidence Planting

- Write a specific file to a specific location on a target machine
- Tools: `nano`, `ftp put`
- Example: "Plant the evidence file in the suspect's home directory"

### Service Disruption

- Modify a config to break a service (ethical gray area adds narrative flavor)
- Tools: `nano`
- Example: "Disable the firewall rules on the gateway to allow our team access"

### Chain Missions

- Multi-step heists across several machines
- Combine multiple objectives in one mission
- Example: "Steal the database backup, modify the access logs to cover your tracks, and plant a backdoor config"

---

## Design Questions to Resolve

### Difficulty Scaling

How do missions get harder?

- More machines in the network (2 -> 6)
- Fewer hints and breadcrumbs
- More red herrings and dead ends
- Required lateral movement (can't go directly to target)
- Tighter permission models (need specific exploit chains)
- Multi-objective missions

### Persistence

- Does each mission spin up a fresh network? (Probably yes — clean slate per mission)
- Do completed missions affect future ones? (Could unlock harder tiers)
- Is mission state saved if player leaves mid-mission? (IndexedDB persistence)

### Scoring / Reputation

Even without formal victory tracking, a "hacker reputation" on the mission board could drive progression:

- Completing missions increases reputation
- Higher reputation unlocks harder, more interesting contracts
- Reputation could be a simple counter or tiered (Script Kiddie -> Hacker -> Elite -> Legend)

### Failure State

- Can you fail a mission? Get "detected"?
- Is it purely exploratory (keep trying until you succeed)?
- Could add optional "stealth" challenges (don't trigger certain log entries)
- Time-limited variants for advanced players?

### Mission Discovery vs Selection

- Pick from a list on the mission board? (Simpler, clearer)
- Missions appear organically? (Encrypted messages, tips in chat logs)
- Combination: board has listed missions + hidden/secret missions found through exploration

---

## Implementation Priority

Build in layers, each independently useful:

### Phase 1: Seeded Network Generator (Engine)

The foundation everything else runs on:

- Deterministic PRNG from seed string
- Network topology generation (machines, IPs, ports)
- User generation (names, passwords, types)
- Filesystem generation from role templates
- Vulnerability chain generation

This is the hardest and most valuable piece — once this works, content becomes cheap to produce.

### Phase 2: Mission Board UI

- Add mission board access point (hidden URL or machine)
- `curl` or browse available contracts
- `accept(seed)` command to start a mission
- Mission state tracking (active mission, objectives)

### Phase 3: First Mission Template

- One complete mission type (e.g., "steal a file from a 3-machine network")
- End-to-end flow: accept -> generate -> hack -> verify -> complete
- Proof of concept for the whole system

### Phase 4: Expand Mission Types

- Add remaining mission types (tamper, plant, steal credentials, chain)
- Difficulty tiers
- More machine role templates
- More vulnerability patterns

### Phase 5: Polish and Social

- Reputation system
- Seed sharing UX
- Mission history
- Optional: backend for community seeds/leaderboards

---

## Technical Considerations

### Connecting to Existing Architecture

- Generated networks integrate with existing `NetworkContext` — same interfaces, machines, DNS
- Generated filesystems use the same `FileNode` tree structure and `fileSystemFactory` patterns
- Existing commands (ssh, ftp, nc, curl, nmap, etc.) work unchanged on generated machines
- Session management (push/pop) works the same for generated machines

### PRNG Requirements

- Must be deterministic (same seed = same network every time)
- Must generate: numbers, selections from arrays, shuffles, strings
- Lightweight — no need for cryptographic quality
- Consider: simple seeded LCG, or a library like `seedrandom`

### Filesystem Templates

Expand the existing `fileSystemFactory.ts` pattern:

- Role-based templates (web server template, DB server template, etc.)
- Parameterized content (usernames, IPs, dates filled in from seed)
- Noise generation (realistic log entries, config files, dotfiles)
- Target data placement (the objective file/record)

**Exfiltrate target file templates** (`targetFileTemplatesByRole` in `pools.ts`): For exfiltrate objectives, the target file is role-appropriate with an ACCESS-KEY embedded in realistic content. The attack chain generator selects a template based on the target machine's role, fills `{{access_key}}` placeholder, and the filesystem generator places the file at a dynamic path using `extraDirectories`. Target paths use `/srv/` and `/opt/` prefixes to avoid conflicting with factory-managed directories (`/var/`, `/home/`, `/etc/`).

**Tamper file templates** (`tamperFileTemplatesByRole` in `pools.ts`): For tamper objectives, each template specifies a target file with `tamperOldValue` and `tamperNewValue`. The player must modify the file (e.g., change a grade from "F" to "A") and confirm via `mail()`.

**Credential theft**: No target file needed — the objective is to discover the root password on the target machine.

**Completion mechanism**: Player sends proof to the client via `mail("client@darkmail.onion", "proof")`. Each mission has a `clientEmail` (generated from `clientHandles` pool) shown in the briefing. The `mail` command verifies proof based on objective type.

### Vulnerability Scanning & Exploit System

Adds a realistic pentesting gameplay loop for the `exploit` entry variant:

1. **Vulnerability data model** — `Port` type has optional `vulnerability` field (`Vulnerability` type: CVE, description, serviceVersion). Vulnerability templates in `pools.ts` use real CVEs for realism.
2. **`nmap -sV` flag** — Version detection mode shows service versions and a `VULNERABILITIES:` section with CVE details for ports that have vulnerabilities.
3. **`exploit(host, port)` command** — Exploits a vulnerable port (must have both `vulnerability` and `owner`). Async output shows targeting, CVE, payload delivery, then drops into NC-like restricted shell via `NcPromptData`.
4. **Exploit entry variant** — PRNG can select `exploit` as the entry variant. The generator attaches a matching vulnerability template + guest owner to the non-SSH open port on the entry machine. Player flow: `nmap -sV` → `exploit` → find SSH creds in restricted shell → SSH to continue.
5. **Guest password variation** — Guest passwords are picked from a `guestPasswords` pool instead of hardcoded `"guest"`, making SSH entry variant less predictable. The actual password is shown in the mission briefing.

### Anti-Cheat

- Generated content should use the same XOR+Base64 encoding as static content
- Or: since content is procedural, the "answers" aren't in the bundle at all — natural anti-cheat
