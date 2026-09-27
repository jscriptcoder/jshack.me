# Legacy script missions: `script_fix` and `script_auto`

> **Legacy mission design, kept as inspiration for the missions rebuild.** Every `src/` path refers
> to git tag `legacy-final`, not to the current tree.

Two white-hat contracts where the puzzle is code: repair a broken monitoring script, or write one
from a stub. This page covers how they played, every template, and the rules that made them work.

| Concern | Legacy source |
| --- | --- |
| Templates | `src/generation/pools/scriptFix.ts`, `src/generation/pools/scriptAuto.ts` |
| Objective build | `src/generation/attackChain.ts` (`selectScriptFixFile`, `selectScriptAutoFile`, `buildObjective`) |
| `_system` while testing | `src/hooks/useCommands.ts` (`getSystemFn`), `src/commands/node.ts` |
| Verification | `src/commands/mail.ts` (`verifyScriptFix`, `verifyScriptAuto`), `src/utils/scriptRunner.ts` |
| Briefing | `src/commands/accept.ts` |
| File placement | `src/generation/filesystem/machineConfig.ts`, `src/generation/filesystem/generateFileSystems.ts` |

## 1. How they played

### script_fix

These are white-hat contracts: the player is hired to repair a broken monitoring script. The objective description
reads `Fix the broken script on <hostname>. Root password: <pw>`. The briefing hint says to find the broken
script, fix it with `nano`, test it with `node`, then `mail <client> done`. For the `corrupted` bug type it
adds "Look around the machine for the correct values." The script is a JS file under `/srv/scripts/` or
`/opt/scripts/` on the target, created with `mkScript(..., 'user')`, so anyone can read, write and execute it.
Each script filters a small hard-coded array. It checks the count of matches, and on success calls
`_system(<matches joined with "-">)`. On failure it calls `echo("ERROR: ... failed")`. The generator picks
one template for the target's role and one of the three bug variants with `prng.pick` (uniform, so about 1/3
each).

`_system` exists only inside `node` and only while a `script_fix`/`script_auto` mission is active
(`getSystemFn` in `useCommands.ts`). It returns `System check: PASS` when `String(value) === expectedChecksum`
and `System check: FAIL — script output is incorrect` otherwise. `mail <client> [anything]` takes no proof:
content is optional, and the word "done" is never checked. It reads the script back from the target as root
and re-executes it in `runScriptWithSystem`. That sandbox holds only a capturing `_system` and a no-op
`echo`. Mail then checks the last captured value against `expectedChecksum`. It gives a specific error for
each failure: file deleted, an execution error (quoted), `_system` never called, wrong value, or a script
that contains `await`, which is rejected as "unexpected async execution".

### script_auto

This is also a white-hat contract, with the description `Write and deploy the automated script on <hostname>. Root password: <pw>`.
The target holds a stub file made of comments only, at `/etc/cron.d/`, `/etc/init.d/` or
`/etc/network/if-up.d/`. The stub tells the player, in four numbered steps, to read or POST for some
JSON, parse it, pull out one named field, and `_system(field)`. The player writes the body with `nano`, tests it
with `node`, and runs `mail <client> done`. In the **local** flavor a JSON data file sits on the target
(owner `guest`, readable by everyone). In the **remote** flavor the stub names `http://<peerIp>/api/<endpoint>`.
The JSON sits on that peer at `/var/www/api/<endpoint>.json`, which the game's HTTP layer serves only
to `POST /api/<endpoint>` (`handlePost` in `src/network/http.ts`). `curl` returns async output, so a remote
solution has to `await curl(...)` and runs on node's async path.

Mail verification re-runs the script as for script_fix, with two changes. It strips every `await`. It also
injects a mock: for local, `cat()` ignores its argument and returns the data file's current content on the
target. For remote, `curl()` ignores its arguments and returns `[generationTimeJson]`. The source comment
says "the last element is the API response JSON", which matches awaited `curl` without `-i`, because the body
is a single `JSON.stringify` line.

