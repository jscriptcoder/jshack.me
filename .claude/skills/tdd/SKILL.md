---
name: tdd
description: Test-Driven Development workflow. Use for ALL code changes - features, bug fixes, refactoring. TDD is non-negotiable.
---

# Test-Driven Development

TDD is the fundamental practice. Every line of production code must be written in response to a failing test.

**For how to write good tests**, load the `testing` skill. This skill focuses on the TDD workflow/process.

---

## RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR Cycle

### RED: Write Failing Test First
- NO production code until you have a failing test
- Test describes desired behavior, not implementation
- Test should fail for the right reason

### GREEN: Minimum Code to Pass
- Write ONLY enough code to make the test pass
- Resist adding functionality not demanded by a test

### MUTATE: Verify Test Effectiveness
- Run `mutation-testing` skill against the changed code
- Produce a mutation testing report (killed/survived/score)
- This validates whether your tests would catch real bugs

### KILL MUTANTS: Address Surviving Mutants
- Add or strengthen tests to kill surviving mutants
- Ask the human when a surviving mutant's value is ambiguous
- All tests pass after fixes

### REFACTOR: Assess Improvements
- Assess AFTER mutation testing confirms test strength
- Commit before refactoring
- All tests must pass after refactoring

---

## TDD Evidence in Commit History

### Default Expectation

Commit history should show clear RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR progression.

**Ideal progression:**
```
commit abc123: test: add failing test for filesystem traversal check
commit def456: feat: implement traversal permission checking to pass test
commit ghi789: test: strengthen boundary tests (mutation testing)
commit jkl012: refactor: extract permission helpers for clarity
```

### Rare Exceptions

TDD evidence may not be linearly visible in commits in these cases:

**1. Multi-Session Work**
- Feature spans multiple development sessions
- Work done with TDD in each session
- Commits organized for PR clarity rather than strict TDD phases
- **Evidence**: Tests exist, all passing, implementation matches test requirements

**2. Context Continuation**
- Resuming from previous work
- Original RED phase done in previous session/commit
- Current work continues from that point
- **Evidence**: Reference to RED commit in PR description

**3. Refactoring Commits**
- Large refactors after GREEN + MUTATE + KILL MUTANTS
- Multiple small refactors combined into single commit
- All tests remained green throughout
- **Evidence**: Commit message notes "refactor only, no behavior change"

### Documenting Exceptions in PRs

When exception applies, document in PR description:

```markdown
## TDD Evidence

RED phase: commit c925187 (added failing tests for NAT resolution)
GREEN phase: commits 5e0055b, 9a246d0 (implementation + bug fixes)
MUTATE + KILL MUTANTS: commit 7b8c9d0 (strengthened boundary tests)
REFACTOR: commit 11dbd1a (test isolation improvements)

Test Evidence:
✅ 4/4 tests passing (7.7s with 4 workers)
```

**Important**: Exception is for EVIDENCE presentation, not TDD practice. TDD process must still be followed - these are cases where commit history doesn't perfectly reflect the process that was actually followed.

---

## Coverage Verification - CRITICAL

### NEVER Trust Coverage Claims Without Verification

**Always run coverage yourself before approving PRs.**

### Verification Process

**Before approving any PR claiming "100% coverage":**

1. Check out the branch
   ```bash
   git checkout feature-branch
   ```

2. Run coverage verification:
   ```bash
   npm run test:coverage
   ```

3. Verify ALL metrics hit 100%:
   - Lines: 100% ✅
   - Statements: 100% ✅
   - Branches: 100% ✅
   - Functions: 100% ✅

4. Check that tests are behavior-driven (not testing implementation details)

**For anti-patterns that create fake coverage (coverage theater)**, see the `testing` skill.

### Reading Coverage Output

Look for the "All files" line in coverage summary:

```
File                    | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
------------------------|---------|----------|---------|---------|-------------------
All files               |     100 |      100 |     100 |     100 |
fileSystemUtils.ts      |     100 |      100 |     100 |     100 |
fileSystemFactory.ts    |     100 |      100 |     100 |     100 |
enrichment.ts           |     100 |      100 |     100 |     100 |
```

✅ This is 100% coverage - all four metrics at 100%.

### Red Flags

Watch for these signs of incomplete coverage:

❌ **PR claims "100% coverage" but you haven't verified**
- Never trust claims without running coverage yourself

❌ **Coverage summary shows <100% on any metric**
```
All files               |   97.11 |    93.97 |   81.81 |   97.11 |
```
- This is NOT 100% coverage (Functions: 81.81%, Lines: 97.11%)

❌ **"Uncovered Line #s" column shows line numbers**
```
enrichment.ts           |   95.23 |      100 |      60 |   95.23 | 45-48, 52-55
```
- Lines 45-48 and 52-55 are not covered

❌ **Coverage gaps without explicit exception documentation**
- If coverage <100%, exception should be documented (see Exception Process below)

### When Coverage Drops, Ask

**"What business behavior am I not testing?"**

NOT "What line am I missing?"

