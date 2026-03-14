---
name: functional
description: Functional programming patterns with immutable data. Use when writing logic, data transformations, or encountering mutation bugs. Covers immutability violations catalog, pure functions, composition, early returns, and options objects. Do NOT over-apply heavy FP abstractions (monads, fp-ts) unless the project requires them.
---

# Functional Patterns

## Core Principles

- **No data mutation** - immutable structures only
- **Pure functions** wherever possible
- **Composition** over inheritance
- **Self-documenting code** - comments explain "why", not "what"
- **Array methods** over loops
- **Options objects** over positional parameters

---

## Why Immutability Matters

Immutable data is the foundation of functional programming. Understanding WHY helps you embrace it:

- **Predictable**: Same input always produces same output (no hidden state changes)
- **Debuggable**: State doesn't change unexpectedly - easier to trace bugs
- **Testable**: No hidden mutable state makes tests straightforward
- **React-friendly**: React's reconciliation and memoization optimizations work correctly
- **Concurrency-safe**: No race conditions when data can't change

**Example of the problem:**

```typescript
// ❌ WRONG - Mutation creates unpredictable behavior
const machine = { hostname: 'target', ports: [{ port: 22, open: true }] };
addPort(machine, { port: 80, open: false }); // Mutates machine.ports internally
console.log(machine.ports.length); // 2 - SURPRISE! machine changed
```

```typescript
// ✅ CORRECT - Immutable approach is predictable
const machine = { hostname: 'target', ports: [{ port: 22, open: true }] };
const updatedMachine = addPort(machine, { port: 80, open: false }); // Returns new object
console.log(machine.ports.length); // 1 - original unchanged
console.log(updatedMachine.ports.length); // 2 - new version
```

---

## Functional Light

We follow "Functional Light" principles - practical functional patterns without heavy abstractions:

**What we DO:**

- Pure functions and immutable data
- Composition and declarative code
- Array methods over loops
- Type safety and readonly

**What we DON'T do:**

- Category theory or monads
- Heavy FP libraries (fp-ts, Ramda)
- Over-engineering with abstractions
- Functional for the sake of functional

**Why:** The goal is **maintainable, testable code** - not academic purity. If a functional pattern makes code harder to understand, don't use it.

**Example - Keep it simple:**

```typescript
// ✅ GOOD - Simple, clear, functional
const openPorts = machine.ports.filter((p) => p.open);
const serviceNames = openPorts.map((p) => p.service);

// ❌ OVER-ENGINEERED - Unnecessary abstraction
const compose =
  <T>(...fns: Array<(arg: T) => T>) =>
  (x: T) =>
    fns.reduceRight((v, f) => f(v), x);
const openPorts = compose(
  filter((p: Port) => p.open),
  map((p: Port) => p.service),
)(machine.ports);
```

---

## Self-Documenting Code with Purposeful Comments

Code should be clear through naming and structure. Comments that restate **what** the code does are noise. Comments that explain **why** — the intent, the non-obvious constraint, the business reason — are valuable.

### The Rule

- **No "what" comments** — if code needs a comment to explain what it does, refactor the code instead
- **Yes "why" comments** — when logic is complex, non-obvious, or driven by a constraint that isn't apparent from the code itself
- **JSDoc for public APIs** when generating documentation

### Examples

❌ **WRONG - Comments restating what the code does**

```typescript
// Get the file and check if readable and user has access
function check(f: any) {
  // Check file exists
  if (f) {
    // Check if readable
    if (f.r) {
      // Check permission
      if (f.p) {
        return true;
      }
    }
  }
  return false;
}
```

✅ **CORRECT - Self-documenting code, no comments needed**

```typescript
function canReadFile(file: FileNode | undefined, user: UserType): boolean {
  if (!file) return false;
  if (file.type !== 'file') return false;
  if (!file.permissions.read.includes(user)) return false;
  return true;
}
```

✅ **CORRECT - Comment explains WHY, not what**

