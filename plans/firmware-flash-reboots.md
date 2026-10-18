# A firmware flash reboots the router — grill record + plan

**Status:** Active — grilled 2026-10-18, no slice started.

Goal: item 6 of the sandbox-hardening list in `docs/project-status.md` (player-driven
service patching). `apt upgrade` already patches any box the shell is root on, so the
remainder is what `docs/vulnerability-architecture.md` defers as "Reboot-to-flash is not
modelled".

Facts established before the grill:

- `apt upgrade` rewrites the box's `/var/lib/dpkg/status`; it runs wherever the shell is
  root (own box, a rooted generated box, a fellow occupant's box, the AP gateway, whose
  firmware it patches too). It stops new exploits and evicts nobody.
- Every reader takes the version from the MANIFEST: `readOpenPorts`
  (`core/services/pidfile.ts`, `nmap -sV` and the server scan), `exploitCreateSession`
  (service + firmware), `exploitLocalElevate` (libraries), `snmpWalk` (`sysDescr`),
  `msfconsole`'s client render. `testExploitOwnLan.ts` proves live that a walked-forward
  manifest shuts the door.
- A pidfile is `<program>:port=<N>`; firmware has no runtime file. `reboot` ends every
  session row on the machine and writes `/var/run/boot-id` (server, `rebootMachine.ts`);
  pidfiles survive it.
