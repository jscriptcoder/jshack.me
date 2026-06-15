# v2 docs — as-built reference

Durable, versioned documentation for the **shipped** v2 system. These docs describe how
v2 actually works _today_ (architecture, invariants, gotchas), so the knowledge survives
plan deletion and isn't trapped in anyone's local notes.

## Where knowledge lives (and why)

| Home                      | Holds                                                                                       | Lifetime                         |
| ------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| **`v2/docs/`** (here)     | **As-built** architecture, invariants, and operational gotchas for the shipped system       | Versioned with the code; durable |
| `docs/rewrite-blueprint/` | **Design intent** — the forward-looking blueprint written while planning the rewrite        | Historical reference; may drift  |
| `plans/`                  | PR-sized implementation plans + epic story-splits (the `planning`/`story-splitting` skills) | **Deleted on completion**        |
| `~/.claude` memory        | Working-style feedback, preferences, short-lived resume/status pointers                     | Author-local; not team docs      |

**Rule of thumb:** if a fact must survive the next plan deletion, be shared with the team,
or be referenced from a code comment, it belongs here — not in `plans/` and not in memory.
(Code comments may reference `docs/`; they must NOT reference `plans/` or memory files, which
are transient or author-local.)

These docs describe behaviour and invariants, not line-by-line code — read them with the
source. Each doc lists the key files so you can jump in. When a doc's claim and the code
disagree, the code wins; fix the doc.

## Index

- [cross-player-architecture.md](./cross-player-architecture.md) — how one player scans,
  enters, reads, and modifies another player's machine: the shared patch journal, the
  public-IP registry, L1/L2 authorization, and the server-side read filter (Stories 1–3
  of the multiplayer/cross-player epic, shipped).
