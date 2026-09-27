# Legacy white-hat investigations: `malware` and `forensics`

> **Legacy mission design, kept as inspiration for the missions rebuild.** Every `src/` path refers
> to git tag `legacy-final`, not to the current tree. Everything described here is simulated game
> data on the game's own fictional machines.

Two defender contracts. In `malware` the player cleans up a compromised box. In `forensics` the
player reads logs to work out who broke in and from where. This page covers how each one played,
what the generator planted, and what `mail` checked.

Both are white-hat objectives: the player is framed as an authorized contractor or investigator,
and the briefing hands over the target's root password. SSH entry is forced **only when the seed
names the objective** (`whiteHatObjective` in `src/generation/generateMission.ts`). `malware` is also
in the random objective pool, so a seed without the keyword could roll it without the forced SSH
entry (see [objectives.md](./objectives.md#7-design-notes-and-findings)). The mission board filed
seeds containing `forensics` or `malware` under **SECURITY CONTRACTS**, next to **DARKNET
CONTRACTS** (see [mission-loop.md](./mission-loop.md)).

## 1. Malware: "Identify and neutralize the malware"

### How it played

1. **Briefing** (`formatObjectiveHint` in `src/commands/accept.ts`): `Identify and neutralize the
   malware on <hostname>. Root password: <pw>`, then the hint "Find the malware, kill the process,
   and delete the malicious file to prevent re-execution."
2. **Target.** `pickTarget` chose a non-router, non-switch machine from the deepest layer, or any
   non-entry machine when there was only one layer.
3. **Find the process.** `ps` built its process list entirely from `/var/run/*.pid` files
   (`src/commands/ps.ts`). Generation dropped `/var/run/<pidName>.pid` on the target with the content
   `<targetPath>:port=1`, so the malware showed up as a root-owned process whose COMMAND was the full
   path of the planted file. `ps` revealed the process and pointed straight at the file.
4. **Stop the process.** `kill <pid>` (`src/commands/kill.ts`) deleted the matching pidfile. A
   non-root user got "Operation not permitted", so the player had to `su` with the password from the
   briefing.
5. **Delete the file.** It was created with `mkScript(..., 'root')` (`placeTargetFile` in
   `src/generation/filesystem/machineConfig.ts`). Everyone could read it, but only root could write
   or delete it.
6. **Inspect (optional).** Plain-script templates were readable with `cat`. Binary templates were
   wrapped in fake ELF noise (`wrapInBinaryNoise`, `src/generation/binary.ts`): `cat` showed garbage
   and `strings` recovered the indicator lines.

### What "neutralize" meant

| Step | Game state checked | Done by |
| --- | --- | --- |
| Process stopped | `/var/run/<pidName>.pid` is gone from the target | `kill <pid>`, which deletes the pidfile (a plain `rm` of the pidfile also passes) |
| Re-execution prevented | the planted file is gone from the target | `rm <path>` as root |

"Persistence" was **only a placement**. Nothing in the legacy runtime reads `/etc/cron.d`,
`/etc/init.d`, `rc.local`, `if-up.d`, `cron.daily`, `cron.hourly` or systemd units to relaunch
anything. A killed process never came back, and deleting the file did not stop the process. The two
steps were independent, and both were required.

### Verification (`verifyMalware` in `src/commands/mail.ts`)

`mail <client> <anything>` checked machine state as root, in this order:

1. The planted file still exists → `Malware is still on disk at <path>. Find and delete it.`
2. The pidfile still exists → `Malware process is still running. Use ps to find it and kill to stop it.`
3. Otherwise the mission is complete.

The proof text is ignored, but `mail` still **requires** some. `malware` is missing from the
content-optional list in `mail.ts`, so a bare `mail <client>` fails with "missing content",
contradicting the `mail` manual. The briefing's `done` example avoids the problem.

### Difficulty scaling (`selectMalwarePath` in `src/generation/attackChain.ts`)

| Difficulty | File name | Directory |
| --- | --- | --- |
| easy | visible (`cache-warmer.js`) | the standard directory for the template's location |
| medium | 50% dot-hidden (`.cache-warmer.js`) | the standard directory |
| hard | always dot-hidden | the standard directory, **except** `manual`-location templates, which go to one of five deep paths |

| Location | Directory |
| --- | --- |
| `cron.d` | `/etc/cron.d` |
| `init.d` | `/etc/init.d` |
| `if-up.d` | `/etc/network/if-up.d` |
| `cron.daily` | `/etc/cron.daily` |
| `cron.hourly` | `/etc/cron.hourly` |
| `rc.local` | `/etc` (directly in `/etc`, not inside an `rc.local` file) |
| `systemd` | `/etc/systemd/system` |
| `manual` | `/tmp`; on hard, one of `/var/lib/dpkg/.cache`, `/var/tmp/.update`, `/usr/local/share/.config`, `/opt/.service`, `/var/cache/apt/.tmp` |

Difficulty does not change which template is picked. The template is chosen uniformly from the
target's role pool.

## 2. Malware catalog

`src/generation/pools/malware.ts` holds 30 templates across 9 roles. Each has a family, a location,
a script name that looks like an ordinary service for that role, the file content, and a pidfile
name, which always equals the script name without `.js`. Binary templates contain lines of
indicator strings rather than code; for example `smbd-helper` names a ransomware family, a target
data directory and a shadow-copy deletion step. The script templates contain short Node programs
whose constants give the player something to find: an outside host, a wallet, a target path.

| Family | The story it tells |
| --- | --- |
| `cryptominer` | Mines for an outside wallet |
| `exfiltrator` | Sends data off the box |
| `reverse_shell` | Gives an outside host a shell |
| `ransomware` | Encrypts data for ransom |
| `credential_harvester` | Harvests credentials |
| `botnet_agent` | Takes orders from a command server |

| Role | Disguise (script name) | Family | Location | Binary? |
| --- | --- | --- | --- | --- |
| webserver | `cache-warmer.js` | cryptominer | cron.d | |
| webserver | `http-health.js` | reverse_shell | systemd | |
| webserver | `log-rotate.js` | exfiltrator | cron.daily | |
| webserver | `php-fpm-worker` | cryptominer | manual | yes |
| database | `db-watchdog.js` | credential_harvester | init.d | |
| database | `backup-agent.js` | ransomware | cron.hourly | |
| database | `replication-sync.js` | exfiltrator | cron.d | |
| database | `mysqld-safe` | credential_harvester | rc.local | yes |
| fileserver | `share-monitor.js` | ransomware | init.d | |
| fileserver | `disk-health.js` | botnet_agent | rc.local | |
| fileserver | `quota-check.js` | cryptominer | cron.daily | |
| fileserver | `smbd-helper` | ransomware | manual | yes |
| workstation | `vpn-keepalive.js` | reverse_shell | if-up.d | |
| workstation | `session-cleanup.js` | credential_harvester | cron.d | |
| workstation | `update-notifier.js` | exfiltrator | systemd | |
| mailserver | `queue-processor.js` | exfiltrator | cron.d | |
| mailserver | `relay-check.js` | botnet_agent | init.d | |
| mailserver | `spam-filter.js` | credential_harvester | cron.hourly | |
| iot | `sensor-daemon.js` | botnet_agent | rc.local | |
| iot | `firmware-updater.js` | cryptominer | cron.d | |
| iot | `mqtt-bridge.js` | reverse_shell | if-up.d | |
| iot | `modbus-poller` | botnet_agent | init.d | yes |
| dns | `zone-backup.js` | exfiltrator | cron.d | |
| dns | `dns-monitor.js` | credential_harvester | cron.hourly | |
| router (unreachable) | `traffic-analyzer.js` | exfiltrator | cron.d | |
| router (unreachable) | `wan-failover.js` | reverse_shell | init.d | |
| router (unreachable) | `route-monitor.js` | credential_harvester | cron.hourly | |
| switch (unreachable) | `port-stats.js` | exfiltrator | systemd | |
| switch (unreachable) | `stp-validator.js` | reverse_shell | rc.local | |
| switch (unreachable) | `vlan-audit.js` | botnet_agent | cron.daily | |

The router and switch templates exist only to fill the `Record<MachineRole, …>` type:
`pickTarget` never chooses a router or switch.

## 3. Forensics: "Investigate the breach"

### How it played

The briefing reads `Investigate the breach on <hostname>. Send us the attacker's alias and their
origin IP. Root password: <pw>`. The hint says to search the logs across machines and trace the
attacker's path. The player SSHes in with the given root password, reads logs machine by machine
backwards to the first hop, and mails both findings.

The attacker's handle is picked from the client handle pool, never the mission's own client, and
the origin is a generated public IP (the forensics branch of `buildMissionObjective` in
`src/generation/attackChain.ts`).

### Evidence (`src/generation/filesystem/forensicsEvidence.ts`)

The generator walks **every mission machine in generation order**, treating that order as the
attacker's path. The first hop comes from the attacker's public IP, and each later hop comes from
the previous machine's IP. For each hop it picks one log type and writes one log file:

| Log type | File | Attacker lines |
| --- | --- | --- |
| ssh | `/var/log/auth.log` | 1–3 failed root logins, then an accepted one. On hops after the first, 50% add an `su` to root from `operator` |
| ftp | `/var/log/vsftpd.log` | a connect, 1–2 failed `admin` logins, then a successful `root` login |
| http | `/var/log/access.log` | 2–4 recon GETs (`/robots.txt`, `/admin`, `/login`, `/.env`, `/api/config`), then `POST /admin/login` → 302 and `POST /admin/shell` → 200 |

Timestamps start at a fixed `2026-03-20T02:30:00Z` and advance hop by hop, so the attack reads as
one continuous timeline across machines.

**Noise.** Each log also gets red-herring lines from a pool of 16 IPs (internal and external) and 15
service usernames. The count scales with difficulty: easy 1–2, medium 3–5, hard 5–8 per log. Noise
logins succeed 70% of the time. Half the noise goes before the attacker's lines and half after, in
array order and whatever its own timestamp, so noise lines can appear out of chronological order.

**Calling card.** The last machine in generation order also gets one file named after the attacker,
picked from 15 templates. That machine is usually in the deepest layer, but it is not necessarily
the target.

| Calling card path | What it looks like |
| --- | --- |
| `/tmp/.<handle>` | a taunt: "<handle> was here" |
| `/opt/.backdoor.sh` | a persistence script signed by the handle |
| `/var/tmp/.<handle>.log` | an operator's progress log (exfil complete, covering tracks) |
| `/etc/cron.d/.<handle>` | a cron entry for auto-reconnect |
| `/tmp/.session_<handle>` | a session file with the handle, a timestamp and `EXFIL=complete` |
| `/var/log/.cleanup_<handle>.sh` | a log-cleanup script |
| `/tmp/.<handle>_exfil.tar.gz.part` | a partial-upload stub naming the stolen directory |
| `/opt/.<handle>_pivot.conf` | a pivot/tunnel config |
| `/etc/ld.so.preload` | a preload entry pointing at a hooked library |
| `/tmp/.<handle>_tools/recon.sh` | a recon toolkit script |
| `/var/tmp/.<handle>_keylog` | a keylogger dump showing the attacker's own `su` |
| `/root/.<handle>_note` | a taunting note to the owner |
| `/tmp/.rev.sh` | a call-home loop signed by the handle |
| `/etc/systemd/system/.<handle>.service` | a systemd unit that restarts the call-home script |
| `/var/spool/cron/crontabs/root` | root's crontab replaced by the attacker |

### Proof and verification (`verifyForensics` in `src/commands/mail.ts`)

The proof is split on spaces, commas, colons and hyphens. Both the handle and the IP must appear,
case-insensitive and in either order. These all pass:

```bash
mail client@darkmail.onion xR0gu3x:45.33.12.99
mail client@darkmail.onion "45.33.12.99 - xR0gu3x"
mail client@darkmail.onion "xR0gu3x, 45.33.12.99"
```

Fewer than two parts gives `Send both the attacker alias and their origin IP.`; wrong values give
`Incorrect findings. Identify the attacker alias and their origin IP from the logs.`

### Where mission-variations.md is wrong

- It says evidence is always `auth.log`. The code picks ssh, ftp or http per hop, and each writes
  its own log file.
- It says the trail follows the attack path to the target. The code walks every mission machine in
  generation order, and the calling card lands on the last one, which need not be the target.

## 4. Design notes worth keeping

- **Defender work on the same machinery.** Both objectives reuse the tools a black-hat player
  already has (`ps`, `kill`, `rm`, `cat`, `strings`, log reading). No new verbs were needed for a
  second play style.
- **`ps` as a pointer.** Showing the planted path as the process COMMAND made the first clue
  obvious, and the rest was about privileges (root to kill, root to delete). If a rebuild wants
  real hunting, the process listing has to stop naming the file.
- **Persistence was decoration.** The eight locations change the path and the flavour only. A
  rebuild that wants "kill it and it comes back" needs something that actually runs cron or boot
  entries, and v2's daemon model is the natural place for it.
- **Forensics teaches reading logs across hops.** Each hop's source IP is the previous machine's
  address, so the player has to walk backwards through the network to reach the public IP. The
  deeper the mission, the longer the trail.
- **Noise scales difficulty without new content.** The same generator gets harder on hard only
  because there are more plausible logins around the real ones.
- **Evidence is written at generation time, not by play.** Legacy logged real player actions
  separately (`src/logging/`), so forensics never used traces a real intruder left. v2 now logs real
  cross-player activity, which opens a forensics variant built on what another player actually did.
