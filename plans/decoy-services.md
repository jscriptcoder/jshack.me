# Plan: decoy services on a contract's network

**Status:** Grilled 2026-11-09. Slice plan to follow. Nothing is built.

Today a public scan of a contract's address tells the route. Past the gateway's own `22`, `2222`
alone is hydra, `80` alone is msfconsole, and `80`, `21`, `3306` or `161` beside `2222` is a leak
route. Decoys are the backlog's first deferred missions item ("missions — deferred" in
`docs/backlog.md`): more doors on the gateway, so the port list stops answering the question the
player is meant to work out. As-built context: [`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

1. **A decoy is a forwarded door that blurs the scan (2026-11-09).** An extra forward on the
   gateway onto a real service on the key box. Its only job is to make the public port list stop
   telling the route; it opens no way in. Rejected: unforwarded daemons visible only from a shell on
   the key box, which blur nothing, since whoever has that shell already found the route.

2. **Five kinds, every one of them a real route somewhere (2026-11-09):** `:2222` (ssh), `:80`
   (web), `:21` (ftp), `:3306` (mysql), `:161` (snmp). A port that is never a route (`:25`, `:8080`)
   is dismissed at a glance, so it blurs nothing and costs a daemon, its logs and its door. Given,
   not chosen:
   - A decoy is never a kind the key box already runs: a web route's `:80` is not also a decoy, nor
     is a database-storage contract's `:3306`.
   - A `:2222` decoy is the forward alone, onto the key box's own sshd, which always runs. Its `root`
     stays shut, as on the msfconsole route today.

3. **The count is drawn, so it says nothing (2026-11-09).** A contract draws how many forwards its
   gateway has, **3 or 4**, and decoys fill the gap above its real forwards (the route's, plus
   `:3306` on database storage when the route's door is not already that). Real forwards run 1–3,
   so every route reaches every count: hydra or msfconsole takes 2–3 decoys, a leak route 1–2, a leak
   route on database storage 0–1. With the gateway's `22` a scan shows 4–5 ports. Rejected: a flat
   0–2 decoys (two ports would still mostly mean hydra or msfconsole); every contract forwarding all
   five kinds (one rule, but every scan identical, so players learn to skip it and no network reads
   like a small business's).

4. **A decoy lets you in as far as a real door of its kind would, and holds nothing (2026-11-09).**
   Working it costs what working the real door costs; only then does the player find it empty.
   Rejected: decoys whose doors stay shut, each ruled out by one failed `hydra` or login, which
   saves the player barely anything over today's scan.

5. **An snmp decoy's read-write community is shut (2026-11-09).** Its read-only community is a
   guessable one (`monitor` or `netops`, as on the snmp route) and a walk shows an ordinary contact
   line. Its read-write community is drawn from `SHUT_HASHES`, so `hydra <address> snmp` finds
   nothing. On the real snmp route the word comes through the read-only walk, so the decoy matches
   the real door along the path that wins it. Rejected: a crackable read-write community, which
   would hand anyone on about half of all contracts a root-free `snmpset inputPort.22=deny` that
   shuts `:2222` for good, killing a hydra or leak route before the contractor gets there.

6. **A decoy is the real door's generated build minus what the server lays in (2026-11-09).** The
   word always comes from the server's lay-in, never from the generated box, so the two cannot
   differ on the surface:

   | Kind | The real door's generated box | The decoy |
   | --- | --- | --- |
   | web | nginx, the stock `It works!` page; the server lays the forgotten file | the same, nothing laid |
   | ftp | `anonymous_enable=YES`, an empty `/srv/ftp/pub`; the server lays the file | the same, nothing laid |
   | mysql | the generated application, a crackable application account, a shut root; the server adds `settings` | the same, no `settings` |
   | snmp | a hashed read-write community; the server lays `snmpd.conf` with the word | a read-write hash from the shut pool, and an `snmpd.conf` with a guessable read-only community and an ordinary contact, generated with the box since it holds no secret |
   | `:2222` | the key box's sshd | the forward only |

   Rejected for now: believable filler behind both real doors and decoys (a company homepage,
   mundane files in `pub`, a business contact). Filler on decoys alone would be a tell, so it is a
   backlog item for both together.

7. **The owner took the remaining recommendations (2026-11-09):**
   - **Safe releases.** Every decoy daemon sits on a release whose hole is `low` or `medium`, a
     guest shell at most; the shape test that walks 2,000 numbers keeps proving nothing but the
     route climbs.
   - **A stream of its own**, `mission-decoys-<n>`, for the count, the kinds and their versions and
     hashes, so no contract's topology, route, hashes, key, key path, storage or pay moves.
   - **No migration.** Decoys reach every contract the moment they ship, accepted ones included.
     Only test accounts and bots play on prod, and the pre-launch rule carries no backward-compat
     burden. A key box a root already rewrote keeps its journal over the new base; that corner is
     left as it falls.
   - **The forwards' order is not shuffled.** It lives only in the gateway's `rules.v4`, whose admin
     is shut, and the gateway runs no snmp agent, so nobody can read it.
   - **Pay is unchanged.** Decoys land on every contract alike, so no job gets harder than another;
     a higher pay range belongs to the harder templates the backlog lists.
   - **Accepted:** a `:2222` or `:21` decoy lets `hydra` win a guest or user shell on a route that
     offered none before. That shell cannot read the root-only key, as on the hydra and leak routes
     today.
