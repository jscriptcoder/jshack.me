# Plan: four more black-hat contracts

**Status:** Grilled, gap-checked and split into stories 2026-11-18. Story 1 shipped at v0.471.0,
Story 2 at v0.472.0 and Story 3 at v0.473.0.
Story 4 is built at v0.474.0, on `feat/chain-jobs`. Story 5 is next.

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

2. **The password is one labelled line (2026-11-18).** The client reads the body's first line
   outside the quoted text that starts with `password:`, ignoring leading spaces and the label's
   case, and tests everything after the label, trimmed and case-sensitive. One mail is one guess,
   under the 20 sends an hour every proof mail counts toward. Rejected: testing every word in the
   mail, which would let a player paste a whole
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
   login, no money." It covers no password line, an empty password, a wrong password, and a target
   that no longer boots, and never says which. A paid job opens "That login works."

### Destroy a file

6. **The file is one of the file job's six items (2026-11-18)**, laid root-only. The briefing gives
   its name and never where it sits.

7. **The client pays once the company's file is no longer at its path (2026-11-18)**, whether it was
   deleted, overwritten or moved, and whoever did it.

8. **A bricked target is a miss and loses the job (2026-11-18)**, because the client cannot confirm
   the file is gone.

9. **The pay is the key job's (2026-11-18).**

9a. **The words (2026-11-18).** The board reads `<Client> — destroy a signed contract — §<pay>`, and
    `destroy an internal signed contract` on two-hop. Each of the six items gets four pitches of its
    own. The target keeps the hostname `<stem>-files`. The file counts as still there only while its
    path holds exactly the bytes the server laid. The briefing:

    ```text
    Their lawyers keep a signed contract. We want it gone. Its name is:

      harbour-bid-signed.pdf

    Write to this address with your wallet address once it is gone.
    Not gone, no money. No wallet, no money.
    ```

    Two-hop adds "The file is on a machine inside their network, not on the edge." A paid job opens
    "It's gone." Every miss, a bricked target included, gets one reply: "We can't confirm that file
    is gone. Not gone, no money."

### Wipe a table

10. **The job reuses the tamper job's eight settings (2026-11-18)**: three tables, kept in a
    database or in CSV files.

11. **The briefing describes the data and never uses the table's name (2026-11-18).** The target is
    always the setting's main table, so working out which of the three fits the description is part
    of the job:

    | Setting    | Table      | The briefing asks to wipe                |
    | ---------- | ---------- | ---------------------------------------- |
    | school     | grades     | what each student scored in each subject |
    | police     | warrants   | everyone they want arrested              |
    | payroll    | payroll    | what they pay each of their people       |
    | dmv        | offences   | the points held against each driver      |
    | tournament | scores     | what each player has racked up           |
    | admissions | applicants | everyone waiting on a place              |
    | club       | members    | everyone who belongs to the club         |
    | registry   | vehicles   | who owns which car                       |

12. **The target table must be empty or gone, and the other two must read exactly as generated
    (2026-11-18).**

    - Wiped: a table with no rows, a table that is gone, and a CSV that is deleted, zero bytes, or
      only its header.
    - Not wiped: a CSV with uneven lines, which may still hold the data. Finishing the wipe puts it
      right.
    - The other two tables must hold every row and value in the generated order, with nothing added.
      Any change is a miss.
    - A target that no longer boots is a miss, and loses the job.
    - Any other table in the database, such as the mysql route's `settings`, is never read.

    Wiping the wrong table effectively loses the job: the game's `mysql` has no `INSERT`.

13. **Database root stays shut (2026-11-18).** Players use `DELETE`, or edit the files as root.
    `DROP` stays out of reach of the application account.

14. **The pay is the tamper job's (2026-11-18):** 1,000–2,500 JSC single-hop and 2,500–5,000
    two-hop.

