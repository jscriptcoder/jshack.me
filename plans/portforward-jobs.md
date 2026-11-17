# Plan: a contract that asks for a port forwarded into a machine

**Status:** Grilled 2026-11-17. Next: the slice plan.

A seventh kind of contract, and the first won on the router alone. The client wants one of the
target's inside services reachable from outside, on a public port the briefing names; the player
breaks into the contract network's router and adds the forward. The client reads the router when
the contractor mails in, as a backdoor client reads the target. As-built context:
[`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

### The job

1. **The forward is the whole job (2026-11-17).** The client pays when the public port it named
   reaches the target on the inside port it named. Nothing on the target has to change: the
   service is already running there, and it is what the client wants to reach. Anyone's forward
   counts, as anyone's listener counts on a backdoor job. A forward to the right port on the wrong
   machine, or to the right machine on the wrong port, is a miss. Rejected: also asking for a root
   shell or a file on the target, which every other kind already asks for.

2. **The router draws one of two routes, half and half, on a stream of its own (2026-11-17).**
   Today a contract router is passed through, never broken: a shut admin, safe firmware, no agent.
   On a portforward job it draws a way in:
   - **hydra**: the router's admin password is from the crackable pool, so `hydra <address> ssh`
     on its own `:22` finds it and `ssh` lands a root;
   - **msfconsole**: the firmware is pinned to a release whose critical hole lands root, so
     `msfconsole <address> 22` gets in through a router a scan shows as clean (firmware answers
     to no port, so `nmap -sV` never shows it).

   Either way the root edits `/etc/iptables/rules.v4` in `nano`. Set aside for later, as the leak
   routes followed the first key jobs: **snmp** (a guessable read-write community and `snmpset`
   with no root, which clashes with contracts that already forward `:161`), and **an inside
   leak** (root the target through a key-box route and find the router's admin in a backup
   config there).

3. **The target takes the key box's slot and runs one sealed service (2026-11-17)**, drawn per
   contract, each with a machine named after what it is:

   | Machine             | Service | Inside port | Hostname          |
   | ------------------- | ------- | ----------- | ----------------- |
   | customer database   | mysql   | 3306        | `<stem>-db`       |
   | cache server        | redis   | 6379        | `<stem>-cache`    |
   | staff intranet      | web     | 80          | `<stem>-intranet` |
   | development server  | ssh     | 22          | `<stem>-dev`      |

   The service is on a safe release with a shut login: the client wants a door, not the player's
   way through it, and the target never offers a root. The briefing never gives the address, so
   the player finds the machine from the router (a root there can `apt install nmap` and sweep the
   LAN). **The public port** is the client's pick from 2022, 8022, 8080, 8443, 13306 and 16379,
   never one the router already forwards or listens on; a test fails if it ever is. Rejected: ftp
   and snmp (snmp is UDP and a different story; too many routes already lean on ftp).

4. **Single-hop only (2026-11-17).** The router is reached straight from outside and the target
   is always inside with no forward of its own, so a front box would add nothing to the path. The
   network is the router and the target. Every contract router forwards 3 or 4 decoys, and here
   they land on the target, sealed as usual, but **no decoy is the kind of service the job
   exposes**, or that service would already be reachable and the job pointless; a test fails if
   one is. A number drawn two-hop that becomes a portforward job is single-hop; its kind changes
   anyway. The pay is the key job's single-hop range, 500–2,000 JSC to the nearest 50.

   **A chained two-hop version is set aside, not rejected (2026-11-17)** — see "Set aside" below.

### The proof

5. **The client asks the game's routing, not the file's text (2026-11-17).** On every mail the
   client materializes the router and asks `machineServing` where the public port leads, then
   checks it lands on the target's address at the inside port named. Whatever the router honours
   counts: a forward written in `nano`, one written by anyone else, and whatever a deny on the
   router does to it. A router that no longer boots reaches nothing, so a bricked router loses the
   job for good. The replies, subject `Contract: <target>`, the first row that fits answering:

   | The mail                          | The reply                                                                            | What changes              |
   | --------------------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
   | No accepted job with this client  | "We have no contract with you."                                                      | nothing                   |
   | A completed job                   | "That job is already closed." (the router is not read)                               | nothing                   |
   | Reaches it, with a wallet         | "We're through. §1,450 sent to jsc…. Pleasure doing business."                       | completed, the pay minted |
   | Reaches it, no wallet             | "We're through. You sent no wallet, so there is nothing to pay. No wallet, no money." | completed, nothing minted |
   | Anything else                     | "Port 13306 doesn't reach their customer database. No way in, no money."             | nothing                   |
   | The read itself fails             | nothing: 500, as any store failure                                                   | nothing                   |

   "Anything else" is one reply for no forward, the wrong machine, the wrong inside port and a
   bricked router; it never says which. Only the mail's wallet matters. A completed job stays
   completed: a later removal of the forward takes nothing back.

### The terms

6. **The kind is called `portforward` (2026-11-17)**, legacy's name and what the job is. The board
   reads `<Client> — open a way into a customer database — §<pay>` (likewise a cache server, a
   staff intranet, a development server), and `hireme.ts show` prints
   `Kind: portforward, <machine>, <public>→<inside>`. `mission-kind-<n>` splits in sevenths on the
   backdoor and infiltrate precedent: each older kind gives up a sliver at one edge, so no number
   moves between older kinds; the fractions are the plan's. Each machine brings three pitches of
   its own, twelve in all ("an auditor needs to look without anyone knowing", "we want their
   numbers live"). The briefing names the machine, the inside port and the public port, never the
   router, an address or `rules.v4`:

   ```text
   We want to reach their customer database from outside.
   Their router should send port 13306 to it, on 3306.

   Write to this address with your wallet address once it is open.
   No way in, no money. No wallet, no money.
   ```

### Accepted as the world already works (2026-11-17)

7. - **Whoever roots the router can close its route** for whoever comes after: `passwd` closes
     hydra, and an `apt upgrade` flashes the firmware, which closes msfconsole and reboots the
     router. A rival can delete the forward. It is "whoever roots a box can close its route", as
     everywhere.
   - **Nothing else on the router climbs.** sshd and the rest stay on safe releases; on the
     msfconsole route only the firmware's critical hole lands root. The 2,000-number shape test
     covers the router as it covers the key box.
   - **A firmware route release exists by `MISSION_ROUTE_DAY` (111):** a critical hole that lands
     root, published on or before that day. A test walks the firmware timelines as one already
     walks the service packages'.
   - **No new tool is needed.** Forwards live only in the router's `rules.v4`
     (`core/network/iptablesRules.ts`); an `snmpset` forward writes the same file through
     `withForward`, so the one check covers both, should the snmp route join later.

### The work

8. **Two slices (2026-11-17).** Slice 1, a portforward job pays on the hydra route: the kind and
   its share of `mission-kind-<n>`, the target with all four machines and their pitches, the
   router's crackable admin, the client's check through `machineServing`, the replies,
   `hireme.ts show`, and a wire-check that drives accept → `hydra` the router → `ssh` →
   `nano rules.v4` → the mail → the payout. Slice 2, the msfconsole route: the firmware pinned to
   a critical release, the half-and-half route draw, the timeline test, and the wire-check
   extended to a firmware contract. Rejected: one PR (the firmware pinning and its timeline test
   are a mechanism of their own, and slice 1 already pays).

### Set aside

- **A chained two-hop portforward (2026-11-17).** The target sits behind an inner router on a
  second layer; the player roots both routers and writes two forwards, at two-hop pay
  (2,000–4,000). Not possible today, for two reasons found in the grill:
  1. **A public forward stops at the first box it reaches.** `resolvePublicTarget` lands on the
     box at the forward's address and, if that box is a router, counts the port only if the router
     itself listens on it (`listensOn`); its own `rules.v4` is never read. The chained walk exists
     only from inside a LAN (`resolveInnerGatewayTarget`, Story 5b).
  2. **Contract networks have no second layer.** Inner routers and deep layers
     (`seedNetworkDepth`) exist on world networks only.

  Agreed order when it is taken up: first the world (a public forward that lands on a router
  follows that router's forwards, one walk shared by the outside and LAN resolvers, with scans,
  `ssh`, `hydra` and the data doors going through it — useful on its own, since today a player
  cannot expose a deep box on their own network), then the contract. Its own grill, not a slice
  of this plan. Recorded in `docs/backlog.md` under "missions — deferred".
- **The snmp and inside-leak router routes** (item 2).
