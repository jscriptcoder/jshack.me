# Carrying a file home past 8192 — grill record + plan

**Status:** Active — grilled 2026-10-18, no slice started.

Goal: a generated file any tier can read can be carried home (`ftp get`, `scp`, `cp`, a
`nano` save), and a file that still cannot be says so truthfully instead of `I/O error`.

## Facts established before the grill

- Saving a file is one signed `upsertPatch`, and `signedEnvelopeSchema`
  (`src/core/signedRequest/types.ts`) caps the envelope's `payload` at 8192 characters of
  JSON. Over it the server answers `400 envelope_invalid`, `createPatchApi` maps that to
  `network_error`, and the player reads `local: <path>: I/O error`.
- The cap is the **only** bound on content anywhere: `upsertPatch`'s `content` is an
  unbounded `z.string()`, and `api/` has no rate limiter (the legacy blueprint's Upstash
  limiter was never ported). The 8192 came from the legacy blueprint, unexplained.
- It caps more than carried files: a player's own `nano` save, `cp` on any box, and a
  script hole's step-2 `writes` (all writes of one run, in one envelope).
- Measured 2026-10-18 over the whole world (619 networks, 3,812 boxes, 310,063 generated
  files, every base tree: LAN, deep layer, gateways, fixed sites), payload as
  `createPatchApi` would sign it: **1,143 files over the cap on 943 boxes**, 613 boxes with
  one a guest can read. By file: `auth.log.1` 612 boxes (median 10.5K, max 20,878, every
  tier); `/var/lib/{mysql,redis}/data.json` 435 (max 21,772, root); `mail.log.1` 79 (max
  21,471, root); `syslog.1` 15 (max 10,041, every tier); mapit.io's `ridgemont.html`
  (15,932) and `kingsford.html` (12,435), public. The backlog's v0.258.0 count was 102
  `auth.log.1`s; the procedural world multiplied it.
- Live logs grow without bound server-side: `appendMachineLogLines` reads the log whole and
  writes it back longer, past the envelope. One 79-attempt `hydra` run adds ~7K.
- Six tests check their own content kind against a hard-coded 8192 (`share`,
  `gatewayAdminUi`, `gatewayBackups`, `device`, `gatewayNetwork`, `phoneHome`); none sees
  the files above, which is how they escaped. All six build from base trees.
- Slices 8a and 8b of world content already shrank content to fit (document stubs,
  `vsftpd.log.1` cut from whole visits to one line per arrival); the world grew past the
  cap again.

## Decisions

1. **Raise the cap; leave generated content as it is.** Shrinking has lost twice, would
   make 1,000+ files less believable, and cannot help a player's own big file. Rejected:
   shrink to 8192; a per-action cap for `upsertPatch` only; chunked writes.
2. **The new cap is 65,536 characters**, one cap on the envelope for every action — three
   times today's largest file (21,772), still a terminal file rather than a blob store,
   far under Vercel's 4.5 MB body limit. Rejected: 32 KiB (the next world growth breaks
   it); ~1 MB (multi-MB journal rows with no rate limiter in front).
