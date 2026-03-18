# Plan: NC Lateral Movement with `sshd` Upgrade

**Branch**: feat/nc-lateral-movement
**Status**: Active

## Goal

Add `sshd` as a regular command (binary at `/usr/sbin/sshd`, root-only) available in both the main terminal and the NC shell via the adapter pattern. Allow machines with both SSH and FTP closed to have an NC backdoor (always root-owned), letting the player start `sshd` to upgrade to full SSH access when needed.

## Player Experience

1. Player compromises Machine A (via SSH/FTP/etc.)
2. Finds credentials for Machine B on Machine A (existing credential placement system)
3. Finds hint about a backdoor on Machine B (new hint template)
4. `nmap` shows Machine B has no SSH/FTP — only an elite (backdoor) port
5. `nc(machineB_ip, port)` — connects to backdoor as root
6. **For read-only objectives** (exfiltrate, credential_theft): `cat` the target file, done
7. **For write/execute objectives** (tamper, script_fix, sabotage): run `sshd` in nc shell
8. Port 22 dynamically opens on Machine B
9. Exit nc, SSH into Machine B with credentials from step 2
10. Full shell access — `nano`, `node`, `rm`, `reboot` all available

## Design Decisions

- **`sshd` is a regular command** with binary at `/usr/sbin/sshd` (root-only execute), following the same adapter pattern as `ls`, `cat`, etc. Core logic in `src/commands/sshd.ts` exports `SshdAdapter` + `startSshd()`, reused by both the main terminal and `src/commands/nc/sshd.ts`
- **`/usr/sbin/` is a new binary directory** — `findBinary` in `availability.ts` is extended to search `/usr/sbin/` after `/bin/` and `/usr/bin/`. `fileSystemFactory.ts` creates it on all machines
- **`sshd` supports custom ports** — `sshd()` defaults to port 22, `sshd(2222)` or `sshd("-p", 2222)` starts on a custom port. The pid file records the port (e.g., `sshd:port=2222`). The parser reads the port from the pid file so NetworkContext opens the correct port as SSH
- **`sshd` writes `/var/run/sshd.pid`** to the remote filesystem as its marker (realistic — Linux tracks services via pid files)
- **`NetworkContext` reads pid files dynamically** (same pattern as SNMP firewall parser reading `/etc/snmp/snmpd.conf`)
- NC lateral backdoor is **always root-owned** (unlike entry backdoors: 60% guest / 40% user), because starting `sshd` requires root
- Dual SSH+FTP closure is a new PRNG roll, independent from existing single closures
- Protected machines (entry, router) and protected objectives (script_fix, sabotage) keep existing protections

## Acceptance Criteria

- [ ] `/usr/sbin/` directory exists on all machines with `sshd` binary (root-only execute)
- [ ] `sshd` command works in main terminal — gated by binary existence + root permission
- [ ] `sshd` command works in NC shell — same core logic via adapter pattern
- [ ] Running `sshd` when SSH is already running shows realistic "already running" message
- [ ] Running `sshd` as non-root returns permission error
- [ ] `sshd()` defaults to port 22, `sshd(2222)` starts on custom port
- [ ] `sshd` writes `/var/run/sshd.pid` with port info and the correct port dynamically opens
- [ ] SSH works normally to a machine after `sshd` opens port 22
- [ ] Mission generator can close both SSH and FTP on a machine, placing an NC backdoor instead
- [ ] NC lateral backdoor is always root-owned
- [ ] Attack chain recognizes NC as a lateral movement method and places appropriate hints
- [ ] Existing port closure behavior (single SSH or single FTP) is unaffected
- [ ] All existing tests pass

## PR Breakdown

### PR 1: `sshd` command + dynamic port opening

Adds `sshd` as a regular command (binary at `/usr/sbin/sshd`, root-only) with adapter pattern for NC shell reuse. Wires dynamic port 22 opening via NetworkContext. Can be tested manually on the static webserver (NC backdoor on port 4444).

### PR 2: NC lateral movement in mission generation

Changes port closure logic and attack chain to create scenarios where NC lateral movement is needed.

---

## Steps (PR 1)

### Step 1: Add `/usr/sbin/` directory with `sshd` binary to filesystem factory

**Test**: All machines have `/usr/sbin/sshd` binary with root-only execute permissions.
**Implementation**: Add `SBIN_UTILITY_NAMES` (containing `sshd`) to `availability.ts`. Update `fileSystemFactory.ts` to create `/usr/sbin/` directory on all machines. Update `findBinary` to search `/usr/sbin/` after `/bin/` and `/usr/bin/`.
**Done when**: Binary exists on all machines, `findBinary` locates it, access check enforces root-only.

### Step 2: Create `sshd` core logic with adapter pattern

