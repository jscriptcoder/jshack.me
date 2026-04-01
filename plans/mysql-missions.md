# Plan: MySQL Mission Objectives

**Branch**: feat/mysql-missions
**Status**: Active

## Goal

Add three new mission objective types (`db_exfiltrate`, `db_tamper`, `db_sabotage`) that use the MySQL command as the attack vector, expanding the game's database machines from passive scenery to interactive mission targets.

## Design Decisions

**New objective types vs extending existing ones**: We add 3 new types rather than branching inside `exfiltrate`/`tamper`/`sabotage`. This keeps each objective's generation, verification, and hints self-contained — no branching in existing code, clear intent on the mission board.

**Database content strategy**: Mission-specific data is injected into the database during filesystem generation. `generateDatabase()` already runs for machines with port 3306. For mission targets, we enrich the generated database with objective-specific content (an ACCESS-KEY row, a tamper field, or a critical table to drop).

**Verification approach**: All three objectives verify by reading `/var/lib/mysql/data.json` from the target machine (same as tamper reads files). No need for a live MySQL connection during verification — the JSON is the source of truth since all mutations persist through filesystem patches.

**Target machine selection**: Only machines with `database` role (port 3306 open) can be MySQL mission targets. `buildMissionObjective()` filters candidates accordingly when these objective types are selected.

**Proof format**:
- `db_exfiltrate`: Player mails the ACCESS-KEY found via SELECT → `mail(client, "ACCESS-XXXX-XXXX-XXXX")`
- `db_tamper`: Player UPDATEs the row, then mails confirmation → `mail(client, "done")`
- `db_sabotage`: Player DROPs/DELETEs the target table, then mails confirmation → `mail(client, "done")`

## Acceptance Criteria

- [ ] `db_exfiltrate` objective: ACCESS-KEY hidden in a database table, player must SELECT it and mail proof
- [ ] `db_tamper` objective: specific value in a table row must be UPDATEd, verified by reading database JSON
- [ ] `db_sabotage` objective: a critical table must be DROPped or all rows DELETEd, verified by reading database JSON
- [ ] Seed keywords `db-exfiltrate`, `db-tamper`, `db-sabotage` control objective selection
- [ ] Mission board includes at least 3 MySQL missions (one per type, across difficulties)
- [ ] Briefing hints explain the MySQL workflow (connect, query/modify, mail proof)
- [ ] All existing tests still pass; new objectives have unit tests for generation and verification
- [ ] Build, lint, format clean

## Steps

### Step 1: Add MySQL objective types and properties to the type system

**Test**: Test in `attackChain.test.ts` (or types test) that asserts `MissionObjectiveType` includes `'db_exfiltrate' | 'db_tamper' | 'db_sabotage'` and that `MissionObjective` accepts the new optional fields (`dbTargetTable`, `dbTamperColumn`, `dbTamperOldValue`, `dbTamperNewValue`).
**Implementation**: Add the 3 new types to `MissionObjectiveType` union in `src/generation/types.ts`. Add optional MySQL-specific fields to `MissionObjective`. Add seed keyword entries to `SeedOverrides` parsing in `generateMission.ts`.
**Done when**: TypeScript compiles with the new types. Seed keyword parsing recognizes `db-exfiltrate`, `db-tamper`, `db-sabotage`.

### Step 2: Add mission-aware database generation

**Test**: Unit test for a new `enrichDatabaseForMission()` (or similar) function that, given an objective type and a `MysqlDatabase`, returns an enriched database with the mission-specific content injected (ACCESS-KEY row for exfiltrate, tamper field for tamper, critical table for sabotage).
**Implementation**: Create generation helpers (likely in `src/generation/pools/database.ts` or a new file) that inject mission content into an existing database. For `db_exfiltrate`: add an ACCESS-KEY value to an existing table or a new `secrets` table. For `db_tamper`: ensure a specific row has the old value. For `db_sabotage`: mark a table as the target.
**Done when**: Given a PRNG and objective type, the helper deterministically produces a database with the expected mission content.

### Step 3: Build objective generation for all 3 MySQL types

**Test**: Unit tests for `buildDbExfiltrateObjective()`, `buildDbTamperObjective()`, `buildDbSabotageObjective()` — each takes a target machine + PRNG and returns a well-formed `MissionObjective` with correct type, description, expectedProof, and MySQL-specific fields.
**Implementation**: Add the three builder functions in `src/generation/attackChain.ts`. Register them in the main `buildMissionObjective()` dispatcher. Ensure target machine has role `database` (filter candidates). Wire the enriched database into filesystem generation so the target machine's `/var/lib/mysql/data.json` contains the mission data.
**Done when**: `generateMissionNetwork(seed)` with a `db-exfiltrate`/`db-tamper`/`db-sabotage` keyword produces a valid mission with a database-role target machine containing the correct database content.

### Step 4: Add verification functions for MySQL objectives

**Test**: Unit tests for `verifyDbExfiltrate()`, `verifyDbTamper()`, `verifyDbSabotage()` — test success and failure cases by providing mock `readFileFromMachine` that returns database JSON in various states (original, modified, table dropped).
**Implementation**: Add three verify functions in `src/commands/mail.ts`. Register them in `verifyProof()`. `db_exfiltrate` checks proof matches expectedProof (same as regular exfiltrate). `db_tamper` reads the database JSON, parses it, checks the target table/column has the new value and doesn't have the old value. `db_sabotage` reads the database JSON, checks the target table is missing or empty.
**Done when**: `mail()` correctly validates all three MySQL objective types — success when database state matches, failure with descriptive error messages when it doesn't.

### Step 5: Add briefing hints and content-optional flags

**Test**: Unit test that `formatObjectiveHint()` returns appropriate hints for each MySQL objective type (mentions `mysql()`, `SELECT`/`UPDATE`/`DROP TABLE`). Test that `mail()` accepts content-optional for `db_tamper` and `db_sabotage`.
**Implementation**: Add cases to `formatObjectiveHint()` in `src/commands/accept.ts`. Add `db_tamper` and `db_sabotage` to the content-optional list in `mail.ts`. Write descriptions that guide the player through the MySQL workflow.
**Done when**: Briefing shows clear MySQL-specific instructions. Player can submit proof correctly for all three types.

### Step 6: Add mission board seeds and update docs

**Test**: Verify that mission board seeds with MySQL keywords generate valid missions (smoke test via `generateMissionNetwork`).
**Implementation**: Add 3-6 MySQL mission seeds to `src/mission/missionBoard.ts` across difficulties. Update `mission-variations.md` with the new objective types. Update `CLAUDE.md`, `architecture.md`, and relevant READMEs. Bump version.
**Done when**: `missions()` shows MySQL missions. Full build + lint + test pass. Docs reflect the new objectives.

## Pre-PR Quality Gate

Before the PR:

1. `npm run build` — clean
2. `npm run lint` — no new warnings
3. `npm run format` — clean
4. `npm run test:run` — all pass
5. Verify with dump script: `npx tsx scripts/dumpMissionNetwork.ts <mysql-seed>` shows database content on target machine

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
