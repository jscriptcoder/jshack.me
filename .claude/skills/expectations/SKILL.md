---
name: expectations
description: Working expectations and documentation practices. Use when capturing learnings, documenting gotchas, recording architectural decisions, or understanding how to work with a codebase. Triggers on "document this", "remember this pattern", "what should I know about", or after completing significant features.
---

# Expectations

## When Working with Code

1. **ALWAYS FOLLOW TDD** - No production code without a failing test. Non-negotiable.
2. **Think deeply** before making any edits
3. **Understand the full context** of the code and requirements
4. **Ask clarifying questions** when requirements are ambiguous
5. **Think from first principles** - don't make assumptions
6. **Assess refactoring after every green** - but only refactor if it adds value
7. **Keep project docs current** - Update CLAUDE.md when introducing meaningful changes

## Documentation Framework

**At the end of every significant change, ask: "What do I wish I'd known at the start?"**

Document if ANY of these are true:
- Would save future developers significant time
- Prevents a class of bugs or errors
- Reveals non-obvious behavior or constraints
- Captures architectural rationale or trade-offs
- Documents domain-specific knowledge
- Identifies effective patterns or anti-patterns
- Clarifies tool setup or configuration gotchas

## Types of Learnings to Capture

- **Gotchas**: Unexpected behavior discovered (e.g., "mergeExtraDirectories overwrites factory-created /usr/ if not one-level-deep merged")
- **Patterns**: Approaches that worked particularly well
- **Anti-patterns**: Approaches that seemed good but caused problems
- **Decisions**: Architectural choices with rationale and trade-offs
- **Edge cases**: Non-obvious scenarios that required special handling
- **Tool knowledge**: Setup, configuration, or usage insights

## Documentation Format

```markdown
#### Gotcha: Mission patches replayed on wrong filesystem

**Context**: When reloading a tab with an active mission
**Issue**: Mission filesystem patches were applied before regenerating the mission network from seed, causing patches to apply to the static localhost filesystem instead
**Solution**: Always regenerate mission from seed first, then replay cached mission patches on top

// CORRECT - Regenerate first, then apply patches
const mission = generateMissionNetwork(cachedSeed);
const filesystems = applyPatches(mission.filesystems, cachedMissionPatches);

// WRONG - Applying patches without regeneration
const filesystems = applyPatches(staticFilesystems, cachedMissionPatches);
```

## Code Change Principles

- **Start with a failing test** - always. No exceptions.
- After making tests pass, always assess refactoring opportunities
- After refactoring, verify all tests and static analysis pass, then commit
- Respect the existing patterns and conventions
- Maintain test coverage for all behavior changes
- Keep changes small and incremental
- Ensure all TypeScript strict mode requirements are met
- Provide rationale for significant design decisions

**If you find yourself writing production code without a failing test, STOP immediately and write the test first.**

## Communication

- Be explicit about trade-offs in different approaches
- Explain the reasoning behind significant design decisions
- Flag any deviations from guidelines with justification
- Suggest improvements that align with these principles
- When unsure, ask for clarification rather than assuming
