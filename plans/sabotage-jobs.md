# Plan: a contract that asks for a machine to be taken down

**Status:** Grilled and planned 2026-11-12. Two slices, one PR each, merged in order. Nothing is
built. Next: slice 1's acceptance criteria to the owner, then RED.

A third kind of contract. Key jobs compare a mailed key; tamper jobs read a records box. A
**sabotage job** asks the player to take one of the target's machines down for good (a CCTV
recorder, a backup server, a monitoring station), and the client checks that it no longer boots.
It brings back legacy's `sabotage` objective
([`docs/mission-ideas/objectives.md`](../docs/mission-ideas/objectives.md) §3,
[`docs/mission-ideas/mission-loop.md`](../docs/mission-ideas/mission-loop.md) §2) on v2's brick
rule (`canBoot`, `src/core/boot/bootFiles.ts`). As-built context:
[`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

### The job

1. **The kind is called `sabotage` (2026-11-12),** legacy's name, beside `key` and `tamper`.

2. **The target is the key-box slot (2026-11-12).** Same octet, route, decoys and front box as a
   key or records box; on a two-hop contract it is the inside box. Every route already roots that
   box, so the job is solvable by construction, as the records box is the key box with records
   instead of a key. Rejected: the gateway (more dramatic, it takes the whole network dark, but its
   admin is uncrackable by design and it would need a guaranteed route of its own); the front box
   on two-hop (an easier job that wastes the inside hop).

3. **It carries no storage and no role-specific services (2026-11-12).** No key, no records, no
   `:3306`; its scan is the route plus decoys, as on every contract. It needs no
   `MISSION_KEY_SECRET`, as a tamper job does not.

### The proof

4. **Done when the target does not boot (2026-11-12).** `canBoot` false on the target box,
   `vmlinuz` or `initrd.img` gone, as the client reads the box on any mail from the contractor
   (the same read a tamper job makes, through `generatedLanBox`, which already reports whether the
   box boots). The mail's words do not matter; only its wallet does. **No reboot is required**: in
   v2 the tombstone alone takes the box dark, and a reboot only ends sessions, so asking for one
   would test a step that changes nothing (legacy needed it because its bricked flag was set by
   `reboot`). Any way that breaks the boot counts, `rm /boot/initrd.img` or a wiped `/` alike.

5. **Anyone's brick counts (2026-11-12).** If a rival or anyone holding the address bricks the
   target before the contractor mails, the contractor is still paid: the client wants it down and
   it is down. The mirror of tamper jobs, where another visitor's brick costs the job.

6. **A completed job is closed without reading the box,** as a tamper job's is; a brick is
   permanent anyway.

7. **The replies (2026-11-12)**, subject `Contract: <target>`:

   | The box                      | The reply                                                                                   | What changes              |
   | ---------------------------- | ------------------------------------------------------------------------------------------- | ------------------------- |
   | Does not boot, with a wallet | "The machine is down. §X sent to jsc…. Pleasure doing business."                            | completed, the pay minted |
   | Does not boot, no wallet     | "The machine is down. You sent no wallet, so there is nothing to pay. No wallet, no money." | completed, nothing minted |
   | Still boots                  | "Their machine is still up. No outage, no money."                                           | nothing                   |
   | A completed job              | "That job is already closed." (the box is not read)                                         | nothing                   |

   The no-contract and read-failure rows are as for every kind.

### The draws and the terms

8. **Thirds on `mission-kind-<n>` (2026-11-12)**, about a third each of key, tamper and sabotage.
   This re-rolls the kind of some existing numbers, accepted ones on prod included; that is free
   until launch (only test accounts and the bot play on prod). An active job that flips kind gets a
   briefing that no longer fits its network, and dropping it costs nothing. Rejected: sabotage
   rarer, one in five (the route to root is the same work as a key job's, and variety is the
   point).

9. **Pay is the key job's (2026-11-12):** 500–2,000 JSC single-hop and 2,000–4,000 two-hop,
   rounded to 50, from the same draw. The work is a key job's (find the route, root the box) with
   one `rm` in place of reading the key. Rejected: tamper's higher range (tamper adds a second
   skill, changing exactly one row without disturbing the rest; sabotage has none); a premium for
   being irreversible (irreversible is not harder).

10. **A machine role per contract (2026-11-12)**, from a pool of seven, drawn on a new stream
    `mission-sabotage-role-<n>` so nothing already drawn moves:

    | Role                   | Hostname         |
    | ---------------------- | ---------------- |
    | CCTV recorder          | `<stem>-nvr`     |
    | backup server          | `<stem>-backup`  |
    | monitoring station     | `<stem>-mon`     |
    | build server           | `<stem>-ci`      |
    | licence server         | `<stem>-lic`     |
    | door-access controller | `<stem>-access`  |
    | billing server         | `<stem>-billing` |

    The role sets three things: the target box's hostname suffix in place of `-files`; the board's
    noun, `<Client> — take down a CCTV recorder — §X` (`take down an internal …` on two-hop, as the
    other kinds add `internal`); and the briefing's reason, three to six pitches per role ("Their
    cameras caught our guy on Tuesday. The recorder goes down before anyone pulls the footage.").
    It adds no role-specific files (footage, backups): that is the "believable filler" in
    `docs/backlog.md`, and filler on one kind of box alone would be a tell.

11. **The briefing names the role, and nothing else about the box (2026-11-12):** "Take their CCTV
    recorder offline." Never the hostname, the address of the box or a path. A two-hop briefing adds
    the line that the machine is inside their network, not on the edge. The player matches the role
    to the hostname they land on (the prompt, `/etc/hostname`). It ends "No outage, no money. No
    wallet, no money."

12. **Bricking the wrong box loses the job, with no warning (2026-11-12).** On single-hop only the
    target can be rooted (the gateway's admin is shut), so there is no wrong box. On two-hop every
    route roots the front box; bricking it, by the contractor or a rival, leaves the target out of
    reach for good, and the contractor drops the job. Players learn the hard way, and a rival
    spoiling a sabotage job by bricking the front box first is the shared network working as
    designed.

### Left for later

13. **Wiping a table (2026-11-12)**, legacy's `db_sabotage` ("Destroy the database": the file gone,
    the table dropped or every row deleted). It is tamper machinery (a records box, a target table,
    the client reading rows), not the brick check, and it would sit oddly beside tamper's "a
    `DELETE` with no `WHERE` costs the job". Filed in `docs/backlog.md` under the tamper twists, so
    sabotage means one thing: the box does not boot.

---

## Where it plugs in

Read before slice 1; every path is today's code.

- **The kind** is `missionKind` (`src/core/missions/missionShape.ts`), one draw on
  `mission-kind-<n>`: under `TAMPER_SHARE` (1/2) tamper, else key. Thirds cut that same draw as
  tamper below 1/3, sabotage from 1/3 to 2/3, key from 2/3: every number that stays tamper or key
  keeps its kind, and only the third in the middle moves. `MissionKind` gains `'sabotage'`.
- **The shape** keeps the key-box slot for the target: same octet, route, versions, decoys and
  two-hop placement. A sabotage job draws no storage. `storage` today is the key's
  (`mission-storage-<n>`) or the records' (`recordsStorage`), and every consumer that reads it
  (`keptInDatabase`, `missionFiles`, `missionFilePaths`, `show`) learns that a sabotage box keeps
  nothing, so no key file, no records and no database are laid or added.
- **The hostname** comes from `missionLan` (`src/core/generation/generateHomeLan.ts`), which names
  the slot `${stem}-${KEY_BOX_SUFFIX}` (`files`, `src/core/missions/pools.ts`). A sabotage number
  names it from its role instead. `machineIdForLanHost` takes the host, so a sabotage box's machine
  id differs from the `-files` box the number had before; only numbers that turn sabotage move,
  which is free until launch. `missionBoxAt` finds the box by octet, so its `role: 'key'` reference
  holds.
- **Terms** (`src/core/missions/missionTerms.ts`): `MissionTerms` gains a `job: 'sabotage'` arm
  beside `'tamper'`, with no `keyOpens`. It draws on `mission-terms-<n>` in the key job's order:
  client, target company (`<Stem> <trade>` from `TARGET_TRADES`), the role's pitch, then pay from
  the key job's `SINGLE_HOP` and `TWO_HOP` ranges as the last draw.
- **The briefing** is `jobLines` (`src/core/hireme/contracts.ts`), which branches on `terms.job`.
  A sabotage job gets the role's ask, `insideLines('The machine is')` on two-hop, "Mail this
  address when it is done, with your wallet address." and "No outage, no money. No wallet, no
  money."
- **The client's check** is `answerClientMail` (`src/core/missions/clientMail.ts`). A tamper job
  decides `checkRecords` and reads the box through the `readRecordsBox` dep, which `api/network.ts`
  builds on `generatedLanBox` (`src/core/network/generatedLanBox.ts`). `generatedLanBox` answers
  `absent` when no generated machine stands at the address or the one there cannot boot; the
  target slot always holds a generated machine, so on a contract network `absent` means only that
  it cannot boot. A sabotage job reads the same box and passes on `absent`, fails on `up`, and
  answers nothing on `error`. The dep is renamed for what it now reads (the job's target box), with
  no second read path.
- **The brick already lands.** The write gate (`remoteWritePermission`, `api/patches.ts`) fences
  only the files the server lays on a contract box, so a root's `rm /boot/vmlinuz` there is an
  ordinary journal write; `testMissionTamper.ts` already bricks a records box that way and reads it
  `absent`. The new wire-check proves it with no reboot.
- **`show`** (`src/core/missions/hiremeOrders.ts`) prints `Key box:` and a `Kind:` line for tamper.
  A sabotage report prints `Kind: sabotage, <role>` and names the target box by its hostname.
- **What re-rolls on ship:** a third of all numbers turn sabotage. The wire-checks that pick
  candidates by `kind === 'key'` or `kind === 'tamper'` keep finding them; every pinned number and
  test factory that lands sabotage is re-picked, as the tamper epic re-picked numbers that turned
  tamper.

## Given by the plan, not the grill

- **The target company** is a key job's, `<Stem> <trade>` (`Halden Logistics`): any business runs
  a CCTV recorder or a backup server, so roles bring no institutions of their own.
- **"Already closed"** answers a contractor holding no accepted job with the client and a completed
  sabotage job with it, without reading the box, as for tamper.
- **The ask** is one sentence per role ("Take their CCTV recorder offline."); the reasons are the
  role's pitches, and the briefing opens with one of them as every briefing opens with its pitch.

---

## Slices

Two slices, one PR each, merged in order. The browser run waits for the close-out after slice 2.
Every slice loads `tdd`, `testing` and `refactoring` before code, and `mutation-testing` at its PR
gate.

### Slice 1 — a client hires a contractor to take down a CCTV recorder, and pays when it is down (v0.458.0)

**Value:** a contractor takes a `take down a CCTV recorder` job off the board, roots the target by
its route, deletes a boot file, mails the client anything, and is paid once; a target still up gets
"Their machine is still up. No outage, no money."
**Class:** behavior change. **Branch:** `feat/sabotage-job`.

The walking skeleton: one role, the CCTV recorder (`<stem>-nvr`). Everything the grill decided
about the proof, the share, the pay and the briefing lands here; slice 2 only widens the roles.

**Acceptance criteria**

- About a third of numbers are sabotage, a third tamper and a third key, on `mission-kind-<n>`.
  Every number that stays key or tamper keeps its shape and terms exactly (a 2,000-number sample
  deep-equals a fixture captured from `main`, captured and deleted inside the PR).
- A sabotage number's target sits in the key-box slot (same octet, route, decoys and front box),
  named `<stem>-nvr`, and holds no key file, no records and no database added for storage; its
  public scan is the route's forwards plus decoys, and the mysql route keeps only its own door.
- The board reads `<Client> — take down a CCTV recorder — §<pay>`, and `take down an internal CCTV
recorder` on two-hop. Pay is 500–2,000 single-hop and 2,000–4,000 two-hop, rounded to 50. The
  target is `<Stem> <trade>`.
- The briefing opens with one of the role's 3–6 reasons, gives the target and the address, asks
  "Take their CCTV recorder offline.", adds the "inside" lines on two-hop, and ends "No outage, no
  money. No wallet, no money." Never the hostname, the box's address or a path.
- Any mail from the contractor on an accepted sabotage job reads the target box:
  - it cannot boot (`vmlinuz` or `initrd.img` gone, by anyone, no reboot needed) → completed, paid
    once, "The machine is down. §X sent to jsc…. Pleasure doing business." (with no wallet: "The
    machine is down. You sent no wallet, so there is nothing to pay. No wallet, no money.");
  - it is up → "Their machine is still up. No outage, no money.", the job still accepted.
- A later mail on the completed job → "That job is already closed.", without reading the box.
- A box read that fails answers nothing (`null`, 500 at the handler), never a guessed reply.
- `hireme.ts show` prints `Kind: sabotage, CCTV recorder` and the target box's hostname.
- Key and tamper jobs offer, brief, complete, refuse and close exactly as before.

**TDD order (RED first, each at its public surface)**

1. `missionKind`: the three shares over a sample; key and tamper numbers that stay are unchanged.
2. `missionShape` and the lay-in: a sabotage target holds no key, records or storage database;
   `missionFilePaths` lists only the route's files.
3. `generateHomeLan` for a sabotage number: the slot is `<stem>-nvr`; key and tamper hostnames
   unchanged.
4. `missionTerms`: the sabotage line, the internal line, the pay ranges, the target name.
5. The briefing for a sabotage job.
6. `answerClientMail`: down pays once, up replies, closed, a failed read answers null; key and
   tamper jobs unchanged.
7. `showReport` for a sabotage number.
8. Factories and pinned wire-check numbers moved off numbers that landed sabotage.

**Gates**

- `npm run typecheck`, `npm run lint`, the full suite, `npm run build` with `checkBudgets` (raise
  the ceiling if the pitches need it).
- Wire-check `scripts/testMissionSabotage.ts` (new), staging numbers with `hireme.ts accept
--number`: mail before anything → "still up"; the route's root, `rm /boot/vmlinuz` with no
  reboot → paid once, a second mail → closed; a fresh contract bricked from a second player's
  session, then mailed by the contractor → paid; `rm /boot/initrd.img` alone → paid; a two-hop
  contract whose front box is bricked → "still up", the target out of reach. Every other mission
  wire-check re-runs green.
- Mutation gate on the changed lines of `missionShape.ts`, `missionTerms.ts`, `missionLeak.ts`,
  `clientMail.ts`, `contracts.ts`, `generateHomeLan.ts` and `hiremeOrders.ts`.
- `docs/missions-architecture.md`: the header and "the one idea" name the third kind (a sabotage
  job reads whether the box boots), and a "Sabotage jobs" section for what this slice built.
- v0.458.0 in `package.json` and `package-lock.json`.

### Slice 2 — seven machines to take down (v0.459.0)

**Value:** the board offers backup servers, monitoring stations, build servers, licence servers,
door-access controllers and billing servers beside the CCTV recorder, each named for what it is and
wanted down for reasons of its own.
**Class:** behavior change. **Branch:** `feat/sabotage-roles`.

**Acceptance criteria**

- A sabotage contract draws one of the seven roles in the grill's table on
  `mission-sabotage-role-<n>`, about a seventh each; slice 1's other draws (shape, client, target,
  pay) do not move.
- Each role names the target `<stem>-<suffix>` (`nvr`, `backup`, `mon`, `ci`, `lic`, `access`,
  `billing`), gives the board its noun (`take down a backup server`, `take down an internal
door-access controller`), asks its own sentence, and brings 3–6 reasons.
- No role adds files or services: a 2,000-number test proves every sabotage target, whatever its
  role, carries only the lay-in and doors its route and decoys give, and that every hostname on a
  contract network is unique.
- `show` prints the role.

**Gates:** the usual; `testMissionSabotage.ts` pins one contract per role and checks its hostname
and the paid reply after a brick by the script as root. Mutation on the changed lines. v0.459.0.

### Close-out

One browser run on a fresh player: a single-hop sabotage job worked from the board to the payout
(mailed once while still up, for the "still up" reply), and a two-hop one taken through the front
box to the target. Then `docs/missions-architecture.md` finished, `docs/project-status.md` given
its entry, the plan retired, and the story offered for valleynews.io `/dev`.