14a. **The words (2026-11-18).** The board reads `<Client> — wipe police records — §<pay>`, and
     `wipe internal police records` on two-hop, with the setting's noun. The target company is
     `<Stem> <institution>`, as on a tamper job, and each setting gets three pitches of its own. The
     briefing gives the setting's description from decision 11 and never warns the player off the
     other two tables:

     ```text
     Their records hold everyone they want arrested. We want all of it gone.

     Mail this address when it is done, with your wallet address.
     Not wiped, no money. No wallet, no money.
     ```

     Two-hop adds "The records are on a machine inside their network, not on the edge." A paid job
     opens "The records are gone." Every miss gets one reply: "That's not what we asked for. Not
     wiped, no money."

### Chain job

15. **Always two hops and two steps (2026-11-18).** First a listener left on the front box, then a
    final step on the inside machine.

16. **The final step is an even draw (2026-11-18)** between taking the machine down, destroying a
    file and wiping a table.

17. **The client checks both steps on every mail and pays only while both hold (2026-11-18).** Its
    reply names the first unfinished step.

18. **The pay is 4,000–7,000 JSC (2026-11-18)**, the highest in the game.

18a. **The words and the listener (2026-11-18).** The board reads `<Client> — break in and take down
     an internal backup server — §<pay>`, with the final step's own words. The port is one of the
     backdoor job's eight, and each final step gets four pitches of its own. The briefing:

     ```text
     This job has two parts. We pay for both or for neither.

     First, leave a listener on the machine on the edge of their network, on port 31337.
     Then take their backup server offline. It is a machine inside their network, not on the edge.

     Write to this address with your wallet address once both are done.
     Both done or no money. No wallet, no money.
     ```

     A destroy final reads "Then get rid of a signed contract their lawyers keep. Its name is:" and
     the file's name. A wipe final reads "Then wipe their records of everyone they want arrested.",
     with the setting's description from decision 11. A paid job opens "Both done."

     The client reads the box as it stands, so the steps can be done in either order. An unfinished
     listener gets "Nothing is listening on port 31337 on the edge. No listener, no money." An
     unfinished final step gets the miss reply of that kind of job. A listener on the inside machine
     does not count, and a bricked front box loses the job and gets the listener reply.

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

---

## Where credential theft plugs in

Read before the story; every path is today's code (v0.470.0).

- **The kind** is `missionKind` (`src/core/missions/missionShape.ts`). `MissionKind` gains
  `'credential'`. Each of the seven kinds goes from 1⁄7 to 1⁄8 by giving up 15⁄840 at the top of one
  of its pieces, so a number is the kind it was or has become a credential job. In 840ths (today's
  420ths × 2), a draw past the last cut staying portforward:

  | Draw (×1⁄840) | Kind        | Was         |
  | ------------- | ----------- | ----------- |
  | 0 to 105      | tamper      | tamper      |
  | 105 to 120    | credential  | tamper      |
  | 120 to 140    | portforward | portforward |
  | 140 to 153    | infiltrate  | infiltrate  |
  | 153 to 168    | credential  | infiltrate  |
  | 168 to 175    | backdoor    | backdoor    |
  | 175 to 190    | credential  | backdoor    |
  | 190 to 195    | portforward | portforward |
  | 195 to 210    | credential  | portforward |
  | 210 to 265    | file        | file        |
  | 265 to 280    | credential  | file        |
  | 280 to 385    | sabotage    | sabotage    |
  | 385 to 400    | credential  | sabotage    |
  | 400 to 420    | portforward | portforward |
  | 420 to 448    | infiltrate  | infiltrate  |
  | 448 to 490    | backdoor    | backdoor    |
  | 490 to 540    | file        | file        |
  | 540 to 560    | portforward | portforward |
  | 560 to 588    | infiltrate  | infiltrate  |
  | 588 to 630    | backdoor    | backdoor    |
  | 630 to 735    | key         | key         |
  | 735 to 750    | credential  | key         |
  | 750 to 770    | portforward | portforward |
  | 770 to 798    | infiltrate  | infiltrate  |
  | 798 to 812    | backdoor    | backdoor    |
  | 812 to 820    | infiltrate  | infiltrate  |
  | 820 to 840    | portforward | portforward |

