---
name: typescript-strict
description: TypeScript strict mode patterns including schema-first development, branded types, type vs interface guidance, and tsconfig strict flags. Use when writing TypeScript code, defining types or schemas, or reviewing type safety. For immutability and pure function patterns, see the functional skill.
---

# TypeScript Strict Mode

## Core Rules

1. **No `any`** - ever. Use `unknown` if type is truly unknown
2. **No type assertions** (`as Type`) without justification
3. **Prefer `type` over `interface`** for data structures
4. **Reserve `interface`** for behavior contracts only

---

## Type vs Interface

### `type` — for data structures

```typescript
export type RemoteMachine = {
  readonly ip: string;
  readonly hostname: string;
  readonly ports: ReadonlyArray<Port>;
  readonly users: ReadonlyArray<RemoteUser>;
};
```

**Why `type`?** Better for unions, intersections, mapped types. `readonly` signals immutability. More flexible composition with utility types.

### `interface` — for behavior contracts

```typescript
export interface FileSystemAdapter {
  getNode(machineId: string, path: string): FileNode | undefined;
  writeFile(machineId: string, path: string, content: string): void;
}
```

**Why `interface`?** Signals "this must be implemented." Works with `implements` keyword. Conventional for dependency injection.

### Schema Duplication

Define schemas once, import everywhere. Never duplicate the same validation logic across multiple files.

```typescript
// ✅ Define once
export const GameStateSchema = z.object({
  seed: z.string().min(1),
  workstationName: z.string().min(1),
  username: z.string().min(1),
  rootPassword: z.string().min(1),
});
export type GameState = z.infer<typeof GameStateSchema>;

// Import and use wherever needed
```

---

## Strict Mode Configuration

### tsconfig.json Settings

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "forceConsistentCasingInFileNames": true,
    "allowUnusedLabels": false
  }
}
```

### What Each Setting Does

**Core strict flags:**
- **`strict: true`** - Enables all strict type checking options
- **`noImplicitAny`** - Error on expressions/declarations with implied `any` type
- **`strictNullChecks`** - `null` and `undefined` have their own types (not assignable to everything)
- **`noUnusedLocals`** - Error on unused local variables
- **`noUnusedParameters`** - Error on unused function parameters
- **`noImplicitReturns`** - Error when not all code paths return a value
- **`noFallthroughCasesInSwitch`** - Error on fallthrough cases in switch statements

**Additional safety flags (CRITICAL):**
- **`noUncheckedIndexedAccess`** - Array/object access returns `T | undefined` (prevents runtime errors from assuming elements exist)
- **`exactOptionalPropertyTypes`** - Distinguishes `property?: T` from `property: T | undefined` (more precise types)
- **`noPropertyAccessFromIndexSignature`** - Requires bracket notation for index signature properties (forces awareness of dynamic access)
- **`forceConsistentCasingInFileNames`** - Prevents case sensitivity issues across operating systems
- **`allowUnusedLabels`** - Error on unused labels (catches accidental labels that do nothing)

### Additional Rules

- **No `@ts-ignore`** without explicit comments explaining why
- **These rules apply to test code as well as production code**

### Architectural Insight: noUnusedParameters Catches Design Issues

The `noUnusedParameters` rule can reveal architectural problems:

**Example**: A function with an unused parameter often indicates the parameter belongs in a different layer. Strict mode catches these design issues early.

---

## Immutability, Pure Functions, and Composition

For detailed patterns on immutability (`readonly`, `ReadonlyArray`), pure functions, composition, Result types, array methods, and factory functions, see the `functional` skill. These are the canonical patterns used across the codebase.

Key TypeScript-specific notes:
- Use `readonly` on all `type` properties and `ReadonlyArray<T>` for arrays
- The compiler enforces immutability when `readonly` is used — leverage this
- Factory functions (not classes) for object creation, supporting dependency injection

---

## Schema-First at Trust Boundaries

### When Schemas ARE Required

- Data crosses trust boundary (external → internal)
- Type has validation rules (format, constraints)
- Shared data contract between systems
- Used in test factories (validate test data completeness)

```typescript
// IndexedDB data, user input, external data
const FileSystemPatchSchema = z.object({
  machineId: z.string(),
  path: z.string().startsWith('/'),
  content: z.string().nullable(),
  owner: z.enum(['root', 'user', 'guest']),
});
type FileSystemPatch = z.infer<typeof FileSystemPatchSchema>;

// Validate at boundary
const patch = FileSystemPatchSchema.parse(storedData);
```

### When Schemas AREN'T Required

- Pure internal types (utilities, state)
- Result/Option types (no validation needed)
- TypeScript utility types (`Partial<T>`, `Pick<T>`, etc.)
- Behavior contracts (interfaces - structural, not validated)
- Component props (unless from URL/API)

```typescript
// ✅ CORRECT - No schema needed
type PermissionResult =
  | { allowed: true }
  | { allowed: false; reason: string };

// ✅ CORRECT - Interface, no validation
interface CommandExecutor {
  execute(args: ReadonlyArray<string>): string | SpecialOutput;
}
```

---

## Branded Types

For type-safe primitives:

```typescript
type MachineIp = string & { readonly brand: unique symbol };
type MissionSeed = string & { readonly brand: unique symbol };

// Type-safe at compile time
const connectToMachine = (ip: MachineIp, seed: MissionSeed) => {
  // Implementation
};

// ❌ Can't pass raw string
connectToMachine('10.0.1.5', 'abc123'); // Error

// ✅ Must use branded type
const ip = '10.0.1.5' as MachineIp;
const seed = 'abc123' as MissionSeed;
connectToMachine(ip, seed); // OK
```

---

## Summary Checklist

When writing TypeScript code, verify:

- [ ] No `any` types - using `unknown` where type is truly unknown
- [ ] No type assertions without justification
- [ ] Using `type` for data structures with `readonly`
- [ ] Using `interface` for behavior contracts
- [ ] Schemas defined once, not duplicated
- [ ] Strict mode enabled with all checks passing
- [ ] For immutability, pure functions, composition: see `functional` skill
