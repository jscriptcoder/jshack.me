# Plan: `cp` and `mv`

**Status:** Grilled 2026-11-20. One slice, planned below.

The shell can create (`touch`, `mkdir`, `>`), read and remove (`rm`) files, but cannot copy or move
one. A player who wants a backup before editing a config, or to stash a file somewhere less
obvious, has no way to do it short of `cat` into a redirect. The world already plants histories
that assume `cp` (`cp rota.csv rota.csv.bak` in `homeHistory.ts`).

---

## Grill record

1. **A new copy is a new file the copier made (2026-11-20).** It belongs to the shell's user and
   takes the tier defaults (`defaultFilePermissions` / `defaultDirectoryPermissions`), as `touch`,
   `>` and an `scp` landing do. A copied binary or script is therefore not executable until
   `chmod +x`, and root restoring a binary from a backup must chmod it. Rejected: carrying the
   source's permissions, which in the tier model (owner grants nothing; tiers do) leaves a guest
   unable to edit their own copy of a root-writable file such as `/etc/passwd`; and tier defaults
   plus the source's execute set, a carve-out rule.

2. **Settled from the code, proposed and not objected to (2026-11-20):**
   - Both commands act on the box the shell stands on only; `scp` remains the way between boxes.
   - Flags: `cp [-r|-R] <src>... <dest>`, `mv <src>... <dest>`. No `-i`/`-f`/`-n`/`-p` —
     commands are not real-command clones.
   - `mv` is a rename: the moved file or tree keeps its owner and permissions. It needs write on
     the source's parent and the destination's parent, and NOT read on the moved files (a rename
     never opens them).
   - An overwrite of an existing file keeps that file's owner and permissions, the rule
     `msfconsole`'s write already follows.
   - `/boot`: `canBoot` is presence-based, so `mv /boot/vmlinuz /tmp/` then `reboot` bricks the
     box and moving it back first saves it. `>` already allows the same; nothing new opens.

## Facts the plan rests on (measured 2026-11-20)

- `PatchApi` already has every write needed: `write` (with `isNew`, `permissions`, `owner`),
  `mkdir`, `remove` (one marker drops a whole subtree on replay) and `setDirectoryPermissions`
  (with `owner`). No `api/` change, so no wire-check.
- `resolveWriteTarget` (`core/filesystem/writeTarget.ts`) is the shared rule for where a
  whole-file write may land (`>`, a script's `fs.writeFile`); `cp`'s file destination uses it.
- `FsView.stat` returns the node with its content regardless of tier, so `mv` can carry a file it
  cannot read, as a rename does; `cp` reads through `FsView.read`, which applies tier read rules.
- A binary-gated command needs `registry.ts` AND `SYSTEM_UTILITY_NAMES` in
  `core/generation/binaries.ts`; the second moves every landmark fingerprint in
  `landmarks.test.ts`, which must be regenerated on purpose.
- `plantedHistory.test.ts` runs every planted history line through the shell; the `cp … .bak`
  lines must now succeed rather than be skipped as an unshipped command.

---

## Slice 1: `cp` and `mv` (v0.477.0)

**Value:** a player can back up, duplicate, rename and relocate files and directories on any box
they stand on, at whatever tier the shell holds.

**Acceptance criteria — `cp`**

1. `cp a b` copies file `a` to `b`; `b` is the shell user's, with tier-default permissions.
2. `cp a dir/` and `cp a b c dir` copy into an existing directory under each source's name.
3. Copying onto an existing file replaces its content and keeps its owner and permissions.
4. `cp dir x` without `-r` errors `cp: -r not specified; omitting directory 'dir'`; `cp -r dir x`
   copies the tree (into `x/dir` when `x` exists, as `x` otherwise), new directories at tier
   defaults.
5. Refusals, each naming the ORIGINAL argument and continuing with the other sources:
   missing source (`cp: cannot stat 'a': No such file or directory`), unreadable source
   (`cp: cannot open 'a' for reading: Permission denied`), unwritable destination
   (`cp: cannot create regular file 'b': Permission denied`), several sources onto a non-directory
   (`cp: target 'b' is not a directory`), a directory into itself
   (`cp: cannot copy a directory, 'd', into itself, 'd/e'`), missing operands
   (`cp: missing file operand`, `cp: missing destination file operand after 'a'`). Exit 1 on any.

**Acceptance criteria — `mv`**

6. `mv a b` renames; `mv a b c dir` moves into a directory. The source is gone afterwards and the
   destination holds the same content, owner and permissions (directories included, whole tree).
7. `mv` needs write on both parents and moves a file the shell cannot read.
8. Refusals: missing source, `Permission denied` on either parent, several sources onto a
   non-directory, a directory into its own subtree
   (`mv: cannot move 'd' to a subdirectory of itself, 'd/e'`), the same path
   (`mv: 'a' and 'a' are the same file`), missing operands. A destination that is an existing
   directory for a file source moves into it; a file onto an existing directory of the same name is
   `mv: cannot overwrite directory 'b' with non-directory`.
9. Write order is copy first, remove the source last, so a failure part-way leaves the source
   intact.

**Acceptance criteria — wiring**

10. Both appear in `help`, `man`, `llms/commands.md`, and run on every box (`/bin/cp`, `/bin/mv`).
11. The planted `cp … .bak` history lines run clean.

**Shape**

- `core/commands/cp.ts` and `core/commands/mv.ts`, beside `rm.ts`/`touch.ts`, same `Command`
  shape (`category: 'filesystem'`, `tier: 'guest'`, `availability: any-machine`). Gate everything
  against the live `fs` view before the first write, as `rm`/`mkdir` do.
- Destination resolution (into-a-directory vs. as-a-name, the into-itself check) is the same for
  both; write it once as a private helper inside whichever file needs it first, and lift it only if
  the second command uses it unchanged.

**TDD**

- RED → GREEN through `execute` with the in-memory env the other filesystem command tests use,
  one criterion at a time; assert on the resulting `fs` view (content, owner, perms) and the
  printed lines, never on which `PatchApi` calls were made.
- Wiring: a registry/availability test that `cp`/`mv` resolve on a generated box (RED before the
  `SYSTEM_UTILITY_NAMES` addition); landmark fingerprints regenerated with a clause in that test's
  "fingerprints moved because…" comment.
- Mutation gate: Stryker scoped to `cp.ts` and `mv.ts`, json reporter (timeouts count as killed).
- Browser: one E2E run at close-out — `cp` a file, `mv` a directory, `ls -l` both, reload, still
  there.

**Gates:** `npm run typecheck`, `npm run lint`, `npm run test:run`, version bump in `package.json`
and `package-lock.json`.

**Out of scope:** a script API `fs.copyFile` / `fs.rename`; `-i`/`-f`/`-n`/`-p`; copying between
boxes; any trace in the box's logs.
