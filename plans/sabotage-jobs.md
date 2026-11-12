# Plan: a contract that asks for a machine to be taken down

**Status:** Grilled 2026-11-12. Slice plan to follow. Nothing is built.

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
