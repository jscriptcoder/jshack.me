# Mission ideas

Missions are the one legacy system v2 has not rebuilt yet. They were left out of the ship gate on
purpose and will come back as their own epic, redesigned. This folder keeps everything legacy
missions had so the rebuild can borrow from it: the design, every scenario, the contract board, the
rules `mail` used to decide a job was done, and what went wrong.

Nothing here is a spec. It records what legacy did, so v2 can decide what to keep.

## Pages

| Page | Read it for |
| --- | --- |
| [mission-loop.md](./mission-loop.md) | The player's view: the contract board with all 55 of its last contracts, `accept`, the briefing, `mail`, `abort`, commands that changed during a mission, attack-pattern log lines, persistence, dev tooling, ideas worth keeping and the problems legacy had |
| [objectives.md](./objectives.md) | All 14 objective types: briefing text, target choice, what was planted, how `mail` verified it, and every database scenario |
| [script-objectives.md](./script-objectives.md) | `script_fix` (23 broken scripts, three bug kinds) and `script_auto` (26 stubs, local and remote) |
| [white-hat-investigations.md](./white-hat-investigations.md) | `malware` (30 disguised implants, kill and delete) and `forensics` (log trails, noise, calling cards) |
| [mission-variations.md](./mission-variations.md) | The original generation catalog: seed keywords, difficulty tiers, entry variants, network modes, CVE pools, name pools, content templates |

Every page opens with a banner saying its `src/` paths refer to git tag `legacy-final`. To read one:

```bash
git show legacy-final:src/generation/pools/scriptFix.ts
```

## How far legacy got

Legacy missions were already being reworked when the app was retired. Read the older pages with
that in mind:

- **2026-03-07, commit `aa29727d`:** the credential breadcrumbs between hops were removed ahead of
  "tool-based progression", and the board was emptied for the first time. The "Credential Placement
  Templates" and "Hint Templates" sections of mission-variations.md describe the removed design.
- **2026-04-11, commit `7bf5c822`:** the rebuilt 55-contract board was removed, because a CVE lookup
  refactor was expected to break listed seeds. A six-contract test board came and went, and it was
  removed on 2026-04-17.
- **At `legacy-final`:** `missions` prints "MISSIONS ARE GETTING A REWORK". Any seed still generates a
  playable mission through `accept <seed>`.
- **mission-variations.md has drifted from the code.** Its template counts are low, and encrypted
  exfiltrate is keyword-only, not a 25% roll. [objectives.md](./objectives.md#7-design-notes-and-findings)
  lists the corrections.

## What v2 has already decided that touches missions

These were settled while v2 reached parity. A mission design should start from them rather than
reopen them by accident.

| Decision | Consequence for missions |
| --- | --- |
| The ship gate is every door, hydra, discovery and the CVE system, **minus missions**. Missions are a post-ship epic | Missions build on shipped infrastructure: doors, daemons, the patch journal, cross-player reach, CVEs |
| Generated world content exists for **believability, never loot**. No generated text pairs an in-game account with a working secret ([world-content-architecture.md](../world-content-architecture.md), rule 1) | Harvestable credentials and other loot are a missions concern. When they arrive they come through missions, not as scenery |
| Legacy's `snmpd.conf` credential leak was refused, and an RW-community-gated SNMP OID on infrastructure was named as the vehicle for harvestable loot | A ready-made delivery route for mission loot |
| The generated MySQL database is about its own box. Legacy's mission code in `pools/database.ts` (the exfiltrate placement, tamper/fix scenarios, sabotage tables) was deliberately not ported | The `db_*` objectives need their scenarios re-added as a mission layer on top of v2's database |
| Legacy's four script pools (`scriptFix`, `scriptAuto`, `malware`, `forensics`) and the `_system` hook were classed as mission code and not ported. v2's `node` has its own sandbox | A script objective needs its own verification hook designed against v2's `node` |
| v2 shipped `gpg -c` / `gpg -d` (passphrase-based) with nothing in the world producing encrypted files | Missions are the natural producer of ciphertext. Legacy's key-on-another-machine idea fits here |
| Legacy's DNS was mission scaffolding (`.mission` domains). v2 designed its own DNS world | A mission needs no special domain; it can live on v2's DNS |
| findit.io indexes publishers, and a mission board or shop would be "simply one more publisher" | The contract board can be a website players find, not only a command |
| CVE patch delay is 1–2 days, with a 3–14 day safe window | A mission cannot assume a package stays exploitable for long |
| An ESSID is readable without cracking, so a crafted client can learn what players did to a network's NPCs. That leaks nothing today because NPC state comes from a public seed | Revisit it if a mission ever makes NPC state valuable before entry |
| `COMMAND_CATEGORIES` already includes `mission`, and `availability.ts` names `missions`/`accept`/`abort`/`mail` as legacy commands to re-add when they ship | The slots exist in v2's command layer |

## Ideas legacy wrote down and never built

These sat in HTML comments at the end of mission-variations.md, where a rendered page hides them:

- **New machine roles:** a CI server (ports 22/8080/443, users `jenkins`, `deploy`) and a monitoring
  box (ports 22/9090/3000, users `grafana`, `alertops`).
- **New entry variants:** a hidden API endpoint that returns credentials on POST, and a DNS zone
  transfer that reveals internal hostnames and credentials.
- **New objective types:** *plant* (write a given file to a given place), *destroy* (delete or corrupt
  one file), and *chain* (several objectives across several machines).
- **New CVE templates:** Shellshock (CVE-2014-6271) and BlueKeep (CVE-2019-0708). Log4Shell, also
  listed, had already shipped.
- **More target files:** mail spool archives, router firewall rules and VPN client configs.
- **HTTP lateral movement:** choose `http` as a hop method when the next machine serves port 80,
  with credentials in web-readable files.

The ideas worth keeping and the known problems from the code itself are at the end of
[mission-loop.md](./mission-loop.md#6-design-notes-worth-keeping).
