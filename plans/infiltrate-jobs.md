# Plan: a contract that asks for a file slipped onto a machine

**Status:** Grilled 2026-11-16. Next: the slice plan.

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
