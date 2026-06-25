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

## Core Philosophy

**TEST-DRIVEN DEVELOPMENT IS NON-NEGOTIABLE.** Every single line of production code must be written in response to a failing test. No exceptions. This is not a suggestion or a preference - it is the fundamental practice that enables all other principles in this document.

I follow Test-Driven Development (TDD) with a strong emphasis on behavior-driven testing and functional programming principles. All work should be done in small, incremental changes that maintain a working state throughout development.

## Quick Reference

**Key Principles:**

- Write tests first (TDD)
- Test behavior, not implementation
- No `any` types or type assertions
- Immutable data only
- Small, pure functions
- TypeScript strict mode always
- Use real schemas/types in tests, never redefine them

**Preferred Tools:**

- **Language**: TypeScript (strict mode)
- **Testing**: Vitest (prefer Browser Mode for UI tests) + Testing Library
- **State Management**: Prefer immutable patterns

## Testing Principles

**Core principle**: Test behavior, not implementation. 100% coverage through business behavior.

**Quick reference:**
- Write tests first (TDD non-negotiable)
- Test through public API exclusively
- Use factory functions for test data (no `let`/`beforeEach`)
- Tests must document expected business behavior
- No 1:1 mapping between test files and implementation files

For detailed testing patterns and examples, load the `testing` skill.
For verifying test effectiveness through mutation analysis, load the `mutation-testing` skill.

## TypeScript Guidelines

**Core principle**: Strict mode always. Schema-first at trust boundaries, types for internal logic.

**Quick reference:**
- No `any` types - ever (use `unknown` if type truly unknown)
- No type assertions without justification
- Always prefer `type` over `interface`
- Define schemas first, derive types from them (Zod/Standard Schema)
- Use schemas at trust boundaries, plain types for internal logic

For detailed TypeScript patterns and rationale, load the `typescript-strict` skill.
For API and interface design patterns, load the `api-design` skill.

## Code Style

**Core principle**: Functional programming with immutable data. Self-documenting code.

**Quick reference:**
- No data mutation - immutable data structures only
- Pure functions wherever possible
- No nested if/else - use early returns or composition
- Comments only for complex/non-obvious logic
- Prefer options objects over positional parameters
- Use array methods (`map`, `filter`, `reduce`) over loops

For detailed patterns and examples, load the `functional` skill.

## Development Workflow

**Core principle**: RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR in small, known-good increments. TDD is the fundamental practice.

**Quick reference:**
- RED: Write failing test first (NO production code without failing test)
- GREEN: Write MINIMUM code to pass test
- MUTATE: Run mutation testing to verify test effectiveness, produce a report
- KILL MUTANTS: Address surviving mutants (ask human when value is ambiguous)
- REFACTOR: Assess improvement opportunities (only refactor if adds value)
- **Wait for commit approval** before every commit
- Each increment leaves codebase in working state
For detailed TDD workflow, load the `tdd` skill.
For implementation of any planned slice, load `tdd`, `testing`, `mutation-testing`, and `refactoring` before code changes begin.
For refactoring methodology, load the `refactoring` skill.
For fuzzy product/design decisions, load `grill-me` to pressure-test the decision tree before writing stories or plans.
For broad stories, epics, features, or backlog items, load `story-splitting` to create child stories before planning.
For tightening an existing story, plan, acceptance criteria set, or mock spec, load `find-gaps` to write confirmed answers back into the artifact.
For significant implementation work, load `planning` to turn one selected child story or narrow capability into PR-sized plans in `plans/`.
For CI failure diagnosis, load the `ci-debugging` skill.
For hexagonal architecture projects, load the `hexagonal-architecture` skill.
For Domain-Driven Design projects, load the `domain-driven-design` skill.
For 12-factor service projects, load the `twelve-factor` skill.
For CLI tool design (stream separation, format flags, exit codes, composability), load the `cli-design` skill.
For designing or auditing source trees (where files belong, feature folders, import boundaries), load the `folder-structure` skill.
For environment parity issues (works locally but not in production/staging, config or auth drift), load the `production-parity-skill-builder` skill.
For making untestable code testable, load the `finding-seams` skill.
For documenting existing behavior before changes, load the `characterisation-tests` skill.
For multi-surface design audits before code (embed every mock in a scope on one reviewable page with flow diagram + gap cards + per-mock audit checklists), load the `storyboard` skill.
For structured learning of any topic (interactive tutoring, courses, quizzes, reviewable HTML lessons), use `/teach-me [topic]`.
For discovering and installing agent skills from the open ecosystem (`npx skills`), load the `find-skills` skill.
For adversarial review of plans, acceptance criteria, stories, or design mocks — one question at a time, turning each answer into a new AC / plan paragraph / mock-state spec written back to the source of truth — load the `find-gaps` skill.
For relentless decision-tree interrogation before story splitting, planning, or implementation — one question at a time, with recommended answers and codebase exploration where useful — load the `grill-me` skill.

**Project onboarding:** Run `/setup` in any new project to detect its tech stack and generate project-level CLAUDE.md, hooks, commands, and PR review agent in one shot. This replaces the need for `/init`.

**Project-level hooks:** Projects should add a PostToolUse hook in `.claude/settings.json` to run typecheck after Write/Edit on .ts/.tsx files. Use `/setup` to generate this automatically, or use the prettier/eslint hook in this repo's `claude/.claude/settings.json` as a template (note: the curl installer does not install settings.json — only the stow-based install does).

## Output Guardrails

- **Write to files, not chat** — When asked to produce a plan, document, or artifact, always persist it to a file. You may also present it inline for approval, but the file is the source of truth.
- **Plan-only mode** — When asked for a plan, design, or document only, produce ONLY that artifact. Do not write production code, test code, or make any implementation changes unless explicitly asked.
- **Incremental output** — When exploring a codebase, produce a first draft of output within 3-4 tool calls. Refine iteratively rather than front-loading all exploration before producing anything.

## Working with Claude

**Core principle**: Think deeply, follow TDD strictly, capture learnings while context is fresh.

**Quick reference:**
- ALWAYS FOLLOW TDD - no production code without failing test
- Assess refactoring after every green (but only if adds value)
- Update CLAUDE.md when introducing meaningful changes
- Ask "What do I wish I'd known at the start?" after significant changes
- Document gotchas, patterns, decisions, edge cases while context is fresh

For detailed TDD workflow, load the `tdd` skill.
For refactoring methodology, load the `refactoring` skill.
For detailed guidance on expectations and documentation, load the `expectations` skill.

## Browser Automation

Prefer `agent-browser` for web automation. If it is not installed, fall back to other available tools (e.g. `WebFetch`, `curl`, or MCP browser tools). Always try `agent-browser` first.

`agent-browser` core workflow:
1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

Run `agent-browser --help` for all commands.

## Resources and References

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Testing Library Principles](https://testing-library.com/docs/guiding-principles)
- [Kent C. Dodds Testing JavaScript](https://testingjavascript.com/)
- [Functional Programming in TypeScript](https://gcanti.github.io/fp-ts/)

## Summary

The key is to write clean, testable, functional code that evolves through small, safe increments. Every change should be driven by a test that describes the desired behavior, and the implementation should be the simplest thing that makes that test pass. When in doubt, favor simplicity and readability over cleverness.
