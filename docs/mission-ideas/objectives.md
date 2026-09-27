# Legacy mission objectives

> **Legacy mission design, kept as inspiration for the missions rebuild.** Every `src/` path refers
> to git tag `legacy-final`, not to the current tree. Where the code and
> [mission-variations.md](./mission-variations.md) disagree, this page follows the code and says so.

This page covers the 14 objective types: what the player was told, what the generator planted, and
how `mail` decided the job was done.

A mission came from one seed string. `accept <seed>` ran `generateMissionNetwork`
(`src/generation/generateMission.ts`), which built the network and then called
`buildMissionObjective` (`src/generation/attackChain.ts`) to pick the objective, the target and the
planted artifacts. The player finished with `mail <client> [proof]` (`src/commands/mail.ts`). `mail`
checked the recipient against the client email in the briefing, verified the objective
synchronously, and only then played the "darkmail" delivery animation and completed the mission.

The client email was `<handle>@darkmail.onion`, with the handle picked from the leet-speak names in
`clientHandles` (`src/generation/pools/machines.ts`).

The briefing (`formatMissionBriefing` in `src/commands/accept.ts`) showed the seed, the difficulty,
`Objective: <description>`, `Reply to: <email>`, an objective-specific hint block, and
`Target: <router public IP or router domain>`. It never said how to get in.

## 1. What the player was told

| Type | Asked to | `description` template (verbatim) | Hint block (verbatim; `<email>` = client) |
| --- | --- | --- | --- |
| `exfiltrate` | Read an ACCESS-KEY out of a planted file and mail it | `Exfiltrate the secret data from ${hostname}` | `Find the ACCESS-KEY in the target file and mail it to the client.` / `Example: mail <email> ACCESS-XXXX-XXXX-XXXX` |
| `exfiltrate` (encrypted) | Find the encrypted file and its key on another machine, decrypt with `gpg` as root, mail the key | `Decrypt and exfiltrate the secret data from ${hostname}` | `Find the encrypted target file and the decryption key.` / `You'll need root access to use gpg. The key is on another machine.` |
| `tamper` | Edit one value in a planted file | `Modify the target record on ${hostname}` | `Modify the target file: change "${tamperOldValue}" to "${tamperNewValue}".` / `Then confirm by mailing the client.` |
| `credential_theft` | Find the target's root password | `Discover the root password for ${hostname}` | `Discover the root password on the target machine and mail it to the client.` |
| `script_fix` | Fix a broken JS script so it reports the right value | `Fix the broken script on ${hostname}. Root password: ${rootPassword}` | `Find the broken script on the target machine. Fix it with nano` / `and test it with node. When fixed, confirm to the client.` (+ `Look around the machine for the correct values.` for the `corrupted` bug) |
| `script_auto` | Write a script from a stub's instructions | `Write and deploy the automated script on ${hostname}. Root password: ${rootPassword}` | `Write the automated script on the target machine. Follow the instructions` / `in the stub file, then test it with node. When working, confirm to the client.` |
| `sabotage` | Brick the target | `Destroy the target machine — ${hostname}` | `Destroy the target machine. Delete critical boot files and reboot it.` / `Then confirm the kill to the client.` |
| `backdoor` | Leave an `nc` listener on a given port, as a given tier | `Open a backdoor on port ${port} on ${hostname}` | `Open a backdoor listener on port ${port}[ as root \| as guest] on the target machine.` / `Install netcat and run nc -l ${port}. Then confirm to the client.` |
| `portforward` | Add a NAT rule on the border router | `Set up NAT forwarding: expose ${hostname} port ${servicePort} on public port ${publicPort}` | `Hack the border router and set up NAT port forwarding.` / `Then confirm to the client.` |
| `forensics` | Trace a breach through logs and name the attacker and origin IP | `Investigate the breach on ${hostname}. Send us the attacker's alias and their origin IP. Root password: ${rootPassword}` | `Investigate the breach. Search the logs across machines to trace the` / `attacker's path. Find their alias and origin IP.` |
| `malware` | Stop the malware process and delete its file | `Identify and neutralize the malware on ${hostname}. Root password: ${rootPassword}` | `Find the malware, kill the process, and delete the malicious file` / `to prevent re-execution.` |
| `db_exfiltrate` | Read an ACCESS-KEY out of the MySQL `api_keys` table | `Exfiltrate the secret access key from the database on ${hostname}` | `Extract the secret access key from the database on the target machine.` |
| `db_tamper` | UPDATE one cell | `Tamper with the database records on ${hostname}` | `Modify the database: change ${rowHint} value from "${old}" to "${new}"` / `in the ${table} table. Then confirm to the client.` |
| `db_sabotage` | Destroy one table's data | `Destroy the database on ${hostname}` | `Destroy the ${table} table in the database on the target machine.` |
| `db_fix` | Restore one corrupted cell | `Fix the corrupted database records on ${hostname}. MySQL credentials — user: root, password: ${mysqlRootPw}` | `A deployment corrupted database records. Restore ${rowHint} value from` / `"${old}" to "${new}" in the ${table} table.` |

