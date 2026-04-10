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
const machine = { ip: '10.0.1.5', ports: [{ port: 22, service: 'ssh', open: true }] };
addPort(machine, { port: 80, service: 'http', open: true }); // Mutates machine.ports internally
console.log(machine.ports.length); // 2 - SURPRISE! machine changed
```

```typescript
// ✅ CORRECT - Immutable approach is predictable
const machine = { ip: '10.0.1.5', ports: [{ port: 22, service: 'ssh', open: true }] };
const updatedMachine = addPort(machine, { port: 80, service: 'http', open: true }); // Returns new object
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
const serviceNames = compose(
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

❌ **WRONG - Comments explaining unclear code**

```typescript
// Get the node and check if it's a file with read access
function check(n: any) {
  // Check node exists
  if (n) {
    // Check if file
    if (n.t) {
      // Check permission
      if (n.p) {
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

✅ **Acceptable JSDoc for public APIs**

```typescript
/**
 * Creates a seeded PRNG for deterministic mission generation.
 * @param seed - The mission seed string used to derive the initial state
 * @throws {Error} if seed is empty
 */
export function createPrng(seed: string): Prng {
  // Implementation
}
```

---

## Array Methods Over Loops

Prefer `map`, `filter`, `reduce` for transformations. They're declarative (what, not how) and naturally immutable.

### Map - Transform Each Element

❌ **WRONG - Imperative loop**

```typescript
const serviceNames = [];
for (const port of machine.ports) {
  serviceNames.push(port.service);
}
```

✅ **CORRECT - Functional map**

```typescript
const serviceNames = machine.ports.map((p) => p.service);
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
let totalMachines = 0;
for (const layer of mission.layers) {
  totalMachines += layer.machines.length;
}
```

✅ **CORRECT - Functional reduce**

```typescript
const totalMachines = mission.layers.reduce((sum, layer) => sum + layer.machines.length, 0);
```

### Chaining Multiple Operations

✅ **CORRECT - Compose array methods**

```typescript
const sshTargets = network.machines
  .filter((m) => !m.bricked)
  .map((m) => m.ports.filter((p) => p.port === 22 && p.open))
  .reduce((all, ports) => [...all, ...ports], []);
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
function generateMission(
  seed: string,
  difficulty: Difficulty,
  entryVariant: EntryVariant,
  networkMode: NetworkMode,
  domainEntry: boolean,
  gpgEnabled: boolean,
): MissionNetwork {
  // ...
}

// Call site - unclear what parameters mean
generateMission('abc123', 'hard', 'ssh', 'nat', true, false);
```

✅ **CORRECT - Options object**

```typescript
type GenerateMissionOptions = {
  readonly seed: string;
  readonly difficulty: Difficulty;
  readonly entryVariant: EntryVariant;
  readonly networkMode: NetworkMode;
  readonly domainEntry?: boolean;
  readonly gpgEnabled?: boolean;
};

function generateMission(options: GenerateMissionOptions): MissionNetwork {
  const {
    seed,
    difficulty,
    entryVariant,
    networkMode,
    domainEntry = false,
    gpgEnabled = false,
  } = options;
  // ...
}

// Call site - crystal clear
generateMission({
  seed: 'abc123',
  difficulty: 'hard',
  entryVariant: 'ssh',
  networkMode: 'nat',
  domainEntry: true,
});
```

### When Positional Parameters Are OK

Use positional parameters when:

- 1-2 parameters max
- Order is obvious (e.g., `add(a, b)`)
- High-frequency utility functions

```typescript
// ✅ OK - Obvious ordering, few parameters
function resolvePath(path: string, cwd: string): string {
  return normalizePath(`${cwd}/${path}`);
}

function addChild(parent: FileNode, child: FileNode): FileNode {
  return { ...parent, children: { ...parent.children, [child.name]: child } };
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
function addMachine(machines: GeneratedMachine[], newMachine: GeneratedMachine): void {
  machines.push(newMachine); // ❌ Mutates input
}

let portCount = 0;
function countPort(): number {
  portCount++; // ❌ Modifies external state
  return portCount;
}
```

✅ **CORRECT - Pure functions**

```typescript
function addMachine(
  machines: ReadonlyArray<GeneratedMachine>,
  newMachine: GeneratedMachine,
): ReadonlyArray<GeneratedMachine> {
  return [...machines, newMachine]; // ✅ Returns new array
}

function countPort(current: number): number {
  return current + 1; // ✅ No external state
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
function countOpenPorts(machine: Readonly<RemoteMachine>): number {
  return machine.ports.reduce((sum, p) => sum + (p.open ? 1 : 0), 0);
}

// Impure shell (isolated)
function persistPatch(patch: FileSystemPatch): void {
  const count = countOpenPorts(machine); // Pure
  indexedDB.put('patches', patch); // Impure (I/O)
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
function validateMissionSeed(input: unknown) {
  if (typeof input !== 'object' || !input) {
    throw new Error('Invalid input');
  }
  if (!('seed' in input) || typeof input.seed !== 'string') {
    throw new Error('Missing seed');
  }
  if (!('difficulty' in input) || typeof input.difficulty !== 'string') {
    throw new Error('Missing difficulty');
  }
  if (!('machines' in input) || !Array.isArray(input.machines)) {
    throw new Error('Missing machines');
  }
  // ... 50 more lines of validation and registration
}
```

✅ **CORRECT - Composed functions**

```typescript
// Small, focused functions
const validate = (input: unknown) => MissionSeedSchema.parse(input);
const generate = (config: MissionConfig) => generateMissionNetwork(config);

// Compose them
const createMission = (input: unknown) => generate(validate(input));
```

### Composing Immutable Transformations

```typescript
// Small transformation functions
const addUsers = (
  machine: GeneratedMachine,
  users: ReadonlyArray<RemoteUser>,
): GeneratedMachine => ({
  ...machine,
  users,
});

const addPorts = (machine: GeneratedMachine, ports: ReadonlyArray<Port>): GeneratedMachine => ({
  ...machine,
  ports,
});

const setRole = (machine: GeneratedMachine, role: MachineRole): GeneratedMachine => ({
  ...machine,
  role,
});

// Compose them
const enrichMachine = (machine: GeneratedMachine, prng: Prng): GeneratedMachine => {
  return setRole(
    addPorts(addUsers(machine, generateUsers(prng)), generatePorts(machine.role, prng)),
    machine.role,
  );
};
```

---

## Readonly Keyword for Immutability

Use `readonly` on all data structures to signal immutability intent.

### readonly on Properties

```typescript
// ✅ CORRECT - Immutable data structure
type RemoteMachine = {
  readonly ip: string;
  readonly hostname: string;
  readonly ports: ReadonlyArray<Port>;
};

// ❌ WRONG - Mutable
type RemoteMachine = {
  ip: string;
  hostname: string;
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
type Port = {
  readonly port: number;
  readonly service: string;
  readonly open: boolean;
  readonly vulnerability?: {
    readonly type: string;
    readonly payload: readonly string[];
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
function checkFileAccess(node: FileNode, path: string, user: UserType) {
  if (node.type === 'directory') {
    if (node.children) {
      if (path in node.children) {
        if (node.children[path].permissions.read.includes(user)) {
          // ... deeply nested logic
        }
      }
    }
  }
}
```

✅ **CORRECT - Flat with early returns**

```typescript
function checkFileAccess(node: FileNode, path: string, user: UserType) {
  if (node.type !== 'directory') return false;
  if (!node.children) return false;
  if (!(path in node.children)) return false;
  if (!node.children[path].permissions.read.includes(user)) return false;

  // Main logic at top level
  return true;
}
```

✅ **CORRECT - Extract to functions**

```typescript
function checkFileAccess(node: FileNode, path: string, user: UserType) {
  if (!isAccessibleDirectory(node, path)) return false;
  const child = node.children![path];
  return hasReadPermission(child, user);
}

function isAccessibleDirectory(node: FileNode, path: string): boolean {
  return node.type === 'directory' && node.children !== undefined && path in node.children;
}
```

---

## Immutable Array Operations

**Complete catalog of array mutations and their immutable alternatives:**

```typescript
// ❌ WRONG - Mutations
machines.push(newMachine); // Add to end
machines.pop(); // Remove last
machines.unshift(newMachine); // Add to start
machines.shift(); // Remove first
machines.splice(index, 1); // Remove at index
machines.reverse(); // Reverse order
machines.sort(); // Sort
machines[i] = newValue; // Update at index

// ✅ CORRECT - Immutable alternatives
const withNew = [...machines, newMachine]; // Add to end
const withoutLast = machines.slice(0, -1); // Remove last
const withFirst = [newMachine, ...machines]; // Add to start
const withoutFirst = machines.slice(1); // Remove first
const removed = [
  ...machines.slice(0, index), // Remove at index
  ...machines.slice(index + 1),
];
const reversed = [...machines].reverse(); // Reverse (copy first!)
const sorted = [...machines].sort(); // Sort (copy first!)
const updated = machines.map(
  (
    m,
    idx, // Update at index
  ) => (idx === i ? newValue : m),
);
```

**Common patterns:**

```typescript
// Filter out specific machine by IP
const withoutMachine = machines.filter((m) => m.ip !== targetIp);

// Replace specific machine
const replaced = machines.map((m) => (m.ip === targetIp ? updatedMachine : m));

// Insert at specific position
const inserted = [...machines.slice(0, index), newMachine, ...machines.slice(index)];
```

---

## Immutable Object Updates

```typescript
// ❌ WRONG
machine.hostname = 'web-server';
Object.assign(machine, { hostname: 'web-server' });

// ✅ CORRECT
const updated = { ...machine, hostname: 'web-server' };
```

---

## Nested Updates

```typescript
// ✅ CORRECT - Immutable nested update
const updatedMachine = {
  ...machine,
  ports: machine.ports.map((p, i) => (i === targetIndex ? { ...p, open: false } : p)),
};

// ✅ CORRECT - Immutable nested array update (filesystem tree)
const updatedRoot = {
  ...root,
  children: {
    ...root.children,
    [childName]: updatedChild,
  },
};
```

---

## Early Returns Over Nesting

```typescript
// ❌ WRONG - Nested conditions
if (node) {
  if (node.type === 'file') {
    if (node.permissions.read.includes(userType)) {
      // do something
    }
  }
}

// ✅ CORRECT - Early returns (guard clauses)
if (!node) return;
if (node.type !== 'file') return;
if (!node.permissions.read.includes(userType)) return;

// do something
```

---

## Result Type for Error Handling

```typescript
type PermissionResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

// Usage
function checkTraversal(fs: FileNode, path: string, user: UserType): PermissionResult {
  if (!fs.children) {
    return { allowed: false, reason: `${path}: No such file or directory` };
  }

  const segment = path.split('/')[0];
  if (!fs.children[segment]?.permissions.execute.includes(user)) {
    return { allowed: false, reason: `${path}: Permission denied` };
  }

  return { allowed: true };
}

// Caller handles both cases explicitly
const result = checkTraversal(fs, path, user);
if (!result.allowed) {
  return result.reason;
}

// TypeScript knows result.allowed is true here
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
