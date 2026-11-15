# Plan: mail carries a file, and a contract that asks for one

**Status:** Grilled 2026-11-15. Slice 1 merged (v0.460.0, #772). Slice 2 planned, on
`feat/file-jobs`.

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
