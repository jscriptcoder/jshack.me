---
name: mutation-testing
description: Mutation testing patterns for verifying test effectiveness. Use when analyzing branch code to find weak or missing tests.
---

# Mutation Testing

For writing good tests (factories, behavior-driven patterns), load the `testing` skill. This skill focuses on verifying test effectiveness.

Mutation testing answers the question: **"Are my tests actually catching bugs?"**

Code coverage tells you what code your tests execute. Mutation testing tells you if your tests would **detect changes** to that code. A test suite with 100% coverage can still miss 40% of potential bugs.

---

## Core Concept

**The Mutation Testing Process:**

1. **Generate mutants**: Introduce small bugs (mutations) into production code
2. **Run tests**: Execute your test suite against each mutant
3. **Evaluate results**: If tests fail, the mutant is "killed" (good). If tests pass, the mutant "survived" (bad - your tests missed the bug)

**The Insight**: A surviving mutant represents a bug your tests wouldn't catch.

---

## When to Use This Skill

Use mutation testing analysis when:

- Reviewing code changes on a branch
- Verifying test effectiveness after TDD
- Identifying weak tests that appear to have coverage
- Finding missing edge case tests
- Validating that refactoring didn't weaken test suite

**Integration with TDD:**

```
RED-GREEN-MUTATE-REFACTOR Cycle
┌─────────────────────────────────────────────────┐
│ 1. RED:      Write failing test                 │
│ 2. GREEN:    Minimum code to pass               │
│ 3. MUTATE:   Verify tests catch real bugs  ◄──  │  ← You are here
│ 4. REFACTOR: Improve structure with confidence  │
└─────────────────────────────────────────────────┘
```

**Why MUTATE before REFACTOR:** Mutation testing validates test strength *before* you restructure code. Refactoring with unverified tests means restructuring code whose safety net you haven't checked.

---

## Execution Process

When verifying test effectiveness, **actually mutate the code and run the tests.** Do not just reason about whether tests would catch mutations — prove it.

### Step 1: Identify Changed Code

```bash
# Get files changed on the branch
git diff main...HEAD --name-only | grep -E '\.(ts|js|tsx|jsx)$' | grep -v '\.test\.'

# Get detailed diff for analysis
git diff main...HEAD -- src/
```

### Step 2: Apply Mutations and Run Tests

For each changed function/method, work through the mutation operators (see Mutation Operators section below). For each applicable mutation:

1. **Mutate**: Change the production code (e.g., flip `*` to `/`, negate a condition)
2. **Run**: Execute the test suite
3. **Evaluate**: Did a test fail?
   - **Yes** → mutant killed (good). Revert the mutation.
   - **No** → mutant survived (bad). Revert the mutation, then add or strengthen a test.
4. **Revert**: Always restore the original code before the next mutation

**Always revert each mutation before applying the next.** Never leave mutated code in place.

You do not need to apply every possible mutation to every line. Focus on:
- Changed code on the branch
- Operators most likely to have surviving mutants (see Quick Reference)
- Conditions with boundary values
- Boolean logic with multiple operands

### Step 3: Produce a Report

After working through the mutations, produce a summary:

```markdown
## Mutation Testing Report

### Killed (tests caught the mutation)
- `countOpenPorts`: `+` → `-` — killed by "counts all open ports on machine"
- `isPortOpen`: `===` → `!==` — killed by "returns true for open SSH port"

### Survived (tests DID NOT catch the mutation)
- `generateLayer`: `>=` → `>` — no test for boundary value at exactly minMachines
  → **Action**: Add boundary test for minimum machine count

### Summary
- Mutations applied: 8
- Killed: 6
- Survived: 2
- Mutation score: 75%
```

### Step 4: Kill Surviving Mutants

Not every surviving mutant warrants a new test. Some mutations produce equivalent behavior, and some boundary cases are low-risk enough that the test would add noise without meaningful protection.

**Fix immediately** when:
- The mutation represents a realistic bug (wrong operator, inverted condition)
- The surviving mutant is in critical business logic (permissions, authentication, mission objectives)
- The fix is a simple boundary test or stronger assertion

**Ask the human** when:
- You're unsure whether the mutation represents a real risk
- The test to kill it would be complex or hard to name clearly
- The mutation is in a code path that's also covered by integration/E2E tests
- The surviving mutant feels like an equivalent mutant but you're not certain

Present the mutation, explain why the current tests don't catch it, and let the human decide whether it's worth a new test.

When fixing, follow TDD — write the failing test first, verify it fails against the mutated code, then verify it passes against the original code.

---

## Mutation Operators

### Arithmetic Operator Mutations

| Original | Mutated | Test Should Verify |
|----------|---------|-------------------|
| `a + b` | `a - b` | Addition behavior |
| `a - b` | `a + b` | Subtraction behavior |
| `a * b` | `a / b` | Multiplication behavior |
| `a / b` | `a * b` | Division behavior |
| `a % b` | `a * b` | Modulo behavior |

