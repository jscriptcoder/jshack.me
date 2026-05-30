# Plan: Seeded Own-Workstation Base Filesystem

**Branch**: feat/v2-seeded-workstation-fs
**Status**: Active — decisions resolved; ready to confirm acceptance criteria before RED
**Parent epic**: [network-generator-epic.md](./network-generator-epic.md) (Story 1)
**Depends on**: [intro-screen.md](./intro-screen.md) (Story 0 — must ship first; supplies the
typed `machineName` / `username` / `rootPassword`).

## Goal

Generate the player's own-workstation base filesystem deterministically from the Ed25519
identity seed, replacing the hand-written static tree — so the same identity always yields
the same `/etc/passwd` + home dirs, observable today through the existing `ls` / `cat`.

## Why this slice

It is the only generator story observable through commands that already exist (`ls`, `cat`)
— no new command needed. It stands up the pure primitives (`prng` port, `md5` port, base-FS
builder, `/etc/passwd` generation) that every later epic story reuses, while touching only
the own-workstation read path that already works.

## Decisions (RESOLVED — no longer open)

1. **Seed source**: the **Ed25519 identity pubkey hex** (`getPlayerIdentity().publicKeyHex`),
   namespaced per machine via the legacy convention — `createPrng('workstation-' + pubkey)`.
   No separate random game seed. Zero new persisted state for the seed itself.
2. **Typed fields** (machineName / username / rootPassword): come from the **intro screen +
   persisted game-config** built in Story 0. This slice READS them; it does not capture them.
3. **Guest account**: INCLUDE a seed-derived `guest` row in `/etc/passwd` now (just data;
   cracking mechanic is a later epic). Guest password picked from a pool via the seeded PRNG,
   mirroring legacy `generateLocalhost`.
4. **Password hashes**: PORT legacy's `md5` util into v2 now; store real `md5(rootPassword)`
   for root and `md5(<seeded guest password>)` for guest. Player user gets an empty hash
   (legacy parity — player can always `exit()` back). Forward-compatible for future su/ssh.
5. **Skeleton breadth**: MINIMAL — `/etc/passwd`, `/home/<username>`, `/root`, `/tmp` only.
   NOT `/bin` tool entries, `/lib`, `/var/log`, dotfiles, or cheatsheets — those land in
   later slices when a command actually consumes them.
6. **Seed namespace prefix**: `workstation-` (v2 has eliminated the legacy `localhost`
   literal — see migration `0002`/blueprint; use the workstation framing, not `localhost-`).

## Integration seam (CONFIRMED in code)

The replacement target already exists and is self-documented:

- **`v2/src/ui/seed.ts`** — a hand-authored base `Directory` tree exposed via a Solid signal
  (`createSignal`). Its own header says: _"TEMPORARY scaffold … the real per-machine
  generator (seeded, role-based) lands with the network generator plan and will replace this
  module wholesale."_ **This slice IS that replacement** — swap the static tree for a seeded
  `buildWorkstationBaseFs(seed, username)`, keeping the same exported signal contract.
- **`v2/src/ui/state.ts`** — the consumer; replays persisted patches over `seed.ts`'s tree
  via `applyPatches`. Confirm the exact export it imports so the swap is drop-in.
- Node shape (`v2/src/core/filesystem/types.ts`, CONFIRMED): `Directory` =
  `{ kind: 'directory', entries: ReadonlyMap<string, FileNode>, owner: string, perms }`;
  `FileEntry` = `{ kind: 'file', content, owner: string, perms, metadata? }`. NOTE: `owner`
  is a **username string**, not a `UserType` (differs from legacy/blueprint `FileNode`);
  `perms` are tier allowlists (`read`/`write`/`execute: UserType[]`).
- `seed.ts` exports `seedFs()`, `seedSession(identity)`, and the constants `SEED_HOST`
  (`'workstation'`), `SEED_USERNAME` (`'alice'`), `SEED_HOME` (`/home/alice`). All are
  hardcoded today — the username/host are exactly open questions 1–2.
- Consumers (CONFIRMED via `state.ts`): `seedFs()` is called in `runInput` (env root),
  `buildCompleteAdapter`, and boot; the constants drive the prompt + initial `cwd`. The swap
  must keep these call signatures stable (or update all three sites together).
- `seedSession` carries the load-bearing `computeWorkstationId` + real pubkey for the L1
  bypass — leave that intact; this slice only changes the *tree*, not the session identity.
