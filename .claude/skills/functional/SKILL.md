---
name: functional
description: Functional programming patterns with immutable data. Use when writing logic or data transformations.
---

# Functional Patterns

## Core Principles

- **No data mutation** - immutable structures only
- **Pure functions** wherever possible
- **Composition** over inheritance
- **Prefer self-documenting code** - but use comments for complex logic
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
const session = { username: 'jshacker', machine: 'localhost' };
connectToMachine(session, '192.168.1.50'); // Mutates session internally
console.log(session.machine); // '192.168.1.50' - SURPRISE! session changed
```

```typescript
// ✅ CORRECT - Immutable approach is predictable
const session = { username: 'jshacker', machine: 'localhost' };
const newSession = connectToMachine(session, '192.168.1.50'); // Returns new object
console.log(session.machine); // 'localhost' - original unchanged
console.log(newSession.machine); // '192.168.1.50' - new version
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

## Comments — Prefer Self-Documenting Code

Code should be clear through naming and structure first. But comments are welcome when they add value — especially for complex logic, non-obvious decisions, or tricky patterns.

### When Comments Are Valuable

- **Complex algorithms or logic** that can't be made obvious through naming alone
- **Non-obvious "why"** — explaining _why_ something is done a certain way (not _what_ it does)
- **Workarounds or edge cases** — documenting gotchas, browser quirks, or known limitations
- **Architectural patterns** — explaining circular dependency resolution, lazy initialization, etc.
- **JSDoc for public APIs**

### When Comments Are NOT Needed

- Restating what the code already says (`// increment counter` before `counter + 1`)
- Compensating for bad naming — rename instead
- Commenting every line or every function

### Examples

❌ **WRONG - Comments compensating for bad code**

```typescript
// Check if user can read the file
function check(f: any, u: any) {
  // Check file exists
  if (f) {
    // Check permissions array
    if (f.p && f.p.r) {
      // Check user type in array
      if (f.p.r.includes(u)) {
        return true;
      }
    }
  }
  return false;
}
```

✅ **CORRECT - Self-documenting code (no comments needed)**

```typescript
function canUserReadFile(file: FileNode | undefined, userType: UserType): boolean {
  return file?.permissions.read.includes(userType) ?? false;
}
```

✅ **CORRECT - Comment explaining non-obvious logic**

```typescript
// Mutable ref set after building the full command map — node's factory
// captures a getter that's only called at execution time, breaking
// the circular dependency between node() and the execution context.
let resolvedExecutionContext: ExecutionContext | undefined;
```

✅ **CORRECT - Comment explaining "why"**

```typescript
// Mission filesystem patches are excluded from persistence — only static
// machine patches are saved, since missions regenerate from seed on reload.
const patchesToSave = patches.filter((p) => STATIC_MACHINE_KEYS.has(p.machineId));
```

### First Resort: Refactor

Before adding a comment, consider whether you can make the code clearer by:

- Extracting functions with descriptive names
- Using meaningful variable names
- Breaking complex logic into steps
- Using type aliases for domain concepts

If those don't fully clarify the intent, add a comment — that's what they're for.

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
const commandNames = commands.map((cmd) => cmd.name);
```

### Filter - Select Subset

❌ **WRONG - Imperative loop**

```typescript
const openPorts = [];
for (const port of machine.ports) {
  if (port.open) {
    openPorts.push(port);
  }
}
```

✅ **CORRECT - Functional filter**

```typescript
const openPorts = machine.ports.filter((p) => p.open);
```

### Reduce - Aggregate Values

❌ **WRONG - Imperative loop**

```typescript
let totalOpen = 0;
for (const machine of machines) {
  totalOpen += machine.ports.filter((p) => p.open).length;
}
```

✅ **CORRECT - Functional reduce**

```typescript
const totalOpen = machines.reduce((sum, m) => sum + m.ports.filter((p) => p.open).length, 0);
```

### Chaining Multiple Operations

✅ **CORRECT - Compose array methods**

```typescript
const sshServices = machines
  .filter((m) => m.ports.some((p) => p.port === 22 && p.open))
  .map((m) => m.hostname)
  .join(', ');
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
  sshOpen: boolean,
  httpOpen: boolean,
  rootPassword: string,
  userPassword: string,
): RemoteMachine {
  // ...
}

