# Plan: World Content Slice 7 — Somebody Wrote to Somebody

**Epic:** `plans/world-content-epic.md`, slice 7. Grill record: the epic's "Locked decisions"
1–25, plus **eleven owner decisions taken at planning** (2026-09-23) and four rules derived from
precedent and confirmed. All are recorded under "Decided at planning" below and in the epic's
status log.

**Status:** Planned, not started.

**Delivery:** two independent PRs against trunk, in order. PR 7b starts once 7a merges.

| PR | Branch (proposed) | Version | Owns |
|---|---|---|---|
| 7a | `feat/somebody-wrote-to-somebody` | v0.255.0 | the network's correspondence, `/var/mail/<user>` on desks, the mail server's spool, the roster and delivery agreement with the mail database |
| 7b | `feat/a-mail-box-corroborates-itself` | v0.256.0 | `mail.log` + `mail.log.1`, `/etc/aliases` and the postfix config fixes, root's cron mail |

Each PR bumps `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

---

## Goal

A player who gets into a generated box finds mail that somebody really wrote to somebody. On a
desk, `/var/mail/<user>` holds that person's side of the network's correspondence. On a mail
server, `/var/mail` holds the whole organisation's — every inhabitant's mailbox and the shared
role mailboxes — and the thread read there is the same thread, message for message, that the
other end reads on their own machine. Every address is on the network's `.lan` zone, every host
in a `Received:` line is a machine `nmap` can find, and every date falls inside the box's life.

## Grounding (verified 2026-09-23, v0.254.0)

- **68 desks and 15 mail servers in the world.** Across the 50 catalog ESSIDs plus the 4
  uncatalogued ones: 281 LAN boxes and 163 deep. Desks (`desktop|laptop|workstation`) are 43 on
  LANs and 25 deep. Mail servers are 8 on LANs and 7 deep, on 11 distinct networks
  (OSCORP-GUEST, TYRELL-CORP ×3, SHINRA-5G ×2, CITY-PARK-WIFI, AIRPORT-LOUNGE-VIP, BOFH-KEEPOUT,
  NULL-BYTE, ACME-CORP, MIDNIGHT-DINER ×2, NIGHT-OWL-CAFE, LIBRARY-PATRON).
- **Not every mail server can be entered.** Of the 8 on LANs, 3 run sshd (`mx-136`, `relay-135`,
  `mx-159`); 3 run no service at all and are unreachable until the CVE arc. All 7 deep ones have
  sshd forced by `buildDeepHostFs`. So the spool is readable on about 10 of the 15 — the played
  run must pick one of those.
- **No mail server runs mysqld.** 54 mysql services exist in the world and none of them is on a
  mailserver-role box (mail takes the flat rate, `rolePlacement.ts:65` being empty by design). The
  roster and delivery agreements are therefore only observable on a synthetic box today — the same
  position slice 5 was in with the `mail` archetype, and it takes the same answer: build boxes of
  that archetype beside the world's.
- **A network has 3–8 distinct accounts, 5.0 on average** — the correspondence's cast.
- **The `mail` archetype already models the directory** (`pools/databaseApps.ts:817`):
  `mailboxes` (one per login plus 2–5 of `info`, `sales`, `support`, `billing`, `postmaster`,
  `office`, `accounts`, `user_id` NULL, local part only), `aliases` (an alias per mailbox), a
  required `delivery_log` (mailbox, `sender_name`, a subject from a fixed six, `size_kb`,
  `delivered_at`), and optional `spam_rules`. `databaseArchetype` returns `mail` for every
  mailserver hostname whether or not mysqld runs, so `generateApplication` can name the roster of
  a box that serves no database — exactly how slice 6's store reads its application.
- **The box already promises a spool it does not have.** `pools/configFiles.ts:123-131` gives
  mailserver boxes a `postfix.conf` drawn from five templates; they name `/var/spool/postfix`,
  `/var/mail/vhosts`, `alias_maps = hash:/etc/aliases` and `mynetworks = 10.0.0.0/24`. `/var` is
  assembled at `remoteHostFs.ts:549-558` from `log`, `run`, the datadir and the web root — there
  is no `/var/mail` anywhere in generation, and `/etc/aliases` does not exist. The `10.0.0.0/24`
  is nobody's network: LANs are `192.168.<subnet>.0/24` and deep layers `10.<x>.<y>.0/24`.
- **No mail door and no mail verb.** `SERVICE_CATALOG` has seven services and smtp is not among
  them; `availability.ts:41` records that legacy's `mail` command belongs to missions, post-ship.
  Mail is read with `cat` and `ls`, like every other content this epic has shipped.
- **`mail.log` does not exist.** `logHistory.ts:358-364` writes `syslog.1`, `auth.log.1`,
  `kern.log.1`, `access.log.1`, `mysql.log.1`, `redis.log.1` and `named.log.1`, though decision 10
  named `mail.log.1` among the rotations.
- **An inhabitant already has an address.** `persona.ts:55` — `Inhabitant = {fullName, email}`,
  `email` being `<username>@<lanZoneName(essid)>`, drawn on `inhabitant-<essid>-<ip>`.
- **The crontab is a real source of output.** `pools/etcFiles.ts:69-107`: generic jobs
  (`du -sh /var/log /home /root`, `fstrim -av`, `find … -size +100M`, `apt-get -qq update`, …)
  and per-service ones (`systemctl is-active sshd`, `redis-cli bgsave`, `du -sh /var/lib/mysql`).
  Some print and some are silent, which is precisely what decides whether cron mails root.
- **Budgets today:** bundle 173,240 B gzipped of a 284,975 B ceiling; 0.949 ms/box of a 2 ms
  ceiling.

## Scope boundary

**In:**
- **One correspondence per network**, drawn on a new `mail-network-<essid>` stream: threads
  between the network's real people, in the vocabulary of the network's archetype plus a personal
  layer.
- **`/var/mail/<user>` on every desk** (`desktop|laptop|workstation`, LAN and deep), user-tier,
  holding that person's slice of it as mbox.
- **The spool on every mailserver-role box**, root-only: a mailbox per entry in the box's
  application's `mailboxes` — every LAN login plus its 2–5 shared role mailboxes — agreed with
  the `mailboxes` table wherever mysqld runs, and with `delivery_log` naming the real messages.
- **`mail.log` (live, empty) and `mail.log.1`** on mailserver-role boxes, whose frozen lines are
  the deliveries the spool holds (PR 7b).
- **`/etc/aliases`** on mailserver-role boxes, matching the application's `aliases` table, plus
  the two config honesty fixes: `mynetworks` becomes the box's real CIDR, and the template that
  promises `/var/mail/vhosts` names the spool the box really keeps (PR 7b).
- **`/var/mail/root`, root-only**, on any NPC box whose own `/etc/crontab` holds a job that really
  prints something — cron's mail of that job's output (PR 7b).
- **`delivery_log` retires its six-subject pick list** and names real deliveries (PR 7a).

**Not built here, deliberately:**
- **No smtp/imap door.** `SERVICE_CATALOG`, `rolePlacement.ts` and every placement rate are
  untouched: a service is a door, and doors are the parity epic's business (decision 7).
- **No `mail` or `mailq` command** (decision 3). Legacy's `mail` belongs to missions.
- **No mailbox on phones, tablets, IoT or the player's own box.** Phones are slice 11; the player's
  box stays a fresh install (decision 6). There is nothing to buy, since there is no mail service.
- **No off-zone address anywhere** — no invented public domain (decision 20, X2's territory).
- **No attachment bodies.** A message may name a file on the network; `/srv` and metadata docs are
  slice 8.
- **No `Maildir`,** no `/var/spool/postfix` queue files, no `.gz` rotation (decision 3).
- **Site ↔ database agreement** stays deferred, as slices 5 and 6 left it.

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 2 | Inert. No message body contains a word from the password pools, or any in-game credential. Secret-shaped values for things outside the world stay allowed but have no reason to appear here. |
| 3 | The shipped surface only: mail is `cat`-ed and `ls`-ed. No new verb, no new service. |
| 4 | Every address, host, IP, `.lan` name and path a message names is real on the box's own network. People's names are not world references. |
| 5 / 22 | Every `Date:` is on or before 2026-07-11 23:59:59 and inside the box's seeded life; a reply follows the message it answers. |
| 6 | NPC boxes only. The player's workstation gets nothing. |
| 8 | The cast is the network's real inhabitants — `mrodriguez` writing as Maria Rodriguez — and the persona supplies the organisation's voice. |
| 9 | Mail is the row decision 9 already reserved: `/var/mail/<user>` on workstations, the organisation's spool on mail servers. |
| 10 | History lives in the rotation: `mail.log.1` holds the deliveries, the live `mail.log` starts empty. |
| 12 | The threads speak the archetype's business, as the database and the store already do. |
| 13 | Permissions follow Debian as far as three tiers allow: a desk's own mailbox is user-tier, the spool and root's mail are root-only. |
| 15 | `mail-network-<essid>` and `mail-box-<essid>-<ip>` are new streams. **No existing stream gains a draw**, so nothing re-rolls — no amendment this time. |
| 16 | The threads are static authored data, filled from the two personas. |
| 17 | Variety tested within and across networks. |
| 20 | Every address is `<local>@<essid-slug>.lan`. |
| 21 | Version-free: no `X-Mailer`, no versioned banner in any header. |
| 23 | Tree pins move deliberately; the truth rules become property tests. |

## Decided at planning (2026-09-23)

1. **Scope.** Desks get `/var/mail/<user>`; mailserver-role boxes get the network's spool; every
   NPC box whose crontab really produces output gets a short root-only `/var/mail/root`. Phones,
   tablets, IoT and the player's box get nothing. **Why:** this is the last slice that can put mail
   anywhere, and escalation should pay in content (decision 13).
2. **One correspondence per network.** `mail-network-<essid>` draws it once, as
   `db-app-network-<essid>` draws the network's archetype; a desk shows its user's slice and the
   spool shows everyone, so both ends of a thread agree message for message. **Accepted cost:**
   every desk derives the network's correspondence to keep its slice; if the per-box budget breaks,
   amended decision 19's memoization lands here.
3. **No new door; the log follows the role.** No smtp/imap in `SERVICE_CATALOG`. Mailserver-role
   boxes get `mail.log` and `mail.log.1` because the ROLE already asserts postfix — its
   `postfix.conf`, its `mailops`-family usernames, `mailq` in root's history, its A record in the
   zone — independently of whether a port is modelled.
4. **mbox, one file per mailbox**, on desks and on the server alike; the `postfix.conf` template
   promising `/var/mail/vhosts` is rewritten to name the real spool. **Rejected:** Maildir, and
   letting the spool shape follow whichever config template the box drew (two shapes to build,
   test and read).
5. **The roster is the application's**, read through `generateApplication` on
   `db-app-<essid>-<ip>` with the `mail` archetype: a mailbox per LAN login plus its 2–5 shared
   role mailboxes, pinned to agree with the `mailboxes` table wherever mysqld runs.
6. **Everything on-zone.** Every `From`/`To`/`Cc` is `<local>@<essid-slug>.lan`. Beyond
   person-to-person threads, the correspondence carries notices from machines that really exist —
   cron output from `root@<hostname>`, a backup report naming the real fileserver, a disk warning
   from a box `nmap` lists. **Rejected:** off-zone correspondents on invented public domains.
7. **Topics come from the network's archetype plus a personal layer.** `MAIL_SPECS` keyed by
   `ArchetypeKey` (15 entries, compile-enforced, as `STORE_SPECS` is) read from
   `networkArchetype(essid)`; the personal threads are keyed by the 7 persona categories, as
   `homeNotes.ts` already is.
8. **Volume:** 3–6 threads per mailbox, 1–4 messages each, bodies of 3–8 lines — roughly 80–200
   lines to a `cat`, there being no `LIMIT` and no `tail`.
9. **`/etc` tells the truth:** a real `/etc/aliases`, and `mynetworks` fixed to the box's own CIDR.
10. **Tiers:** a desk's mailbox is user-tier (guest stays out); the mail server's spool and every
    `/var/mail/root` are root-only, because three tiers cannot express per-user ownership and the
    reveal belongs behind the escalation.
11. **`delivery_log` names real deliveries** where a box holds both: a real correspondent, that
    thread's subject, that message's moment. Its six-subject pick list retires. **Rejected:**
    retiring the table, and leaving it to contradict the spool.

**Derived from precedent, confirmed at planning:**

12. **No decision-15 amendment and no re-roll.** Mail is new content on new streams; unlike slices
    5 and 6, no existing stream gains a draw, so no password, lock, page or key moves.
13. **Deep boxes follow slice 5's deep rule.** A deep box must stay byte-stable regardless of a
    hanging child, so it does not read its layer's population: its correspondents come from
    `usernamePool(role)` on its own zone, as a deep database's logins do. The shared correspondence
    is a LAN thing.
14. **The desk copy and the spool copy are not byte-identical**, so decision 17 needs no exemption:
    each carries its own true `Received:` / `Delivered-To:` chain naming the hosts that handled it.
15. **Headers are version-free**, dates end at the epoch, replies quote with `>` and carry
    `In-Reply-To`, and no body holds a word from the crackable pool.

---

## The correspondence

**The cast.** A network's people are its LAN's distinct accounts, each with the inhabitant
`persona.ts` already derives (`mrodriguez` → Maria Rodriguez, `mrodriguez@shinra-5g.lan`). Shared
role mailboxes belong to the mail server's own view, drawn from its application's `mailboxes`, so a
network with no mail server needs none. On a deep box the cast is drawn from `usernamePool(role)`
on the same zone, never read from the layer.

**A thread** is a subject, a participant set, and 1–4 messages in order: the opener, then replies
that quote the previous body with `>`. Each message carries a moment inside the application's life,
strictly after the message it answers, and the last of them is on or before 2026-07-11 23:59:59.

**What a mailbox looks like.** One mbox file, messages oldest first:

```
From mrodriguez@shinra-5g.lan Thu Jun 18 09:12:04 2026
Received: from laptop-74.shinra-5g.lan (192.168.167.74)
	by mx-101.shinra-5g.lan with ESMTP id 4A1C2E
	for <jchen@shinra-5g.lan>; Thu, 18 Jun 2026 09:12:04 +0000
