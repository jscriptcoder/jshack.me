# Plan: X2 Slice 4 — findit Falls and Comes Back

**Epic:** `plans/legacy-parity-epic.md`, X2 slice 4. Grill record: "X2 — resolved scope & decisions"
(decisions 91–105, 2026-09-26); slices 1–3's as-built are in the same section. One owner decision
made at planning (2026-09-26, 116, refining 101) is listed under "Decided at planning" below.

**Status:** planning — decision recorded, plan body to follow.

---

## Decided at planning (2026-09-26)

**Owner decision (refines 101):**

116. **Restoring findit is a reboot.** `scripts/restoreFindit.ts` ends every open session on
     findit (every player, every kind, `rebooted`, as `reboot` does) and leaves a fresh boot marker on
     the restored box, besides deleting its `patches` rows. The server treats an open session row as
     the authority to act, so wiping the journal alone would leave a player standing on findit as
     root still root on the clean box, free to deface it again at once. And the boot marker that tells
     a standing shell the box went down lives in that same journal, so their terminal would not even
     notice. With 116 a standing shell is thrown off at its next command, exactly as after a reboot,
     and the only way back in is the one 102 names: a live CVE through findit's public address.
     Rejected: patches only (101 as first written), under which "comes back" holds only against
     players who had already left.
