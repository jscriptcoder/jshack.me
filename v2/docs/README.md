# v2 docs — as-built reference

Durable, versioned documentation for the **shipped** v2 system. These docs describe how
v2 actually works _today_ (architecture, invariants, gotchas), so the knowledge survives
plan deletion and isn't trapped in anyone's local notes.

## Where knowledge lives (and why)

| Home                         | Holds                                                                                       | Lifetime                         |
| ---------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| **`v2/docs/*.md`** (here)    | **As-built** architecture, invariants, and operational gotchas for the shipped system       | Versioned with the code; durable |
| `v2/docs/rewrite-blueprint/` | **Design intent** — the forward-looking blueprint written while planning the rewrite        | Historical reference; may drift  |
| `plans/`                     | PR-sized implementation plans + epic story-splits (the `planning`/`story-splitting` skills) | **Deleted on completion**        |
| `~/.claude` memory           | Working-style feedback, preferences, short-lived resume/status pointers                     | Author-local; not team docs      |

**Rule of thumb:** if a fact must survive the next plan deletion, be shared with the team,
or be referenced from a code comment, it belongs here — not in `plans/` and not in memory.
(Code comments may reference in-repo docs — `v2/docs/`, `docs/` — but must NOT reference
`plans/` or memory files, which are transient or author-local.)

These docs describe behaviour and invariants, not line-by-line code — read them with the
source. Each doc lists the key files so you can jump in. When a doc's claim and the code
disagree, the code wins; fix the doc.

## Index

- [conventions-and-gotchas.md](./conventions-and-gotchas.md) — **start here.** Project arc
  & current status (5b.4 done @ v0.82.0; next 5b.5), working conventions, build/test/type
  gates, mutation conventions, operational gotchas (the 3100 squatter etc.), wire-check
  infra, architecture invariants, git conventions, and the deferred backlog / future ideas.
- [cross-player-architecture.md](./cross-player-architecture.md) — how one player scans,
  enters, reads, and modifies another player's machine: the shared patch journal, the
  public-IP registry, L1/L2 authorization, and the server-side read filter (Stories 1–3
  of the multiplayer/cross-player epic, shipped).
- [rewrite-blueprint/](./rewrite-blueprint/) — the design-intent blueprint for the rewrite
  (sections 01–07 + `core-contracts.md` + `decisions.md`). Split-by-section is the single
  source of truth; the old monolithic `rewrite-blueprint.md` was dropped (it had drifted
  stale). Start at [rewrite-blueprint/README.md](./rewrite-blueprint/README.md).
