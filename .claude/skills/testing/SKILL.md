---
name: testing
description: Testing patterns for behavior-driven tests. Use when writing tests, creating test factories, structuring test files, or deciding what to test. Do NOT use for UI-specific testing (see front-end-testing or react-testing skills).
---

# Testing Patterns

For verifying test effectiveness through mutation analysis, load the `mutation-testing` skill. For evaluating test quality against Dave Farley's properties, load the `test-design-reviewer` skill.

## Core Principle

**Test behavior, not implementation.** 100% coverage through business behavior, not implementation details.

**Example:** Permission logic in `permissions.ts` gets 100% coverage by testing `checkCommandAccess()` behavior, NOT by directly testing internal helper functions.

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
  const spy = jest.spyOn(permissions, 'checkTraversal');
  checkCommandAccess('cat', 'user', fileSystem);
  expect(spy).toHaveBeenCalled(); // Tests HOW, not WHAT
});

// ❌ Testing private methods
it('should validate binary path', () => {
  const result = permissions._resolveBinaryPath('cat'); // Private method!
  expect(result).toBe('/bin/cat');
});

// ❌ Testing internal state
it('should set accessChecked flag', () => {
  checkCommandAccess('cat', 'user', fileSystem);
  expect(permissions.accessChecked).toBe(true); // Internal state
});
```

✅ **CORRECT - Testing behavior through public API:**

```typescript
it('should deny guest users execute permission on root-only commands', () => {
  const fs = getMockFileSystem({ binaryOwner: 'root' });
  const result = checkCommandAccess('reboot', 'guest', fs);
  expect(result.allowed).toBe(false);
  expect(result.error).toContain('Permission denied');
});

it('should deny access when binary is not installed', () => {
  const fs = getMockFileSystem({ installedTools: [] });
  const result = checkCommandAccess('nmap', 'root', fs);
  expect(result.allowed).toBe(false);
  expect(result.error).toContain('not found');
});

it('should allow access to installed world-executable commands', () => {
  const fs = getMockFileSystem({ installedTools: ['nmap'] });
  const result = checkCommandAccess('nmap', 'user', fs);
  expect(result.allowed).toBe(true);
});
```

---

## Coverage Through Behavior

Permission logic gets 100% coverage by testing the behavior it protects:

```typescript
// Tests covering permission checks WITHOUT testing helpers directly
describe('checkFileAccess', () => {
  it('should deny read access to files owned by root', () => {
    const file = getMockFileNode({
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
    });
    const result = checkFileAccess(file, 'user', 'read');
    expect(result.allowed).toBe(false);
  });

  it('should deny write access for non-owners', () => {
    const file = getMockFileNode({
      owner: 'root',
      permissions: { read: ['root', 'user'], write: ['root'], execute: [] },
    });
    const result = checkFileAccess(file, 'user', 'write');
    expect(result.allowed).toBe(false);
  });

  it('should deny traversal through non-executable directories', () => {
    const dir = getMockFileNode({
      type: 'directory',
      permissions: { read: ['root'], write: ['root'], execute: [] },
    });
    const result = checkFileAccess(dir, 'user', 'execute');
    expect(result.allowed).toBe(false);
  });

  it('should allow read access to world-readable files', () => {
    const file = getMockFileNode({
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    });
    const result = checkFileAccess(file, 'guest', 'read');
    expect(result.allowed).toBe(true);
  });
});

// ✅ Result: permissions.ts has 100% coverage through behavior
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
  name: 'test.txt',
  type: 'file',
  owner: 'user',
  permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: [] },
  content: 'test content',
  ...overrides,
});

// Usage
it('denies write access to guest users', () => {
  const file = getMockFileNode({
    owner: 'root',
    permissions: { read: ['root'], write: ['root'], execute: [] },
  });
  const result = checkFileAccess(file, 'guest', 'write');
  expect(result.allowed).toBe(false);
});
```

### Complete Factory Example

```typescript
import { type FileNode } from '@/types';

const getMockFileNode = (overrides?: Partial<FileNode>): FileNode => ({
  name: 'test.txt',
  type: 'file',
  owner: 'user',
  permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: [] },
  content: 'test content',
  children: undefined,
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
  ip: '10.0.0.5',
  hostname: 'target-srv',
  ports: [getMockPort()], // ✅ Compose factories
  users: [getMockRemoteUser()], // ✅ Compose factories
  ...overrides,
});

// Usage - override nested objects
it('finds vulnerable services on machine', () => {
  const machine = getMockMachine({
    ports: [
      getMockPort({ port: 22, service: 'ssh', open: true }),
      getMockPort({ port: 80, service: 'http', open: true, vulnerability: { type: 'rce' } }),
    ],
  });
  expect(findVulnerablePorts(machine)).toHaveLength(1);
});
```

### Anti-Patterns

❌ **WRONG: Using `let` and `beforeEach`**

```typescript
let file: FileNode;
beforeEach(() => {
  file = { name: 'test.txt', type: 'file', owner: 'user', ... };  // Shared mutable state!
});

it('test 1', () => {
  file.owner = 'root';  // Mutates shared state
});

