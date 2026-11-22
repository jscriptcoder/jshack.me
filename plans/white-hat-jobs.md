# Plan: White-hat jobs

**Status:** Grilled 2026-11-22 (the shared rules and cleanup). No slice planned yet.

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

6. **White-hat work pays about 60% of black-hat (2026-11-22).** 300–1,200 JSC single-hop and
   1,200–2,400 two-hop, rounded to 50 as every pay is; incident response, two steps like a chain,
   2,400–4,200. Breaking in is what black-hat pay is for, and the gap leaves players a reason to
   take that risk. Rejected: the same bands as each mirrored kind, which pays the easy way in as
   much as the hard one; and about half, a starker trade.

7. **The handed-over logins keep working after the job closes (2026-11-22).** No new mechanism:
   the network stays reachable as every mission network does, and a leaked briefing stays a root
   door for good. This settles the question decision 2 left open. Rejected: the client revoking
   access when the job is paid or dropped, closer to practice but a contract-state check at the
   login door.

   Settled from the code, proposed: the handed-over root passwords come from
   `MISSION_KEY_SECRET` (an HMAC of the number, like the key in `core/missions/missionSecret.ts`)
   and are laid in by the server, never by the bundle's generator. The generator ships in the
   bundle and the number is the address, so a password drawn from the seed would give root to
   anyone who holds the address without the briefing.

8. **Cleanup: the briefing gives a symptom, never the file (2026-11-22).** It says what the
   client noticed, such as something answering on a port. `ps` shows the listener (`nc`, its
   port, the user who planted it), and the implant, disguised as an ordinary service script among
   real ones in the boot and schedule directories (`cron.d`, `init.d`, `systemd` and the like),
   names that port or its outside host in its text, so `grep -r` or reading those directories
   finds it. Decoy scripts sit beside it. Rejected: a briefing that names nothing, closer to real
   work but leaves a first-time player without a place to start; and one that names the path, as
   legacy's `ps` did, which makes the job trivial with a root login.

9. **Cleanup: the listener and the file are both required, each on its own (2026-11-22).** As
   legacy: a killed listener stays dead whether or not the file is there, and the client pays
   once both are gone, its miss naming what is left. No new mechanism. Rejected: a listener that
   lives as long as its file, laid back in after replay while the implant exists, which teaches
   persistence but adds a rule at every read door and reads like a bug when it respawns right
   after `kill`.

10. **A white-hat client pays only while its machines still boot (2026-11-22).** One rule for
    every white-hat kind: before the kind's own check, the client reads whether each machine in
    scope still boots (`canBoot`, the sabotage job's check the other way round). A bricked
    machine gets "You took our machine down. No money." Since a brick is permanent, that job can
    never pay, whoever bricked it, the contractor or someone holding the leaked briefing.
    Rejected: also requiring every service the machine was born running, more realistic but a
    per-kind definition of "its services" and a miss after a stray `systemctl stop`; and no such
    rule, which pays a defender who wrecked the box.

    Settled from the code, proposed:
    - The bricked-machine mail closes the job unpaid, as a proof mail with no wallet does, rather
      than leaving an active job that can never pay holding the board's slot.
    - Cleanup is two-hop on one contract in three, as credential, destroy and wipe jobs are, the
      implant on the machine behind the front box, with a login for each.
    - "The file is gone" is the destroy job's rule: its path no longer holds the bytes laid there,
      so overwriting it counts as removing it.

11. **Cleanup's implants are legacy's catalog, adapted (2026-11-22).** The 24 templates on
    reachable roles (`docs/mission-ideas/white-hat-investigations.md` §2), in its six families,
    rewritten for v2's roles and voice, each naming the port and outside host the symptom leads
    to. The binary ones stay, read through `strings`; the router and switch templates go.
    Rejected: one family first and the rest in a later slice; and a new catalog.

12. **The same ten clients post white-hat work, as a middleman (2026-11-22).** A client hires the
    contractor on behalf of the company whose network it is ("our customer Halden …"), so the
    client's door, mail and handles stay as they are and only the pitches and briefings are new.
    A client that pays for attacks and defence alike fits the game's grey world. Rejected: the
    network's own company mailing the contractor, which needs a mailbox and client door for every
    target company; and a separate pool of security-minded clients.

    Settled from the code, proposed:
    - The proof is any mail to the client naming a wallet, as on every kind whose proof is the
      network's state; the client reads the machines on every mail and closes a completed job
      without reading them again.
    - Each white-hat kind takes its share of the kind draw at one edge as it ships, as every kind
      before it did, so no number changes between older kinds.
    - The rest of each later kind (its target, plant, check and miss wording) is grilled when its
      story starts, on top of decisions 1–3, 6, 7, 10 and 12, which every white-hat kind shares.

## For the plan to measure

- How the handed-over login reaches the machine: which forward on the router carries ssh to the
  front box, and how the machine behind it is named in the briefing (its LAN address), given that
  black-hat briefings never name the router or an address.
- Whether v2's generated boxes already carry ordinary scripts in `cron.d`, `init.d`, `systemd`
  and the rest for an implant to hide among, or whether the decoys are new content.
