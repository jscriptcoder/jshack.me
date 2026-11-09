# Plan: a contract whose key box sits behind a front box

**Status:** Grilled 2026-11-09. Slice plan to follow. Nothing is built.

A second contract template. Today every contract's key box is reached straight through the
gateway's forwards. In this one the gateway forwards only to a **front box**; the key box has no
forward and is reached from inside, by a player standing on the front box. It is the backlog's
"more hops" item under "missions — deferred" in `docs/backlog.md`. As-built context:
[`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

1. **Pivot in (2026-11-09).** The gateway forwards only to a front box, which falls to one of
   today's routes. The key box has no forward: the player stands on the front box, scans its LAN
   and works a second way in from there. Storage (`file`, `gpg`, `database`) applies to the key box
   as it does today. Rejected: the passphrase on a third box behind the key box (it touches only gpg
   contracts, a third of them, so it is a twist for later, not a template); both at once (three boxes
   deep before the first hop is known to be fun). Deep chains (inner gateway → L2, switches) stay a
   later template of their own.

2. **The key box falls to a second route, worked from inside (2026-11-09).** The front box draws a
   route from today's six, and the key box draws its own from the same six on a stream of its own.
   The key box's doors are reached over the LAN instead of through a forward; the routes, their
   files and their proofs are otherwise today's. Every route roots the box it lands on, so the front
   box always ends rooted and `apt install` works there. Rejected for now: a lead on the front box
   (the key box's root word in a deploy script, `.bash_history` or a cron line), which would be a new
   route kind; it can join later as a seventh inside route, as the leak routes joined the six.
   There is no key-based ssh login in the game, so "an ssh key on the front box" was not an option
   without a new login mechanic.

3. **Two-hop is drawn from the number, one contract in three (2026-11-09),** on a stream of its own,
   so a contract's shape stays a function of its number, computable offline, and no single-hop
   contract's route, hashes, key or storage moves. An accepted contract that lands in the share turns
   two-hop (its key box loses its forward, a front box appears), which costs nothing while prod has
   only test players. Rejected: choosing the template at posting and storing it (every door would
   need a table read, and the client's generator could no longer work out the shape); two-hop for
   new numbers only (needs the same stored fact).

4. **The board says so; the briefing says only "inside" (2026-11-09).** A two-hop offer names its own
   kind in the line's kind slot, `retrieve an internal access key`, so the player chooses the harder
   job knowingly and its pay makes sense. The briefing adds one sentence: the key is on a machine
   inside their network, not on the edge. It never says pivot, front box, how many machines, the
   route or the key box's address; working out what "inside" means is the job. Rejected: hiding the
   template (its own pay range would tell anyway, so it would be a tell, not a secret).

5. **A two-hop job pays 2,000–4,000 JSC (2026-11-09),** rounded to 50 and drawn from the number as
   today's is. No overlap with the single-hop 500–2,000, so harder work always pays more. Rejected:
   an overlapping 1,500–3,500; single-hop pay doubled.

6. **The key box blurs an inside scan with decoys (2026-11-09).** From outside, the gateway forwards
   to the front box with today's route-plus-decoys rule, so a two-hop contract's public scan reads
   like a single-hop one. Inside, the key box runs extra daemons from the four non-ssh kinds (web,
   ftp, mysql, snmp), each the real door's generated build with nothing laid in, on safe releases:
   **2 or 3 service doors besides `22`**, the real ones (the route's, `3306` on database storage)
   first and decoys filling the gap. sshd always runs, so ssh is never an inside decoy. Rejected:
   no inside decoys, which would make the second hop a free read after a first that made the player
   work.

7. **Three boxes, no filler (2026-11-09):** the gateway, the front box and the key box, named on the
   target stem as today (`halden-web`, `halden-files`). An inside scan shows one host besides the
   gateway and the front box; finding the key box is not the job, working its route from a hop is.
   Filler boxes (a workstation, a printer) to rule out belong with "believable filler behind the
   doors" in `docs/backlog.md`, where a business's network is dressed as a whole: they are a new
   content generator with their own "nothing climbs" proof, and they test triage, not pivoting.

8. **Any shell on the front box is a foothold (2026-11-09).** The front box's `guest` and NPC user
   keep the world's odds, as today's key box does, so a player can often `hydra` a guest shell
   through `:2222` without working the front route. From it the stock tools (`ifconfig`, `ping`,
   `curl`, `ssh`, `scp`) reach the key box; everything else needs `apt`, so root on the front box in
   practice. One rule, no carve-out: tier decides what a shell can do, as everywhere. Rejected: the
   key box answering only a root on the front box (an access rule that exists nowhere else); shutting
   the front box's guest and user (a carve-out from the world's odds).

## Given, not chosen

What the decisions above force, recorded so the plan does not re-open them:

- **The two route draws are independent**, so a contract can draw the same route twice (web then
  web), and the two boxes' words can coincide. No rule against either.
- **Outside, the front box takes today's key box's place** in the forward and decoy rules. On
  database storage the `3306` door is the key box's and is reached inside, so the gateway's real
  forwards are the front route's alone (1–2), and decoys fill to 3 or 4 as today.
- **Inside, a route's door is the key box's own port**: the hydra route is its `:22`, and a leak
  route's word logs in with `ssh root@<key box>` on `22`, not `-p 2222`.
- **The front box holds no key, no storage and no lead**, and is built by the mission builder with
  every non-route package on a safe release, as the key box is. Nothing but the two routes climbs.
- **Closing a hop is as today**: whoever roots the front box can `passwd` or `apt upgrade` it and
  close the pivot for the next visitor. The guardian never touches a mission box.
- **`hireme.ts show`** prints the template, both boxes' routes and services (decoys tagged), the
  storage and the key, as it does for one box today.
