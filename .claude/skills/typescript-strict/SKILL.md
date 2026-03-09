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
export type FileNode = {
  readonly type: 'file' | 'directory';
  readonly content: string | null;
  readonly owner: string;
  readonly permissions: FilePermissions;
  readonly children?: Readonly<Record<string, FileNode>>;
};
```

**Why `type`?** Better for unions, intersections, mapped types. `readonly` signals immutability. More flexible composition with utility types.

### `interface` — for behavior contracts

```typescript
export interface FileSystemOperations {
  readFile(machineId: string, path: string): FileNode | undefined;
  writeFile(machineId: string, path: string, content: string): void;
  canTraverse(machineId: string, path: string, username: string): boolean;
}
```

**Why `interface`?** Signals "this must be implemented." Works with `implements` keyword. Conventional for dependency injection.

### Schema Duplication

Define schemas once, import everywhere. Never duplicate the same validation logic across multiple files.

```typescript
// ✅ Define once
export const FileSystemPatchSchema = z.object({
  machineId: z.string(),
  path: z.string(),
  content: z.string().nullable(),
  owner: z.string(),
  isNew: z.boolean().optional(),
});
export type FileSystemPatch = z.infer<typeof FileSystemPatchSchema>;

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
// IndexedDB data, seed parsing, external storage
const SessionDataSchema = z.object({
  username: z.string(),
  machine: z.string(),
  currentPath: z.string(),
  wifiConnected: z.boolean(),
});
type SessionData = z.infer<typeof SessionDataSchema>;

// Validate at boundary
const session = SessionDataSchema.parse(indexedDbResult);
```

### When Schemas AREN'T Required

- Pure internal types (utilities, state)
- Result/Option types (no validation needed)
- TypeScript utility types (`Partial<T>`, `Pick<T>`, etc.)
- Behavior contracts (interfaces - structural, not validated)
- Component props (unless from URL/API)

```typescript
// ✅ CORRECT - No schema needed
type CommandResult<T, E> =
  | { success: true; data: T }
  | { success: false; error: E };

// ✅ CORRECT - Interface, no validation
interface CommandExecutor {
  execute(args: ReadonlyArray<string>): CommandOutput;
}
```

---

## Branded Types

For type-safe primitives:

```typescript
type MachineId = string & { readonly brand: unique symbol };
type IpAddress = string & { readonly brand: unique symbol };

// Type-safe at compile time
const resolveMachine = (machineId: MachineId, ip: IpAddress) => {
  // Implementation
};

// ❌ Can't pass raw strings
resolveMachine('fileserver', '192.168.1.50'); // Error

// ✅ Must use branded type
const machineId = 'fileserver' as MachineId;
const ip = '192.168.1.50' as IpAddress;
resolveMachine(machineId, ip); // OK
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
