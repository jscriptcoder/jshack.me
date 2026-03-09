---
name: testing
description: Testing patterns for behavior-driven tests. Use when writing tests, creating test factories, structuring test files, or deciding what to test. Do NOT use for UI-specific testing (see front-end-testing or react-testing skills).
---

# Testing Patterns

For verifying test effectiveness through mutation analysis, load the `mutation-testing` skill. For evaluating test quality against Dave Farley's properties, load the `test-design-reviewer` skill.

## Core Principle

**Test behavior, not implementation.** 100% coverage through business behavior, not implementation details.

**Example:** Permission logic in `fileSystemUtils.ts` gets 100% coverage by testing `canReadFromMachine()` behavior, NOT by directly testing internal helper functions.

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
it('should call checkTraversal', () => {
  const spy = vi.spyOn(utils, 'checkTraversal');
  canReadFromMachine('localhost', '/home/guest/notes.txt', 'guest');
  expect(spy).toHaveBeenCalled(); // Tests HOW, not WHAT
});

// ❌ Testing private methods
it('should normalize path segments', () => {
  const result = utils._normalizeSegments(['home', '..', 'root']); // Private method!
  expect(result).toEqual(['root']);
});

// ❌ Testing internal state
it('should set wifiConnected flag', () => {
  connectWifi('JSHACK-CORP', 'cr4ck3d_w1f1');
  expect(sessionState.wifiConnected).toBe(true); // Internal state
});
```

✅ **CORRECT - Testing behavior through public API:**
```typescript
it('should deny guest access to root-owned files', () => {
  const tree = getMockFileTree({ owner: 'root' });
  const result = canReadFromMachine('localhost', '/root/secret.txt', 'guest', tree);
  expect(result).toBe(false);
});

it('should allow root to read any file', () => {
  const tree = getMockFileTree({ owner: 'operator' });
  const result = canReadFromMachine('localhost', '/home/operator/notes.txt', 'root', tree);
  expect(result).toBe(true);
});

it('should resolve relative paths correctly', () => {
  const result = resolvePath('/home/jshacker', '../guest/notes.txt');
  expect(result).toBe('/home/guest/notes.txt');
});
```

---

## Coverage Through Behavior

Permission logic gets 100% coverage by testing the behavior it protects:

```typescript
// Tests covering permission checks WITHOUT testing internal functions directly
describe('canReadFromMachine', () => {
  it('should deny access when directory traversal fails', () => {
    const tree = getMockFileTree({ parentExecute: ['root'] });
    const result = canReadFromMachine('localhost', '/root/.ssh/id_rsa', 'guest', tree);
    expect(result).toBe(false);
  });

  it('should deny guest access to root-owned files', () => {
    const tree = getMockFileTree({ owner: 'root' });
    const result = canReadFromMachine('localhost', '/root/secret.txt', 'guest', tree);
    expect(result).toBe(false);
  });

  it('should allow owner to read their own files', () => {
    const tree = getMockFileTree({ owner: 'jshacker' });
    const result = canReadFromMachine('localhost', '/home/jshacker/notes.txt', 'jshacker', tree);
    expect(result).toBe(true);
  });

  it('should allow root to read any file', () => {
    const tree = getMockFileTree({ owner: 'operator' });
    const result = canReadFromMachine('localhost', '/home/operator/notes.txt', 'root', tree);
    expect(result).toBe(true);
  });
});

// ✅ Result: fileSystemUtils.ts has 100% coverage through behavior
```

**Key insight:** When coverage drops, ask **"What business behavior am I not testing?"** not "What line am I missing?"

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
  type: 'file',
  content: 'test content',
  owner: 'jshacker',
  permissions: { read: ['jshacker', 'root'], write: ['jshacker', 'root'], execute: [] },
  ...overrides,
});

// Usage
it('should deny write access for non-owners', () => {
  const file = getMockFileNode({ owner: 'root' });
  const result = canWriteFile(file, 'guest');
  expect(result).toBe(false);
});
```

### Complete Factory Example

```typescript
const getMockSession = (overrides?: Partial<Session>): Session => ({
  username: 'jshacker',
  userType: 'user',
  machine: 'localhost',
  currentPath: '/home/jshacker',
  theme: 'amber',
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
  number: 22,
  service: 'ssh',
  closed: false,
  ...overrides,
});

const getMockMachine = (overrides?: Partial<GeneratedMachine>): GeneratedMachine => ({
  role: 'webserver',
  hostname: 'web01',
  ip: '10.0.1.10',
  ports: [getMockPort()],               // ✅ Compose factories
  users: [getMockMachineUser()],         // ✅ Compose factories
  filesystem: getMockFileTree(),         // ✅ Compose factories
  ...overrides,
});

// Usage - override nested objects
it('should detect SSH-accessible machines', () => {
  const machine = getMockMachine({
    ports: [
      getMockPort({ number: 22, service: 'ssh' }),
      getMockPort({ number: 80, service: 'http' }),
    ],
  });
  expect(hasSshAccess(machine)).toBe(true);
});
```

### Anti-Patterns

❌ **WRONG: Using `let` and `beforeEach`**
```typescript
let session: Session;
beforeEach(() => {
  session = { username: 'jshacker', machine: 'localhost', ... };  // Shared mutable state!
});

it('test 1', () => {
  session.machine = 'fileserver';  // Mutates shared state
});

it('test 2', () => {
  expect(session.machine).toBe('localhost');  // Fails! Modified by test 1
});
```

