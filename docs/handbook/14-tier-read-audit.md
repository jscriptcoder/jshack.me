# 14. What reaches past a session's tier

An audit of every place the game reads a machine's files without asking whether the session may:
each client call site, and the body of each server response. Read against the code at v0.369.0
(commit `e7f7c94a`, 2026-10-12). Line numbers are that commit's. The audit was done by reading;
nothing in it was run unless a row says so.

The rule it checks is the one in [chapter 9](./09-persistence-and-multiplayer.md): **nothing a
session's tier cannot read leaves the server for that player.** Every row marked as a defect has
been fixed since (v0.370.0 to v0.375.0), so no row says defect any more. A reader added later gets
a row here in the pull request that adds it.

## How to read the tables

A machine is read in one of two ways.

- **Served.** The server builds the box, prunes the tree to the session's tier and sends it
  (`resolveCrossPlayerFs`). Since v0.374.0 that is every box that is not the player's own
  workstation: another player's, an access point's gateway, and every machine a network
  generates. The tree also carries every file on the externally-observable list, each with its own
  permissions (v0.371.0).
- **Rebuilt.** The browser generates the box and replays the raw journal over it. Since v0.374.0
  that is the player's own workstation and nothing else, and `listPatches` hands the journal to
  nobody but its owner. Until then every machine a network generates was rebuilt too, from a
  journal that carried rows above the session's tier.

Two calls on the client skip the permission check on purpose. `fs.stat(path)` returns the node at
a path whoever asks, and `fs.root()` returns the whole tree (`core/filesystem/fsView.ts`).
Machinery uses them to act as the box rather than as the player: a daemon reading its own pidfile,
`su` reading `/etc/passwd`. On a rebuilt machine they see everything. On a served one they see
only what the server sent, so a reader that needs a file above the session's tier finds nothing.
Each row says which of the two matters for that reader.

The verdicts:

