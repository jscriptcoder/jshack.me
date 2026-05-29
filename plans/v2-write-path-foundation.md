# Plan: v2 Write-Path Foundation (server-authoritative)

**Branch**: feat/v2-write-path-foundation (per-slice branches in practice)
**Status**: Active

## Why this plan exists (the course-correction)

The blueprint (`docs/rewrite-blueprint/sections/04-multiplayer-foundation.md`, line 3)
says the multiplayer layer **MUST be stood up first; everything else assumes it
works.** But v2 has been built command-first (cat/cd/echo/grep/ls/pwd/registry/pipes)
— all pure single-player client. The server foundation is **not started**: no
`v2/api`, no `adapters/`, no `identity/`, no `signedRequest/`, no `supabase/`.
`PatchApi` is a throwing stub; identity/session are `seed*()` zeros.

The **writable filesystem is the fork point**: writes are the first feature that
genuinely needs the server. Building a local in-memory write path now would repeat
the exact legacy mistake (single-player surface, retrofit multiplayer later — the
source of cross-player-visibility, workstation_id, canonical-id, and closure-capture
scars). This plan instead makes the **first write server-authoritative**, standing
up the multiplayer spine every later chunk reuses.

The seams already exist and are correctly shaped: `PatchApi` is async
(`Promise<PatchResult>`), `RemoteApi` exists, identity/session/hopChain are on
`CommandEnv`, and `core/filesystem/walker.ts` is written to be shared client/server.
Nothing shipped is wasted — we fill real adapters behind existing seams.

## Locked decisions (2026-05-29)

1. **Fresh v2 Supabase project** — not the shared `jshack-dev` (legacy prod points
   there until launch; v2 migrations/`db:reset` must not touch it). Resolves the
   pending decision in `decisions.md`.
2. **Server write path first, Realtime as the immediately-following chunk** — keeps
   each PR under D10's ~400-line cap and independently smoke-testable.
3. **Reshape legacy core** (`src/identity`, `src/signedRequest`) into v2 by adapting
   to v2 types + re-TDD; **rebuild `api/` handlers fresh** against v2 contracts
   (per D12 "reuse shapes, not implementations").
4. **Legacy-parity FS semantics** (per memory `v2_match_legacy_command_interface`):
   - New-node owner = `session.username`; permissions from a ported
     `defaultPermissionsForNode` (files `read/write=[root,tier] execute=[root]`;
     dirs world-traversable, `write=[root,tier]`).
   - `>` truncates (upsert replaces content via PK). `>>` append **deferred**.
   - `mkdir -p`, `rm -r` flags match legacy.

## Scope

**In scope:** the spine that turns the throwing `PatchApi` into a real
server-backed write, delivering own-workstation file/dir creation that survives
reload, plus the `>` redirect, `touch`, `rm` writers — and Realtime cross-tab/
cross-browser sync as the final slice.

**Explicitly deferred to later plans** (cross-player attack surface, blueprint
§4.6–4.13, §5): sessions table + `authCreateSession`, L1 session-requirement for
*non-own* machines, L2 walker enforcement against `machine_filesystems`, the
three-tier read filter, `getBaseFs` replication, `exploitRead`, `crackCredentials`.
The own-workstation **L1 bypass** (suffix-match) means own-box writes need none of
these — which is exactly why it's the thinnest real first slice.

## Acceptance Criteria

- [ ] A player has a real, persistent Ed25519 identity; the `identity` command
      prints their pubkey + fingerprint, stable across reloads.
- [ ] A signed envelope round-trips (sign → verify) and is rejected on tamper,
      replay (duplicate nonce), and timestamp skew.
- [ ] The fresh v2 Supabase `patches` table denies anon/authenticated and permits
      only service_role (RLS verifier passes).
- [ ] A signed `upsertPatch` for the caller's own workstation persists a `patches`
      row with no session required (own-workstation L1 bypass), verified by a
      wire-payload smoke test against `vercel:dev`.
