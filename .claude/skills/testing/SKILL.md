---
name: testing
description: Testing patterns for behavior-driven tests. Use when writing tests, creating test factories, structuring test files, or deciding what to test. Do NOT use for UI-specific testing (see front-end-testing or react-testing skills).
---

# Testing Patterns

For verifying test effectiveness through mutation analysis, load the `mutation-testing` skill. For evaluating test quality against Dave Farley's properties, load the `test-design-reviewer` skill.

## Core Principle

**Test behavior, not implementation.** 100% coverage through business behavior, not implementation details.

**Example:** Permission logic in `fileSystemUtils.ts` gets 100% coverage by testing `checkTraversal()` behavior, NOT by directly testing internal helper functions.

---

## Test Through Public API Only

Never test implementation details. Test behavior through public APIs.

**Why this matters:**

- Tests remain valid when refactoring
- Tests document intended behavior
- Tests catch real bugs, not implementation changes

### Examples

❌ **WRONG - Testing implementation:**

```typescript
// ❌ Testing HOW (implementation detail)
it('should call normalizePath', () => {
  const spy = vi.spyOn(utils, 'normalizePath');
  resolvePath('../etc/passwd', '/home/user');
  expect(spy).toHaveBeenCalled(); // Tests HOW, not WHAT
});

// ❌ Testing private methods
it('should validate path segments', () => {
  const result = utils._validateSegment('..'); // Private method!
  expect(result).toBe(false);
});

// ❌ Testing internal state
it('should set traversal flag', () => {
  checkTraversal(fs, '/home', 'user');
  expect(checker.traversalChecked).toBe(true); // Internal state
});
```

✅ **CORRECT - Testing behavior through public API:**

```typescript
it('resolves relative path from home directory', () => {
  const result = resolvePath('../etc/passwd', '/home/user');
  expect(result).toBe('/etc/passwd');
});

it('rejects traversal when user lacks execute permission', () => {
  const fs = mkDir('root', { secret: mkDir('secret', {}, 'root', false) });
  const result = checkTraversal(fs, '/secret/data.txt', 'guest');
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain('Permission denied');
});

it('allows traversal when user has execute permission', () => {
  const fs = mkDir('root', { home: mkDir('home', {}, 'root', true) });
  const result = checkTraversal(fs, '/home/user', 'guest');
  expect(result.allowed).toBe(true);
});
```

---

## Coverage Through Behavior

Permission logic gets 100% coverage by testing the behavior it protects:

```typescript
// Tests covering permission checking WITHOUT testing internals directly
describe('checkTraversal', () => {
  it('denies access when directory lacks execute permission', () => {
    const fs = mkDir('root', { private: mkDir('private', {}, 'root', false) });
    const result = checkTraversal(fs, '/private/file.txt', 'guest');
    expect(result.allowed).toBe(false);
  });

  it('denies access when intermediate directory is missing', () => {
    const fs = mkDir('root', {});
    const result = checkTraversal(fs, '/nonexistent/file.txt', 'root');
    expect(result.allowed).toBe(false);
  });

  it('allows root to traverse root-owned directories', () => {
    const fs = mkDir('root', { etc: mkDir('etc', {}, 'root', false) });
    const result = checkTraversal(fs, '/etc/passwd', 'root');
    expect(result.allowed).toBe(true);
  });

  it('allows guest to traverse world-readable directories', () => {
    const fs = mkDir('root', { home: mkDir('home', {}, 'root', true) });
    const result = checkTraversal(fs, '/home/user', 'guest');
    expect(result.allowed).toBe(true);
  });
});

// ✅ Result: fileSystemUtils.ts has 100% coverage through behavior
```

**Key insight:** When coverage drops, ask **"What business behavior am I not testing?"** not "What line am I missing?"

---

## Don't Extract for Testability