// Call site - unclear what parameters mean
createRemoteMachine('192.168.1.50', 'fileserver', true, false, 'root123', 'password');
```

✅ **CORRECT - Options object**

```typescript
type CreateMachineOptions = {
  ip: string;
  hostname: string;
  ports: { port: number; service: string; open: boolean }[];
  users: { username: string; passwordHash: string; userType: UserType }[];
};

function createRemoteMachine(options: CreateMachineOptions): RemoteMachine {
  const { ip, hostname, ports, users } = options;
  // ...
}

// Call site - crystal clear
createRemoteMachine({
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [{ port: 22, service: 'ssh', open: true }],
  users: [{ username: 'ftpuser', passwordHash: '5f4dcc3b...', userType: 'user' }],
});
```

### When Positional Parameters Are OK

Use positional parameters when:

- 1-2 parameters max
- Order is obvious (e.g., `add(a, b)`)
- High-frequency utility functions

```typescript
// ✅ OK - Obvious ordering, few parameters
function md5(input: string): string {
  return hash(input);
}

function updateSession(session: Session, changes: Partial<Session>): Session {
  return { ...session, ...changes };
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
function addOutputLine(lines: OutputLine[], newLine: OutputLine): void {
  lines.push(newLine); // ❌ Mutates input
}

let lineId = 0;
function getNextLineId(): number {
  lineId++; // ❌ Modifies external state
  return lineId;
}
```

✅ **CORRECT - Pure functions**

```typescript
function addOutputLine(
  lines: ReadonlyArray<OutputLine>,
  newLine: OutputLine,
): ReadonlyArray<OutputLine> {
  return [...lines, newLine]; // ✅ Returns new array
}

function getNextLineId(currentId: number): number {
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
function validatePassword(inputHash: string, storedHash: string): boolean {
  return inputHash === storedHash;
}

function findUserInMachine(machine: RemoteMachine, username: string): RemoteUser | undefined {
  return machine.users.find((u) => u.username === username);
}

// Impure shell (isolated) - uses React state
function handleSshLogin(password: string, machine: RemoteMachine, targetUser: string): void {
  const user = findUserInMachine(machine, targetUser); // Pure
  const isValid = user && validatePassword(md5(password), user.passwordHash); // Pure
  if (isValid) {
    setSession({ username: targetUser, machine: machine.ip }); // Impure (state)
  }
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
function executeCommand(input: string, context: ExecutionContext) {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid input');
  }
  const trimmed = input.trim();
  if (trimmed.startsWith('const ') || trimmed.startsWith('let ')) {
    // Handle variable declaration...
    // ... 30 lines of variable parsing
  }
  // Try to find command
  // ... 20 more lines of command lookup and execution
}
```

✅ **CORRECT - Composed functions**

```typescript
// Small, focused functions
const isVariableDeclaration = (input: string) =>
  input.startsWith('const ') || input.startsWith('let ');

const parseVariableDeclaration = (input: string) => VariableSchema.parse(input);

const executeAsCommand = (input: string, context: ExecutionContext) =>
  new Function(...Object.keys(context), `return ${input}`)(...Object.values(context));

// Compose them
function executeCommand(input: string, context: ExecutionContext) {
  const trimmed = input.trim();
  if (isVariableDeclaration(trimmed)) {
    return parseVariableDeclaration(trimmed);
  }
  return executeAsCommand(trimmed, context);
}
```

### Composing Immutable Transformations

```typescript
// Small transformation functions
const setUsername = (session: Session, username: string, userType: UserType): Session => ({
  ...session,
  username,
  userType,
});

const setMachine = (session: Session, machine: string): Session => ({
  ...session,
  machine,
});

const resetToDefault = (session: Session): Session => ({
  ...session,
  username: 'jshacker',
  userType: 'user',
  machine: 'localhost',
});

// Compose them for SSH login
const loginToRemote = (session: Session, user: string, userType: UserType, ip: string): Session => {
  return setMachine(setUsername(session, user, userType), ip);
};

// Or use pipe for left-to-right reading
const loginToRemote = (session: Session, user: string, userType: UserType, ip: string): Session =>
  pipe(
    session,
    (s) => setUsername(s, user, userType),
    (s) => setMachine(s, ip),
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
  readonly description: string;
  readonly fn: (...args: unknown[]) => unknown;
};

// ❌ WRONG - Mutable
type Command = {
  name: string;
  description: string;
};
```

### ReadonlyArray vs Array

```typescript
// ✅ CORRECT - Immutable array
type RemoteMachine = {
  readonly ports: ReadonlyArray<Port>;
  readonly users: ReadonlyArray<RemoteUser>;
};

// ❌ WRONG - Mutable array
type RemoteMachine = {
  readonly ports: Port[];
};
```

### Nested readonly

```typescript
// ✅ CORRECT - Deep immutability
type FileNode = {
  readonly name: string;
  readonly type: 'file' | 'directory';
  readonly permissions: {
    readonly read: ReadonlyArray<UserType>;
    readonly write: ReadonlyArray<UserType>;
    readonly execute: ReadonlyArray<UserType>;
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
function handleSshConnection(user: string, host: string, password: string) {
  const machine = getMachine(host);
  if (machine) {
    const sshPort = machine.ports.find((p) => p.port === 22);
    if (sshPort && sshPort.open) {
      const remoteUser = machine.users.find((u) => u.username === user);
      if (remoteUser) {
        if (md5(password) === remoteUser.passwordHash) {
          // ... deeply nested login logic
        }
      }
    }
  }
}
```

✅ **CORRECT - Flat with early returns**

```typescript
function handleSshConnection(user: string, host: string, password: string) {
  const machine = getMachine(host);
  if (!machine) throw new Error('Connection refused');

  const sshPort = machine.ports.find((p) => p.port === 22);
  if (!sshPort?.open) throw new Error('Connection refused');

  const remoteUser = machine.users.find((u) => u.username === user);
  if (!remoteUser) throw new Error('Permission denied');

  if (md5(password) !== remoteUser.passwordHash) throw new Error('Permission denied');

  // Main login logic at top level
}
```

✅ **CORRECT - Extract to functions**

```typescript
function handleSshConnection(user: string, host: string, password: string) {
  const machine = validateMachineAccess(host);
  const remoteUser = validateUserCredentials(machine, user, password);
  return connectToMachine(machine, remoteUser);
}

function validateMachineAccess(host: string): RemoteMachine {
  const machine = getMachine(host);
  if (!machine) throw new Error('Connection refused');
  if (!machine.ports.some((p) => p.port === 22 && p.open)) throw new Error('Connection refused');
  return machine;
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
session.machine = '192.168.1.50';
Object.assign(session, { machine: '192.168.1.50' });

// ✅ CORRECT
const updated = { ...session, machine: '192.168.1.50' };
```

---

## Nested Updates

```typescript
// ✅ CORRECT - Immutable nested update
const updatedMachine = {
  ...machine,
  ports: machine.ports.map((port) => (port.port === 22 ? { ...port, open: false } : port)),
};

// ✅ CORRECT - Immutable nested array update
const updatedNetwork = {
  ...network,
  machines: [
    ...network.machines.slice(0, index),
    updatedMachine,
    ...network.machines.slice(index + 1),
  ],
};
```

---

## Early Returns Over Nesting

```typescript
// ❌ WRONG - Nested conditions
if (file) {
  if (file.type === 'file') {
    if (file.permissions.read.includes(userType)) {
      // read file content
    }
  }
}

// ✅ CORRECT - Early returns (guard clauses)
if (!file) return;
if (file.type !== 'file') return;
if (!file.permissions.read.includes(userType)) return;

// read file content
```

---

## Result Type for Error Handling

```typescript
type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

// Usage
function readFileContent(path: string, userType: UserType): Result<string> {
  const file = resolveFile(path);
  if (!file) {
    return { success: false, error: new Error(`cat: ${path}: No such file`) };
  }
  if (!file.permissions.read.includes(userType)) {
    return { success: false, error: new Error(`cat: ${path}: Permission denied`) };
  }

  return { success: true, data: file.content ?? '' };
}

// Caller handles both cases explicitly
const result = readFileContent('/etc/passwd', 'guest');
if (!result.success) {
  addLine('error', result.error.message);
  return;
}

// TypeScript knows result.data exists here
addLine('result', result.data);
```

---

## Summary Checklist

When writing functional code, verify:

- [ ] No data mutation - using spread operators
- [ ] Pure functions wherever possible (no side effects)
- [ ] Code is self-documenting first; comments used for complex/non-obvious logic
- [ ] Array methods (`map`, `filter`, `reduce`) over loops
- [ ] Options objects for 3+ parameters
- [ ] Composed small functions, not complex monoliths
- [ ] `readonly` on all data structure properties
- [ ] `ReadonlyArray<T>` for immutable arrays
- [ ] Max 2 levels of nesting (use early returns)
- [ ] Result types for error handling
