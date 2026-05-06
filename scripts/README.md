# Scripts

Standalone TypeScript utilities run via `tsx`. Roughly four kinds of work live here: a build helper, deterministic inspection of generated networks, one-off DB backfills, and forge-driven wire smokes against `vercel:dev`. Most ship with a header comment that explains usage; this README is the index.

The canonical invocation strings (with the right `dotenv -e .env.development.local --` prefixes and flags) live in `.claude/CLAUDE.md` under **Debug Scripts**. Treat this README as the conceptual map: _what kind of script do I need right now?_

## Files

| File                             | Group                 | One-liner                                                                     |
| -------------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `encode.ts`                      | Build helper          | Generates `src/secrets/__encoded.ts` from `secrets.ts`. Auto-run by npm.      |
| `dumpMissionNetwork.ts`          | Network inspection    | Dump a full mission network (machines, ports, users, FS) from a seed.         |
| `dumpHomeNetwork.ts`             | Network inspection    | Dump home networks for a `gameSeed`, all-WiFi or specific index.              |
| `simulateExploit.ts`             | Network inspection    | Simulate `msfconsole(ip, port)` — CVE, effect, NAT chain — without the game.  |
| `inspectPort.ts`                 | Network inspection    | Inspect one mission machine's per-port `forcedEffect` / version / CVE state.  |
| `backfillHomeNetworkBaseFs.ts`   | L2 backfill           | Regenerate every `home_networks` FS and bulk-populate `machine_filesystems`.  |
| `backfillWorldNetworkBaseFs.ts`  | L2 backfill           | Same shape for `world_networks` (findit.io, playground, future themed nets).  |
| `backfillWorkstationBaseFs.ts`   | L2 backfill           | Same shape for `workstations`. Catches pre-existing rows the API path missed. |
| `verifyMachineFilesystemsRls.ts` | DB posture verifier   | Probe RLS on `machine_filesystems` (anon denied / service_role allowed).      |
| `verifyWorkstationsRls.ts`       | DB posture verifier   | Same shape on `workstations`. 5 probes, expects 5/5 after the migration.      |
| `verifyDualWrite.ts`             | DB posture verifier   | Verify `upsert_patch_with_fs` / `remove_patches_with_fs` plpgsql contracts.   |
| `testL2Bypass.ts`                | Forge wire smoke (L2) | Forge `upsertPatch` envelopes; verify L1 + L2 enforce. 3 scenarios.           |
| `testL2BypassWorkstation.ts`     | Forge wire smoke (L2) | Same but scoped to a freshly-registered workstation (closes own-workstation). |
| `testReadPathPrivacy.ts`         | Forge wire smoke (L2) | Forge `listPatchesForMachines`; verify three-tier read filter. 3 scenarios.   |
| `testRegisterWorkstation.ts`     | Forge wire smoke      | E2E for `/api/register-workstation`. 8 checks (2xx / 4xx / DB-side).          |
| `testAmbientLogAllowlist.ts`     | Forge wire smoke (L1) | Forge `upsertPatch` to `/var/log/*`; verify the 8-file ambient-log allowlist. |

## Build helper

`encode.ts` is the only script in the repo that's part of the build pipeline. It reads plaintext secrets from `src/secrets/secrets.ts` and emits the obfuscated `src/secrets/__encoded.ts` consumed at runtime. It runs automatically before `dev`, `build`, `test`, `test:run`, and `test:coverage` via the matching `pre*` npm hooks — not normally invoked directly.

## Network inspection

Read-only scripts that re-execute the deterministic generators with a known seed and print the resulting state. Use these instead of writing ad-hoc dump scripts when:

- A mission/network feels "off" and you want to diff against the generator's output.
- Verifying that a generator change produced the expected machine/port shape.
- Debugging a CVE/effect mismatch reported by a player or test.

`dumpMissionNetwork.ts` and `dumpHomeNetwork.ts` both accept `--cat <ip|hostname>:<path>` to print one file's content in full instead of the per-machine FS tree summary. `simulateExploit.ts` and `inspectPort.ts` answer "what does the game think this port does?" without booting the runtime.

## L2 backfills

Idempotent (`ON CONFLICT DO NOTHING`) bulk-population of `machine_filesystems` rows for the four machine surfaces L2 enforces on. Each script regenerates the relevant base FS deterministically (so re-running on existing rows is safe) and writes only the rows missing from `machine_filesystems`. Pass `--dry-run` to see the counts without touching the table.

Run order matters once: home + world + workstations after their respective migrations land. The corresponding API write paths (`/api/register-workstation`, gameplay patch handler) keep `machine_filesystems` in sync going forward; these backfills exist to catch rows that pre-date their dual-write coverage.

## DB posture verifiers

Single-purpose probes that assert a security-critical DB invariant. They make 4–5 calls each (anon read, anon write, service_role read, etc.) and exit non-zero if any probe returns the wrong shape. Run after any migration that touches RLS policies, the dual-write SQL functions, or table-level grants.

These are tighter than the forge-wire smokes — they hit the DB directly with `@supabase/supabase-js`, no HTTP layer in scope.

## Forge wire smokes

The "real" attacker model. These scripts:

1. Generate fresh Ed25519 identities (the same `generateIdentity()` real clients use).
2. Sign one or more action envelopes via `signRequest`.
3. POST them to `vercel:dev`'s `/api/*` endpoints — exactly what a Burp/curl/hex-edited-client attacker would do.
4. Assert each response's status + error body against the expected enforcement.

Required for any PR that touches `enforceL2`, the walker, dual-write SQL, `findActiveSession`, the read-path filter, or the L1 ambient-log allowlist. The unit tests prove the layers in isolation; these prove they're wired together correctly on the wire.

All forge smokes are **self-cleaning** — they delete sessions/patches keyed on the run's forged player_keys via `service_role` so they're idempotent and safe to re-run on any environment that points at a non-prod Supabase. They require:

- Local Supabase up (`npm run supabase:start`; `npm run db:reset`).
- For some, a populated machine network (`backfill*BaseFs.ts`).
- `npm run vercel:dev` running in another terminal.

When adding a new script of this kind, mirror the existing structure: deps probe → fresh identity → sign envelope → POST → assert → cleanup.

## Adding a new script

1. Pick the group it belongs to and pattern-match an existing sibling for shape.
2. Header comment with: purpose, prerequisites, usage example, and (for forge smokes) the expected response shape per scenario.
3. Add a one-liner to the **Files** table above and (if it has a non-trivial invocation) an entry under **Debug Scripts** in `.claude/CLAUDE.md`.
4. Self-cleaning is the default for anything that writes to the DB — track player_keys / inserted IDs and delete on exit.