- The test factory `src/test/factories/filesystem.ts` (`buildFile`/`buildDirectory`/
  `buildHomeFs`) is the established way to assert tree shape — reuse it in the RED test
  rather than hand-building `ReadonlyMap`s.

## Acceptance Criteria

Behaviour-driven, tested at the lowest level that gives confidence (pure unit tests in
vitest — this is pure generation logic; no UI/browser test needed).

- [ ] Given a fixed identity pubkey, the generated workstation base FS is **byte-identical**
      across repeated generation (determinism).
- [ ] Two different pubkeys produce **different** `guest` password hashes in `/etc/passwd`
      (the seed actually drives output — kills the "ignores seed" mutant).
- [ ] The generated tree is exactly the minimal skeleton: `/etc/passwd`, `/home/<username>`,
      `/root`, `/tmp` — and nothing else (no `/bin`, `/lib`, logs).
- [ ] `/etc/passwd` is well-formed: one line per user, 7 colon-delimited fields; `root`
      uid 0 with `md5(rootPassword)`; `<username>` uid 1000 with empty hash; `guest` uid 1001
      with `md5(<seeded guest password>)` (blueprint §6.3).
- [ ] `/home/<username>` exists and is named from the typed config username (not `'alice'`).
- [ ] Through the existing read path, `cat /etc/passwd` and `ls /home` reflect the generated
      content (the swap is wired into `ui/seed.ts`'s real consumers, not a parallel module).
- [ ] Permissions match the current `seed.ts` boundaries via the walker: `/etc/passwd`
      readable by root+user only (NOT guest — passwords inline, no `/etc/shadow`); `/root`
      root-only; `/home/<username>` root+user; `/tmp` world-writable.
- [ ] `md5` port: verified against known vectors (e.g. `md5('')` = `d41d8cd98f00b204...`) so
      hashes are real, not stubbed.

## Slices

This story is a single PR. Follow RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR.
Load `tdd`, `testing`, `mutation-testing`, `refactoring` before any code.

### Slice 1: Seeded workstation base FS replaces the static tree

**Value**: Player — same observable `ls`/`cat`, now seed-driven; foundation for all
generation.
**Path**: `core/generation` (PRNG port + `md5` port + `buildWorkstationBaseFs(seed, config)`
+ `generatePasswd(users)`) → emits the base `Directory` → existing `applyPatches` → `fsView`
→ `ls`/`cat`. `config` = the typed `{ machineName, username, rootPassword }` from Story 0.
Intentionally skipped: topology, remote machines, ports, auth, role templates, `/bin` tools.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`
(+ `typescript-strict` for the schema/types, `functional` for the pure builders).
**Acceptance criteria**: the list above. **Present to human and confirm before RED.**
**RED**: First failing tests — (1) `md5` against known vectors; (2) `buildWorkstationBaseFs`
with a fixed pubkey + config produces a tree whose `/etc/passwd` equals a known expected
string; (3) two different pubkeys → different guest hash (kills seed-not-used). Likely
mutants to pre-empt (from `mutator-rules.md`): string literals in passwd fields (uid `0`,
`1000`, `1001`; shell `/bin/bash`; home paths), the uid boundary, array/loop bounds in user
generation, and constant-fold of the seed. Assert tree shape via the
`test/factories/filesystem.ts` helpers.
**GREEN**: Port `prng.ts` (Mulberry32 + FNV-1a) and `md5` verbatim from legacy; minimal
builder that assembles the 4-node skeleton `Directory` and a `generatePasswd` over
`[root(md5 rootPassword), player(empty), guest(md5 seeded-pick)]`.
**MUTATE**: Run `mutation-testing` over `core/generation`; produce the report.
**KILL MUTANTS**: Strengthen tests for survivors; ask the human when a survivor's value is
ambiguous (e.g. a noise-file content literal not asserted — may be acceptable-equivalent).
**REFACTOR**: Assess only if it adds value (e.g. extracting a `mkFile`/`mkDir` helper if the
builder is repetitive — mirrors legacy `helpers.ts`).
**Done when**: all acceptance criteria met, mutation report reviewed, human approves commit.

## Pre-PR Quality Gate

1. Mutation testing — run `mutation-testing` skill (Stryker; note v2 quirks:
   load-throw survivors are tooling-equivalent per project memory).
2. Refactoring assessment — run `refactoring` skill.
3. Typecheck + lint pass — **v2 has no Prettier; `npm run lint` is the format gate** (do not
   run `npm run format` in `v2/`).
4. Bump version (package.json + package-lock) per the feature-bump preference.

---

_Delete this file when the slice is shipped. Then graduate Story 2 from the epic file._
