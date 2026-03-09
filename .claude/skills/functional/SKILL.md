---
name: functional
description: Functional programming patterns with immutable data. Use when writing logic, data transformations, or encountering mutation bugs. Covers immutability violations catalog, pure functions, composition, early returns, and options objects. Do NOT over-apply heavy FP abstractions (monads, fp-ts) unless the project requires them.
---

# Functional Patterns

## Core Principles

- **No data mutation** - immutable structures only
- **Pure functions** wherever possible
- **Composition** over inheritance
- **No comments** - code should be self-documenting
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
const node = { name: 'config.txt', permissions: { read: ['root'] } };
grantReadAccess(node, 'guest'); // Mutates node.permissions internally
console.log(node.permissions.read); // ['root', 'guest'] - SURPRISE! node changed
```

```typescript
// ✅ CORRECT - Immutable approach is predictable
const node = { name: 'config.txt', permissions: { read: ['root'] } };
const updatedNode = grantReadAccess(node, 'guest'); // Returns new object
console.log(node.permissions.read); // ['root'] - original unchanged
console.log(updatedNode.permissions.read); // ['root', 'guest'] - new version
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
const openPorts = machine.ports.filter(p => !p.closed);
const portNumbers = openPorts.map(p => p.number);

// ❌ OVER-ENGINEERED - Unnecessary abstraction
const compose = <T>(...fns: Array<(arg: T) => T>) => (x: T) =>
  fns.reduceRight((v, f) => f(v), x);
const openPorts = compose(
  filter((p: Port) => !p.closed),
  map((p: Port) => p.number)
)(machine.ports);
```

---

## Self-Documenting Code + Comments for Complexity

Code should be clear through naming and structure first. **Comments are welcome when they explain *why* or clarify complex/non-obvious logic** — but never when they just restate what the code already says.

### The Rule

- **Bad comments**: restate what the code does (noise)
- **Good comments**: explain *why* something non-obvious is done, or clarify complex logic that can't be simplified further

### Examples

❌ **WRONG - Comments restating obvious code**
```typescript
// Check if the user is root
if (username === 'root') return true;

// Filter out closed ports
const openPorts = ports.filter(p => !p.closed);

// Return the hostname
return machine.hostname;
```

❌ **WRONG - Comments papering over bad naming**
```typescript
// Check the file and see if user can access it
function check(f: any, u: any) {
  // Check file exists
  if (f) {
    // Check if user is root
    if (u === 'root') {
      return true;
    }
  }
  return false;
}
```

✅ **CORRECT - Self-documenting code (no comments needed)**
```typescript
function canAccessFile(file: FileNode | undefined, username: string): boolean {
  if (!file) return false;
  if (username === 'root') return true;
  if (!file.permissions?.read?.includes(username)) return false;
  return true;
}
```

✅ **CORRECT - Comments explaining non-obvious logic**
```typescript
// Always consume 4 PRNG calls for sequence stability, even when no closures apply
prng.next(); prng.next(); prng.nextInt(eligible.length); prng.nextInt(eligible.length);

// Mutable resolvedExecutionContext breaks the circular dependency:
// node() needs the execution context, which includes node() itself.
// The getter is only called at execution time, after the context is fully built.
let resolvedExecutionContext: ExecutionContext | undefined;

// BroadcastChannel doesn't deliver to the posting tab, so echo loops can't occur
channel.postMessage({ type: 'patch', data: patch });
```

✅ **CORRECT - JSDoc for public APIs**
```typescript
/**
 * Wraps a command with filesystem-based access checking.
 * @param command - The command to wrap with permission checks
 * @throws if the command's binary is missing or not executable
 */
export function wrapWithAccessCheck(command: Command): Command {
  // Implementation
}
```

---

## Array Methods Over Loops

Prefer `map`, `filter`, `reduce` for transformations. They're declarative (what, not how) and naturally immutable.

### Map - Transform Each Element

❌ **WRONG - Imperative loop**
```typescript
const machineNames = [];
for (const machine of machines) {
  machineNames.push(machine.hostname);
}
```

✅ **CORRECT - Functional map**
```typescript
const machineNames = machines.map(m => m.hostname);
```

### Filter - Select Subset

❌ **WRONG - Imperative loop**
```typescript
const reachableMachines = [];
for (const machine of machines) {
  if (!brickedMachines.has(machine.ip)) {
    reachableMachines.push(machine);
  }
}
```

✅ **CORRECT - Functional filter**
```typescript
const reachableMachines = machines.filter(m => !brickedMachines.has(m.ip));
```

### Reduce - Aggregate Values

❌ **WRONG - Imperative loop**
```typescript
let totalOpenPorts = 0;
for (const machine of machines) {
  totalOpenPorts += machine.ports.filter(p => !p.closed).length;
}
```

✅ **CORRECT - Functional reduce**
```typescript
const totalOpenPorts = machines.reduce(
  (sum, machine) => sum + machine.ports.filter(p => !p.closed).length, 0
);
```

### Chaining Multiple Operations

✅ **CORRECT - Compose array methods**
```typescript
const sshTargets = machines
  .filter(m => !brickedMachines.has(m.ip))
  .map(m => m.ports.find(p => p.service === 'ssh'))
  .filter(Boolean)
  .map(port => `${port.number}/tcp`);
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
function generateMachine(
  role: string,
  hostname: string,
  ip: string,
  subnet: string,
  isEntry: boolean,
  hasSsh: boolean
): GeneratedMachine {
  // ...
}