**Example Analysis:**

```typescript
// Production code
const countOpenPorts = (machine: RemoteMachine): number => {
  return machine.ports.reduce((sum, p) => sum + (p.open ? 1 : 0), 0);
};

// Mutant: sum - (p.open ? 1 : 0)
// Question: Would tests fail if + became -?

// ❌ WEAK TEST - Would NOT catch mutant
it('counts ports on machine with one open port', () => {
  expect(countOpenPorts(getMockMachine({ ports: [getMockPort({ open: true })] }))).toBe(1);
  // 0 + 1 = 1, 0 - 1 = -1 — catches this one, but fragile with 0 ports
});

// ✅ STRONG TEST - Would catch mutant clearly
it('counts multiple open ports', () => {
  const machine = getMockMachine({
    ports: [getMockPort({ open: true }), getMockPort({ open: true }), getMockPort({ open: false })],
  });
  expect(countOpenPorts(machine)).toBe(2); // 0+1+1+0 = 2, 0-1-1-0 = -2 (DIFFERENT!)
});
```

### Conditional Expression Mutations

| Original | Mutated | Test Should Verify |
|----------|---------|-------------------|
| `a < b` | `a <= b` | Boundary value at equality |
| `a < b` | `a >= b` | Both sides of condition |
| `a <= b` | `a < b` | Boundary value at equality |
| `a <= b` | `a > b` | Both sides of condition |
| `a > b` | `a >= b` | Boundary value at equality |
| `a > b` | `a <= b` | Both sides of condition |
| `a >= b` | `a > b` | Boundary value at equality |
| `a >= b` | `a < b` | Both sides of condition |

**Example Analysis:**

```typescript
// Production code
const isPrivilegedPort = (port: number): boolean => {
  return port < 1024;
};

// Mutant: port <= 1024
// Question: Would tests fail if < became <=?

// ❌ WEAK TEST - Would NOT catch boundary mutant
it('returns true for well-known ports', () => {
  expect(isPrivilegedPort(80)).toBe(true);  // 80 < 1024 = true, 80 <= 1024 = true (SAME!)
});

// ✅ STRONG TEST - Would catch boundary mutant
it('returns false for port 1024 exactly', () => {
  expect(isPrivilegedPort(1024)).toBe(false);  // 1024 < 1024 = false, 1024 <= 1024 = true (DIFFERENT!)
});
```

### Equality Operator Mutations

| Original | Mutated | Test Should Verify |
|----------|---------|-------------------|
| `a === b` | `a !== b` | Both equal and not equal cases |
| `a !== b` | `a === b` | Both equal and not equal cases |
| `a == b` | `a != b` | Both equal and not equal cases |
| `a != b` | `a == b` | Both equal and not equal cases |

### Logical Operator Mutations

| Original | Mutated | Test Should Verify |
|----------|---------|-------------------|
| `a && b` | `a \|\| b` | Case where one is true, other is false |
| `a \|\| b` | `a && b` | Case where one is true, other is false |
| `a ?? b` | `a && b` | Nullish coalescing behavior |

**Example Analysis:**

```typescript
// Production code
const canExecuteCommand = (hasWifi: boolean, hasBinary: boolean): boolean => {
  return hasWifi && hasBinary;
};

// Mutant: hasWifi || hasBinary
// Question: Would tests fail if && became ||?

// ❌ WEAK TEST - Would NOT catch mutant
it('returns true when both conditions met', () => {
  expect(canExecuteCommand(true, true)).toBe(true);  // true && true = true || true (SAME!)
});

// ✅ STRONG TEST - Would catch mutant
it('returns false when WiFi connected but binary missing', () => {
  expect(canExecuteCommand(true, false)).toBe(false);  // true && false = false, true || false = true (DIFFERENT!)
});
```

### Boolean Literal Mutations

| Original | Mutated | Test Should Verify |
|----------|---------|-------------------|
| `true` | `false` | Both true and false outcomes |
| `false` | `true` | Both true and false outcomes |
| `!(a)` | `a` | Negation is necessary |

### Block Statement Mutations

| Original | Mutated | Test Should Verify |
|----------|---------|-------------------|
| `{ code }` | `{ }` | Side effects of the block |

**Example Analysis:**