- **The machine** is `credentialRole(n)` on `mission-credential-role-<n>`
  (`src/core/missions/targetRoles.ts`), one of the seven, each gaining three `credentialPitches`.
  `keyBoxSuffix` answers its suffix. Storage is `null`.
- **The client's check** is a `checkLogin` decision in `src/core/missions/clientMail.ts`, reading
  the target through `readTargetBox` and comparing `md5(<word>)` with `accountIn(fs, 'root')`.
- **Terms** (`missionTerms.ts`): `job: 'credential'`, `steal the root login for a backup server`,
  `... for an internal backup server` on two-hop, at the key job's pay.
- **The briefing** (`jobLines`, `src/core/hireme/contracts.ts`):

  ```text
  Bring us the root login for their backup server.
  Put the password on a line of its own, like this:

    password: <the password>

  Reply to this address with that line and your wallet address.
  No login, no money. No wallet, no money.
  ```

  Two-hop adds "It is a machine inside their network, not on the edge."
- **`show`** (`hiremeOrders.ts`): `Kind: credential, <machine>`, the slot called the target.

## Stories

One story per mission, with the chain job's other final steps as a story of their own. Stories 1 to
4 each work without the others and ship in this order (decision 21). Each new kind takes an equal
share of the kinds shipped so far, so the fractions below assume that order. Story 5 needs stories
2, 3 and 4.

Load `tdd`, `testing` and `refactoring` before code and `mutation-testing` at the PR gate. Each
story bumps the version, re-picks any pinned number its kind draw moved, and is proved by its own
wire-check against `vercel dev` and supabase. Each can ship alone, and none needs a flag.

### Story 1: a client pays for a working root login (v0.471.0)

**Value:** a contractor takes a credential job off the board, gets root on the named machine, mails
its password and is paid once. **Class:** behavior change. **Branch:** `feat/credential-jobs`.
**Defers:** the other three missions.

- [ ] An eighth of numbers are credential jobs, cut as the table above, and every number that keeps
      its kind keeps its shape, terms and LAN exactly.
- [ ] The target sits in the key-box slot, named for one of the seven machines, with no storage.
- [ ] The board and briefing read as above, at the key job's pay, and name neither the machine's
      hostname nor its LAN address. The briefing still gives the network's public address, as every
      briefing does.
- [ ] A mail whose first `password:` line outside the quote matches root's current password
      completes the job and pays once, with or without a wallet as every kind does.
- [ ] A password set with `passwd` from a root shell on the target pays.
- [ ] No line, an empty password, a wrong password, the front box's password and a target that no
      longer boots each get "That login doesn't open their <machine>. No login, no money."
- [ ] The two boxes can draw the same password. A front box password that also opens the target
      pays, because the check is only whether it opens the target.
- [ ] Only the first `password:` line counts, so a mail cannot try several words.
- [ ] A later mail on the completed job is told it is closed, without reading the box.
- [ ] `show` names the kind and the machine.

### Story 2: a client pays for a file destroyed (v0.472.0)

**Value:** a contractor finds the company's file from its name alone, destroys it, and is paid once
the client can confirm it is gone. **Class:** behavior change. **Branch:** `feat/destroy-jobs`.
**Decisions:** 6–9a, 19 and 20. **Defers:** a hidden second copy of the file.

- [ ] A ninth of numbers are destroy jobs, each older kind giving up an equal share, and every number
      that keeps its kind keeps its shape, terms and LAN exactly.
- [ ] One destroy job in three is two-hop, with the file on the inside machine.
- [ ] The target holds one of the file job's six items, root-only, under the hostname `<stem>-files`,
      with no storage.
- [ ] The board and briefing read as decision 9a, at the key job's pay, and give the file's name and
      never its path.
- [ ] A mail about an untouched target gets the miss reply and pays nothing.
- [ ] Once the file is deleted, overwritten or moved, by anyone, a mail completes the job and pays
      once, with or without a wallet as every kind does.
- [ ] A file put back at its path with exactly the bytes the server laid counts as still there.
- [ ] A target that no longer boots gets the miss reply, even if the file was destroyed first.
- [ ] A later mail on the completed job is told it is closed, without reading the box.
- [ ] `show` names the kind, the item and the file's path.

