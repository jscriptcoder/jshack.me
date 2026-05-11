# Workstation Registry

Server-side record of every player's own workstation. Backs `/api/register-workstation` — a once-per-game endpoint that records `(player_key, workstation_name, username)` and populates `machine_filesystems` with the workstation's base FS so L2 enforces against intruder writes.

**Why it exists**: closes the leaf-only fallback in `enforceL2` for own-workstations. Before this module, an intruder with a cracked session on Player A's workstation could forge envelopes that bypass L2 — A's machine_id had zero rows in `machine_filesystems`, so the walker's "no row → permit" branch let the write through. Owner writes on the player's own box stay bypassed via `isOwnWorkstationOnServer`; this module only changes the non-owner path.

See the `project_l2_followups` memory entry (chunk #1b) for the full design.

## Files

| File                | Description                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`          | Strict zod schema for the signed `registerWorkstation` payload, plus the `WorkstationRow`, `UpsertWorkstationResult`, `PopulateBaseFsResult` shapes.                                                                                   |
| `handler.ts`        | Pure request handler: verify envelope → rate-limit → upsert workstation → populate base FS (best-effort) → return 201/200/409 per outcome. server-stamps `player_key` from the verified pubkey.                                        |
| `supabaseUpsert.ts` | `INSERT ... ON CONFLICT (player_key) DO NOTHING` + read-back select. Returns the discriminated `UpsertWorkstationResult` (fresh-insert vs idempotent-existing) so the handler can decide between 201, 200 (match), and 409 (mismatch). |
| `*.test.ts`         | Unit tests per module.                                                                                                                                                                                                                 |

## Idempotency

A player's `(workstation_name, username)` is treated as immutable per `player_key`. Re-calling `register` with the same fields is a no-op (200). Re-calling with **different** fields surfaces 409 `already_registered` — silently overwriting would change the workstation_id and orphan every dependent `machine_filesystems` row.

## Base-FS population

On a fresh insert, the handler invokes `populateBaseFs(row)`. The Vercel adapter wires this to `regenWorkstationRows` (in `src/machineFilesystems/`) followed by `bulkInsertMachineFs` against the `machine_filesystems` table. Populate failures are logged but don't fail the request — the backfill script in `scripts/backfillWorkstationBaseFs.ts` catches misses idempotently. Same posture as the home/world populate paths.

## What's NOT stored

- `seed`, `rootPassword`, `hostname` — unnecessary for L2's needs. The Step 1 invariant test (`src/generation/generateLocalhost.test.ts`) pins the contract that FS structure (paths/owners/perms) is invariant under those fields. The server regens the workstation FS with placeholder values; only `username` is structurally load-bearing.