```typescript
function findBinary(name: string, machine: string, getNode: GetNodeFn): FileNode | null {
  // Check cwd first so locally-placed scripts override system binaries
  const cwdBinary = getNode(machine, `${currentPath}/${name}`, '/');
  if (cwdBinary) return cwdBinary;

  const binBinary = getNode(machine, `/bin/${name}`, '/');
  if (binBinary) return binBinary;
  return getNode(machine, `/usr/bin/${name}`, '/');
}
```

✅ **CORRECT - Comment explains a non-obvious constraint**

```typescript
const resolveNat = (ip: string, port: number): string | null => {
  // NAT rules on the router use iptables DNAT — we must match the
  // external port to the internal mapping, not the service port
  const rule = iptablesRules.find((r) => r.externalPort === port);
  if (!rule) return null;
  return rule.internalIp;
};
```

### When to Comment

**Do comment when:**

- The logic involves a non-obvious constraint or edge case
- There's a "why" that isn't captured by naming alone
- A workaround exists for a known issue or limitation
- The algorithm is inherently complex (encoding, crypto, procedural generation)

**Don't comment when:**

- The code is self-explanatory through naming and structure
- The comment just restates what the next line does
- A better function/variable name would make the comment unnecessary

### When Code Needs Explaining

If code needs **what** comments, refactor instead:

- Extract functions with descriptive names
- Use meaningful variable names
- Break complex logic into steps
- Use type aliases for domain concepts

✅ **JSDoc for public APIs**

```typescript
/**
 * Applies a filesystem patch to a machine's virtual filesystem.
 * @param patch - The patch containing path, content, and permissions
 * @throws {PermissionError} if current user lacks write access
 */
export function applyFileSystemPatch(patch: FileSystemPatch): void {
  // Implementation
}
```

---

## Array Methods Over Loops

Prefer `map`, `filter`, `reduce` for transformations. They're declarative (what, not how) and naturally immutable.

### Map - Transform Each Element

❌ **WRONG - Imperative loop**

```typescript
const commandNames = [];
for (const command of commands) {
  commandNames.push(command.name);
}
```

✅ **CORRECT - Functional map**

```typescript
const commandNames = commands.map((c) => c.name);
```

### Filter - Select Subset

❌ **WRONG - Imperative loop**

```typescript
const networkCommands = [];
for (const command of commands) {
  if (command.category === 'network') {
    networkCommands.push(command);
  }
}
```

✅ **CORRECT - Functional filter**

```typescript
const networkCommands = commands.filter((c) => c.category === 'network');
```

### Reduce - Aggregate Values

❌ **WRONG - Imperative loop**

```typescript
let openPortCount = 0;
for (const port of machine.ports) {
  if (port.open) openPortCount += 1;
}
```

✅ **CORRECT - Functional reduce**

```typescript
const openPortCount = machine.ports.reduce((count, port) => count + (port.open ? 1 : 0), 0);
```

### Chaining Multiple Operations

✅ **CORRECT - Compose array methods**

```typescript
const vulnerableServices = machine.ports
  .filter((port) => port.open)
  .filter((port) => port.vulnerability !== undefined)
  .map((port) => port.service);
```

### When Loops Are Acceptable

Imperative loops are fine when:

- Early termination is essential (use `for...of` with `break`)
- Performance critical (measure first!)
- Side effects are necessary (logging, DOM manipulation)

But even then, consider:

- `Array.find()` for early termination
- `Array.some()` / `Array.every()` for boolean checks

---

## Options Objects Over Positional Parameters

Default to options objects for function parameters. This improves readability and reduces ordering dependencies.

### Why Options Objects?

**Benefits:**

- Named parameters (clear what each argument means)
- No ordering dependencies
- Easy to add optional parameters
- Self-documenting at call site
- TypeScript autocomplete

### Examples

❌ **WRONG - Positional parameters**

```typescript
function createRemoteMachine(
  ip: string,
  hostname: string,
  ports: readonly Port[],
  users: readonly RemoteUser[],
  vulnerable: boolean,
  natEnabled: boolean,
): RemoteMachine {
  // ...
}

// Call site - unclear what parameters mean
createRemoteMachine('10.0.0.5', 'target', ports, users, true, false);
```