```typescript
// Production code
const applyPatch = (fs: FileNode, patch: FileSystemPatch): FileNode => {
  const pathParts = patch.path.split('/').filter(Boolean);
  return updateNodeAtPath(fs, pathParts, () =>
    mkFile(pathParts[pathParts.length - 1], patch.content ?? '', patch.owner)
  );
};

// Mutant: Empty function body (returns undefined)
// Question: Would tests fail if all statements removed?

// ❌ WEAK TEST - Would NOT catch mutant
it('applies patch without error', () => {
  expect(() => applyPatch(baseFs, patch)).not.toThrow();  // Empty function also doesn't throw!
});

// ✅ STRONG TEST - Would catch mutant
it('updates file content at specified path', () => {
  const result = applyPatch(baseFs, { machineId: 'm1', path: '/etc/hosts', content: '10.0.1.1 web', owner: 'root' });
  const node = getNodeAtPath(result, '/etc/hosts');
  expect(node?.content).toBe('10.0.1.1 web');
});
```

### String Literal Mutations

| Original | Mutated | Test Should Verify |
|----------|---------|-------------------|
| `"text"` | `""` | Non-empty string behavior |
| `""` | `"Stryker was here!"` | Empty string behavior |

### Array Declaration Mutations

| Original | Mutated | Test Should Verify |
|----------|---------|-------------------|
| `[1, 2, 3]` | `[]` | Non-empty array behavior |
| `new Array(1, 2)` | `new Array()` | Array contents matter |

### Unary Operator Mutations

| Original | Mutated | Test Should Verify |
|----------|---------|-------------------|
| `+a` | `-a` | Sign matters |
| `-a` | `+a` | Sign matters |
| `++a` | `--a` | Increment vs decrement |
| `a++` | `a--` | Increment vs decrement |

### Method Expression Mutations (TypeScript/JavaScript)

| Original | Mutated | Test Should Verify |
|----------|---------|-------------------|
| `startsWith()` | `endsWith()` | Correct string position |
| `endsWith()` | `startsWith()` | Correct string position |
| `toUpperCase()` | `toLowerCase()` | Case transformation |
| `toLowerCase()` | `toUpperCase()` | Case transformation |
| `some()` | `every()` | Partial vs full match |
| `every()` | `some()` | Full vs partial match |
| `filter()` | (removed) | Filtering is necessary |
| `reverse()` | (removed) | Order matters |
| `sort()` | (removed) | Ordering is necessary |
| `min()` | `max()` | Correct extremum |
| `max()` | `min()` | Correct extremum |
| `trim()` | `trimStart()` | Correct trim behavior |

### Optional Chaining Mutations

| Original | Mutated | Test Should Verify |
|----------|---------|-------------------|
| `foo?.bar` | `foo.bar` | Null/undefined handling |
| `foo?.[i]` | `foo[i]` | Null/undefined handling |
| `foo?.()` | `foo()` | Null/undefined handling |

---

## Mutant States and Metrics

### Mutant States

| State | Meaning | Action |
|-------|---------|--------|
| **Killed** | Test failed when mutant applied | Good - tests are effective |
| **Survived** | Tests passed with mutant active | Bad - add/strengthen test |
| **No Coverage** | No test exercises this code | Add behavior test |
| **Timeout** | Tests timed out (infinite loop) | Counted as detected |
| **Equivalent** | Mutant produces same behavior | No action - not a real bug |

### Metrics

- **Mutation Score**: `killed / valid * 100` - The higher, the better
- **Detected**: `killed + timeout`
- **Undetected**: `survived + no coverage`

### Target Mutation Score

| Score | Quality |
|-------|---------|
| < 60% | Weak test suite - significant gaps |
| 60-80% | Moderate - many improvements possible |
| 80-90% | Good - but still gaps to address |
| > 90% | Strong - but watch for equivalent mutants |

---

## Equivalent Mutants

Equivalent mutants produce the same behavior as the original code. They cannot be killed because there is no observable difference.

### Common Equivalent Mutant Patterns

**Pattern 1: Operations with identity elements**

```typescript
// Mutant in conditional where both branches have same effect
if (whatever) {
  portCount += 0;  // Can mutate to -= 0, *= 1, /= 1 - all equivalent!
} else {
  portCount += 0;
}
```

**Pattern 2: Boundary conditions that don't affect outcome**

```typescript
// When max equals min, condition doesn't matter
const maxPort = Math.max(a, b);
const minPort = Math.min(a, b);
if (a >= b) {  // Mutating to <= or < has no effect when a === b
  result = maxPort - minPort;  // 0 regardless
}
```

**Pattern 3: Dead code paths**

```typescript
// If this path is never reached, mutations don't matter
if (impossibleCondition) {
  closePorts();  // Mutating this won't affect behavior
}
```

### How to Handle Equivalent Mutants

1. **Identify**: Analyze if mutation truly changes observable behavior
2. **Document**: Note why mutant is equivalent
3. **Accept**: 100% mutation score may not be achievable
4. **Consider refactoring**: Sometimes equivalent mutants indicate unclear code

---

## Branch Analysis Checklist

When analyzing code changes on a branch:

### For Each Function/Method Changed:

- [ ] **Arithmetic operators**: Would changing +, -, *, / be detected?
- [ ] **Conditionals**: Are boundary values tested (>=, <=)?
- [ ] **Boolean logic**: Are all branches of &&, || tested?
- [ ] **Return statements**: Would changing return value be detected?
- [ ] **Method calls**: Would removing or swapping methods be detected?
- [ ] **String literals**: Would empty strings be detected?
- [ ] **Array operations**: Would empty arrays be detected?

### Red Flags (Likely Surviving Mutants):

- [ ] Tests only verify "no error thrown"
- [ ] Tests only check one side of a condition
- [ ] Tests use identity values (0, 1, empty string)
- [ ] Tests only verify function was called, not with what
- [ ] Tests don't verify return values
- [ ] Boundary values not tested

### Questions to Ask:

1. "If I changed this operator, would a test fail?"
2. "If I negated this condition, would a test fail?"
3. "If I removed this line, would a test fail?"
4. "If I returned early here, would a test fail?"

---

## Strengthening Weak Tests

### Pattern: Add Boundary Value Tests

```typescript
// Original weak test
it('checks if port is privileged', () => {
  expect(isPrivilegedPort(80)).toBe(true);
  expect(isPrivilegedPort(8080)).toBe(false);
});

// Strengthened with boundary values
it('checks privileged port boundary at 1024', () => {
  expect(isPrivilegedPort(1023)).toBe(true);   // Just below
  expect(isPrivilegedPort(1024)).toBe(false);   // Exactly at boundary
  expect(isPrivilegedPort(1025)).toBe(false);   // Just above
});
```

### Pattern: Test Both Branches of Conditions

```typescript
// Original weak test - only tests one branch
it('checks command availability', () => {
  expect(canExecuteCommand(true, true)).toBe(true);
});

// Strengthened - tests all meaningful combinations
it('requires WiFi connection', () => {
  expect(canExecuteCommand(false, true)).toBe(false);
});

it('requires binary installed', () => {
  expect(canExecuteCommand(true, false)).toBe(false);
});

it('denies when neither condition met', () => {
  expect(canExecuteCommand(false, false)).toBe(false);
});
```

### Pattern: Avoid Identity Values

```typescript
// Weak - uses identity values
it('calculates', () => {
  expect(generateLayerSize(1, 1)).toBe(1);  // x * 1 = x / 1
  expect(addMachineCount(5, 0)).toBe(5);    // x + 0 = x - 0
});

// Strong - uses values that reveal operator differences
it('calculates', () => {
  expect(generateLayerSize(3, 4)).toBe(12);  // 3 * 4 != 3 / 4
  expect(addMachineCount(5, 3)).toBe(8);     // 5 + 3 != 5 - 3
});
```

### Pattern: Verify Side Effects

```typescript
// Weak - no verification of side effects
it('applies filesystem patch', () => {
  applyPatch(baseFs, patch);
  // No assertions!
});

// Strong - verifies observable outcomes
it('applies filesystem patch', () => {
  const result = applyPatch(baseFs, patch);
  const node = getNodeAtPath(result, patch.path);
  expect(node?.content).toBe(patch.content);
  expect(node?.owner).toBe(patch.owner);
});
```

---

## Integration with Stryker (Optional)

For automated mutation testing, use Stryker:

### Installation

```bash
npm init stryker
```

### Configuration (stryker.conf.json)

```json
{
  "testRunner": "vitest",
  "coverageAnalysis": "perTest",
  "reporters": ["html", "clear-text", "progress"],
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts"]
}
```

### Running

```bash
npx stryker run
```

### Incremental Mode (for branches)

```bash
npx stryker run --incremental
```

---

## Summary: Mutation Testing Mindset

**The key question for every line of code:**

> "If I introduced a bug here, would my tests catch it?"

**For each test, verify it would catch:**
- Arithmetic operator changes
- Boundary condition shifts
- Boolean logic inversions
- Removed statements
- Changed return values

**Remember:**
- Coverage measures execution, mutation testing measures detection
- A test that doesn't make assertions can't kill mutants
- Boundary values are critical for conditional mutations
- Avoid identity values that make operators interchangeable

---

## Quick Reference

### Operators Most Likely to Have Surviving Mutants

1. `>=` vs `>` (boundary not tested)
2. `&&` vs `||` (only tested when both true/false)
3. `+` vs `-` (only tested with 0)
4. `*` vs `/` (only tested with 1)
5. `some()` vs `every()` (only tested with all matching)

### Test Values That Kill Mutants

| Avoid | Use Instead |
|-------|-------------|
| 0 (for +/-) | Non-zero values |
| 1 (for */) | Values > 1 |
| Empty arrays | Arrays with multiple items |
| Identical values for comparisons | Distinct values |
| All true/false for logical ops | Mixed true/false |