Message-ID: <20260618091204.4A1C2E@shinra-5g.lan>
Date: Thu, 18 Jun 2026 09:12:04 +0000
From: Maria Rodriguez <mrodriguez@shinra-5g.lan>
To: Jia Chen <jchen@shinra-5g.lan>
Subject: Re: Friday's deploy
In-Reply-To: <20260617164400.9B3D1F@shinra-5g.lan>
Status: RO

> are we still pushing the release on Friday?

Not before the backups run. I moved it to Monday.
```

The `Received:` chain is the slice's quiet proof of decision 4: it names the sender's real machine,
the network's real mail server where one exists, and the box the file sits on — which is also what
keeps the two copies of one message from being byte-identical.

### What "true" means here (decision 4, applied)

- **Addresses:** every local part is a real account of the network or a shared mailbox of the
  box's roster; every domain is `lanZoneName(essid)`.
- **Hosts:** every hostname or IP in a `Received:` or `Delivered-To:` line is a machine on the
  box's own network — a LAN host for a LAN box, its own layer for a deep one.
- **People:** the display name is that account's inhabitant, the same one `.gitconfig` names.
- **Calendar:** `Date:` is RFC-5322, inside the application's life, ending at the epoch; a reply
  follows its parent; the mbox is ordered oldest first.
- **Inert:** no body holds a pool word, a credential, a `password:` line or an in-game secret.
- **Version-free, no unfilled slot** (`{{…}}`, `undefined`, `NaN`) in any header or body.
- **Anything a message names** — a file on the share, a host, a ticket number, a table — exists, or
  is outside the game and therefore fiction (decision 2).

---

## PR 7a — Somebody wrote to somebody

**Class:** behaviour change. **Required skills:** `tdd`, `testing` and `functional`, then
`refactoring` after green and `mutation-testing` at PR readiness.

**Value:** A player who `ssh`es into `laptop-74` on SHINRA-5G as `mrodriguez` and types
`cat /var/mail/mrodriguez` reads a thread she had with Jia Chen about Friday's deploy. `nmap`
shows `jchen`'s machine on the same LAN. Rooting `mx-101` and running `ls /var/mail` lists every
inhabitant plus `postmaster` and `info`; `cat /var/mail/jchen` shows the other side of that very
thread, with the mail server's own `Received:` line in it.

**Path:** `buildRemoteHostFs` / `buildDeepHostFs` → the network's people → `networkMail` (threads
on `mail-network-<essid>`, from `pools/mailThreads.ts` keyed by `networkArchetype`) → the box's
view on `mail-box-<essid>-<ip>` (a desk's own slice, or a mail server's roster from
`generateApplication`) → mbox rendering → `/var/mail` in the `var:` assembly → `cat` / `ls` at the
right tier.

### Acceptance criteria

- [ ] Every desk (LAN and deep, catalog and uncatalogued) holds `/var/mail/<its user>` with 3–6
      threads of 1–4 messages, readable by that box's user and root, never by guest.
- [ ] Every mailserver-role box holds `/var/mail/<local_part>` for every mailbox of its
      application — each LAN login plus its 2–5 shared role mailboxes — readable by root alone.
- [ ] Where a box runs mysqld with the `mail` archetype, `ls /var/mail` and `SELECT * FROM
      mailboxes` name exactly the same mailboxes, and every `delivery_log` row is a message that
      really sits in that mailbox: same sender, same subject, same moment.
- [ ] A thread that reaches two mailboxes reads the same in both — same subject, same message
      bodies, same `Message-ID`s, same order — differing only in its delivery headers.
- [ ] Every address in every mailbox is `<local>@<lanZoneName(essid)>` and names a real account of
      that network or a mailbox of that box's roster.
- [ ] Every host or IP in a `Received:` / `Delivered-To:` line is a machine on the box's own
      network. A deep box names no LAN host and no neighbour of its own layer.
- [ ] Every `Date:` is on or before 2026-07-11 23:59:59 and after the application's install; a
      reply is dated after the message it answers; messages are ordered oldest first.
- [ ] Inert and version-free: no pool word, no credential, no version, no unfilled slot, no
      address off the zone in any header or body.
- [ ] A deep box's mailbox is byte-stable regardless of what hangs below it.
- [ ] Nothing else moved: no existing stream gained a draw, and every password, service, page,
      database and store pin is unchanged.
- [ ] Variety: within one network no two mailboxes are byte-identical, and ≥ 90% of mailboxes are
      distinct across the catalog (numbers confirmed at implementation and recorded in the
      as-built). Every `MAIL_SPECS` entry and every personal-layer template is reachable.
- [ ] Budgets hold: bundle and per-box build time stay under their ceilings (`npm run build`).

**Evidence:**
- Property tests in a new `generation/mailbox.test.ts` over every desk and every mail server in the
  world, LAN and deep, plus synthetic mail servers of every archetype so no archetype goes
  untested — slice 5's `manyOfEach` lesson, and the only way to reach the mysqld-plus-mail case at
  all. Built inside each test, never a file-level cache, because of Stryker attribution.
- Wire-checks against `vercel dev` + supabase, as regression guards on a changed
  `buildRemoteHostFs`: `testSameLanConnect`, `testCrossPlayerRead`, `testDeepChainReach`, plus
  `testMysqlQuery` and `testMysqlDeep` for the `delivery_log` change.
- A played run via `v2-e2e` on a network with a reachable mail server (TYRELL-CORP `mx-136`,
  CITY-PARK-WIFI `relay-135` or NULL-BYTE `mx-159` on the LAN; any deep one otherwise):
  - `ssh` into a desk as its user, `cat /var/mail/<user>`, and confirm the correspondent is a
    person whose machine `nmap` shows.
  - `su root` on the mail server, `ls /var/mail`, and read the other end of the same thread.
  - Confirm guest cannot read a desk mailbox and a user cannot read the spool.

### Increments (TDD, one commit each after approval)

1. **The network's cast and its threads.** `networkMail(essid)` on `mail-network-<essid>`: people,
   threads, messages, moments. RED: participants are real accounts of the network; a reply is
   dated after its parent; the last message is on or before the epoch.
2. **A desk's mailbox.** mbox rendering plus the `/var/mail` branch in the `var:` assembly, at
   user tier. RED: a desk holds only the threads its user is in, its headers name real hosts, and
   guest cannot read it.
3. **The mail server's spool.** The roster from `generateApplication`, root-only, with the shared
   role mailboxes. RED: `ls /var/mail` equals the application's `mailboxes`, and a thread reads the
   same from both ends.
4. **The database agreement.** `delivery_log` names real messages; its pick list retires. RED: on a
   box holding both, every `delivery_log` row matches a message in that mailbox.
5. **Deep boxes.** Cast from `usernamePool(role)`, no read of the layer. RED: byte-stability with
   and without a child, and no LAN name anywhere in the file.
6. **The pools.** `pools/mailThreads.ts`: `MAIL_SPECS` for all 15 archetypes plus the
   category-keyed personal layer. RED: the archetype's vocabulary appears, every entry is
   reachable, and the sweeps — inert, version, slot, zone, calendar — plus the variety test.

---

## PR 7b — A mail box corroborates itself

**Class:** behaviour change. Same skills.

**Value:** The mail server's own records agree with its spool. `cat /var/log/mail.log.1` shows
postfix delivering the very messages `/var/mail` holds, at the same moments, to the same
addresses; `cat /etc/aliases` shows `postmaster` pointing at a real person, which is what the box's
`postfix.conf` said it would; and on a box whose crontab really prints something,
`cat /var/mail/root` holds cron's mail of that job's output.

**Path:** `buildLogHistory` gains the mail rotation, reading the spool the same way it already
reads the crontab and the served page → `buildEtcContent` gains `/etc/aliases` →
`pools/configFiles.ts` loses its two falsehoods → the root mailbox joins the `/var/mail` branch.

### Acceptance criteria

- [ ] Every mailserver-role box has an empty live `/var/log/mail.log` and a `mail.log.1` whose
      lines are the spool's own deliveries: the same addresses, the same moments, in order, all
      dated 2026-07-11 or earlier, with the live log's permissions.
- [ ] No box that is not a mail server has either file.
- [ ] Every mailserver-role box has `/etc/aliases`; every alias resolves to a mailbox that exists
      in `/var/mail`, and where mysqld runs it matches the `aliases` table.
- [ ] No generated `postfix.conf` names `10.0.0.0/24` or a path the box does not have:
      `mynetworks` is the box's own CIDR, and the virtual-mailbox template names the real spool.
- [ ] `/var/mail/root` exists exactly on boxes whose own `/etc/crontab` holds a job that prints,
      is root-only, and every message's `Subject:` names that job with a body that is its plausible
      output — `du -sh` sizes, `systemctl is-active sshd` answering `active`, `redis-cli bgsave`
      answering that saving started. A box whose jobs are all silent has no root mailbox.
- [ ] No existing stream gained a draw; slice 2's `/etc` pins and slice 3's log pins move
      deliberately and only where this PR changes them.
- [ ] Budgets hold.

**Evidence:**
- Tests extend `generation/mailbox.test.ts` and `generation/boxMemory.test.ts` (the log rotation)
  and `generation/boxSurface.test.ts` (`/etc/aliases` and the config fixes).
- Wire-checks: `testSameLanConnect`, `testCrossPlayerRead`, `testDeepChainReach`.
- A played run via `v2-e2e`: on the same mail server, `ls /var/log` then `cat mail.log.1` beside
  `cat /var/mail/<somebody>`; `cat /etc/aliases` and `cat /etc/postfix.conf`; and on a box with a
  printing cron job, `cat /var/mail/root` as root.

### Increments (TDD, one commit each after approval)

1. **`mail.log` and `mail.log.1`** from the spool, on mailserver-role boxes only.
2. **`/etc/aliases`**, agreed with the roster and with the `aliases` table.
3. **The config fixes:** `mynetworks`, and the template that promised `/var/mail/vhosts`.
4. **Root's cron mail**, on boxes whose crontab prints.

---

## Risks

- **The budget.** Every desk derives its network's correspondence, and 68 desks plus 15 mail
  servers pay for it. A network's threads are of the same order as an application's rows
  (~0.3 ms), so the estimate is a few tenths of a millisecond on 0.949 of a 2 ms ceiling — but
  this is the first per-network derivation a *desk* pays for, so it is measured at increment 2, not
  at the gate. If it breaks, amended decision 19's memoization lands here with its measured reason.
- **The bundle.** 15 archetype thread sets plus 7 categories of personal threads is the largest
  pool the epic has authored: an estimated +12–20 KB gzipped against ~112 KB of headroom.
- **Terminal length.** 3–6 threads is 80–200 lines to a `cat`, longer than any single file this
  epic has shipped. Confirmed against the real terminal in the played run; the volume drops if it
  reads badly.
- **The agreement is untestable in the live world.** No mail server runs mysqld today, so the
  roster and `delivery_log` claims rest on synthetic boxes. A future re-roll (slice 9's prefix
  growth) may produce a real one, which is exactly why the agreement is pinned now.
- **Three unreachable mail servers.** `mx-101`, `mx-64` and `mail-120` run no service at all, so
  their spools cannot be read until the CVE arc. That is placement, not content, and it stays as
  it is (decision 7).
- **`/etc` and log pins move.** Slice 2's role-config tests pin `postfix.conf` bodies and slice 3's
  pin the rotation set; both move deliberately in PR 7b (decision 23).