✅ **CORRECT - Options object**

```typescript
type CreateRemoteMachineOptions = {
  readonly ip: string;
  readonly hostname: string;
  readonly ports: readonly Port[];
  readonly users: readonly RemoteUser[];
  readonly vulnerable?: boolean;
  readonly natEnabled?: boolean;
};

function createRemoteMachine(options: CreateRemoteMachineOptions): RemoteMachine {
  const { ip, hostname, ports, users, vulnerable = false, natEnabled = false } = options;
  // ...
}

// Call site - crystal clear
createRemoteMachine({
  ip: '10.0.0.5',
  hostname: 'target',
  ports: [{ port: 22, service: 'ssh', open: true }],
  users: [{ username: 'admin', password: 'secret' }],
  vulnerable: true,
});
```

### When Positional Parameters Are OK

Use positional parameters when:

- 1-2 parameters max
- Order is obvious (e.g., `add(a, b)`)
- High-frequency utility functions

```typescript
// ✅ OK - Obvious ordering, few parameters
function add(a: number, b: number): number {
  return a + b;
}

function updateFileNode(node: FileNode, changes: Partial<FileNode>): FileNode {
  return { ...node, ...changes };
}
```

---

## Pure Functions

Pure functions have no side effects and always return the same output for the same input.

### What Makes a Function Pure?

1. **No side effects**
   - Doesn't mutate external state
   - Doesn't modify function arguments
   - Doesn't perform I/O (network, file system, console)

2. **Deterministic**
   - Same input → same output
   - No dependency on external state (Date.now(), Math.random(), global vars)

3. **Referentially transparent**
   - Can replace function call with its return value

### Examples

❌ **WRONG - Impure function (mutations)**

```typescript
function addPort(ports: Port[], newPort: Port): void {
  ports.push(newPort); // ❌ Mutates input
}

let lineId = 0;
function nextLineId(): number {
  lineId++; // ❌ Modifies external state
  return lineId;
}
```

✅ **CORRECT - Pure functions**

```typescript
function addPort(ports: ReadonlyArray<Port>, newPort: Port): ReadonlyArray<Port> {
  return [...ports, newPort]; // ✅ Returns new array
}

function nextLineId(currentId: number): number {
  return currentId + 1; // ✅ No external state
}
```

### Benefits of Pure Functions

- **Testable**: No setup/teardown needed
- **Composable**: Easy to combine
- **Predictable**: No hidden behavior
- **Cacheable**: Memoization possible
- **Parallelizable**: No race conditions

### When Impurity Is Necessary

Some functions must be impure (I/O, randomness, side effects). Isolate them:

```typescript
// ✅ CORRECT - Isolate impure functions at edges
// Pure core
function buildOutputLines(content: string, startId: number): ReadonlyArray<OutputLine> {
  return content.split('\n').map((line, i) => ({
    id: startId + i,
    type: 'result' as const,
    content: line,
  }));
}

// Impure shell (isolated)
async function persistFileSystemPatch(patch: FileSystemPatch): Promise<void> {
  const validated = validatePatch(patch); // Pure
  await indexedDB.savePatch(validated); // Impure (I/O)
}
```

**Pattern**: Keep impure functions at system boundaries (adapters, ports). Keep core domain logic pure.

---

## Composition Over Complex Logic

Compose small functions into larger ones. Each function does one thing well.

### Benefits of Composition

- Easier to understand (each piece is simple)
- Easier to test (test pieces independently)
- Easier to reuse (pieces work in multiple contexts)
- Easier to maintain (change one piece without affecting others)

### Examples

❌ **WRONG - Complex monolithic function**

```typescript
function executeCommand(input: unknown) {
  if (typeof input !== 'string' || !input) {
    throw new Error('Invalid input');
  }
  if (!commandMap.has(input)) {
    throw new Error('Command not found');
  }
  if (!checkBinaryExists(input)) {
    throw new Error('Binary not installed');
  }
  if (!checkExecutePermission(input, currentUser)) {
    throw new Error('Permission denied');
  }
  // ... 50 more lines of parsing and execution
}
```

