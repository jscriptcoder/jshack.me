---
name: refactoring
description: Refactoring assessment and patterns. Use after tests pass (GREEN phase) to assess improvement opportunities.
---

# Refactoring

Refactoring is the third step of TDD. After GREEN, assess if refactoring adds value.

## When to Refactor

- Always assess after green
- Only refactor if it improves the code
- **Commit working code BEFORE refactoring** (critical safety net)

### Commit Before Refactoring - WHY

Having a working baseline before refactoring:
- Allows reverting if refactoring breaks things
- Provides safety net for experimentation
- Makes refactoring less risky
- Shows clear separation in git history

**Workflow:**
1. GREEN: Tests pass
2. COMMIT: Save working code
3. REFACTOR: Improve structure
4. COMMIT: Save refactored code

## Priority Classification

| Priority | Action | Examples |
|----------|--------|----------|
| Critical | Fix now | Mutations, knowledge duplication, >3 levels nesting |
| High | This session | Magic numbers, unclear names, >30 line functions |
| Nice | Later | Minor naming, single-use helpers |
| Skip | Don't change | Already clean code |

## DRY = Knowledge, Not Code

**Abstract when**:
- Same business concept (semantic meaning)
- Would change together if requirements change
- Obvious why grouped together

**Keep separate when**:
- Different concepts that look similar (structural)
- Would evolve independently
- Coupling would be confusing

## Example Assessment

```typescript
// After GREEN:
const formatNmapOutput = (machine: GeneratedMachine): string => {
  const openPorts = machine.ports.filter(p => !p.closed);
  const header = openPorts.length > 0 ? 'PORT   STATE SERVICE' : 'All 1000 scanned ports are closed';
  return `Nmap scan report for ${machine.ip}\n${header}\n${openPorts.map(p => `${p.number}/tcp open  ${p.service}`).join('\n')}`;
};

// ASSESSMENT:
// ⚠️ High: Magic number 1000 → extract constant
// ⚠️ High: String formatting in one expression → extract port line formatter
// ✅ Skip: Overall structure is clear enough
// DECISION: Extract constant + port formatter
```

## Speculative Code is a TDD Violation

If code isn't driven by a failing test, don't write it.

**Key lesson**: Every line must have a test that demanded its existence.

❌ **Speculative code examples:**
- "Just in case" logic
- Features not yet needed
- Code written "for future flexibility"
- Untested error handling paths

✅ **Correct approach**: Delete speculative code. If the behavior is needed, write a failing test that demands it, then implement.

```typescript
// ❌ WRONG - Speculative error handling (no test demands this)
if (machines.length === 0) {
  throw new Error('No machines in network'); // No test for this path!
}

// ✅ CORRECT - Test-driven error handling
// First: write a test that expects this behavior
// Then: implement the guard clause to make it pass
```

---

## When NOT to Refactor

Don't refactor when:

- ❌ Code works correctly (no bug to fix)
- ❌ No test demands the change (speculative refactoring)
- ❌ Would change behavior (that's a feature, not refactoring)
- ❌ Premature optimization
- ❌ Code is "good enough" for current phase

**Remember**: Refactoring should improve code structure without changing behavior.

---

## Commit Messages for Refactoring

```
refactor: extract filesystem traversal check into utility
refactor: simplify mission seed parsing flow
refactor: rename ambiguous network config parameters
```

**Format**: `refactor: <what was changed>`

**Note**: Refactoring commits should NOT be mixed with feature commits.

---

## Refactoring Checklist

- [ ] All tests pass without modification
- [ ] No new public APIs added
- [ ] Code more readable than before
- [ ] Committed separately from features
- [ ] Committed BEFORE refactoring (safety net)
- [ ] No speculative code added
- [ ] Behavior unchanged (tests prove this)
