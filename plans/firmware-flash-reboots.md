# A firmware flash reboots the router — grill record

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

Consequences, confirmed with the decisions: a root hand-editing the firmware row reboots
the router; an intruder's firmware downgrade throws them off and everyone on the box sees
the reboot; patching a gateway whose `/boot/vmlinuz` is gone bricks it; the vulnerability
doc's "Reboot-to-flash is not modelled" cost is retired and its "a patched daemon needs a
restart" note becomes "real behaviour, already matched".

Delivery: one slice — a live probe first (a gateway's firmware patched, nobody evicted),
then TDD on the server write path, a wire-check proving the eviction live, apt's output
and the `man apt` sentence, docs and a version bump; one browser close-out run.

### Superseded during the grill

Decided first, then revised when the owner made real behaviour the rule: a running
program keeping its release until restarted, on every axis; the running release stored
in the pidfile (`sshd:port=22,version=<v>`) and a `/var/run/firmware` file, a missing or
unreadable one reading as the start tuple; `apt` saying nothing about restarts; a
downgrade waiting for a restart (the "time bomb" at the owner's next reboot); hackademy
and the manuals stating the restart rule. Also rejected at the revision: flash with a
manual reboot (Cisco's model, the one vendor of six that does it).
