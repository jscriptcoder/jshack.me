# Plan: Add Mailserver Machine Role

**Branch**: feat/mailserver-role
**Status**: Active

## Goal

Add a `mailserver` machine role with email-based filesystem content, enabling it as a target for all 6 mission objectives and as a recon source via readable email files.

## Acceptance Criteria

- [ ] `MachineRole` type includes `'mailserver'`
- [ ] All 10 role-keyed pools have mailserver entries (usernames, hostnames, ports, configs, target files, tamper files, web content, script fix, binary target paths, binary key paths)
- [ ] Mailserver appears in `allRoles` arrays (topology + home network generation)
- [ ] Filesystem generation produces mailserver-specific config name (`postfix.conf`)
- [ ] Missions can generate mailserver machines and use them as targets
- [ ] All existing tests pass; new mailserver entries covered by existing pool-validation tests
- [ ] Documentation updated (mission-variations.md, infrastructure-design.md)

## Steps

### Step 1: Add `'mailserver'` to `MachineRole` type and all 10 role-keyed pools

**Test**: Existing `binary.test.ts` pool validation test (hardcoded role array) must include `'mailserver'` and pass. Existing type-checked `Record<MachineRole, ...>` declarations will fail compilation if any pool is missing the key.
**Implementation**:

- `src/generation/types.ts`: Add `'mailserver'` to the `MachineRole` union
- `src/generation/pools.ts`: Add mailserver entries to all 8 pools (`usernamesByRole`, `hostnamesByRole`, `portTemplatesByRole`, `configTemplatesByRole`, `targetFileTemplatesByRole`, `tamperFileTemplatesByRole`, `webContentTemplatesByRole`, `scriptFixTemplatesByRole`)
- `src/generation/binary.ts`: Add mailserver entries to `binaryTargetPaths` and `binaryKeyPaths`
- `src/generation/binary.test.ts`: Add `'mailserver'` to the hardcoded roles array
  **Done when**: `npm run build` passes (type-checked Record pools compile) and `npm run test:run` passes (binary pool test includes mailserver).

Pool entries:

- **Usernames**: `postmaster`, `mailadm`, `dovecot`, `smtp-svc`, `mailops`
- **Hostnames**: `mail01`, `mx-primary`, `smtp-relay`, `postfix-srv`, `exchange01`
- **Ports**: 22/ssh (open), 25/smtp (open), 143/imap (open), 993/imaps (closed)
- **Configs**: Postfix `main.cf` style, Dovecot config style
- **Target files (exfiltrate)**: `/var/mail/ceo` (email with auth token), `/var/spool/mail/admin` (email with wire transfer code), `/srv/mail/archive/confidential.eml` (email with access key)
- **Tamper files**: `/var/mail/hr` (change termination `approved` -> `denied`), `/etc/aliases` (change mail routing `admin` -> `devnull`)
- **Web content**: Default web templates (same as database/fileserver/workstation)
- **Script fix**: 2 mail-themed scripts (filter spam, validate mailboxes)
- **Binary target paths**: `/opt/app/mailstore.bin`, `/var/lib/mailindex.dat`, `/srv/cache/mbox.db`
- **Binary key paths**: `/usr/local/lib/mail_keyring.db`, `/opt/lib/libsmtp_keys.so`

### Step 2: Add mailserver to role arrays and filesystem generation

**Test**: Generate a mission with seed keyword that forces a mailserver target — verify it compiles and produces a valid network. Existing generation tests continue to pass.
**Implementation**:

- `src/generation/topology.ts:95`: Add `'mailserver'` to `allRoles`
- `src/generation/generateHomeNetwork.ts:55`: Add `'mailserver'` to `allRoles`
- `src/generation/filesystem.ts:416-425`: Add `machine.role === 'mailserver'` case returning `'postfix.conf'` for the service config filename
  **Done when**: `npm run build` and `npm run test:run` pass. Mailserver machines can appear in generated networks.

### Step 3: Update documentation

**Implementation**:

- `.claude/docs/mission-variations.md`: Add mailserver to Machine Roles table, name pools, and note new target/tamper templates
- `.claude/docs/infrastructure-design.md`: Add mailserver to machine descriptions
- `src/generation/README.md`: Update if it lists roles
  **Done when**: `npm run format` passes on all changed markdown files.

## Pre-PR Quality Gate

Before each PR:

1. `npm run build` passes
2. `npm run lint` passes
3. `npm run format` passes
4. `npm run test:run` passes

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
