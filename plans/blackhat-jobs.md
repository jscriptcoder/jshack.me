# Plan: four more black-hat contracts

**Status:** Grilled 2026-11-18. Slices to be planned below.

Four new kinds of contract, built in this order: credential theft, destroy a file, wipe a table,
and a chain job that combines them. As-built context:
[`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

### Credential theft

1. **The proof is a password that works now (2026-11-18).** The client hashes the mailed password
   and compares it with root's current entry in the target's `/etc/passwd`. A player who found the
   password mails it; one who came in through an exploit runs `passwd` and mails the new one, so
   all six routes work under one rule. A visitor who changes the password before the mail breaks
   the job until somebody gets back in, as on any shared network. Rejected: only the generated
   password counting, which would need the msfconsole route carved out of this kind.

2. **The password is one labelled line (2026-11-18).** The client reads the first line outside the
   quoted text that starts with `password:` and tests everything after the label, trimmed and
   case-sensitive. One mail is one guess, under the 20 sends an hour every proof mail counts
   toward. Rejected: testing every word in the mail, which would let a player paste a whole
   wordlist and have the client crack the box with no trace on it; and the subject as the password,
   which `mail reply` fills in.

3. **The target is root on one named machine (2026-11-18).** The key box's slot, as one of the
   seven machines sabotage and backdoor jobs use, its hostname naming it. The briefing names the
   machine and never the hostname or the address. On two-hop the target is the inside machine, and
   the front box's root password is a miss. Rejected: a plain file server, and any account counting
   (`guest` and users often fall to `hydra` at once).

4. **The pay is the key job's (2026-11-18):** 500–2,000 JSC single-hop and 2,000–4,000 two-hop, to
   the nearest 50.

5. **Every miss gets one reply (2026-11-18):** "That login doesn't open their backup server. No
   login, no money." It covers no password line, a wrong password, and a target that no longer
   boots, and never says which.

### Destroy a file

6. **The file is one of the file job's six items (2026-11-18)**, laid root-only. The briefing gives
   its name and never where it sits.

7. **The client pays once the company's file is no longer at its path (2026-11-18)**, whether it was
   deleted, overwritten or moved, and whoever did it.

8. **A bricked target is a miss and loses the job (2026-11-18)**, because the client cannot confirm
   the file is gone.

9. **The pay is the key job's (2026-11-18).**

### Wipe a table

10. **The job reuses the tamper job's eight settings (2026-11-18)**: three tables, kept in a
    database or in CSV files.

11. **The briefing describes the data and never names the table (2026-11-18)** ("their warrants"),
    so finding the right table of the three is part of the job.

12. **The target table must be empty or gone, and the other two must still hold every row
    (2026-11-18).** Wiping the wrong table effectively loses the job: the game's `mysql` has no
    `INSERT`.

13. **Database root stays shut (2026-11-18).** Players use `DELETE`, or edit the files as root.
    `DROP` stays out of reach of the application account.

14. **The pay is the tamper job's (2026-11-18):** 1,000–2,500 JSC single-hop and 2,500–5,000
    two-hop.

### Chain job

15. **Always two hops and two steps (2026-11-18).** First a listener left on the front box, then a
    final step on the inside machine.

16. **The final step is an even draw (2026-11-18)** between taking the machine down, destroying a
    file and wiping a table.

17. **The client checks both steps on every mail and pays only while both hold (2026-11-18).** Its
    reply names the first unfinished step.

18. **The pay is 4,000–7,000 JSC (2026-11-18)**, the highest in the game.

### All four

19. **All eleven kinds take an equal share of the board (2026-11-18).** Each new kind takes its
    share from the older ones, so an existing contract keeps its kind or becomes the new one, and
    none turns from one older kind into another.

20. **Credential theft, destroy and wipe are two-hop on one contract in three (2026-11-18)**, as
    most existing kinds are.

21. **They ship in the order above (2026-11-18)**, each with its own PRs and wire-checks, followed
    by one browser run and a valleynews post at the end.

### Set aside

- **A hidden second copy of a destroyed file**, which the client also wants gone.
- **Chains longer than two steps.**
