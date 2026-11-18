# Plan: four more black-hat contracts

**Status:** Grilled and planned 2026-11-18. Slice 1 is next, on `feat/credential-jobs`.

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

---

## Where credential theft plugs in

Read before the slice; every path is today's code (v0.470.0).

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

## Slices

Load `tdd`, `testing` and `refactoring` before code and `mutation-testing` at the PR gate. Each
slice bumps the version, re-picks any pinned number its kind draw moved, and is proved by its own
wire-check against `vercel dev` and supabase.

### Slice 1: a client pays for a working root login (v0.471.0)

**Value:** a contractor takes a credential job off the board, gets root on the named machine, mails
its password and is paid once. **Class:** behavior change. **Branch:** `feat/credential-jobs`.

- [ ] An eighth of numbers are credential jobs, cut as the table above, and every number that keeps
      its kind keeps its shape, terms and LAN exactly.
- [ ] The target sits in the key-box slot, named for one of the seven machines, with no storage.
- [ ] The board and briefing read as above, at the key job's pay, and name no hostname or address.
- [ ] A mail whose first `password:` line outside the quote matches root's current password
      completes the job and pays once, with or without a wallet as every kind does.
- [ ] A password set with `passwd` from a root shell on the target pays.
- [ ] No line, a wrong password, the front box's password and a target that no longer boots each get
      "That login doesn't open their <machine>. No login, no money."
- [ ] Only the first `password:` line counts, so a mail cannot try several words.
- [ ] A later mail on the completed job is told it is closed, without reading the box.
- [ ] `show` names the kind and the machine.

### Slice 2: a client pays for a file destroyed (v0.472.0)

**Class:** behavior change. **Branch:** `feat/destroy-jobs`. Decisions 6–9 and 19–20: the kind, the
six items laid root-only, the check at the path, a bricked target a miss, the key job's pay.

### Slice 3: a client pays for a table wiped (v0.473.0)

**Class:** behavior change. **Branch:** `feat/wipe-jobs`. Decisions 10–14 and 19–20: the kind, the
eight settings in either storage, the check of all three tables, the tamper job's pay.

### Slice 4: a chain job pays for a listener and a machine taken down (v0.474.0)

**Class:** behavior change. **Branch:** `feat/chain-jobs`. Decisions 15, 17–19: the kind, always
two-hop, both steps checked on every mail, the reply naming the first unfinished step, the pay.

### Slice 5: a chain job's final step can destroy a file or wipe a table (v0.475.0)

**Class:** behavior change. **Branch:** `feat/chain-finals`. Decision 16: the even draw of the final
step, on the machinery slices 2 and 3 shipped.

### Close-out

One browser run over all four kinds, a valleynews `/dev` post, the as-built sections in
`docs/missions-architecture.md`, and this plan retired.