White-hat briefings handed over the target's root password because, as the code comment says, "the
player is an authorized contractor". `db_fix` handed over the MySQL root password instead.

## 2. Target selection

`pickTarget` never chose a router or switch.

- **Multi-layer (medium/hard):** the target came from the deepest subnet layer. `portforward` was the
  exception: it used layer 0, which the border router can reach.
- **Single layer (easy):** any non-entry machine, falling back to the entry machine when there was
  no other.
- **`db_*` objectives** preferred `database`-role machines and fell back to any candidate.
  `generateMission` then gave the target an open `3306/mysql` port if it lacked one.

## 3. What was planted, and how `mail` checked it

All verifiers live in `src/commands/mail.ts`.

| Type | Planted | Proof content | `mail` passes when |
| --- | --- | --- | --- |
| `exfiltrate` | A root-owned file from the role's target-file templates holding `ACCESS-XXXX-XXXX-XXXX`. 25% of the time it moved to a binary-looking path wrapped in noise, so the player needed `strings` | required | the proof equals the ACCESS-KEY exactly |
| `exfiltrate` (encrypted) | The same file, XOR-encrypted as `<path>.enc`. A 64-hex key sat on a *different* machine, in one of the key-placement templates | required | the proof equals the decrypted ACCESS-KEY |
| `tamper` | A root-owned file from the role's tamper templates that contains the old value | optional | the file exists, no longer contains the old value anywhere, and does contain the new value |
| `credential_theft` | Nothing extra. The target's root password came from the mission password pool, which is never in hydra's wordlist | required | the proof equals the root password |
| `script_fix` | A broken script, plus a hint file for the `corrupted` bug. See [script-objectives.md](./script-objectives.md) | optional | re-running the script reports the expected value to `_system` |
| `script_auto` | A comment-only stub and a JSON data file, local or on a peer. See [script-objectives.md](./script-objectives.md) | optional | re-running the player's script reports the expected field value |
| `sabotage` | Nothing extra | optional | the target is bricked: `/boot/vmlinuz` or `/boot/initrd.img` was deleted as root and the machine was rebooted. After that, every network command against it times out |
| `backdoor` | Nothing extra | optional | `/var/run/nc-<port>.pid` exists on the target and its `userType` matches the required tier |
| `portforward` | Nothing extra; the network is router-first, so no forwarding rules exist yet | optional | the router's `/etc/iptables/rules.v4` has `forward <publicPort> to <internalIp>:<internalPort>` |
| `forensics` | Logs on each machine along the attacker's path and a calling card on the deepest one. See [white-hat-investigations.md](./white-hat-investigations.md) | required | the proof, split on spaces, commas, colons and hyphens, contains both the handle and the origin IP, in either order |
| `malware` | A disguised script and its pidfile. See [white-hat-investigations.md](./white-hat-investigations.md) | required but ignored | the file is gone **and** the pidfile is gone |
| `db_exfiltrate` | A new row in `api_keys` whose `key_value` is `ACCESS-NNNN-NNNN-NNNN` | required | the proof equals that key |
| `db_tamper` | One of the tamper scenarios (§5) | optional | the target row's column no longer holds the old value and holds the new one |
| `db_sabotage` | Nothing extra; the target table comes from the sabotage list (§5) | optional | the database file is gone, the table was dropped, or the table has no rows |
| `db_fix` | One of the fix scenarios (§5), stored at its corrupted value | optional | as `db_tamper`, in the other direction |

## 4. The credential chain, and why legacy dropped it

Until early March 2026 the generator guaranteed a path from the entry machine to the target. Each
hop left the next hop's credentials on the current machine: in `auth.log`, `.bash_history`, a
`/tmp` backup, a notes file or a maintenance config. A matching hint pointed at the file, and each
entry variant (FTP, NC, exploit, HTTP) left the credentials for the first hop.

