# Plan: mail carries a file, and a contract that asks for one

**Status:** Grilled 2026-11-15. Slice plan to follow. Nothing is built.

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