- [ ] Creating a directory (`mkdir`) on the own workstation persists via the server
      and the new directory appears in `ls` **and survives a page reload** (fsView
      applies fetched patches over the base FS).
- [ ] `echo hi > notes.txt` then `cat notes.txt` shows `hi`, server-backed and
      reload-durable; `>` truncates an existing file.
- [ ] `touch` and `rm` (with `-r` for directories) work through the same path.
- [ ] A write in one browser tab/instance appears in another via Realtime hints
      (+ BroadcastChannel for same-browser tabs) without a reload.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code
without a failing test. Before code on any slice, load `tdd`, `testing`,
`mutation-testing`, `refactoring` (+ `typescript-strict`, `api-design` for the
endpoint).

### Slice 1: Real Ed25519 identity behind the `identity` command

**Value**: Player — sees a stable cryptographic identity; every future signed
request has a real key to sign with (replaces the all-zeros `seedIdentity`).
**Path**: `identity` command → `core/identity` `getOrCreateIdentity()` (localStorage
singleton `jshack.identity`, `@noble/ed25519` + `@noble/hashes` sha512 wired at load)
→ prints `Identity: ed25519:<64hex>` + `Fingerprint: <16hex>`. `buildCommandEnv`
sources the real identity. Malformed storage → silent regenerate (per
`project_multiplayer_identity_wallet_keys`).
**Required implementation skills**: tdd, testing, mutation-testing, refactoring, typescript-strict.
**Acceptance criteria**: generate produces 32-byte keys + 64-hex pubkey; load round-trips;
corrupt/missing storage returns null → regenerates; `identity` command output matches
the two-line shape; identity stable across reload (manual UI smoke).
**RED**: `core/identity` unit tests (generate shape, load round-trip, defensive null on
bad hex/length/missing fields); `identity` command test asserts output lines via mockCommandEnv.
**GREEN**: reshape legacy `src/identity/{identity,hex}.ts` to v2; add `getOrCreateIdentity`
localStorage singleton; add `identity` command + register it.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met; `@noble/*` added to `v2/package.json`; human approves.

### Slice 2: Signed-envelope core (sign + verify) — horizontal unblock

**Value**: Unblocks Slice 4 (the endpoint). Pure, framework-agnostic, shared
client/server. Smaller as its own PR than folded into the endpoint.
**Path**: `core/signedRequest` `signRequest(identity, action, fields)` →
`{payload, publicKey, signature}`; `verifySignedRequest(envelope, schema, deps)` →
cheapest-first order (shape → ed verify → JSON.parse → base+caller schema → ts window
→ nonce dedupe). `NonceStore` interface with `noopNonceStore` for local dev.
**Required implementation skills**: tdd, testing, mutation-testing, refactoring, typescript-strict, api-design.
**Acceptance criteria**: sign→verify round-trips; tampered payload → `signature_invalid`;
bad envelope shape → `envelope_invalid`; non-JSON payload → `payload_malformed`; schema
miss → `payload_invalid`; ts outside 120s → `timestamp_skew`; duplicate nonce → `replay`;
caller-supplied `action`/`ts`/`nonce` are stripped/overwritten.
**RED**: verify decision-table unit tests (one per failure reason) + sign-strips-reserved test.
**GREEN**: reshape legacy `src/signedRequest/{sign,verify,types,nonceStore}.ts` to v2 + zod schemas.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills — verify the boundary checks (`>` vs `>=`
on the replay window, `Math.abs` bidirectional) are mutant-covered.
**Done when**: criteria met; horizontal-unblock justification holds (it directly enables Slice 4); human approves.

### Slice 3: Fresh v2 Supabase `patches` table + RLS verifier — horizontal unblock