Commit `aa29727d` (2026-03-07) removed the lateral-movement credentials, entry credential hints,
binary credential paths and HTTP credential placements. The same commit emptied the mission board.
Its message gives the reason: *"This prepares for tool-based progression where players transfer
and chmod binaries instead of following credential breadcrumbs."*

At `legacy-final`, then, missions still generated objectives, but the breadcrumbs were gone and the
board offered nothing. In [mission-variations.md](./mission-variations.md), the "Credential
Placement Templates" and "Hint Templates" sections describe the removed design. To read the old
code:

```bash
git show aa29727d^:src/generation/attackChain.ts
```

## 5. Database scenarios

From `src/generation/pools/database.ts`. The generator resolved placeholders such as the admin user
or the original salary against the generated rows. The briefing named the table, the row and both
values.

**Tamper (11 scenarios):** a change the owner would not want.

| Table | Row | Column | Old → new |
| --- | --- | --- | --- |
| users | the admin user | role | `admin` → `user` |
| users | the admin user | email | the admin's email → `redirected@external.com` |
| config | `maintenance_mode` | value | `false` → `true` |
| config | `debug_mode` | value | `false` → `true` |
| config | `registration_open` | value | `false` → `true` |
| orders | id 1000 | status | `pending` → `delivered` |
| orders | id 1000 | amount | the original amount → `0.01` |
| employees | id 1 | salary | the original salary → `999999` |
| employees | id 1 | clearance | `top-secret` → `standard` |
| payments | id 1 | status | `completed` → `refunded` |
| tickets | id 1 | priority | `critical` → `low` |

**Fix (10 scenarios):** the same shape in reverse, framed as "a deployment corrupted database
records". The player was given the MySQL root password.

| Table | Row | Column | Corrupted → correct |
| --- | --- | --- | --- |
| users | the admin user | role | `user` → `admin` |
| users | the admin user | email | `corrupted@invalid` → the admin's email |
| config | `maintenance_mode` | value | `true` → `false` |
| config | `debug_mode` | value | `true` → `false` |
| config | `registration_open` | value | `true` → `false` |
| orders | id 1000 | status | `cancelled` → `pending` |
| employees | id 1 | clearance | `standard` → `top-secret` |
| employees | id 1 | active | `0` → `1` |
| payments | id 1 | status | `failed` → `completed` |
| tickets | id 1 | priority | `low` → `critical` |

**Sabotage targets (8 tables):** `sessions`, `api_keys`, `audit_log`, `orders`, `employees`,
`inventory`, `payments`, `tickets`.

## 6. Random pool vs keyword-only

| Objectives | In the random pool? | Root password in the briefing? |
| --- | --- | --- |
| exfiltrate, tamper, credential_theft, sabotage, backdoor | yes | no |
| script_fix, script_auto, malware | yes | yes |
| forensics, db_fix | keyword only | yes |
| portforward, db_exfiltrate, db_tamper, db_sabotage | keyword only | no |
| encrypted exfiltrate | keyword only (`gpg`) | no |

## 7. Design notes and findings

- **Most objectives checked the world, not a string.** `mail` looked for a file, a pidfile, a bricked
  flag or a table row, so a player could not pass by learning the answer somewhere else. Only
  `exfiltrate`, `db_exfiltrate`, `credential_theft` and `forensics` compared a typed proof.
- **Encrypted exfiltrate never happened at random.** `buildMissionObjective` always passes
  `encrypted: encryptedOverride ?? false`, so the `?? prng.next() < 0.25` fallback in the planting
  code never runs. Only the `gpg` keyword turns encryption on, although the docs say about 25%.
- **With no objective keyword, the objective was rolled twice.** `generateMission` picks from a
  six-type list only to decide port closures, then `buildMissionObjective` picks again from an
  eight-type list. Closures could follow a different objective than the one the player got, and a
  white-hat objective rolled at random missed the forced SSH entry.
- **`tamper` checks the whole file by substring.** Any other occurrence of the old value keeps the
  mission failing, and adding the new value anywhere satisfies the second check.
- **Template counts in mission-variations.md are out of date.** The code has 35 exfiltrate target
  templates (the doc says 21), 21 tamper templates (13), 15 key placements (5) and 39
  credential-leak templates (13).
- **PRNG sequence stability was a standing rule.** Keyword overrides still consumed their PRNG calls,
  and some objectives made dummy rolls, so adding a keyword to a seed changed only the axis it named.
  v2 also regenerates worlds from seeds, so a new mission generator will face the same choice.
