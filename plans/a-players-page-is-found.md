# Plan: X2 Slice 3 — A Player's Page Is Found

**Epic:** `plans/legacy-parity-epic.md`, X2 slice 3. Grill record: "X2 — resolved scope & decisions"
(decisions 91–105, 2026-09-26); slices 1 and 2's as-built are in the same section. Four owner
decisions made at planning (2026-09-26, 106–109, all refining 97) are listed under "Decided at
planning" below.

**Status:** planning — decisions recorded, plan body to follow.

---

## Decided at planning (2026-09-26)

**Owner decisions (refine 97):**

106. **`robots.txt` is read the way a real crawler reads it.** `Disallow: /` opts a site out only
     inside a group addressed to `User-agent: *` or `User-agent: findit` (names case-insensitive).
     When a `findit` group exists it is the ONLY group findit obeys, as real crawlers pick the most
     specific group. `Disallow: /admin/` hides nothing, and an empty `Disallow:` allows everything. So
     `User-agent: Googlebot` + `Disallow: /` keeps a site listed, as on the real web. It applies to
     every page on a public `:80`, publishers included ("player or NPC", 97). Rejected: any
     `Disallow: /` line anywhere (simpler, but not how crawlers behave) and "any robots.txt opts
     out" (would hide the 80% of generated sites that ship one, breaking 92).
107. **The crawl leaves no trace.** Building the index reads journals and writes nothing, as
     slice 2's publisher index does: no `access.log` line on a crawled box. Rejected: logging the
     crawl on player boxes or everywhere (about 2 writes per listed box per search, and it leaks
     findit's search traffic to every listed player, undercutting 102's "findit's log is the prize").
108. **The player walk is a batched pre-filter.** Per search: ONE read of every stored public
     address (`network_public_ips`, minus publishers and findit), ONE batched read of their
     gateways' journals, and the full `curl` resolution (`resolveWebTarget`: occupants, leases, the
     reached box's journal) only for gateways that actually serve `:80`. The cost grows with the
     players really publishing, not with the networks ever joined. Rejected: a plain `curl` per
     stored address (about 2 reads per network ever joined, per search) and a stored listing table
     (a second authority that goes stale, which 97 rejected).
109. **One PR** (v0.271.0). Listing and the opt-out are one rule in 97: automatic listing is fair
     only because the owner can refuse it, so `main` never carries a crawler nobody can refuse.
     Rejected: 3a listing / 3b opt-out.