**Value**: Unblocks Slice 4 (somewhere for the write to land) and proves the
zero-trust posture is real, not assumed.
**Path**: provision a dedicated v2 Supabase project; add `v2/supabase` migration for
`patches` (PK `(player_key, machine_id, path)`, content nullable, owner, permissions
jsonb, is_new, node_type) with universal-deny RLS (service_role only); add
`v2/scripts/verifyPatchesRls.ts` (anon denied / service_role permitted probes).
**Required implementation skills**: tdd (for any pure migration helper), testing; verifier is a script.
**Acceptance criteria**: migration applies on `db:reset`; verifier asserts anon
INSERT/SELECT denied (42501 / empty), service_role INSERT+SELECT ok, anon still empty post-write.
**RED**: the verifier script IS the executable check (project convention D12); assert all 5 probes.
**GREEN**: write migration + verifier; wire v2 supabase config + env.
**MUTATE**: N/A for SQL/infra — verifier output is the proof.
**Done when**: verifier passes against local v2 Supabase; env wiring documented; human approves.

### Slice 4: `/api/patches` upsertPatch with own-workstation L1 bypass + smoke

**Value**: API client / future commands — a signed own-box write persists
server-side with no session required. The multiplayer write boundary exists.
**Path**: `v2/api/patches.ts` glue (method guard → env → clients → handler) +
pure `handleUpsertPatch(body, deps)`: `verifySignedRequest` → rate-limit → if NOT own
workstation (`isOwnWorkstationOnServer` suffix-match via `computeWorkstationId`) →
(future session check; for now reject non-own with `no_session` 403) → upsert row.
`player_key` server-stamped from verified pubkey. `v2/scripts/testUpsertPatch.ts`
forges envelopes vs `vercel:dev`.
**Required implementation skills**: tdd, testing, mutation-testing, refactoring, typescript-strict, api-design.
**Acceptance criteria**: own-workstation signed upsert → 200 + row present; non-own →
403 `no_session`; tampered signature → 401; client-supplied `player_key` rejected
(400 `payload_invalid`); smoke test green against vercel:dev.
**RED**: handler unit tests (mocked supabase + nonce store) for each branch; reshape
`computeWorkstationId` into `core` first with its own tests (the `ed25519:` prefix is
load-bearing — see `project_workstation_id_ed25519_prefix`).
**GREEN**: port `computeWorkstationId` (+ `parseWorkstationId`); write handler + glue + smoke.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills — own-bypass suffix match is the critical mutant target.
**Done when**: unit + smoke green (smoke is mandatory per D12); human approves.

### Slice 5: Real PatchApi adapter + fsView-over-patches + `mkdir` (walking skeleton)

**Value**: Player — `mkdir` creates a directory that appears in `ls` and **survives
reload**. This proves the entire spine end-to-end: identity → sign → endpoint → DB →
fsView-over-patches → reload. `mkdir` (not `>`) is the skeleton writer because it needs
no shell-operator parsing.
**Path**: `v2/src/adapters/patchApi.ts` (`fetch` → signed `/api/patches`, hex→bytes
sign) replaces `patchStub`; `core/filesystem/applyPatches` layers fetched patches over
the seed base FS; UI loads patches for the own machine on boot and after each write
(optimistic apply + refetch); `mkdir` command (legacy `-p` parity) calls `patches.mkdir`
with `defaultDirectoryPermissions(session.username-tier)`.
**Required implementation skills**: tdd, testing, mutation-testing, refactoring, typescript-strict.
**Acceptance criteria**: `mkdir /home/alice/proj` → `ls /home/alice` shows `proj`;
reload → still present; `mkdir` on a permission-denied parent surfaces the legacy error;
`mkdir -p a/b/c` creates intermediates; the adapter signs with the real identity.
**RED**: `applyPatches` unit tests (create dir over base, last-write-wins, deletion marker);
`mkdir` command tests via mockCommandEnv with a mock PatchApi.
**GREEN**: write `applyPatches`, adapter, boot-load + post-write refetch wiring, `mkdir`.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met; one real UI smoke (create dir, reload, still there — watch the network tab per `feedback_e2e_test_new_primitives`); human approves.

### Slice 6: `>` redirect writes through the real path

