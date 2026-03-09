# Agents

Specialized Claude Code agents that advise during different phases of development.

> **Attribution:** These agents were borrowed from
> [citypaul/.dotfiles](https://github.com/citypaul/.dotfiles) and adapted to the JSHACK.ME
> project's domain.

## Available Agents

| Agent                 | Purpose                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| **docs-guardian**     | Creates and improves world-class documentation using 7 quality pillars    |
| **learn**             | Captures institutional knowledge and documents insights into CLAUDE.md    |
| **pr-reviewer**       | Analyzes PRs against TDD, testing, TypeScript, functional, and quality    |
| **progress-guardian** | Tracks multi-step feature work using plan files in `plans/`               |
| **refactor-scan**     | Guides refactoring decisions after tests pass (GREEN phase)               |
| **tdd-guardian**      | Enforces Test-Driven Development using the RED-GREEN-REFACTOR cycle       |
| **ts-enforcer**       | Guards TypeScript strict mode compliance — no `any`, proper schemas, etc. |

## When to Use

- **Starting work?** — `progress-guardian` (create a plan)
- **Writing tests?** — `tdd-guardian` (guide TDD process)
- **Code written?** — `ts-enforcer` (verify type safety)
- **Tests green?** — `refactor-scan` (assess improvements)
- **Feature complete?** — `learn` (capture learnings), `progress-guardian` (close plan)
- **Creating docs?** — `docs-guardian` (ensure quality)
- **Reviewing a PR?** — `pr-reviewer` (systematic analysis)