### Where [mission-variations.md](./mission-variations.md) is wrong or incomplete

- **script_fix has 23 templates, not 18.** fileserver, database, webserver, workstation, iot and mailserver have
  3 each (18). **dns has 2**, router has 2 and switch has 1. The summary leaves dns out entirely.
- **script_auto has 26 templates, not 24.** Eight roles have 3 each, and **dns has 2**, which the summary also
  leaves out. Router and switch have 3 each, but they are never used: `buildMissionObjective` picks targets from
  `nonGatewayMachines`, so neither script pool is ever drawn for router or switch. The code comment admits this
  only in scriptFix.
- **"Peer machine with port 80" is not enforced.** `selectScriptAutoFile` picks the API host from every
  non-gateway machine other than the target and never checks for an open HTTP port. If the peer has no HTTP
  service, the in-game `curl` gets `Connection refused`, but mail verification still passes because it mocks
  `curl`.
- **The remote-to-local fallback leaves the stub wrong.** When no peer exists, the data moves to
  `/var/lib/<endpoint>.json`, but the stub keeps the unmodified remote instructions: "POST to
  http://{{apiIp}}/api/...", with the placeholder not replaced.
- **"SSH entry forced" and "port closures skipped" hold only for seed-keyword missions.** `whiteHatObjective` in
  `generateMission.ts` looks only at `overrides.objectiveType`. Port closures are keyed on a *separate*
  `prng.pick` over a 6-type list that does not include `script_auto`. `buildMissionObjective` then makes
  its own pick from an 8-type list that does include both. A seed with no keyword that rolls
  script_fix/script_auto therefore gets neither guarantee.
- **"`_system()` returns PASS/FAIL when testing" is true, but the player does not see it.** `node` prints nothing
  from `_system` on its own. It only returns the value. For a multi-statement script (every template),
  node's sync path returns only buffered `echo` output, and the async path streams only `echo`/`console.log`.
  The player sees PASS/FAIL only through `echo(_system(...))` or `console.log(...)`, or with a
  single-expression script. A fixed template run under `node` prints nothing, and a broken one prints its
  `ERROR:` line.
- **Bug types are rougher than described.** "Corrupted" sometimes replaces a whole data line
  (`const backups = ???`), but more often a single token: one array element, one field value, or the filter
  argument. In `verify_records.js` the `???` sits inside quotes (`status: "???"`). That is valid JS, so the
  corrupted script runs and prints ERROR instead of throwing. One logic variant does not break anything at
  all (`dns_health.js`, see below).

## 2. script_fix catalog (23 templates)

Every checksum is the matching items (or a field of them) joined with `-`. It is readable data, not a hash.
The "count" is the `if (x.length === N)` guard. Every hint file is a hidden dotfile in the script's own
directory, owned by `user` (readable by root and user, not guest), and placed only when the bug type is `corrupted`.

