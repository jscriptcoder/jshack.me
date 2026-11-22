# Plan: White-hat jobs

**Status:** Grill in progress (started 2026-11-22). No slice planned yet.

Every contract kind v2 ships is black-hat: the contractor breaks into the target's network and
does something to it. Legacy also had defender contracts (`malware`, `forensics`, `db_fix`,
`script_fix`, `script_auto`; see `docs/mission-ideas/white-hat-investigations.md` and
`objectives.md`), filed under a separate SECURITY CONTRACTS column. This grill decides how v2
brings defender work back on top of the shipped missions system
(`docs/missions-architecture.md`).

---

## Grill record

1. **The client lets the contractor in (2026-11-22).** On a white-hat job the contractor is hired
   help, not an intruder, so breaking in would make no sense and is taken away. The difficulty
   moves from getting in to the work itself (the hunt, the logs, the true value of a record), so
   each white-hat kind has to carry its own challenge in what it plants.

2. **A root `ssh` login per machine in scope, handed over in the briefing (2026-11-22).** The
   briefing names each machine the job covers with a `root@<address>` login and its password,
   as legacy did. On a two-hop job that means a login for the front box and one for the machine
   behind it, so the player never has to find a way to the next hop themselves. Rejected: an
   ordinary admin account plus root's password for `su`, one more step that would teach the
   habit and give `auth.log` a line, but adds friction to work the client wants done; and a
   single login to the front box only, which would bring breaking in back for the second hop.

   Consequences noted, not yet decided:
   - The login is a secret worth stealing. It sits in the briefing mail, and mission networks are
     shared, so whoever reads the contractor's inbox or `~/.bash_history` reaches the client's
     machines as root and can undo the fix before the contractor mails. This fits the owner's
     rule that players learn the hard way; no warning is added.
   - Whether the client changes the password once the job is paid, so a closed job leaves no
     open door, is still open.

3. **White-hat kinds join hireme's kind draw (2026-11-22).** They are offered on the same
   hireme.io board as every kind before them, each taking its share of the kind draw. An offer's
   kind and pitch already say what sort of job it is, so no new site, door or lookup is needed;
   the clients need white-hat pitches beside their black-hat and grey ones. Rejected: a labelled
   white-hat section on the board (legacy's second column), which changes the layout and the
   three-offer top-up; and a separate security firm as a second operator, the clearest identity
   but a new site, board, application and lookup.

4. **Seven white-hat kinds are in scope (2026-11-22).**
   - **Cleanup** (the backdoor job's mirror, legacy `malware`): an implant and the listener it
     runs were left on a machine; pays once both are gone.
   - **Close the door** (the portforward job's mirror): a rogue forward on the router exposes one
     of the client's machines; pays once the public port no longer reaches it.
   - **Lock them out** (the credential job's mirror): root's password on a machine has leaked;
     pays once the leaked password no longer logs in.
   - **Patch it** (new, on the CVE system): a box runs a release with a root-level CVE; pays once
     `apt upgrade` has moved it off, which only works inside the patch-delay window.
   - **Restore the record** (the tamper job's mirror, legacy `db_fix`): a record was corrupted and
     its true value sits in a backup or export on the box; pays once the table reads right.
   - **Forensics** (legacy): read the logs back to the intruder; pays on a mail naming their
     handle and origin.
   - **Incident response** (the chain job's mirror): find how they got in, then close it.

   Out: recovering a bricked box, since a brick is permanent by design; and the script jobs
   (legacy `script_fix`, `script_auto`), which need a verification hook designed against v2's
   `node` and go to `backlog.md`.

5. **Mirrors first, incident response last (2026-11-22).** Each kind is its own story with its
   own close-out, in this order: cleanup (which also builds what every white-hat kind shares, the
   briefing with root logins), close the door, lock them out, patch it, restore the record,
   forensics, and incident response last because it chains the others. Rejected: forensics first,
   the most distinctly white-hat kind; and patch it first, the newest to v2.