✅ **CORRECT - Composed functions**

```typescript
// Small, focused functions
const parseCommand = (input: string) => commandMap.get(input);
const checkAccess = (cmd: Command) => wrapWithAccessCheck(cmd);

// Compose them
const executeCommand = (input: string) => checkAccess(parseCommand(input));

// Even better - use pipe/compose utilities
const executeCommand = pipe(parseCommand, checkAccess);
```

### Composing Immutable Transformations

```typescript
// Small transformation functions
const addPort = (machine: RemoteMachine, port: Port): RemoteMachine => ({
  ...machine,
  ports: [...machine.ports, port],
});

const setHostname = (machine: RemoteMachine, hostname: string): RemoteMachine => ({
  ...machine,
  hostname,
});

const addUser = (machine: RemoteMachine, user: RemoteUser): RemoteMachine => ({
  ...machine,
  users: [...machine.users, user],
});

// Compose them
const buildTargetMachine = (machine: RemoteMachine): RemoteMachine => {
  return addUser(
    addPort(setHostname(machine, 'target-srv'), { port: 22, service: 'ssh', open: true }),
    { username: 'admin', password: 'secret' },
  );
};

// Or use pipe for left-to-right reading
const buildTargetMachine = (machine: RemoteMachine): RemoteMachine =>
  pipe(
    machine,
    (m) => setHostname(m, 'target-srv'),
    (m) => addPort(m, { port: 22, service: 'ssh', open: true }),
    (m) => addUser(m, { username: 'admin', password: 'secret' }),
  );
```

---

## Readonly Keyword for Immutability

Use `readonly` on all data structures to signal immutability intent.

### readonly on Properties

```typescript
// ✅ CORRECT - Immutable data structure
type Command = {
  readonly name: string;
  readonly category: CommandCategory;
  readonly description: string;
};

// ❌ WRONG - Mutable
type Command = {
  name: string;
  category: CommandCategory;
};
```

### ReadonlyArray vs Array

```typescript
// ✅ CORRECT - Immutable array
type FileNode = {
  readonly children: ReadonlyArray<FileNode>;
};

// ❌ WRONG - Mutable array
type FileNode = {
  readonly children: FileNode[];
};
```

### Nested readonly

```typescript
// ✅ CORRECT - Deep immutability
type Port = {
  readonly port: number;
  readonly service: string;
  readonly vulnerability: {
    readonly type: string;
    readonly severity: readonly string[];
  };
};
```

### Why readonly Matters

- **Compiler enforces immutability**: TypeScript errors on mutation attempts
- **Self-documenting**: Signals "don't mutate this"
- **Functional programming alignment**: Natural fit for FP patterns
- **Prevents accidental bugs**: Can't accidentally mutate data

---

## Deep Nesting Limitation

**Max 2 levels of function nesting.** Beyond that, extract functions.

### Why Limit Nesting?

- Deeply nested code is hard to read
- Hard to test (many paths through code)
- Hard to modify (tight coupling)
- Sign of missing abstractions

### Examples

❌ **WRONG - Deep nesting (4+ levels)**

```typescript
function executeCommand(cmd: Command, user: UserType, fs: FileNode) {
  if (cmd.fn) {
    if (user !== 'guest') {
      if (checkBinaryExists(cmd.name, fs)) {
        if (cmd.permissions.execute.includes(user)) {
          // ... deeply nested logic
        }
      }
    }
  }
}
```

✅ **CORRECT - Flat with early returns**

```typescript
function executeCommand(cmd: Command, user: UserType, fs: FileNode) {
  if (!cmd.fn) return;
  if (user === 'guest') return;
  if (!checkBinaryExists(cmd.name, fs)) return;
  if (!cmd.permissions.execute.includes(user)) return;

  // Main logic at top level
}
```

✅ **CORRECT - Extract to functions**