| Role | Script | Scenario (plain words) | Filters → reports (expected) | syntax bug | logic bug | corrupted (`???`) | Hint file = content |
|---|---|---|---|---|---|---|---|
| fileserver | `/srv/scripts/validate_backups.js` | Confirm the critical DB backups exist | backups starting `db`, need 2 → `db_full-db_diff` | `filter(` missing `)` | expects 3 | whole `backups` array | `.backup_list` = `backup_sources=[...]` |
| fileserver | `/srv/scripts/check_exports.js` | Check quarterly report exports | exports starting `report`, need 2 → `report_q1-report_q2` | closing `}` of else missing | expects 1 | `startsWith(???)` argument | `.export_config` = `filter_prefix="report"` |
| fileserver | `/srv/scripts/verify_permissions.js` | Flag world-writable shares | shares with `mode > 755`, need 1 → `/srv/upload` | `_system(` missing `)` | `mode > 777` (matches none) | `/srv/upload` mode | `.share_perms` = `upload_mode=777` |
| database | `/opt/scripts/verify_records.js` | Verify active records | `status === "active"`, need 3 → `1-3-4` (ids) | `_system(` missing `)` | filters `"inactive"` | record 3 status `"???"` (quoted, so it runs and prints ERROR) | `.record_data` = `record_3_status=active` |
| database | `/opt/scripts/audit_check.js` | Count logins and queries in an audit trail | count `login` and `query`, need 2 and 2 → `2-2` | unterminated `"query)` | expects 3 queries | whole `entries` array | `.audit_entries` = `entries=[...]` |
| database | `/opt/scripts/check_replication.js` | Find replicas that are in sync | nodes with `lag < 60`, need 3 → `db-primary-db-replica2-db-replica3` | closing `}` missing | expects 4 | `db-replica1` lag | `.repl_status` = `db-replica1_lag=120` |
| webserver | `/srv/scripts/check_endpoints.js` | List API routes | endpoints starting `/api/`, need 3 → `/api/users-/api/health-/api/admin` | `} else` loses its `}` | expects 4 | 3rd endpoint | `.endpoint_list` = `endpoint_3="/api/admin"` |
| webserver | `/srv/scripts/validate_certs.js` | Validate cert files | names ending `.pem`, need 3 → `web.pem-api.pem-mail.pem` | `if (... === 3 {` | expects 2 | 2nd cert | `.cert_list` = `cert_2="api.pem"` |
| webserver | `/srv/scripts/check_vhosts.js` | Find HTTPS vhosts | `ssl === true && port === 443`, need 2 → `api.corp.local-www.corp.local` | unterminated string in the else `echo` | filters `port === 8080` | staging `ssl` | `.vhost_config` = `staging_ssl=false` |
| workstation | `/opt/scripts/verify_access.js` | List privileged users | `admin` or `operator`, need 2 → `admin-operator` | unterminated string in `echo` | filters only `admin` | 2nd user | `.user_list` = `user_2="operator"` |
| workstation | `/opt/scripts/check_projects.js` | List urgent projects | `priority === "high"`, need 2 → `alpha-gamma` | `_system(` missing `)` | filters `"low"` | beta priority | `.project_data` = `beta_priority="low"` |
| workstation | `/opt/scripts/scan_ports.js` | List exposed services | `state === "open"`, need 3 → `ssh-https-mysql` (svc names) | `if (... === 3 {` | filters `"closed"` | port 80 state | `.port_scan` = `port_80_state="closed"` |
| iot | `/opt/scripts/check_sensors.js` | Keep in-range temperature readings | readings in 18–25, need 4 → `22.5-18.3-24.7-19.8` | `_system(` missing `)` | expects 5 | 2nd reading | `.sensor_log` = `reading_2=25.1` |
| iot | `/opt/scripts/device_health.js` | List online cameras | `status === "online"`, need 2 → `cam-01-cam-03` | closing `}` missing | filters `"offline"` | cam-02 status | `.device_status` = `cam-02_status="offline"` |
| iot | `/opt/scripts/check_firmware.js` | Find outdated firmware | `ver !== latest`, need 1 → `cam-01:1.0.3` (`id:ver`) | `filter(` missing `)` | `===` (matches 2 up-to-date) | cam-01 ver | `.firmware_versions` = `cam-01_ver="1.0.3"` |
| mailserver | `/opt/scripts/filter_spam.js` | Count spam messages | `=== "spam"`, need 3 → `spam-spam-spam` | `_system(` missing `)` | expects 2 | 2nd message | `.message_log` = `message_2="spam"` |
| mailserver | `/opt/scripts/validate_mailboxes.js` | Find over-quota mailboxes | `quota === "full"`, need 2 → `admin-hr` | closing `}` missing | filters `"ok"` | ceo quota | `.mailbox_status` = `ceo_quota="ok"` |
| mailserver | `/opt/scripts/check_queues.js` | Find stuck mail queues | `count > 0` and not inbox, need 2 → `deferred:37-bounce:8` (`name:count`) | closing `}` missing | expects 3 | outbox count | `.queue_status` = `outbox_count=0` |
| dns | `/srv/scripts/check_zones.js` | List active zones | zones other than `cache`, need 3 → `mission-internal-reverse` | `if (... === 3 {` | expects 4 | whole `zones` array | `.zone_list` = `zones=[...]` |
| dns | `/srv/scripts/dns_health.js` | Summarize record-type counts | `count > 0`, need 3 → `A:24-CNAME:6-PTR:12` (`type:count`) | `filter(` missing `)` | `count > 5`: **no-op, since 24/6/12 all still pass, so the unmodified script already reports the right value** | A count | `.record_counts` = `a_records=24` |
| router (unused) | `/opt/scripts/check_routes.js` | List internal routes | starts `10.` or `172.`, need 2 → `10.0.0.0/24-172.16.0.0/16` | `filter(` missing `)` | expects 3 | 1st route | `.route_config` = `route_1="10.0.0.0/24"` |
| router (unused) | `/opt/scripts/verify_firewall.js` | Count ACCEPT rules | `=== "ACCEPT"`, need 3 → `ACCEPT-ACCEPT-ACCEPT` | unterminated string in `echo` | filters `"DROP"` | 2nd rule | `.fw_rules` = `rule_2="DROP"` |
| switch (unused) | `/opt/scripts/check_acls.js` | Count allow ACLs | `=== "allow"`, need 3 → `allow-allow-allow` | unterminated string in `echo` | filters `"deny"` | 2nd ACL | `.acl_rules` = `rule_2="deny"` |

