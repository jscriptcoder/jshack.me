# Plan: Wordlist-Based Tool Mechanics

**Branch**: feat/wordlist-tools
**Status**: Active

## Goal

Make hydra and gobuster use filesystem-based wordlists (installed via apt), and differentiate FTP-entry from SSH-entry by giving FTP its own credentials crackable via hydra while SSH passwords on FTP-entry machines are NOT in the wordlist.

## Context & Design Decisions

### Problem

FTP entry variant is pointless: SSH is always open alongside FTP on entry machines, and hydra cracks SSH just as easily. There's no reason for the player to use FTP.

### Solution

1. **Wordlist files** installed alongside tools via `apt install`
2. **Hydra** reads `passwords.txt` — wordlist membership is a **gate** (necessary condition), probability rolls are preserved as **difficulty** (per-run chance)
3. **Gobuster** reads `dirlist.txt` and only reveals matching directory/file names (replaces full tree walk)
4. **FTP virtual users** — machines with FTP open can have separate FTP credentials in `/etc/vsftpd/virtual_users.conf` (always on FTP-entry, PRNG chance on other FTP-open machines)

### Key Design Choices

- **Wordlist location**: `/usr/share/wordlists/` (standard Kali convention). Tools also check cwd as fallback (for SCP'd tools).
- **Wordlist installed with tools**: `apt install hydra` drops `passwords.txt`, `apt install gobuster` drops `dirlist.txt`. No separate wordlist package needed.
- **New secret pool**: `WORDLIST_PASSWORDS` (~60 passwords, completely disjoint from `MISSION_PASSWORDS`). The wordlist file = `GUEST_PASSWORDS` + `WORDLIST_PASSWORDS`.
- **Hydra behavior: wordlist gate + probability**. Two conditions must BOTH be true for a crack: (1) password is in the wordlist file, AND (2) probability roll succeeds (guest 100%, user 18%, root 2.5%). If the password is NOT in the wordlist, it can never be cracked regardless of rolls. This preserves the existing difficulty curve for lateral movement while enabling FTP-entry differentiation.
- **FTP virtual users with PRNG spread**: FTP-entry machines ALWAYS have `/etc/vsftpd/virtual_users.conf`. Other machines with FTP open have a ~40% PRNG chance of also having virtual users. This adds variety — the player learns that FTP sometimes uses different credentials than SSH, which is realistic. When virtual users exist, FTP auth checks them first; otherwise falls back to system user auth.
- **Gobuster change**: Walks the tree but only shows entries whose filename matches the wordlist. `dirlist.txt` contains ~50 common directory/file names aligned with what generation creates (admin, api, .env, backup, config, status, etc.).
- **MySQL/Redis hydra**: Out of scope for this plan. MySQL uses same hash lookup (could be updated later). Redis already uses wordlist-like matching. SNMP uses its own community string pool.

### Impact on Existing Gameplay

| Scenario | In wordlist? | Probability | Net effect |
|---|---|---|---|
| hydra SSH on SSH-entry (user) | Yes | 18%/run | Same as today |
| hydra SSH on FTP-entry (user) | No | N/A | Never crackable (find creds via FTP) |
| hydra FTP on FTP-entry (user) | Yes (virtual) | 18%/run | Crackable with effort |
| hydra FTP on machine with virtual users | Yes (virtual) | 18%/run | Crackable with effort |
| hydra FTP on machine without virtual users | Yes (system) | 18%/run | Same as today |
| hydra on internal machines (user) | Yes | 18%/run | Same as today |
| hydra root (any machine) | No | N/A | Never crackable (was 2.5%) |
| hydra guest (any machine) | Yes | 100% | Same as today |
| gobuster | N/A | N/A | Only shows wordlist matches (was: everything) |

## Acceptance Criteria

- [ ] `apt install hydra` creates `/usr/bin/hydra` AND `/usr/share/wordlists/passwords.txt`
- [ ] `apt install gobuster` creates `/usr/bin/gobuster` AND `/usr/share/wordlists/dirlist.txt`
- [ ] Player can `cat /usr/share/wordlists/passwords.txt` and see the password list
- [ ] Hydra uses wordlist as a gate: password must be in wordlist AND probability roll must succeed
- [ ] Hydra cannot crack passwords NOT in the wordlist (regardless of probability)
- [ ] Hydra shows "0 valid passwords found" when no passwords match
- [ ] Hydra resolves wordlist from cwd first, then `/usr/share/wordlists/`
- [ ] Hydra errors with clear message if no wordlist is found
- [ ] Gobuster only reveals directory/file entries matching `dirlist.txt`
- [ ] Gobuster resolves wordlist from cwd first, then `/usr/share/wordlists/`
- [ ] FTP-entry machines ALWAYS have `/etc/vsftpd/virtual_users.conf` with FTP credentials
- [ ] Other machines with FTP open have ~40% PRNG chance of virtual users
- [ ] FTP auth checks virtual user creds first when file exists, falls back to system users
- [ ] Virtual user FTP passwords come from `WORDLIST_PASSWORDS` (in wordlist, crackable)
- [ ] SSH passwords on FTP-entry machines come from `MISSION_PASSWORDS` (not in wordlist, never crackable)
- [ ] SSH-entry and internal machines: regular user passwords from `WORDLIST_PASSWORDS` (in wordlist)
- [ ] Root passwords always from `MISSION_PASSWORDS` (never in wordlist, never crackable)
- [ ] Credential leaks on FTP-entry machines still expose SSH credentials (player's path in)
- [ ] All existing tests updated; build, lint, and format pass

## Steps

### PR 1: Extend apt to install extra (non-binary) files

Currently `apt install` only creates binary stubs in `/usr/bin/`. We need it to also create regular files in arbitrary paths (for wordlists).

#### Step 1.1: Add `extraFiles` to `AptPackageInfo` type

**Test**: Type-level — verify that an `AptPackageInfo` with `extraFiles` field is accepted by TypeScript. Write a test that constructs a package with `extraFiles: [{ path: '/usr/share/wordlists/test.txt', content: 'test' }]` and passes it to the install handler.
**Implementation**: Add `extraFiles?: readonly { readonly path: string; readonly content: string }[]` to `AptPackageInfo` in `availability.ts`.
**Done when**: TypeScript compiles, existing tests still pass.

#### Step 1.2: apt install creates extra files alongside binaries

**Test**: Create a test package with `extraFiles`. After `apt install`, verify the extra files exist at their specified paths with correct content and permissions (`read: all, write: root, execute: none`). Also verify existing binary installation is unchanged.
**Implementation**: In `apt.ts` `handleInstall`, after creating binaries (line 109-115), iterate `pkg.extraFiles` and call `createFile` for each. Only install extra files that don't already exist (skip duplicates). Create `/usr/share/wordlists/` directory if needed.
**Done when**: New test passes, all existing apt tests pass.

#### Step 1.3: apt list shows installed status correctly with extra files

**Test**: Verify `apt list` still shows `[installed]`/`[not installed]` based on binary presence (extra files don't affect status).
**Implementation**: No change needed — `formatInstalledStatus` already checks binaries only. This step just confirms the behavior.
**Done when**: Test passes.

---

### PR 2: Hydra wordlist-based cracking

#### Step 2.1: Add `WORDLIST_PASSWORDS` to secrets

**Test**: Import `WORDLIST_PASSWORDS` from secrets, verify it parses to an array of ~60 strings. Verify zero overlap with `MISSION_PASSWORDS`.
**Implementation**: Add `WORDLIST_PASSWORDS` key to `src/secrets/secrets.ts` with ~60 common weak passwords (disjoint from MISSION_PASSWORDS). Run `npm run encode`.
**Done when**: Secret parses correctly, no overlap with mission passwords.

#### Step 2.2: Configure hydra apt package with passwords.txt extra file

**Test**: `apt install hydra` creates both `/usr/bin/hydra` and `/usr/share/wordlists/passwords.txt`. Content of `passwords.txt` equals `GUEST_PASSWORDS` + `WORDLIST_PASSWORDS` joined by newlines.
**Implementation**: Add `extraFiles` to the hydra entry in `APT_PACKAGES`. Content generated from the decoded secrets (import from `__encoded.ts` for runtime, but generate the content in the `availability.ts` or a new `wordlists.ts` module). The file content should be the actual passwords, one per line.
**Done when**: Test passes.

#### Step 2.3: Implement wordlist resolution utility

**Test**: `resolveWordlist('passwords.txt', getNode, cwd)` returns file content when found in cwd. Returns file content from `/usr/share/wordlists/` when not in cwd. Throws descriptive error when not found in either location.
**Implementation**: Create `src/utils/wordlist.ts` with `resolveWordlist(filename, getNode, cwd)` that checks `${cwd}/${filename}` then `/usr/share/wordlists/${filename}`, returns parsed lines (trimmed, empty lines filtered).
**Done when**: All resolution cases tested.

#### Step 2.4: Hydra reads wordlist and adds it as a gate to cracking

**Test**: (a) User password IN wordlist + probability succeeds → cracked. (b) User password IN wordlist + probability fails → not cracked this run (can retry). (c) User password NOT in wordlist → never cracked regardless of probability. (d) Guest in wordlist + 100% probability → always cracked. (e) Root not in wordlist → never cracked. (f) Hydra errors clearly if wordlist file not found.
**Implementation**: In `hydra.ts`, replace the module-level `wordlist`/`hashToPassword` constants with a wordlist read from the filesystem via `resolveWordlist`. In the SSH/FTP cracking section (lines 487-510), add a wordlist membership check BEFORE the probability roll: build hash set from wordlist passwords, check if `user.passwordHash` matches any — if not, skip (never crackable). If yes, proceed with existing `CRACK_PROBABILITY` roll. Keep `CRACK_PROBABILITY` unchanged.
**Done when**: All cracking tests updated. New tests verify the gate behavior (not-in-wordlist → 0%). Existing probability-based difficulty preserved for in-wordlist passwords.

#### Step 2.5: Password generation uses WORDLIST_PASSWORDS for crackable users

**Test**: On SSH-entry machines, regular user passwords are from `WORDLIST_PASSWORDS` (in wordlist → hydra succeeds). Root passwords are from `MISSION_PASSWORDS` (not in wordlist). Guest passwords are from `GUEST_PASSWORDS` (in wordlist).
**Implementation**: Modify `generateUsers()` in `users.ts` to accept an `entryVariant` parameter (or a `useWordlistPasswords` boolean). When true (SSH-entry), pick regular user passwords from `wordlistPasswords` pool instead of `passwords`. Root always from `passwords` (MISSION_PASSWORDS). Guest always from `guestPasswords`.
**Done when**: Generation tests verify password pool selection by entry variant.

---

### PR 3: Gobuster wordlist-based enumeration

#### Step 3.1: Add dirlist content and configure gobuster apt package

**Test**: `apt install gobuster` creates `/usr/bin/gobuster` and `/usr/share/wordlists/dirlist.txt`. Content contains expected directory/file names (admin, api, .env, backup, config, status, etc.).
**Implementation**: Create dirlist content as a constant (not a secret — directory names aren't sensitive). Add `extraFiles` to gobuster's `APT_PACKAGES` entry. Dirlist should include ~50 common web paths aligned with what `httpEntryCredentialTemplates` and web content templates create (e.g., admin, api, backup, config, .env, .git, status, health, server-status, robots.txt, phpinfo.php, wp-config.php.bak, etc.).
**Done when**: Test passes, dirlist aligned with generation.

#### Step 3.2: Gobuster filters entries by wordlist

**Test**: Machine with `/var/www/html/admin/config.json` and `/var/www/html/secret/hidden.txt`. Dirlist contains "admin" but not "secret". Gobuster shows `/admin` (301) and `/admin/config.json` (200) but NOT `/secret` or `/secret/hidden.txt`. Gobuster errors if wordlist not found.
**Implementation**: In `gobuster.ts`, after `collectWebEntries`, read dirlist via `resolveWordlist('dirlist.txt', ...)`. Filter entries: only include an entry if its top-level path segment matches a wordlist entry. For nested paths like `/admin/config.json`, show it only if `admin` is in the dirlist. This preserves the existing recursive output but gates it on the first path segment.
**Done when**: All gobuster tests updated. Only wordlist-matching entries shown.

#### Step 3.3: Gobuster handles cwd wordlist resolution

**Test**: When `dirlist.txt` exists in cwd (e.g., SCP'd from localhost), gobuster uses it. When only in `/usr/share/wordlists/`, uses that.
**Implementation**: Use same `resolveWordlist` utility from PR 2.
**Done when**: Resolution tests pass.

---

### PR 4: FTP credential system and entry differentiation

#### Step 4.1: Define FTP credential types and virtual user config generation

**Test**: `generateFtpCredentials(users, prng, wordlistPasswords)` returns FTP credentials for each system user with passwords from `wordlistPasswords`. Generated `/etc/vsftpd/virtual_users.conf` contains `username:password_hash` lines.
**Implementation**: Create FTP credential generation in `src/generation/enrichment.ts` (or a new `ftpCredentials.ts`). For each system user on the machine, generate an FTP-specific password from `WORDLIST_PASSWORDS` pool. Store as config file content for `/etc/vsftpd/virtual_users.conf`.
**Done when**: Generation test passes.

#### Step 4.2: Place virtual_users.conf on FTP-entry and randomly on other FTP-open machines

**Test**: (a) FTP-entry machine ALWAYS has `/etc/vsftpd/virtual_users.conf`. (b) Non-entry machine with FTP open has ~40% PRNG chance of having the file. (c) Machine without FTP open never has the file. (d) Content contains correct FTP credentials with hashed passwords.
**Implementation**: During filesystem generation (in `machineConfig.ts` or enrichment), place virtual users config when: `accessVariant === 'ftp'` (always), or FTP port is open + PRNG roll < 0.4 (random). Always consume the PRNG roll for sequence stability even if FTP is closed.
**Done when**: Filesystem generation tests verify presence/absence by variant and PRNG.

#### Step 4.3: FTP auth checks virtual user credentials when file exists

**Test**: (a) Machine WITH virtual_users.conf: FTP login with virtual password succeeds, system password fails. (b) Machine WITHOUT virtual_users.conf: FTP login with system password succeeds (unchanged). (c) Works for both FTP-entry and non-entry machines that happen to have virtual users.
**Implementation**: In `useAuthentication.ts`, modify `authenticateFtpInline` and `handleFtpPassword` to first check for `/etc/vsftpd/virtual_users.conf` on the target machine. If it exists, authenticate against those credentials. If not, fall back to system user authentication (current behavior).
**Done when**: All three test cases pass.

#### Step 4.4: Hydra FTP resolves FTP-specific credentials when virtual users exist

**Test**: (a) Machine with virtual users: `hydra(ip, 'ftp')` tries virtual user passwords (from wordlist, crackable with probability). (b) Machine without virtual users: `hydra(ip, 'ftp')` tries system user passwords (current behavior). (c) `hydra(ftpEntryIp, 'ssh')` uses system passwords (not in wordlist → never crackable). (d) SSH cracking is always against system users regardless of virtual users.
**Implementation**: In `hydra.ts`, for FTP service cracking, read `/etc/vsftpd/virtual_users.conf` from the target machine. If it exists, use those credentials for FTP cracking. Otherwise use system users. SSH cracking always uses system users (unchanged).
**Done when**: Hydra FTP tests pass for machines with and without virtual users.

#### Step 4.5: FTP-entry machines get non-wordlist SSH passwords

**Test**: On FTP-entry machine, regular user SSH passwords are from `MISSION_PASSWORDS` (not in wordlist). On SSH-entry and other machines, regular user SSH passwords are from `WORDLIST_PASSWORDS` (in wordlist).
**Implementation**: In `generateUsers()`, when machine's `accessVariant === 'ftp'`, pick regular user passwords from `passwords` (MISSION_PASSWORDS). Otherwise pick from `wordlistPasswords` (WORDLIST_PASSWORDS). Root always from `passwords`. Guest always from `guestPasswords`.
**Done when**: Generation tests verify per-variant password selection.

#### Step 4.6: Credential leaks on FTP-entry machines expose SSH passwords

**Test**: FTP-entry machine has a credential leak file containing SSH credentials (from MISSION_PASSWORDS) for a regular user — the player's path to SSH access.
**Implementation**: Verify existing `placeCredentialLeak()` in `machineConfig.ts` works correctly with the new password pools. FTP-entry machines should have slightly higher credential leak probability (or guaranteed leak) since the player NEEDS leaked creds to SSH in. Adjust `CREDENTIAL_LEAK_CHANCE` for FTP-entry machines if needed.
**Done when**: FTP-entry machines reliably have SSH credential leaks accessible via FTP file exploration.

## Documentation Updates

After all PRs merged:
- Update `CLAUDE.md`: document wordlist system, new secret, FTP credential separation
- Update `architecture.md`: wordlist resolution, apt extra files, FTP auth flow
- Update `mission-variations.md`: FTP-entry player flow updated
- Update `infrastructure-design.md`: virtual user credentials on FTP-entry machines
- Update `src/commands/README.md`: hydra/gobuster wordlist dependency
- Update `src/generation/README.md`: WORDLIST_PASSWORDS pool, FTP credential generation

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing -- run `mutation-testing` skill
2. Refactoring assessment -- run `refactoring` skill
3. Typecheck and lint pass (`npm run build && npm run lint`)
4. Format pass (`npm run format`)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
