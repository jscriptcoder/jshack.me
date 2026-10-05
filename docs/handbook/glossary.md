# Glossary

Terms used in the code, the docs and commit messages. Game terms describe the simulation; nothing
here refers to a real network or system.

## World and network

| Term                        | Meaning                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ESSID**                   | A WiFi network's broadcast name, which is all a player reads of it (`essidOf(key)`). A landmark's ESSID is also its key.                            |
| **Network key**             | What a network is known by in every seed and stored row: a landmark's ESSID, `r<region>/t<town>/n<k>` for a drawn network, `c<n>` a corporation.    |
| **Landmark**                | One of Ridgemont's 57 hand-written networks (`ESSID_CATALOG`). `isLandmark(key)`; the world draws it no lead, forward or locality.                  |
| **Town row**                | A hand-authored town: a name and a size class (village, town, city). Everything inside it is drawn from it.                                         |
| **Drawn network**           | A network a town's row generates: an institution, business, home, practice or branch.                                                               |
| **Profile**                 | How much stands behind a drawn network's gateway: `lone` (one machine), `flat` (2–5) or `deep` (inner router, switch, hidden chain).                |
| **Lead**                    | A reference on one network's box to another network (a contractor's ssh shortcut, a backup job, an invoice, a head office's branch shortcut).       |
| **Unlisted**                | A publisher whose `robots.txt` keeps it off findit; it still answers by domain or address.                                                          |
| **Branch**                  | A corporation's office in a town. It publishes nothing; only its head office's gateway leads to it.                                                 |
| **Injector**                | The part of a WiFi scan that sometimes (5%) shows a Ridgemont network another player occupies.                                                      |
| **BSSID**                   | An access point's hardware address, derived from the ESSID (first 6 bytes of its SHA-256).                                                          |
| **Access point (AP)**       | A WiFi network a player can crack and join.                                                                                                         |
| **AP gateway**              | The `.1` router of a network. Ownerless; its machine id is `ap-gw-<hash of the ESSID>`. It holds the network's port forwards.                       |
| **Inner gateway**           | A router or switch on a home LAN (not `.1`) that fronts a hidden deep layer.                                                                        |
| **Deep layer / chain**      | Hidden `10.x.y.0/24` networks behind inner gateways, 1–3 levels deep, reached through forwards, or directly from a shell on a box in the chain.     |
| **Terminal machine**        | The one generated machine in a deep layer.                                                                                                          |
| **NPC / generated machine** | Any machine the generator builds (not a player's workstation).                                                                                      |
| **Workstation**             | A player's own machine. Machine id `<name>-<8 hex of sha256('ed25519:' + public key)>`.                                                             |
| **Occupant / occupancy**    | A player connected to a WiFi network, recorded in `home_network_occupants`. Occupancy is what makes a player reachable on that LAN.                 |
| **Lease**                   | A player's permanent LAN address on a network (`network_lan_leases`). Survives disconnects.                                                         |
| **Public IP**               | A network's internet address, derived from its place in the world (`87.<town>.x.y`, or `193` for findit and the corporations). Never stored.        |
| **Publisher**               | A declared network that hosts a public web site with a domain name.                                                                                 |
| **findit.io**               | The in-game search engine, a one-machine network on the public web.                                                                                 |
| **Forward**                 | A line `forward <public port> to <ip>:<port>` in a router's `/etc/iptables/rules.v4`.                                                               |
| **Vantage**                 | Where a request is made from: own LAN, same-WiFi player, public internet, or down an inner gateway's chain. Decided by the server from the address. |
| **Fronted segment**         | The subnet a gateway's forwards may point into.                                                                                                     |
| **Brick**                   | Deleting a box's `/boot/vmlinuz` or `/boot/initrd.img`. The box never boots again; a bricked gateway takes its whole network's public IP dark.      |
| **Boot id**                 | A random marker at `/var/run/boot-id`, replaced by each `reboot`. A session that sees it change has been evicted.                                   |

## Generation

| Term                    | Meaning                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Base tree / base FS** | A machine's generated filesystem before any player changes.                                                                                            |
| **Stream**              | A pseudo-random generator created from one namespaced seed string (`svc-ssh-<essid>-<ip>`). One stream per concern.                                    |
| **Pool**                | Authored static data drawn from by a stream (hostnames, usernames, page text, …).                                                                      |
| **Role**                | A generated machine's purpose (workstation, IoT, web server, file server, database, mail server, DNS). Derived from its hostname prefix, never stored. |
| **Persona**             | A network's category, place and domain, which content is written to match.                                                                             |
| **Catalog**             | `ESSID_CATALOG`, Ridgemont's 57 hand-written landmarks. Closed: a new hand-written network is declared after its town's drawn ones.                    |
| **Declaration**         | `DECLARED_NETWORKS` in `world.ts`: every network the world holds, in an append-only order that fixes keys and addresses.                               |
| **Sample sweep**        | The fixed subset of drawn networks the whole-world content tests read; `WORLD_SWEEP=full` reads them all.                                              |
| **`WORLD_EPOCH`**       | The fixed date all generated history ends and the vulnerability clock starts. A development anchor until launch.                                       |
| **Budget**              | The post-build limits on bundle size and per-machine generation time.                                                                                  |
| **Encode**              | `npm run encode`, which obfuscates spoiler pools into the git-ignored `__encoded.ts`.                                                                  |

## Filesystem and journal

| Term                          | Meaning                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Patch**                     | One change to one file or directory: `{path, content, owner, permissions, nodeType}`.                                          |
| **Journal**                   | All patch rows for a machine, from every writer, in the `patches` table.                                                       |
| **Tombstone**                 | A patch with `content: null` on a file row: a deletion.                                                                        |
| **Writer key**                | The third part of a patch's primary key: who wrote it (a player's key, or `ap:<essid>` for system logs on ownerless machines). |
| **Replay / materialize**      | Build a machine's current tree: base tree plus its journal in server order, last write per path winning.                       |
| **Served tree / served root** | Another player's (or the AP gateway's) tree, materialized by the server and pruned to the caller's tier.                       |
| **Tier / `userType`**         | `guest`, `user` or `root`. Permissions are lists of tiers, not Unix bits.                                                      |
| **Permission walker**         | `core/filesystem/walker.ts`, the one read/write permission check, shared by client and server.                                 |
| **Pidfile**                   | `/var/run/<daemon>.pid`. Its presence means the service is running, on the port it names.                                      |
| **Manifest**                  | `/var/lib/dpkg/status`, the authority for installed package versions.                                                          |