The logic bugs come in two kinds: a **wrong expected count** (the guard disagrees with the data) or a
**wrong filter predicate** (the opposite value or the wrong comparison). Every template follows the same idea:
the correct answer can be worked out by reading the data by hand, so the player can check the fix against their
own count.

Representative shape (`validate_backups.js`, `logic` variant, where the guard should be `2`):

```js
const backups = ["db_full", "db_diff", "logs", "config"]
const critical = backups.filter(b => b.startsWith("db"))
if (critical.length === 3) {
  _system(critical.join("-"))
} else {
  echo("ERROR: backup validation failed")
}
```

## 3. script_auto catalog (26 templates)

`location` maps to `/etc/cron.d/`, `/etc/init.d/` and `/etc/network/if-up.d/`. For remote templates the data column is
the API endpoint. The JSON is served at `POST http://<peer>/api/<endpoint>` from `/var/www/api/<endpoint>.json`.
For local templates it is the absolute file on the target. Every data JSON carries 3-4 decoy fields next to the target field.

| Role | Script | Location | Flavor | Stub narrative | Data | Field → expected |
|---|---|---|---|---|---|---|
| fileserver | `raid-check.js` | init.d | remote | RAID array health check on boot | `raid-status` | `array_key` → `raid-6c2a9f4b1e` |
| fileserver | `backup-verify.js` | cron.d | local | Backup integrity check every 6 h | `/var/lib/backup/status.json` | `checksum` → `f7a3c9b1e2d4` |
| fileserver | `nfs-health.js` | if-up.d | remote | NFS share availability on network up | `nfs-status` | `share_token` → `nfs-8e4f2a1b7c` |
| database | `db-failover-check.js` | if-up.d | local | Standby DB readiness on network up | `/var/lib/db/failover.json` | `standby_key` → `stby-3e7a1c9f4b` |
| database | `db-health.js` | cron.d | remote | Replication lag every 15 min | `replication` | `sync_key` → `rep-4d8f1a2e9b` |
| database | `db-config-check.js` | init.d | local | Validate DB cluster config on boot | `/etc/db/cluster.json` | `auth_token` → `clu-7b2e9f3a4d` |
| webserver | `vhost-validate.js` | init.d | remote | Upstream proxy status on boot | `proxy-health` | `proxy_token` → `prx-8f1b2e7c4a` |
| webserver | `ssl-monitor.js` | cron.d | local | Daily cert expiry check | `/etc/ssl/cert-status.json` | `fingerprint` → `ssl-a9c3f2b7e1` |
| webserver | `cdn-ping.js` | if-up.d | remote | CDN origin reachability on network up | `cdn-health` | `origin_key` → `cdn-5e8b1f3a7d` |
| mailserver | `relay-auth.js` | if-up.d | remote | Authenticate with upstream mail relay | `relay-auth` | `relay_token` → `rly-4b9c1e7a2f` |
| mailserver | `queue-check.js` | cron.d | remote | Mail queue depth every 10 min | `mail-queue` | `queue_token` → `mq-2c9a4f7b1e` |
| mailserver | `spam-filter-init.js` | init.d | local | Load spam rules on boot | `/etc/mail/filter-config.json` | `ruleset_hash` → `spf-6d1b8e3a9c` |
| iot | `mqtt-connect.js` | init.d | remote | Connect to MQTT broker on boot | `mqtt-status` | `broker_key` → `mqtt-7a2f4c9b1e` |
| iot | `sensor-poll.js` | cron.d | local | Poll sensor readings every 5 min | `/var/lib/sensor/latest.json` | `device_key` → `iot-3f7a2c9b1e` |
| iot | `gateway-register.js` | if-up.d | remote | Register gateway with central hub | `gateway-register` | `registration_id` → `gw-8b4e1f2a7c` |
| workstation | `ntp-sync.js` | if-up.d | local | Time-sync validation on network up | `/var/lib/ntp/sync-status.json` | `sync_hash` → `ntp-1e9b4a7c2f` |
| workstation | `ldap-sync.js` | cron.d | remote | Directory sync every 30 min | `ldap-sync` | `sync_token` → `ldap-1a9c4f7b2e` |
| workstation | `vpn-config-load.js` | init.d | local | Load VPN tunnel config on boot | `/etc/vpn/tunnel.json` | `psk_hash` → `vpn-5c2e8a1f9b` |
| dns | `zone-sync.js` | cron.d | remote | Hourly zone sync with secondary NS | `zone-sync` | `sync_token` → `zone-4b8c2a1f7e` |
| dns | `cache-flush.js` | init.d | local | Flush stale DNS cache on boot | `/var/cache/bind/cache-state.json` | `flush_key` → `dns-7e2f4c9a1b` |
| router (unused) | `wan-failover.js` | init.d | local | Load WAN failover settings on boot | `/var/lib/routing/wan-config.json` | `failover_key` → `wan-9b1e4a7c2f` |
| router (unused) | `route-monitor.js` | cron.d | local | Route anomaly check every 10 min | `/var/lib/routing/state.json` | `route_hash` → `rt-7f3a1c9b2e` |
| router (unused) | `upstream-check.js` | if-up.d | remote | Upstream router reachability | `upstream-status` | `peer_key` → `bgp-4e8b2f1a7c` |
| switch (unused) | `stp-validate.js` | init.d | remote | Validate spanning-tree topology on boot | `stp-topology` | `topology_key` → `stp-2f7c4a9b1e` |
| switch (unused) | `port-stats.js` | cron.d | local | Port utilization stats every 5 min | `/var/lib/switch/port-stats.json` | `stats_hash` → `sw-9a1c3f7b2e` |
| switch (unused) | `vlan-sync.js` | if-up.d | remote | Sync VLAN DB with management server | `vlan-db` | `vlan_token` → `vlan-2e7c4a9f1b` |