Never extract a function into its own file purely to give it its own unit test. Extract for readability (a descriptive name clarifies intent), for DRY (same **knowledge** used in multiple places — see the `refactoring` skill's "DRY = Knowledge, Not Code" rule), or for separation of concerns. Not for testability.

If code is inline in a function, it gets coverage through that function's behavioral tests. Every layer has behavioral tests — domain functions have vitest unit tests, components have browser tests, pages have integration tests. There is no gap.

The anti-pattern is creating a 1:1 mapping between extracted helpers and test files (see "No 1:1 Mapping" below). The extracted helper is an implementation detail of its consumer. Test the consumer's behavior.

❌ **WRONG — Extracted single-use helper with its own test file:**

```typescript
// filter-open-ports.ts (new file, one caller)
export const filterOpenPorts = (ports: ReadonlyArray<Port>) =>
  ports.filter(p => p.open && p.service === 'ssh');

// filter-open-ports.test.ts (tests the helper directly)
it('filters open SSH ports', () => { ... });
```

✅ **CORRECT — Inline in the consuming function, tested through its behavior:**

```typescript
// scan-machine.ts
export const scanMachine = (machine: RemoteMachine): ScanResult => {
  const sshPorts = machine.ports.filter((p) => p.open && p.service === 'ssh');
  const ftpPorts = machine.ports.filter((p) => p.open && p.service === 'ftp');
  return { sshPorts, ftpPorts, hostname: machine.hostname };
};

// The behavioral test for scanMachine covers the filtering:
it('returns only open SSH ports in scan result', () => {
  const result = scanMachine(
    getMockMachine({
      ports: [
        { port: 22, service: 'ssh', open: true },
        { port: 80, service: 'http', open: false },
      ],
    }),
  );
  expect(result.sshPorts).toHaveLength(1);
});
```

**When extraction IS justified (DRY):** If the same filtering logic is used by multiple consumers with the same business meaning, extract it. But test it through each consumer's behavior, not as an isolated unit.

---

## Test Factory Pattern

For test data, use factory functions with optional overrides.

### Core Principles

1. Return complete objects with sensible defaults
2. Accept `Partial<T>` overrides for customization
3. Validate with real schemas (don't redefine)
4. NO `let`/`beforeEach` - use factories for fresh state

### Basic Pattern

```typescript
const getMockFileNode = (overrides?: Partial<FileNode>): FileNode => ({
  name: 'test.txt',
  type: 'file',
  owner: 'user',
  permissions: { read: ['root', 'user', 'guest'], write: ['root', 'user'], execute: [] },
  content: 'test content',
  ...overrides,
});

// Usage
it('restricts write access for guest users', () => {
  const file = getMockFileNode({
    permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  });
  const result = canWriteFile(file, 'guest');
  expect(result).toBe(false);
});
```

### Complete Factory Example

```typescript
const getMockMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '10.0.1.5',
  hostname: 'web-server',
  ports: [
    { port: 22, service: 'ssh', open: true },
    { port: 80, service: 'http', open: true },
  ],
  users: [
    { username: 'root', passwordHash: 'abc123', userType: 'root' },
    { username: 'admin', passwordHash: 'def456', userType: 'user' },
  ],
  ...overrides,
});
```

**Why validate with schema?**

- Ensures test data is valid according to production schema
- Catches breaking changes early (schema changes fail tests)
- Single source of truth (no schema redefinition)

**Tip:** For factories where only a subset of fields are relevant, use `Pick<T, 'field1' | 'field2'>` for the overrides parameter to constrain what callers can customize.

### Factory Composition

For nested objects, compose factories:

```typescript
const getMockPort = (overrides?: Partial<Port>): Port => ({
  port: 22,
  service: 'ssh',
  open: true,
  ...overrides,
});

const getMockMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '10.0.1.5',
  hostname: 'web-server',
  ports: [getMockPort()], // ✅ Compose factories
  users: [getMockRemoteUser()], // ✅ Compose factories
  ...overrides,
});

// Usage - override nested objects
it('counts total open ports across all machines', () => {
  const machines = [
    getMockMachine({ ports: [getMockPort({ port: 22 }), getMockPort({ port: 80 })] }),
    getMockMachine({ ports: [getMockPort({ port: 443, open: false })] }),
  ];
  expect(countOpenPorts(machines)).toBe(2);
});
```

### Anti-Patterns

❌ **WRONG: Using `let` and `beforeEach`**

```typescript
let machine: RemoteMachine;
beforeEach(() => {
  machine = { ip: '10.0.1.5', hostname: 'web-server', ... };  // Shared mutable state!
});

it('test 1', () => {
  machine.hostname = 'modified';  // Mutates shared state
});

it('test 2', () => {
  expect(machine.hostname).toBe('web-server');  // Fails! Modified by test 1
});
```

✅ **CORRECT: Factory per test**

```typescript
it('test 1', () => {
  const machine = getMockMachine({ hostname: 'modified' }); // Fresh state
  // ...
});

it('test 2', () => {
  const machine = getMockMachine(); // Fresh state, not affected by test 1
  expect(machine.hostname).toBe('web-server'); // ✅ Passes
});
```

❌ **WRONG: Incomplete objects**

```typescript
const getMockMachine = () => ({
  ip: '10.0.1.5', // Missing hostname, ports, users!
});
```

✅ **CORRECT: Complete objects**

```typescript
const getMockMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '10.0.1.5',
  hostname: 'web-server',
  ports: [getMockPort()],
  users: [getMockRemoteUser()],
  ...overrides, // All required fields present
});
```

❌ **WRONG: Redefining schemas in tests**

```typescript
// ❌ Schema already defined in src/generation/types.ts!
const MissionSchema = z.object({ ... });
const getMockMission = () => MissionSchema.parse({ ... });
```

✅ **CORRECT: Import real schema**

```typescript
import { MissionSchema } from '@/generation/types';

const getMockMission = (overrides?: Partial<MissionNetwork>): MissionNetwork => {
  return MissionSchema.parse({
    seed: 'test-seed',
    difficulty: 'easy',
    ...overrides,
  });
};
```

---

## Coverage Theater Detection

Watch for these patterns that give fake 100% coverage:

### Pattern 1: Mock the function being tested

❌ **WRONG** - Gives 100% coverage but tests nothing:

```typescript
it('calls normalizePath', () => {
  const spy = vi.spyOn(utils, 'normalizePath');
  resolvePath('/home', '/');
  expect(spy).toHaveBeenCalled(); // Meaningless assertion
});
```

✅ **CORRECT** - Test actual behavior:

```typescript
it('resolves parent directory reference', () => {
  const result = resolvePath('..', '/home/user');
  expect(result).toBe('/home');
});
```

### Pattern 2: Test only that function was called

❌ **WRONG** - No behavior validation:

```typescript
it('writes file', () => {
  const spy = vi.spyOn(fs, 'writeFile');
  createFile('/tmp/test.txt', 'content');
  expect(spy).toHaveBeenCalledWith('/tmp/test.txt', 'content'); // So what?
});
```

✅ **CORRECT** - Verify the outcome:

```typescript
it('creates file with correct content and permissions', () => {
  createFile('/tmp/test.txt', 'content', 'user');
  const node = getNode('/tmp/test.txt');
  expect(node?.content).toBe('content');
  expect(node?.owner).toBe('user');
});
```

### Pattern 3: Test trivial getters/setters

❌ **WRONG** - Testing implementation, not behavior:

```typescript
it('sets hostname', () => {
  machine.setHostname('web-01');
  expect(machine.getHostname()).toBe('web-01'); // Trivial
});
```

✅ **CORRECT** - Test meaningful behavior:

```typescript
it('generates unique hostnames for each machine in layer', () => {
  const machines = generateLayer(prng, 3);
  const hostnames = machines.map((m) => m.hostname);
  expect(new Set(hostnames).size).toBe(3);
});
```

### Pattern 4: 100% line coverage, 0% branch coverage

❌ **WRONG** - Missing edge cases:

```typescript
it('checks permission', () => {
  const result = checkTraversal(fs, '/home', 'root');
  expect(result.allowed).toBe(true); // Only happy path!
});
// Missing: guest access, missing directory, no execute permission, etc.
```

✅ **CORRECT** - Test all branches:

```typescript
describe('checkTraversal', () => {
  it('denies guest access to root-only directories', () => {
    const fs = mkDir('root', { etc: mkDir('etc', {}, 'root', false) });
    expect(checkTraversal(fs, '/etc/shadow', 'guest').allowed).toBe(false);
  });

  it('denies access to nonexistent paths', () => {
    const fs = mkDir('root', {});
    expect(checkTraversal(fs, '/missing/file', 'root').allowed).toBe(false);
  });

  it('allows root access to any directory', () => {
    const fs = mkDir('root', { etc: mkDir('etc', {}, 'root', false) });
    expect(checkTraversal(fs, '/etc/shadow', 'root').allowed).toBe(true);
  });

  it('allows guest access to world-readable directories', () => {
    const fs = mkDir('root', { tmp: mkDir('tmp', {}, 'root', true) });
    expect(checkTraversal(fs, '/tmp/file', 'guest').allowed).toBe(true);
  });
});
```

---

## No 1:1 Mapping Between Tests and Implementation

Don't create test files that mirror implementation files.

❌ **WRONG:**

```
src/
  filesystem/fileSystemUtils.ts
  filesystem/fileSystemFactory.ts
  filesystem/permissionChecker.ts
tests/
  filesystem/fileSystemUtils.test.ts  ← 1:1 mapping
  filesystem/fileSystemFactory.test.ts  ← 1:1 mapping
  filesystem/permissionChecker.test.ts  ← 1:1 mapping
```

✅ **CORRECT:**

```
src/
  filesystem/fileSystemUtils.ts
  filesystem/fileSystemFactory.ts
  filesystem/permissionChecker.ts
tests/
  filesystem-access.test.ts  ← Tests behavior, not implementation files
```

**Why:** Implementation details can be refactored without changing tests. Tests verify behavior remains correct regardless of how code is organized internally.

---

## Summary Checklist

When writing tests, verify:

- [ ] Testing behavior through public API (not implementation details)
- [ ] No mocks of the function being tested
- [ ] No tests of private methods or internal state
- [ ] Factory functions return complete, valid objects
- [ ] Factories validate with real schemas (not redefined in tests)
- [ ] Using Partial<T> for type-safe overrides
- [ ] No `let`/`beforeEach` - use factories for fresh state
- [ ] Edge cases covered (not just happy path)
- [ ] Tests would pass even if implementation is refactored
- [ ] No 1:1 mapping between test files and implementation files