| Verdict    | Meaning                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **fine**   | Reads nothing above the tier, or only a file every tier may read, or only runs on the player's own workstation.                |
| **list**   | Reads a file on the externally-observable list (`EXTERNALLY_OBSERVABLE_ALLOWLIST`), which a stranger is already served.        |
| **server** | Needs a file the tier cannot read, so the server has to give the answer instead of the file.                                   |
| **defect** | Wrong today, or wrong as soon as the machine is served, and not yet fixed. Each one is listed under [Defects](#defects) below. |

## Result

- **Client:** 85 calls to `stat` or `root()` in 39 files. 65 are fine, 9 depend on the
  externally-observable list, and 11 belonged to two defects, both fixed since: a local exploit
  (v0.372.0) and `chmod` (v0.375.0). One of the 65 is `su`, which read
  `/etc/passwd` on a generated machine until v0.370.0 moved it to the server. The places `ui/state.ts` and `webHost.ts` hand a whole tree on to a helper are listed
  beside the reader they feed.
- **Server:** 45 response bodies over four endpoints (`network` 14, `patches` 10, `sessions` 18,
  `wallet` 3). Earlier counts of 39 left out each endpoint's fallthrough action and two of the
  wallet's three requests. One body carried files above the caller's tier (`listPatches`, closed in
  v0.374.0). One handler read the wrong file (`suElevate`, fixed in v0.370.0). The rest are fine.
- The browser holds no database client. The four endpoints are the whole surface, and every table
  has row-level security on with no policy.

## Defects

| #   | Defect                                                                                                                                                                                                                                                                                                                               | Where                                                                | Fix                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | A visitor on a generated machine receives its raw journal.                                                                                                                                                                                                                                                                           | `listPatches`                                                        | Fixed in v0.374.0: those machines are served.             |
| 2   | `su` on a generated machine reads `/etc/passwd` in the browser, and the new tier is never recorded on the server.                                                                                                                                                                                                                    | `commands/su.ts:69`                                                  | Fixed in v0.370.0: the server answers `su`.               |
| 3   | `suElevate` checks the password against the workstation as it was generated, not as it is. A password an exploit reset is accepted by `ssh` and refused by `su`. It also resolves only a player's workstation, so `su` on the access point's gateway answers `host_unreachable`.                                                     | `sessions/authElevateSession.ts`                                     | Fixed in v0.370.0, measured first.                        |
| 4   | A local exploit (`msfconsole --local`) on a generated machine runs in the browser: it reads the tree at the tier the exploit grants, which is above the session's, and the shell it lands is never recorded on the server. On the access point's gateway the request goes to the server, which resolves only a player's workstation. | `commands/msfconsole.ts` (10 sites), `exploitLocalElevate`           | Fixed in v0.372.0: the server answers `--local`.          |
| 5   | A scan, a login or a transfer aimed at the layer behind a switch reads the switch's `acl.conf` off the shell's own tree. The file is root-only, so a lower-tier shell on a served switch would treat every port as allowed.                                                                                                          | 7 sites, see [the reach of a deep layer](#the-reach-of-a-deep-layer) | Fixed in v0.371.0: a session is served the list.          |
| 6   | `chmod` maps the `u` in a mode to the owner's tier by reading `/etc/passwd`. A `guest` session on a served box has no such file, so every owner reads as `guest`.                                                                                                                                                                    | `commands/chmod.ts:161`                                              | Fixed in v0.375.0: `u` is refused without the file.       |
| 7   | `suElevate` never asked whether the caller held a session on the machine, so the root password alone gave a `root` row on a workstation, with every door shut. Found while defect 3 was measured.                                                                                                                                    | `sessions/authElevateSession.ts`                                     | Fixed in v0.370.0: no session, no `su`.                   |

Defects 1, 2 and 5 were known before the audit. 3, 4 and 6 are what it found, with 6 already
suspected. 7 is not a read past a tier; it turned up on the live stack while 3 was being measured,
in the same handler. All seven are fixed. The last was 6 (v0.375.0): `chmod` asks for
`/etc/passwd` through the session's own reader, on every box including the player's own, and
refuses a mode naming `u` when the read fails.

## The files machinery reads

Most rows below come down to which file is read and who may read it.

| File                                                | Readable by                                | On the externally-observable list |
| --------------------------------------------------- | ------------------------------------------ | --------------------------------- |
| `/var/run/*.pid`                                    | every tier                                 | yes                               |
| `/var/run/boot-id`                                  | every tier                                 | yes                               |
| `/var/lib/dpkg/status`                              | every tier                                 | yes                               |
| `/etc/snmp/snmpd.conf`                              | every tier                                 | yes                               |
| `/var/www/**`                                       | every tier, unless somebody narrows a page | yes                               |
| `/boot/vmlinuz`, `/boot/initrd.img`                 | every tier                                 | no                                |
| `/bin`, `/usr/bin`, `/lib/*.so`                     | every tier                                 | no                                |
| `/usr/share/wordlists/passwords.txt`, `dirlist.txt` | every tier                                 | no                                |
| `/etc/passwd`                                       | `root`, `user`                             | no                                |
| `/etc/iptables/rules.v4`                            | `root`                                     | yes                               |
| `/etc/switch/acl.conf`                              | `root`                                     | yes                               |
| `/var/lib/mysql/data.json`, the redis store         | `root`                                     | no                                |

## Client readers

`commands/` and the other folders are under `src/core/`. A row with several line numbers is that
many call sites doing the same thing.

### Paths the player names

These ask whether a path exists and what kind of node it is. None of them prints content.

| Site                                             | Reads                                                                                   | Verdict |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- | ------- |
| `filesystem/writeTarget.ts:38, 43`               | The target of `>`, of a script's `writeFile` and of an exploit's write, and its parent. | fine ¹  |
| `shell/runLine.ts:410`, `scripting/fsApi.ts:156` | Owner and permissions of a file about to be appended to, after the write was allowed.   | fine    |
| `filesystem/walkTree.ts:40`                      | A child that a permitted listing already named. `grep -r` then reads through `read`.    | fine    |
| `commands/ls.ts:71, 81, 83`                      | Entries of a directory `list` already allowed.                                          | fine    |
| `commands/ls.ts:118`                             | `ls -l <file>`: owner, permissions and size of a file named by path.                    | fine ¹  |
| `commands/mkdir.ts:58, 93`                       | Whether each segment exists.                                                            | fine ¹  |
| `commands/touch.ts:37, 40`                       | Whether the path and its parent exist.                                                  | fine ¹  |
| `commands/rm.ts:47`                              | Whether the path exists and is a directory.                                             | fine ¹  |
| `commands/gpg.ts:180`                            | Whether the `.gpg` output already exists.                                               | fine ¹  |
| `commands/scp.ts:124, 147, 149`                  | The local source's node, and where a download lands.                                    | fine ¹  |
| `commands/wallet.ts:84, 85, 111, 125`            | Whether the home, `.wallet` and `wallet.dat` exist.                                     | fine ¹  |
| `commands/apt.ts:178, 232, 237`                  | Whether a library, a package's extra file or its parent directories exist.              | fine ¹  |
| `commands/ftpShell.ts:109`                       | Whether the landing path of a transfer exists.                                          | fine ¹  |
| `ui/state.ts:1547`                               | Whether the file `nano` is saving exists.                                               | fine ¹  |
| `ui/state.ts:1868`                               | Whether a tab-completion candidate is a directory.                                      | fine ¹  |

¹ `stat` does not check that the directories above a path can be entered. On a whole tree (the
player's own box) the wording of a refusal therefore tells a player that a path exists inside a
directory they cannot open, and `ls -l` prints its owner, permissions and size. A served tree has
no such node, so since v0.374.0 this happens on no box that is not the player's: a path above the
tier reads `No such file or directory`. Writes are safe either way: the server judges each one against
the real tree (`enforceRemoteWriteL2`), so a write composed without seeing a node is still refused
where it should be. What a write that wrongly claims `is_new` does to an existing row was not
traced.

### Programs and libraries

| Site                              | Reads                                                          | Verdict |
| --------------------------------- | -------------------------------------------------------------- | ------- |
| `commands/availability.ts:75, 85` | A binary in `/bin` or `/usr/bin`.                              | fine    |
| `commands/ldd.ts:56`              | The binary `ldd` was asked about.                              | fine    |
| `commands/libraryDeps.ts:88`      | Whether `/lib/<library>.so` is a file.                         | fine    |
| `shell/runLine.ts:200`            | A carried tool run by path. Its execute permission is checked. | fine    |

### What the box is running

| Site                                                                                                | Reads                                                                                            | Verdict |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| `commands/ps.ts:107`, `kill.ts:64`, `nc.ts:282, 289`, `daemon.ts:147`, `shell/runLine.ts:125`       | Pidfiles of the box the shell stands on.                                                         | fine    |
| `commands/ftp.ts:262`, `ssh.ts:331`, `scp.ts:403`, `mysql.ts:220`, `redisCli.ts:104`, `nmap.ts:477` | Pidfiles, and the package manifest for versions, when the target is the shell's own box.         | fine    |
| `shell/runLine.ts:141`, `ui/state.ts:597`                                                           | `/var/run/boot-id`, to notice a reboot.                                                          | fine ²  |
| `commands/reboot.ts:141`                                                                            | The two kernel files. `reboot` is root's.                                                        | fine    |
| `commands/apt.ts:332, 357, 433, 554, 579`                                                           | The package manifest.                                                                            | fine    |
| `commands/daemon.ts:211`                                                                            | `snmpd.conf`, for a read-write community to take in on start. Starting a daemon is root's.       | fine    |
| `packages/aptPackages.ts:240, 268`                                                                  | Root's hash in `/etc/passwd`, to seed a database or store being installed. Installing is root's. | fine    |

² Once a session ends, the server serves its holder the externally-observable list, which carries
the marker, from the network on the row that ended (v0.373.0). Since v0.374.0 a shell on a
generated machine reads the served tree, so it learns of a reboot as a shell on a player's
workstation does. Before that the refused journal came back empty, and on a box that had never
rebooted a missing marker read the same as the one the shell arrived with.

### The reach of a deep layer

All seven call `resolveDeepScanHosts(essid, fronting, env.fs.root())`, which reads
`/etc/switch/acl.conf` off the tree the shell stands on to drop the ports a switch denies.

| Site                                                                                                           | Verdict |
| -------------------------------------------------------------------------------------------------------------- | ------- |
| `commands/nmap.ts:315`, `ssh.ts:441`, `scp.ts:530`, `ftp.ts:352`, `nc.ts:134`, `ping.ts:104`, `webHost.ts:142` | list    |

A switch is served since v0.374.0. A session holder is served the externally-observable list as
well as its tier's view (`filterTreeForSession`, v0.371.0), so these still find `acl.conf` there at
any tier. Measured on the live stack first: a `guest` or `user` session on the access point's
gateway was not served `rules.v4`, and neither was served a page narrowed to `root` that a caller
with no session was.

### Web pages

| Site                                                                                                                          | Reads                                                                                                   | Verdict |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| `commands/curl.ts:134`, `lynx.ts:88`, `gobuster.ts:239`, `ui/state.ts:1627` (handed on to `webHost.ts:127`, `webPage.ts:168`) | `/var/www` on the box the shell stands on, read as the web server, when the address is the shell's own. | list    |
| `commands/webHost.ts:138, 146`                                                                                                | Removed in v0.382.0: another box on the LAN or a deep layer is served (`resolveOccupantFetch`).          | fine ³  |

A page under `/var/www` is world-readable unless somebody narrows it, and the list carries the
whole directory. A session holder is served the list (v0.371.0), so a lower-tier shell fetching
`localhost` gets what a stranger outside gets. Another player's workstation is already answered by
the server (`resolveOccupantFetch`).

³ Seeded content is computable from the ESSID by any client, which is the accepted limit of this
work. Until v0.382.0 a LAN fetch never replayed the journal, so a page somebody changed on a
generated box was served as generated to a reader on its LAN. Since then the server serves every
web read of a box that is not the player's own workstation at home, from its journal.

### Accounts

| Site                                                                        | Reads                                                                                                                                                                             | Verdict  |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `commands/su.ts:69`                                                         | `/etc/passwd`, on the player's own workstation only. Elsewhere `su` asks the server (v0.370.0).                                                                                   | fine     |
| `commands/chmod.ts:142`                                                     | The node being changed, after which `canWrite` is asked.                                                                                                                          | fine     |
| `commands/chmod.ts:169`                                                     | `/etc/passwd`, for the tier of the node's owner, once the session's own read of the file has succeeded. A mode naming `u` is refused otherwise (v0.375.0).                        | fine     |
| `commands/msfconsole.ts:649, 679, 707, 790, 803, 855, 857, 862, 1002, 1026` | The whole tree at the tier a local exploit grants, `/etc/passwd`, and the package manifest, on the player's own workstation only. Elsewhere `--local` asks the server (v0.372.0). | fine     |
| `commands/msfconsole.ts:994`                                                | The tree held for the box the shell stands on, handed to the script a local fire runs before it is sent. Pruned wherever the box is served.                                       | fine     |
| `commands/ownBoxLogin.ts:50`                                                | `/etc/passwd` of the player's own box, for a login over `localhost`. Home only.                                                                                                   | fine     |

### The player's own workstation only

| Site                                    | Reads                                                              | Verdict |
| --------------------------------------- | ------------------------------------------------------------------ | ------- |
| `commands/mysqlOwnBox.ts:113, 146, 181` | The database file, for the local door.                             | fine    |
| `commands/redisOwnBox.ts:104, 137`      | The store file, for the local door.                                | fine    |
| `boot/firstBoot.ts:89`                  | The first-boot marker.                                             | fine    |
| `ui/state.ts:952, 1692`                 | Write permission for a login to the own box, and whether it boots. | fine    |

### Where the tree comes from

`ui/state.ts:1546, 1857, 2009` build the shell's view from `activeRoot()` at the session's tier,
which is the ordinary checked path. `activeRoot`, `ftpRoot`, `scpTargetTree`, `refreshServedRoot`
and `reloadActiveRoot` choose between the served and the rebuilt source. Since v0.374.0 they all
ask one question, whether the machine is the player's own workstation (`isServedBox`).

## Server responses

Every handler verifies the signed envelope first, and every refusal is `{ error }` with nothing
else in it, apart from the two noted. Error codes were not audited as a channel: which refusal a
caller gets can still tell them a file or an account exists.

### `POST /api/network`

| Action                                                                 | Body on success                                              | What it is read from                                                                                                                                                                 | Verdict |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `registerNetwork`                                                      | `local_ip`                                                   | The caller's own lease.                                                                                                                                                              | fine    |
| `unregisterOccupant`                                                   | `ok`                                                         |                                                                                                                                                                                      | fine    |
| `resolveOccupants`                                                     | Each fellow occupant's machine id, LAN address, machine name | Occupancy and leases. Only for a caller standing on that LAN.                                                                                                                        | fine    |
| `resolveOccupiedEssids`                                                | `essids`                                                     | Occupancy.                                                                                                                                                                           | fine    |
| `resolveCrossPlayerFs`                                                 | `tree`                                                       | The whole box. Full for its owner, tier view plus the list for a session, the list for anyone else on a workstation and for a caller whose row on a box the network makes has ended. | fine ⁶  |
| `resolvePublicScan`                                                    | `found`, `ports`                                             | Pidfiles, the manifest, `rules.v4`.                                                                                                                                                  | list    |
| `resolveInnerGatewayScan`, `resolveSameLanScan`, `resolveOccupantScan` | `found`, `ports`                                             | The same three. Only for a caller standing on that network.                                                                                                                          | list    |
| `resolveHttpFetch`, `resolveOccupantFetch`                             | `content`, `server`                                          | One file under `/var/www`, read as the web server. A search on findit is built from what sites serve.                                                                                | list    |
| `resolveHttpSweep`, `resolveOccupantSweep`                             | `dirlistFound`, and a path, status and size for each word    | `/var/www` on the target; the word list from the journal of the box the caller stands on.                                                                                            | list ⁴  |
| `resolveMail`                                                          | `messages`, one `message`, or `ok`                           | An inbox in the email tables, for whoever gives its password. Of emailit.io itself, only what its fetch reads: boot and web server.                                                  | fine    |

### `POST /api/patches`

| Action                                                                                                                  | Body on success | What it is read from                                            | Verdict                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `listPatches`                                                                                                           | `patches`       | Every row of the machine's journal, any writer, any permission. | fine: the owner of a workstation alone, anybody else refused (v0.374.0) |
| `upsertPatch`, `removePatch`                                                                                            | `ok`            |                                                                 | fine                                                                    |
| `appendAuthLog`, `appendKernLog`, `recordFtpTransfer`, `recordPackageDowngrade`, `recordZoneTransfer`, `recordLanFetch` | `ok`            |                                                                 | fine                                                                    |
| `nmapScan`                                                                                                              | `hostsLogged`   | A count of the boxes that logged the scan.                      | fine                                                                    |

### `POST /api/sessions`

| Action                                                                                                      | Body on success                                                                                                                                                                        | What it is read from                                                                                                 | Verdict  |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| `createSession`, `endSession`, `rebootMachine`                                                              | `ok`                                                                                                                                                                                   |                                                                                                                      | fine     |
| `listSessions`                                                                                              | The caller's own open rows                                                                                                                                                             | `sessions`, by the caller's key.                                                                                     | fine     |
| `authCreateSession`, `authCreateSessionSameLan`, `authCreateSessionPublic`, `authCreateSessionInnerGateway` | `userType`, and where needed `username`, `machine_id`, `essid`                                                                                                                         | `/etc/passwd` on the box as it is, behind the password.                                                              | server   |
| `suElevate`                                                                                                 | `userType`                                                                                                                                                                             | `/etc/passwd` of the box as its journal leaves it (v0.370.0).                                                        | fine     |
| `hydraCrack`                                                                                                | `port`, `cracked`, `wordlistFound`                                                                                                                                                     | `/etc/passwd` or a service's secret. Only accounts whose password is in the word list on the caller's box come back. | server ⁴ |
| `mysqlConnect`, `redisConnect`                                                                              | `hostname`                                                                                                                                                                             | The database or store file, behind its credential. A refused `mysqlConnect` also names the address the box saw.      | server   |
| `mysqlStatement`, `redisStatement`                                                                          | `output`, `failed`                                                                                                                                                                     | The same file. Rendered text only; `mysql` renders at the tier of the database account that logged in.               | server   |
| `snmpWalk`                                                                                                  | `tier`, `identity`, and `portTables` for the read-write community                                                                                                                      | The manifest and `snmpd.conf`; `rules.v4` or `acl.conf` only behind the read-write community.                        | server   |
| `snmpSet`                                                                                                   | `oid`, `value`, or a refusal                                                                                                                                                           | Echoes what the caller set.                                                                                          | fine     |
| `exploitCreateSession`, `exploitLocalElevate`                                                               | The vulnerability, its effect and tier, then one of: a file or listing read at that tier, a write's path and size, a reset account and its new password, a backdoor port, or a session | The box as it is, at the tier the vulnerability grants.                                                              | server ⁵ |

⁴ The sweep and the credential sweep read the word list from the journal of the box the caller
stands on, without asking whether the caller's tier may read it. The list is world-readable as
shipped and its content is never returned, only what matched.

⁵ An exploit reads above the session's tier by design: the tier is the one the vulnerability
grants, recomputed on the server, and the read is walked by the same permission check a shell at
that tier would get. Since v0.372.0 `exploitLocalElevate` finds the box from the network on the
caller's own session row, so it answers on the access point's gateway and on a generated machine
as well as on a player's workstation.

⁶ Since v0.389.0 a root session on emailit.io is also served every account's mailbox under
`/var/mail` and every account's hash in `/etc/emailit/passwd`, built from the email tables. Below
root the tables are not read at all, so nothing of them reaches the wire.

### `POST /api/wallet`

| Request  | Body on success                                       | Verdict |
| -------- | ----------------------------------------------------- | ------- |
| balance  | `balance`, `nextSequence` for the address named       | fine    |
| history  | The latest transfers into or out of the address named | fine    |
| transfer | `ok`                                                  | fine    |

The ledger is public by design and holds no file content. The two reads verify no signature.

## What was not checked

- Nothing was run for the audit itself. Defects 1, 3 and 4 have since been measured on the live
  stack and fixed.
- Error codes as a channel (see above).
- What a write that claims `is_new` does to a file the writer could not see.
- Anything on the player's own workstation, which stays local.
