# Changelog

All notable changes to JSHACK.ME are documented in this file.

## [0.21.0] — 2026-03-14

### Async Node Script Execution

- `await` support in `node` scripts — scripts containing `await` use `AsyncFunction` constructor; async commands (hydra, nmap, ping, etc.) are auto-wrapped so `await hydra(...)` returns `string[]` of collected output lines
- `console.log()` prints to terminal in real-time from within scripts
- `sleep(ms)` for pacing loop iterations
- `echo()` in async scripts outputs to terminal immediately (not buffered)
- Ctrl+C cancellation — cancels the running inner command and stops the script silently
- `process.argv` — pass arguments to scripts via `node("brute.js", "192.168.1.50", "ssh")`, accessible as `process.argv` inside the script
- `collectAsyncOutput` utility — bridges `AsyncOutput` into `Promise<string[]>` with optional line forwarding

### Tool-Based Progression

- `ls -l` long listing — shows `drwxrwxrwx owner filename` format with Unix-style permission strings
- `chmod` command — symbolic notation (`u+x`, `o-w`, `a+rx`) mapped to `root/user/guest` types
- `scp` command — `scp(src, "user@host:dest")` copies files between machines preserving permissions
- Command resolution from current directory — binaries resolve from `cwd → /bin/ → /usr/bin/` with execute permission check, enabling tool transfer via `scp`
- FileSystemPatch permissions — patches persist permission changes; new files default to no execute

### Dynamic Network Access & Iptables

- Per-machine access variants — each internal mission machine gets a PRNG-selected `accessVariant` (ssh/ftp/nc/exploit/http) determining ports, owners, and vulnerabilities
- Router iptables file — `/etc/iptables/rules.v4` with forwarding rules (pre-populated in forwarded mode, empty template in router-first mode)
- Dynamic iptables parsing — editing with `nano` takes effect on the next `nmap` scan or connection attempt; filesystem is the single source of truth
- Port-aware NAT resolution — `resolveNat(ip, port)` returns `{ ip, port }` based on iptables rules

### NAT-Aware Authentication & Credential Cracking

- NAT-resolved auth — FTP, SSH, and SCP authenticate against the actual target machine instead of the router's merged view
- NAT-resolved hydra — targets the correct machine's users per port
- `findMachineUsers` returns full `RemoteUser[]` objects (with `passwordHash` and `userType`)

### Unified Command Implementations

- `ls` adapter pattern — shared `listDirectory` pure function used by shell, FTP, and NC modes (~250 lines deduped)
- `cat` adapter pattern — shared `readFileContent` pure function used by shell and NC modes (~80 lines deduped)
- NC cat traversal bug fix — now verifies execute permission on parent directories, matching shell behavior

### Other Changes

- `decrypt` renamed to `gpg` to match the real tool name
- Filesystem-based command access control — unified model via binary file permissions in `/bin/` and `/usr/bin/`
- Mission filesystem patches persisted to IndexedDB and replayed on reload
- Cross-tab sync StrictMode fix — BroadcastChannel lifecycle is now StrictMode-safe
- `ssh` format changed to `ssh("user@host")` with optional port parameter
- Credential-based attack chain generation removed (1,500+ lines); replaced by tool-based progression
- Mission board cleared (pending new curated contracts)
- Sabotage objective type added (5 total: exfiltrate, tamper, credential_theft, script_fix, sabotage)

### Bug Fixes

- Async output ordering — fixed race condition where jittered delays could cause lines to arrive out of order; changed to cumulative `delay += jitter(step)` pattern (10 commands fixed)
- NC cat missing directory traversal permission checks

### Developer Experience

- 8 specialized Claude Code agents (tdd-guardian, ts-enforcer, refactor-scan, pr-reviewer, docs-guardian, learn, adr, progress-guardian)
- 5 slash commands (/setup, /pr, /plan, /continue, /generate-pr-review)
- 7 new/updated skills (tdd, testing, mutation-testing, test-design-reviewer, refactoring, planning, expectations)
- CLAUDE.md relocated to `.claude/CLAUDE.md`
- Documentation deduplication across architecture docs

## [0.8.0] — 2026-03-01

### Network & Topology

- Realistic network topology with hackable border router (public IP from hosting prefixes) between localhost and internal machines on private subnets
- Two network modes: **forwarded** (NAT to DMZ, easier) and **router-first** (hack router to pivot, harder)
- Variable NC backdoor ports (4444, 31337, 8888, 1337) and varied network IP ranges per seed

### Entry Variants (5 types)

- **SSH** — direct login with credentials from briefing
- **FTP** — explore via FTP, find SSH credentials in files
- **NC** — connect via netcat backdoor, find SSH credentials
- **Exploit** — `nmap -sV` → find CVE → `exploit(host, port)` → restricted shell → find SSH credentials
- **HTTP** — `curl` to explore web content, find SSH credentials in page body or headers

### Objective Types (4)

- **Exfiltrate** — find ACCESS-KEY in target file, mail to client (optionally encrypted with `decrypt`)
- **Tamper** — modify a target file, mail client to confirm
- **Credential theft** — discover root password on target machine, mail to client
- **Script fix** — fix broken JS script with `nano`, run with `node`; `_decode(checksum)` returns ACCESS-KEY on correct output

### Mission Board

- 9 curated contracts covering all generation axes (3 difficulty levels, 5 entry variants, 4 objectives, forwarded/router-first modes)
- Seed keywords to control all generation axes
- Binary file wrapping (~20-30% chance) requiring `strings` to extract data
- Encrypted exfiltrate variant with key discovery on different machine
- Domain-based entry requiring `nslookup`

### Cross-Tab Sync & Persistence

- Multiple browser tabs with shared state via `BroadcastChannel`
- Filesystem patches, WiFi state, mission state, and theme sync across tabs
- Session state in `sessionStorage` (per-tab); shared state in `IndexedDB`
- Dynamic browser tab title (`username@machine — JSHACK.ME`)

### Commands & Tools

- `apt install <tool>` — install hacking tools on remote machines
- `john()` — password cracking from passwd-format files
- `mail()` — submit proof to clients for mission completion
- `curl` — HTTP client with `.headers` sidecar support
- `exploit()` — exploit vulnerable services found via `nmap -sV`
- `hydra()` — brute-force SSH/FTP login credentials

### Static Machines

- **fileserver** (192.168.1.50) — FTP/SSH practice server
- **webserver** (192.168.1.75) — web server with NC backdoor
- Removed static remote machines (darknet, shadow, void, etc.) — all non-localhost machines now procedurally generated