✅ **CORRECT: Factory per test**
```typescript
it('test 1', () => {
  const session = getMockSession({ machine: 'fileserver' });  // Fresh state
  // ...
});

it('test 2', () => {
  const session = getMockSession();  // Fresh state, not affected by test 1
  expect(session.machine).toBe('localhost');  // ✅ Passes
});
```

❌ **WRONG: Incomplete objects**
```typescript
const getMockMachine = () => ({
  hostname: 'web01',  // Missing ip, role, ports, users, filesystem!
});
```

✅ **CORRECT: Complete objects**
```typescript
const getMockMachine = (overrides?: Partial<GeneratedMachine>): GeneratedMachine => ({
  role: 'webserver',
  hostname: 'web01',
  ip: '10.0.1.10',
  ports: [getMockPort()],
  users: [getMockMachineUser()],
  filesystem: getMockFileTree(),
  ...overrides,  // All required fields present
});
```

❌ **WRONG: Redefining schemas in tests**
```typescript
// ❌ Type already defined in src/filesystem/types.ts!
type FileNode = { type: string; content: string | null; owner: string };
const getMockFileNode = () => ({ ... });
```

✅ **CORRECT: Import real types**
```typescript
import type { FileNode } from '@/filesystem/types';

const getMockFileNode = (overrides?: Partial<FileNode>): FileNode => ({
  type: 'file',
  content: 'test content',
  owner: 'jshacker',
  permissions: { read: ['jshacker', 'root'], write: ['jshacker', 'root'], execute: [] },
  ...overrides,
});
```

---

## Coverage Theater Detection

Watch for these patterns that give fake 100% coverage:

### Pattern 1: Mock the function being tested

❌ **WRONG** - Gives 100% coverage but tests nothing:
```typescript
it('calls checkTraversal', () => {
  const spy = vi.spyOn(utils, 'checkTraversal');
  canReadFromMachine('localhost', '/root/secret.txt', 'guest', tree);
  expect(spy).toHaveBeenCalled(); // Meaningless assertion
});
```

✅ **CORRECT** - Test actual behavior:
```typescript
it('should deny access when traversal fails', () => {
  const tree = getMockFileTree({ parentExecute: ['root'] });
  const result = canReadFromMachine('localhost', '/root/secret.txt', 'guest', tree);
  expect(result).toBe(false);
});
```

### Pattern 2: Test only that function was called

❌ **WRONG** - No behavior validation:
```typescript
it('executes command', () => {
  const spy = vi.spyOn(command, 'execute');
  processInput('ls()');
  expect(spy).toHaveBeenCalledWith([]); // So what?
});
```

✅ **CORRECT** - Verify the outcome:
```typescript
it('should list files in current directory', () => {
  const session = getMockSession({ currentPath: '/home/jshacker' });
  const result = ls(session, tree);
  expect(result).toContain('notes.txt');
  expect(result).toContain('downloads');
});
```

### Pattern 3: Test trivial getters/setters

❌ **WRONG** - Testing implementation, not behavior:
```typescript
it('sets machine name', () => {
  session.setMachine('fileserver');
  expect(session.getMachine()).toBe('fileserver'); // Trivial
});
```

✅ **CORRECT** - Test meaningful behavior:
```typescript
it('should update prompt after SSH connection', () => {
  const session = getMockSession({ machine: 'localhost', username: 'jshacker' });
  const updated = pushSession(session, { machine: 'fileserver', username: 'ftpuser' });
  expect(formatPrompt(updated)).toBe('ftpuser@fileserver>');
});
```

### Pattern 4: 100% line coverage, 0% branch coverage

❌ **WRONG** - Missing edge cases:
```typescript
it('resolves path', () => {
  const result = resolvePath('/home', 'jshacker');
  expect(result).toBe('/home/jshacker'); // Only happy path!
});
// Missing: '..' traversal, absolute paths, empty input, etc.
```

✅ **CORRECT** - Test all branches:
```typescript
describe('resolvePath', () => {
  it('should resolve relative paths', () => {
    expect(resolvePath('/home', 'jshacker')).toBe('/home/jshacker');
  });

  it('should handle parent directory traversal', () => {
    expect(resolvePath('/home/jshacker', '../guest')).toBe('/home/guest');
  });

  it('should treat absolute paths as-is', () => {
    expect(resolvePath('/home/jshacker', '/etc/passwd')).toBe('/etc/passwd');
  });

  it('should normalize trailing slashes', () => {
    expect(resolvePath('/home/', 'jshacker/')).toBe('/home/jshacker');
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
  filesystem/machineFileSystems.ts
tests/
  filesystem/fileSystemUtils.test.ts  ← 1:1 mapping
  filesystem/fileSystemFactory.test.ts  ← 1:1 mapping
  filesystem/machineFileSystems.test.ts  ← 1:1 mapping
```

✅ **CORRECT:**
```
src/
  filesystem/fileSystemUtils.ts
  filesystem/fileSystemFactory.ts
  filesystem/machineFileSystems.ts
tests/
  filesystem/file-permissions.test.ts  ← Tests behavior, not implementation files
  filesystem/path-resolution.test.ts
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