it('test 2', () => {
  expect(file.owner).toBe('user');  // Fails! Modified by test 1
});
```

✅ **CORRECT: Factory per test**

```typescript
it('test 1', () => {
  const file = getMockFileNode({ owner: 'root' }); // Fresh state
  // ...
});

it('test 2', () => {
  const file = getMockFileNode(); // Fresh state, not affected by test 1
  expect(file.owner).toBe('user'); // ✅ Passes
});
```

❌ **WRONG: Incomplete objects**

```typescript
const getMockFileNode = () => ({
  name: 'test.txt', // Missing type, owner, permissions!
});
```

✅ **CORRECT: Complete objects**

```typescript
const getMockFileNode = (overrides?: Partial<FileNode>): FileNode => ({
  name: 'test.txt',
  type: 'file',
  owner: 'user',
  permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: [] },
  content: 'test content',
  ...overrides, // All required fields present
});
```

❌ **WRONG: Redefining types in tests**

```typescript
// ❌ Type already defined in src/types.ts!
type FileNode = { name: string; type: string };
const getMockFileNode = (): FileNode => ({ ... });
```

✅ **CORRECT: Import real types**

```typescript
import { type FileNode } from '@/types';

const getMockFileNode = (overrides?: Partial<FileNode>): FileNode => ({
  name: 'test.txt',
  type: 'file',
  owner: 'user',
  permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: [] },
  ...overrides,
});
```

---

## Coverage Theater Detection

Watch for these patterns that give fake 100% coverage:

### Pattern 1: Mock the function being tested

❌ **WRONG** - Gives 100% coverage but tests nothing:

```typescript
it('calls permission check', () => {
  const spy = jest.spyOn(permissions, 'checkAccess');
  checkAccess(fileNode, 'user');
  expect(spy).toHaveBeenCalled(); // Meaningless assertion
});
```

✅ **CORRECT** - Test actual behavior:

```typescript
it('should deny write access for non-owner users', () => {
  const file = getMockFileNode({
    owner: 'root',
    permissions: { read: ['root'], write: ['root'], execute: [] },
  });
  const result = checkFileAccess(file, 'user', 'write');
  expect(result.allowed).toBe(false);
  expect(result.error).toContain('Permission denied');
});
```

### Pattern 2: Test only that function was called

❌ **WRONG** - No behavior validation:

```typescript
it('executes command', () => {
  const spy = jest.spyOn(executor, 'run');
  executeCommand('ls', context);
  expect(spy).toHaveBeenCalledWith('ls', context); // So what?
});
```

✅ **CORRECT** - Verify the outcome:

```typescript
it('should list files in current directory', () => {
  const context = getMockContext({ cwd: '/home/user' });
  const result = executeCommand('ls', context);
  expect(result).toContain('documents');
  expect(result).toContain('.bashrc');
});
```

### Pattern 3: Test trivial getters/setters

❌ **WRONG** - Testing implementation, not behavior:

```typescript
it('sets file content', () => {
  file.content = 'new data';
  expect(file.content).toBe('new data'); // Trivial
});
```

✅ **CORRECT** - Test meaningful behavior:

```typescript
it('should count open ports on machine', () => {
  const machine = getMockMachine({
    ports: [getMockPort({ open: true }), getMockPort({ open: false }), getMockPort({ open: true })],
  });
  expect(countOpenPorts(machine)).toBe(2);
});
```

### Pattern 4: 100% line coverage, 0% branch coverage

❌ **WRONG** - Missing edge cases:

```typescript
it('checks file permission', () => {
  const result = checkFileAccess(getMockFileNode(), 'user', 'read');
  expect(result.allowed).toBe(true); // Only happy path!
});
// Missing: root-only files, guest access, directory traversal, missing files, etc.
```

✅ **CORRECT** - Test all branches:

```typescript
describe('checkFileAccess', () => {
  it('should deny guest access to restricted files', () => {
    const file = getMockFileNode({ permissions: { read: ['root'], write: ['root'], execute: [] } });
    expect(checkFileAccess(file, 'guest', 'read').allowed).toBe(false);
  });

  it('should deny write to non-owners', () => {
    const file = getMockFileNode({
      owner: 'root',
      permissions: { read: ['root', 'user'], write: ['root'], execute: [] },
    });
    expect(checkFileAccess(file, 'user', 'write').allowed).toBe(false);
  });

  it('should deny execute on non-executable files', () => {
    const file = getMockFileNode({
      permissions: { read: ['root', 'user'], write: ['root'], execute: [] },
    });
    expect(checkFileAccess(file, 'user', 'execute').allowed).toBe(false);
  });

  it('should allow read on world-readable files', () => {
    const file = getMockFileNode({
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    });
    expect(checkFileAccess(file, 'guest', 'read').allowed).toBe(true);
  });
});
```

---

## No 1:1 Mapping Between Tests and Implementation

Don't create test files that mirror implementation files.

❌ **WRONG:**

```
src/
  permissions.ts
  availability.ts
  access-check.ts
tests/
  permissions.test.ts   ← 1:1 mapping
  availability.test.ts  ← 1:1 mapping
  access-check.test.ts  ← 1:1 mapping
```

✅ **CORRECT:**

```
src/
  permissions.ts
  availability.ts
  access-check.ts
tests/
  command-access.test.ts  ← Tests behavior, not implementation files
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
