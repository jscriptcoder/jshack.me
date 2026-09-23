# Plan: World Content Slice 8 — A Share Holds a Department

**Epic:** `plans/world-content-epic.md`, slice 8. Grill record: the epic's "Locked decisions"
1–25, plus **four owner decisions and eleven confirmed recommendations** taken at planning
(2026-09-23). After the fourth answer the owner said "from now on, go with your recommendation",
then confirmed the whole set as shared understanding. All are recorded under "Decided at planning"
below and in the epic's status log.

**Status:** Planned, not started.

**Delivery:** two independent PRs against trunk, in order. PR 8b starts once 8a merges.

| PR | Branch (proposed) | Version | Owns |
|---|---|---|---|
| 8a | `feat/a-share-holds-a-department` | v0.257.0 | `/srv` on every fileserver, the document formats, the category × prefix pools, tiers, the `vsftpd.conf` honesty fixes |
| 8b | `feat/a-share-corroborates-itself` | v0.258.0 | `vsftpd.log.1` uploads, the `/srv` mount in `fstab`, `/etc/vsftpd.userlist`, root's fileserver history made true |

Each PR bumps `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

---

## Goal

A player who reaches a generated fileserver finds a share an organisation really kept. On a
corporate `share-` box, `/srv/share` holds its departments; on a café's `backup-` box,
`/srv/backup` holds dated snapshots of the menus, rotas and invoices; on a family's `nas-` box, the
household's paperwork and photos. The documents are the real formats: `cat` on a PDF is noise with
fragments, and `strings` pulls out who wrote it — a person who really lives on that network, whose
mail the mail server keeps. In 8b the box itself agrees: its transfer log shows that person's
machine uploading that exact file, to the byte.

## Grounding (verified 2026-09-23, v0.256.0)

- **65 fileservers in the world.** 44 on LANs across 31 of the 54 networks (50 catalog + 4
  uncatalogued), 21 deep. Prefixes on the LAN: `backup` 14, `vault` 11, `share` 8, `files` 6,
  `nas` 5. By category: corporate 15, residential 9, café 6, public 5, IoT-factory 4, university 3,
  hacker 2.
- **Doors.** 40 of the 44 LAN fileservers run vsftpd, 15 run sshd; 20 of the 21 deep ones run
  vsftpd, and every deep box has sshd forced by `buildDeepHostFs`. The account is a service name
  (`ftpuser`, `storage`, `sysadmin`, `fileadm`, `archive`, `rsync`, `datamgr`, `shareuser`), never
  a person (`pools/usernames.ts:110`).
- **A fileserver holds no `/srv` today.** Its tree is the slice 2/3/7 surface: `/etc` (with
  `vsftpd.conf`), `/root`, `/home/guest`, logs, `/var/mail/root` where cron prints. The account's
  home is empty. There is no `/srv` anywhere in generation.
- **The ftp door reaches `/srv` as it stands.** `ftp <host> [user]` authenticates against the box's
  `/etc/passwd` (guest included) and lands in the account's home (`ui/state.ts`
  `enterFtpSession` → `homeDirectory(session)`), not a `local_root`. `ls`/`cd` run the shell's own
  tier-checked walker over the remote tree, so `cd /srv` works wherever the tier allows. `get`
  copies a file onto the player's own box, where `strings` (guest-tier, `any-machine`) reads it.
  **The observable needs no door change.**
- **`get` reports `content.length`** as the byte count (`ftpShell.ts:137,142`), and the transfer
  line records the same number. A string's length is the only byte count this world keeps.
- **Stubs must be NUL-free.** A file `get` copies is persisted to the patch store's Postgres TEXT
  column, which rejects U+0000 (`binaries.ts` `STUB_HEADER` records it).
- **`strings`** keeps runs of ≥ 4 characters in `0x20–0x7E` plus tab and newline, trimmed
  (`commands/strings.ts`). Noise built only from characters outside that set contributes nothing,
  so every readable run inside a stub is exactly what `strings` shows.
- **`vsftpd.conf` lies three ways** (`pools/configFiles.ts:106-115`): template 3 claims
  `anonymous_enable=YES` with `anon_root=/srv/ftp/pub` (there is no anonymous door); template 1
  claims `chroot_local_user=YES` (the door jails nobody); template 4 claims
  `local_root=/srv/share` (the door lands in the home). Template 2 names
  `userlist_file=/etc/vsftpd.userlist`, which no box has.
- **Root's fileserver history names daemons the world does not run** (`pools/rootContent.ts:144`):
  `smbstatus`, `testparm` (samba), `exportfs -v` (nfs), `zpool status` (zfs) — exactly what
  `usernames.ts`'s header already forbids for account names.
- **`fstab` draws on `etc-content-`** (`etcContent.ts:71`): a `/` line, a `/boot` line at 0.4, a
  swap line at 0.75, each with a drawn UUID. A `/srv` line may not draw there.
- **`vsftpd.log` is live and empty; there is no `vsftpd.log.1`.** `formatVsftpdTransferLine`
  (`logging/vsftpdLog.ts:99`) already renders `… [user] OK UPLOAD: Client "<ip>", "<path>", <n>
  bytes` with no decimal in it; the live log's permissions read `root|user|guest`.
- **The cast already exists.** Slice 7's `peopleOn` (`networkMail.ts:131`) is the LAN's accounts
  with their `inhabitant()` full names and machines; a deep box's people are its own application's
  logins (`boxMail`, `networkMail.ts:320`), because a deep box may not read its layer.
- **11 of the 31 networks with a fileserver have no desk**, so authors cannot be desk owners only.
- **The version sweep** (`softwareVersionsIn`, `src/test/worldContent.ts:126`) is applied per
  surface; binaries are not swept (`GLIBC_2.2.5` lives in every ELF stub).
- **Budgets today:** bundle 193,843 B gzipped of a 284,975 B ceiling; 0.617 ms/box of 2 ms.

## Scope boundary

**In:**
- **`/srv` on every fileserver-role box**, LAN and deep, whether or not vsftpd runs.
- **Document stubs** in three families: PDF and JPEG with readable metadata; `.docx`/`.xlsx` as
  faithful zips that give up member names only.
- **Plain text a department keeps** — `.txt`, `.csv`, `.md` — beside the documents.
- **Category decides the content, prefix decides the shape**: a working tree on
  `share-`/`files-`/`nas-`, dated snapshots on `backup-`/`vault-`.
- **`vsftpd.conf` stops claiming** an anonymous door, a chroot and a `local_root` (PR 8a).
- **`vsftpd.log.1`** on every LAN fileserver that runs vsftpd, holding the share's uploads (PR 8b).
- **`/etc/fstab` mounts a data disk at `/srv`**, **`/etc/vsftpd.userlist`** exists, and **root's
  fileserver history** names only what the box has (PR 8b).

**Not built here, deliberately:**
- **No new door and no door change.** No anonymous ftp, no `local_root` landing, no chroot, no
  smb/nfs service (decision 7; the parity epic owns doors).
- **No new verb** — no `tar`, `unzip`, `exiftool`, `file`, `wc` (decision 3).
- **No archive files.** No `.tar`, `.gz` or `.zip` other than the office formats; backups are
  directories.
- **No new pointer into the share from existing pools.** Adding lines to the desk-history, notes or
  mail pools would re-roll homes and mailboxes already shipped. The share is found where Debian puts
  it, through `fstab` and root's history (8b).
- **No shares on database boxes** that run ftp, nor on any other role (decision 7: content fits
  what the box is).
- **No deep transfer history.** A deep box names no neighbour (slice 2's rule), and its only people
  have no machine but itself.
- **No loot.** Decision 2 holds: no document names a working secret.

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 2 | Inert. No document, text file or metadata field holds a pool word or any in-game credential. |
| 3 | The shipped surface only: `ls`, `cat`, `strings`, `grep`, ftp's `get`. No new verb, no archive a verb would open. |
| 4 | Every host, IP, `.lan` name and path a file names is real on the box's own network. |
| 7 | No new role or door; the share goes where the role says a share is. |
| 8 | The people are the network's own, and the persona supplies the organisation's voice. |
| 9 | Fills the `/srv` and "Metadata docs" rows — **amended**: office files hide their author, and backups are directories, not archives. |
| 13 | `/srv` is world-readable, as Debian's is; rotated logs copy their live log's permissions. |
| 15 | New streams only; template text edits and in-place history swaps move no draw. |
| 16 | Folder names, file names and text bodies are static authored data, filled from the persona. |
| 17 | Variety tested within and across networks; unchanged files across snapshots are shared by design. |
| 20 | Any address in a document is on the network's `.lan` zone. |
| 21 | Version-free, except a document's format signature, which is a format and not software. |
| 22 | Every date in a document, snapshot or log line falls within the box's life, before the epoch. |
| 23 | Tree pins move deliberately; truth rules become property tests. |

## Decided at planning (2026-09-23)

**By the owner:**

1. **Every fileserver-role box gets a `/srv`**, LAN and deep (44 + 21), whether or not ftp is up.
   **Why:** data describes the box, and a daemon being down does not delete the share (slice 7b's
   rule). On the 4 LAN fileservers without vsftpd, the share is a root or ssh find.
   **Rejected:** only ftp-serving fileservers (a `nas-` with no daemon would read as an empty NAS);
   any box running ftp (spreads shares onto database boxes).
2. **Documents are binary-shaped, NUL-free imitations of the real format**, as `STUB_HEADER` is for
   ELF: the real signature, non-printable runs standing in for compressed streams, and the readable
   structure a real file carries. The document surface's version sweep skips the format signature
   (`%PDF-1.7`); producer and creator names are version-free (`LibreOffice`, never
   `LibreOffice 7.4`). **Rejected:** plain text with a `.pdf` name (then `strings` shows what `cat`
   shows and proves nothing); a bare `%PDF-` with no version (a broken header to anyone who knows).
3. **PDF and JPEG carry metadata `strings` reads; `.docx`/`.xlsx` are faithful zips whose
   `strings` shows member names only, never the author** — Word deflates `docProps/core.xml`, and
   a real `strings` on a real docx finds no author. **Amends decision 9's wording.** **Rejected:**
   all three leaking the author (wrong in a way anyone who has done it spots); no office files (a
   department share with no spreadsheet reads thin).
4. **The network's category decides what a share holds; the hostname prefix decides its shape.**
   `share-`/`files-`/`nas-` hold a working tree; `backup-`/`vault-` hold dated snapshots of the same
   kind of tree. **Rejected:** category only (the prefix would be a label nothing backs); one
   corporate tree everywhere (a family NAS full of NDAs is the legacy failure).

**Recommended and confirmed:**

5. **Paths.** A working tree at `/srv/share/<folder>/…`; snapshots at
   `/srv/backup/<YYYY-MM-DD>/<folder>/…`, 2–4 of them, each the tree as it stood that day, later
   ones adding and changing a few files. **No archive files** — a `.tar`/`.gz` implies a verb nobody
   has, as decision 10 reasoned for logs, and real rsync-style backups are directories. **Amends
   decision 9's "backup archives".**
6. **Authors are the network's own people.** On a LAN box, the roster slice 7's mail uses — every
   LAN account with its `inhabitant()` full name — so a PDF's `/Author` is findable in that
   person's mail headers, and in their `.gitconfig` where they have a desk. On a deep box, its own
   application's logins, by slice 7's deep rule. A JPEG's `Artist`, when set, follows the same rule;
   its `Make`/`Model` come from the network's own phones where it has any (Apple, Google, Samsung)
   and from a camera pool otherwise. No model name carries a decimal.
7. **One calendar.** `CreationDate` ≤ `ModDate` < `WORLD_EPOCH`; a snapshot is dated before the
   epoch and no file inside it is dated after the snapshot.
8. **Plain text beside the documents.** `.txt`, `.csv`, `.md` a department really keeps — rotas,
   inventories, minutes, READMEs — inert. **Volume:** 25–60 files in `/srv` on a working share,
   ≤ ~80 across all snapshots on a backup box.
9. **Tiers.** Every tier reads `/srv` and its directories traverse for every tier; root and the
   box's one account write it, because that account is who uploaded everything. A `guest` ftp login
   therefore reaches the observable. The account's home stays empty.
10. **`vsftpd.conf` stops lying**, in place, so the pick index does not move: template 3 says
    `anonymous_enable=NO` and loses `anon_root`; template 1 loses `chroot_local_user`; template 4
    loses `local_root`. Each keeps its shape by gaining a setting the box honours or one that
    describes nothing checkable. **The door is not changed.** Template 2's
    `userlist_file=/etc/vsftpd.userlist` becomes true in PR 8b.
11. **The share corroborates itself (PR 8b):** `vsftpd.log.1` on every LAN fileserver running
    vsftpd, with each share file's upload
    `[<account>] OK UPLOAD: Client "<the author's machine>", "<path>", <content.length> bytes`,
    dated with the document; a `/srv` data-disk line in `/etc/fstab` whose UUID is drawn on the new
    stream; `/etc/vsftpd.userlist` naming the account at `ALIASES_FILE`'s tier (every line an
    account name); root's fileserver history lines naming samba, nfs or zfs replaced in place with
    `/srv`-true ones. Deep shares take no transfer history.
12. **Streams.** New ones only: `share-<essid>-<ip>` (8a) and `share-log-<essid>-<ip>` (8b).
    Proven by the whole-world byte-diff with every differing path classified.
13. **Variety.** Within a network no two shares hold a byte-identical document outside the snapshot
    exemption; across the catalog ≥ 90% of shares have distinct file-name sets and ≥ 90% of text
    bodies are distinct (confirmed at implementation, recorded in the as-built).
14. **No new pointers into the share from existing content** (see "Not built here").
15. **Two PRs, shaped as slice 7's were**; bundle target ≤ ~25 KB gzipped of ~91 KB headroom.

**Derived from precedent:**

16. **No decision-15 amendment and no re-roll.** The share is new content on new streams. The
    template edits (10) and history swaps (11) change text at unchanged pick indices, so they
    move only the files they are in — the same ripple class as slice 7b's `.bash_history` line.

---

## The share

**What decides it.** `networkPersona(essid).category` picks the department set; the prefix picks
working tree or snapshots. Indicative folders:

| Category | Folders a share holds |
|---|---|
| corporate | `finance/`, `hr/`, `legal/`, `sales/`, `it/`, `marketing/`, `facilities/` |
| café | `menus/`, `rota/`, `suppliers/`, `invoices/`, `inspections/`, `photos/` |
| residential | `paperwork/`, `taxes/`, `house/`, `school/`, `photos/`, `recipes/` |
| university | `research/`, `theses/`, `lectures/`, `admin/`, `grants/` |
| public | `minutes/`, `planning/`, `notices/`, `budgets/`, `maintenance/` |
| hacker | `talks/`, `zines/`, `writeups/`, `meetups/`, `photos/` |
| iot-factory | `datasheets/`, `qa/`, `certification/`, `manuals/` |

A share draws 3–6 of its category's folders and fills each with 3–10 files from that folder's pool
of names and bodies.

**The formats.** All NUL-free; noise uses only characters `strings` does not keep, so every
readable run is deliberate.

- **PDF** — `%PDF-1.7`, a binary comment line, object headers, a `stream … endstream` of noise, and
  an Info dictionary:
  `<< /Title (Q2 budget) /Author (Maria Rodriguez) /Creator (Writer) /Producer (LibreOffice)
  /CreationDate (D:20260402102902Z) /ModDate (D:20260409163015Z) >>`, then `xref`, `trailer`,
  `startxref`, `%%EOF`. No number with a decimal point anywhere (`/MediaBox [0 0 595 842]`).
- **JPEG** — the SOI/APP0 markers with `JFIF`, an APP1 `Exif` block holding `Make`, `Model`,
  `DateTimeOriginal` (`2026:04:02 10:29:02`) and, when set, `Artist`; then noise. **No `Software`
  tag** — on a phone it is an OS version.
- **`.docx` / `.xlsx`** — `PK` local headers naming `[Content_Types].xml`, `_rels/.rels`,
  `docProps/core.xml`, `docProps/app.xml` and `word/document.xml` (or `xl/workbook.xml`,
  `xl/worksheets/sheet1.xml`, `xl/sharedStrings.xml`), each followed by noise, then a central
  directory repeating the names. **No author, title or body text is readable.**

### What "true" means here (decision 4, applied)

- **People:** every `/Author` and `Artist` is a person of the box's cast (LAN roster or, deep, the
  box's own application's logins), spelled as `inhabitant()` spells them.
- **Devices:** a JPEG's `Make`/`Model` names a phone on the network where it has one.
- **Calendar:** every date — metadata, snapshot directory, log line — is before `WORLD_EPOCH`, and
  creation precedes modification precedes the snapshot holding it.
- **Inert:** no pool word, credential, `password:` line or in-game secret in any file.
- **Version-free, no unfilled slot** in any readable run, except the PDF signature.
- **Anything a file names** — a host, a person, another file on the share — exists.

---

## PR 8a — A share holds a department

**Class:** behaviour change. **Required skills:** `tdd`, `testing` and `functional`, then
`refactoring` after green and `mutation-testing` at PR readiness.

**Value:** A player on a corporate network runs `ftp share-12 guest`, `cd /srv/share/finance`,
`get q2-budget.pdf`, `quit`, then `strings q2-budget.pdf` and reads `/Author (Maria Rodriguez)`.
Maria Rodriguez is a real person of that network — `grep` on the mail server's spool finds her.
`strings` on `headcount.xlsx` beside it gives up `docProps/core.xml` and nothing about who wrote
it. On a café's `backup-` box, `ls /srv/backup` lists three dated snapshots of its menus and rotas.

**Path:** `buildRemoteHostFs` (and so `buildDeepHostFs`) → for a fileserver-role hostname →
`buildShare` on `share-<essid>-<ip>` → category from `networkPersona`, shape from the prefix, cast
from `peopleOn` (LAN) or the application's logins (deep) → pool entries → format renderers → a
`srv:` branch at the tree's top level → `ls`/`cat`/`strings`/ftp `get` at the right tier.

### Acceptance criteria

- [ ] Every fileserver-role box, LAN and deep, catalog and uncatalogued, holds `/srv`; no other box
      does.
- [ ] `share-`/`files-`/`nas-` boxes hold `/srv/share/<folder>/…` with 25–60 files;
      `backup-`/`vault-` boxes hold 2–4 `/srv/backup/<YYYY-MM-DD>/` snapshots, ≤ ~80 files in all,
      each dated before the epoch and holding no file dated after it.
- [ ] The folders a share holds are its network category's.
- [ ] Every `.pdf` gives up, through `strings`, a `/Author` naming a person of the box's cast, a
      `/Title`, and creation and modification dates in order before the epoch.
- [ ] Every `.jpg` gives up `Make`, `Model` and `DateTimeOriginal`; `Artist`, where present, names a
      person of the cast; on a network with phones, the make and model are one of theirs.
- [ ] Every `.docx`/`.xlsx` gives up its zip member names and **no person's name and no title**.
- [ ] Every stub is NUL-free, and `cat` on it prints noise with fragments rather than the metadata
      alone.
- [ ] Every tier reads `/srv`; guest cannot write it; the account can.
- [ ] No generated `vsftpd.conf` claims `anonymous_enable=YES`, `anon_root`, `chroot_local_user`
      or `local_root`.
- [ ] Inert, version-free (the PDF signature excepted), no unfilled slot, every date on the
      calendar.
- [ ] A deep share is byte-stable regardless of what hangs below its gateway.
- [ ] Nothing else moved: the whole-world byte-diff shows only `/srv` and the edited
      `vsftpd.conf` bodies.
- [ ] Variety as decision 13 of this plan; every folder and file pool entry is reachable.
- [ ] Budgets hold (`npm run build`).

**Evidence:**
- Property tests in a new `generation/share.test.ts` over every fileserver in the world, LAN and
  deep, plus synthetic fileservers of every category × prefix pair so none goes untested. Built
  inside each test, never a file-level cache (Stryker attribution). The metadata claims are read
  **through the `strings` command's own run extraction**, not a regex over the raw content, so the
  test says what a player sees. The expected category → folders mapping is **restated in the test**,
  never imported from the pool (the self-referential-test lesson).
- `boxSurface.test.ts` for the `vsftpd.conf` fixes; `remoteHostFs.test.ts` tree pins moved
  deliberately.
- Wire-checks against `vercel dev` + supabase as regression guards on a changed
  `buildRemoteHostFs`: `testSameLanConnect`, `testCrossPlayerRead`, `testDeepChainReach`, plus
  `testFtpRemoteRead` and `testFtpTransferTrace`, because `get` of a stub persists to the patch
  store — the NUL-free claim is only proven there.
- A played run via `v2-e2e` on a visible network with an ftp-serving fileserver: `ftp <box> guest`,
  `cd /srv`, `ls`, `get` a PDF and an `.xlsx`, `quit`, `strings` both; then find the author in the
  network's mail. Confirm guest cannot `put` into `/srv`.

### Increments (TDD, one commit each after approval)

1. **The formats.** PDF, JPEG and office-zip renderers from a metadata record. RED: through
   `strings`, a PDF yields its author, title and dates; a JPEG its EXIF; a docx its member names and
   no author; every stub is NUL-free and `cat` shows noise.
2. **A working share.** `buildShare` on `share-<essid>-<ip>` for `share-`/`files-`/`nas-`, the
   `srv:` branch, `SHARE_DIR`/`SHARE_FILE` tiers. RED: every such box holds `/srv/share`, its
   folders are its category's, its authors are its cast, and guest reads but cannot write.
3. **Snapshots.** `backup-`/`vault-` shape. RED: 2–4 dated snapshots, calendar ordering, later
   snapshots extending earlier ones, volume bound.
4. **Deep shares.** Cast from the box's application's logins. RED: byte-stability with and without
   a child; no LAN name in any file.
5. **The pools.** Folder and file pools for all seven categories, plain-text bodies, the camera and
   phone models. RED: every entry reachable; inert, version, slot and calendar sweeps; variety.
6. **`vsftpd.conf` honesty.** RED: no template claims an anonymous door, a chroot or a
   `local_root`.

---

## PR 8b — A share corroborates itself

**Class:** behaviour change. Same skills.

**Value:** The fileserver's own records agree with its share. `cat /var/log/vsftpd.log.1` shows the
account receiving `q2-budget.pdf` from Maria Rodriguez's machine on the day the PDF says it was
last saved, and the byte count on that line is the one `get` prints. `cat /etc/fstab` mounts a data
disk at `/srv`. Root's `.bash_history` runs `du -sh /srv/share`, not `smbstatus`.

**Path:** `buildLogHistory` gains the vsftpd rotation, reading the share `buildShare` built (one
derivation, as the spool and `mail.log.1` are) → `fstab` gains a `/srv` line from
`share-log-<essid>-<ip>` → `/etc/vsftpd.userlist` beside `vsftpd.conf` → `pools/rootContent.ts`'s
fileserver lines rewritten in place.

### Acceptance criteria

- [ ] Every LAN fileserver running vsftpd has `vsftpd.log.1` holding one upload per file on its
      share — the account, the author's machine's IP, the file's path and its exact
      `content.length` — ordered, dated at the file's modification time, before the epoch, with the
      live log's permissions.
- [ ] A deep fileserver, and a LAN fileserver without vsftpd, has no `vsftpd.log.1`.
- [ ] Every fileserver's `/etc/fstab` mounts `/srv`; no other box's does.
- [ ] Every box whose `vsftpd.conf` names `userlist_file=/etc/vsftpd.userlist` has that file naming
      its account, at `ALIASES_FILE`'s tier.
- [ ] No fileserver's root history names samba, nfs or zfs.
- [ ] Nothing else moved (the byte-diff shows only `vsftpd.log.1`, `fstab` on fileservers, the
      userlist and root's history on fileservers); budgets hold.

**Evidence:**
- Tests extend `share.test.ts`, `boxMemory.test.ts` (the rotation; `vsftpd.log.1` spans the share's
  life, not a day — named beside `mail.log.1` as the second spanning exception, or the day rule
  refuses it), and `boxSurface.test.ts` (`fstab`, userlist, root history).
- Wire-checks: `testSameLanConnect`, `testCrossPlayerRead`, `testDeepChainReach`.
- A played run: on the same fileserver, `get` a file and compare the byte count with its line in
  `vsftpd.log.1`; `nmap` the client IP and find the author's machine.

### Increments (TDD, one commit each after approval)

1. **`vsftpd.log.1`** from the share, on ftp-serving LAN fileservers only.
2. **The `/srv` mount** in `fstab`, UUID from the new stream.
3. **`/etc/vsftpd.userlist`** where the config names it.
4. **Root's fileserver history** made true, in place.

---

## Risks

- **`vsftpd.log.1` is a second spanning rotation.** Slice 7b made `mail.log.1` the named exception
  to `boxMemory`'s one-day rule. A share's uploads span months, so this is a second, and the test
  names it the same way rather than loosening the rule. A one-day rotation would show almost
  nothing and the corroboration would mostly go.
- **Non-ASCII noise and the byte count.** Noise characters above `0x7E` are one JS code unit but
  two UTF-8 bytes. The log and `get` agree because both measure `content.length`, and nothing in
  the game counts real bytes. Noise may be kept to `0x01–0x08`, `0x0E–0x1F` and `0x7F` to make the
  question moot — decided at increment 1.
- **Patch-store round trip.** A `get` writes the stub to Postgres through JSON. Control characters
  survive both, but only the ftp wire-check proves it; it runs in 8a, not at the gate.
- **The bundle.** Seven categories of folders and file bodies is the second-largest pool after
  slice 7's threads: an estimated +12–20 KB gzipped against ~91 KB of headroom.
- **Terminal noise.** `cat` on a stub prints control characters. The ELF stubs already do; confirm
  in the played run that the terminal renders them without breaking the line layout.
- **Unreachable shares.** 4 LAN fileservers run no vsftpd; those that also run no sshd are
  reachable only after the CVE arc. That is placement (decision 7), and stays.
- **Pins move.** `vsftpd.conf` bodies (8a), `fstab` and root history on fileservers (8b), and the
  top-level directory list of a fileserver's tree — all deliberately (decision 23).