// Call site - unclear what parameters mean
generateMachine('webserver', 'web01', '10.0.1.10', '10.0.1.0/24', true, true);
```

✅ **CORRECT - Options object**
```typescript
type GenerateMachineOptions = {
  readonly role: MachineRole;
  readonly hostname: string;
  readonly ip: string;
  readonly subnet: string;
  readonly isEntry?: boolean;
  readonly hasSsh?: boolean;
};

function generateMachine(options: GenerateMachineOptions): GeneratedMachine {
  const { role, hostname, ip, subnet, isEntry = false, hasSsh = true } = options;
  // ...
}

// Call site - crystal clear
generateMachine({
  role: 'webserver',
  hostname: 'web01',
  ip: '10.0.1.10',
  subnet: '10.0.1.0/24',
  isEntry: true,
});
```

### When Positional Parameters Are OK

Use positional parameters when:
- 1-2 parameters max
- Order is obvious (e.g., `resolvePath(base, relative)`)
- High-frequency utility functions

```typescript
// ✅ OK - Obvious ordering, few parameters
function resolvePath(base: string, relative: string): string {
  return normalize(`${base}/${relative}`);
}

function applyPatch(tree: FileNode, patch: FileSystemPatch): FileNode {
  return { ...tree, children: { ...tree.children, [patch.path]: patch.content } };
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
function addMachine(machines: RemoteMachine[], newMachine: RemoteMachine): void {
  machines.push(newMachine); // ❌ Mutates input
}

let commandCount = 0;
function trackCommand(): number {
  commandCount++; // ❌ Modifies external state
  return commandCount;
}
```

✅ **CORRECT - Pure functions**
```typescript
function addMachine(
  machines: ReadonlyArray<RemoteMachine>,
  newMachine: RemoteMachine,
): ReadonlyArray<RemoteMachine> {
  return [...machines, newMachine]; // ✅ Returns new array
}

function incrementCount(count: number): number {
  return count + 1; // ✅ No external state
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
function resolveAttackChain(machines: ReadonlyArray<GeneratedMachine>): ReadonlyArray<AttackStep> {
  return machines.map(m => ({ target: m.ip, method: getMethodForMachine(m) }));
}

// Impure shell (isolated)
async function persistMissionPatches(patches: ReadonlyArray<FileSystemPatch>): Promise<void> {
  const chain = resolveAttackChain(machines); // Pure
  await storage.save('patches', patches); // Impure (I/O)
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
function processCommand(input: unknown) {
  if (typeof input !== 'string' || !input) {
    throw new Error('Invalid input');
  }
  if (!input.includes('(')) {
    throw new Error('Not a function call');
  }
  if (input.startsWith('sudo')) {
    throw new Error('sudo not supported');
  }
  // ... 50 more lines of parsing and execution
}
```

✅ **CORRECT - Composed functions**
```typescript
// Small, focused functions
const parseInput = (input: string) => extractCommandAndArgs(input);
const validateAccess = (command: Command) => checkBinaryPermissions(command);
const execute = (command: Command, args: ReadonlyArray<string>) => command.execute(args);

// Compose them
const processCommand = (input: string) => execute(...validateAccess(parseInput(input)));
```

### Composing Immutable Transformations

```typescript
// Small transformation functions
const addBootFiles = (tree: FileNode): FileNode => ({
  ...tree,
  children: { ...tree.children, boot: createBootDirectory() },
});

const addBinaries = (tree: FileNode): FileNode => ({
  ...tree,
  children: { ...tree.children, bin: createBinDirectory() },
});

const applyPermissions = (tree: FileNode, owner: string): FileNode => ({
  ...tree,
  owner,
  permissions: { ...tree.permissions, execute: [owner, 'root'] },
});

// Compose them
const buildMachineFilesystem = (tree: FileNode): FileNode => {
  return applyPermissions(
    addBinaries(
      addBootFiles(tree)
    ),
    'root'
  );
};

// Or use pipe for left-to-right reading
const buildMachineFilesystem = (tree: FileNode): FileNode =>
  pipe(
    tree,
    t => addBootFiles(t),
    t => addBinaries(t),
    t => applyPermissions(t, 'root'),
  );
```

---

## Readonly Keyword for Immutability

Use `readonly` on all data structures to signal immutability intent.

### readonly on Properties

```typescript
// ✅ CORRECT - Immutable data structure
type FileNode = {
  readonly name: string;
  readonly content: string | null;
  readonly owner: string;
};

// ❌ WRONG - Mutable
type FileNode = {
  name: string;
  content: string | null;
  owner: string;
};
```

### ReadonlyArray vs Array

```typescript
// ✅ CORRECT - Immutable array
type MissionNetwork = {
  readonly machines: ReadonlyArray<GeneratedMachine>;
};

// ❌ WRONG - Mutable array
type MissionNetwork = {
  readonly machines: GeneratedMachine[];
};
```

### Nested readonly

```typescript
// ✅ CORRECT - Deep immutability
type GeneratedMachine = {
  readonly role: MachineRole;
  readonly ports: ReadonlyArray<{
    readonly number: number;
    readonly service: string;
    readonly closed: boolean;
  }>;
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
function canExecuteCommand(command: Command, session: Session) {
  if (command.binary) {
    if (session.machine) {
      if (session.userType === 'root') {
        if (command.binary.permissions.execute.includes('root')) {
          // ... deeply nested logic
        }
      }
    }
  }
}
```

✅ **CORRECT - Flat with early returns**
```typescript
function canExecuteCommand(command: Command, session: Session) {
  if (!command.binary) return true;
  if (!session.machine) return false;
  if (!command.binary.permissions.execute.includes(session.userType)) return false;

  return true;
}
```

✅ **CORRECT - Extract to functions**
```typescript
function canExecuteCommand(command: Command, session: Session) {
  if (!requiresBinaryCheck(command)) return true;
  return hasBinaryPermission(command.binary, session.userType);
}

function hasBinaryPermission(binary: FileNode, userType: string): boolean {
  return binary.permissions.execute.includes(userType)
    || userType === 'root';
}
```

---

## Immutable Array Operations

**Complete catalog of array mutations and their immutable alternatives:**

```typescript
// ❌ WRONG - Mutations
patches.push(newPatch);        // Add to end
patches.pop();                 // Remove last
patches.unshift(newPatch);     // Add to start
patches.shift();               // Remove first
patches.splice(index, 1);     // Remove at index
patches.reverse();             // Reverse order
patches.sort();                // Sort
patches[i] = newValue;        // Update at index

// ✅ CORRECT - Immutable alternatives
const withNew = [...patches, newPatch];           // Add to end
const withoutLast = patches.slice(0, -1);         // Remove last
const withFirst = [newPatch, ...patches];         // Add to start
const withoutFirst = patches.slice(1);            // Remove first
const removed = [...patches.slice(0, index),      // Remove at index
                 ...patches.slice(index + 1)];
const reversed = [...patches].reverse();          // Reverse (copy first!)
const sorted = [...patches].sort();               // Sort (copy first!)
const updated = patches.map((patch, idx) =>       // Update at index
  idx === i ? newValue : patch
);
```

**Common patterns:**

```typescript
// Filter out patches for a specific machine
const withoutMachine = patches.filter(p => p.machineId !== targetMachineId);

// Replace a patch by path
const replaced = patches.map(p =>
  p.path === targetPath ? newPatch : p
);

// Insert at specific position
const inserted = [
  ...patches.slice(0, index),
  newPatch,
  ...patches.slice(index)
];
```

---

## Immutable Object Updates

```typescript
// ❌ WRONG
session.machine = 'fileserver';
Object.assign(session, { machine: 'fileserver' });

// ✅ CORRECT
const updated = { ...session, machine: 'fileserver' };
```

---

## Nested Updates

```typescript
// ✅ CORRECT - Immutable nested update
const updatedNetwork = {
  ...network,
  machines: network.machines.map((machine, i) =>
    i === targetIndex ? { ...machine, hostname: newHostname } : machine
  ),
};

// ✅ CORRECT - Immutable nested array update
const updatedTree = {
  ...tree,
  children: {
    ...tree.children,
    [filename]: { ...tree.children[filename], content: newContent },
  },
};
```

---

## Early Returns Over Nesting

```typescript
// ❌ WRONG - Nested conditions
if (file) {
  if (file.type === 'file') {
    if (file.permissions.read.includes(username)) {
      // do something
    }
  }
}

// ✅ CORRECT - Early returns (guard clauses)
if (!file) return;
if (file.type !== 'file') return;
if (!file.permissions.read.includes(username)) return;

// do something
```

---

## Result Type for Error Handling

```typescript
type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

// Usage
function resolveFilePath(currentPath: string, target: string): Result<string> {
  if (target.includes('\0')) {
    return { success: false, error: new Error('Invalid path character') };
  }

  const resolved = normalizePath(`${currentPath}/${target}`);
  return { success: true, data: resolved };
}

// Caller handles both cases explicitly
const result = resolveFilePath(session.currentPath, userInput);
if (!result.success) {
  console.error(result.error);
  return;
}

// TypeScript knows result.data exists here
console.log(result.data);
```

---

## Summary Checklist

When writing functional code, verify:

- [ ] No data mutation - using spread operators
- [ ] Pure functions wherever possible (no side effects)
- [ ] Code is self-documenting (no comments needed)
- [ ] Array methods (`map`, `filter`, `reduce`) over loops
- [ ] Options objects for 3+ parameters
- [ ] Composed small functions, not complex monoliths
- [ ] `readonly` on all data structure properties
- [ ] `ReadonlyArray<T>` for immutable arrays
- [ ] Max 2 levels of nesting (use early returns)
- [ ] Result types for error handling
