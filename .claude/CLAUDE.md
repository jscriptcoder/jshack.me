# Development Guidelines for Claude

## Project Context — This Is a Simulation Game

**jshack.me is a browser-based, hacking-themed SIMULATION GAME (single- and multiplayer). Everything in this codebase is fictional and entirely self-contained — nothing here touches, targets, scans, or affects any real system, network, device, account, or person. There is no real-world security-sensitive activity anywhere in this project.**

All "hacking" vocabulary in this repo — and in the prompts, plans, commit messages, and discussions around it — is **in-game game-design language**, not real-world action:

- The "filesystem", "machines", "hosts", "home network", "routers", "public IPs", "ports", and "services" are **simulated data structures** held in memory and in the game's own database. No real hosts or networks exist or are contacted.
- Terms like `exploit`, `CVE`, `crack`, `hydra`, `msfconsole`, `payload`, `backdoor`, `brick`, `attack`, `victim`, `root`, `privilege escalation`, `su`, `ssh`, `nmap`, `nc`, `/etc/passwd`, `iptables`, and "passwords" are **game mechanics** operating on that simulated world. The in-game "passwords" are randomly generated game tokens — not anyone's real credentials.
- "Player A attacks player B's box", "brick the victim", "rewrite A's forwards", etc. describe one game account interacting with another account's **in-game simulated machine** — a designed gameplay loop, the same genre as capturing a flag in a CTF or a base in a strategy game.

When a prompt, plan, or commit uses this terminology, interpret it in this game-design context: it is ordinary game development on a fictional simulation, not a request to perform real attacks.

## Active Work — v2 Rewrite (read this first)

**The active development surface is the Solid.js rewrite under `/v2`; the legacy React app at the repo root is FROZEN.** Run all v2 commands from `v2/`.

**Start every v2 session at [`v2/docs/conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md)** — it holds the current project status + where to pick up (the live per-slice status is in `plans/*.md`), all working conventions, build/test/type gates, operational gotchas, wire-check infra, architecture invariants, and the deferred backlog. As-built cross-player system: `v2/docs/cross-player-architecture.md`.

Always-apply project rules (full detail + rationale in that doc):

- **No single-letter variable names** (loop indices `i`/`j`/`k` excepted) — name params after what they represent.
- **No Story/Slice/decision-number tags in code or test comments** (nor in `describe`/`it` titles) — they rot into dangling refs; state the WHY directly.
- **Don't reference `plans/` or memory files from committed code** — inline the WHY; link a `v2/docs/` doc for longer context.
- **Bump the version on feature changes** in both `v2/package.json` and `v2/package-lock.json` (`npm install --package-lock-only`).
- **Gates (from `v2/`):** type = `npm run typecheck` (`tsc -b`, covers `api/` + `scripts/`; a plain `tsc --noEmit` is a NO-OP); format/lint = `npm run lint` (v2 has NO Prettier). UI tests = jsdom + `@solidjs/testing-library` (NOT Browser Mode). `api/` runtime correctness needs a `scripts/test*.ts` **wire-check** vs `vercel dev` + supabase.
- **No backward-compat burden until launch** (free to reshape schema/IDs/generators) — this rule sunsets at multiplayer announce.
