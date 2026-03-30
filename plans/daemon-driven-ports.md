# Plan: Daemon-Driven Port State

**Branch**: refactor/daemon-driven-ports
**Status**: Active

## Goal

Make port open/closed state derived from daemon PID files + firewall/ACL rules instead of static generation-time flags, so that the source of truth for "is a port reachable?" matches reality: a daemon must be running AND not blocked by firewall/ACL.

## Context

Currently, ports have a static `open: boolean` set at generation time. PID files are created alongside open ports but are redundant — daemon overrides in `applyDynamicOverrides` re-open already-open ports (a no-op). The pipeline also has an ordering bug: daemon overrides run AFTER firewall/SNMP overrides, meaning a daemon can "undo" a firewall block.

### Services by category

**Daemon-backed (have PID infrastructure)**: SSH (22), FTP (21), NC (dynamic ports)
**Infrastructure (no PID, always running)**: HTTP/HTTPS (80/443/8080/8443), databases (3306/5432/6379/27017), mail (25/110/143/993), SNMP (161), SMB (445), VNC (5900), MQTT (1883), etc.

### Target model

For daemon-backed services:
- Port is open = PID file exists AND not blocked by firewall/ACL
- `applyDynamicOverrides` pipeline: daemon state FIRST, then firewall/ACL on top

For infrastructure services:
- Keep static `open` flag — these represent always-running services with no player interaction
- Still subject to firewall/ACL filtering

## Acceptance Criteria

- [ ] SSH port open/closed is derived from sshd.pid existence, not static flag
- [ ] FTP port open/closed is derived from vsftpd.pid existence, not static flag
- [ ] NC ports derived from nc-*.pid files (already works this way)
- [ ] Firewall/ACL rules apply AFTER daemon state (can block a running daemon)
- [ ] A daemon override cannot "undo" a firewall/ACL block
- [ ] Generation still creates PID files for machines that should have SSH/FTP running
- [ ] Static `open` flag retained for non-daemon services (http, mysql, etc.)
- [ ] All existing tests pass (with updates as needed)
- [ ] SNMP entry variant still works (SSH closed in template, no PID file, opened via snmpset)

## Steps

### Step 1: Reorder applyDynamicOverrides — daemon state before firewall/ACL

**Test**: Test that when sshd.pid exists but SNMP firewall denies SSH, port 22 shows as closed.
**Implementation**: Move daemon state parsing (steps 4-6) before SNMP/ACL overrides (steps 2-3) in `applyDynamicOverrides`. Daemon state builds the "what's running" picture, then firewall/ACL filters it.
**Done when**: Firewall/ACL can block a running daemon's port.

### Step 2: Make daemon overrides set port state from PID files (not just force-open)

**Test**: Test that when no sshd.pid exists, SSH port appears closed even if static flag says open.
**Implementation**: Change daemon override logic: instead of only force-opening ports, daemon overrides REPLACE the open state — if PID exists, port is open; if PID is absent, port is closed (for daemon-backed services only). Add a concept of "daemon-backed service" to distinguish SSH/FTP from infrastructure ports.
**Done when**: Removing a PID file causes the port to show as closed.

### Step 3: Remove static open flag dependency for SSH ports at generation time

**Test**: Test that machines with sshd.pid get SSH open, machines without get SSH closed, regardless of static port `open` value.
**Implementation**: Generate SSH ports with `open: false` in static templates (the PID file is what makes them open). Update `generateFileSystems.ts` to always create sshd.pid when SSH should be running (decouple from static open flag). SNMP entry variant: SSH port has `open: false` in template AND sshd.pid exists (daemon running but firewalled). Firewall blocks access until snmpset permits it. Pipeline order (daemon first, then firewall) makes this work: daemon sets open=true, firewall overrides to closed, snmpset re-opens.
**Done when**: SSH port visibility is fully PID-driven.

### Step 4: Same treatment for FTP ports

**Test**: Test that machines with vsftpd.pid get FTP open, machines without get FTP closed.
**Implementation**: Same as step 3 but for FTP service. Generate FTP ports with `open: false`, let PID file drive state.
**Done when**: FTP port visibility is fully PID-driven.

### Step 5: Update port closure system to remove PID files instead of toggling static flag

**Test**: Test that `applyPortClosures` removes sshd.pid / vsftpd.pid instead of setting `open: false`.
**Implementation**: `applyPortClosures` currently sets `open: false` on ports. Change it to work with PID files instead — SSH closure means no sshd.pid (daemon not running). This may require `applyPortClosures` to return PID file removal info alongside machine data, or it operates on filesystem configs.
**Done when**: Port closures work through PID file absence, not static flags.

### Step 6: Add PID files for infrastructure services (HTTP, databases, etc.)

**Test**: Test that machines with open HTTP/MySQL/etc. ports have corresponding PID files in `/var/run/`, and that `ps` shows them.
**Implementation**: Extend `generateFileSystems.ts` to create PID files for infrastructure services when their ports are open. Add PID file formats for nginx, mysqld, postgres, postfix, mosquitto, snmpd, etc. Update `ps` command to read these PID files instead of deriving from open ports via `SERVICE_TO_PROCESS`. Remove the `SERVICE_TO_PROCESS` mapping — `ps` should be fully PID-driven.
**Done when**: `ps` shows all running services from PID files, not from static port state.

### Step 7: Add basic read-write SNMP tier for inner gateways

**Test**: Test that inner gateways can get rw SNMP with firewall/ACL OIDs (new tier between read-only and full SNMP-variant).
**Implementation**: Add PRNG roll within basic-SNMP gateways: some get read-only (current), some get read-write with firewall/ACL OIDs but no credential leaks. SSH on these gateways has sshd.pid (daemon running) but firewalled — player uses snmpset to open.
**Done when**: Inner gateways can have SNMP-gated SSH access.

## Design Decisions

1. **SNMP entry variant**: Daemon is already running but firewalled. snmpset opens the firewall, making the port reachable. PID file exists from generation, firewall blocks access until snmpset permits it.
2. **Infrastructure services (HTTP, databases, etc.)**: Port state stays static (players don't start/stop these). But PID files are needed so `ps` shows them as running processes. No kill command exists yet, so this is safe.
3. **Port closures**: `applyPortClosures` should remove PID files (daemon not running) rather than toggling static flags. A closed SSH port = no sshd.pid = daemon not started.

## Pre-PR Quality Gate

Before each PR:

1. All tests pass (`npm run test:run`)
2. Build succeeds (`npm run build`)
3. Lint passes (`npm run lint`)
4. Format check passes (`npm run format:check`)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