**Test**: `startSshd(adapter, port?)` returns error when SSH already running on that port; returns error when pid file already exists; defaults to port 22 when no port given; accepts custom port (e.g., 2222); returns success message and calls `writePidFile` with the port.
**Implementation**: Create `src/commands/sshd.ts` exporting `SshdAdapter` type and `startSshd(adapter, args)` pure function. Adapter needs: `isPortOpen(port)`, `pidFileExists()`, `writePidFile(content)`. The pid file content includes the port (e.g., `sshd:port=22`).
**Done when**: Core logic tests pass for all cases (already running, pid exists, default port, custom port, success).

### Step 3: Create main terminal `sshd` command

**Test**: Command registered in useCommands, gated by binary existence + root. Calls `startSshd` with correct adapter wiring.
**Implementation**: Create the `sshd` Command object in `src/commands/sshd.ts` (or a factory), register in `useCommands.ts`, add to availability system with root-only execute.
**Done when**: `sshd` works in main terminal with access control.

### Step 4: Create NC shell `sshd` command via adapter

**Test**: NC `sshd` command calls `startSshd` with adapter that reads/writes remote machine filesystem. Root check works via NC session's userType.
**Implementation**: Create `src/commands/nc/sshd.ts` following the same adapter pattern as `nc/ls.ts` and `nc/cat.ts`. Context needs `getUserType`, `getMachine`, `getNodeFromMachine`, and `writeFileToMachine`. Export from `nc/index.ts`, register in `useNcCommands.ts`.
**Done when**: `sshd` works in NC shell with correct adapter wiring.

### Step 5: Create sshd state parser

**Test**: Parser returns empty array for missing/undefined content; returns `[{ port: 22, open: true, service: 'ssh' }]` for pid file with port 22; returns `[{ port: 2222, open: true, service: 'ssh' }]` for pid file with custom port.
**Implementation**: Create `src/network/sshdStateParser.ts` — a pure function `parseSshdState(content: string | undefined)` that parses the port from pid file content (e.g., `sshd:port=2222`) and returns port overrides.
**Done when**: Parser tests pass for default and custom ports.

### Step 6: Integrate sshd parser into NetworkContext for dynamic port opening

**Test**: Machine with `/var/run/sshd.pid` containing port 22 shows port 22 as open SSH. Machine with pid file containing port 2222 shows port 2222 as open SSH. Machine without pid file is unchanged.
**Implementation**: In `NetworkContext.tsx`, for each mission machine, read `/var/run/sshd.pid` and apply overrides via `applySshdOverrides()` (same pattern as `applySnmpFirewallOverrides`). Override either opens a closed port or adds a new port entry.
**Done when**: Dynamic port opening works end-to-end for both default and custom ports.

### Step 7: Update NC help command to list sshd

**Test**: NC help output includes sshd command with description.
**Implementation**: Update `src/commands/nc/help.ts` to include sshd in the command list.
**Done when**: Help shows sshd.

---

## Steps (PR 2)

### Step 8: Add dual SSH+FTP closure with NC backdoor placement

**Test**: When both SSH and FTP are closed, an elite (backdoor) port is added. Entry machine, router, script_fix, and sabotage are protected. Existing single-closure behavior is unchanged.
**Implementation**: Modify `applyPortClosures` in `generateMission.ts` to add a new PRNG roll for dual closure (~15-20% of eligible machines). When triggered, close both SSH and FTP, add a backdoor port from the `backdoorPorts` pool.
**Done when**: Port closure tests pass with new dual-closure scenarios.

### Step 9: Add root-owned backdoor assignment for lateral NC

**Test**: When a lateral NC backdoor is placed (dual closure), owner is always root. Entry NC backdoors keep existing 60/40 guest/user distribution.
**Implementation**: Add `addLateralNcBackdoorOwner` function that always assigns root as owner (separate from `addNcBackdoorOwner` which remaps root → user).
**Done when**: Owner assignment tests pass.

### Step 10: Update attack chain to route through NC for lateral movement

**Test**: When a machine has no SSH/FTP but has an elite port, the attack chain selects NC as lateral method. Credential placement on previous machine includes hint about the backdoor.
**Implementation**: Update lateral movement method selection in attack chain logic to check for elite ports when SSH/FTP unavailable. Add NC-specific hint templates.
**Done when**: Attack chain correctly routes through NC with hints.

### Step 11: Add NC lateral movement hint templates

**Test**: Hint templates render correctly with machine IP and port. Hint is placed on the previous machine in the attack path.
**Implementation**: Add 3-4 hint templates to `pools.ts` describing a backdoor service (e.g., "Network scan of {{machine}} detected an open backdoor on a non-standard port").
**Done when**: Hint templates integrate with existing credential placement system.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing
2. Refactoring assessment
3. `npm run build`, `npm run lint`, `npm run format`, `npm run test:run`

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
