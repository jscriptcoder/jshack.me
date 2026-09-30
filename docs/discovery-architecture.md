# Discovery: names and the public web (as-built)

A player starts knowing only the wifi in range. Discovery is how they reach past it —
first to the machines on a network they have cracked (including the ones behind its deep
layers), then to networks they were never told about at all. Two doors deliver it:

- **X1 — DNS.** `nslookup`/`dig`, a name that works anywhere an address does, and a
  zone transfer that hands over a whole organisation's address plan across every layer.
- **X2 — the public web.** Institutional networks publish their own websites at stable
  domains, and `findit.io` is a search engine over them (and over players' own pages), so
  a player finds a network by searching for what it does.

This is the shipped model of Phase 2 of the legacy-parity epic: X1 (#487–#490,
v0.206.0–v0.209.0, closed 2026-09-08) and X2 (#551–#562, v0.265.0–v0.276.0, closed
2026-09-26). The epic's plan file was retired on close-out; this doc holds the design and
its accepted costs.

It sits on the generators it does not re-describe — the LAN and deep-layer topology, role
and service placement, and the generated site content (`world-content-architecture.md`) —
and on the cross-player reachability, forwarding and trace machinery
(`cross-player-architecture.md`). Live browser walkthroughs of both doors are Acts 8–10
(web tools) and the X1 acts in `e2e-shared-network-verification.md`.

Source: `src/core/network/resolveName.ts` and `http.ts` (name resolution), the `dig`/
`nslookup` commands and `generation/generateDnsZone.ts` (X1), and `src/core/findit/`,
`generation/publisher.ts`, `generation/siteServer.ts`, `generation/findit.ts` (X2), and
the `whois` command (the registry over the world's addresses).

## X1 — DNS

### One shared resolve step, client-side

A name works anywhere an address does. `addressForTarget` (`network/resolveName.ts`) is
the ONE step every target-taking command calls before its existing IP path — `ssh`,
`curl`, `nmap`, `ftp`, `nc`, `scp`, `lynx`. No command learns what DNS is; an
unresolvable name passes through unchanged so each reaches its own unknown-target answer.
(`gobuster` and `hydra` stay out.)

Resolution is **client-side and needs no round trip**, because a generated network is a
pure function of its ESSID: `web-04.acme-corp.lan → 192.168.x.y` is computed, not looked
up. This is a correctness choice, not a performance one — a lookup that needed the server
would be inventing a dependency on deterministic data.

The name grammar is `<host>.<essid-slug>.lan`, with the bare hostname (`web-04`)
resolving too, the way a resolver appends its search domain. The order inside
`resolveName`:

1. **World names first** — X2's publisher domains (`ridgemont.edu`), from `siteAddress`.
2. **The network's own LAN** — the gateway resolves any host it handed a DHCP lease to
   (`resolveLanName`), which is what a real home router does. Useful on the first network
   a player cracks.
3. **The occupant fallback** — a name matching nothing generated asks `resolveOccupants`,
   so a fellow player visible in an `nmap` scan can also be named. (The one thing here
   that is not pure; a player who names their box `acme.com` still cannot take Acme's
   traffic, because world names resolve first.)

### The zone, and what the transfer is worth

Roughly one network in seven has a DNS box (the 3% `dns` role, over a 3–8 host LAN). It is
authoritative for the ENTIRE network — Layer 1's hosts plus every deep layer's NPC and
child gateway, down to the seeded depth — reusing the existing `lanHostIdentity` chain
walk rather than a second traversal. The zone lists what an admin would name: webserver,
database, mailserver, fileserver, dns, and the gateways and switch. **Workstations and IoT
stay out** — they are DHCP clients no authoritative zone carries, they already resolve
through the gateway, and keeping them out is what lets the file stay generated, offline and
free of a cross-player round trip (fellow players are dynamic occupants).

**The value is the boundary the transfer crosses, not the transfer itself.** `nmap`
already sweeps the LAN you stand on, and `deepScanHosts` reaches a layer behind an inner
gateway — but only from a pivot vantage, so mapping Layer 3 means rooting Layer 2's
gateway first, in order. A zone transfer removes that ordered cost, for RECON alone:
knowing an address is not reaching it, so the NAT forward and the credential are untouched.
That is why the zone spans layers — against a network you are inside, a same-layer transfer
would be nearly a duplicate scan.

| Fact | Rule |
|---|---|
| Service row | full `dns` row in `SERVICE_CATALOG`, `named.pid`, port **53/tcp**, placed on dns-role boxes; `nmap` shows `53 open domain`, which is how the box worth transferring is found |
| `apt install dnsutils` | ships `dig` and `nslookup` (they leave `SYSTEM_UTILITY_NAMES`); a fresh box answers `command not found` until then |
| Transfer gate | ~3 in 4 DNS boxes allow it (`allow-transfer` open is BIND's own default); the rest answer `; Transfer failed.` |
| Authority | the zone FILE (`/etc/bind/zones/db.<zone>`) — one authority, so a rooted box's edited zone is what the next player's transfer returns (a poisoned zone, no new machinery), while resolution stays with the gateway so the lie misleads only the reader |
| Output | `dig` prints A records only; the file keeps a full real SOA header a player can `cat` (realism in static text, simplicity in a one-line filter) |
| Trace | `/var/log/named.log` records the transfer and the refused attempt with the source; ordinary lookups write nothing (BIND's real default, and a query log would fill with the traffic of ordinary play) |
| Pacing | none — every name here is local memory; a paced lookup would train players to type addresses |

The trace is the door's ONLY `api/` work (`recordZoneTransfer`, one signed
fire-and-forget action + its wire-check), which is why it was its own slice. The client
says only WHICH network and WHICH server; the server derives the source IP from the
verified key, stamps its own clock, and recomputes the verdict.

**Refused, not deferred:** a zone authoritative for RESOLUTION as well (it needs a server
round trip per lookup and reopens the gateway-resolves rule); MX, CNAME and TXT records
(each a second authority over a fact the world already states); `dig -x` and `host`.

## X2 — the public web

### Publishers are ESSID networks, not a second kind

There is no internet-only network kind. A subset of the 50 catalog networks — the
institutional categories (university, corporate, café, public, government, retail) —
each gets a seeded gateway forward (public `:80` → its own webserver), so "the
university's website" is the university network's own webserver, now reachable from the
internet. Residential, IoT and hacker networks never publish.

The category decides who publishes, with no dice: a publishing network is GUARANTEED a
webserver (the lowest-addressed sibling is overridden into one if none rolled), and its
gateway forwards `:80` to it. "The police have a website" is true every time, and every
publisher is in the index, so the index is predictable to build and test.

**Publishing IS exposure.** The forward makes a publisher's webserver reachable from
anywhere: `nmap <domain>` shows the gateway's `22` plus the forwarded `80`, `-sV` shows
the webserver's version, and a live CVE on it is exploitable across networks through the
existing routing — a shell there lands INSIDE the LAN without the wifi ever being cracked.
That is the point: wifi and the internet are two routes into one network.

### The small world DNS

Every publishing network has a domain (`ridgemont.edu`, `harbor-cafe.com`,
`metro-police.gov`) that resolves from anywhere to that network's public IP; `findit.io`
is one more entry. A publisher's address is **its network's place in the world**, like
every network's: `publicAddress(essid)` in `core/generation/world.ts`. A town's publishers
answer in its region's block (Ridgemont's at `87.1.x.y`); findit and the corporations
answer in the placeless `193` block. A test over the whole world proves every address
distinct. The world DNS is then a pure client-side table (`siteAddress`, domain → derived
IP), and the server's public-IP lookup (`networkAt`) is the same derivation run backwards —
so a publisher is reachable before anybody has joined it, with no seeding step.

An `ESSID_CATALOG` entry carries an optional `site: { domain, name }` naming the
institution it hosts. **One website per institution:** the university's five networks put
the site on `CAMPUS-GUEST-OPEN` alone; a test holds that only institutional-category
entries carry a `site` and each institution is hosted exactly once. A bare address is
treated as a URL (`parseTypedUrl` defaults a scheme-less string to `http://`), as real
`curl` and `lynx` do.

### whois: who holds an address

`whois <ip|domain>` (its own apt package) is the world DNS read the other way: from an
address, or a domain resolved through `siteAddress`, to the network behind it. It answers
from the declaration alone (`networkAt`, then `declaredNetwork`), so it is client-side,
asks no server, logs nothing on the target and answers the same whether anybody is on the
network. It still needs a joined network, as `nslookup` does, because the registry is out
on the internet.

| Field | Rule |
|---|---|
| Header | `% Harrow Valley registry`, the name of region #0 |
| `netname:` | the network's ESSID, so an address in a trace becomes a name a player can look for in a scan; findit broadcasts nothing, so its key is spelt as one, `FINDIT-IO` |
| `org-name:` | the site's name; a network with no site is a line from its town's ISP, `<Town> Broadband` |
| `domain:` | only for a network with a site, so an address query also gives up its domain |
| `city:`, `region:` | only for an address in a region's block; findit and the corporations answer in the placeless `193` block and stand in no town |
| No match | `%ERROR:101: no entries found`, exit 1, for anything no network holds, even an empty address inside a town's block |

One record per network, never a town's or a region's block: a block record for an empty
address would only repeat what the first two octets already say. `whois` does show whether
an address is held, as `nmap` on a public address already does, and there are no shell
loops to sweep a block with.

### findit.io

`findit.io` resolves through the world DNS to its own reserved derived address and is a
**real, attackable one-machine box** (`sshd` + `nginx`, root from the uncrackable pool, a
`dpkg/status` on the CVE timeline — so it falls only when a window opens, on the world's
schedule, with no bespoke weakness). It is its own one-machine network keyed `findit.io`
(never broadcast); its "AP gateway" tree IS the findit box, so fetch, scan, login, exploit
and logging all reach it through the gateway arm with no new resolver.

`resolveHttpFetch` answers findit's address from a pure `core/` search function instead of
a file read — **v2's first dynamic HTTP handler**. The rule it sets: an address with a
registered handler answers from a pure function, everything else reads a file. The handler
runs only after `resolveWebTarget` succeeds, so a bricked or nginx-stopped findit takes
search down with it, exactly as it would a file. `/` serves findit's own
`/var/www/html/index.html`, so a rooted findit can be defaced without poisoning anybody's
results — the index is always a VIEW over the publishers' pages, never a file on findit.

**The index is live and computed per search**, never stored:

- Every publisher's homepage is read as served NOW (patches included), in ONE batched
  patch query over ~64 machines (gateways + site servers). A rewritten `index.html`
  changes its own listing at the next search; a dark publisher (bricked, stopped,
  filtered) is absent.
- **Players are crawled, not submitted.** Every page on a public `:80` is listed — player
  or NPC — decided at query time through the same resolution a `curl` makes, so a player
  who leaves the wifi or stops nginx simply drops out. Being public is already deliberate
  (a fresh gateway forwards nothing), which is what makes automatic listing fair.
- **Opt out with `robots.txt`.** `robotsAllowFindit` (`findit/robots.ts`) reads it the way
  a real crawler does: `Disallow: /` opts out only inside a `User-agent: *` or
  `User-agent: findit` group (a `findit` group, when present, is the only one obeyed); a
  colonless line is ignored without ending its group (RFC 9309). A generated publisher
  never emits `Disallow: /`.
- **The crawl writes nothing** — no `access.log` line on a crawled box, which also avoids
  leaking findit's search traffic to every listed player.

Scoring (`findit/search.ts`) reads only `/index.html` — title (3) > meta description (2) >
visible body text (1), summed across whitespace-split lower-cased terms, positive scores
only, at most ten, ties by domain. Generated homepages carry a `<meta name="description">`
derived from the catalog place and category, so "admissions" finds the university and
"parking" finds the airport. Everything read is on the page, so a player shapes their own
listing by editing their own `index.html` — **SEO as play**, and players can outrank
institutions by stuffing titles, intended.

A result shows title, domain and description; a **player's page shows its bare public IP**
(no catalog domain), which is a deliberate tell — an IP-only result is a person's box.
Every interpolated string is HTML-escaped, load-bearing because other players author the
titles. The response is legacy's self-documenting HTML: a `GET` form that IS the
documentation, an `<ol>` of ≤10 results, served raw to `curl` and rendered to `lynx`
(which can submit the form itself — `formSubmissionUrl` follows it through the same path as
a link).

### Rooting findit: the prize and the restore

Every public hit already lands in findit's `/var/log/access.log` under a server-derived
source IP, and the log records the raw path including the query — so a rooted findit reads
**who searched for what from where**, intel on other players. Reading it needs only any
shell (`access.log` is world-readable); defacing the front page needs a root-tier full
shell, whose window is on the world clock (nginx's opens ~day 106).

Nothing in the world heals findit. `scripts/restoreFindit.ts` is the operator's undo, and
it is a **reboot**: it ends every open session on findit (`rebooted`), empties its
`patches`, and writes a fresh boot marker — in that order, so a shell that stood on the old
box has its writes refused mid-restore and cannot survive onto the clean one. Wiping the
journal alone would leave a standing root shell still root on the clean box.

### Leads: the only way to a home

A town beyond Ridgemont keeps homes as well as publishers (Millbrook draws 4–8 on
`town-homes-<town key>`, appended after its businesses so no earlier key or address
moves). A home publishes nothing: no domain, no findit listing, no place on the town
directory, no wifi a player can scan. `whois` on its address still answers, with
`<Town> Broadband` as its organisation, but nothing tells a player that address exists.

What leads there is a **relation** (`generation/relations.ts`): a lead kept on a
publisher's box to a door on another network of the same town. Each is drawn on the side
it leads TO, on `relations-<key>` (a home 1–3, a publisher 0–2), and the side it comes
FROM reads the same value by asking its town, so the lead and the door cannot disagree.
Only a listed publisher of the same town keeps one. The door is the box behind the
target's forwarded ssh when its gateway keeps one, else the gateway's own sshd on `22` as
`root`. Two kinds log in there, and a third leads to an unlisted business (below):

- **The IT contractor.** An office with a desk keeps a shortcut to every client in the
  desk owner's `~/.ssh/config` (`Host <client wifi, lowercased>`, its address, the
  account, a `Port` off `22`) and the matching `known_hosts` line. Millbrook's is
  Keystone Logistics' `laptop-33`, which reaches every other business and five homes.
- **The offsite backup.** A business with a file server copies `/srv` every night to a
  home, never to another business, and a home that lets ssh in from outside always
  receives one. The file server's `/etc/crontab` runs
  `rsync -az /srv/ <account>@<address>:backups/<source>/ -e 'ssh -p <port>'`, its
  `syslog.1` and `auth.log.1` show the run, and the box at the other end keeps the share
  file for file under `~/backups/<source>/` (`generation/offsiteBackups.ts`).
- **The supplier.** An unlisted business's invoice, on the working share (`/srv/share`,
  never a snapshot box) of a listed publisher it supplies:
  `/srv/share/invoices/<supplier wifi, lowercased>-<number>.txt`, naming it by site name
  and domain, with its arrival in the share's `vsftpd.log.1`
  (`generation/supplierInvoices.ts`). Drawn on `relation-supplier-<key>`, after the
  target's other leads, so they kept their draws. Millbrook's is Harvest Market's, on
  Keystone Logistics' `share-102`.

Following one takes the shipped verbs: `cat` the shortcut or the crontab on a box the
player is on, `whois` the address, `nmap` it for the forwarded port, `ssh -p` in as the
account the lead names. A lead gives up where and who, never a password: the door is
still cracked or exploited like any other. Every network the world declares is found on
findit, in Ridgemont, on its town's directory, or by a lead kept on one of those, and a
test over the whole declaration holds it (`world.test.ts`, "the reach of the world").

### Unlisted sites

About 15% of a town's publishers keep their site off every search:
`max(1, round(15%))`, picked on `town-unlisted-<town key>` and flagged `unlisted` on the
declaration (Millbrook unlists Harvest Market). The council is never picked: its directory
is how the town's unlisted institutions are found, so it must be found first. An unlisted
site's `robots.txt` reads `User-agent: *` / `Disallow: /` and nothing else, in place of
whatever it drew (the draws are still made, so nothing after them moves). findit needs no
change: its live crawl already honours `robots.txt`, so the site answers `curl` by its
domain or address and is never listed, whatever the search.

A player finds one the other ways: an unlisted institution stays on its town's directory,
and an unlisted business is always the target of a supplier lead (above). Rewriting the
`robots.txt` lists it like any other site.

### New categories

`government` (police, city hall, courts — `ridgemontpd.gov`, `ridgemont.gov`,
`ridgemontcourts.gov`) and `retail` (four general-goods shops) were X2's closing slices,
one per slice. A category is not a label: ten-plus content pools are typed
`Record<NetworkCategory, …>`, so the compiler refuses a half-written one — every pool
(MOTDs, notes, mail, share folders, front pages, site pages, people roles, database
archetype, persona place, work history) was filled in the same PR, and each brought one new
database application (`cases`, `shop`) with its redis store and mail threads. Everything is
appended to `NETWORK_CATEGORIES` and `ESSID_CATALOG`, so no existing network's LAN or
content changes (both keyed by ESSID; snapshot tests hold it), at the cost that every scan
now draws from more crackable networks and an uncatalogued network from more kinds.

## Two lessons worth keeping

- **Measure a proposed fix against the whole world before planning it.** Two X2 risks
  (a publisher served by an `api-`/`portal-` box showing the wrong kind of site; a `mysql`
  service drawn onto a router being unreachable) were each first written up with a fix from
  a single example — and each fix was wrong when measured across the world. The real causes
  were ordering in the site builder (#560) and the web tools reading a device as an
  ordinary machine while the data doors read it correctly (#561). This is recorded in
  `conventions-and-gotchas.md`'s memory as a standing rule.
- **A negative result needs evidence the question was asked.** Several X2 browser probes
  reported "no network found" when the real fault was an unstarted game, an unsupported
  selector, or a filter that could never match; the fix each time was a control known to
  succeed, or a guard distinguishing "scanned and absent" from "never scanned".

## Deliberately NOT built (recorded so nobody re-opens them)

Legacy's internet-only `world_networks` kind (the catalog already expresses what a network
is; stays open if publishers prove thin); any in-world pointer to `findit.io` (the later
tutorial names it); player domains (a name needs a round trip or a synced table); result
pagination; an in-world findit restore; a crawl beyond `/index.html`; and X1's refused set
above. Missions and products (legacy's `techparts.io`) stay post-ship — under this design a
mission board or a shop is simply one more publisher findit indexes.