### Story 3: a client pays for a table wiped (v0.473.0)

**Value:** a contractor works out which table the client means, empties it and leaves the other two
alone. **Class:** behavior change. **Branch:** `feat/wipe-jobs`. **Decisions:** 10–14a, 19 and 20.
**Defers:** targets other than each setting's main table.

- [ ] A tenth of numbers are wipe jobs, each older kind giving up an equal share, and every number
      that keeps its kind keeps its shape, terms and LAN exactly.
- [ ] One wipe job in three is two-hop, with the records on the inside machine.
- [ ] A wipe job draws one of the eight settings, its three tables kept in a database or in CSV files.
- [ ] The board and briefing read as decision 14a, at the tamper job's pay, and name no table or file.
- [ ] A target table left with no rows pays, and so does a CSV that is deleted, zero bytes or only its
      header, while the other two tables read exactly as generated.
- [ ] A target with rows left, or a CSV with uneven lines, gets the miss reply, and finishing the wipe
      then pays.
- [ ] A changed, missing, added or reordered row in either other table gets the miss reply.
- [ ] Emptying any other table in the database, such as the mysql route's `settings`, changes nothing.
- [ ] A target that no longer boots gets the miss reply.
- [ ] The application account cannot `DROP` a table, and database root stays shut.
- [ ] A later mail on the completed job is told it is closed, without reading the box.
- [ ] `show` names the kind, the setting, the storage and the target table.

### Story 4: a chain job pays for a listener and a machine taken down (v0.474.0)

**Value:** a contractor plants a listener on the edge, goes through to the inside machine, takes it
down, and earns the game's highest pay. **Class:** behavior change. **Branch:** `feat/chain-jobs`.
**Decisions:** 15, 17–18a and 19. **Defers:** the other two final steps, and chains longer than two
steps. The client reads only the key-box slot today, so this story also gives it a read of the front
box.

- [ ] An eleventh of numbers are chain jobs, each older kind giving up an equal share, and every
      number that keeps its kind keeps its shape, terms and LAN exactly.
- [ ] Every chain job is two-hop, at 4,000–7,000 JSC to the nearest 50.
- [ ] The board and briefing read as decision 18a, naming the port and the machine to take down.
- [ ] With a listener on the named port on the front box and the inside machine no longer booting, a
      mail completes the job and pays once, whichever step was done first.
- [ ] With neither step done, or only the machine down, a mail gets the listener reply.
- [ ] With only the listener left, a mail gets "Their machine is still up. No outage, no money."
- [ ] A listener on another port or on the inside machine gets the listener reply.
- [ ] A bricked front box gets the listener reply, even with the inside machine down.
- [ ] A later mail on the completed job is told it is closed, without reading either box.
- [ ] `show` names the kind, the machine and the port.

### Story 5: a chain job's final step can destroy a file or wipe a table (v0.475.0)

**Value:** chain jobs stop being one routine, because the inside machine can ask for any of three
endings. **Class:** behavior change. **Branch:** `feat/chain-finals`. **Decisions:** 16 and 18a.
**Needs:** stories 2, 3 and 4. **Defers:** chains longer than two steps.

- [ ] A chain job's final step is an even draw between taking the machine down, destroying a file and
      wiping a table, on a stream of its own, so its port, pay and front box do not move.
- [ ] A destroy final lays the file and is checked by story 2's rules on the inside machine.
- [ ] A wipe final lays the setting's tables and is checked by story 3's rules on the inside machine,
      and the target company is `<Stem> <institution>`.
- [ ] The board and briefing read as decision 18a for the final step drawn.
- [ ] A mail with the listener missing gets the listener reply, whatever the final step's state.
- [ ] A mail with the listener in place and the final step unfinished gets that kind's miss reply.
- [ ] With both steps done, a mail completes the job and pays once.
- [ ] `show` names the final step and what it asks for.

### Close-out

One browser run over all four kinds, a valleynews `/dev` post, the as-built sections in
`docs/missions-architecture.md`, and this plan retired.