## Sessions and security

| Term                          | Meaning                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Session**                   | "Player P is logged in as user U at tier T on machine M." A row in `sessions` while active.                                                                  |
| **Hop / hop chain**           | A session pushed on the client's stack by `su`, `ssh`, `nc` or an exploit; the stack of them. `exit` pops one.                                               |
| **Base login / seed session** | The bottom of the stack: the player on their own workstation. Never stored on the server.                                                                    |
| **Sub-shell**                 | The `ftp>`, `mysql>` and `redis>` prompts: a restricted interpreter, not a hop.                                                                              |
| **Signed envelope**           | `{payload, publicKey, signature}`: every request to the server.                                                                                              |
| **Timestamp window / skew**   | The server accepts a request only if its `ts` is within 120 seconds of the server clock.                                                                     |
| **L1**                        | The server check that the caller owns the machine or holds an active session on it.                                                                          |
| **L2**                        | The server check, for remote writes, that the session's tier may write the path.                                                                             |
| **Read filter (three tiers)** | Owner sees everything; a session holder sees their tier's view; anyone else sees only what the network could observe.                                        |
| **Trace**                     | A log line an action leaves on the target machine, written by the server.                                                                                    |
| **Source IP**                 | The address a trace records for the actor: derived on the server for visitors from another network or on the same WiFi; stated by the client on its own LAN. |
| **No oracle**                 | The rule that dark states (absent, bricked, stopped, filtered, wrong secret) answer alike.                                                                   |

## Vulnerabilities

| Term           | Meaning                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **CVE**        | An in-game vulnerability, derived from a package, version and game day. Never stored.                                               |
| **Game day**   | Whole days since `WORLD_EPOCH`. The client uses it to render; the server uses its own to authorize.                                 |
| **Timeline**   | A package's seeded sequence of releases, each with its vulnerability and fix delay.                                                 |
| **Axis**       | Where a vulnerability lives: a service (reached through a port), a library (reached locally through a command), or router firmware. |
| **Effect**     | What firing a vulnerability grants: one of eight kinds, from a full shell to reading one file.                                      |
| **Tier floor** | The lowest tier a vulnerability grants, set by its severity.                                                                        |

## Client and shell

| Term                      | Meaning                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| **`CommandEnv`**          | The object every command receives; its only access to the outside world.                        |
| **Seam**                  | One member of `CommandEnv` (for example `env.ssh.authenticatePublic`) wired by the UI.          |
| **Registry**              | The map from command name to (gated) command. The carried registry serves binaries run by path. |
| **Streamed result**       | A command result whose lines arrive over time (`kind: 'async'`).                                |
| **Mode change / overlay** | A result that opens a full-screen app (`nano`, `lynx`, author card).                            |
| **Fresh tab**             | A tab opened by `xterm` with `?fresh`: it skips session rehydration.                            |
| **Rehydration**           | Rebuilding the hop stack from server session rows after a reload.                               |

## Process

| Term                     | Meaning                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **v2**                   | This codebase: the Solid.js rewrite.                                                                                                            |
| **Legacy**               | The retired React app, at git tag `legacy-final`.                                                                                               |
| **Wire-check**           | A `scripts/test*.ts` script that drives the real `api/` endpoints against a local stack.                                                        |
| **Epic / story / slice** | Units of planned work. A slice is one pull-request-sized piece. They appear in commit history and older docs, but are not referenced from code. |
| **Grill**                | A structured question-and-answer session used to settle design decisions before planning.                                                       |
| **Plan**                 | A temporary `plans/<name>.md` for work in flight, deleted when it ships.                                                                        |
| **As-built doc**         | A `docs/*.md` describing a shipped system as it is.                                                                                             |
