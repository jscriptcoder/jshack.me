# Plan: World Content Slice 11 — A Phone Is a Phone

**Epic:** `plans/world-content-epic.md`, slice 11 (the last of the spine). Grill record: the epic's
"Locked decisions" 1–25, plus **thirteen decisions** (2026-09-25, owner-delegated and confirmed as
a set) recorded in the epic's status log and restated under "Decided at planning" below.

**Status:** Planned, not started.

**Delivery:** one independent PR against trunk.

| PR | Branch | Version | Owns |
|---|---|---|---|
| 11 | `feat/a-phone-is-a-phone` | v0.264.0 | tablet models; a maker-shaped home on every NPC phone and tablet (photos, downloads, notes) |

The PR bumps `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).

---

## Goal

A player who gets into an NPC phone or tablet finds a device, not a Linux user's home. `ls ~` on an
`android-` shows `DCIM/`, `Download/`, `Documents/` and the standard empty folders, with no
dotfiles. `strings` on a photo in `DCIM/Camera/` names the phone's own make and model, and the
file name agrees with when it was taken. `Download/` holds PDFs somebody fetched, one of which, on a
LAN, was written by a real person on that network. An `iphone-` or an iPad shows Apple's layout
instead (`DCIM/100APPLE/IMG_NNNN.JPG`, `Downloads/`).

## Grounding (verified 2026-09-25, v0.263.0)

- **76 phones and tablets on the 50 catalog networks:** tablet 37 (22 LAN, 15 deep), iphone 20
  (12, 8), android 19 (9, 10), on 32 of the 50 LANs. 15 of the LAN ones run ssh (tablet 7, iphone 5,
  android 3). Desk machines for comparison: laptop 29, desktop 20, workstation 17.
- **All three prefixes are the `workstation` role** (`pools/hostnames.ts`, `DEVICE_TYPES` in
  `network/homeNetwork.ts:30`), so placement is the role's: ssh at the flat rate, mysql 0.03
  (`rolePlacement.ts:39`). Deep layers draw the same prefixes (`generateDeepLayer.ts:116`).
- **Their home is empty today.** `buildNpcHome` (`generation/npcHome.ts:192`) returns
  `dir({}, HOME_DIR, username)` for anything `isDeskMachine` (`:40`) rejects; `sshContent.ts:92`
  gives a non-desk box no home `.ssh/`. Its one caller is `remoteHostFs.ts:601`. The pin that moves
  on purpose: `npcHome.test.ts:89`, "leaves a phone, a tablet and every box that is not a personal
  computer with an empty home".
- **Everything else already reaches them.** Slices 2–3 gave every NPC box `/etc`, `/root`,
  `/home/guest` and `.1` logs; slice 7 gives a phone cron's mail and no person's mailbox
  (`mailbox.ts:50–55`). None of that changes.
- **A phone already has a model; a tablet does not.** `phoneModel(essid, host)` (`share.ts:338`)
  draws from `PHONE_MODELS` (`pools/shareFiles.ts:666`, `iphone` and `android` only) on
  `share-phone-<essid>-<ip>`. It is read by the share's photo devices (`share.ts:350`), media
  pairings (`device/media.ts:55`) and lock logs (`device/lock.ts:53`). Gateway admins may sit at a
  phone or tablet (`gatewayHistory.ts:6`).
- **The document stubs exist.** `renderDocument` (`generation/documentFormats.ts:241`) renders a
  `pdf` (title, author, created, modified) or `jpeg` (make, model, takenAt, artist) whose metadata
  `strings` reads, drawing noise from one world-wide block, so it is cheap.
- **People.** `inhabitant({ essid, host, username })` (`persona.ts:68`) names the box's person;
  `networkPersona(essid)` gives `category` and `place`; `peopleOn(essid)` (`networkMail.ts:131`)
  lists every inhabitant of the LAN, the roster mail and the share already use.
- **Budgets:** bundle 218,958 B gzipped of a 284,975 B ceiling; **build 1.53–1.67 ms/box of 2 ms**
  (slice 10's as-built). The headroom is thin; see "Risks".

## Scope boundary

**In:** the home of every NPC `android-`, `iphone-` and `tablet-`, LAN and deep; tablet models.

**Not built here, deliberately:**
- **No phone-shaped `/root` or `/etc`.** Those stay the workstation role's (decision 1).
- **Tablets stay out of** the share's photo devices, media pairings and lock logs. Adding them would
  re-roll slices 8 and 9's content (decision 5).
- **No agreement with the share.** A share photo credited to a phone need not be in its `DCIM/`
  (decision 11).
- **No screenshots.** PNG would be a new document format.
- **No player box.** A player's workstation stays a fresh install whatever its prefix (decision 10).
- **No `.ssh/`, no mailbox, no shell history** on a phone (decision 2).

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 2 | Inert: no credential, key, code or anything the game accepts. |
| 3 | Shipped surface only: `ls`, `cat`, `strings`, `scp`/`ftp get` where they already reach. |
| 4 | A LAN persona document's author is a real inhabitant of that network. |
| 5, 22 | Everything dated before the epoch, on the one calendar. |
| 6 | Every NPC phone and tablet, on every layer; never a player's box. |
| 7 | The prefix overlay: a phone has `DCIM/` and `Download/` rather than dotfiles. |
| 9 | Phone/tablet 10–25 content files. |
| 13 | Debian tiers: the home is the box's account's (`HOME_DIR`/`HOME_FILE`). |
| 15 | New streams only. |
| 17 | Variety tested within and across networks. |
| 21 | Version-free. |
| 23 | Pins move deliberately; truth rules become property tests. |

## Decided at planning (2026-09-25)

1. **The content lives in the home.** `/home/<user>` stands for the device's storage. No `/sdcard`
   or `/var/mobile`; `/etc`, `/root` and the logs stay the workstation role's.
2. **No dotfiles.** No `.bashrc`, `.profile`, `.bash_logout`, `.bash_history`, `.gitconfig`,
   `notes/` or `.ssh/`.
3. **The layout follows the maker.** Android (every `android-`, a non-Apple tablet):
   `DCIM/Camera/IMG_YYYYMMDD_HHMMSS.jpg`, `Download/`, `Documents/`, and empty `Pictures/`,
   `Music/`, `Movies/`. Apple (every `iphone-`, an iPad): `DCIM/100APPLE/IMG_NNNN.JPG` on a running
   counter, `Downloads/`, `Documents/`.
4. **A photo is the device's own.** A `renderDocument` JPEG whose make and model are this
   device's, `artist` null, taken in bursts on 4–10 days across the two years before the epoch;
   the name agrees with `takenAt` (Android) or runs in `takenAt` order (Apple).
5. **Tablets get models on their own stream.** `TABLET_MODELS` (iPad, Galaxy Tab, Lenovo Tab,
   Fire HD) drawn by `tabletModel` on `tablet-<essid>-<ip>`. `phoneModel` is untouched.
6. **Downloads are PDFs a person fetched.** 2–6 from a personal pool whose Info author is a
   fictional issuer; on a LAN, at most one from the persona category's pool, authored by a real
   inhabitant from `peopleOn`. A deep device draws personal PDFs only.
7. **A few typed notes.** 0–3 plain-text files in `Documents/` from a new phone-note pool,
   slot-filled with the persona's place and a colleague. No secret anywhere.
8. **Volume 10–25:** photos 6–16, downloads 2–6, notes 0–3, clamped to the band; empty folders do
   not count.
9. **Streams:** `phone-content-<essid>-<ip>` and (5)'s. No decision-15 amendment; nothing
   generated re-rolls.
10. **The player's box is untouched.**
11. **No agreement with the share.**
12. **Tests:** see the acceptance criteria.
13. **One PR**, v0.264.0; client generation only, so no `api/` change and no wire-check; a played
    run via `v2-e2e`; docs follow (decision 24).

**Derived here:**

14. **Where the code goes.** A new `generation/phoneHome.ts` (`buildPhoneHome`, `deviceModel`) and
    `generation/pools/phoneFiles.ts` (tablet models, the PDF pools, the note pool). `buildNpcHome`
    hands a phone or tablet to `buildPhoneHome`; desk machines and every other box are unchanged.
    `TABLET_MODELS` lives with the phone pools, not in `shareFiles.ts`, because nothing on the share
    reads it.
15. **Which maker.** `deviceModel(essid, host)` is `phoneModel(...)` for phones and
    `tabletModel(...)` for tablets; the layout keys on `make === 'Apple'`, so an iPad gets Apple's
    and a Galaxy Tab gets Android's.
16. **Dates.** One calendar with the rest of the world: `WORLD_EPOCH` and the two-year window
    `pastDate` already uses; a PDF's modified date is not before its created date.
17. **The usual sweeps:** version-free, one calendar, no unfilled slot, inert, every pool entry
    reachable, variety, budgets. The whole-world byte-diff (`main` vs branch) shows only phone and
    tablet homes, with every differing path classified.

---

## PR 11 — A phone is a phone

**Class:** behaviour change.
**Required skills:** `tdd`, `testing`, `functional`; `refactoring` after green; `mutation-testing`
at PR readiness.

**Value:** the slice's observable. `ssh` into an NPC `android-` as its user → `ls -a ~` shows
`DCIM/`, `Download/`, `Documents/`, `Pictures/`, `Music/`, `Movies/` and no dotfile →
`strings DCIM/Camera/IMG_…jpg` names the phone's own model, the one a file server's photos and a
media box's pairings already credit to it.

**Path:** `remoteHostFs.ts:601` → `buildNpcHome` → `buildPhoneHome` (`phone-content-` stream,
`deviceModel`, `networkPersona`, `peopleOn` on a LAN) → `renderDocument` for each photo and PDF →
the home at `HOME_DIR`/`HOME_FILE` in the box's tree → read by `ls`, `cat`, `strings`, `scp`.

### Acceptance criteria

- [ ] Every NPC `android-`, `iphone-` and `tablet-` home, LAN and deep, holds 10–25 content files
      and no dotfile, owned by the box's account at Debian home tiers; a guest reads none of it.
- [ ] An Apple device's home has `DCIM/100APPLE/` and `Downloads/`; an Android device's has
      `DCIM/Camera/`, `Download/` and the three empty standard folders; both have `Documents/`.
- [ ] Every photo's Exif make and model are its own device's (`phoneModel` for a phone, the new
      `tabletModel` for a tablet), it carries no artist, it was taken before the epoch within the
      window, and its name agrees with when it was taken (Android) or runs in that order (Apple).
- [ ] Every tablet has one model for its life, from `TABLET_MODELS`, and nothing that read
      `phoneModel` before reads anything different.
- [ ] Every download is a PDF dated before the epoch; on a LAN at most one comes from the persona's
      category, and its author is a person `peopleOn` lists; a deep device has none of those.
- [ ] Notes, when present, fill every slot and hold no password, key or code.
- [ ] Desk machines' homes, every other box and the player's box are byte-identical to `main`; the
      whole-world byte-diff shows phone and tablet homes only.
- [ ] No two phones on one network, and no two across the catalog, have the same set of photo
      names, downloads and notes (variety).
- [ ] Every pool entry is reachable; no content names a software version.
- [ ] Bundle and build budgets hold.

**Evidence:** a new `generation/phoneHome.test.ts` over every phone and tablet in the catalog world
plus synthetic hosts (an android, an iphone, an Apple and a non-Apple tablet, one deep), built inside
each test (no file-level fixture cache). The test reads photo metadata the way `strings` would.
`npcHome.test.ts:89` moves on purpose. A played run via `v2-e2e`: pick an ssh-reachable
`android-` and an Apple device on a catalog LAN, crack in, `ls -a ~`, `strings` a photo and a
download, and match the photo's model to what the network's file server or media box credits.
The `v2-e2e` skill gains the phone read.

### Increments (TDD, one commit each after approval)

1. **A phone's home is its device's, not a shell's.** The Android layout with photos only:
   `buildPhoneHome` behind `buildNpcHome`, `phone-content-` stream, photos named and dated, the
   phone's own model, no dotfiles. The `npcHome.test.ts:89` pin moves.
2. **Apple's layout** for `iphone-`: `DCIM/100APPLE/`, the running counter, `Downloads/`.
3. **Tablets have models.** `TABLET_MODELS` and `tabletModel`; a tablet picks its layout from its
   maker; `phoneModel` unchanged.
4. **Downloads.** Personal PDFs everywhere; one persona-category PDF on a LAN, authored by a real
   inhabitant.
5. **Notes**, and the volume band across the three kinds of content.
6. **Sweeps and variety:** version-free, inert, reachability, variety within and across networks.
7. **Docs:** `npcHome.ts`'s header, the `v2-e2e` skill, and `conventions-and-gotchas.md` wherever
   it says phones and tablets keep empty homes.

---

## Pre-PR quality gate

1. Implementation and refactoring assessment complete.
2. `mutation-testing` scoped to `phoneHome.ts` and `pools/phoneFiles.ts` (json reporter; one file at
   a time, capped concurrency); valuable survivors killed.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (budgets) from `v2/`.
4. No wire-check: nothing in `api/` or the wire shape changes. Proven by the byte-diff (no AP or
   gateway tree moves) and a diff touching no `api/` file.
5. Whole-world byte-diff probe (`main` vs branch), every differing path classified.
6. Version bump.

## Risks

- **The build budget.** At 1.53–1.67 ms/box of 2 ms, 76 extra homes of ~20 rendered stubs each,
  and a `peopleOn` (a `generateHomeLan`) per LAN phone, could break it. Measure after increment 1
  and again after 4. If it breaks, draw the LAN author from the host list the caller already holds
  before reaching for memoization (decision 19).
- **A tablet's model is a new fact.** Nothing else names it today. If a later slice puts tablets in
  pairings or photos, it must read `tabletModel` rather than extend `PHONE_MODELS`, or the two will
  disagree.
- **Photo names collide.** Two photos taken in the same second would share an Android name. The
  burst draw gives each photo a distinct second; the uniqueness is a property test.
- **The carry cap.** A photo or PDF a player `scp`s home must fit the 8192-character signed write
  (`signedRequest/types.ts:33`). The stubs keep the share's sizes, and the test asserts every file
  fits.

---
*On close-out, fold the as-built into the epic's slice 11 section and delete this file.*
