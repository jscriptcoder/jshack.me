# Plan: a contract that asks for a file slipped onto a machine

**Status:** Grilled and planned 2026-11-16. Slice 1 merged (#777, v0.465.0), its migration on
jshack-dev and jshack-prod. Slice 2 grew a seventh item, a boot script (decisions 10–12,
2026-11-17). Next: slice 2's criteria approved, then RED.

A sixth kind of contract, the reverse of a file job. The client mails the player a file and wants
it laid at a path on one of the target's machines; the client reads the box for it when the
contractor mails in, as a backdoor or sabotage client does. As-built context:
[`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

### The job

1. **The client reads the target box when the contractor mails (2026-11-16).** The job is done
   when the file at the exact path the briefing names is, character for character, the file the
   client sent: one changed byte, or a newline `nano` added, is another file. It must still be
   there at that mail; a rival's or the owner's `rm`, or a brick, before it loses the job. Anyone's
   placement counts, as anyone's listener counts on a backdoor job. Rejected: a check at the
   moment of placing (the client never watches the box; it looks when mailed).

2. **The file is one of the six file-job items, the story flipped (2026-11-16)** from "bring us
   theirs" to "slip in ours": a tampered firmware image, a forged signed contract, a doctored site
   photo, a fake prototype render, a poisoned customer export, a key ring with the client's key
   added. Each keeps its keepers, name shape and directories, and is rendered by the same code
   (`core/missions/missionFileItem.ts`) from an HMAC under `MISSION_KEY_SECRET` on a stream of its
   own, so nobody forges it without the mail. Rejected: a new pool built around an executable (a
   planted binary never runs, so "a virus" would be a story with no effect behind it).

3. **The kind is called `infiltrate` (2026-11-16).** The terms read
   `<Client> — infiltrate a <item> — §<pay>` (`infiltrate an internal …` on two-hop), and
   `hireme.ts show` prints `Kind: infiltrate, <item>`. Rejected: `plant`, legacy's name, which
   blurs into the backdoor terms' "plant a backdoor". `mission-kind-<n>` splits in sixths on the
   backdoor precedent (each older kind gives up a sliver at one edge, so no number moves between
   older kinds); the fractions are the plan's.

4. **The briefing carries the file and names its full path (2026-11-16).** The briefing laid on
   accept is the message that carries the attachment, under the file's own name, so `mail save
   <n>` gives the right file; no second mail. The briefing names the whole path, directory and
   name: the work is reaching it with write access, not guessing it. On two-hop it adds "It is a
   machine inside their network, not on the edge." Rejected: naming only the file and its keepers
   and making the player hunt for the directory.

   ```text
   Their lawyers keep their signed contracts on one of their machines.
   We want ours among them. Put the attached file at:

     /srv/legal/harbour-bid-signed.pdf

   Write to this address with your wallet address once it is there.
   No file in place, no money. No wallet, no money.
   ```

5. **The target's own version sits at the path, root-only, and the player overwrites it
   (2026-11-16).** The server lays the company's genuine item there: the same item and name as the
   client's file, drawn on another stream, so the two never match. Every flipped story is a
   replacement (their contract for a forged one, their build for a tampered one), and an `ls`
   there tells the player they found the place. The directory and file are root's and the path is
   in `missionFilePaths`, as on a file job, so the job needs root on the target, the bar a backdoor
   job sets. A root's `rm` of the genuine file costs nothing by itself; only the client's file
   missing at the mail loses the job. Rejected: an empty root-only directory (nothing confirms
   the place), a directory the NPC user can write (a user login would finish the easiest job on
   the board).

6. **The file is sent once (2026-11-16).** The briefing's attachment is the only copy the client
   gives: a `mail delete`, a saved copy edited or removed, or a bricked home box loses it, and
   the player can drop the contract. A copy the player made (on another box, already on the
   target, or mailed to themselves with `-A`) still serves. A mail with the file not in place
   gets "No file in place, no money." and nothing else. Rejected: a resend on request (kinder,
   more code, for a mistake the player can avoid).

7. **The target is the file job's (2026-11-16):** the key box's slot (same octet, route, decoys
   and front box; the inside box on two-hop), hostname `<stem>-files`, no storage and no service
   of its own, so a scan never tells a file job from an infiltrate job. The pay is the key job's
   (500–2,000 single-hop, 2,000–4,000 two-hop, to the nearest 50), as for every kind. Rejected: a
   hostname per item (`<stem>-legal`, `<stem>-fw`), which gives the kind and the item away.

### The proof

8. **The replies (2026-11-16)**, subject `Contract: <target>`, the first row that fits answering:

   | The mail                            | The reply                                                                             | What changes              |
   | ----------------------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
   | No accepted job with this client    | "We have no contract with you."                                                       | nothing                   |
   | A completed job                     | "That job is already closed." (the box is not read)                                   | nothing                   |
   | Our file at the path, with a wallet | "It's in place. §1,450 sent to jsc…. Pleasure doing business."                        | completed, the pay minted |
   | Our file at the path, no wallet     | "It's in place. You sent no wallet, so there is nothing to pay. No wallet, no money." | completed, nothing minted |
   | Anything else                       | "Our file is not at /srv/legal/harbour-bid-signed.pdf. No file in place, no money."   | nothing                   |
   | The read itself fails               | nothing: 500, as any store failure                                                    | nothing                   |

   "Anything else" is one reply for nothing at the path, their genuine file still there, a file
   one character off, and a target that no longer boots; it never says which, and a bricked
   target loses the job for good. Only the mail's wallet matters: an attachment is ignored, so
   mailing the client its own file proves nothing. A completed job stays completed: a later `rm`
   or brick takes nothing back.

   **No new tool carries the file (fact, 2026-11-16).** `scp` ships on every box
   (`SYSTEM_UTILITY_NAMES`, `core/generation/binaries.ts`) and writes through the gate an `ssh`
   session's write does, so a root password for the target is enough:
   `scp <file> root@<target>:<path>`. On two-hop the file goes to the front box first, then from
   there to the inside target.

### The work

9. **Two slices (2026-11-16).** Slice 1, an infiltrate job pays, for a firmware image: the kind
   and its share of `mission-kind-<n>`, the briefing carrying the client's file (new in
   `hireme_accept`), the genuine image laid root-only at the path, the client's read of the box,
   the replies, `hireme.ts show`, and a wire-check that drives accept → `mail save` → `scp` to the
   target → the mail → the payout. Slice 2, the other five items: their flipped pitches, terms,
   briefing wording and directories, on code slice 1 built. Rejected: one PR (the SQL, the door and
   six items' content in one diff); three slices (a briefing that carries a file but pays nothing
   is half a story).

### A seventh item (grilled at slice 2)

10. **An infiltrate job may ask for a boot script, the virus the owner asked for (2026-11-17).**
    A script laid in a folder the target's servers run when they start; the pitch says the
    client's copy runs with them. It is story only, like every other item: nothing in the game
    executes it, and the client checks its bytes at the path exactly as for the other six.
    Rejected for now: the script shown started on the target's next boot (`systemctl`, `ps`), and
    a script that really executes and does something, both new boot machinery; the latter stays
    in the backlog's infiltrate twists.
11. **The company's own boot script sits at the path, root-only, and the client's is a doctored
    copy (2026-11-17)**, as decision 5 has it for every item: the same opening, its own bytes,
    overwritten by the contractor, and an `ls` there confirms the place. Rejected: an empty
    root-only directory the contractor adds a script to.
12. **It is called `boot script` (2026-11-17)**: `infiltrate a boot script` on the board, "Their
    admins keep a boot script. We want ours in its place." in the briefing, the virus told by the
    pitch, as the board names every item plainly. Rejected: `startup script`; `virus`, which
    tells the story on the board and breaks the briefing's keepers line.

    Given, not grilled: only infiltrate jobs draw it (one in seven on `mission-file-item-<n>`),
    because a file job drawing from seven would move every file job's item; and no box has
    `/etc/init.d` today, so the job lays the directory as it lays `/opt/firmware`.

---

## Where it plugs in

Read before the slice; every path is today's code (v0.464.1).

- **The kind** is `missionKind` (`src/core/missions/missionShape.ts`), one draw on
  `mission-kind-<n>`. `MissionKind` gains `'infiltrate'`. Each of the five kinds goes from ⅕ to
  ⅙ by giving up 1⁄30 at the top of one of its pieces, so a number is the kind it was or has
  become infiltrate, and none turns from one older kind into another. In sixtieths:

  | Draw (×1⁄60) | Kind       | Was      |
  | ------------ | ---------- | -------- |
  | 0 to 10      | tamper     | tamper   |
  | 10 to 12     | infiltrate | tamper   |
  | 12 to 15     | backdoor   | backdoor |
  | 15 to 20     | file       | file     |
  | 20 to 30     | sabotage   | sabotage |
  | 30 to 32     | infiltrate | sabotage |
  | 32 to 35     | backdoor   | backdoor |
  | 35 to 40     | file       | file     |
  | 40 to 42     | infiltrate | file     |
  | 42 to 45     | backdoor   | backdoor |
  | 45 to 55     | key        | key      |
  | 55 to 57     | infiltrate | key      |
  | 57 to 58     | backdoor   | backdoor |
  | 58 to 60     | infiltrate | backdoor |

  Ten sixtieths each: tamper 10, backdoor 3+3+3+1, file 5+5, sabotage 10, key 10, infiltrate
  2×5.
- **The shape**: `storageOf` returns `null` for infiltrate as for file, sabotage and backdoor; the
  target is the key-box slot with `KEY_BOX_SUFFIX` (`-files`), as a file job's is.
- **The item and its path** (`src/core/missions/missionFileItem.ts`): an infiltrate number uses
  the file job's name and directory draw (`mission-file-<n>`), so `missionFileName` and
  `missionFilePath` answer for it unchanged. In slice 1 its item is the firmware image; slice 2
  draws it one in six on `mission-file-item-<n>` as a file job's. Each item gains the flipped
  pitches beside its file-job ones, shared with no other item and no file-job pitch.
- **Two files, one path.** `missionFileContent` (HMAC of `file:<n>`) stays the target's genuine
  file. A new `missionPlantContent(n, secret)` renders the client's file with the same item
  renderer from an HMAC of `infiltrate:<n>`, so the two share name, path and header and never
  match.
- **The genuine file is laid** by `missionFiles` (`src/core/missions/missionLeak.ts`): `holdsFile`
  widens from `file` to `file | infiltrate`, so `fileJobFile` lays it root-only (`ROOT_FILE`) and
  `missionFilePaths` lists its path for the write gate. Lay-in runs before the journal replays,
  so a root's `scp` over it is what every later read sees.
- **The briefing carries the file.** `briefingOf` (`src/core/hireme/contracts.ts`) returns a
  `ContractMail` that gains an optional `attachment: {name, content}`; an infiltrate briefing's is
  `{missionFileName(n), missionPlantContent(n, secret)}`. The board door (`BoardDoor`) gains the
  mission secret; with it unset, an infiltrate accept answers null (500) before the store is
  asked, and every other kind's accept is unchanged. `BoardStore.accept` carries the attachment
  to a new migration that replaces `hireme_accept` with two more arguments,
  `mail_attachment_name` and `mail_attachment_content` (`''` for none, as `email_send` takes
  them, since the function is `STRICT`), and inserts them into `email_messages`. `api/network.ts`
  passes `process.env.MISSION_KEY_SECRET` to the door and the two new arguments to the rpc.
- **Terms** (`src/core/missions/missionTerms.ts`): `MissionTerms` gains a `job: 'infiltrate'` arm
  drawn on `mission-terms-<n>` in the file arm's order (client, target company, the item's
  flipped pitch, pay), `kind: infiltrate (a | an internal) <noun>`.
- **The briefing's lines** (`jobLines`): an infiltrate job gets the ask, the path, the inside line
  on two-hop, the "once it is there" line and "No file in place, no money. No wallet, no money."
- **The client's check** (`src/core/missions/clientMail.ts`): `decide` sends an accepted
  infiltrate job to a new `checkPlanted` decision, and `proves` answers true for it, as for the
  other box-read kinds. `checkPlanted` reads the target through `readTargetBox`; the job is done
  when the box is `up` and the file at `missionFilePath(n)` in its `fs` is exactly
  `missionPlantContent(n, secret)`. `absent`, a missing file, the genuine file or any other
  content answers the miss line; `error` answers null (500). `RECEIVED` gains "It's in place."
- **`show`** (`src/core/missions/hiremeOrders.ts`): `Kind: infiltrate, <item>` and
  `File: <path>, theirs <n> bytes, ours <m> bytes`, the slot called the target, no storage, key
  path or key.
- **What re-rolls on ship:** a sixth of all numbers turn infiltrate. Every pinned number,
  wire-check and test factory that lands infiltrate is re-picked, as each earlier kind re-picked
  its own.

## Given by the plan, not the grill

- **The board names the plain item**: `infiltrate a firmware image`, not "a tampered firmware
  image"; the flipped story is the pitch's to tell, as a file job's board says only
  `retrieve a firmware image`.
- **The briefing's ask** reads, for the firmware image:

  ```text
  Their engineers keep a firmware image. We want ours in its place.
  Put the attached file at:

    /opt/firmware/<device>-fw-<version>.bin

  Write to this address with your wallet address once it is there.
  No file in place, no money. No wallet, no money.
  ```

  On two-hop the inside line is the shared helper's: "The path is on a machine inside their
  network, not on the edge." (the grill's "It is a machine …" reads wrongly after a path).
- **The miss line names the path**: "Our file is not at <path>. No file in place, no money."
- **The client's file is no bigger than an attachment may be** (8,000 characters), as every
  file-job item already is; a test holds every infiltrate number's file under it.
- **An accept with the secret unset fails whole**: no job taken and no briefing laid, rather than
  a briefing without its file.

---

## Slices

Load `tdd`, `testing` and `refactoring` before code and `mutation-testing` at the PR gate.

### Slice 1 — a client hires a contractor to slip in a firmware image, and pays once it is there (v0.465.0)

**Value:** a contractor takes an `infiltrate a firmware image` job off the board, saves the
briefing's attachment with `mail save`, roots the target by its route, `scp`s the file over the
target's own image at the path the briefing names, mails the client, and is paid once; a mail
with anything else at that path gets "Our file is not at <path>. No file in place, no money."
**Class:** behavior change. **Branch:** `feat/infiltrate-jobs`.

**Acceptance criteria**

- A sixth of numbers are infiltrate jobs on `mission-kind-<n>`, cut as the table above, and each
  older kind keeps a sixth. Every number that stays key, tamper, sabotage, file or backdoor keeps
  its shape, terms and LAN exactly (a 2,000-number sample deep-equals a fixture captured from
  `main`, captured and deleted inside the PR).
- An infiltrate number's target sits in the key-box slot (same octet, route, decoys and front
  box), named `<stem>-files`, with no key, records or storage database. It holds the company's
  genuine firmware image at the path, root-only, and only root may write that path.
- The client's file shares the genuine file's name, path and header, is never equal to it, and is
  under 8,000 characters.
- The board reads `<Client> — infiltrate a firmware image — §<pay>`, and `infiltrate an internal
  firmware image` on two-hop. Pay is 500–2,000 single-hop and 2,000–4,000 two-hop, to the nearest
  50. The target is `<Stem> <trade>`.
- Accepting lays a briefing that carries the client's file as its attachment, under the file's
  name, so `mail save <n>` writes it byte for byte. The briefing opens with one of the firmware
  image's flipped pitches (shared with no file-job pitch), says "Their engineers keep a firmware
  image. We want ours in its place." and "Put the attached file at:" with the full path, adds the
  inside line on two-hop, and ends "Write to this address with your wallet address once it is
  there." and "No file in place, no money. No wallet, no money."
- With the mission secret unset, accepting an infiltrate offer answers 500 and takes no job;
  every other kind's accept is unchanged.
- Any mail from the contractor on an accepted infiltrate job reads the target box:
  - up, with the client's file at the path (anyone's placement) → completed, paid once, "It's in
    place. §X sent to jsc…. Pleasure doing business." (no wallet: "It's in place. You sent no
    wallet, so there is nothing to pay. No wallet, no money.");
  - nothing at the path, the genuine file, any other content, or a target that does not boot →
    "Our file is not at <path>. No file in place, no money.", the job still accepted.
- A mail's attachment is ignored on an infiltrate job: mailing the client its own file is the
  miss line while the path is wrong.
- A later mail on the completed job → "That job is already closed.", without reading the box.
- A box read that fails answers nothing (null, 500 at the handler).
- `hireme.ts show` prints `Kind: infiltrate, firmware image` and `File: <path>, theirs <n> bytes,
  ours <m> bytes`, names the slot the target, and prints no storage, key path or key.
- Key, tamper, sabotage, file and backdoor jobs offer, brief, complete, refuse and close exactly
  as before.

**TDD order (RED first, each at its public surface)**

1. `missionKind`: the six shares over a sample; every number that keeps an older kind keeps it.
2. `missionShape` and the lay-in: an infiltrate target holds the genuine image root-only and no
   key, records or storage database; `missionFilePaths` lists its path.
3. `missionPlantContent`: same name, path and header as the genuine file, never equal, under
   8,000 characters.
4. `missionTerms`: the infiltrate line, the internal line, the pay ranges, the target name.
5. The briefing for an infiltrate job, single-hop and two-hop, and its attachment.
6. The board's accept: the attachment reaches the store; the secret unset answers null with the
   store never asked; other kinds unchanged.
7. `answerClientMail`: the client's file at the path pays once (with and without a wallet);
   nothing there, the genuine file, other content, a mailed attachment and a box that does not
   boot answer the miss line; closed without a read; a failed read answers null; every other kind
   unchanged.
8. `show` for an infiltrate number.
9. Factories and pinned wire-check numbers moved off numbers that landed infiltrate.

**Gates**

- `npm run typecheck`, `npm run lint`, the full suite, `npm run build` with `checkBudgets` (raise
  the ceiling if the pitches need it).
- The migration applied locally (`supabase db reset` or `migration up`), and pushed to
  jshack-dev and jshack-prod at merge (link → push → unlink per project).
- Wire-check `scripts/testMissionInfiltrate.ts` (new), staging numbers with `hireme.ts accept
  --number` and the board's accept: the briefing carries the client's file and `mail save` gives
  it back byte for byte; a mail before anything → the miss line; another file written at the path
  as the route's root through `/api/patches` → the miss line; the client's file written there →
  paid once, and a second mail → closed; a fresh contract whose file is laid from a second
  player's session, then mailed by the contractor → paid; the file laid then removed before the
  mail → the miss line; a bricked target → the miss line; a two-hop contract with the file on the
  front box → the miss line. `testMailAttach.ts` and every other mission wire-check re-run green.
- Mutation gate on the changed lines of `missionShape.ts`, `missionFileItem.ts`,
  `missionLeak.ts`, `missionTerms.ts`, `clientMail.ts`, `contracts.ts` and `hiremeOrders.ts`.
- `docs/missions-architecture.md`: the header and "the one idea" name the sixth kind, the kind
  split moves to sixths in the earlier kinds' sections, and an "Infiltrate jobs" section records
  what this slice built; `docs/email-architecture.md` notes that a briefing may carry a file.
- v0.465.0 in `package.json` and `package-lock.json`.

### Slice 2 — the other five items and a boot script (v0.466.0)

**Value:** an infiltrate job asks for any of seven items: the six a file job asks for, each with
four flipped pitches, and a boot script the client's copy of which is a virus. Each keeps its own
name, directories and format.
**Class:** behavior change (content). **Branch:** `feat/infiltrate-items`.

**Acceptance criteria**

- An infiltrate number draws its item one in seven on `mission-file-item-<n>` from the six items
  and the boot script, each about a seventh of the time. File jobs keep their item, name, path and
  bytes exactly (still one in six, never a boot script). An infiltrate number keeps its kind,
  shape, terms and pay; only its item and file change.
- Each of the seven items carries four infiltrate pitches, 28 in all, shared with no other item
  and no file-job pitch; the briefing opens with one of its item's.
- The board reads `infiltrate a <noun>` (`an internal` on two-hop), the briefing "Their <keepers>
  keep a <noun>. We want ours in its place.", and `show` `Kind: infiltrate, <noun>`, for all
  seven.
- For every item the client's file has the genuine file's name and path, opens the same way (a
  header, or a jpeg's Exif or a pdf's Info), is never the genuine file, and is at most 8,000
  characters a copy carries unchanged.
- **The boot script:** noun `boot script`, keepers `admins`; named for a housekeeping service
  (`backup-sync`, `logrotate-sync`, …) in `/etc/init.d` or `/etc/rc.d/init.d`, root-only, the
  directory laid by the job. The company's copy is a readable shell script: `#!/bin/sh`, an
  `### BEGIN INIT INFO` block naming the service, and the service's housekeeping lines. The
  client's copy is the same script with one line more that starts the client's program, its path
  and token drawn from the secret, so nobody writes it without the briefing.
- Every other kind offers, briefs, completes, refuses and closes exactly as before.

**Gates:** typecheck, lint, full suite, `build` with `checkBudgets` (raise the ceiling for the
pitches); `testMissionInfiltrate.ts` reads the drawn item instead of naming the firmware image,
and adds a boot-script contract and a jpeg- or pdf-item contract worked through to the payout,
with every other mission wire-check green; the mutation gate on the changed lines;
`docs/missions-architecture.md` lists the seven items; v0.466.0.

### Close-out

One browser run on a fresh player: a single-hop infiltrate job worked from the board to the
payout (mailed once before anything for the miss line, then `mail save`, root on the target,
`scp` over the genuine file), and a two-hop one carried through the front box. Then
`docs/missions-architecture.md` finished, `docs/project-status.md` given its entry, the e2e
skill's `reaching-a-state.md` given the route, the plan retired, and the story offered for
valleynews.io `/dev`.