**Value**: Player — `echo hi > notes.txt; cat notes.txt` → `hi`, reload-durable;
`>` truncates an existing file. Delivers the original feature goal on the now-real path.
**Path**: tokenizer emits a `redirect` token (operator only outside quotes; shape already
anticipated in `plans/v2-pipes.md`); `parsePipeline`/`runLine` captures stage stdout and
calls `patches.write(path, content)` (truncate via PK upsert). `>` to a directory → error.
**Required implementation skills**: tdd, testing, mutation-testing, refactoring.
**Acceptance criteria**: `echo hi > f` writes `hi`; second `>` truncates; `cat f` reads it;
reload-durable; `> existing-dir` errors; redirect inside quotes (`echo "a>b"`) is one word.
**RED**: tokenize tests (redirect token, quoted `>` is literal); runLine redirect-capture tests.
**GREEN**: extend tokenizer + runLine; route to `patches.write`.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met; UI smoke; human approves.

### Slice 7: `touch` and `rm` writers

**Value**: Player — `touch` creates empty files; `rm` (with `-r` for dirs) removes them;
both reload-durable. Rounds out the basic write command set.
**Path**: `touch` → `patches.write(path, '')`; `rm` → `patches.remove(path)` (legacy `-r`
parity for directories; base-fs deletion marker vs is_new delete handled by the adapter).
**Required implementation skills**: tdd, testing, mutation-testing, refactoring.
**Acceptance criteria**: `touch new.txt` → appears in `ls`, reload-durable; `rm new.txt`
removes it; `rm dir` without `-r` errors; `rm -r dir` removes recursively; removing a
base-fs file writes a deletion marker that survives reload.
**RED**: command tests via mockCommandEnv; adapter deletion-marker-vs-isNew test.
**GREEN**: implement both commands; adapter delete-path logic.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met; UI smoke; human approves.

### Slice 8: Realtime hint broadcasts + subscribe + BroadcastChannel

**Value**: Player — a write in one tab/browser appears in another within ~300-500ms
without reload. The "Realtime is most important" payoff, on the spine built above.
**Path**: handler fires fire-and-forget `broadcast(\`patches:${machine_id}\`, 'patch_change',
{machine_id, originator_key})` after successful upsert/remove (server `service_role` REST
publish); client `subscribeToMachine` skips own-key hints, debounces (~150ms) a refetch set,
re-fetches via the signed endpoint, replays pending local writes on top. `BroadcastChannel`
fans same-browser tabs via the shared `applyExternalPatch`. **Hint-only** (no content in the
broadcast) — forgery is harmless by construction (§4.14).
**Required implementation skills**: tdd, testing, mutation-testing, refactoring.
**Acceptance criteria**: own-key hint is skipped (no self-refetch loop); foreign hint
triggers a debounced refetch that splices server truth; pending local write isn't clobbered
by a concurrent refetch; two-tab UI smoke shows a write propagating without reload.
**RED**: subscribe-logic unit tests (skip-own, debounce-batch, replay-pending) with a mock channel.
**GREEN**: server broadcast call; client subscribe + BroadcastChannel + applyExternalPatch.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met; two-browser smoke verified (per `feedback_e2e_test_new_primitives`); human approves.

## Pre-PR Quality Gate (each slice)

1. Mutation testing (run `mutation-testing`).
2. Refactoring assessment (run `refactoring`).
3. `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` pass (in `v2/`).
4. For server slices (4, 8): the mandatory wire-payload smoke vs `vercel:dev` is green —
   an endpoint is NOT "shipped" without it (D12 + `feedback_e2e_test_new_primitives`).
5. Bump `v2/package.json` version on each shipped chunk (memory: bump on feature changes).

## After this plan

Cross-player attack surface (sessions, L1-for-others, L2 enforcement, read filter,
base-FS replication, exploitRead, crackCredentials — blueprint §4.6–4.13, §5) becomes
the next plan, building directly on this spine. The own-workstation bypass means none of
it blocks shipping reload-durable single-player-feeling writes that are *already*
server-authoritative and multiplayer-ready.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