3. **One whole-world test guards it**, replacing the six per-kind checks wherever it covers
   their content: every tier, root-only files included (root's loot is what gets carried).
4. **A file still over the cap is refused truthfully, client-side, before sending:**
   `File too large` (EFBIG's wording; `local: <path>: File too large` in ftp). Not a nudge —
   the honest error. Rejected: server-side rotation of live logs (moves a defender's
   evidence into `.1`); leaving `I/O error`.
5. **Content shrunk for the old cap stays shrunk.** The comments that cite 8192
   (`logHistory.ts`, `documentFormats.ts`) are reworded; `backlog.md` notes that
   `vsftpd.log.1` could hold whole visits again.

Taken on Claude's recommendation, the owner confirming them together:

6. **One exported constant**, `MAX_SIGNED_PAYLOAD = 65_536` beside `signedEnvelopeSchema`,
   read by the schema, the world test and the client check. The `CARRY_CAP` copies go.
7. **The refusal lives where the request is signed, not in each command.**
   `createPatchApi` measures the payload it is about to sign and returns a new
   `PatchResult` error `too_large`; `PATCH_ERROR_REASON` gains `too_large: 'File too
   large'`, as do the local tables in `scp`, `ftpShell`, `Nano`, `rm`, `touch` (the
   exhaustive `Record` types flag any missed). A script hole's step-2 `writes` travel
   through `sessionsApi` and get the same check. No other signed action carries file
   content.
8. **The world test reads every network** (`WORLD_ESSIDS`, not the sample — one rare
   network breaks the claim; the full build took ~9 s) and sends the largest 20 files per
   tier through the real `createPatchApi`, checking each request against
   `signedEnvelopeSchema`, as `share.test.ts` does today. Each per-kind check is confirmed
   covered before it is deleted.
9. **Two slices, two PRs, a minor bump each** (below).
10. **One browser run at close-out:** a guest `ftp get`s a ~20K `auth.log.1` home and `cat`s
    it; a root `scp`s a `data.json` home. The refusal is unit-proven; building a 64 KiB
    file by hand in a browser costs more than it proves.
11. **Docs:** the conventions rule (65,536, pointing at the world test), the e2e skill's
    `I/O error` row, `world-content-architecture.md:464`, the backlog item closed with the
    measurement above, and `project-status.md` on close-out.

## Slices

### Slice 1 — a generated file of up to 64 KiB can be carried home (v0.399.0)

**Value:** a player who reaches any generated file — a guest's `auth.log.1`, a root's
`data.json`, a mapit town page — saves it on their own box with `ftp get`, `scp` or `cp`.
**Path:** command → `createPatchApi.write` → signed envelope → `api/patches` →
`verifySignedRequest` (`signedEnvelopeSchema`) → `upsertPatch` → `patches` row → read back.
**Class:** behavior change. **Delivery:** independent PR against `main`.
**Required skills:** `tdd`, `testing`, `refactoring` (the per-kind check removal).
**Acceptance criteria:**
- Every generated file in the world, at every tier that can read it, fits one
  `upsertPatch` the real `createPatchApi` signs (the whole-world test, over
  `WORLD_ESSIDS`).
- A payload of exactly `MAX_SIGNED_PAYLOAD` characters verifies; one over it is
  `envelope_invalid`.
- Live, against `vercel dev` + supabase (`scripts/testLargePatch.ts`): a ~60K file written
  to the caller's own workstation reads back byte-identical, and an over-cap payload is
  still refused `400 envelope_invalid` — nothing between the browser and the row caps
  lower.
- The six per-kind carry checks are gone wherever the world test covers their content; no
  test restates 8192.
**RED:** the whole-world test, against today's 8192, fails on `auth.log.1` and the rest;
the boundary test on `signedEnvelopeSchema` fails at 8193.
**GREEN:** `MAX_SIGNED_PAYLOAD = 65_536`, read by the schema.
**REFACTOR:** delete the covered per-kind checks; reword the 8192 comments; docs per
decisions 5 and 11 (minus `project-status.md`).
**PRE-PR MUTATION:** Stryker on `src/core/signedRequest/types.ts` (the boundary); the world
test itself is the evidence for content.
**PR-ready when:** gates green (`npm run typecheck`, `npm run lint`, full vitest),
`testLargePatch.ts` passes live, the owner approves the commit.

### Slice 2 — a file over 64 KiB is refused as `File too large` (v0.400.0)

**Value:** a player whose write cannot fit (a live log grown by sweeps, their own huge
file) is told the truth before anything is sent, instead of an `I/O error` that reads as a
network fault.
**Path:** command → `createPatchApi.write` / script hole step 2 in `sessionsApi` → size
check → `too_large` → the command's wording table → terminal line / nano status bar.
**Class:** behavior change. **Delivery:** independent PR against `main`, after slice 1.
**Required skills:** `tdd`, `testing`, `front-end-testing` (nano's status bar).
**Acceptance criteria:**
- A write whose signed payload would exceed `MAX_SIGNED_PAYLOAD` sends no request and
  returns `too_large`.
- `ftp get` of such a file prints `local: <path>: File too large`; `scp`, `cp`, `>`/`>>`,
  `touch` and `rm` report `File too large` in their own form; nano's save says it in the
  status bar and keeps the buffer.
- A script hole whose step-2 writes would exceed the cap sends no step 2 and the script
  reports `File too large`.
- A write that fits behaves exactly as before.
**RED:** a `createPatchApi` test with a `fetchImpl` that records calls — an over-cap write
returns `too_large` and makes no call; then one command test per wording table.
**GREEN:** the measure in `createPatchApi` and `sessionsApi`, the `too_large` rows.
**REFACTOR:** assess whether the per-command tables can read `PATCH_ERROR_REASON`.
**PRE-PR MUTATION:** Stryker on the two adapters' size checks. Wire-check `N/A` — no
`api/` change; the refusal never reaches the server.
**PR-ready when:** gates green, the owner approves the commit.

### Close-out

The browser run (decision 10), `project-status.md` item, backlog item marked closed, this
file deleted.
