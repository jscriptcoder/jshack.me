# Plan: a contract that asks for a backdoor left on a machine

**Status:** Grilled and planned 2026-11-16. One slice, one PR. Next: the slice's acceptance
criteria to the owner, then RED.

A fifth kind of contract. Key and file jobs compare what the mail carries; tamper and sabotage jobs
read the target box. A **backdoor job** asks the player to leave a listener on one of the target's
machines, on a port the client names, and the client reads the box for it when the contractor
mails in. It brings back legacy's `backdoor` objective
([`docs/mission-ideas/objectives.md`](../docs/mission-ideas/objectives.md) §1, §3) on v2's
listener pidfile (`/var/run/nc-<port>.pid`, `src/core/services/pidfile.ts`), which `nc -l` already
writes to the shared journal. As-built context:
[`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

### The job

1. **The kind is called `backdoor` (2026-11-16),** legacy's name, beside `key`, `tamper`,
   `sabotage` and `file`. Chosen over a port forward on the gateway (the gateway's admin is shut by
   design), credential theft (a typed answer like the key job, adding no new step) and a white-hat
   malware cleanup (left for later). It brings a step no job uses yet: `nc -l` on the target, kept
   up until the mail.

2. **The target is the key-box slot (2026-11-16),** as a sabotage or file target is: the same
   octet, route, decoys and front box, and the inside box on two-hop. It has no storage: no key, no
   records, no mysqld for them.

3. **It reuses sabotage's seven machine roles (2026-11-16)**, drawn on a stream of its own:

   | Role                   | Hostname         |
   | ---------------------- | ---------------- |
   | CCTV recorder          | `<stem>-nvr`     |
   | backup server          | `<stem>-backup`  |
   | monitoring station     | `<stem>-mon`     |
   | build server           | `<stem>-ci`      |
   | licence server         | `<stem>-lic`     |
   | door-access controller | `<stem>-access`  |
   | billing server         | `<stem>-billing` |

   Each role brings 3 to 4 backdoor pitches of its own (why a client wants a standing way in),
   shared with no other role and no sabotage pitch. Because the two kinds share the roles, a
   hostname no longer tells a contractor whether the job is a sabotage or a backdoor. Rejected: a
   new role pool (more content, and a hostname would give the kind away); keeping `-files` with no
   role.

4. **The target ships without netcat (2026-11-16).** A root there runs `apt install netcat`
   before `nc -l`, as a root on a gpg key box runs `apt install gpg`; the briefing says nothing
   about it. Laying netcat on backdoor targets alone would be a tell.

### The proof

5. **The client reads the target's listener pidfile (2026-11-16).** On each mail from the
   contractor the client reads the target box, as a sabotage client does, and the job is done when
   the box is up and runs a listener on the named port. It does not connect from outside: that
   needs a forward on the gateway, whose admin is uncrackable, so it is a gateway route and a
   template of its own (left for later).

6. **There is no tier to choose (2026-11-16).** `nc -l` is root-only, so every listener is
   root's.

7. **The client names one port (2026-11-16)**, drawn per contract from eight classic ones: 1337,
   4444, 5555, 6666, 7777, 9001, 12345, 31337. None is a port any service in the catalog defaults
   to (22, 21, 80, 3306, 6379, 161, 53), so a target never already runs it; a test guards that, so
   no future service can take one silently. A listener on any other port does not count.

8. **Checked at mail time, and anyone's listener counts (2026-11-16).** The job completes and pays
   once. A `kill`, the pidfile removed or the target bricked after that takes nothing back. A
   listener planted by a rival counts, as anyone's brick counts on a sabotage job; the pidfile
   says only `user=root` anyway. Rejected: a listener that must survive a later check (a delayed
   check is the deadlines template's territory, left for later).

9. **The replies (2026-11-16)**, subject `Contract: <target>`, the first row that fits answering:

   | The mail                                 | The reply                                                                       | What changes              |
   | ---------------------------------------- | ------------------------------------------------------------------------------- | ------------------------- |
   | No accepted job with this client         | "We have no contract with you."                                                 | nothing                   |
   | A completed job                          | "That job is already closed." (the box is not read)                             | nothing                   |
   | Listener on the port, with a wallet      | "We're in. §1,450 sent to jsc…. Pleasure doing business."                       | completed, the pay minted |
   | Listener on the port, no wallet          | "We're in. You sent no wallet, so there is nothing to pay. No wallet, no money." | completed, nothing minted |
   | Anything else                            | "Nothing is listening on port 31337. No listener, no money."                    | nothing                   |
   | The read itself fails                    | nothing: 500, as any store failure                                              | nothing                   |

   "Anything else" is one reply for every miss: no listener, a listener on another port, or a
   target that no longer boots. It never says which. A bricked target loses the job silently, as a
   bricked front box loses a two-hop job. Players learn the hard way.

### The draws and the terms

10. **A fifth of contracts (2026-11-16).** Each of the four older kinds goes from ¼ to ⅕, and
    backdoor jobs are carved from their edges on the same `mission-kind-<n>` draw, so a number is
    the kind it was, with its shape, terms and LAN exactly, or has become a backdoor job. No number
    turns from one older kind into another.

11. **Pay is the key job's (2026-11-16):** 500–2,000 JSC single-hop and 2,000–4,000 two-hop, to
    the nearest 50, as sabotage and file jobs pay. The extra step (netcat, then `nc -l` on the
    right port) is small beside the route. Rejected: tamper's higher range.

12. **The wording (2026-11-16).** The board reads `<Client> — plant a backdoor on a build server —
    §<pay>`, and `plant a backdoor on an internal build server` on two-hop. The briefing opens
    with the role's pitch, as every briefing does, then:

    ```text
    We want a way into their build server that stays open.
    Leave a listener on it, on port 31337.

    Write to this address with your wallet address while it is listening.
    No listener, no money. No wallet, no money.
    ```

    On two-hop it adds "It is a machine inside their network, not on the edge." It never names the
    box, its address, a path, `nc` or netcat: "a listener" is the hint.

13. **The operator (2026-11-16).** `hireme.ts show` prints `Kind: backdoor, <role>` and
    `Port: <n>`, calls the slot the target as for sabotage, and prints no storage, key path or key.

### Left for later

14. **Filed in `docs/backlog.md` under "missions — deferred" (2026-11-16):** a client that
    connects from outside (a breakable gateway and a forward the contractor adds, which is legacy's
    `portforward` too); a listener that must survive a later check (the deadlines template); a
    backdoor that must not show in `ps` or a log (the stealth template); and the white-hat mirror,
    finding and killing an implant someone else left (legacy's `malware`).

---

## Where it plugs in

Read before the slice; every path is today's code.

- **The kind** is `missionKind` (`src/core/missions/missionShape.ts`), one draw on
  `mission-kind-<n>` cut today at `TAMPER_BELOW` ¼, `SABOTAGE_FROM` ⅓, `SABOTAGE_BELOW` 7⁄12 and
  `KEY_FROM` ¾, file jobs in the two gaps. `MissionKind` gains `'backdoor'`. Each older kind
  gives up 1⁄20 at one edge, so its numbers keep their kind or turn backdoor:

  | Draw            | Kind     |
  | --------------- | -------- |
  | 0 to 1⁄5        | tamper   |
  | 1⁄5 to ¼        | backdoor |
  | ¼ to ⅓          | file     |
  | ⅓ to 8⁄15       | sabotage |
  | 8⁄15 to 7⁄12    | backdoor |
  | 7⁄12 to 7⁄10    | file     |
  | 7⁄10 to ¾       | backdoor |
  | ¾ to 19⁄20      | key      |
  | 19⁄20 to 1      | backdoor |

  Five fifths: tamper ⅕, file 1⁄12 + 7⁄60, sabotage 3⁄15, key 4⁄20, backdoor four twentieths.
- **The shape**: `storageOf` returns `null` for backdoor as for sabotage and file, so
  `keptInDatabase`, `missionFiles`, `missionFilePaths` and `show` already lay and print nothing
  for it once they handle the kind.
- **The role and the port** come from one new stream, `mission-backdoor-<n>`: the role first,
  then the port, so no earlier draw moves. The seven roles' nouns and suffixes are sabotage's
  (`SABOTAGE_ROLES`, `src/core/missions/sabotageRoles.ts`); each gains backdoor pitches beside its
  sabotage ones. The module now names a target's role for two kinds, so it is renamed for that
  (e.g. `targetRoles.ts`) in the refactor step after GREEN, if the owner agrees.
- **The hostname**: `keyBoxSuffix` names the slot from the sabotage role for a sabotage number and
  `KEY_BOX_SUFFIX` otherwise; a backdoor number takes its backdoor role's suffix. It rides in the
  bundle, as sabotage's does, and `machineIdForLanHost` moves only for numbers that turn backdoor.
- **Terms** (`src/core/missions/missionTerms.ts`): `MissionTerms` gains a `job: 'backdoor'` arm
  with no `keyOpens`, drawn on `mission-terms-<n>` in the sabotage arm's order (client, target
  company from `TARGET_TRADES`, the role's backdoor pitch, then pay from `SINGLE_HOP`/`TWO_HOP`),
  `kind: plant a backdoor on (a | an internal) <noun>`.
- **The briefing** is `jobLines` (`src/core/hireme/contracts.ts`), which branches on `terms.job`.
  A backdoor job gets the two ask lines, the sabotage arm's inside line on two-hop, then the
  "while it is listening" line and "No listener, no money. No wallet, no money."
- **The client's check** is `answerClientMail` (`src/core/missions/clientMail.ts`). `decide`
  sends a sabotage job to `checkDown`; a backdoor job gets its own decision (e.g.
  `checkListening`) that reads the target through the same `readTargetBox` dep
  (`targetBoxReader` in `src/core/emailit/handleResolveMail.ts`, on `generatedLanBox`). An `up`
  read carries the replayed `fs`; the job is done when `readRunningProcesses(fs)` (or
  `readOpenPorts`) holds a `listener` on the named port. `absent` and anything else answer the
  miss line; `error` answers nothing (null, 500). `RECEIVED` gains "We're in." for the shared
  completion path, which already appends the shared no-wallet line.
- **The listener already lands on a contract box.** `nc -l` on a hop writes
  `/var/run/nc-<port>.pid` through `env.patches.write`, and `remoteWritePermission` fences only the
  files the server lays on a contract box (`missionFilePaths`), so a root's plant there is an
  ordinary journal write. The new wire-check proves it on a contract box.
- **`show`** (`src/core/missions/hiremeOrders.ts`): `kindLines` gains `Kind: backdoor, <role>` and
  a `Port:` line; the slot name `target` and the empty storage lines widen from sabotage to
  backdoor.
- **What re-rolls on ship:** a fifth of all numbers turn backdoor. Every pinned number, wire-check
  and test factory that lands backdoor is re-picked, as each earlier kind re-picked its own.

## Given by the plan, not the grill

- **The target company** is a key job's, `<Stem> <trade>`, as sabotage and file jobs have.
- **The no-wallet reply** is the line every kind already shares: "You sent no wallet, so there is
  nothing to pay. No wallet, no money."
- **The miss line names the port** the briefing named, so a contractor who planted on the wrong
  port can see the client's number beside their own without being told they were close.
- **One stream for role and port** (`mission-backdoor-<n>`, the role drawn first): both grill
  answers asked only that neither moves an older draw.

---

## Slices

One slice, one PR. The roles, the routes, the target slot and the listener already exist, so the
whole job ships at once. Load `tdd`, `testing` and `refactoring` before code and `mutation-testing`
at the PR gate.

### Slice 1 — a client hires a contractor to plant a backdoor, and pays while it listens (v0.464.0)

**Value:** a contractor takes a `plant a backdoor on a build server` job off the board, roots the
target by its route, installs netcat there, leaves `nc -l <port>` running, mails the client, and
is paid once; a mail with nothing listening on that port gets "Nothing is listening on port N. No
listener, no money."
**Class:** behavior change. **Branch:** `feat/backdoor-jobs`.

**Acceptance criteria**

- A fifth of numbers are backdoor jobs on `mission-kind-<n>`, cut as the table above, and each
  older kind keeps a fifth. Every number that stays key, tamper, sabotage or file keeps its shape,
  terms and LAN exactly (a 2,000-number sample deep-equals a fixture captured from `main`,
  captured and deleted inside the PR).
- A backdoor number's target sits in the key-box slot (same octet, route, decoys and front box),
  named `<stem>-<suffix>` from one of the seven roles, about a seventh each, and holds no key, no
  records and no database added for storage. Its public scan is the route's forwards plus decoys.
- Each contract draws one port from 1337, 4444, 5555, 6666, 7777, 9001, 12345 and 31337, and a
  test fails if any catalog service defaults to a port in that pool.
- The board reads `<Client> — plant a backdoor on a <noun> — §<pay>`, and `plant a backdoor on an
  internal <noun>` on two-hop. Pay is 500–2,000 single-hop and 2,000–4,000 two-hop, to the
  nearest 50. The target is `<Stem> <trade>`.
- The briefing opens with one of the role's 3–4 backdoor pitches, shared with no other role and no
  sabotage pitch, asks "We want a way into their <noun> that stays open." and "Leave a listener on
  it, on port <n>.", adds "It is a machine inside their network, not on the edge." on two-hop, and
  ends "Write to this address with your wallet address while it is listening." and "No listener,
  no money. No wallet, no money." Never the hostname, the box's address, a path, `nc` or netcat.
- Any mail from the contractor on an accepted backdoor job reads the target box:
  - up, with a listener on the named port (anyone's) → completed, paid once, "We're in. §X sent
    to jsc…. Pleasure doing business." (no wallet: "We're in. You sent no wallet, so there is
    nothing to pay. No wallet, no money.");
  - no listener, a listener on another port, or a target that does not boot → "Nothing is
    listening on port <n>. No listener, no money.", the job still accepted.
- A later mail on the completed job → "That job is already closed.", without reading the box, so
  a listener killed after payment changes nothing.
- A box read that fails answers nothing (null, 500 at the handler), never a guessed reply.
- `hireme.ts show` prints `Kind: backdoor, <role>`, `Port: <n>`, names the slot the target, and
  prints no storage, key path or key.
- Key, tamper, sabotage and file jobs offer, brief, complete, refuse and close exactly as before.

**TDD order (RED first, each at its public surface)**

1. `missionKind`: the five shares over a sample; every number that keeps an older kind keeps it.
2. The backdoor draw: role about a seventh each, port from the pool, the pool clear of every
   catalog default port.
3. `missionShape` and the lay-in: a backdoor target holds no key, records or storage database;
   `missionFilePaths` lists only the route's files.
4. `generateHomeLan` for a backdoor number: the slot named from its role; every other kind's
   hostnames unchanged.
5. `missionTerms`: the backdoor line, the internal line, the pay ranges, the target name.
6. The briefing for a backdoor job, single-hop and two-hop.
7. `answerClientMail`: a listener on the port pays once (with and without a wallet); none, the
   wrong port and a box that does not boot answer the miss line; closed without a read; a failed
   read answers null; every other kind unchanged.
8. `show` for a backdoor number.
9. Factories and pinned wire-check numbers moved off numbers that landed backdoor.

**Gates**

- `npm run typecheck`, `npm run lint`, the full suite, `npm run build` with `checkBudgets` (raise
  the ceiling if the pitches need it).
- Wire-check `scripts/testMissionBackdoor.ts` (new), staging numbers with `hireme.ts accept
  --number`, the listener written as the route's root through `/api/patches` as
  `testMissionSabotage.ts` writes its brick: a mail before anything → the miss line; a listener on
  another port → the miss line; a listener on the named port → paid once, and a second mail →
  closed; a fresh contract whose listener is planted from a second player's session, then mailed
  by the contractor → paid; a listener then removed before the mail → the miss line; a bricked
  target → the miss line; a two-hop contract with the listener on the front box → the miss line.
  Every other mission wire-check re-runs green.
- Mutation gate on the changed lines of `missionShape.ts`, the roles module, `missionTerms.ts`,
  `clientMail.ts`, `contracts.ts`, `generateHomeLan.ts` and `hiremeOrders.ts`.
- `docs/missions-architecture.md`: the header and "the one idea" name the fifth kind (a backdoor
  job reads whether the box is listening), the kind split moves to fifths in "File jobs" and
  "Sabotage jobs", and a "Backdoor jobs" section records what this slice built.
- v0.464.0 in `package.json` and `package-lock.json`.

### Close-out

One browser run on a fresh player: a single-hop backdoor job worked from the board to the payout,
mailed once with nothing listening for the miss line, then `apt install netcat` and `nc -l <port>`
on the target as root; and a two-hop one taken through the front box to the target. Then
`docs/missions-architecture.md` finished, `docs/project-status.md` given its entry, the plan
retired, and the story offered for valleynews.io `/dev`.
