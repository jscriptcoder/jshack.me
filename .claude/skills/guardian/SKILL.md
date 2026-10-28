---
name: guardian
description: Run the guardian's round over jshack.me's public web on production — report which public websites are behind on their fixes and which a player has tampered with, let the owner pick the boxes to restore, restore exactly those, and patch the rest. Use when the owner invokes /guardian (optionally naming domains to narrow the round) or asks for a guardian round on prod.
---

# The guardian's round

The owner is the valley's guardian: on rounds they choose to make, the public web is looked
over, patched as a root `apt upgrade` would, and the boxes players have tampered with are
restored. A round is ONE script, `scripts/guardian.ts`, run against production. What each
command does, and why, is in the script's header and `docs/handbook/12-build-deploy-operate.md`
("Data fixes").

Rounds are manual only. Never schedule one, and never run one the owner did not ask for.

## The only command

From the repo root, with no `cd` prefix (the allow rule matches the command exactly):

```
npx dotenv -e .env.production.local -- npx tsx scripts/guardian.ts <report|patch|restore> [name…]
```

- `report [name…]` reads and writes nothing. Run it freely.
- `patch [name…]` closes holes, gives every account on each box a fresh password, and evicts
  nobody. Run it freely, as step 5 says. Nobody sees the new words, the owner included: a
  password round is what keeps the bundle's seeded passwords from opening the public web.
- `restore <name…>` ends every session on the box and wipes its journal. Run it ONLY on the
  boxes the owner picked in this round, by name, never with a name they did not pick.

Run nothing else against production: no ad-hoc read, no SQL, no other script. Never print,
echo or read any part of `.env.production.local`; the key in it is a secret.

A name is a public website's domain (`millbrook.gov`, `kwikemart.com`, `findit.io`) or
`boards.hireme.io`. With no name, `report` and `patch` cover the patrol: every fixed box, then
each `government` and `public` network's site, 52 boxes.

## The round

1. **Report.** Run `report` with the names the owner gave, or none. Check the header line
   reads `Looking over N boxes on aqoarbmstducbnxmhxxx.supabase.co`. Any other host means the
   wrong database: stop and say so.
2. **Show the owner what it found.** Every tampered box, with its whole line (the open
   sessions and every path written are the intruder's trail), then the total line. Boxes that
   are only behind need no listing; their count is in the total.
3. **Ask which tampered boxes to restore.** "None" is an answer, and so is a subset: a defaced
   page left standing for a while is part of the story. A bricked box comes back only through a
   restore, so say which ones are bricked. With four or fewer tampered boxes, ask with a
   multi-select question; with more, list them and ask the owner to name the picks.
4. **Restore the picks**, all in one `restore` run naming exactly them. With no picks, skip
   this step.
5. **Patch** with the same names as the report, or none. A box just restored reads
   `up to date`, and its passwords change once more.
6. **Tell the owner** the three totals: what the report found, what was restored, and what the
   patch moved (its last line).

If any run exits non-zero, stop the round there and show the owner the line that says why
(exit 2: the order was refused before anything was read; exit 1: a database error, naming the
box and the step; every box before it is done, and a rerun is safe).

## Reading a report line

```
findit.io: 11 packages behind
flyridgemont.com: up to date
millbrook.gov: 11 packages behind, tampered (2 open sessions: root, www-data; 3 paths written: /etc/passwd, /var/log/auth.log, /var/www/html/index.html)
ridgemontparks.gov: bricked, tampered (1 path written: /boot)
Looked over 52 boxes: 49 behind, 2 tampered, 1 bricked.
```

- **Behind** is how many packages `patch` would move today. A hole whose fix has not shipped
  stays open until a later round; the patch line says when it is due.
- **Tampered** is an open session on the box (the account it was opened as), a write that is
  not the box's own log line or the guardian's (a player's, a wiped log or their own `passwd`
  included, or a database rewritten through its port), or a brick. A visit's log lines are never
  tampering.
- To read a defaced page before choosing, visit it in the game (`curl`); the round itself
  reads nothing more than the report.
