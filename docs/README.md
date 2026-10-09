# jshack.me docs — as-built reference

Durable, versioned documentation for the **shipped** v2 system. These docs describe how
v2 actually works _today_ (architecture, invariants, gotchas), so the knowledge survives
plan deletion and isn't trapped in anyone's local notes.

## Where knowledge lives (and why)

| Home                         | Holds                                                                                       | Lifetime                         |
| ---------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| **`docs/handbook/`**         | **The maintainer's handbook**: the whole system explained for a new engineer, one chapter per subsystem | Versioned with the code; updated in the same PR as the behaviour |
| **`docs/*.md`** (here)       | **As-built** architecture, invariants, and operational gotchas for the shipped system       | Versioned with the code; durable |
| `docs/legacy/rewrite-blueprint/` | **Design intent** — the blueprint written while planning the rewrite, a snapshot of legacy | Historical reference; frozen |
| `docs/mission-ideas/`        | **Legacy mission design + scenario catalog** — input to the missions rebuild                | Reference until missions ship    |
| `docs/legacy/`               | **The retired React app's design docs**; its source is at git tag `legacy-final`            | Historical reference; frozen     |
| `plans/`                     | PR-sized implementation plans + epic story-splits (the `planning`/`story-splitting` skills) | **Deleted on completion**        |
| `~/.claude` memory           | Working-style feedback, preferences, short-lived resume/status pointers                     | Author-local; not team docs      |

**Rule of thumb:** if a fact must survive the next plan deletion, be shared with the team,
or be referenced from a code comment, it belongs here — not in `plans/` and not in memory.
(Code comments may reference in-repo docs under `docs/` — but must NOT reference
`plans/` or memory files, which are transient or author-local.)

These docs describe behaviour and invariants, not line-by-line code — read them with the
source. Each doc lists the key files so you can jump in. When a doc's claim and the code
disagree, the code wins; fix the doc.

## Index

- [handbook/](./handbook/README.md) — **start here.** The maintainer's handbook: architecture,
  every subsystem and its algorithms, the server and database reference, testing, deployment
  and operations, known issues, and a glossary. Written so an engineer new to the project can
  maintain it alone.
- [project-status.md](./project-status.md) — where the project stands, where to pick up next,
  and the arc of how it got here.
- [conventions-and-gotchas.md](./conventions-and-gotchas.md) — the long-form record: working
  conventions, build/test/type gates, mutation conventions, operational gotchas (the 3100
  squatter etc.), wire-check infra, architecture invariants, and git conventions. Search it
  rather than reading it end to end.
- [backlog.md](./backlog.md) — deliberately deferred work and future content ideas.
- [cross-player-architecture.md](./cross-player-architecture.md) — how one player scans,
  enters, reads, and modifies another player's machine: the shared patch journal, the
  public-IP registry, L1/L2 authorization, and the server-side read filter (Stories 1–3
  of the multiplayer/cross-player epic, shipped).
- [world-content-architecture.md](./world-content-architecture.md) — what every generated
  machine holds and the standing rules for adding to it: personas, true references, frozen
  history in `.1` rotations, one stream per concern, version-free content, and the budgets
  (the generated world content epic, shipped).
- [procedural-world-architecture.md](./procedural-world-architecture.md) — the declared world
  beyond one WiFi scan: Harrow Valley's eleven towns, network keys and names, addresses derived
  from a network's place, the scan's pool and injector, joins, how every network is reached, and
  how to add a town (the procedural world epic, shipped).
- [discovery-architecture.md](./discovery-architecture.md) — names and the public web: the
  in-game DNS, publisher networks, and the findit.io search engine.
- [vulnerability-architecture.md](./vulnerability-architecture.md) — the vulnerability system:
  the world clock, package timelines, the three axes, effects, and the defender's loop.
- [tutorials-architecture.md](./tutorials-architecture.md) — the in-game tutorials: the home
  `README`, hackademy.io's ten chapters and example scripts, the rules every chapter keeps, the
  tests that hold them, and how to add a chapter (the in-game tutorials epic, shipped).
- [e2e-shared-network-verification.md](./e2e-shared-network-verification.md) — two-player
  browser journeys against a local stack, and a coverage map.
- [legacy/rewrite-blueprint/](./legacy/rewrite-blueprint/README.md) — the design-intent blueprint for the rewrite
  (sections 01–07 + `core-contracts.md` + `decisions.md`). Split-by-section is the single
  source of truth; the old monolithic `rewrite-blueprint.md` was dropped (it had drifted
  stale). Start at [legacy/rewrite-blueprint/README.md](./legacy/rewrite-blueprint/README.md).
- [mission-ideas/](./mission-ideas/README.md) — how legacy missions worked
  and every scenario they shipped, kept as inspiration for the missions rebuild.
- [legacy/](./legacy/README.md) — the retired React app's design docs and
  how to read its source from the `legacy-final` tag.