In the roles that are actually used, the flavor split is 9 local and 11 remote. Every template's stub follows the same
fixed four steps. Only the narrative header, the source (a file path or a POST URL) and the field name change.

Representative stub (`raid-check.js`, remote; `{{apiIp}}` is replaced with the peer's IP at generation):

```js
// Init script: RAID array health check
// Verifies RAID controller status on boot.
//
// 1. POST to http://{{apiIp}}/api/raid-status
// 2. Parse the JSON response
// 3. Extract the "array_key" field
// 4. Report: _system(array_key)
```

## 4. Design notes worth keeping

- **Verification re-executes the player's artifact rather than taking a proof string.** Mail reads the file back
  as root and runs it. The mission is complete only when the code works, so the player can't submit a value
  they read somewhere else.
- **But only the reported value is checked, not how it was derived.** A script that does just
  `_system("db_full-db_diff")` passes both missions. There is no check that the script actually reads the data.
- **The verification sandbox is much narrower than `node`.** `runScriptWithSystem` provides only `_system`, a no-op
  `echo`, and the flavor's mock (`cat` or `curl`). Any other game command, `sleep`, or `process.argv` that
  worked under `node` fails at mail time with "X is not defined". The narrow sandbox keeps verification
  hermetic and synchronous, and the cost is a behaviour gap between test and submit.
- **Sync vs async is detected by `/\bawait\b/`, in both `node` and the runner.** A script containing `await` is
  compiled with the `AsyncFunction` constructor. Otherwise the runner tries an expression first
  (`return (${content})`) and falls back to statement mode. The expression attempt lets a one-liner's value be
  shown.
- **`script_auto` strips `await` before verifying,** because the mocks are sync. Mail verification can then stay
  synchronous and throw immediately (`verifyProof` runs sync). `script_fix` does not strip `await`. It rejects
  any `await` as "unexpected async execution", because those scripts never need it.
- **Mocks ignore their arguments.** `cat()` returns the target's data file whatever path is passed, and `curl()`
  returns the generation-time JSON whatever URL or method is used. This removes network and permission flakiness
  from verification. It also means a local verify sees the player's *edits* to the data file, while a remote
  verify never does.
- **An error after a successful `_system` call behaves differently in the two paths.** In async mode the error
  is dropped when a value was captured. In sync mode any throw discards the captured value
  (`scriptRunner.test.ts`: "sync script error prevents returning captured value").
- **The last `_system` call wins.** The runner overwrites `captured` on every call, so a script can report more
  than once and only the final value counts.
- **Deterministic, readable checksums.** Each expected value is a literal in the template (joined names, `id:ver`,
  `type:count`), not a hash. A player can work out the right answer by reading the data and check their fix
  against it.
- **In script_fix, the success value is always guarded by a count check.** The data, the filter and the expected
  count all have to agree, so any one of the three bug kinds sends the script down the `echo("ERROR ...")`
  branch. The one exception is `dns_health.js` logic (`count > 5`), where the "bug" does not change the result.
- **The corrupted hint is on the same machine, in the same directory, hidden as a dotfile.** The placement code
  merges it into the script's leaf directory. Otherwise `buildNestedDirs` would overwrite the script
  (`machineConfig.ts`). The hint's `key=value` format means the player has to translate the value back into
  JS syntax, for example keep or add quotes.
- **Hint and data permissions are deliberate.** Scripts are `mkScript(..., 'user')`, so anyone can
  read, write and execute them. script_fix hints are user-owned, so a guest cannot read them. script_auto data
  files are guest-owned, so anyone can read them.
- **The briefing hands over the root password** (`credentials[target].find(root)`, `?? 'unknown'`). The
  contractor fiction means no infiltration is needed, and play goes straight to the scripting puzzle.
- **Remote data is served only on POST.** `handlePost` maps `/api/<name>` to `/var/www/api/<name>.json`, while
  GET reads `/var/www/html/...`. That makes "POST" in the stub a real requirement. Inside a script, `curl`
  separates flags from the URL by a leading `-`. `curl("-X POST", url)` works. `curl("-X", "POST", url)`
  treats `POST` as the URL.
- **The remote API host is picked with no HTTP check,** from non-gateway peers other than the target. If there
  are no peers the flavor falls back to local, with data at `/var/lib/<endpoint>.json`. That fallback does not
  rewrite the stub text (see section 1).
- **Script location is flavor text in `script_auto`.** cron.d, init.d and if-up.d change only the path and the
  narrative. Nothing schedules or triggers the script. Malware has its own location map with the same three entries plus
  `cron.daily`, `cron.hourly`, `rc.local`, `systemd` and a manual location for hiding.
- **Router and switch templates exist only to satisfy `Record<MachineRole, ...>`.** Targets are always drawn
  from non-gateway machines, so those pools are unreachable.
