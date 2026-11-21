# Plan: Finding paid work

**Status:** Grilled 2026-11-21. One slice, planned below.

A new player is walked onto wifi and into hackademy.io well, but nothing after that tells them the
world pays for work, where the work is, or how they get paid. The trail from "online" to "paid" has
three gaps: findit.io is never named in full, nothing hints that hireme.io exists (and a findit
search for "job" or "money" does not find it), and the first mention of a wallet is inside a
contract briefing, with nothing anywhere saying where a wallet comes from. A test run by another
model stalled on exactly this part of the game.

---

## Grill record

1. **A proof mail with no wallet still closes the job unpaid (2026-11-21).** Every briefing already
   says "No wallet, no money", so the rule is announced; the gap is only where a wallet comes from.
   This slice teaches that and leaves `answerClientMail` as it is. Rejected: keeping the job open
   so a resend with a wallet pays, a softer rule that would also put a server change and a
   wire-check into a copy slice.

2. **hackademy.io gets a new last chapter about getting paid (2026-11-21).** It comes after
   "Scripting with node" and is listed on the front page with the others, so a player who only
   skims the chapter list still learns there is paid work. Rejected: a paragraph in "The web",
   which would sit between gobuster and the practice list where nobody looks for money; and both,
   which says the same thing twice.

3. **The chapter teaches the tools, not the recipe (2026-11-21).** It is written like the others:
   what each of emailit.io, hireme.io and chainit.io is for, and the commands in a `<pre>` tried on
   the reader's own box (signing up from a terminal, `apt install mailutils`, `mail`,
   `apt install wallet`, `wallet init`, `wallet balance`), plus the one rule a reader cannot guess:
   a client pays only the wallet address the proof mail names. It never walks a contract from
   applying to being paid. Rejected: a full walkthrough, which gives the loop away; and hints with
   no commands, which leaves the wallet as undiscoverable as it is now.

   Two of the site's standing rules (`docs/tutorials-architecture.md`) shape it: an example targets
   only the reader's own box or hackademy.io (rule 3), so signing up at emailit.io and applying at
   hireme.io are described in prose, never shown as a `curl` example; and the chapter describes
   how payment works without telling the reader what to fear (rule 4).

4. **findit keeps its one pointer, now with its full name (2026-11-21).** The README is unchanged.
   The web chapter writes `findit.io` in full where it now says only "findit", so a reader can type
   the address. findit is no longer the only way to find work, since the new chapter names hireme.io.
   Rejected: a findit.io line in the README, which would break the site's rule 7 (findit named once,
   in the web chapter) for a pointer the new chapter makes unnecessary.

5. **hireme.io says how it pays, and findit finds it by the words a newcomer types (2026-11-21).**
   The front page gains one line in the site's voice: pay is in JSC, to the wallet address sent with
   the proof of work. Its findit description is reworded so a search for "job", "jobs", "work" or
   "pay" lists it (findit matches substrings of the title, description and text, and today none of
   those words is on the page). Rejected: the wallet line alone, which leaves a findit search for
   "job" empty; and leaving hireme.io alone, which makes the chapter the only place payment is said.

6. **Settled from the code, proposed (2026-11-21):**
   - Teaching that a box "no longer boots" (the sabotage job) stays out of hackademy. It is
     ordinary Linux knowledge, and the owner's rule is that players learn the hard way.
   - `llms.txt` is unchanged. It already says that some people pay for work in JSC and that finding
     who is hiring is part of the game.
   - The emailit.io welcome mail is unchanged. It is the mail provider's, not the job board's.
   - A minor version bump (v0.478.0), for a new chapter and new copy.

## Facts the plan rests on (measured 2026-11-21)

- The README (`core/hackademy/readme.ts`) names wifi, `su`, `lynx`, hackademy.io and
  valleynews.io; nothing in it or in hackademy names emailit.io, hireme.io, chainit.io, `mail` or
  `wallet`.
- The first mention of a wallet is in the contract briefing (`core/hireme/contracts.ts`,
  "with your wallet address … No wallet, no money"). `answerClientMail`
  (`core/missions/clientMail.ts`) completes a job whose proof names no wallet, paying nothing.
- `wallet` and `mailutils` are apt packages (`core/packages/aptPackages.ts`); a fresh box has
  neither. `mail login` saves the login to `~/.mailrc`; `mail` lists the inbox. `wallet init`
  needs no network; `wallet balance` does.
- findit ranks by substring over title, description and text (`core/findit/search.ts`), so the
  description is what decides a one-word search. `webIndex.test.ts` searches the generated web
  through `rankPages`, and pins hireme.io's current description; `hireme/pages.test.ts` pins the
  front page's copy.
- The hackademy rules are enforced by `hackademy.test.ts`: the `CHAPTERS` table, the front-page
  order, findit named only in the web chapter, mapit.io once, no example naming a host other than
  hackademy.io, every example's program on a fresh box or installed earlier in the same page.
- `scripts/testHackademy.ts` (wire-check vs `vercel dev` + supabase) checks the live front page
  links every chapter, by a hard-coded list.
- Site pages are part of each box's generated tree, so new copy reaches prod at once, except on a
  page a player has written over: there the journal wins until `guardian.ts restore <domain>`.

---

## Slice 1: hackademy.io and hireme.io say where paid work is and how it pays (v0.478.0)

