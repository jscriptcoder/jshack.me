# Plan: mail carries a file, and a contract that asks for one

**Status:** Grilled 2026-11-15. Slice 1 merged (v0.460.0, #772). Slice 2 merged (v0.461.0,
#773). Slice 3 planned.

A fourth kind of contract. Key jobs compare a mailed key, tamper jobs read a records box, sabotage
jobs check that a machine no longer boots. A **file job** asks the player to bring back one file
from the target's network (a prototype render, a signed contract, a firmware image) and mail it
to the client, who checks its bytes. Mail cannot carry a file today, so the work starts there:
**attachments are a mail feature for every address**, and the job is their first customer. It
brings back legacy's `exfiltrate` objective
([`docs/mission-ideas/mission-loop.md`](../docs/mission-ideas/mission-loop.md) §2) as the "file
exfiltration" item in `docs/backlog.md`. As-built context:
[`docs/email-architecture.md`](../docs/email-architecture.md),
[`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

### Mail carries a file

1. **Attachments are for every address (2026-11-15),** not only a client's. A player can attach a
   file to any mail and a recipient can save it. One rule rather than "clients take attachments,
   players don't"; and it is play of its own: partners pass loot (a `wallet.dat`, a wordlist, the
   job's file for a teammate to deliver), and a thief holding someone's `~/.mailrc` can save what
   they were sent. Rejected: client-only (no storage, no save command, but mail could then carry a
   file only to an NPC).

2. **One `-A <file>` per mail, on `send` and `reply` (2026-11-15),** GNU mailutils' own flag:
   `mail send copper-ops "the photo" -A /tmp/IMG_0412.jpg`. The file is read from the box the shell
   stands on, as the current user, exactly as `mail` already works from that box: what you cannot
   `cat` you cannot attach (`mail: <file>: Permission denied`, `No such file or directory`). A
   second `-A` is a usage error. Everything else about a send is unchanged: nano opens for the
   body, an empty draft cancels, a script passes the body as the final argument. Rejected: a
   separate `mail attach` subcommand, several files per mail (more mechanism, no play needs it;
   three files are three mails, under the 20-an-hour cap).

3. **An attachment is at most 8,000 characters (2026-11-15),** counted as the game counts a
   file's size (its length). Checked on the client before nano opens and again on the server, as
   the body is. The files worth mailing need not be realistic, only binary: a jpeg, a pdf, a
   `.dat`, a `.bin`. So the larger documents the world generates (up to about 21K) cannot be
   mailed, and emailit.io's root view keeps roughly the ceiling `docs/backlog.md` records today.
   Rejected: 32,000 (a believable photo, at the cost of that ceiling).

4. **Reading and saving (2026-11-15).**
   - `mail read <n>` ends the message with `[attachment: <name>, <size> bytes]`; the list is
     unchanged.
   - **`mail save <n> [path]`** writes the attachment onto the box the shell stands on, as the
     current user, with ordinary new-file permissions: with no path to `./<name>`, into a
     directory if the path is one, overwriting as `scp` and `>` do, through the same write gate as
     any write. It reads and needs no login, so it works in scripts.
   - The name travels as the sender's basename, never their path.
   - A reply does not carry the original's attachment, and there is no forward: save it and send
     it again.
   - `mail delete` takes the attachment with the message.
   - Rejected: saving on `read` (it writes files the player did not ask for, on whatever box they
     stand on).

5. **emailit.io's root view shows it as MIME (2026-11-15).** In `/var/mail/<handle>` a message
   with an attachment is `Content-Type: multipart/mixed`: the body as the first part, the
   attachment as the second with `Content-Disposition: attachment; filename="…"` and its raw
   bytes, not base64 (the game has no `base64 -d`). A root sees what everyone was sent but cannot
   cleanly carve it out byte-exact, which fits the view as built: a root reads and forges, never
   takes.

### The job

6. **A fourth kind, `file`, in quarters (2026-11-15).** `mission-kind-<n>` splits into quarters
   of tamper, sabotage, file and key, carved as sabotage was. Some numbers change kind, accepted
   ones on prod included, which is free until launch; every number that keeps its kind keeps its
   shape, terms and LAN exactly. Rejected: a fourth key storage beside `file`, `gpg` and
   `database` (the board, the briefing and the proof would all differ, so it is a kind in all but
   name).

7. **The target is the key-box slot (2026-11-15),** like the records box and the sabotage target:
   same octet, route, decoys and front box, the inside box on two-hop, so the whole route machinery
   carries over.

8. **Pay is the key job's (2026-11-15):** 500–2,000 JSC single-hop and 2,000–4,000 two-hop, from
   the same draw. Carrying bytes home is more work than reading a key, but not a different tier.

9. **The client checks the exact bytes (2026-11-15).** The server lays the file on the target box
   from `MISSION_KEY_SECRET`, as it lays the key, so nobody can derive it from the bundle, and the
   client compares the attachment with it byte for byte. The attachment's name does not matter.
   A file that changed on the way (saved through nano, rewritten by a `cat` into another encoding,
   a lookalike) is a wrong file, with no hint why. Rejected: a fingerprint or watermark inside the
   file (a player `strings` it out and pastes it into a file of their own, and the job is a key job
   again).

10. **The file is root-only and alone (2026-11-15):** mode 600, owned by root, so every route
    still has to land root; no look-alike neighbours beside it (filler is the deferred "believable
    filler" in `docs/backlog.md`). A root's `rm` of it sticks, as the key's does: whoever deletes
    it before it is copied loses the job for everyone, with no warning.

11. **The briefing names the file and never its path (2026-11-15):** "Their engineers keep a
    render of the new prototype, `vx7-render-final.jpg`. Bring it to us." The player finds it
    (`find / -name …`, or knowing where such things sit). A two-hop briefing adds the line that the
    machine is inside their network. Rejected: describing it only by content ("the PDF titled
    *Harbour bid*"), which needs neighbours and per-format fragments to `strings` through.

12. **Six items (2026-11-15),** one in six each on a stream of their own
    (`mission-file-item-<n>`), so nothing already drawn moves. Each carries a format, a name
    pattern, a pool of directories and three or four briefing reasons of its own; the name's parts
    are drawn from the number, the bytes from the secret. About 1–3K characters each.

    | Item               | Format | Name (example)              | Directories (pool)                       |
    | ------------------ | ------ | --------------------------- | ---------------------------------------- |
    | a prototype render | jpeg   | `vx7-render-final.jpg`      | `/srv/design/`, `/home/<user>/renders/`  |
    | a site photo       | jpeg   | `IMG_20260914_101522.jpg`   | `/var/lib/uploads/`, `/home/<user>/Pictures/` |
    | a signed contract  | pdf    | `harbour-bid-signed.pdf`    | `/srv/legal/`, `/var/archive/contracts/` |
    | a firmware image   | bin    | `ctl-fw-4.2.1.bin`          | `/opt/firmware/`, `/srv/releases/`       |
    | a customer export  | dat    | `customers-2026-10.dat`     | `/var/backups/`, `/srv/exports/`         |
    | a key ring         | dat    | `keyring.dat`               | `/root/.vault/`, `/etc/<stem>/`          |

    jpeg and pdf reuse `src/core/generation/documentFormats.ts`, so `strings` shows real-looking
    Exif or PDF Info; bin and dat get a short header fragment (`FWIMG v4.2.1`, `CUSTDB01`) and
    noise. The board reads `<Client> — retrieve a prototype render — §X`, `retrieve an internal …`
    on two-hop, as the other kinds add `internal`.

13. **The replies (2026-11-15)**, the key job's table with "file" for "key", subject
    `Contract: <target>`, the first row that fits answering; the wallet is found in the subject or
    body as now:

    | The mail                                                         | The reply                                                                             | What changes              |
    | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
    | No accepted job with this client, and not a completed job's file | "We have no contract with you."                                                       | nothing                   |
    | An accepted file job, no attachment                              | "No file, no money. Send the file."                                                   | nothing                   |
    | The right bytes, with a wallet                                   | "File received. §X sent to jsc…. Pleasure doing business."                            | completed, the pay minted |
    | The right bytes, no wallet                                       | "File received. You sent no wallet, so there is nothing to pay. No wallet, no money." | completed, nothing minted |
    | A completed job's file                                           | "That job is already closed."                                                         | nothing                   |
    | An accepted job, any other attachment                            | "That's not the file we asked for."                                                   | nothing                   |

    The client never reads the box, as for a key job, so nothing a later visitor does there breaks
    a completion. Key, tamper and sabotage jobs ignore an attachment; a file job ignores a key in
    the text. The `~/.mailrc` hole stays: whoever holds the contractor's login can deliver the file
    and name their own wallet.

### Slices

14. **Mail first, then the job (2026-11-15),** three slices, one browser run at close-out:
    1. **Mail carries a file:** `-A`, the 8,000 limit on both ends, attachments stored with the
       message, `read`'s line, `mail save`, `delete`, the MIME part in the root view. Playable on
       its own. The wire-check sends, saves and proves the bytes survive.
    2. **A file job pays:** the fourth kind in quarters with one item (the firmware image), laid
       root-only from the secret; the board line, the briefing, the replies, and `hireme.ts show`
       printing the item, its path and size.
    3. **The six items:** the rest, jpeg and pdf through `documentFormats.ts`, name patterns,
       directory pools, reasons.

    Rejected: client attachments first (it needs a temporary "attachments go to clients only"
    refusal for slice 3 to remove).

### To settle as facts while planning

- That `scp`, `ftp get` and `mail save` carry the noise byte-exact, through the patch store's TEXT
  column and the signed write.
- Where an attachment is stored: a column on `email_messages` or a table of its own.
- That a root's `rm` of the job's file sticks through the write gate, as the key's does
  (`missionFilePaths`).

### Settled while planning (2026-11-15)

- **An attachment is two nullable columns on `email_messages`**, `attachment_name` and
  `attachment_content`, both or neither, the content at most 8,000 characters. A message carries
  at most one, so a table of its own would only add a join.
- **The bytes survive.** `documentFormats.ts` already draws its noise so that `ftp get` and `scp`
  carry a file through the signed write and the TEXT column unchanged (no NUL, no control
  characters); `mail save` writes through the same `patches.write`, and slice 1's wire-check
  proves the round trip through emailit.io.

---

## Slice 1: mail carries a file

**Value:** a player attaches one file to a mail with `-A`, and its recipient sees it on `read`
and saves it to a file with `mail save`, byte for byte.
**Path:** `mail send|reply … -A <file>` (`src/core/commands/mail.ts`) → `env.mail.send`
(`src/adapters/networkApi.ts`) → `resolveMail` `op: 'send'` with `attachment`
(`src/core/emailit/handleResolveMail.ts`, `api/network.ts`) → `email_send` stores it (new
migration) → `email_read` answers it → `mail read` prints the line, `mail save` writes the
file through `env.patches.write`; `findMailSpool` selects it and `withMailSpool`
(`src/core/emailit/spool.ts`) writes the MIME part.
**Class:** behavior change. **Delivery:** one PR against `main`.
**Skills:** `tdd`, `testing`, `refactoring`; `mutation-testing` at PR readiness.

**Acceptance criteria**

1. `mail send <to> <subject words> -A <file>` and `mail reply <n> -A <file>` attach the file
   read from the box the shell stands on, as the current user; `-A` may sit anywhere after the
   subcommand. A script passes `'-A', '<file>'` among its arguments the same way.
2. Before nano opens, the command refuses: a missing file (`mail: <file>: No such file or
   directory`), an unreadable one (`… Permission denied`), a directory (`… Is a directory`), a
   file over 8,000 characters as `ls -l` counts it (`mail: <file>: too large to attach (max
   8000)`), and a second `-A` or an `-A` with no file (the usage line).
3. The server refuses an attachment over 8,000 characters, or a name with a `/` or an empty
   name, before the store.
4. The recipient's `mail read <n>` ends with `[attachment: <name>, <size> bytes]`, the name the
   sender's basename; a message with none prints as today; the list is unchanged.
5. `mail save <n> [path]` writes the attachment where the shell stands, as the current user:
   no path → `./<name>`; a directory → `<dir>/<name>`; a file path → that path, overwriting;
   refused where the user may not write (`Permission denied`), for a message with no
   attachment (`mail: message <n> has no attachment`) and as `read` refuses an unknown number.
   It does not mark the message read. It works from a script.
6. A reply does not carry the original's attachment; `delete` takes the attachment with the
   message.
7. A mail with an attachment to a client's handle is answered exactly as today (the
   attachment is ignored until file jobs exist).
8. A root on emailit.io reads such a message in `/var/mail/<handle>` as `multipart/mixed`, the
   body as the first part and the attachment as the second (`Content-Disposition: attachment;
   filename="<name>"`, raw bytes); a message without one is unchanged.
9. `mail`'s manual names `-A` and `save`.

**RED first:** jsdom/unit tests in `mail.test.ts` (parse, refusals, read line, save),
`handleResolveMail.test.ts` (schema, passing the attachment to the store, the read answer) and
`spool.test.ts` (the MIME part). **Wire-check** `scripts/testMailAttach.ts` against `vercel dev`
+ local supabase: a noise attachment sent, listed, read back byte-exact and with its size, the
8,001-character and bad-name refusals, a reply without it, delete taking it, the spool's MIME
part for root, and the client door unchanged. The migration goes to dev, then prod, before
merge.
**PR-ready when:** the criteria pass, `npm run typecheck`, `npm run lint` and the full suite
are green, the wire-check plus `testMailSend`, `testMailRead` and `testMailSpool` pass, the
mutation gate has run, the version is bumped (0.460.0) and `email-architecture.md` describes
attachments.

**As built (v0.460.0, #772).** Two departures from criteria 1 and 2, both from wiring `-A`
through the shell's own flag binder (`bindFlags`), as `curl -d` and `scp -p` are: a second `-A`
replaces the first instead of being a usage error, and a script passes `{ '-A': '<file>' }` in
its trailing flags object rather than among its arguments. The bundle's ceiling rose 700 B.

---

## Slice 2: a file job pays

**Value:** a contractor accepts a job asking for a firmware image, roots the target, mails the
file back attached, and is paid when its bytes are the ones the server laid.
**Path:** `missionKind` (`core/missions/missionShape.ts`) draws `file` → `missionTerms` gives
the board line, pitch and pay → the briefing (`core/hireme/contracts.ts`) names the file →
`missionFiles` (`core/missions/missionLeak.ts`) lays it on the target, root-only, from the
secret, and `missionFilePaths` puts it behind the write gate → `mail send <client> … -A <file>`
→ `handleResolveMail` hands the attachment to `answerClientMail`
(`core/missions/clientMail.ts`), which compares its bytes and completes the job →
`showReport` (`core/missions/hiremeOrders.ts`) prints the item, path and size. The item's
name, directory, pitches and bytes live in a new server-only module beside the terms.
**Class:** behavior change. **Delivery:** one PR against `main`.
**Skills:** `tdd`, `testing`, `refactoring`; `mutation-testing` at PR readiness.

**Settled while planning (2026-11-15)**

- **The quarters are carved so that no number changes between the old kinds.** Tamper keeps
  below ¼, sabotage ⅓ to 7⁄12, key from ¾; file takes the two gaps, ¼ to ⅓ and 7⁄12 to ¾. A
  number is the kind it was or has become a file job, never a tamper job turned sabotage. Three
  in four numbers keep their kind, the most any quarter split can keep. Rejected: contiguous
  quarters in the grill's order (simpler to read, but a twelfth of all numbers would swap
  between tamper and sabotage too).
- **The target keeps the key box's hostname, `<stem>-files`,** and has no storage
  (`MissionShape.storage` is `null`), as a sabotage target has none: the job's file is its
  only addition.
- **The firmware image:** `<device>-fw-<major>.<minor>.<patch>.bin`, the device one of `ctl`,
  `plc`, `rtu`, `hmi` and `cam`, in `/opt/firmware/` or `/srv/releases/`, all drawn from the
  number on `mission-file-<n>`. Its content is a readable header, `FWIMG v<version> <device>`,
  then 1,000 to 3,000 characters of noise, both the length and the noise drawn from an HMAC of
  the number under `MISSION_KEY_SECRET` (`file:<n>`), from the same Latin-1 range
  `documentFormats.ts` draws from (no NUL, no control characters, so it survives the signed
  write and the TEXT column).

**Acceptance criteria**

1. `mission-kind-<n>` splits into quarters as settled above. Every number that keeps its kind
   keeps its shape, terms and LAN byte for byte; every other number is now a file job.
2. A file job's target is the key box's slot: the same octet, route, decoys and front box, the
   inside box on two-hop, hostname `<stem>-files`, no storage (no key, no records, and no mysqld
   for them).
3. The server lays exactly one file on the target: the firmware image, at its drawn path,
   mode 600 owned by root. `strings` shows its header, the rest is noise. The same number
   under another secret has other bytes. Only root may write the path, and a root's `rm` of
   it sticks for every later visitor.
4. The board offers `<Client> — retrieve a firmware image — §<pay>`, and `retrieve an internal
   firmware image` on two-hop, at a key job's pay (500–2,000 single-hop, 2,000–4,000 two-hop,
   to the nearest 50), its pitch one of the firmware image's own four.
5. The briefing names the file and never its path or box: "Their engineers keep a firmware
   image, `<name>`. Bring it to us." On two-hop it adds "The file is on a machine inside their
   network, not on the edge." It ends "Mail it to this address as an attachment, with your
   wallet address." and "No file, no money. No wallet, no money."
6. A mail to the client of an accepted file job is answered by the first row that fits
   (the grill's table, decision 13): no accepted job here and not a completed job's file → "We
   have no contract with you."; no attachment → "No file, no money. Send the file."; the laid
   bytes with a wallet → "File received. §X sent to jsc…. Pleasure doing business.", completed
   and paid once; the laid bytes and no wallet → "File received. You sent no wallet, so there is
   nothing to pay. No wallet, no money.", completed; a completed job's file → "That job is
   already closed."; any other attachment → "That's not the file we asked for." The attachment's
   name does not matter, and the client never reads the box.
7. A file job ignores a key in the mail's text; key, tamper and sabotage jobs ignore an
   attachment, answering exactly as before.
8. `hireme.ts show` prints `Kind: file, firmware image` and `File: <path>, <size> bytes`, and no
   storage, key path or key.

**RED first:** unit tests in `missionShape.test.ts` (the quarters, the empty storage, a number
that kept its kind unchanged), `missionTerms.test.ts` (board line, pitch, pay), a test file for
the new item module (name, path, header, length, secret-bound bytes, character range),
`missionLeak.test.ts` (the file laid alone, root-only, and in `missionFilePaths`),
`contracts.test.ts` (the briefing), `clientMail.test.ts` (every row, and the other kinds
ignoring an attachment), `handleResolveMail.test.ts` (the attachment reaching the client's
door) and `hiremeOrders.test.ts` (the report). **Wire-check** `scripts/testMissionFile.ts`
against `vercel dev` + local supabase, staging through the real `hireme.ts`: a root on the
target reads the file root-only at its path, a guest is refused it, mails with no attachment, the
wrong one and the right one (with a wallet, which is paid once), then the right one again
(closed), and a root's `rm` of the file sticking. The fixed numbers the other mission
wire-checks use are checked against the new draw and re-picked where one became a file job.
**PR-ready when:** the criteria pass, `npm run typecheck`, `npm run lint` and the full suite
are green, `testMissionFile` and every other `testMission*` wire-check pass, the mutation gate
has run, the version is bumped (0.461.0), the bundle's ceiling covers the change, and
`missions-architecture.md` has a "File jobs" section.

**As built (v0.461.0, #773).** One departure from criterion 5: the briefing reads "Their
engineers keep a firmware image. Bring it to us. Its name is:" with the name alone on the next
line, set off by blank lines, so a name ending `.bin` is never followed by a full stop. The
wire-checks' fixed numbers held; `testMissions` skips a non-key number when it picks one per
route, and `testMissionBoard` knows each kind's closing rule. The bundle's ceiling did not move.

## Slice 3: the six items

**Value:** a file job asks for one of six things a company keeps (a prototype render, a site
photo, a signed contract, a firmware image, a customer export or a key ring), each a file of its
own format, name and place. A contractor reads the board, the briefing and `strings` of what
they find as a different job each time.
**Path:** `missionFileItem(n)` (`core/missions/missionFileItem.ts`) draws the item on
`mission-file-item-<n>` → `missionTerms` takes its noun and pitches for the board line and pitch
→ the briefing (`core/hireme/contracts.ts`) takes its keepers and the name → `missionFiles`
(`core/missions/missionLeak.ts`) lays its bytes at its path, which `missionFilePaths` gates →
the client compares the attachment with those bytes (`core/missions/clientMail.ts`, unchanged)
→ `showReport` (`core/missions/hiremeOrders.ts`) prints the item. jpeg and pdf content comes
from `renderDocument` (`core/generation/documentFormats.ts`), drawn with the secret's stream.
**Class:** behavior change. **Delivery:** one PR against `main`, branch `feat/file-items`.
**Skills:** `tdd`, `testing`, `refactoring`; `mutation-testing` at PR readiness.

**Settled while planning (2026-11-15)**

- **No item sits in a user's home.** System directories replace the grill's
  `/home/<user>/renders/` and `/home/<user>/Pictures/`. The box's NPC user owns their home, and
  the game's `rm -r` asks only for write on the containing directory. A cracked NPC user could
  therefore remove the file's parent and lose the job for everyone without root. Every
  directory below is under a root-writable one (`/srv`, `/opt`, `/var`, `/etc`, `/root`), so
  decision 10 holds unchanged.
- **The item is one in six on `mission-file-item-<n>`.** Its name, directory and name parts are
  drawn on `mission-file-<n>`, as the firmware image's are now. The firmware image's draws are
  unchanged, so a file job that is still a firmware image keeps its name, path and bytes. The
  bytes of every item come from the HMAC of `file:<n>` under `MISSION_KEY_SECRET`, as now.
- **The six items:**

  | Item             | Keepers     | Name                          | Directories                               | Content                                                                       |
  | ---------------- | ----------- | ----------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
  | prototype render | designers   | `<code>-render-<stage>.jpg`   | `/srv/design/`, `/opt/cad/renders/`       | jpeg; Exif make and model a renderer's, artist a person's full name           |
  | site photo       | surveyors   | `IMG_<YYYYMMDD>_<HHMMSS>.jpg` | `/var/lib/uploads/`, `/srv/media/photos/` | jpeg; a camera from `CAMERAS`, taken at the name's moment, no artist          |
  | signed contract  | lawyers     | `<project>-<deal>-signed.pdf` | `/srv/legal/`, `/var/archive/contracts/`  | pdf; title `<Project> <Deal> (signed)`, author a person, created ≤ modified   |
  | firmware image   | engineers   | `<device>-fw-<version>.bin`   | `/opt/firmware/`, `/srv/releases/`        | as built: `FWIMG v<version> <device>`, then noise                             |
  | customer export  | salespeople | `customers-<YYYY>-<MM>.dat`   | `/var/backups/`, `/srv/exports/`          | `CUSTDB01`, then noise                                                        |
  | key ring         | admins      | `keyring.dat`                 | `/root/.vault/`, `/etc/<stem>/`           | `KEYRING v2`, then noise                                                      |

  - `<code>` is two lowercase letters and a digit (`vx7`). `<stage>` is one of `final`, `v2`,
    `v3`, `approved` and `review`.
  - `<project>` is one of `harbour`, `northgate`, `riverside`, `eastfield`, `millbank`,
    `westpier`, `oakridge` and `kingsway`. `<deal>` is one of `bid`, `lease`, `merger`,
    `supply` and `nda` (titled `NDA`).
  - The renderers are `Blender`/`Cycles`, `Luxion`/`KeyShot`, `Chaos`/`V-Ray` and
    `Autodesk`/`VRED Pro`. As in `CAMERAS`, each part is four characters or more with no
    decimal, so `strings` shows each alone.
  - Every date falls in the 300 days before `WORLD_EPOCH`, the window a share's documents are
    dated in. That covers the photo's moment, the contract's dates and the export's month. The
    photo's hour is 07–18. People are drawn from `core/generation/pools/people.ts`.
  - `<stem>` is the target's stem (`missionShape(n).stem`).
  - The noise after a header is 1,000–3,000 characters, as the firmware image's is.
  - A jpeg or pdf is as long as `renderDocument` makes it, measured at 470–1,300 characters.
    That is smaller than the grill's "about 1–3K", but the only limit size has to meet is the
    8,000 characters an attachment may be.
- **The pitches, four an item** (the firmware image keeps its own):
  - **Prototype render:**
    - "Their new product launches next month. We would like to see it before the press does."
    - "That design is ours. Their lead designer drew it here before leaving us."
    - "We are bidding against them for the same retailer. We need to know what they are
      pitching."
    - "An investor asked us whether they are as far along as they claim. We would like to
      answer."
  - **Site photo:**
    - "They swear the site was clean when the inspectors came. Their own photos will say
      otherwise."
    - "We are disputing their insurance claim. We want to see the damage as they saw it."
    - "They built on land we have a claim to. We need proof of when the work started."
    - "A buyer is asking about that site. We want to know what is really there before they
      do."
  - **Signed contract:**
    - "They undercut our bid by a margin nobody could make money on. We want to see the
      terms."
    - "Our partner signed with them behind our backs. We want the proof in writing."
    - "We think that deal breaks the exclusivity they promised us. We want to read it."
    - "Their lawyers are telling the court the deal never closed. The signed copy says it
      did."
  - **Customer export:**
    - "Their sales team keeps poaching our accounts. We want to know which ones are next."
    - "They are about to be bought, and their customer list is the price. We would like to
      know it first."
    - "We believe they are selling our customers' data. Their export will show whether our
      people are in it."
    - "A former employee took our client list to them. We want to see how much of it they
      kept."
  - **Key ring:**
    - "Their admins sign every release with those keys. We would like to be able to as well."
    - "They locked us out of systems we paid for. Their key ring opens them again."
    - "We sold them hardware and they still owe us. Their keys are worth the debt to us."
    - "Someone inside asked us to audit them without telling their bosses. Bring us the keys."

**Acceptance criteria**

1. A file job's item is drawn one in six on `mission-file-item-<n>`: across a spread of file
   jobs all six appear, each near a sixth. Nothing else a number draws moves: its kind, shape,
   LAN, pay and client are as before. A file job whose item is the firmware image keeps its
   name, path and bytes exactly.
2. Each item's name matches its pattern and its file sits in one of its two directories, both
   drawn from the number alone. The key ring's second directory is `/etc/<stem>/`. No item's
   path is under `/home`.
3. Each item's bytes are drawn from the secret:
   - the same number under another secret has other bytes, and the same number and secret the
     same bytes;
   - every item's file is at most 8,000 characters;
   - every item's file is made only of characters a copy carries unchanged: no NUL, and no
     control character except the pdf's line breaks.
4. `strings` of each item finds what its format gives up and nothing more:
   - a jpeg: `JFIF`, `Exif`, its make, model and date, and a render's artist;
   - a pdf: its structure and its Info title, author and dates;
   - a bin or dat: its header alone.

   A site photo's Exif date is the moment its name gives.
5. The server lays the item exactly as it lays the firmware image now: alone, at its path,
   mode 600 owned by root, behind the write gate.
6. The board offers `<Client> — retrieve a <noun> — §<pay>` (`an internal <noun>` on two-hop),
   its pitch one of that item's four, at a key job's pay.
7. The briefing reads "Their <keepers> keep a <noun>. Bring it to us. Its name is:", then the
   name alone, set off by blank lines. The rest is as built.
8. `hireme.ts show` prints `Kind: file, <noun>` and `File: <path>, <size> bytes`.
9. The client's replies are unchanged: the right bytes of any item complete the job.

**RED first:**

- `missionFileItem.test.ts` grows per item:
  - the spread of the draw, and the firmware image unchanged;
  - each name pattern, each directory pool, `/etc/<stem>/`, and nothing under `/home`;
  - secret-bound bytes, the 8,000 cap and the character range;
  - what `strings` finds, and the photo's Exif date matching its name.
- `missionTerms.test.ts`: each item's board noun and pitches.
- `contracts.test.ts`: each item's keepers.
- `missionLeak.test.ts`: an item other than the firmware image, laid root-only at its path and
  in `missionFilePaths`.
- `hiremeOrders.test.ts`: the item's noun.
- `clientMail.test.ts`: the bytes of an item other than the firmware image completing the job.

**Wire-check:** `scripts/testMissionFile.ts` re-picks its job as a signed contract, the one
format with line breaks. The round trip through the target, `mail -A` and the client then
proves the line breaks survive.

**PR-ready when:**

- the criteria pass, and `npm run typecheck`, `npm run lint` and the full suite are green;
- `testMissionFile` and every other `testMission*` wire-check pass;
- the mutation gate has run;
- the version is bumped (0.462.0), and the bundle's ceiling covers the change;
- the "File jobs" section of `missions-architecture.md` names the six items.