```typescript
function executeCommand(cmd: Command, user: UserType, fs: FileNode) {
  if (!canExecuteCommand(cmd, user, fs)) return;
  const resolved = resolveCommand(cmd);
  return runCommand(resolved);
}

function canExecuteCommand(cmd: Command, user: UserType, fs: FileNode): boolean {
  return (
    !!cmd.fn &&
    user !== 'guest' &&
    checkBinaryExists(cmd.name, fs) &&
    cmd.permissions.execute.includes(user)
  );
}
```

---

## Immutable Array Operations

**Complete catalog of array mutations and their immutable alternatives:**

```typescript
// ❌ WRONG - Mutations
items.push(newItem); // Add to end
items.pop(); // Remove last
items.unshift(newItem); // Add to start
items.shift(); // Remove first
items.splice(index, 1); // Remove at index
items.reverse(); // Reverse order
items.sort(); // Sort
items[i] = newValue; // Update at index

// ✅ CORRECT - Immutable alternatives
const withNew = [...items, newItem]; // Add to end
const withoutLast = items.slice(0, -1); // Remove last
const withFirst = [newItem, ...items]; // Add to start
const withoutFirst = items.slice(1); // Remove first
const removed = [
  ...items.slice(0, index), // Remove at index
  ...items.slice(index + 1),
];
const reversed = [...items].reverse(); // Reverse (copy first!)
const sorted = [...items].sort(); // Sort (copy first!)
const updated = items.map(
  (
    item,
    idx, // Update at index
  ) => (idx === i ? newValue : item),
);
```

**Common patterns:**

```typescript
// Filter out specific item
const withoutItem = items.filter((item) => item.id !== targetId);

// Replace specific item
const replaced = items.map((item) => (item.id === targetId ? newItem : item));

// Insert at specific position
const inserted = [...items.slice(0, index), newItem, ...items.slice(index)];
```

---

## Immutable Object Updates

```typescript
// ❌ WRONG
file.content = 'new data';
Object.assign(file, { content: 'new data' });

// ✅ CORRECT
const updated = { ...file, content: 'new data' };
```

---

## Nested Updates

```typescript
// ✅ CORRECT - Immutable nested update
const updatedDirectory = {
  ...directory,
  children: directory.children.map((child, i) =>
    i === targetIndex ? { ...child, content: newContent } : child,
  ),
};

// ✅ CORRECT - Immutable nested array update
const updatedMachine = {
  ...machine,
  ports: [...machine.ports.slice(0, index), updatedPort, ...machine.ports.slice(index + 1)],
};
```

---

## Early Returns Over Nesting

```typescript
// ❌ WRONG - Nested conditions
if (file) {
  if (file.type === 'file') {
    if (file.permissions.read.includes(user)) {
      // do something
    }
  }
}

// ✅ CORRECT - Early returns (guard clauses)
if (!file) return;
if (file.type !== 'file') return;
if (!file.permissions.read.includes(user)) return;

// do something
```

---

## Result Type for Error Handling

```typescript
type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

// Usage
function checkPermission(
  file: FileNode,
  user: UserType,
  action: 'read' | 'write' | 'execute',
): Result<PermissionResult> {
  if (!file) {
    return { success: false, error: new Error('File not found') };
  }

  const allowed = file.permissions[action].includes(user);
  return { success: true, data: { allowed, error: allowed ? undefined : 'Permission denied' } };
}

// Caller handles both cases explicitly
const result = checkPermission(file, 'user', 'read');
if (!result.success) {
  console.error(result.error);
  return;
}

// TypeScript knows result.data exists here
console.log(result.data.allowed);
```

---

## Summary Checklist

When writing functional code, verify:

- [ ] No data mutation - using spread operators
- [ ] Pure functions wherever possible (no side effects)
- [ ] Code is self-documenting; comments explain "why", not "what"
- [ ] Array methods (`map`, `filter`, `reduce`) over loops
- [ ] Options objects for 3+ parameters
- [ ] Composed small functions, not complex monoliths
- [ ] `readonly` on all data structure properties
- [ ] `ReadonlyArray<T>` for immutable arrays
- [ ] Max 2 levels of nesting (use early returns)
- [ ] Result types for error handling