- Real behaviour, which the owner made the rule (2026-10-18: "we should do same as
  real"): a Debian service package's scripts restart a RUNNING daemon onto the release
  just installed, a downgrade included, and leave a stopped one stopped; a fresh process
  loads the installed library; most router firmware flashes reboot the device by
  themselves (OpenWrt `sysupgrade`, MikroTik, pfSense, DD-WRT, UniFi; Cisco IOS is the
  exception, needing a manual `reload`).

## Decisions

1. **Item 6 is "a firmware flash reboots the router", not game-wide patching.** Rejected:
   a patch making a CVE inert for everyone (needs a stored shared record, breaking "every
   vulnerability is recomputed, never stored"); closing the item as already built; NPC
   maintainer actors (a separate, larger model change).
2. **Services and libraries are unchanged: the game already does what a real box does.**
   Every reader reads the manifest, so a running daemon is on the installed release the
   moment `apt` moves it, an upgrade or a downgrade, and every `msfconsole --local
   <command>` is a fresh process. The instant service-downgrade backdoor stays.
3. **When `apt` moves a router-class box's firmware, the box reboots as `reboot` does**:
   every session on it ends server-side (the caller's own shell included), a new boot-id,
   the brick check, the other players on it told on their next line. `apt upgrade` and
   `apt install <vendor>-firmware=<old>` both, and only when the firmware row actually
   moved. Nothing new is stored: the running image always equals the manifest, since
   every flash ends in a boot. An intruder's firmware downgrade now throws them off and
   shows everyone on the box the reboot.
4. **The caller sees apt's rows, one line `Firmware installed; rebooting to apply.`, then
   the hop drops** with the line any shell gets when its box goes down under it,
   `Connection to <host> closed by remote host.` (`core/shell/runLine.ts`), back on the
   box they came from. No BIOS or kernel animation: that is console output a remote shell
   never sees. Rejected: replaying `reboot`'s own output.
5. **The server performs the reboot, in the request that writes the row.** A write to a
   router-class box's `/var/lib/dpkg/status` that changes its firmware row ends every
   session on the box and mints the boot-id there, so a tampered client cannot patch and
   keep its shell. The server cannot tell `apt` from an editor, so a root hand-editing the
   firmware row reboots the box too. Rejected: `apt` calling the reboot endpoint
   afterwards (a skipped call keeps a shell an honest player could not).
6. **`man apt` says it in one sentence**: on a router, moving its firmware flashes the new
   image and reboots the device, which closes every connection to it. Hackademy is
   unchanged (its chapter is about the player's own box, which has no firmware).
   Rejected: saying nothing.
7. **A firmware rollback's `dpkg.log` line is written by the server, in the write
   request, before it reboots.** Found while planning: `pinVersion` sends
   `recordDowngrade` after the manifest lands, and `recordPackageDowngrade` passes
   `authorizeMachineAccess`, which the reboot has just failed, so the owner's only record
   of the rollback would be refused. The server derives the package and both versions
   from the manifest before and after (no client claim), through the same
   `formatPackageDowngradeLine`; `apt` skips `recordDowngrade` for a firmware row.
   Service rollbacks keep today's client-reported path. Rejected: the server writing
   every rollback and retiring the endpoint (larger, and logs a hand-edit as a dpkg
   rollback); losing the line.

Consequences, confirmed with the decisions: a root hand-editing the firmware row reboots
the router; an intruder's firmware downgrade throws them off and everyone on the box sees
the reboot; patching a gateway whose `/boot/vmlinuz` is gone bricks it; the vulnerability
doc's "Reboot-to-flash is not modelled" cost is retired and its "a patched daemon needs a
restart" note becomes "real behaviour, already matched".

## Slice 1 — moving a router's firmware reboots it (v0.403.0)

**Value:** a root on a router who patches or rolls back its firmware is thrown off as the
router reboots, and so is everyone else on it; the new image is live, as on a real router.
**Path:** `apt upgrade` / `apt install <vendor>-firmware=<v>` → `env.patches.write`
of `/var/lib/dpkg/status` → `api/patches` → `handleUpsertPatch` → L1
(`authorizeMachineAccess`) and L2 (`enforceRemoteWriteL2`, whose replayed tree IS the
manifest before the write) → upsert → firmware row compared before/after → for a
rollback, the `dpkg.log` line → the reboot `handleRebootMachine` performs after its gate
(end every row on the box, the `kern.log` line, the boot-id, the chains above) → 200 →
`apt` prints its line and drops the hop.
**Class:** behavior change. **Delivery:** independent PR against `main`.
**Required skills:** `tdd`, `testing`, `refactoring` (the reboot sequence shared out of
`handleRebootMachine`).
**Acceptance criteria:**
- A write to a box's manifest that changes its firmware row's version ends every active
  session on that box (the writer's and any other player's), mints a new boot-id, and
  appends the reboot `kern.log` line naming the address the writer's login came from.
- A write that moves the firmware row BACKWARDS also appends the `dpkg.log` rollback line
  (package, both versions, the writer's address), before the reboot.
- A manifest write that moves only service or library rows, or rewrites the firmware row
  at the same version, ends no session; a box whose manifest carries no firmware row
  never reboots. Both as today.
- If the reboot fails after the row has landed, the response says so (500
  `reboot_failed`) and `apt` prints reboot's own wording for it (`could not end active
  sessions — anyone connected may still be on this machine`), never `E: Failed to write`.
- `apt upgrade` that moves the firmware prints its rows, `Setting up …`, then `Firmware
  installed; rebooting to apply.`, then `Connection to <host> closed by remote host.`, and
  the shell is back on the box it came from. `apt install <vendor>-firmware=<old>` the
  same, sending no `recordDowngrade`. A service-only upgrade prints exactly what it does
  today.
- `man apt` carries the decision-6 sentence.
- Live, against `vercel dev` + supabase (`scripts/testFirmwareFlashReboot.ts`): two
  players' sessions on an AP gateway, one at root; a firmware-forward write ends both,
  leaves the boot-id and the `kern.log` line; a firmware rollback leaves the `dpkg.log`
  line too; a service-only write leaves both sessions open.
**RED:** the wire-check first, run against today's code — the live probe the grill named:
both sessions stay open. Then `upsertPatch.test.ts` cases with fake deps (forward,
backward, service-only, same version, no firmware row, reboot failure), and `apt.test.ts`
for the output and the skipped `recordDowngrade`.
**GREEN:** one predicate beside `isFirmwarePackage` (`packages/packageVersions.ts`) that
both `apt` and the server read, so the client's line and the server's reboot agree; the
L2 step hands back the tree it replayed; the reboot sequence after the gate moves out of
`handleRebootMachine` into a function both handlers call; `api/patches.ts` wires the
reboot's deps into the upsert.
**REFACTOR:** assess whether `pinVersion`'s firmware skip reads cleaner as the predicate
or as a branch in `env.apt`.
**Existing wire-checks to re-run** (each writes a gateway manifest and would now be
thrown off the box): `testExploitApGateway.ts` (walks the gateway's manifest),
`testExploitOwnLan.ts` (its firmware section walks the image first),
`testAptDowngradeTrace.ts`, `testRebootEvicts.ts`.
**PRE-PR MUTATION:** Stryker on the predicate, the firmware branch of `upsertPatch.ts`
and the shared reboot module, json reporter, one file at a time.
**Docs:** `vulnerability-architecture.md` (the firmware section's "`apt upgrade` on a
rooted gateway patches the firmware too", the defender's loop, the retired
"Reboot-to-flash is not modelled" cost), handbook 08, `cross-player-architecture.md`
where it lists what reboots a box, `backlog.md` (the patching item closed, pointing here
until close-out), the e2e skill if it stages a firmware downgrade.
**PR-ready when:** `npm run typecheck`, `npm run lint`, full vitest green; the new
wire-check and the four above pass live; version bumped in `package.json` and
`package-lock.json`; the owner approves the commit.

## Close-out

One browser run, two players: B roots an AP gateway; A holds a shell on the same gateway;
B runs `apt install <vendor>-firmware=<older>` — B is dropped with the two lines, A is
told on their next line; B comes back in, reads the rollback in `dpkg.log` and the reboot
in `kern.log`, runs `apt upgrade` and is dropped again; `snmpwalk`'s `sysDescr` names the
new image. Then the `project-status.md` item 6 entry, the backlog item, and this file
deleted.

### Superseded during the grill

Decided first, then revised when the owner made real behaviour the rule: a running
program keeping its release until restarted, on every axis; the running release stored
in the pidfile (`sshd:port=22,version=<v>`) and a `/var/run/firmware` file, a missing or
unreadable one reading as the start tuple; `apt` saying nothing about restarts; a
downgrade waiting for a restart (the "time bomb" at the owner's next reboot); hackademy
and the manuals stating the restart rule. Also rejected at the revision: flash with a
manual reboot (Cisco's model, the one vendor of six that does it).