Add tests for behavior, and coverage follows naturally.

---

## 100% Coverage Exception Process

### Default Rule: 100% Coverage Required

No exceptions without explicit approval and documentation.

### Requesting an Exception

If 100% coverage cannot be achieved:

**Step 1: Document in package README**

Explain:
- Current coverage metrics
- WHY 100% cannot be achieved in this package
- WHERE the missing coverage will come from (integration tests, E2E, etc.)

**Step 2: Get explicit approval**

From project maintainer or team lead

**Step 3: Document in CLAUDE.md**

Under "Test Coverage: 100% Required" section, list the exception

**Example Exception:**

```markdown
## Current Exceptions

- **React Terminal Component**: 86% function coverage
  - Documented in `/src/components/Terminal/README.md`
  - Missing coverage from async command streaming (tested in E2E layer)
  - Approved: 2024-11-15
```

### Remember

The burden of proof is on the requester. 100% is the default expectation.

---

## Development Workflow

### Adding a New Feature

1. **Write failing test** - describe expected behavior
2. **Run test** - confirm it fails (`npm test`)
3. **Implement minimum** - just enough to pass
4. **Run test** - confirm it passes
5. **Run mutation testing** - verify tests catch real bugs
6. **Kill surviving mutants** - strengthen tests (ask human when ambiguous)
7. **Refactor if valuable** - improve code structure
8. **Commit** - with conventional commit message

### Workflow Example

```bash
# 1. Write failing test
it('rejects traversal for guest through root-only directory', () => {
  const fs = mkDir('root', { secret: mkDir('secret', {}, 'root', false) });
  const result = checkTraversal(fs, '/secret/data.txt', 'guest');
  expect(result.allowed).toBe(false);
}); # ❌ Test fails (no implementation)

# 2. Implement minimum code
if (!dir.permissions.execute.includes(userType)) {
  return { allowed: false, reason: `${path}: Permission denied` };
} # ✅ Test passes

# 3. Run mutation testing to verify test strength

# 4. Kill surviving mutants (ask human when ambiguous)

# 5. Refactor if needed (extract helper, improve naming)

# 6. Commit
git add .
git commit -m "feat: enforce execute permission on directory traversal"
```

---

## Commit Messages

Use conventional commits format:

```
feat: add SNMP firewall override for gateway machines
fix: correct NAT resolution for inner subnet gateways
refactor: extract permission checking into utility functions
test: add edge cases for filesystem traversal
docs: update architecture documentation
```

**Format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code change that neither fixes bug nor adds feature
- `test:` - Adding or updating tests
- `docs:` - Documentation changes

---

## Pull Request Requirements

Before submitting PR:

- [ ] All tests must pass
- [ ] All linting and type checks must pass
- [ ] **Coverage verification REQUIRED** - claims must be verified before review/approval
- [ ] PRs focused on single feature or fix
- [ ] Include behavior description (not implementation details)

**Example PR Description:**

```markdown
## Summary

Adds filesystem traversal permission checking with execute-bit enforcement on directories.

## Behavior Changes

- Directory traversal now requires execute permission on each path segment
- Root user bypasses all permission checks
- Guest users can only traverse world-readable directories

## Test Evidence

✅ 12/12 tests passing
✅ 100% coverage verified (see coverage report)

## TDD Evidence

RED: commit 4a3b2c1 (failing tests for traversal checking)
GREEN: commit 5d4e3f2 (implementation)
REFACTOR: commit 6e5f4a3 (extract permission resolution logic)
```

---

## Refactoring Priority

After mutation testing confirms test strength, classify any issues:

| Priority | Action | Examples |
|----------|--------|----------|
| Critical | Fix now | Mutations, knowledge duplication, >3 levels nesting |
| High | This session | Magic numbers, unclear names, >30 line functions |
| Nice | Later | Minor naming, single-use helpers |
| Skip | Don't change | Already clean code |

For detailed refactoring methodology, load the `refactoring` skill.

---

## Anti-Patterns to Avoid

- ❌ Writing production code without failing test
- ❌ Testing implementation details (spies on internal methods)
- ❌ 1:1 mapping between test files and implementation files
- ❌ Using `let`/`beforeEach` for test data
- ❌ Trusting coverage claims without verification
- ❌ Mocking the function being tested
- ❌ Redefining schemas in test files
- ❌ Factories returning partial/incomplete objects
- ❌ Speculative code ("just in case" logic without tests)

**For detailed testing anti-patterns**, load the `testing` skill.

---

## Summary Checklist

Before marking work complete:

- [ ] Every production code line has a failing test that demanded it
- [ ] Commit history shows TDD evidence (or documented exception)
- [ ] All tests pass
- [ ] Coverage verified at 100% (or exception documented)
- [ ] Mutation testing run and surviving mutants addressed
- [ ] Test factories used (no `let`/`beforeEach`)
- [ ] Tests verify behavior (not implementation details)
- [ ] Refactoring assessed and applied if valuable
- [ ] Conventional commit messages used
