# Scripting Helpers

Script-only helpers that live exclusively in the `node <path>` execution context. They are **never** dispatched by the shell parser and **never** appear in `help` / `man` / tab completion.

If you're looking for commands the player types at the prompt, see `src/commands/`. This folder is for plain functions that only make sense when calling them from `.js` scripts.

## How scripts see these helpers

`src/hooks/useCommands.ts` builds the `executionContext` object handed to `node` scripts in two steps:

1. Snapshot every registered shell command's `fn` into a plain record (`cat`, `nmap`, `hydra`, …).
2. Spread the script-only helpers from this folder on top.

```ts
const executionContext = {
  ...Object.fromEntries(commands.entries().map(([n, c]) => [n, c.fn])),
  writeFile: createWriteFile({ resolvePath, getNode, getUserType, createFile, writeFile }),
};
```

Scripts then reach every command and every helper through the same namespace:

```js
// inside a .js file executed via `node script.js`
const lines = await hydra('10.0.0.5', 'ssh');
writeFile('/tmp/hydra.log', lines);
```

## Design rules

- **No `Command` shape.** These helpers aren't dispatched by name from user input, don't need `manual` / `category` / `synopsis` / `examples`, and the shell parser never sees them.
- **Factory pattern.** Each helper is built by a `createX(ctx) => fn` factory so React hooks can inject filesystem / session context once per render.
- **Permission-aware writes.** Helpers that touch the filesystem call the permission-aware create / write hooks and surface `permission denied` errors as `Error('helperName: <reason>')` so scripts can catch them with a meaningful prefix.

## Current helpers

| Helper      | Signature                                  | Purpose                                                                                         |
| ----------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `writeFile` | `(path: string, content: unknown) => void` | Write content to a file under the current user's permissions. Creates the file if it's missing. |

`writeFile` content handling:

- `string` — written as-is.
- `string[]` — joined with `\n` (matches the natural return shape of `await asyncCmd()` in async scripts).
- Anything else — routed through `src/utils/stringify.ts` (objects become pretty-printed JSON, numbers / booleans stringified, `null` / `undefined` become the literal words).

## Relationship to the shell

| Need                                      | Interactive (shell)    | Script                                             |
| ----------------------------------------- | ---------------------- | -------------------------------------------------- |
| Capture output to a file                  | `cmd args > out.txt`   | `writeFile('out.txt', await cmd(args))`            |
| Unwrap an async command                   | (runs inline)          | `const lines = await cmd(args)`                    |
| Chain command output into text processing | `cmd args \| grep foo` | `await cmd(args)` returns `string[]`; filter in JS |

Historical note: earlier builds had shell commands `output(cmd, path?)` and `resolve(promise)`. Both were removed once redirect `>` landed in the shell and the async-script wrapper in `src/commands/node.ts` started auto-collecting `AsyncOutput` into `Promise<string[]>`. `writeFile` replaces the file-writing half of `output`; `await` replaces `resolve`.

## Adding a new helper

1. Create `src/scripting/<helper>.ts` with a `createX(ctx) => fn` factory export + types.
2. Add `.test.ts` siblings with TDD coverage (happy path, permissions, edge cases).
3. Re-export from `src/scripting/index.ts`.
4. Wire it into `executionContext` inside `src/hooks/useCommands.ts` (one spread line).
5. Mention it in this README's "Current helpers" table and in `src/commands/README.md` under the script-only helpers section.