**Value:** a new player who reads hackademy.io to the end, or searches findit.io for a job, learns
that the world pays for work, that hireme.io is where it is, that applying takes an emailit.io
address and that pay goes to a JSC wallet they make themselves.

**Path:** `lynx http://hackademy.io` → the front page → chapter 11, read off the box's generated
tree; `lynx http://findit.io` → search → hireme.io's listing; `lynx http://hireme.io` → its front
page. Copy only: no `api/` change, no schema, no server prose.

**Class:** behavior change (what the player can read and find).

**Delivery:** one independent PR against `main`.

**Required implementation skills:** `tdd`, `testing`; `refactoring` N/A unless the new chapter
shows a duplication worth lifting. The site's own in-world voice rules
(`tutorials-architecture.md` rules 4 and 8) govern the prose.

**Acceptance criteria — hackademy.io**

1. The front page lists an eleventh chapter, "Getting paid", after "Scripting with node",
   linking to `/getting-paid.html`, with a one-line summary in the style of the others.
2. "Scripting with node" ends with `Next: Getting paid`; "Getting paid" ends in a Practice list
   and the link back to the front page, and links on to no chapter.
3. "Getting paid", in the collective's voice and never the word "game", says in prose:
   - some people pay for what these pages teach, and hireme.io is where they post the work;
   - hireme.io wants an address at emailit.io, which gives one to anybody;
   - pay is in JSC and goes only to the wallet address the proof of work names; chainit.io shows
     what any address holds;
   - a wallet is a key file in the home directory, and whoever holds the key holds the coins.

   It describes; it never warns (rule 4), and it never walks a contract from applying to being
   paid (grill record 3).
4. Its examples, each behind its prompt in a `<pre>`, all on the reader's own box:
   `# apt install mailutils`, `$ mail login`, `$ mail`, `$ man mail`, `# apt install wallet`,
   `$ wallet init`, `$ wallet balance`, `$ man wallet`. No example names emailit.io, hireme.io or
   chainit.io (rule 3); signing up and applying are prose.
5. The web chapter names findit by its full address, `findit.io`; it is still the only page that
   names findit, and mapit.io is still named once, beside it.
6. Every existing rule `hackademy.test.ts` enforces still passes for all eleven chapters.

**Acceptance criteria — hireme.io and findit.io**

7. hireme.io's front page says, in the site's voice, that contracts pay in JSC to the wallet
   address sent with the proof of work.
8. Its findit description reads along the lines of "Freelance jobs for independent IT and
   security people: contract work that pays in JSC. Apply with your emailit.io address." A findit
   search for `job` or `jobs` ranks hireme.io first; `pay` and `work` list it. (`work` also
   matches every page saying "network": measure its rank in RED and settle the criterion on the
   measured fact, not this guess.)

**Acceptance criteria — unchanged on purpose**

9. The README, the briefing mails and `answerClientMail` are unchanged.

**Acceptance criteria — docs and wiring**

10. `docs/tutorials-architecture.md`: "ten chapters" becomes eleven (intro, pieces table),
    chapter 11 joins the chapter list, and chapter 7's line says findit.io.
    `docs/hireme-architecture.md` describes the front page's new line. `scripts/testHackademy.ts`
    lists `getting-paid` among the front-page chapters.
11. Version 0.478.0 in `package.json` and `package-lock.json`.

**RED:**

- A `CHAPTERS` row for "Getting paid" in `hackademy.test.ts` (fails: no such page), and the
  front-page order test with it.
- A test that the chapter's prose names hireme.io, emailit.io and chainit.io and shows
  `wallet init` (fails until written).
- The web-chapter test asserting `findit.io` (fails: it says "findit").
- `hireme/pages.test.ts`: the front page names JSC and the wallet address (fails); the pinned copy
  updated.
- `webIndex.test.ts`: `rankPages(web, 'jobs')[0]?.address` is `hireme.io`, the same for `job`;
  `pay` and `work` per their measured ranks (fail today); the pinned description updated.

**GREEN:** the chapter in `pages.ts` (front-page `<ol>`, the page, scripting's `next()`,
`HACKADEMY_PAGES`), the findit.io wording in the web chapter, the hireme line and description.

**REFACTOR:** assess only. No new helper is expected.

**PRE-PR MUTATION:** `N/A`. The change is prose in string literals, and the tutorials doc already
records that mutation leaves prose strings as survivors ("Prose is reviewed, not tested").
Alternate evidence: the rule tests over all eleven chapters, the findit ranking tests, the
wire-check and the browser read below.

**Wire-check:** `scripts/testHackademy.ts` against `vercel dev` + supabase, so the live front page
is proven to link all eleven chapters.

**Browser (close-out, one run):** in `lynx`, the hackademy.io front page shows chapter 11 and it
renders whole; a findit.io search for `jobs` lists hireme.io; hireme.io's front page shows the
wallet line.

**Gates:** `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run build` (the bundle
budget runs only there).

**After merge:** run the guardian's report on prod for hackademy.io and hireme.io. A front page a
player has written over keeps their version, so the new copy is not live there until a restore,
and a restore is the owner's call.

**Out of scope:** the README; the no-wallet rule; teaching how a box stops booting; the emailit.io
welcome mail; `llms.txt`.

**PR-ready when:** criteria 1–11 hold, the gates, the wire-check and the browser run pass, and the
owner approves the commit.
